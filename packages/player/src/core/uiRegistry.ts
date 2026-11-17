/**
 * 插件 UI 注册表
 *
 * 插件通过播放器注册右键菜单项与面板，播放器只负责排序、挂载区域和
 * 生命周期回收；菜单文案、面板内容与业务状态由插件自己持有。
 */

/** 右键菜单注册项 */
export interface UiMenuRegistration {
  /** 唯一 id */
  id: string;
  /** 来源插件名，卸载时批量回收 */
  plugin?: string;
  /** 排列位置，小的在前；同位置按注册先后 */
  position: number;
  /** 文案 */
  label?: string;
  /** 文案 i18n key */
  labelKey?: string;
  /** 内置动作标识（沿用 Context 现有动作分发） */
  dataAction?: string;
  /** 自定义点击回调（插件菜单项使用） */
  onSelect?: () => void;
  /** 运行时显隐条件 */
  visible?: () => boolean;
}

/** 面板挂载上下文 */
export interface UiPanelMountContext {
  /** 面板容器 */
  container: HTMLElement;
}

/** 插件面板注册项 */
export interface UiPanelRegistration {
  /** 唯一 id */
  id: string;
  /** 来源插件名，卸载时批量回收 */
  plugin?: string;
  /** 首次打开时挂载，返回清理函数 */
  mount: (ctx: UiPanelMountContext) => void | (() => void);
  /** 打开时回调（面板自己控制显隐） */
  open?: () => void;
  /** 关闭时回调 */
  close?: () => void;
}

export interface UiRegistry {
  listMenus(): UiMenuRegistration[];
  registerMenu(registration: UiMenuRegistration): () => void;
  subscribeMenus(listener: () => void): () => void;
  getPanel(id: string): UiPanelRegistration | undefined;
  listPanels(): UiPanelRegistration[];
  registerPanel(registration: UiPanelRegistration): () => void;
  subscribePanels(listener: () => void): () => void;
  removeByPlugin(plugin: string): void;
}

export function createUiRegistry(): UiRegistry {
  const menus: UiMenuRegistration[] = [];
  const panels = new Map<string, UiPanelRegistration>();
  const menuListeners = new Set<() => void>();
  const panelListeners = new Set<() => void>();
  let seq = 0;
  const order = new Map<string, number>();

  const notifyMenus = (): void => {
    for (const listener of menuListeners) listener();
  };
  const notifyPanels = (): void => {
    for (const listener of panelListeners) listener();
  };

  return {
    listMenus(): UiMenuRegistration[] {
      return [...menus].sort((a, b) => {
        const diff = a.position - b.position;
        if (diff !== 0) return diff;
        return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
      });
    },

    registerMenu(registration: UiMenuRegistration): () => void {
      const index = menus.findIndex((item) => item.id === registration.id);
      if (index >= 0) menus[index] = registration;
      else menus.push(registration);
      order.set(registration.id, ++seq);
      notifyMenus();
      let disposed = false;
      return (): void => {
        if (disposed) return;
        disposed = true;
        const at = menus.findIndex((item) => item.id === registration.id);
        if (at >= 0) menus.splice(at, 1);
        order.delete(registration.id);
        notifyMenus();
      };
    },

    subscribeMenus(listener: () => void): () => void {
      menuListeners.add(listener);
      return (): void => {
        menuListeners.delete(listener);
      };
    },

    getPanel(id: string): UiPanelRegistration | undefined {
      return panels.get(id);
    },

    listPanels(): UiPanelRegistration[] {
      return [...panels.values()];
    },

    registerPanel(registration: UiPanelRegistration): () => void {
      panels.set(registration.id, registration);
      notifyPanels();
      let disposed = false;
      return (): void => {
        if (disposed) return;
        disposed = true;
        if (panels.get(registration.id) === registration) {
          panels.delete(registration.id);
          notifyPanels();
        }
      };
    },

    subscribePanels(listener: () => void): () => void {
      panelListeners.add(listener);
      return (): void => {
        panelListeners.delete(listener);
      };
    },

    removeByPlugin(plugin: string): void {
      let menuChanged = false;
      for (let i = menus.length - 1; i >= 0; i -= 1) {
        if (menus[i].plugin === plugin) {
          order.delete(menus[i].id);
          menus.splice(i, 1);
          menuChanged = true;
        }
      }
      let panelChanged = false;
      for (const [id, panel] of panels) {
        if (panel.plugin === plugin) {
          panels.delete(id);
          panelChanged = true;
        }
      }
      if (menuChanged) notifyMenus();
      if (panelChanged) notifyPanels();
    },
  };
}
