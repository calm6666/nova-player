/**
 * ============================================
 * 工具提示组件
 * ============================================
 * 声明式响应式版本：提示项的显示位置与文本由内部 signal 驱动，
 * 渲染层零 DOM 操作（style 由编译器自动包装为 __reactiveAttrs，
 * 文本由 _reactiveText 精准更新）。
 *
 * 保留命令式的部分：
 * - openTip 内的 getBoundingClientRect 几何读取（布局测量，
 *   tooltip.scss 的 transition 仅作用于 transform/opacity，
 *   声明式持续设置 left/top 不会引入额外过渡动画）
 * - itemRefMap 的 DOM 引用（几何测量数据源）
 *
 * 对外保留 openTip/closeTip/updateTip/setScreen/hideAll
 * 命令式 API 契约不变；API 内部仅写 signal。
 */

import { h, defineComponent, signal, t } from "@/core";
import type { Signal } from "@/core";
import type { ComponentLifecycle } from "@/types";
import type { VNode } from "@/types";

/**
 * 提示项接口
 */
export interface TooltipItem {
  /** 名称标识，用于匹配和索引提示项 */
  name: string;
  /** 提示标题（静态字面量，外部自定义 items 使用；内置项改用 titleKey 走 i18n） */
  title?: string;
  /**
   * 提示标题的 i18n key
   * 渲染时经 t(titleKey) 求值（在响应式文本 getter 内读取 localeSignal），
   * 语言切换时自动重新翻译。
   */
  titleKey?: string;
}

/**
 * 工具提示组件 Props 接口
 */
export interface TooltipsProps {
  /** 屏幕模式：普通、全屏、网页全屏 */
  screen?: "normal" | "full" | "web";
  /** 提示项数组，定义所有可显示的工具提示 */
  items?: TooltipItem[];
  /** 当前显示的提示名称，为 null 时表示没有激活的提示（仅作初值快照） */
  activeName?: string | null;
  /** 提示项位置信息映射表，键为提示名称，值为坐标（仅作初值快照） */
  positions?: Record<string, { left: number; top: number }>;
}

/**
 * 默认提示项列表，包含播放器各按钮的默认提示文本
 *
 * 全部使用 i18n key（titleKey），文案见 core/locales/{zh-CN,en-US}.json；
 * 动态态（宽屏进入/退出、网页全屏、画中画、全屏）由 PlayerDocker 通过
 * updateTipKey 在状态变化时切换 key。
 */
const DEFAULT_TOOLTIP_ITEMS: TooltipItem[] = [
  { name: "ctrl:codec:0", titleKey: "player.ui.tooltip.codec.default" },
  { name: "ctrl:codec:1", titleKey: "player.ui.tooltip.codec.av1" },
  { name: "ctrl:codec:2", titleKey: "player.ui.tooltip.codec.hevc" },
  { name: "ctrl:codec:3", titleKey: "player.ui.tooltip.codec.avc" },
  { name: "danmaku_switch", titleKey: "player.ui.tooltip.danmaku_switch.close" },
  { name: "preventshade", titleKey: "player.ui.tooltip.preventshade" },
  { name: "special-more", titleKey: "player.ui.tooltip.special_more" },
  { name: "feedback-btn", titleKey: "player.ui.tooltip.feedback" },
  { name: "ctrl:playbackrate", titleKey: "player.ui.controls.playbackRate" },
  { name: "ctrl:widescreen", titleKey: "player.ui.tooltip.widescreen.enter" },
  { name: "ctrl:webscreen", titleKey: "player.ui.tooltip.webscreen.enter" },
  { name: "ctrl:pip", titleKey: "player.ui.tooltip.pip.enter" },
  { name: "ctrl:fullscreen", titleKey: "player.ui.tooltip.fullscreen.enter" },
  { name: "ctrl:prev", titleKey: "player.ui.tooltip.prev" },
  { name: "ctrl:next", titleKey: "player.ui.tooltip.next" },
];

/**
 * 未激活时的默认偏移（反馈按钮向上偏移，其余向下偏移，
 * 与既有实现 hideTooltip / getItemStyle 的回落值一致）
 * @param name - 提示项名称
 */
const defaultTransformOf = (name: string): string =>
  name === "feedback-btn" ? "translate(0px, -5px)" : "translate(0px, 5px)";

/**
 * 工具提示组件
 */
export const Tooltips = defineComponent<TooltipsProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 响应式状态（渲染层唯一数据源）
    // ============================================

    /**
     * 当前显示中的提示项位置映射表
     * 表中存在某项 = 该提示可见（visibility/opacity/transform 进入显示态，
     * left/top 取表内坐标）；表中不存在 = 隐藏态（默认偏移 + 不可见）。
     * 与原实现逐项独立 show/hide 的语义严格一致（多项可同时显示）
     */
    const activePositionsSig = signal<
      Record<string, { left: number; top: number }>
    >({});

    /**
     * 提示项文本覆盖表（updateTip 写入，优先于 title/titleKey）
     */
    const titlesSig = signal<Record<string, string>>({});

    /**
     * 提示项 i18n key 覆盖表（updateTipKey 写入）
     * 与 titlesSig 分开：key 在渲染 getter 内经 t(key) 求值，
     * 语言切换时随 localeSignal 自动重新翻译（无需重新 updateTip）。
     */
    const titleKeysSig = signal<Record<string, string>>({});

    // ============================================
    // DOM 引用（几何测量数据源，保留）
    // ============================================

    /**
     * 提示项元素引用映射表
     * 通过 name 索引每个提示项的 DOM 元素引用（openTip 测量尺寸用）
     */
    const itemRefMap: Record<string, Signal<HTMLDivElement | null>> = {};

    /** 提示项数组，未传入时使用默认提示项 */
    const items = props.items ?? DEFAULT_TOOLTIP_ITEMS;

    /**
     * 当前屏幕模式（对应既有实现 Tooltips.screen 字段）：
     * 全屏 / 网页全屏下提示框显示在按钮上方更远处（32px vs 23px），
     * 由 PlayerDocker 在显示模式 / 全屏状态变化时通过 setScreen 同步。
     * 仅在 openTip 几何计算时读取（非渲染数据），保留普通变量
     */
    let screen: "normal" | "full" | "web" = props.screen ?? "normal";

    /**
     * 更新屏幕模式（对应既有实现的 tooltips.screen 赋值）
     */
    const setScreen = (next: "normal" | "full" | "web"): void => {
      screen = next;
    };

    /**
     * 按 name 获取提示项 DOM 元素
     */
    const getTipElement = (name: string): HTMLDivElement | null => {
      return itemRefMap[name]?.value ?? null;
    };

    /**
     * 计算提示框显示位置（与既有实现的
     * calculateTipPosition 一致，坐标系为视口坐标，样式为 position: fixed）
     * @param btnElement - 触发提示的按钮元素
     * @param tipElement - 提示项元素
     * @param name - 提示项名称（决定上下偏移规则）
     */
    const calculateTipPosition = (
      btnElement: HTMLElement,
      tipElement: HTMLElement,
      name: string,
    ): { left: number; top: number } => {
      const tipClient = tipElement.getBoundingClientRect();
      const btnClient = btnElement.getBoundingClientRect();
      /** 水平方向：提示框中心对齐按钮中心 */
      let left = btnClient.left - (tipClient.width / 2 - btnClient.width / 2);
      let top = 0;

      if (name === "feedback-btn") {
        // 反馈按钮在顶栏，提示显示在按钮下方
        top = btnClient.top + btnClient.height + 10;
      } else if (name === "danmaku_switch") {
        // 弹幕开关提示显示在按钮上方 8px
        top = btnClient.top - 8 - tipClient.height;
      } else {
        // 其余按钮：全屏 / 网页全屏下偏移更大
        top =
          screen === "full" || screen === "web"
            ? btnClient.top - 32 - tipClient.height
            : btnClient.top - 23 - tipClient.height;
      }

      // 水平方向夹紧到播放器容器内（左右各留 12px）
      const container = tipElement.closest<HTMLElement>(
        ".nova-player-container",
      );
      if (container) {
        const containerLeft = container.getBoundingClientRect().left;
        const containerWidth = container.getBoundingClientRect().width;
        if (containerLeft >= left || left <= 12) {
          left = containerLeft + 12;
        } else if (containerLeft + containerWidth <= left + tipClient.width) {
          left = containerLeft + containerWidth - 12 - tipClient.width;
        }
      }

      return { left, top };
    };

    // ============================================
    // DOM 更新方法（对外 API——内部仅写 signal）
    // ============================================

    /**
     * 显示指定名称的提示项，设置其位置和可见性
     * @param name - 提示项名称
     * @param position - 目标位置（视口坐标）
     */
    const showTooltip = (
      name: string,
      position: { left: number; top: number },
    ): void => {
      activePositionsSig.value = {
        ...activePositionsSig.value,
        [name]: position,
      };
    };

    /**
     * 隐藏指定名称的提示项，恢复默认偏移和不可见状态
     * @param name - 提示项名称
     */
    const hideTooltip = (name: string): void => {
      if (!(name in activePositionsSig.value)) return;
      const next = { ...activePositionsSig.value };
      delete next[name];
      activePositionsSig.value = next;
    };

    /**
     * 打开指定名称的提示项（与既有实现的 openTip 一致）：
     * 依据按钮元素实时计算位置后显示
     * （getBoundingClientRect 布局测量保留命令式——读取操作不修改 DOM）
     * @param btnElement - 触发提示的按钮元素
     * @param name - 提示项名称（Tooltip.dataName）
     */
    const openTip = (btnElement: HTMLElement | null, name: string): void => {
      const tipElement = getTipElement(name);
      if (tipElement && btnElement) {
        const { left, top } = calculateTipPosition(
          btnElement,
          tipElement,
          name,
        );
        showTooltip(name, { left: Math.floor(left), top: Math.floor(top) });
      }
    };

    /**
     * 关闭指定名称的提示项（与既有实现的 closeTip 一致）
     */
    const closeTip = (name: string): void => {
      hideTooltip(name);
    };

    /**
     * 更新提示项文本内容（与既有实现的 updateTip 一致）
     * 写入覆盖表，渲染层 getter 优先读取覆盖文本
     * @param name - 提示项名称
     * @param text - 新的提示文本
     */
    const updateTip = (name: string, text: string): void => {
      titlesSig.value = { ...titlesSig.value, [name]: text };
    };

    /**
     * 以 i18n key 更新提示项文本（状态动态提示用）
     *
     * 与 updateTip 的区别：不固化翻译结果，渲染时调用 t(key)，
     * 语言切换（setLocale）后提示文案自动跟随。
     * @param name - 提示项名称
     * @param key - i18n key
     */
    const updateTipKey = (name: string, key: string): void => {
      titleKeysSig.value = { ...titleKeysSig.value, [name]: key };
    };

    /**
     * 隐藏所有提示项
     */
    const hideAll = (): void => {
      activePositionsSig.value = {};
    };

    // ============================================
    // 渲染
    // ============================================

    /**
     * 渲染所有提示项
     *
     * style 内读取 activePositionsSig.value：编译期提取到 __reactiveAttrs，
     * mount 时注册 effect，信号变化（openTip/closeTip/hideAll）时自动
     * 重新应用对应提示项的 transform/visibility/opacity/left/top。
     * 标题文本使用显式 getter 协议（titlesSig），updateTip 精准更新文本节点。
     */
    const renderTooltipItems = (): VNode[] => {
      return items.map((item: TooltipItem) => {
        /** 当前提示项的 DOM 元素引用（每个 item 独立 Signal，不能用 useTemplateRef 去重 key） */
        const refObj = signal<HTMLDivElement | null>(null);
        itemRefMap[item.name] = refObj;

        return h(
          "div",
          {
            class: "nova-player-tooltip-item",
            "data-name": item.name,
            style: {
              // 显示态：平移归零；隐藏态：默认偏移（CSS transition 仅作用于
              // transform/opacity，未激活项持续设置 left/top 不会产生动画）
              transform: activePositionsSig.value[item.name]
                ? "translate(0px, 0px)"
                : defaultTransformOf(item.name),
              visibility: activePositionsSig.value[item.name]
                ? "visible"
                : "hidden",
              opacity: activePositionsSig.value[item.name] ? "1" : "0",
              left: `${activePositionsSig.value[item.name]?.left ?? 0}px`,
              top: `${activePositionsSig.value[item.name]?.top ?? 0}px`,
            },
            ref: refObj,
          },
          h(
            "div",
            { class: "nova-player-tooltip-title" },
            () => {
              // 优先级：updateTip 字面量 > updateTipKey / item.titleKey（i18n）> item.title
              const override = titlesSig.value[item.name];
              if (override !== undefined) return override;
              const key =
                titleKeysSig.value[item.name] ?? item.titleKey;
              if (key !== undefined) return t(key);
              return item.title ?? item.name;
            },
          ),
        );
      });
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    /**
     * 组件挂载后，向上层暴露打开、关闭、更新提示与同步屏幕模式的方法
     * （对应既有实现的 showTooltip / hideTooltip 及
     * handleFullscreenChange / toggleWebFullscreen 中的 screen 与 updateTip 调用）
     */
    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("tooltipsMounted", {
        openTip,
        closeTip,
        updateTip,
        updateTipKey,
        setScreen,
        hideAll,
      });
    };

    /**
     * 组件销毁前，清空所有 DOM 引用
     */
    lifecycle.onBeforeDestroy = (): void => {};

    return h(
      "div",
      { class: "nova-player-tooltip-area" },
      ...renderTooltipItems(),
    );
  },
);
