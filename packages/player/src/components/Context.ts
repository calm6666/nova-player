/**
 * ============================================
 * 右键菜单组件 (Context)
 * ============================================
 * 声明式响应式版本：菜单位置与可见性由内部 signal 驱动
 * （表中存在坐标 = 显示态，与 Tooltips 组件同款模式），
 * 渲染层零 DOM 操作（class/style 由编译器包装为 __reactiveAttrs）。
 * CSS 过渡仅作用于 opacity，声明式持续设置 left/top 不会引入额外动画。
 *
 * 对外保留 showMenu/hideMenu 命令式 API 契约不变
 * （父组件经 contextMounted 持有引用，零改动）；
 * API 内部仅写 signal；document click 关闭监听保留命令式（时序行为）。
 */

import { h, defineComponent, signal, t } from "@/core";
import { isBrowser } from "@/utils";
import type { VNode, ComponentLifecycle } from "@/types";

/**
 * 菜单项配置
 */
export interface ContextMenuItem {
  /** 动作标识 */
  dataAction: string;
  /** 显示文本 */
  text: string;
}

/**
 * 菜单位置
 */
export interface ContextOffset {
  /** 左边距（像素） */
  left: number;
  /** 上边距（像素） */
  top: number;
}

/**
 * Context 组件 Props 接口
 */
export interface ContextProps {
  /** 菜单项列表 */
  menuItems?: ContextMenuItem[];
  /** 播放器版本号 */
  version?: string;
  /** 菜单点击回调 */
  onMenuClick?: (action: string) => void;
  /** 关闭菜单回调 */
  onClose?: () => void;
  /** 是否加载了音效插件（决定是否显示「音效调节」菜单项） */
  audioEnabled?: boolean;
  /** 打开面板回调（色彩调整、音效调节、快捷键说明、视频统计信息） */
  onOpenPanel?: (panel: "color" | "audio" | "keyboard" | "info") => void;
}

/**
 * 默认菜单项
 */
const DEFAULT_MENU_ITEMS: ContextMenuItem[] = [
  { dataAction: "copyLink", text: "复制视频地址（精准空降）" },
  { dataAction: "color", text: "视频色彩调整" },
  { dataAction: "keyboard", text: "快捷键说明" },
  { dataAction: "version", text: "播放器版本 1.0.0" },
  { dataAction: "info", text: "视频统计信息" },
];

/**
 * 右键菜单组件
 */
export const Context = defineComponent<ContextProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 状态数据
    // ============================================

    /** 实际使用的菜单项列表，未传入时使用默认菜单项；音效项按插件状态插入 */
    const menuItems = props.menuItems || [
      ...DEFAULT_MENU_ITEMS.slice(0, 2),
      ...(props.audioEnabled
        ? [{ dataAction: "audio", text: t("player.ui.audio.title") }]
        : []),
      ...DEFAULT_MENU_ITEMS.slice(2),
    ];
    /** 播放器版本号，未传入时默认为 1.0.0 */
    const version = props.version || "1.0.0";

    // ============================================
    // 响应式状态（渲染层唯一数据源）
    // ============================================

    /**
     * 当前菜单位置
     * 非 null = 显示态（active 类 + 定位到坐标）；null = 隐藏态
     * （原实现 classList.add/remove("nova-player-active") 的语义一致化）
     */
    const positionSig = signal<ContextOffset | null>(null);

    // ============================================
    // 方法
    // ============================================

    /**
     * 在指定坐标显示右键菜单
     * @param x - 左边距（像素）
     * @param y - 上边距（像素）
     */
    const showMenu = (x: number, y: number): void => {
      if (!isBrowser()) return;
      positionSig.value = { left: x, top: y };
      document.addEventListener("click", hideMenu);
    };

    /**
     * 隐藏右键菜单并触发关闭回调
     */
    const hideMenu = (): void => {
      positionSig.value = null;
      props.onClose?.();
      lifecycle.emit?.("hideMenu");
      document.removeEventListener("click", hideMenu);
    };

    /**
     * 处理菜单项点击，根据动作标识执行对应操作
     * @param dataAction - 动作标识
     */
    const clickMenu = (dataAction: string): void => {
      props.onMenuClick?.(dataAction);
      lifecycle.emit?.("menuClick", dataAction);

      switch (dataAction) {
        case "copyLink":
          if (isBrowser() && navigator.clipboard) {
            navigator.clipboard.writeText(document.URL);
          }
          break;
        case "color":
          props.onOpenPanel?.("color");
          lifecycle.emit?.("openPanel", "color");
          break;
        case "audio":
          props.onOpenPanel?.("audio");
          lifecycle.emit?.("openPanel", "audio");
          break;
        case "keyboard":
          props.onOpenPanel?.("keyboard");
          lifecycle.emit?.("openPanel", "keyboard");
          break;
        case "version":
          // 版本信息无需特殊处理
          break;
        case "info":
          props.onOpenPanel?.("info");
          lifecycle.emit?.("openPanel", "info");
          break;
      }
      hideMenu();
    };

    // ============================================
    // 渲染函数
    // ============================================

    /**
     * 渲染菜单项列表
     * @returns 菜单项 VNode 数组
     */
    const renderMenuItems = (): VNode[] => {
      return menuItems.map((item) =>
        h(
          "li",
          {
            "data-action": item.dataAction,
            onClick: () => clickMenu(item.dataAction),
          },
          item.dataAction === "version" ? `${item.text} ${version}` : item.text,
        ),
      );
    };

    // ============================================
    // 生命周期
    // ============================================

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("contextMounted", { showMenu, hideMenu });
    };

    lifecycle.onBeforeDestroy = (): void => {
      document.removeEventListener("click", hideMenu);
    };

    // ============================================
    // 组件渲染
    // （class/style 内读取 positionSig → __reactiveAttrs，
    //   showMenu/hideMenu 写信号时精准更新）
    // ============================================
    return h(
      "div",
      { class: "nova-player-context-area" },
      h(
        "ul",
        {
          class: [
            "nova-player-contextmenu",
            "nova-player-black",
            { "nova-player-active": positionSig.value !== null },
          ],
          style: positionSig.value
            ? {
                left: `${positionSig.value.left}px`,
                top: `${positionSig.value.top}px`,
              }
            : undefined,
        },
        ...renderMenuItems(),
      ),
    );
  },
);
