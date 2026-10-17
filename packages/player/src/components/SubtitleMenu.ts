/**
 * ============================================
 * 字幕设置面板组件 (SubtitleMenu)
 * ============================================
 * 声明式响应式版本：开关/语言/双语/样式/面板显隐/二级页/下拉展开
 * 七组状态全部由内部 signal 驱动，渲染层零 DOM 操作：
 * - class/style 内的 signal 访问由编译器包装为 __reactiveAttrs
 * - 动态文本使用显式 getter 协议（() => expr → _reactiveText）
 *
 * 保留命令式的部分（按迁移规范，均附注释说明理由）：
 * - input.checked 表单勾选同步（setAttribute 无法反映当前值，onEffect 内
 *   直接赋值 DOM property）
 * - 滑条圆点位移（依赖 getBoundingClientRect 几何测量，onEffect 内命令式）
 * - 滑条拖拽的 document mousemove/mouseup 监听（拖拽场景）
 * - 面板显隐定时器（时序行为）
 *
 * 对外 API（setVisible/setBilingual/showOriginPage）与事件契约完全不变；
 * API 内部仅写 signal，不再触碰 DOM。
 */

import {
  h,
  defineComponent,
  useTemplateRef,
  useState,
  useContext,
  signal,
  onEffect,
  t,
  For,
} from "@/core";
import { useComponentUnmount } from "@/nova/core/componentUnmount";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import type { AnimationFrameID } from "@/utils/rafTimeout";
import type { VNode } from "@/types";
import type { PlayerPluginFlags } from "./PlayerDocker";
import type { SubtitleTrackInfo } from "@/types/subtitle";
import { PlayerStateKeyEnum, StateContext } from "@/store/runtimeState";

// ============================================
// 对外接口（冻结，父层按此接线）
// ============================================

/** 字幕语言项 */
export interface SubtitleLanguageOption {
  /** 语言标识（渲染为语言项 data-lan，参考 DOM 形如 ai-zh） */
  lang: string;
  /** 显示名（参考 DOM 原文，如「中文」「English」） */
  label: string;
  /** 是否默认语言 */
  isDefault?: boolean;
}

/** 字幕样式补丁（只带变化的字段） */
export interface SubtitleStylePatch {
  fontSize?: number;
  color?: string;
  position?: "top" | "bottom";
  offset?: number;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  scale?: boolean;
  fade?: boolean;
}

/** 字幕样式（组件内部使用的完整样式结构，与 SubtitleMenuProps['style'] 一致） */
export type SubtitleStyle = NonNullable<SubtitleMenuProps["style"]>;

export interface SubtitleMenuProps {
  /** 字幕是否开启 */
  visible: boolean;
  /** 可选语言列表（为空时按参考 DOM 的 6 项原样渲染） */
  languages: SubtitleLanguageOption[];
  /** 当前语言 */
  lang: string;
  /** 当前样式（用于回显各设置项初值） */
  style: {
    fontSize: number;
    color: string;
    position: "top" | "bottom";
    offset: number;
    strokeColor: string;
    strokeWidth: number;
    opacity: number;
    scale: boolean;
    fade: boolean;
  };
  /** 是否开启双语 */
  bilingual?: boolean;
  /**
   * 插件安装标志读取器（getter 形态，RightControls 透传）：
   * 未装 subtitle 插件时按钮整体隐藏——根节点 style.display 的
   * 响应式表达式内调用 getter，编译器包装 __reactiveAttrs 原位
   * 更新，插件运行中装卸时自动显隐。未传（独立使用
   * SubtitleMenu 的场景）保持显示
   */
  plugins?: () => PlayerPluginFlags;
}

export interface SubtitleMenuEvents {
  /** 字幕开关变化 */
  subtitleToggle: (visible: boolean) => void;
  /** 语言切换 */
  subtitleLangChange: (lang: string) => void;
  /** 样式项变化（只带变化字段） */
  subtitleStyleChange: (patch: SubtitleStylePatch) => void;
  /** 双语开关变化 */
  bilingualChange: (enabled: boolean) => void;
  /** 组件挂载完成（供父层获取命令式 API，可选） */
  subtitleMenuMounted?: SubtitleMenuApi;
}

/** 组件对外暴露的命令式 API */
export interface SubtitleMenuApi {
  /** 同步字幕开关（含按钮结果区与「关闭」行选中态） */
  setVisible: (visible: boolean) => void;
  /** 同步双语开关 */
  setBilingual: (enabled: boolean) => void;
  /** 回到第 1 页（移除 state-show-right） */
  showOriginPage: () => void;
}

// ============================================
// 常量：文案与选项（全部照抄参考 DOM）
// ============================================

/**
 * 参考 DOM 的语言项（字幕设置-dom.txt:65-77 / :83-95，主副字幕列表各 6 项，内容相同）
 * props.languages 为空时按这 6 项原样渲染
 */
const DEFAULT_LANGUAGES: SubtitleLanguageOption[] = [
  { lang: "ai-zh", label: "中文" },
  { lang: "ai-en", label: "English" },
  { lang: "ai-ja", label: "日本語" },
  { lang: "ai-es", label: "Español" },
  { lang: "ai-ar", label: "العربية" },
  { lang: "ai-pt", label: "Português" },
];

// ============================================
// 轨道列表：统一形态 + 类型谓词（For 的 render 入参为 unknown，
// 用谓词窄化替代 as 断言）
// ============================================

/** 语言/轨道列表项统一形态：插件上报轨道优先，配置语言项回退 */
type SubtitleListItem = SubtitleTrackInfo | SubtitleLanguageOption;

/**
 * 判定列表项是否为运行时轨道（SubtitleTrackInfo）
 * 结构特征：trackId + source 字段（语言项只有 lang/label）
 */
function isTrackInfo(item: unknown): item is SubtitleTrackInfo {
  if (typeof item !== "object" || item === null) return false;
  return "trackId" in item && "source" in item;
}

/**
 * 判定列表项是否为配置语言项（SubtitleLanguageOption）
 * 结构特征：lang + label 字段且无 trackId
 */
function isLangOption(item: unknown): item is SubtitleLanguageOption {
  if (typeof item !== "object" || item === null) return false;
  return "lang" in item && "label" in item && !("trackId" in item);
}

/** 下拉选项（value 为参考 DOM 的 data-value，label 为 i18n key，渲染时经 t() 取文案） */
interface SubtitleSelectOption {
  /** 参考 DOM 的 data-value */
  value: string;
  /** i18n key（避免模块加载期 t() 在 initI18n 之前执行取错语言） */
  label: string;
  /** 颜色项色块（参考 DOM 内联 style 的色值） */
  swatch?: string;
  /** 选中后下发的样式补丁 */
  patch: SubtitleStylePatch;
}

/** 参考 DOM 快照对应的默认样式 */
const DEFAULT_STYLE: SubtitleStyle = {
  fontSize: 1, // 字幕大小：适中（data-value=1）
  color: "#ffffff", // 字幕颜色：白色
  position: "bottom", // 默认位置：底部居中
  offset: 0,
  strokeColor: "none", // 描边方式：无描边
  strokeWidth: 0,
  opacity: 0.87, // 背景不透明度：87%
  scale: true, // 其它设置：等比缩放（参考 DOM 该 input 带 checked）
  fade: false, // 其它设置：淡入淡出
};

/** 字幕大小（参考 DOM data-value 0.6/0.8/1/1.3/1.6，结果项初始为「适中」） */
const FONT_SIZE_OPTIONS: SubtitleSelectOption[] = [
  {
    value: "0.6",
    label: "player.ui.subtitle.size.min",
    patch: { fontSize: 0.6 },
  },
  {
    value: "0.8",
    label: "player.ui.subtitle.size.smaller",
    patch: { fontSize: 0.8 },
  },
  {
    value: "1",
    label: "player.ui.subtitle.size.medium",
    patch: { fontSize: 1 },
  },
  {
    value: "1.3",
    label: "player.ui.subtitle.size.larger",
    patch: { fontSize: 1.3 },
  },
  {
    value: "1.6",
    label: "player.ui.subtitle.size.max",
    patch: { fontSize: 1.6 },
  },
];

/** 字幕颜色（data-value 为参考 DOM 的十进制色值，色块取内联 style 的十六进制值） */
const COLOR_OPTIONS: SubtitleSelectOption[] = [
  {
    value: "16777215",
    label: "player.ui.subtitle.color.white",
    swatch: "#ffffff",
    patch: { color: "#ffffff" },
  },
  {
    value: "16007990",
    label: "player.ui.subtitle.color.red",
    swatch: "#F44336",
    patch: { color: "#F44336" },
  },
  {
    value: "10233776",
    label: "player.ui.subtitle.color.purple",
    swatch: "#9C27B0",
    patch: { color: "#9C27B0" },
  },
  {
    value: "6765239",
    label: "player.ui.subtitle.color.deep_purple",
    swatch: "#673AB7",
    patch: { color: "#673AB7" },
  },
  {
    value: "4149685",
    label: "player.ui.subtitle.color.indigo",
    swatch: "#3F51B5",
    patch: { color: "#3F51B5" },
  },
  {
    value: "2201331",
    label: "player.ui.subtitle.color.blue",
    swatch: "#2196F3",
    patch: { color: "#2196F3" },
  },
  {
    value: "240116",
    label: "player.ui.subtitle.color.light_blue",
    swatch: "#03A9F4",
    patch: { color: "#03A9F4" },
  },
];

/**
 * 描边方式（参考 DOM data-value 0/1/2/3）
 * 冻结接口只提供 strokeColor + strokeWidth，故每一档映射为一组描边色/线宽
 */
const STROKE_OPTIONS: SubtitleSelectOption[] = [
  {
    value: "0",
    label: "player.ui.subtitle.stroke.none",
    patch: { strokeColor: "none", strokeWidth: 0 },
  },
  {
    value: "1",
    label: "player.ui.subtitle.stroke.heavy",
    patch: { strokeColor: "#000000", strokeWidth: 4 },
  },
  {
    value: "2",
    label: "player.ui.subtitle.stroke.outline",
    patch: { strokeColor: "#000000", strokeWidth: 2 },
  },
  {
    value: "3",
    label: "player.ui.subtitle.stroke.projection",
    patch: { strokeColor: "#000000", strokeWidth: 1 },
  },
];

/**
 * 默认位置（参考 DOM 的 6 档 data-value）
 * 冻结接口为 position('top'|'bottom') + offset，故左/中/右映射为 offset -1/0/1
 */
const POSITION_OPTIONS: SubtitleSelectOption[] = [
  {
    value: "bottom-left",
    label: "player.ui.subtitle.position.bottom_left",
    patch: { position: "bottom", offset: -1 },
  },
  {
    value: "bottom-center",
    label: "player.ui.subtitle.position.bottom_center",
    patch: { position: "bottom", offset: 0 },
  },
  {
    value: "bottom-right",
    label: "player.ui.subtitle.position.bottom_right",
    patch: { position: "bottom", offset: 1 },
  },
  {
    value: "top-left",
    label: "player.ui.subtitle.position.top_left",
    patch: { position: "top", offset: -1 },
  },
  {
    value: "top-center",
    label: "player.ui.subtitle.position.top_center",
    patch: { position: "top", offset: 0 },
  },
  {
    value: "top-right",
    label: "player.ui.subtitle.position.top_right",
    patch: { position: "top", offset: 1 },
  },
];

/** 四个下拉的根节点类名（与 subtitlemenu.scss 对应） */
const SELECT_CLASS = {
  fontSize: "nova-player-ctrl-subtitle-fontsize-content",
  color: "nova-player-ctrl-subtitle-color-content",
  stroke: "nova-player-ctrl-subtitle-shadow-content",
  position: "nova-player-ctrl-subtitle-position-content",
} as const;

/** 滑条圆点直径（参考 .bui-thumb .bui-thumb-dot 为 12px） */
const THUMB_SIZE = 12;

// ============================================
// 图标（svg 照抄参考 DOM）
// ============================================

/** 字幕标记图标（参考 DOM:4 结果区 / :66 语言项） */
const SubtitleMarkIcon = (): VNode =>
  h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      fill: "none",
      "data-pointer": "none",
      viewBox: "0 0 14 12",
    },
    h("rect", {
      width: "13.5",
      height: "11.5",
      x: ".25",
      y: ".25",
      stroke: "#fff",
      "stroke-opacity": ".5",
      "stroke-width": ".5",
      rx: "5.75",
    }),
    h("path", {
      fill: "#fff",
      d: "M5.248 2.788h.76L8.256 8.5h-.712l-.608-1.6H4.312l-.608 1.6H3l2.248-5.712Zm-.728 3.56h2.208l-1.08-2.856h-.032L4.52 6.348Zm4.362-3.56h.648V8.5h-.648V2.788Z",
    }),
  );

/** 假开关问号图标（参考 DOM:44） */
const FakeSwitchIcon = (): VNode =>
  h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      fill: "none",
      "data-pointer": "none",
      viewBox: "0 0 12 12",
    },
    h("path", {
      fill: "#61666D",
      d: "M6 1.875a4.125 4.125 0 1 0 0 8.25 4.125 4.125 0 0 0 0-8.25ZM.875 6a5.125 5.125 0 1 1 10.25 0A5.125 5.125 0 0 1 .875 6Z",
    }),
    h("path", {
      fill: "#61666D",
      d: "M6 3.5a.5.5 0 0 1 .5.5v2.25a.5.5 0 1 1-1 0V4a.5.5 0 0 1 .5-.5ZM6 7.25a.5.5 0 0 1 .5.5v.125a.5.5 0 1 1-1 0V7.75a.5.5 0 0 1 .5-.5Z",
    }),
  );

/** 「字幕设置」右尖角图标（参考 DOM:112，path 不写 fill，颜色由 CSS 的 fill 控制） */
const ChevronRightIcon = (): VNode =>
  h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      "xml:space": "preserve",
      "data-pointer": "none",
      viewBox: "0 0 16 16",
    },
    h("path", {
      d: "m9.188 7.999-3.359 3.359a.75.75 0 1 0 1.061 1.061l3.889-3.889a.75.75 0 0 0 0-1.061L6.89 3.58a.75.75 0 1 0-1.061 1.061l3.359 3.358z",
    }),
  );

/** 勾选未选中图标（参考 DOM:349，path 不写 fill，颜色由 CSS 的 fill 控制） */
const CheckboxDefaultIcon = (): VNode =>
  h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      "data-pointer": "none",
      viewBox: "0 0 32 32",
    },
    h("path", {
      d: "M8 6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H8zm0-2h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z",
    }),
  );

/** 勾选选中图标（参考 DOM:350） */
const CheckboxSelectedIcon = (): VNode =>
  h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      "data-pointer": "none",
      viewBox: "0 0 32 32",
    },
    h("path", {
      d: "m13 18.25-1.8-1.8c-.6-.6-1.65-.6-2.25 0s-.6 1.5 0 2.25l2.85 2.85c.318.318.762.468 1.2.448.438.02.882-.13 1.2-.448l8.85-8.85c.6-.6.6-1.65 0-2.25s-1.65-.6-2.25 0l-7.8 7.8zM8 4h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z",
    }),
  );

// ============================================
// 组件
// ============================================

/**
 * 字幕设置面板
 */
export const SubtitleMenu = defineComponent<
  SubtitleMenuProps,
  SubtitleMenuEvents
>((props, lifecycle) => {
  const state = useContext(StateContext);

  // ============================================
  // 初值
  // ============================================

  /** 语言列表：父层传入优先，为空时按参考 DOM 的 6 项原样渲染 */
  const languages: SubtitleLanguageOption[] =
    props.languages && props.languages.length > 0
      ? props.languages
      : DEFAULT_LANGUAGES;

  // ============================================
  // 响应式状态（渲染层唯一数据源；
  // props 仅作初值快照，运行时变化经状态订阅 / API 写入 signal）
  // ============================================

  /** 字幕开关（仅作初值快照） */
  const visibleSig = signal<boolean>(props.visible ?? false);

  /** 当前语言（仅作初值快照） */
  const langSig = signal<string>(props.lang ?? "");

  /**
   * 运行时字幕轨道列表（插件经 SUBTITLE_TRACKS_CHANGE 上报的统一注册表）
   * 空数组时语言区回退到配置语言列表
   * 初值读取状态管理器当前值：插件可能在菜单挂载前已广播过轨道
   */
  const tracksSig = signal<SubtitleTrackInfo[]>(
    state ? (state.get(PlayerStateKeyEnum.SUBTITLE_TRACKS) ?? []) : [],
  );

  /** 双语开关（仅作初值快照） */
  const bilingualSig = signal<boolean>(props.bilingual ?? false);

  /** 当前样式（缺字段回落到参考 DOM 的默认值；仅作初值快照） */
  const styleSig = signal<SubtitleStyle>({
    ...DEFAULT_STYLE,
    ...(props.style ?? {}),
  });

  /** 面板是否展开（根节点 state-show 类，由 hover 定时器驱动） */
  const showSig = signal<boolean>(false);

  /** 当前激活页：0 = 第 1 页（窄），1 = 第 2 页（宽，ui-area 加 state-show-right） */
  const pageSig = signal<0 | 1>(0);

  /**
   * 当前展开的下拉根节点类名（单值信号天然互斥，
   * 与原 closeAllSelects + 自身 toggle 的语义等价）
   */
  const unfoldSig = signal<string | null>(null);

  /** 滑条拖拽中的 mousemove 监听（销毁时移除） */
  let dragMoveHandler: ((event: MouseEvent) => void) | null = null;

  /** 滑条拖拽中的 mouseup 监听（销毁时移除） */
  let dragUpHandler: (() => void) | null = null;

  // ============================================
  // DOM 引用（几何测量 / 表单属性同步用，渲染数据一律走 signal）
  // ============================================

  /** 滑条轨道（几何测量数据源） */
  const sliderTrackRef = useTemplateRef<HTMLDivElement>(
    lifecycle,
    "subtitleSliderTrackRef",
  );

  /** 上方双语开关 input（display:none，与下方共用状态） */
  const bilingualAboveInputRef = useTemplateRef<HTMLInputElement>(
    lifecycle,
    "subtitleBilingualAboveInputRef",
  );

  /** 下方双语开关 input */
  const bilingualBottomInputRef = useTemplateRef<HTMLInputElement>(
    lifecycle,
    "subtitleBilingualBottomInputRef",
  );

  /** 等比缩放勾选框 input */
  const scaleInputRef = useTemplateRef<HTMLInputElement>(
    lifecycle,
    "subtitleScaleInputRef",
  );

  /** 淡入淡出勾选框 input */
  const fadeInputRef = useTemplateRef<HTMLInputElement>(
    lifecycle,
    "subtitleFadeInputRef",
  );

  /** 展开定时器 */
  let showTimer: AnimationFrameID | null = null;

  /** 收起定时器 */
  let hideTimer: AnimationFrameID | null = null;

  /** 取消两个方向的排队任务 */
  const clearTimers = (): void => {
    cancelRaf(showTimer!);
    cancelRaf(hideTimer!);
    showTimer = null;
    hideTimer = null;
  };

  useComponentUnmount(lifecycle, clearTimers);

  // ============================================
  // 工具
  // ============================================

  /**
   * 数值裁剪
   * @param value - 原值
   * @param min - 下界
   * @param max - 上界
   */
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

  /**
   * 下发样式补丁
   * @param patch - 只带变化字段的补丁
   */
  const emitStyle = (patch: SubtitleStylePatch): void => {
    lifecycle.emit?.("subtitleStyleChange", patch);
  };

  // ============================================
  // 下拉：当前值反查（纯函数，入参为样式对象；
  // 调用处位于响应式表达式内，读取 styleSig 建立依赖）
  // ============================================

  /**
   * 字幕大小 data-value（参考 DOM 初始为「适中」= 1）
   * @param style - 当前样式
   */
  const resolveFontSizeValue = (style: SubtitleStyle): string => {
    const size = style.fontSize;
    if (!(size > 0)) return "1";
    let hit = FONT_SIZE_OPTIONS[0];
    let diff = Number.POSITIVE_INFINITY;
    for (const option of FONT_SIZE_OPTIONS) {
      const current = Math.abs(Number(option.value) - size);
      if (current < diff) {
        diff = current;
        hit = option;
      }
    }
    return hit.value;
  };

  /**
   * 字幕颜色 data-value（按色块十六进制值反查）
   * @param style - 当前样式
   */
  const resolveColorValue = (style: SubtitleStyle): string => {
    const color = (style.color ?? "").toLowerCase();
    return (
      COLOR_OPTIONS.find((option) => option.swatch?.toLowerCase() === color)
        ?.value ?? "16777215"
    );
  };

  /**
   * 描边方式 data-value（按 strokeColor + strokeWidth 反查）
   * @param style - 当前样式
   */
  const resolveStrokeValue = (style: SubtitleStyle): string => {
    const color = (style.strokeColor ?? "").toLowerCase();
    const width = style.strokeWidth;
    return (
      STROKE_OPTIONS.find(
        (option) =>
          option.patch.strokeColor?.toLowerCase() === color &&
          option.patch.strokeWidth === width,
      )?.value ?? "0"
    );
  };

  /**
   * 默认位置 data-value（position + offset 反查）
   * @param style - 当前样式
   */
  const resolvePositionValue = (style: SubtitleStyle): string => {
    const side = style.position === "top" ? "top" : "bottom";
    const suffix =
      style.offset > 0 ? "right" : style.offset < 0 ? "left" : "center";
    return `${side}-${suffix}`;
  };

  // ============================================
  // 交互：字幕开关 / 语言 / 双语 / 样式
  //（API 与事件回调内部仅写 signal，选中态由渲染层自动同步）
  // ============================================

  /**
   * 设置字幕开关
   * @param next - 目标状态
   */
  const setVisible = (next: boolean): void => {
    if (visibleSig.value !== next) {
      visibleSig.value = next;
      lifecycle.emit?.("subtitleToggle", next);
    }
  };

  /**
   * 设置双语开关
   * @param next - 是否开启双语
   */
  const setBilingual = (next: boolean): void => {
    bilingualSig.value = next;
  };

  /**
   * 切换语言（选择语言即开启字幕，与参考 DOM「关闭 / 语言项」二选一的语义一致）
   * @param next - 目标语言
   */
  const setLang = (next: string): void => {
    langSig.value = next;
    if (!visibleSig.value) {
      visibleSig.value = true;
      lifecycle.emit?.("subtitleToggle", true);
    }
    lifecycle.emit?.("subtitleLangChange", next);
  };

  /**
   * 语言/轨道项点击（统一入口）
   * 轨道 id 作为「语言」标识经既有 subtitleLangChange 链路下发：
   * SubtitleMenu → RightControls → Controls → PlayerDocker → setSubtitleLang
   * → SUBTITLE_SWITCH，插件侧按 id 形态路由（file:* / remote:* / local-ai）
   * @param id - 语言标识或轨道 id
   */
  const handleLangClick = (id: string): void => {
    setLang(id);
  };

  /**
   * 双语开关变化（上 / 下两个开关共用）
   * @param event - change 事件
   */
  const handleBilingualChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    bilingualSig.value = target.checked;
    lifecycle.emit?.("bilingualChange", target.checked);
  };

  /** 「关闭」行点击：关闭字幕 */
  const handleCloseClick = (): void => {
    setVisible(false);
  };

  /**
   * 等比缩放勾选变化
   * @param event - change 事件
   */
  const handleScaleChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    styleSig.value = { ...styleSig.value, scale: target.checked };
    emitStyle({ scale: target.checked });
  };

  /**
   * 淡入淡出勾选变化
   * @param event - change 事件
   */
  const handleFadeChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    styleSig.value = { ...styleSig.value, fade: target.checked };
    emitStyle({ fade: target.checked });
  };

  /** 恢复默认设置（只重置样式项，不动开关与语言） */
  const handleReset = (): void => {
    styleSig.value = { ...DEFAULT_STYLE };
    emitStyle({
      fontSize: DEFAULT_STYLE.fontSize,
      color: DEFAULT_STYLE.color,
      position: DEFAULT_STYLE.position,
      offset: DEFAULT_STYLE.offset,
      strokeColor: DEFAULT_STYLE.strokeColor,
      strokeWidth: DEFAULT_STYLE.strokeWidth,
      opacity: DEFAULT_STYLE.opacity,
      scale: DEFAULT_STYLE.scale,
      fade: DEFAULT_STYLE.fade,
    });
  };

  // ============================================
  // 交互：下拉
  // ============================================

  /** 点击面板空白处收起所有下拉 */
  const handleMenuClick = (): void => {
    unfoldSig.value = null;
  };

  /**
   * 点击下拉头部：切换自身展开态（单值信号天然互斥，等价于
   * 原先「先收起其它下拉、再 toggle 自身」）
   * @param className - 下拉根节点类名
   * @param event - 点击事件
   */
  const handleSelectHeaderClick = (
    className: string,
    event: MouseEvent,
  ): void => {
    event.stopPropagation();
    unfoldSig.value = unfoldSig.value === className ? null : className;
  };

  /**
   * 点击下拉选项：收起下拉 → 更新样式信号（组内互斥高亮、
   * 结果文案与色块由渲染层读取 styleSig 自动同步）→ 下发补丁
   * @param item - 被点选项
   * @param event - 点击事件
   */
  const handleSelectItemClick = (
    item: SubtitleSelectOption,
    event: MouseEvent,
  ): void => {
    event.stopPropagation();
    unfoldSig.value = null;
    styleSig.value = { ...styleSig.value, ...item.patch };
    emitStyle(item.patch);
  };

  // ============================================
  // 交互：不透明度滑条
  // ============================================

  /**
   * 按鼠标横坐标设置不透明度（圆点中心跟随光标）
   * @param clientX - 鼠标视口横坐标
   */
  const setOpacityFromX = (clientX: number): void => {
    const track = sliderTrackRef.value;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const usable = rect.width - THUMB_SIZE;
    if (usable <= 0) return;
    const ratio = clamp((clientX - rect.left - THUMB_SIZE / 2) / usable, 0, 1);
    styleSig.value = { ...styleSig.value, opacity: ratio };
    emitStyle({ opacity: ratio });
  };

  /**
   * 按下滑条：立即定位并进入拖拽
   * @param event - 鼠标事件
   */
  const handleSliderMouseDown = (event: MouseEvent): void => {
    event.preventDefault();
    setOpacityFromX(event.clientX);

    const onMove = (moveEvent: MouseEvent): void =>
      setOpacityFromX(moveEvent.clientX);
    const onUp = (): void => {
      if (dragMoveHandler)
        document.removeEventListener("mousemove", dragMoveHandler);
      if (dragUpHandler) document.removeEventListener("mouseup", dragUpHandler);
      dragMoveHandler = null;
      dragUpHandler = null;
    };
    dragMoveHandler = onMove;
    dragUpHandler = onUp;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // ============================================
  // 交互：面板显隐 / 二级页
  // ============================================

  /** 回到第 1 页（移除 state-show-right，并把激活态收回第 1 页） */
  const showOriginPage = (): void => {
    pageSig.value = 0;
  };

  /** 鼠标进入按钮：下次打开固定从第 1 页（窄面板）开始，再延迟展开面板 */
  const handleMouseEnter = (): void => {
    showOriginPage();
    cancelRaf(hideTimer!);
    hideTimer = null;
    if (showTimer !== null) return;
    showTimer = rafTimeout(() => {
      showTimer = null;
      showSig.value = true;
    }, 120);
  };

  /** 鼠标离开按钮：延迟收起面板（面板是按钮的后代，指针在面板内不会触发本回调） */
  const handleMouseLeave = (): void => {
    cancelRaf(showTimer!);
    showTimer = null;
    if (hideTimer !== null) return;
    hideTimer = rafTimeout(() => {
      hideTimer = null;
      showSig.value = false;
    }, 220);
  };

  /** 点击「字幕设置」：滑出第 2 页（与 SettingMenu.handleMoreClick 同机制） */
  const handleSettingsEntry = (): void => {
    pageSig.value = 1;
  };

  // ============================================
  // 命令式同步（表单属性 / 几何测量，按迁移规范保留）
  // ============================================

  /**
   * 同步两个双语开关 input 的勾选状态
   * input.checked 是表单属性（setAttribute 只能设默认值），
   * 必须直接赋值 DOM property，故保留命令式 onEffect
   */
  onEffect(lifecycle, () => {
    const checked = bilingualSig.value;
    const above = bilingualAboveInputRef.value;
    const bottom = bilingualBottomInputRef.value;
    if (above) above.checked = checked;
    if (bottom) bottom.checked = checked;
  });

  /**
   * 同步「等比缩放 / 淡入淡出」两个勾选框
   * （初值回显 + 恢复默认时重置，同样属于表单属性命令式同步）
   */
  onEffect(lifecycle, () => {
    const style = styleSig.value;
    const scaleInput = scaleInputRef.value;
    if (scaleInput) scaleInput.checked = style.scale;
    const fadeInput = fadeInputRef.value;
    if (fadeInput) fadeInput.checked = style.fade;
  });

  /**
   * 刷新「背景不透明度」滑条圆点位置
   * 【已响应式化】原命令式实现依赖 getBoundingClientRect 测量轨道宽：
   * 第二页初始隐藏（display:none）→ 挂载时测得宽 0 → 圆点 translateX(0)；
   * 翻到第二页时 opacity 未变、effect 不重跑，圆点滞留最左侧（初始位置 bug）。
   * 现改为圆点节点响应式 style 表达式（left: calc(ratio × (100% - 12px))），
   * 与进度条 scaleX 同模式由编译器 __reactiveAttrs 原位更新，无测量无时序问题
   */

  // ============================================
  // 渲染片段
  // ============================================

  /**
   * 语言/轨道列表统一数据源
   * 插件上报轨道非空时优先展示轨道（含本地实时识别轨/服务端轨），
   * 否则回退配置语言列表（父层未传时为参考 DOM 的 6 项默认语言）
   * 读取 tracksSig → For 的 each getter 自动建立依赖，轨道变化时精准更新
   */
  const listItems = (): SubtitleListItem[] => {
    const tracks = tracksSig.value;
    if (tracks.length > 0) return tracks;
    return languages;
  };

  /**
   * 语言/轨道列表项（主 / 副字幕列表共用，data-lan 为语言标识或轨道 id）
   * 选中态 class 读取 visibleSig + langSig → __reactiveAttrs 自动更新
   * 本地实时识别轨追加「实时识别」徽标，状态点颜色由 status 类经 CSS 着色
   * @param item - 运行时轨道或配置语言项
   */
  const renderListItem = (item: SubtitleListItem): VNode => {
    const id = isTrackInfo(item) ? item.trackId : item.lang;
    // 子节点按条件装配（避免向 h() 传 null 子节点）
    const children: VNode[] = [
      h(
        "div",
        { class: "nova-player-ctrl-subtitle-language-item-text" },
        item.label,
      ),
    ];
    if (isTrackInfo(item) && item.isLive) {
      children.push(
        h(
          "span",
          {
            class: [
              "nova-player-ctrl-subtitle-live-badge",
              `nova-player-ctrl-subtitle-live-status-${item.status ?? "idle"}`,
            ],
          },
          t("player.ui.subtitle.live_badge"),
        ),
      );
    }
    children.push(
      h(
        "span",
        { class: "nova-player-ctrl-subtitle-language-item-icon" },
        SubtitleMarkIcon(),
      ),
    );
    return h(
      "div",
      {
        class: [
          "nova-player-ctrl-subtitle-language-item",
          {
            "nova-player-state-active": visibleSig.value && id === langSig.value,
          },
        ],
        "data-lan": id,
        onClick: () => handleLangClick(id),
      },
      ...children,
    );
  };

  /**
   * 双语字幕开关（参考 DOM 的 .bui-switch 结构，去掉 bui- 前缀改自写类名）
   * 勾选状态经 onEffect 命令式同步（表单属性）
   * @param variantClass - -bilingual-above / -bilingual-bottom
   * @param hidden - 是否按参考 DOM 隐藏（上方那个开关在参考 DOM 中 display:none）
   * @param refKey - input 元素引用键（onEffect 同步 checked 用）
   */
  const renderBilingualSwitch = (
    variantClass: string,
    hidden: boolean,
    refKey: string,
  ): VNode =>
    h(
      "div",
      {
        class: `${variantClass} nova-player-ctrl-subtitle-switch`,
        style: hidden ? { display: "none" } : undefined,
      },
      h(
        "div",
        { class: "nova-player-ctrl-subtitle-switch-area" },
        h("input", {
          class: "nova-player-ctrl-subtitle-switch-input",
          type: "checkbox",
          "aria-label": t("player.ui.subtitle.dual"),
          ref: refKey,
          onChange: handleBilingualChange,
        }),
        h(
          "label",
          { class: "nova-player-ctrl-subtitle-switch-label" },
          h(
            "span",
            { class: "nova-player-ctrl-subtitle-switch-name" },
            t("player.ui.subtitle.dual"),
          ),
          h(
            "span",
            { class: "nova-player-ctrl-subtitle-switch-body" },
            h(
              "span",
              { class: "nova-player-ctrl-subtitle-switch-dot" },
              h("span", {}),
            ),
          ),
        ),
      ),
    );

  /**
   * 自写下拉（参考 DOM 的 .bui-select 结构，去掉 bui- 前缀改自写类名）
   * 选中项高亮 / 结果文案 / 色块 / 展开态全部读取 styleSig + unfoldSig，
   * 由 __reactiveAttrs / _reactiveText 自动更新
   * @param options - 下拉渲染参数
   * @param options.className - 根节点附加类名（-fontsize-content 等）
   * @param options.resolveValue - 当前 data-value 反查函数（入参为样式对象）
   * @param options.items - 选项列表
   * @param options.withSwatch - 是否在结果区渲染 12px 色块（仅「字幕颜色」）
   */
  const renderSelect = (options: {
    className: string;
    resolveValue: (style: SubtitleStyle) => string;
    items: SubtitleSelectOption[];
    withSwatch: boolean;
  }): VNode => {
    /**
     * 按当前样式反查命中的选项
     * （读取 styleSig，仅在响应式表达式 / effect 内调用以建立依赖）
     */
    const hitOf = (): SubtitleSelectOption | undefined => {
      const value = options.resolveValue(styleSig.value);
      return (
        options.items.find((item) => item.value === value) ?? options.items[0]
      );
    };

    /** 选项行内的静态色块（每个选项的色值固定，不随选中态变化） */
    const swatchOf = (color?: string): VNode | null =>
      options.withSwatch
        ? h("span", { style: { background: color ?? "" } })
        : null;

    return h(
      "div",
      {
        class: [
          "nova-player-ctrl-subtitle-select",
          options.className,
          {
            "nova-player-state-unfold": unfoldSig.value === options.className,
          },
        ],
      },
      h(
        "div",
        { class: "nova-player-ctrl-subtitle-select-area" },
        h(
          "div",
          { class: "nova-player-ctrl-subtitle-select-wrap" },
          h(
            "div",
            { class: "nova-player-ctrl-subtitle-select-border" },
            h(
              "div",
              {
                class: "nova-player-ctrl-subtitle-select-header",
                onClick: (event: MouseEvent) =>
                  handleSelectHeaderClick(options.className, event),
              },
              h(
                "span",
                { class: "nova-player-ctrl-subtitle-select-result" },
                // 结果区色块：背景色随选中项联动（style 内调用 hitOf 读取
                // styleSig → __reactiveAttrs 自动更新）
                options.withSwatch
                  ? h("span", {
                      style: { background: hitOf()?.swatch ?? "" },
                    })
                  : null,
                // 结果区文案：显式 getter 协议（styleSig + localeSignal 双依赖）
                h("span", {}, () => {
                  const hit = hitOf();
                  return hit ? t(hit.label) : "";
                }),
              ),
              h(
                "span",
                { class: "nova-player-ctrl-subtitle-select-arrow" },
                h("span", {
                  class: "nova-player-ctrl-subtitle-select-arrow-down",
                }),
              ),
            ),
            h(
              "div",
              { class: "nova-player-ctrl-subtitle-select-list-wrap" },
              h(
                "ul",
                { class: "nova-player-ctrl-subtitle-select-list" },
                ...options.items.map((item) =>
                  h(
                    "li",
                    {
                      class: [
                        "nova-player-ctrl-subtitle-select-item",
                        {
                          "nova-player-state-active":
                            item.value ===
                            options.resolveValue(styleSig.value),
                        },
                      ],
                      "data-value": item.value,
                      onClick: (event: MouseEvent) =>
                        handleSelectItemClick(item, event),
                    },
                    swatchOf(item.swatch),
                    h("span", {}, t(item.label)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  };

  /**
   * 勾选行（等比缩放 / 淡入淡出，参考 DOM 的 .bui-checkbox 结构）
   * 勾选状态经 onEffect 命令式同步（表单属性）
   * @param variantClass - -scale / -fade
   * @param label - 勾选项文案
   * @param refKey - input 元素引用键（onEffect 同步 checked 用）
   * @param onChange - 变化回调
   */
  const renderCheckbox = (
    variantClass: string,
    label: string,
    refKey: string,
    onChange: (event: Event) => void,
  ): VNode =>
    h(
      "span",
      { class: `${variantClass} nova-player-ctrl-subtitle-checkbox` },
      h(
        "div",
        { class: "nova-player-ctrl-subtitle-checkbox-area" },
        h("input", {
          class: "nova-player-ctrl-subtitle-checkbox-input",
          type: "checkbox",
          "aria-label": label,
          ref: refKey,
          onChange,
        }),
        h(
          "label",
          { class: "nova-player-ctrl-subtitle-checkbox-label" },
          h(
            "span",
            {
              class:
                "nova-player-ctrl-subtitle-checkbox-icon nova-player-ctrl-subtitle-checkbox-icon-default",
            },
            CheckboxDefaultIcon(),
          ),
          h(
            "span",
            {
              class:
                "nova-player-ctrl-subtitle-checkbox-icon nova-player-ctrl-subtitle-checkbox-icon-selected",
            },
            CheckboxSelectedIcon(),
          ),
          h(
            "span",
            { class: "nova-player-ctrl-subtitle-checkbox-name" },
            label,
          ),
        ),
      ),
    );

  // ============================================
  // 状态订阅（外部变化写入 signal，渲染层自动同步）
  // ============================================

  if (state) {
    useState(
      state,
      PlayerStateKeyEnum.SUBTITLE_VISIBLE,
      (next) => {
        if (typeof next !== "boolean") return;
        visibleSig.value = next;
      },
      lifecycle,
    );

    useState(
      state,
      PlayerStateKeyEnum.SUBTITLE_LANG,
      (next) => {
        if (typeof next !== "string" || !next) return;
        langSig.value = next;
      },
      lifecycle,
    );

    // 轨道列表：插件上报的统一注册表（文件轨/服务端轨/本地识别轨）
    useState(
      state,
      PlayerStateKeyEnum.SUBTITLE_TRACKS,
      (next) => {
        if (!Array.isArray(next)) return;
        tracksSig.value = next;
      },
      lifecycle,
    );
  }

  // ============================================
  // 生命周期
  // ============================================

  lifecycle.onMounted = (): void => {
    // 初值同步已由 signal 初值 + 渲染层响应式覆盖（原 applyAll 移除）
    lifecycle.emit?.("subtitleMenuMounted", {
      setVisible,
      setBilingual,
      showOriginPage,
    } satisfies SubtitleMenuApi);
  };

  lifecycle.onBeforeDestroy = (): void => {
    if (dragMoveHandler)
      document.removeEventListener("mousemove", dragMoveHandler);
    if (dragUpHandler) document.removeEventListener("mouseup", dragUpHandler);
    dragMoveHandler = null;
    dragUpHandler = null;
  };

  // ============================================
  // 主渲染
  // ============================================

  return h(
    "div",
    {
      class: [
        "nova-player-ctrl-btn",
        "nova-player-ctrl-subtitle",
        { "state-show": showSig.value },
      ],
      // 未装 subtitle 插件时整个按钮（含设置面板）不显示：
      // style 表达式内调用 plugins getter，读取 signal.value 被
      // 编译器包装为 __reactiveAttrs 原位更新，插件运行中装卸时
      // 自动显隐；未传 plugins getter 时保持显示
      style: {
        display: (props.plugins?.().subtitle ?? true) ? "" : "none",
      },
      role: "button",
      "aria-label": t("player.ui.subtitle.label"),
      tabindex: "0",
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    },

    // ---------- 按钮结果区 ----------
    h(
      "div",
      { class: "nova-player-ctrl-subtitle-result-wrap" },
      h(
        "div",
        { class: "nova-player-ctrl-subtitle-result" },
        // 结果文案：字幕关闭时显示「字幕」，开启时显示当前语言名
        // （visibleSig + langSig + localeSignal 三依赖，显式 getter 协议）
        () => {
          const hit = languages.find((item) => item.lang === langSig.value);
          return visibleSig.value && hit
            ? hit.label
            : t("player.ui.subtitle.label");
        },
      ),
      // 标记图标仅在字幕开启时显示（参考 DOM 关闭态该图标为 display:none）
      h(
        "span",
        {
          class: "nova-player-ctrl-subtitle-result-icon",
          style: { display: visibleSig.value ? "" : "none" },
        },
        SubtitleMarkIcon(),
      ),
    ),

    // ---------- 面板 ----------
    h(
      "div",
      { class: "nova-player-ctrl-subtitle-box" },
      h(
        "div",
        {
          class: "nova-player-ctrl-subtitle-menu ui ui-panel ui-dark",
          onClick: handleMenuClick,
        },
        h(
          "div",
          // 第 2 页激活时 ui-area 滑出（state-show-right）
          {
            class: [
              "ui-area",
              { "state-show-right": pageSig.value === 1 },
            ],
          },
          h(
            "div",
            { class: "ui-panel-wrap" },
            h(
              "div",
              { class: "nova-player-ctrl-subtitle-panel-move" },

              // ================= 第 1 页（窄） =================
              h(
                "div",
                {
                  class: [
                    "nova-player-ctrl-subtitle-panel-item",
                    { "nova-player-state-active": pageSig.value === 0 },
                  ],
                },
                h(
                  "div",
                  { class: "nova-player-ctrl-subtitle-menu-left" },
                  h(
                    "div",
                    { class: "nova-player-ctrl-subtitle-menu-origin" },
                    h(
                      "div",
                      { class: "nova-player-ctrl-subtitle-title-area" },

                      // 标题行：字幕 / 添加字幕（参考 DOM 中「添加字幕」display:none）
                      h(
                        "div",
                        {
                          class:
                            "nova-player-ctrl-subtitle-add-wrap nova-player-ctrl-subtitle-item-flex",
                        },
                        h(
                          "div",
                          { class: "nova-player-ctrl-subtitle-title" },
                          t("player.ui.subtitle.label"),
                        ),
                        h(
                          "div",
                          {
                            class: "nova-player-ctrl-subtitle-add",
                            style: { display: "none" },
                          },
                          h("span", {}, t("player.ui.subtitle.add")),
                        ),
                      ),

                      // 关闭（选中态 = 字幕关闭时）
                      h(
                        "div",
                        {
                          class: [
                            "nova-player-ctrl-subtitle-close-switch",
                            { "nova-player-state-active": !visibleSig.value },
                          ],
                          "data-action": "close",
                          onClick: handleCloseClick,
                        },
                        t("player.ui.subtitle.off"),
                      ),

                      // 假开关（参考 DOM 中 display:none）
                      h(
                        "div",
                        {
                          class: "nova-player-ctrl-subtitle-fake-switch",
                          style: { display: "none" },
                        },
                        h(
                          "div",
                          {
                            class: "nova-player-ctrl-subtitle-fake-switch-text",
                          },
                          t("player.ui.subtitle.off"),
                        ),
                        h(
                          "span",
                          {
                            class: "nova-player-ctrl-subtitle-fake-switch-icon",
                          },
                          FakeSwitchIcon(),
                        ),
                      ),

                      // 上方分隔线 / 未登录提示 / 上方双语开关（参考 DOM 中均 display:none）
                      h("div", {
                        class: "nova-player-ctrl-subtitle-separator-above",
                        style: { display: "none" },
                      }),
                      h(
                        "div",
                        {
                          class: "nova-player-ctrl-subtitle-language-unlogin",
                          style: { display: "none" },
                        },
                        h(
                          "div",
                          {
                            class:
                              "nova-player-ctrl-subtitle-language-unlogin-content",
                          },
                          t("player.ui.subtitle.login_benefit"),
                        ),
                      ),
                      renderBilingualSwitch(
                        "nova-player-ctrl-subtitle-bilingual-above",
                        true,
                        "subtitleBilingualAboveInputRef",
                      ),

                      // 语言列表：主字幕（副字幕区块在参考 DOM 中 display:none）
                      h(
                        "div",
                        { class: "nova-player-ctrl-subtitle-language" },
                        h(
                          "div",
                          {
                            class: "nova-player-ctrl-subtitle-nolan",
                            style: { display: "none" },
                          },
                          t("player.ui.subtitle.none"),
                        ),
                        h(
                          "div",
                          {
                            class: "nova-player-ctrl-subtitle-major",
                            style: { width: "100%" },
                          },
                          h(
                            "div",
                            {
                              class: "nova-player-ctrl-subtitle-major-title",
                              style: { display: "none" },
                            },
                            t("player.ui.subtitle.major"),
                          ),
                          h(
                            "div",
                            {
                              class: "nova-player-ctrl-subtitle-major-content",
                            },
                            h(
                              "div",
                              {
                                class: "nova-player-ctrl-subtitle-major-inner",
                              },
                              // 语言/轨道列表（For：key-based 精准更新，
                              // tracksSig 变化时自动同步，替代静态展开）
                              h(For, {
                                each: listItems,
                                key: (item: unknown, index: number): string =>
                                  isTrackInfo(item)
                                    ? `${item.trackId}:${item.label}:${item.status ?? ""}`
                                    : isLangOption(item)
                                      ? item.lang
                                      : String(index),
                                render: (item: unknown): VNode =>
                                  isTrackInfo(item) || isLangOption(item)
                                    ? renderListItem(item)
                                    : h("div", {}),
                              }),
                            ),
                          ),
                        ),
                        h(
                          "div",
                          {
                            class: "nova-player-ctrl-subtitle-minor",
                            style: { display: "none" },
                          },
                          h(
                            "div",
                            { class: "nova-player-ctrl-subtitle-minor-title" },
                            t("player.ui.subtitle.secondary"),
                          ),
                          h(
                            "div",
                            {
                              class: "nova-player-ctrl-subtitle-minor-content",
                            },
                            h(
                              "div",
                              {
                                class: "nova-player-ctrl-subtitle-minor-inner",
                              },
                              // 语言/轨道列表（For：key-based 精准更新，
                              // tracksSig 变化时自动同步，替代静态展开）
                              h(For, {
                                each: listItems,
                                key: (item: unknown, index: number): string =>
                                  isTrackInfo(item)
                                    ? `${item.trackId}:${item.label}:${item.status ?? ""}`
                                    : isLangOption(item)
                                      ? item.lang
                                      : String(index),
                                render: (item: unknown): VNode =>
                                  isTrackInfo(item) || isLangOption(item)
                                    ? renderListItem(item)
                                    : h("div", {}),
                              }),
                            ),
                          ),
                        ),
                      ),

                      // 下方分隔线 / 双语字幕开关（参考 DOM 中可见的那个）/ 设置入口
                      h("div", {
                        class: "nova-player-ctrl-subtitle-separator-bottom",
                      }),
                      renderBilingualSwitch(
                        "nova-player-ctrl-subtitle-bilingual-bottom",
                        false,
                        "subtitleBilingualBottomInputRef",
                      ),
                      h(
                        "div",
                        {
                          class: "nova-player-ctrl-subtitle-setting",
                          onClick: handleSettingsEntry,
                        },
                        h(
                          "span",
                          { class: "nova-player-ctrl-subtitle-setting-text" },
                          t("player.ui.subtitle.settings"),
                        ),
                        h(
                          "span",
                          { class: "nova-player-ctrl-subtitle-setting-icon" },
                          ChevronRightIcon(),
                        ),
                      ),
                    ),
                  ),
                ),
              ),

              // ================= 第 2 页（更宽） =================
              h(
                "div",
                {
                  class: [
                    "nova-player-ctrl-subtitle-panel-item",
                    { "nova-player-state-active": pageSig.value === 1 },
                  ],
                },
                h(
                  "div",
                  { class: "nova-player-ctrl-subtitle-menu-right" },
                  h(
                    "div",
                    {
                      class: "nova-player-ctrl-subtitle-settings-content",
                    },
                    h(
                      "div",
                      { class: "nova-player-ctrl-subtitle-settings-scroller" },

                      // 字幕大小 / 字幕颜色
                      h(
                        "div",
                        {
                          class:
                            "nova-player-ctrl-subtitle-item nova-player-ctrl-subtitle-item-flex",
                        },
                        h(
                          "div",
                          { class: "nova-player-ctrl-subtitle-fontsize" },
                          h(
                            "div",
                            {
                              class: "nova-player-ctrl-subtitle-fontsize-title",
                            },
                            t("player.ui.subtitle.font_size"),
                          ),
                          renderSelect({
                            className: SELECT_CLASS.fontSize,
                            resolveValue: resolveFontSizeValue,
                            items: FONT_SIZE_OPTIONS,
                            withSwatch: false,
                          }),
                        ),
                        h(
                          "div",
                          { class: "nova-player-ctrl-subtitle-color" },
                          h(
                            "div",
                            { class: "nova-player-ctrl-subtitle-color-title" },
                            t("player.ui.subtitle.color"),
                          ),
                          renderSelect({
                            className: SELECT_CLASS.color,
                            resolveValue: resolveColorValue,
                            items: COLOR_OPTIONS,
                            withSwatch: true,
                          }),
                        ),
                      ),

                      // 描边方式 / 默认位置
                      h(
                        "div",
                        {
                          class:
                            "nova-player-ctrl-subtitle-item nova-player-ctrl-subtitle-item-flex",
                        },
                        h(
                          "div",
                          { class: "nova-player-ctrl-subtitle-shadow" },
                          h(
                            "div",
                            {
                              class: "nova-player-ctrl-subtitle-shadow-title",
                            },
                            t("player.ui.subtitle.stroke"),
                          ),
                          renderSelect({
                            className: SELECT_CLASS.stroke,
                            resolveValue: resolveStrokeValue,
                            items: STROKE_OPTIONS,
                            withSwatch: false,
                          }),
                        ),
                        h(
                          "div",
                          { class: "nova-player-ctrl-subtitle-position" },
                          h(
                            "div",
                            {
                              class: "nova-player-ctrl-subtitle-position-title",
                            },
                            t("player.ui.subtitle.position"),
                          ),
                          renderSelect({
                            className: SELECT_CLASS.position,
                            resolveValue: resolvePositionValue,
                            items: POSITION_OPTIONS,
                            withSwatch: false,
                          }),
                        ),
                      ),

                      // 背景不透明度
                      h(
                        "div",
                        {
                          class:
                            "nova-player-ctrl-subtitle-item nova-player-ctrl-subtitle-opacity",
                        },
                        h(
                          "div",
                          {
                            class: "nova-player-ctrl-subtitle-opacity-header",
                          },
                          h(
                            "div",
                            {
                              class: "nova-player-ctrl-subtitle-opacity-title",
                            },
                            t("player.ui.subtitle.opacity"),
                          ),
                          h(
                            "span",
                            {
                              class: "nova-player-ctrl-subtitle-opacity-percent",
                            },
                            // 百分比文案：显式 getter 协议（styleSig 依赖）
                            () =>
                              `${Math.round(clamp(styleSig.value.opacity, 0, 1) * 100)}%`,
                          ),
                        ),
                        h(
                          "div",
                          {
                            class:
                              "nova-player-ctrl-subtitle-opacity-content nova-player-ctrl-subtitle-slider",
                          },
                          h(
                            "div",
                            { class: "nova-player-ctrl-subtitle-slider-area" },
                            h(
                              "div",
                              {
                                class: "nova-player-ctrl-subtitle-slider-track",
                                ref: "subtitleSliderTrackRef",
                                onMouseDown: handleSliderMouseDown,
                              },
                              h(
                                "div",
                                {
                                  class:
                                    "nova-player-ctrl-subtitle-slider-bar-wrap",
                                },
                                h("div", {
                                  class: "nova-player-ctrl-subtitle-slider-bar",
                                  role: "progressbar",
                                  // 进度条填充比例：styleSig 依赖 → __reactiveAttrs
                                  style: {
                                    transform: `scaleX(${clamp(styleSig.value.opacity, 0, 1)})`,
                                  },
                                }),
                              ),
                              h(
                                "div",
                                {
                                  class:
                                    "nova-player-ctrl-subtitle-slider-thumb",
                                  // 圆点位置：纯响应式 CSS 定位（等价原实测公式
                                  // translateX(ratio × (轨道宽 - 12px))，
                                  // left 百分比相对轨道宽、12px 为圆点直径）。
                                  // style 表达式读 styleSig 依赖 →
                                  // __reactiveAttrs 原位更新；不依赖几何测量，
                                  // 第二页初始隐藏时也能按 opacity 正确定位，
                                  // 翻页后位置始终正确
                                  style: {
                                    left: `calc(${clamp(styleSig.value.opacity, 0, 1)} * (100% - ${THUMB_SIZE}px))`,
                                  },
                                },
                                h("div", {
                                  class:
                                    "nova-player-ctrl-subtitle-slider-thumb-dot",
                                }),
                              ),
                            ),
                          ),
                        ),
                      ),

                      // 其它设置：等比缩放 / 淡入淡出
                      h(
                        "div",
                        { class: "nova-player-ctrl-subtitle-other" },
                        h(
                          "div",
                          { class: "nova-player-ctrl-subtitle-other-title" },
                          t("player.ui.subtitle.other_settings"),
                        ),
                        h(
                          "div",
                          { class: "nova-player-ctrl-subtitle-other-content" },
                          renderCheckbox(
                            "nova-player-ctrl-subtitle-scale",
                            t("player.ui.subtitle.scale"),
                            "subtitleScaleInputRef",
                            handleScaleChange,
                          ),
                          renderCheckbox(
                            "nova-player-ctrl-subtitle-fade",
                            t("player.ui.subtitle.fade"),
                            "subtitleFadeInputRef",
                            handleFadeChange,
                          ),
                        ),
                      ),
                    ),
                  ),

                  // 底部：恢复默认设置
                  h(
                    "div",
                    { class: "nova-player-ctrl-subtitle-settings-footer" },
                    h("div", {
                      class: "nova-player-ctrl-subtitle-separator",
                    }),
                    h(
                      "div",
                      {
                        class:
                          "nova-player-ctrl-subtitle-reset nova-player-ctrl-subtitle-button",
                        onClick: handleReset,
                      },
                      h(
                        "div",
                        { class: "nova-player-ctrl-subtitle-button-area" },
                        h("span", {}, t("player.ui.subtitle.reset_default")),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
});
