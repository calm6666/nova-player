/**
 * ============================================
 * 可订阅配置中心（ConfigStore）
 * ============================================
 * 替代原先「只读快照」的 `ConfigContext`，使控件开关等配置支持运行时动态更新：
 * 子组件通过 `subscribePath('ui.controls.quality', cb)` 订阅某个路径，
 * `setConfig` 写入新配置后仅通知真正变化的路径。
 *
 * 设计取舍（为何不使用 core/state.ts 的 TypedStateManager）：
 *   - TypedStateManager 是「按固定 TMap 路径逐键 set」的标量状态存储，
 *     而 ConfigStore 的语义是「整包替换 + 按订阅路径做差异通知」；
 *   - 复用它会需要把配置拍平成叶子路径逐个 set，既丢失「订阅父路径（如
 *     ui.controls 整个对象）」的能力，又要额外维护路径重建，得不偿失。
 *   因此这里独立实现，但**刻意沿用 TypedStateManager 的风格**：
 *   无响应式、纯回调通知、`===` 短路（值未变不回调）、监听器异常隔离。
 */

import { createContext } from '@lumina/framework/core/context';
import type { PlayerConfig } from '../types/player';
import { createLogger } from '@lumina/framework/utils';

/** 配置中心日志（仅 error 级别的监听器异常隔离记录） */
const logger = createLogger('ConfigStore');

/** 路径订阅回调 */
type PathListener = (value: unknown, prev: unknown) => void;
/** 整包订阅回调 */
type WholeListener = (
  next: Readonly<PlayerConfig>,
  prev: Readonly<PlayerConfig>,
) => void;

/**
 * 可订阅的配置中心
 */
export interface ConfigStore {
  /** 读取当前配置（命名空间形态，只读，请勿直接修改返回值） */
  get(): Readonly<PlayerConfig>;
  /**
   * 按路径读取，如 `getPath('ui.controls.quality')`
   * @param path - 点号分隔的配置路径
   * @returns 路径对应的值；路径不存在时返回 undefined
   */
  getPath<T = unknown>(path: string): T | undefined;
  /** 整包替换（内部使用，传入前应已完成默认值合并与归一化） */
  set(next: PlayerConfig): void;
  /**
   * 订阅某个路径的变化（浅比较，值变才回调）
   * @param path - 点号分隔的配置路径
   * @param cb - 变化回调，接收新值与旧值
   * @returns 取消订阅函数
   */
  subscribePath(path: string, cb: PathListener): () => void;
  /**
   * 订阅整包变化
   * @param cb - 变化回调，接收新配置与旧配置
   * @returns 取消订阅函数
   */
  subscribe(cb: WholeListener): () => void;
}

/**
 * 判断是否为可继续向下取值的普通对象
 * 与 core/state.ts 的取值语义保持一致（数组不递归下钻）
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 按点号路径读取嵌套值
 *
 * @param root - 根对象
 * @param path - 点号分隔路径，如 'ui.controls.quality'
 * @returns 路径对应的值；路径不存在时返回 undefined
 */
function getValue(root: unknown, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = root;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * 创建可订阅配置中心
 *
 * @param initial - 初始配置（命名空间形态）
 * @returns ConfigStore 实例
 *
 * @example
 * const store = createConfigStore(defaultConfig);
 * const off = store.subscribePath('ui.controls.quality', (v) => {
 *   qualityMenu.el.style.display = v ? '' : 'none';
 * });
 * store.set(mergePlayerConfig(defaultConfig, { ui: { controls: { quality: false } } }));
 * // → 仅 quality 路径的回调被触发
 */
export function createConfigStore(initial: PlayerConfig): ConfigStore {
  /** 当前生效的配置（整包） */
  let current: PlayerConfig = initial;
  /** 路径 → 监听器集合 */
  const pathListeners = new Map<string, Set<PathListener>>();
  /** 整包监听器集合 */
  const wholeListeners = new Set<WholeListener>();

  return {
    get: (): Readonly<PlayerConfig> => current,

    getPath: <T = unknown>(path: string): T | undefined =>
      getValue(current, path) as T | undefined,

    set: (next: PlayerConfig): void => {
      const prev = current;
      // 同一引用视为无变化，直接返回
      if (prev === next) return;
      current = next;

      // 逐路径浅比较，只通知值真正变化的路径订阅者
      pathListeners.forEach((listeners, path) => {
        const nextValue = getValue(next, path);
        const prevValue = getValue(prev, path);
        if (nextValue === prevValue) return;
        listeners.forEach((cb) => {
          try {
            cb(nextValue, prevValue);
          } catch (e) {
            // 异常隔离：单个监听器崩溃不影响其他监听器
            logger.error('配置订阅回调执行失败', e);
          }
        });
      });

      // 通知整包订阅者
      wholeListeners.forEach((cb) => {
        try {
          cb(next, prev);
        } catch (e) {
          logger.error('整包配置订阅回调执行失败', e);
        }
      });
    },

    subscribePath: (path: string, cb: PathListener): (() => void) => {
      let listeners = pathListeners.get(path);
      if (listeners === undefined) {
        listeners = new Set<PathListener>();
        pathListeners.set(path, listeners);
      }
      listeners.add(cb);
      return (): void => {
        const set = pathListeners.get(path);
        if (set === undefined) return;
        set.delete(cb);
        if (set.size === 0) pathListeners.delete(path);
      };
    },

    subscribe: (cb: WholeListener): (() => void) => {
      wholeListeners.add(cb);
      return (): void => {
        wholeListeners.delete(cb);
      };
    },
  };
}

/**
 * 配置中心 Context
 *
 * 由 PlayerDocker 注入，控件组件通过 `useContext(ConfigStoreContext)` 获取，
 * 再 `store.subscribePath(...)` 订阅所需配置项，实现「设置即生效」。
 *
 * 未注入 Provider 时默认值为 null，调用方需自行兜底。
 */
export const ConfigStoreContext = createContext<ConfigStore | null>(null);
