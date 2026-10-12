/**
 * ============================================
 * 弹幕设置面板组件 (DmSetting)
 * ============================================
 * 结构与 `CicadaPlayerNext/platform/danmusetting.txt` 逐条对应
 * （bpx-nova-player-* → nova-player-*，bui-* → ui-*）。外层
 * `.nova-player-dm-setting-wrap > .nova-player-dm-setting-box.ui.ui-panel.ui-dark` 由 SendBar 提供，
 * 本组件从 `.ui-area` 起渲染左右两块：
 *   左：按类型过滤 / 弹幕随屏幕缩放·防挡字幕·智能防挡弹幕 / 屏蔽词 /
 *       显示区域·不透明度·弹幕字号·弹幕速度 / 高级设置
 *   右：更多弹幕设置（返回）/ 速度同步 / 弹幕字体 / 粗体 / 描边类型 / 恢复默认设置
 *
 * 响应式迁移：
 *   - 字体下拉结果文案（fontResultRef.textContent）从命令式改为 signal + _reactiveText
 *   - 字体下拉列表显隐（fontListRef.style.display）从命令式改为 signal + onEffect
 *   - 按类型过滤多选 / 弹幕密度互斥高亮从点击内 classList 命令式改为 signal 驱动 class
 *   - 二级页切换由 pageIndexSignal 一站式驱动（页签 active 类 / 外框与面板根尺寸 /
 *     move 位移全部为派生绑定，过渡由 .ui-panel-wrap / .ui-area 上的 CSS transition 承担）
 *   - 保留命令式：Slider/Checkbox 组件 API 调用（sliderApis.*）、
 *     弹幕设置初始值从运行时状态推送给 Slider API
 */

import {
  h,
  defineComponent,
  useContext,
  useTemplateRef,
  signal,
  onEffect,
  For,
  t,
} from "@/core";
import type { VNode } from "@/types";
import { Slider } from "@/nova/components/Slider";
import { Checkbox } from "@/nova/components/Checkbox";
import { ArrowLeft, ArrowRight } from "@/nova/components/icons";
import {
  StateContext,
  PlayerStateKeyEnum,
  type PlayerStateMap,
} from "@/store/runtimeState";
import type { TypedStateManager } from "@/core/state";

/** 弹幕速度滑杆值（0-100）到速度倍率的映射：0 → 0.5，50 → 1.0，100 → 1.5 */
const speedSliderToMultiplier = (value: number): number => 0.5 + value / 100;

/**
 * 弹幕字体下拉项（对应参考 bui-select-list 的 8 个 data-value）
 * label 存 i18n key（字体名为专有名词，en-US 语言包保留同样文字），
 * 渲染时经 t() 取文案，避免模块加载期 t() 在 initI18n 之前执行取错语言
 */
const FONT_FAMILIES: Array<{ label: string; value: string }> = [
  {
    label: "player.ui.dmsetting.font.simhei",
    value: "SimHei, 'Microsoft JhengHei'",
  },
  { label: "player.ui.dmsetting.font.simsun", value: "SimSun" },
  { label: "player.ui.dmsetting.font.newsimsun", value: "NSimSun" },
  { label: "player.ui.dmsetting.font.fangsong", value: "FangSong" },
  { label: "player.ui.dmsetting.font.msyh", value: "'Microsoft YaHei'" },
  {
    label: "player.ui.dmsetting.font.msyh_light",
    value: "'Microsoft Yahei UI Light'",
  },
  {
    label: "player.ui.dmsetting.font.noto_demi",
    value: "'Noto Sans CJK SC DemiLight'",
  },
  {
    label: "player.ui.dmsetting.font.noto_regular",
    value: "'Noto Sans CJK SC Regular'",
  },
];

export interface DmSettingProps {}

export interface DmSettingApi {
  setOpacity: (value: number) => void;
  setArea: (value: number) => void;
  setFontsize: (value: number) => void;
  setSpeed: (value: number) => void;
  resetPage: () => void;
}

export type DmSettingEvents = {
  dmSettingMounted: DmSettingApi;
};

/** 显示区域滑杆的档位标记 */
const AREA_MARKS = [
  { value: 0, name: "0%" },
  { value: 25, name: "25%" },
  { value: 50, name: "50%" },
  { value: 75, name: "75%" },
  { value: 100, name: "100%" },
];

/** 第一页（弹幕设置主面板）尺寸，px */
const DM_PAGE_MAIN = { width: 320, height: 322 };
/** 第二页（更多弹幕设置）尺寸，px */
const DM_PAGE_MORE = { width: 266, height: 250 };

/**
 * 弹幕速度滑杆的档位标记
 * 工厂函数：t() 需在组件实例化（initI18n 之后）调用，模块加载期调用会取错语言
 */
const getSpeedMarks = (): Array<{ value: number; name: string }> => [
  { value: 0, name: t("player.ui.dmsetting.speed.slowest") },
  { value: 25, name: t("player.ui.dmsetting.speed.slower") },
  { value: 50, name: t("player.ui.dmsetting.speed.medium") },
  { value: 75, name: t("player.ui.dmsetting.speed.faster") },
  { value: 100, name: t("player.ui.dmsetting.speed.fastest") },
];

/**
 * 字体选项类型谓词
 * For 控制流的 render/key 回调入参为 unknown，
 * 按项目规范用类型谓词替代 as 断言收窄类型
 */
const isFontOption = (
  item: unknown,
): item is { label: string; value: string } =>
  typeof item === "object" &&
  item !== null &&
  "label" in item &&
  "value" in item;

/** 按类型过滤的四个图标路径（来自参考 DOM 的 svg path） */
const FILTER_ICONS: Record<string, string[]> = {
  typeScroll: [
    "M23 3H5a4 4 0 0 0-4 4v14a4 4 0 0 0 4 4h18a4 4 0 0 0 4-4V7a4 4 0 0 0-4-4zM11 9h6a1 1 0 0 1 0 2h-6a1 1 0 0 1 0-2zm-3 2H6V9h2v2zm4 4h-2v-2h2v2zm9 0h-6a1 1 0 0 1 0-2h6a1 1 0 0 1 0 2z",
  ],
  typeTopBottom: [
    "M23 3H5a4 4 0 0 0-4 4v14a4 4 0 0 0 4 4h18a4 4 0 0 0 4-4V7a4 4 0 0 0-4-4zM9 9H7V7h2v2zm4 0h-2V7h2v2zm4 0h-2V7h2v2zm4 0h-2V7h2v2z",
  ],
  typeColor: [
    "M17.365 11.118c0-.612-.535-1.147-1.147-1.147s-1.147.535-1.147 1.147c0 .611.535 1.147 1.147 1.147s1.147-.536 1.147-1.147zM12.93 9.665c-.764 0-1.376.611-1.376 1.3 0 .689.612 1.301 1.376 1.301s1.376-.612 1.376-1.301-.612-1.3-1.376-1.3zM9.794 11.883c-.764 0-1.376.612-1.376 1.3 0 .689.612 1.3 1.376 1.3s1.376-.611 1.376-1.3c.001-.688-.611-1.3-1.376-1.3zM10.023 15.171c-.612 0-1.147.536-1.147 1.148 0 .611.535 1.146 1.147 1.146s1.147-.535 1.147-1.146c.001-.612-.535-1.148-1.147-1.148zM17.823 12.953c-.611 0-1.147.535-1.147 1.147s.536 1.147 1.147 1.147c.612 0 1.148-.535 1.148-1.147s-.536-1.147-1.148-1.147z",
    "M23.177 3H4.824C2.683 3 1 4.833 1 7.167v13.665C1 23.167 2.683 25 4.824 25h18.353C25.318 25 27 23.167 27 20.833V7.167C27 4.833 25.318 3 23.177 3zm-3.442 13.624c-1.987.612-4.129-.154-5.046.764-.918.918 1.529 1.606 0 2.219-1.988.84-7.341-.535-8.182-4.053-.841-3.441 2.905-6.5 5.888-7.035 2.906-.535 6.041.841 8.181 2.982 2.065 2.141.765 4.74-.841 5.123z",
  ],
  typeSpecial: [
    "M23 3H5a4 4 0 0 0-4 4v14a4 4 0 0 0 4 4h18a4 4 0 0 0 4-4V7a4 4 0 0 0-4-4zM7.849 11.669l.447-.828.492.782.894.184-.536.736.134.966-.85-.321-.804.414.045-.967L7 11.946l.849-.277zm3.352 7.101-1.43-.506L8.43 19v-1.565L7.357 16.33l1.43-.506.67-1.381.894 1.289 1.475.23-.894 1.289.269 1.519zm7.95-3.9-2.816-.69-2.458 1.565-.223-2.946-2.145-1.933 2.637-1.151L15.263 7l1.877 2.255 2.86.23-1.52 2.531.671 2.854z",
  ],
};

export const DmSetting = defineComponent<DmSettingProps, DmSettingEvents>(
  (_props, lifecycle) => {
    const stateMgr = useContext<TypedStateManager<PlayerStateMap> | null>(
      StateContext,
    );

    const fontListRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "dmFontListRef",
    );

    /**
     * 响应式信号：当前页下标（0 弹幕设置主面板 / 1 更多弹幕设置）
     * 一站式驱动翻页三联动（替代旧的 switchPanelPage 命令式工具与 pageBox 量测回退）：
     *   - 页签 ui-panel-item-active 类（响应式 class）
     *   - 面板根 .ui-area 与外框 .ui-panel-wrap 的宽高跟随当前页（响应式 style，
     *     对应旧 resizeArea 语义，过渡由 CSS transition 承担）
     *   - .ui-panel-move 的 translateX 位移（响应式 style）
     */
    const pageIndexSignal = signal<number>(0);

    const sliderApis: {
      area?: (value: number) => void;
      opacity?: (value: number) => void;
      fontsize?: (value: number) => void;
      speed?: (value: number) => void;
    } = {};

    /**
     * 响应式信号：字体下拉选中项文案
     * 替代旧的 fontResultRef.value.textContent = label 命令式操作
     * 存 i18n key，VNode 内写 t(fontResultSignal.value)，编译器自动包装为 _reactiveText，
     * 信号或语言变化时自动更新 Text 节点
     */
    const fontResultSignal = signal<string>(
      FONT_FAMILIES[0]?.label ?? "player.ui.dmsetting.font.simhei",
    );

    /**
     * 响应式信号：字体下拉选中项 value
     * 替代旧的 handleFontPick 内 forEach + classList.add/remove('ui-select-item-active') 命令式操作
     * VNode 内用 class: ['ui-select-item', { 'ui-select-item-active': fontValueSignal.value === font.value }] 自动同步
     */
    const fontValueSignal = signal<string>(FONT_FAMILIES[0]?.value ?? "");

    /**
     * 响应式信号：描边类型选中项（存 i18n key，与选项 label 比较互斥高亮）
     * 替代旧的 fontborder radio onClick 内 forEach + classList.add/remove('active') 命令式操作
     * VNode 内用 class: ['radio-button', { active: strokeTypeSignal.value === item.label }] 自动同步
     */
    const strokeTypeSignal = signal<string>("player.ui.dmsetting.stroke.heavy");

    /**
     * 响应式信号：字体下拉列表展开态
     * 替代旧的 fontListRef.value.style.display = ... 命令式操作
     * onEffect 内读取 signal.value 自动追踪，信号变化时自动更新 style.display
     */
    const fontListOpenSignal = signal<boolean>(false);

    const handleAreaChange = (value: number): void => {
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_AREA, value);
    };

    const handleOpacityChange = (value: number): void => {
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_OPACITY, value / 100);
    };

    const handleFontsizeChange = (value: number): void => {
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_FONT_SIZE, value);
    };

    const handleSpeedChange = (value: number): void => {
      stateMgr?.set(
        PlayerStateKeyEnum.DANMAKU_SPEED,
        speedSliderToMultiplier(value),
      );
    };

    const handleScaleChange = (checked: boolean): void => {
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_SCALE_WITH_SCREEN, checked);
    };

    /**
     * 响应式信号：按类型过滤的选中类型集合（多选，纯本地视觉状态）
     * 驱动各过滤项的 selected 类（__reactiveAttrs），
     * 替代旧的 handleFilterTypeClick 内 classList.toggle 命令式操作
     */
    const filterSelectedSignal = signal<Set<string>>(new Set());

    /**
     * 按类型过滤项点击：写信号切换选中态（DOM 类名自动同步）
     * @param type - 过滤类型标识
     */
    const toggleFilterType = (type: string): void => {
      const next = new Set(filterSelectedSignal.value);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      filterSelectedSignal.value = next;
    };

    /**
     * 左右面板切换：写页码信号即可（页签类名 / 外框与面板根尺寸 / 位移由响应式系统自动同步，
     * 过渡由 .ui-panel-wrap / .ui-panel-move / .ui-area 上的 CSS transition 承担）
     * @param show - true 显示右侧「更多弹幕设置」
     */
    const toggleRight = (show: boolean): void => {
      pageIndexSignal.value = show ? 1 : 0;
    };

    /** 复位到第一页（面板关闭时调用，下次打开即第一页） */
    const resetPage = (): void => {
      toggleRight(false);
    };

    /**
     * 切换弹幕字体下拉的展开态
     * 通过更新信号驱动 onEffect 更新 style.display（响应式）
     * @param open - 是否展开；缺省时切换当前态
     */
    const toggleFontList = (open?: boolean): void => {
      fontListOpenSignal.value = open ?? !fontListOpenSignal.value;
    };

    /**
     * 字体下拉列表显隐响应式同步
     * onEffect 内读取 fontListOpenSignal.value 自动追踪，信号变化时自动更新 style.display
     */
    onEffect(lifecycle, () => {
      const isOpen = fontListOpenSignal.value;
      const list = fontListRef.value;
      if (list) list.style.display = isOpen ? "block" : "none";
    });

    /**
     * 选择弹幕字体
     * 响应式：更新 fontValueSignal（驱动列表项互斥高亮 class）+ fontResultSignal（存 i18n key，驱动结果文案 _reactiveText）
     * 替代旧的 forEach + classList.add/remove('ui-select-item-active') 命令式操作
     * @param font - 字体选项（label 为 i18n key + value）
     */
    const handleFontPick = (font: { label: string; value: string }): void => {
      fontValueSignal.value = font.value;
      fontResultSignal.value = font.label;
      toggleFontList(false);
    };

    const handleReset = (): void => {
      sliderApis.area?.(50);
      sliderApis.opacity?.(100);
      sliderApis.fontsize?.(50);
      sliderApis.speed?.(50);
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_AREA, 50);
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_OPACITY, 1);
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_FONT_SIZE, 50);
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_SPEED, 1);
    };

    /** 渲染「按类型过滤」的四个图标项 */
    const renderFilterTypes = (): VNode[] => {
      const types = [
        { type: "typeScroll", label: t("player.ui.dmsetting.filter.scroll") },
        { type: "typeTopBottom", label: t("player.ui.dmsetting.filter.fix") },
        { type: "typeColor", label: t("player.ui.dmsetting.filter.color") },
        {
          type: "typeSpecial",
          label: t("player.ui.dmsetting.filter.advanced"),
        },
      ];

      return types.map((item) =>
        h(
          "div",
          {
            // 选中态类名由 filterSelectedSignal 响应式驱动（__reactiveAttrs + normalizeClass）
            class: [
              "nova-player-block-filter-type",
              `nova-player-block-${item.type}`,
              {
                "nova-player-block-filter-type-selected":
                  filterSelectedSignal.value.has(item.type),
              },
            ],
            "data-type": item.type,
            onClick: () => toggleFilterType(item.type),
          },
          h(
            "span",
            { class: "nova-player-block-filter-image" },
            h(
              "svg",
              {
                xmlns: "http://www.w3.org/2000/svg",
                "xml:space": "preserve",
                "data-pointer": "none",
                style: "enable-background:new 0 0 28 28",
                viewBox: "0 0 28 28",
              },
              ...FILTER_ICONS[item.type].map((path) =>
                h("path", {
                  d: path,
                }),
              ),
            ),
          ),
          h(
            "span",
            { class: "nova-player-block-filter-label" },
            h("span", {}, item.label),
            ...(item.type === "typeSpecial"
              ? [
                  h(
                    "span",
                    { class: "nova-player-block-advanced-more" },
                    h(
                      "svg",
                      {
                        xmlns: "http://www.w3.org/2000/svg",
                        fill: "none",
                        "data-pointer": "none",
                        viewBox: "0 0 14 14",
                      },
                      h("path", {
                        fill: "#9499A0",
                        d: "M7 2.041a4.958 4.958 0 1 0 0 9.917A4.958 4.958 0 0 0 7 2.04ZM1.167 7a5.833 5.833 0 1 1 11.666 0A5.833 5.833 0 0 1 1.166 7Z",
                      }),
                      h("path", {
                        fill: "#9499A0",
                        d: "M7.51 9.296a.51.51 0 1 1-1.02 0 .51.51 0 0 1 1.02 0ZM7 5.177a.73.73 0 0 0-.729.729.437.437 0 1 1-.875 0 1.604 1.604 0 0 1 3.208 0 1.5 1.5 0 0 1-.36.991c-.096.118-.202.22-.297.307l-.081.074c-.067.061-.127.116-.187.177-.147.146-.199.25-.22.31a.5.5 0 0 0-.021.182.437.437 0 1 1-.875 0c0-.118.006-.284.07-.469.071-.206.204-.42.427-.642a6.966 6.966 0 0 1 .293-.274c.089-.083.159-.151.216-.22a.629.629 0 0 0 .16-.436.73.73 0 0 0-.729-.73Z",
                      }),
                    ),
                  ),
                ]
              : []),
          ),
        ),
      );
    };

    /**
     * 弹幕密度选项（参考 DOM 中隐藏，初始选中 normal）
     * 以类型注解替代 as 断言；t() 在 setup 顶层调用安全
     * （initI18n 在组件 setup 之前执行）
     */
    const densityOptions: Array<{
      density: string;
      label: string;
      active?: boolean;
    }> = [
      {
        density: "normal",
        label: t("player.ui.dmsetting.density.normal"),
        active: true,
      },
      { density: "more", label: t("player.ui.dmsetting.density.more") },
      { density: "most", label: t("player.ui.dmsetting.density.overlap") },
    ];

    /**
     * 响应式信号：弹幕密度选中值（互斥单选，纯本地视觉状态）
     * 初值取 densityOptions 中标记 active 的项，
     * 驱动各密度项的 active 类（__reactiveAttrs），
     * 替代旧的 handleDensityClick 内 querySelectorAll + classList 命令式互斥
     */
    const densityValueSignal = signal<string>(
      densityOptions.find((option) => option.active === true)?.density ??
        "normal",
    );

    /**
     * 弹幕密度项点击：写信号即可（组内互斥由响应式系统自动同步）
     * @param density - 密度标识
     */
    const handleDensityPick = (density: string): void => {
      densityValueSignal.value = density;
    };

    /** 渲染一个滑杆行（标题 + 内容 + Slider） */
    const renderSliderRow = (
      cls: string,
      title: string,
      options: {
        value: number;
        step?: number;
        marks?: Array<{ value: number; name: string }>;
        onChange: (value: number) => void;
        onMounted: (api: { setValue: (value: number) => void }) => void;
      },
    ): VNode =>
      h(
        "div",
        { class: `${cls} ui ui-progress` },
        h("div", { class: `${cls}-title` }, title),
        h(
          "div",
          { class: `${cls}-content` },
          h("div", {
            class: `nova-player-dm-setting-ui-${cls.split("-").pop()}`,
          }),
        ),
        h(Slider, {
          value: options.value,
          step: options.step,
          marks: options.marks,
          onChange: options.onChange,
          onSliderMounted: options.onMounted,
        }),
      );

    lifecycle.onMounted = (): void => {
      if (stateMgr) {
        const area = stateMgr.get(PlayerStateKeyEnum.DANMAKU_AREA) ?? 75;
        const opacity =
          (stateMgr.get(PlayerStateKeyEnum.DANMAKU_OPACITY) ?? 1) * 100;
        const fontsize =
          stateMgr.get(PlayerStateKeyEnum.DANMAKU_FONT_SIZE) ?? 50;
        const speed =
          ((stateMgr.get(PlayerStateKeyEnum.DANMAKU_SPEED) ?? 1) - 0.5) * 100;
        sliderApis.area?.(area);
        sliderApis.opacity?.(opacity);
        sliderApis.fontsize?.(fontsize);
        sliderApis.speed?.(speed);
      }
      lifecycle.emit?.("dmSettingMounted", {
        setOpacity: (value: number) => sliderApis.opacity?.(value),
        setArea: (value: number) => sliderApis.area?.(value),
        setFontsize: (value: number) => sliderApis.fontsize?.(value),
        setSpeed: (value: number) => sliderApis.speed?.(value),
        resetPage,
      } satisfies DmSettingApi);
    };

    return h(
      "div",
      {
        class: "ui-area",
        // 面板根尺寸跟随当前页（原 resizeArea 语义，响应式 style 派生，
        // 过渡由 .ui-area 上的 CSS transition 承担）
        style: {
          width: `${(pageIndexSignal.value === 0 ? DM_PAGE_MAIN : DM_PAGE_MORE).width}px`,
          height: `${(pageIndexSignal.value === 0 ? DM_PAGE_MAIN : DM_PAGE_MORE).height}px`,
        },
      },
      h(
        "div",
        {
          class: "ui-panel-wrap",
          // 外框尺寸跟随当前页（响应式 style 派生，过渡由 CSS transition 承担）
          style: {
            width: `${(pageIndexSignal.value === 0 ? DM_PAGE_MAIN : DM_PAGE_MORE).width}px`,
            height: `${(pageIndexSignal.value === 0 ? DM_PAGE_MAIN : DM_PAGE_MORE).height}px`,
          },
        },
        h(
          "div",
          {
            class: "ui-panel-move",
            // 位移由 pageIndexSignal 派生：第二页时左移一页宽（过渡由 CSS transition 承担）
            style: {
              width: `${DM_PAGE_MAIN.width + DM_PAGE_MORE.width}px`,
              transform: `translateX(${pageIndexSignal.value === 0 ? 0 : -DM_PAGE_MAIN.width}px)`,
            },
          },
          // ===== 左：弹幕设置主面板 =====
          h(
            "div",
            {
              // 第一页页签 active 类由 pageIndexSignal 响应式驱动
              class: [
                "ui-panel-item",
                { "ui-panel-item-active": pageIndexSignal.value === 0 },
              ],
              style: {
                width: `${DM_PAGE_MAIN.width}px`,
                height: `${DM_PAGE_MAIN.height}px`,
              },
            },
            h(
              "div",
              { class: "nova-player-dm-setting-left" },
              // 按类型过滤
              h(
                "div",
                { class: "nova-player-dm-setting-left-block" },
                h(
                  "div",
                  { class: "nova-player-dm-setting-left-block-title" },
                  t("player.ui.dmsetting.filter_type"),
                ),
                h(
                  "div",
                  { class: "nova-player-dm-setting-left-block-content" },
                  ...renderFilterTypes(),
                ),
              ),
              // 三个复选框
              h(
                "div",
                { class: "nova-player-dm-setting-left-radio" },
                h(
                  "span",
                  { class: "nova-player-dm-setting-left-fs" },
                  h(Checkbox, {
                    checked:
                      stateMgr?.get(
                        PlayerStateKeyEnum.DANMAKU_SCALE_WITH_SCREEN,
                      ) ?? true,
                    label: t("player.ui.dmsetting.scale_with_screen"),
                    onChange: handleScaleChange,
                  }),
                ),
                h(
                  "span",
                  {
                    class: "nova-player-dm-setting-left-ps",
                    "data-text": t("player.ui.dmsetting.reserve_area"),
                  },
                  h(Checkbox, {
                    label: t("player.ui.dmsetting.prevent_shade"),
                  }),
                ),
                h(
                  "span",
                  { class: "nova-player-dm-setting-left-mask" },
                  h(Checkbox, {
                    label: t("player.ui.dmsetting.smart_mask"),
                    checked: true,
                  }),
                ),
              ),
              // 防挡字幕保留区示意
              h(
                "div",
                { class: "nova-player-dm-setting-left-preventshade" },
                h("span", {
                  class: "nova-player-dm-setting-left-preventshade-box",
                  "data-text": t("player.ui.dmsetting.reserve_area"),
                  "data-position": "top-left",
                }),
              ),
              h(
                "div",
                {
                  class: "nova-player-dm-setting-left-danmaku-mask",
                  style: { display: "none" },
                },
                h("span", {
                  class: "nova-player-dm-setting-left-danmaku-mask-box",
                }),
              ),
              // 屏蔽词
              h(
                "div",
                { class: "nova-player-dm-setting-left-block-word" },
                h(
                  "div",
                  {
                    class: "nova-player-dm-setting-left-block-add",
                  },
                  t("player.ui.dmsetting.block_words"),
                ),
                h(
                  "div",
                  {
                    class: "nova-player-dm-setting-left-block-sync",
                  },
                  t("player.ui.dmsetting.sync_block_list"),
                ),
              ),
              // 显示区域
              renderSliderRow(
                "nova-player-dm-setting-left-area",
                t("player.ui.dmsetting.area"),
                {
                  // 初始值与运行时状态默认值保持一致（75%），挂载后由 onMounted 推送真实值
                  value: 75,
                  // 带 dot 档位滑块：档位吸附由 Slider 的 marks 逻辑接管（步长即相邻档位间距）
                  marks: AREA_MARKS,
                  onChange: handleAreaChange,
                  onMounted: (api) => {
                    sliderApis.area = api.setValue;
                  },
                },
              ),
              // 弹幕密度（参考中隐藏）
              h(
                "div",
                {
                  class: "nova-player-dm-setting-left-dmDensity",
                  style: { display: "none" },
                },
                h(
                  "div",
                  { class: "nova-player-dm-setting-left-dmDensity-left-area" },
                  t("player.ui.dmsetting.density"),
                ),
                h(
                  "div",
                  { class: "nova-player-dm-setting-left-dmDensity-right-area" },
                  ...densityOptions.map((item) =>
                    h(
                      "span",
                      {
                        // 选中态类名由 densityValueSignal 响应式驱动（__reactiveAttrs + normalizeClass）
                        class: [
                          "nova-player-dm-setting-density",
                          { active: densityValueSignal.value === item.density },
                        ],
                        "data-density": item.density,
                        onClick: () => handleDensityPick(item.density),
                      },
                      item.label,
                    ),
                  ),
                ),
              ),
              // 不透明度
              renderSliderRow(
                "nova-player-dm-setting-left-opacity",
                t("player.ui.dmsetting.opacity"),
                {
                  value: 100,
                  onChange: handleOpacityChange,
                  onMounted: (api) => {
                    sliderApis.opacity = api.setValue;
                  },
                },
              ),
              // 弹幕字号
              renderSliderRow(
                "nova-player-dm-setting-left-fontsize",
                t("player.ui.dmsetting.fontsize"),
                {
                  value: 50,
                  onChange: handleFontsizeChange,
                  onMounted: (api) => {
                    sliderApis.fontsize = api.setValue;
                  },
                },
              ),
              // 弹幕速度
              renderSliderRow(
                "nova-player-dm-setting-left-speedplus",
                t("player.ui.dmsetting.speed"),
                {
                  value: 50,
                  // 带 dot 档位滑块：档位吸附由 Slider 的 marks 逻辑接管（步长即相邻档位间距）
                  marks: getSpeedMarks(),
                  onChange: handleSpeedChange,
                  onMounted: (api) => {
                    sliderApis.speed = api.setValue;
                  },
                },
              ),
              // 高级设置
              h(
                "div",
                {
                  class: "nova-player-dm-setting-left-more",
                  onClick: () => toggleRight(true),
                },
                h(
                  "span",
                  { class: "nova-player-dm-setting-left-more-text" },
                  t("player.ui.dmsetting.advanced"),
                ),
                h(
                  "span",
                  { class: "nova-player-dm-setting-left-more-senior-text" },
                  t("player.ui.dmsetting.hardcore_member"),
                ),
                h("span", { class: "common-svg-icon" }, ArrowRight()),
              ),
            ),
          ),
          // ===== 右：更多弹幕设置 =====
          h(
            "div",
            {
              // 第二页页签 active 类由 pageIndexSignal 响应式驱动
              class: [
                "ui-panel-item",
                { "ui-panel-item-active": pageIndexSignal.value === 1 },
              ],
              style: {
                width: `${DM_PAGE_MORE.width}px`,
                height: `${DM_PAGE_MORE.height}px`,
              },
            },
            h(
              "div",
              { class: "nova-player-dm-setting-right" },
              h(
                "div",
                {
                  class: "nova-player-dm-setting-right-more",
                  onClick: () => toggleRight(false),
                },
                h("span", { class: "common-svg-icon" }, ArrowLeft()),
                h(
                  "span",
                  { class: "nova-player-dm-setting-right-more-text" },
                  t("player.ui.dmsetting.more"),
                ),
              ),
              h("div", { class: "nova-player-dm-setting-right-separator" }),
              h(
                "div",
                { class: "nova-player-dm-setting-right-speedsync" },
                h(
                  "span",
                  { class: "nova-player-dm-setting-right-speedsync-box" },
                  h(Checkbox, {
                    label: t("player.ui.dmsetting.speed_sync"),
                  }),
                ),
              ),
              h(
                "div",
                { class: "nova-player-dm-setting-right-font" },
                h(
                  "div",
                  { class: "nova-player-dm-setting-right-font-title" },
                  t("player.ui.dmsetting.font"),
                ),
                h(
                  "div",
                  { class: "nova-player-dm-setting-right-font-content" },
                  h(
                    "div",
                    {
                      class:
                        "nova-player-dm-setting-right-font-content-fontfamily ui ui-select ui-dark",
                    },
                    h(
                      "div",
                      { class: "ui-select-wrap" },
                      h(
                        "div",
                        { class: "ui-select-border" },
                        h(
                          "div",
                          {
                            class: "ui-select-header",
                            onClick: () => toggleFontList(),
                          },
                          h(
                            "span",
                            {
                              class: "ui-select-result",
                            },
                            // _reactiveText 创建响应式 Text 节点：
                            // 编译器自动检测 t() 调用包装为 _reactiveText，
                            // fontResultSignal（存 i18n key）或语言变化时自动更新 textContent
                            t(fontResultSignal.value),
                          ),
                          h(
                            "span",
                            { class: "ui-select-arrow" },
                            h("span", { class: "ui-select-arrow-down" }),
                          ),
                        ),
                        h(
                          "div",
                          {
                            class: "ui-select-list-wrap",
                            ref: "dmFontListRef",
                            style: { display: "none" },
                          },
                          h(
                            "ul",
                            { class: "ui-select-list" },
                            // For 组件：key-based 精准更新，每个字体项只渲染一次
                            // 选中态由响应式 class（fontValueSignal.value 自动驱动）自动同步，无需 forEach + classList.toggle
                            h(For, {
                              each: FONT_FAMILIES,
                              key: (item: unknown, _index: number) =>
                                isFontOption(item) ? item.value : "",
                              render: (item: unknown, _index: number) => {
                                if (!isFontOption(item)) return h("li", {});
                                return h(
                                  "li",
                                  {
                                    class: [
                                      "ui-select-item",
                                      {
                                        "ui-select-item-active":
                                          fontValueSignal.value === item.value,
                                      },
                                    ],
                                    "data-value": item.value,
                                    onClick: () => handleFontPick(item),
                                  },
                                  t(item.label),
                                );
                              },
                            }),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                h(
                  "div",
                  { class: "nova-player-dm-setting-right-font-bold" },
                  h(
                    "span",
                    { class: "nova-player-dm-setting-right-font-bold-box" },
                    h(Checkbox, {
                      label: t("player.ui.dmsetting.bold"),
                    }),
                  ),
                ),
              ),
              h(
                "div",
                { class: "nova-player-dm-setting-right-fontborder" },
                h(
                  "div",
                  { class: "nova-player-dm-setting-right-fontborder-title" },
                  t("player.ui.dmsetting.stroke_type"),
                ),
                h(
                  "div",
                  {
                    class:
                      "nova-player-dm-setting-right-fontborder-content ui ui-radio ui-dark",
                  },
                  h(
                    "div",
                    { class: "nova-player-radio-wrap-button" },
                    ...[
                      { label: "player.ui.dmsetting.stroke.heavy" },
                      { label: "player.ui.dmsetting.stroke.outline" },
                      { label: "player.ui.dmsetting.stroke.projection" },
                    ].map((item) =>
                      h(
                        "div",
                        {
                          // 响应式 class：strokeTypeSignal.value（i18n key）自动驱动 active 互斥高亮
                          // 替代旧的 forEach + classList.add/remove('active') 命令式操作
                          class: [
                            "radio-button",
                            { active: strokeTypeSignal.value === item.label },
                          ],
                          onClick: () => {
                            strokeTypeSignal.value = item.label;
                          },
                        },
                        h("span", {}, t(item.label)),
                      ),
                    ),
                  ),
                ),
              ),
              h("div", { class: "nova-player-dm-setting-right-separator" }),
              h(
                "div",
                {
                  class: "nova-player-dm-setting-right-reset ui ui-button",
                  onClick: handleReset,
                },
                h(
                  "div",
                  { class: "ui-area ui-button-transparent" },
                  h("span", {}, t("player.ui.dmsetting.reset_default")),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  },
);
