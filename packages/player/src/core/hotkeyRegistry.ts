/**
 * 快捷键注册表
 *
 * 播放器仍负责键盘监听、输入框豁免、组合键拦截与匹配顺序；
 * 插件只注册自己的快捷键描述与动作，卸载时按来源插件批量回收。
 */

import { HOTKEYS, type HotkeyConfig } from "./hotkeys";

/** 插件快捷键注册项：id 必填，plugin 用于卸载与面板分组 */
export interface HotkeyRegistration extends HotkeyConfig {
  id: string;
}

export interface HotkeyRegistry {
  /** 当前生效列表：priority > 0 的插件项在前，内置项居中，其余插件项在后 */
  list(): HotkeyConfig[];
  /** 注册插件快捷键，返回注销函数（幂等） */
  register(registration: HotkeyRegistration): () => void;
  /** 按来源插件批量注销 */
  removeByPlugin(plugin: string): void;
  /** 订阅列表变化，返回取消订阅函数 */
  subscribe(listener: () => void): () => void;
}

export function createHotkeyRegistry(
  builtins: readonly HotkeyConfig[] = HOTKEYS,
): HotkeyRegistry {
  const pluginHotkeys: HotkeyRegistration[] = [];
  const listeners = new Set<() => void>();
  let seq = 0;
  const order = new Map<string, number>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const buildList = (): HotkeyConfig[] => {
    const sorted = [...pluginHotkeys].sort((a, b) => {
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
    });
    const early = sorted.filter((item) => (item.priority ?? 0) > 0);
    const late = sorted.filter((item) => (item.priority ?? 0) <= 0);
    return [...early, ...builtins, ...late];
  };

  return {
    list: buildList,

    register(registration: HotkeyRegistration): () => void {
      const existing = pluginHotkeys.find((item) => item.id === registration.id);
      if (existing) {
        const index = pluginHotkeys.indexOf(existing);
        pluginHotkeys[index] = registration;
      } else {
        pluginHotkeys.push(registration);
      }
      order.set(registration.id, ++seq);
      notify();

      let disposed = false;
      return (): void => {
        if (disposed) return;
        disposed = true;
        const index = pluginHotkeys.findIndex(
          (item) => item.id === registration.id,
        );
        if (index >= 0) pluginHotkeys.splice(index, 1);
        order.delete(registration.id);
        notify();
      };
    },

    removeByPlugin(plugin: string): void {
      let removed = false;
      for (let i = pluginHotkeys.length - 1; i >= 0; i -= 1) {
        if (pluginHotkeys[i].plugin === plugin) {
          order.delete(pluginHotkeys[i].id);
          pluginHotkeys.splice(i, 1);
          removed = true;
        }
      }
      if (removed) notify();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
