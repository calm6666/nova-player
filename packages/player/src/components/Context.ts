/**
 * ============================================
 * 右键菜单组件 (Context)
 * ============================================
 * 声明式响应式版本：菜单位置与可见性由内部 signal 驱动
 * （表中存在坐标 = 显示态，与 Tooltips 组件同款模式），
 * 渲染层零 DOM 操作（class/style 由编译器包装为 __reactiveAttrs）。
 * CSS 过渡仅作用于 opacity，声明式持续设置 left/top 不会引入额外动画。
 *
 * 菜单项来源：
 * - 内置项：复制链接 / 色彩 / 快捷键 / 版本 / 统计
 * - 插件项：插件通过 player.registerMenuItem 注册，按 position 与内置项合并
 *
 * 对外保留 showMenu/hideMenu 命令式 API 契约不变
 * （父组件经 contextMounted 持有引用，零改动）；
 * API 内部仅写 signal；document click 关闭监听保留命令式（时序行为）。
 */

import { h, defineComponent, signal, For, t } from '@lumina/framework/core';
import { isBrowser } from '@lumina/framework/utils';
import type { VNode, ComponentLifecycle } from "@lumina/framework/types";
import type { UiMenuRegistration, UiRegistry } from "../core/uiRegistry";

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
  /** 菜单项列表（显式传入时不再合并内置项与插件项） */
  menuItems?: ContextMenuItem[];
  /** 插件 UI 注册表：合并插件注册的菜单项 */
  registry?: UiRegistry;
  /** 播放器版本号 */
  version?: string;
  /** 菜单点击回调 */
  onMenuClick?: (action: string) => void;
  /** 关闭菜单回调 */
  onClose?: () => void;
  /** 是否加载了音效插件（决定是否显示「音效调节」菜单项） */
  audioEnabled?: boolean | (() => boolean);
  /** 打开面板回调（色彩调整、音效调节、快捷键说明、视频统计信息） */
  onOpenPanel?: (panel: "color" | "audio" | "keyboard" | "info") => void;
}

/** 渲染用菜单项 */
interface MenuModelItem {
  key: string;
  text: string;
  action?: string;
  onSelect?: () => void;
  isVersion?: boolean;
}

/** 内置菜单项与位置 */
const BUILTIN_MENU: Array<{
  id: string;
  position: number;
  action: string;
  text: string;
}> = [
  { id: "copyLink", position: 10, action: "copyLink", text: "复制视频地址（精准空降）" },
  { id: "keyboard", position: 30, action: "keyboard", text: "快捷键说明" },
  { id: "version", position: 40, action: "version", text: "播放器版本" },
  { id: "info", position: 50, action: "info", text: "视频统计信息" },
];

/**
 * 右键菜单组件
 */
export const Context = defineComponent<ContextProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 状态数据
    // ============================================

    /** 播放器版本号，未传入时默认为 1.0.0 */
    const version = props.version || "1.0.0";

    /** 插件菜单注册项 */
    const pluginMenusSignal = signal<UiMenuRegistration[]>([]);
    let offMenus: (() => void) | null = null;

    /**
     * 当前菜单位置
     * 非 null = 显示态（active 类 + 定位到坐标）；null = 隐藏态
     */
    const positionSig = signal<ContextOffset | null>(null);

    /** 合并内置项 + 插件项，按 position 排序（同位置保持注册先后） */
    const buildMenuModel = (): MenuModelItem[] => {
      if (props.menuItems) {
        return props.menuItems.map((item, index) => ({
          key: `explicit:${index}`,
          text: item.text,
          action: item.dataAction,
          isVersion: item.dataAction === "version",
        }));
      }

      const entries: Array<{
        position: number;
        seq: number;
        item: MenuModelItem;
      }> = [];

      BUILTIN_MENU.forEach((item, index) => {
        entries.push({
          position: item.position,
          seq: index,
          item: {
            key: item.id,
            text: item.text,
            action: item.action,
            isVersion: item.action === "version",
          },
        });
      });

      pluginMenusSignal.value.forEach((item, index) => {
        if (item.visible !== undefined && !item.visible()) return;
        entries.push({
          position: item.position,
          seq: 1000 + index,
          item: {
            key: item.id,
            text: item.labelKey ? t(item.labelKey) : (item.label ?? ""),
            action: item.dataAction,
            onSelect: item.onSelect,
          },
        });
      });

      entries.sort((a, b) => a.position - b.position || a.seq - b.seq);
      return entries.map((entry) => entry.item);
    };

    const menuModelSignal = signal<MenuModelItem[]>(buildMenuModel());

    const refreshMenu = (): void => {
      menuModelSignal.value = buildMenuModel();
    };

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
     * 处理内置动作
     * @param dataAction - 动作标识
     */
    const runAction = (dataAction: string): void => {
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
          break;
        case "info":
          props.onOpenPanel?.("info");
          lifecycle.emit?.("openPanel", "info");
          break;
      }
    };

    /** 点击菜单项：插件项走自定义回调，内置项走动作分发 */
    const clickMenu = (item: MenuModelItem): void => {
      if (item.onSelect) item.onSelect();
      else if (item.action) runAction(item.action);
      hideMenu();
    };

    // ============================================
    // 渲染函数
    // ============================================

    const renderMenuItems = (): ReturnType<typeof h> =>
      h(For, {
        each: (): MenuModelItem[] => menuModelSignal.value,
        key: (item: unknown): string =>
          typeof item === "object" && item !== null && "key" in item
            ? String((item as MenuModelItem).key)
            : "menu-item",
        render: (raw: unknown): VNode => {
          const item = raw as MenuModelItem;
          return h(
            "li",
            {
              "data-action": item.action,
              onClick: (): void => clickMenu(item),
            },
            item.isVersion ? `${item.text} ${version}` : item.text,
          );
        },
      });

    // ============================================
    // 生命周期
    // ============================================

    lifecycle.onMounted = (): void => {
      if (props.registry) {
        pluginMenusSignal.value = props.registry.listMenus();
        refreshMenu();
        offMenus = props.registry.subscribeMenus(() => {
          pluginMenusSignal.value = props.registry!.listMenus();
          refreshMenu();
        });
      }
      lifecycle.emit?.("contextMounted", { showMenu, hideMenu });
    };

    lifecycle.onBeforeDestroy = (): void => {
      offMenus?.();
      offMenus = null;
      document.removeEventListener("click", hideMenu);
    };

    // ============================================
    // 组件渲染
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
        renderMenuItems(),
      ),
    );
  },
);
