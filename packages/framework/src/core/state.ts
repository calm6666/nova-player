/**
 * ============================================
 * 状态管理器
 * ============================================
 * 提供集中式状态存储和订阅机制
 * 支持路径式访问状态，如 'player.currentTime'
 *
 * 响应式引擎：自研 signalsCore（与 signal/computed/effect/onEffect 统一）
 * - 每个状态路径一个惰性 Signal，set 写入 signal、subscribe/useState 通过 effect 订阅 signal
 * - 同步通知：set() 立即同步触发 effect（signals 语义，尊重 batch 批量提交）
 * - 异常隔离：每个监听器用 try-catch 包裹，单个崩溃不影响其他
 * - === 短路：值未变化不触发通知
 */

import { signal, effect } from "./signalsCore";
import type { Signal } from "./signalsCore";
import { isDev } from "./warning";

/**
 * 状态管理器接口
 * 提供集中式状态存储和订阅机制
 * @deprecated 使用 TypedStateManager 替代
 */
export interface StateManager {
  /**
   * 获取完整状态对象的深拷贝
   * @returns 完整状态对象
   */
  getState(): Record<string, unknown>;

  /**
   * 根据路径获取状态值
   * @param path - 状态路径，如 'player.currentTime'
   * @returns 路径对应的值
   */
  get<R>(path: string): R | undefined;

  /**
   * 设置状态值
   * @param path - 状态路径，如 'player.currentTime'
   * @param value - 要设置的值
   * @param silent - 是否静默设置（不触发监听器），默认 false
   */
  set(path: string, value: unknown, silent?: boolean): void;

  /**
   * 订阅状态变化
   * @param path - 要订阅的状态路径
   * @param listener - 状态变化时的回调函数，接收新值和旧值
   * @returns 取消订阅的函数
   */
  subscribe(
    path: string,
    listener: (newVal: unknown, oldVal: unknown) => void,
  ): () => void;

  /**
   * 获取指定路径的响应式 Signal（基于自研 signalsCore）
   * 可用于 onEffect / computed，与 useState / subscribe 共用同一响应式引擎
   * @param path - 状态路径，如 'player.currentTime'
   * @returns 该路径的 Signal（惰性创建，与 get/set 保持一致）
   */
  signal(path: string): Signal<unknown>;
}

/**
 * 类型安全的状态管理器接口
 * TMap 为状态路径到类型的映射表，如 AppStateMap
 *
 * 通知策略：批量微任务调度，同一次 set 的监听器打包到一个微任务中执行
 *
 * @example
 * interface AppStateMap {
 *   'player.volume': number;
 *   'player.muted': boolean;
 * }
 *
 * const state: TypedStateManager<AppStateMap> = ...;
 * state.get('player.volume');           // number | undefined，自动推断
 * state.set('player.volume', 0.5);      // value 必须为 number
 * state.subscribe('player.volume', (newVal, oldVal) => {
 *   // newVal 和 oldVal 自动推断为 number
 *   // 在微任务中执行，不阻塞 set 调用方
 * });
 */
export interface TypedStateManager<TMap = Record<string, unknown>> {
  /**
   * 获取完整状态对象的深拷贝
   * @returns 完整状态对象
   */
  getState(): Record<string, unknown>;

  /**
   * 根据路径获取状态值（类型安全）
   * @param path - 状态路径，必须是 TMap 的 key
   * @returns 路径对应的值，类型自动推断
   */
  get<K extends keyof TMap & string>(path: K): TMap[K] | undefined;

  /**
   * 设置状态值（类型安全）
   * @param path - 状态路径，必须是 TMap 的 key
   * @param value - 要设置的值，类型必须匹配 TMap[K]
   * @param silent - 是否静默设置（不触发监听器），默认 false
   */
  set<K extends keyof TMap & string>(
    path: K,
    value: TMap[K],
    silent?: boolean,
  ): void;

  /**
   * 订阅状态变化（类型安全）
   * @param path - 要订阅的状态路径，必须是 TMap 的 key
   * @param listener - 状态变化时的回调函数，参数类型自动推断
   * @returns 取消订阅的函数
   */
  subscribe<K extends keyof TMap & string>(
    path: K,
    listener: (newVal: TMap[K], oldVal: TMap[K]) => void,
  ): () => void;

  /**
   * 获取指定路径的响应式 Signal（类型安全）
   * @param path - 状态路径，必须是 TMap 的 key
   * @returns 该路径的 Signal，类型自动推断为 TMap[K]
   */
  signal<K extends keyof TMap & string>(path: K): Signal<TMap[K]>;
}

/**
 * 根据路径获取对象中的值
 * 支持嵌套路径，如 'player.currentTime'
 *
 * @param obj - 源对象
 * @param path - 属性路径，使用点号分隔
 * @returns 路径对应的值，不存在则返回 undefined
 *
 * @example
 * getValue({ player: { currentTime: 10 } }, 'player.currentTime') // 10
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null) return undefined;
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * 根据路径设置对象中的值
 * 自动创建不存在的中间对象
 *
 * @param obj - 目标对象
 * @param path - 属性路径，使用点号分隔
 * @param value - 要设置的值
 *
 * @example
 * setValue({}, 'player.currentTime', 10)
 * // obj 变为 { player: { currentTime: 10 } }
 */
function setValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = current[key];
    if (!isRecord(next)) {
      /**
       * 中间节点不是对象时，自动创建新对象覆盖
       * 开发环境警告：原始值会被覆盖，可能导致数据丢失
       * 例如：setValue({a: 5}, 'a.b', 10) 会把 a 从 5 覆盖为 {b: 10}
       */
      if (next !== undefined && typeof next === "object" && next !== null) {
        const newObj: Record<string, unknown> = {};
        current[key] = newObj;
        current = newObj;
      } else {
        if (isDev()) {
          console.warn(
            `[Lumina/state] Intermediate node "${key}" on path "${path}" is not an object (current value: ${String(next)}), will be overwritten with an object`,
          );
        }
        const newObj: Record<string, unknown> = {};
        current[key] = newObj;
        current = newObj;
      }
    } else {
      current = next;
    }
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * 深拷贝对象
 * 递归复制对象及其所有嵌套属性
 * 支持 Date、RegExp、Map、Set 等内置类型
 *
 * @param obj - 要拷贝的对象
 * @returns 拷贝后的新对象
 */
function clone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;

  /**
   * 优先使用原生 structuredClone。
   * 现代运行时对此类深拷贝有专门优化，通常比手写递归更快。
   * 如果目标对象包含 structuredClone 不支持的值，则回退到手写实现。
   */
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(obj);
    } catch {
      /** 回退到手写克隆逻辑 */
    }
  }

  /** Date 类型：创建新的 Date 实例 */
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  /** RegExp 类型：创建新的 RegExp 实例 */
  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as T;
  }

  /** Map 类型：递归拷贝所有键值对 */
  if (obj instanceof Map) {
    const map = new Map();
    for (const [key, value] of obj) {
      map.set(clone(key), clone(value));
    }
    return map as T;
  }

  /** Set 类型：递归拷贝所有值 */
  if (obj instanceof Set) {
    const set = new Set();
    for (const value of obj) {
      set.add(clone(value));
    }
    return set as T;
  }

  /** Array 类型：递归拷贝所有元素 */
  if (Array.isArray(obj)) {
    const arr = obj as unknown[];
    return [...arr.map((item) => clone(item))] as T;
  }
  /** 普通对象：递归拷贝所有属性（obj 在此分支必然是 record） */
  const copy: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      copy[key] = clone(obj[key]);
    }
  }
  return copy as T;
}

/**
 * 创建状态管理器实例
 * 提供状态存储、读取、设置和订阅功能
 * 使用 createTypedStateManager 替代
 *
 * @param initial - 初始状态对象
 * @returns 状态管理器实例
 */
export function createStateManager(
  initial: Record<string, unknown> = {},
): TypedStateManager {
  // 权威状态对象：get / getState / set 的 === 比较都基于它
  const root = clone(initial);
  // 每个状态路径一个惰性 Signal（作为值存储 + 通知通道）
  const pathSignals = new Map<string, Signal<unknown>>();
  // 正在静默写入的路径：silent set 时同步 signal 保持一致，但抑制订阅回调
  const silentPaths = new Set<string>();

  function signalFor(path: string): Signal<unknown> {
    let sig = pathSignals.get(path);
    if (sig === undefined) {
      sig = signal(getValue(root, path));
      pathSignals.set(path, sig);
    }
    return sig;
  }

  return {
    getState: (): Record<string, unknown> => clone(root),

    get: <R>(path: string): R | undefined =>
      getValue(root, path) as R | undefined,

    set: (path: string, value: unknown, silent = false): void => {
      const oldVal = getValue(root, path);
      if (oldVal === value) return;
      setValue(root, path, value);

      const sig = signalFor(path);
      if (silent) {
        // 静默：signal 值同步为最新（get / signal().value 一致），
        // 但通过 silentPaths 抑制订阅回调
        silentPaths.add(path);
        try {
          sig.value = value;
        } finally {
          silentPaths.delete(path);
        }
      } else {
        sig.value = value;
      }
    },

    subscribe: (
      path: string,
      listener: (newVal: unknown, oldVal: unknown) => void,
    ): (() => void) => {
      const sig = signalFor(path);
      let prev = getValue(root, path);
      // ★ 用 effect（而非 Signal.subscribe）作为触发机构：
      // - 与 onEffect / 用户代码同用一个原语，自动追踪依赖
      // - effect 尊重 batch()，可把同一批量内的多次 set 合并提交
      return effect(() => {
        const v = sig.value;
        if (silentPaths.has(path)) {
          // 静默写入：更新 prev 以保证后续 oldVal 正确，但不通知
          prev = v;
          return;
        }
        // effect 首次同步执行会读到当前值，这里跳过初始运行，
        // 仅在实际变化时通知（与原 subscribe-only 语义一致）
        if (v === prev) return;
        const old = prev;
        prev = v;
        try {
          listener(v, old);
        } catch (e) {
          console.error(e); // 异常隔离：单个监听器崩溃不影响其他
        }
      });
    },

    signal: (path: string): Signal<unknown> => signalFor(path),
  };
}

/**
 * 创建类型安全的状态管理器实例
 * TMap 为状态路径到类型的映射表
 *
 * @param initial - 初始状态对象
 * @returns 类型安全的状态管理器实例
 *
 * @example
 * interface AppStateMap {
 *   'player.volume': number;
 *   'player.muted': boolean;
 * }
 *
 * const state = createTypedStateManager<AppStateMap>({
 *   player: { volume: 0.8, muted: false }
 * });
 *
 * state.get('player.volume');           // number | undefined
 * state.set('player.volume', 0.5);      // ✅ 类型安全
 * state.set('player.volume', 'loud');   // ❌ 编译错误
 * state.subscribe('player.volume', (newVal, oldVal) => {
 *   // newVal: number, oldVal: number
 * });
 */
export function createTypedStateManager<TMap>(
  initial: Record<string, unknown> = {},
): TypedStateManager<TMap> {
  const inner = createStateManager(initial);

  return {
    getState: (): Record<string, unknown> => inner.getState(),
    get: <K extends keyof TMap & string>(path: K): TMap[K] | undefined =>
      inner.get(path) as TMap[K] | undefined,
    set: <K extends keyof TMap & string>(
      path: K,
      value: TMap[K],
      silent?: boolean,
    ): void => {
      inner.set(path, value, silent);
    },
    subscribe: <K extends keyof TMap & string>(
      path: K,
      listener: (newVal: TMap[K], oldVal: TMap[K]) => void,
    ): (() => void) => {
      return inner.subscribe(
        path,
        listener as (newVal: unknown, oldVal: unknown) => void,
      );
    },
    signal: <K extends keyof TMap & string>(path: K): Signal<TMap[K]> =>
      inner.signal(path) as Signal<TMap[K]>,
  };
}

/**
 * 在组件内获取响应式状态 Signal（Pinia 风格 API）
 *
 * 返回 Signal<T>，调用方读取 `.value` 时自动建立响应式依赖：
 * - 在 onEffect 内读取 → 依赖变化时自动重跑 effect（精准更新 DOM）
 * - 在 _reactiveText getter 内读取 → 依赖变化时自动更新文本节点
 * - 在 computed 内读取 → 派生值自动更新
 * - 配合编译期响应式追踪（vite-plugin-lumina-compile 自动包装 _reactiveText）
 *
 * 与 useState 的关系：
 * - useReactiveState 返回 Signal，声明式响应式（推荐新代码使用）
 * - useState 是 useReactiveState 的命令式包装，接收 updater 回调（向后兼容老代码）
 *
 * Signal 是惰性原语，自身不需要清理；真正的 effect 清理由 onEffect / _reactiveText
 * 的调用方负责（onEffect 启动时把 dispose 收集到 _stateCleanups，destroy 时统一清理）。
 * lifecycle 参数保留以备未来扩展（如开发环境记录使用位置）。
 *
 * @param state - 类型安全的状态管理器实例
 * @param path - 状态路径，必须是 TMap 的 key
 * @param lifecycle - 组件生命周期对象（保留参数以备扩展，当前 signal 自身无需清理）
 * @returns 该路径的 Signal，类型为 TMap[K]
 *
 * @example
 * // 在 defineComponent 中使用（声明式响应式）
 * const MyComponent = defineComponent<{ state: TypedStateManager<AppStateMap> }>(
 *   (props, lifecycle) => {
 *     const volumeEl = h('span', { class: 'volume' });
 *     const volumeSignal = useReactiveState(props.state, AppStateKeyEnum.VOLUME, lifecycle);
 *
 *     // onEffect 内读取 .value 自动追踪，volume 变化时自动重跑 effect
 *     onEffect(lifecycle, () => {
 *       volumeEl.el!.textContent = `${Math.round(volumeSignal.value * 100)}%`;
 *     });
 *
 *     return volumeEl;
 *   }
 * );
 *
 * @example
 * // 配合编译期响应式追踪（vite-plugin-lumina-compile 自动包装为 _reactiveText）
 * const MyComponent = defineComponent<{ state: TypedStateManager<AppStateMap> }>(
 *   (props, lifecycle) => {
 *     const volumeSignal = useReactiveState(props.state, AppStateKeyEnum.VOLUME, lifecycle);
 *     // h('span', {}, volumeSignal.value) 会被编译为
 *     // h('span', {}, _reactiveText(() => volumeSignal.value))
 *     // locale/signal 变化时自动更新文本节点，无需 onEffect
 *     return h('span', {}, volumeSignal.value);
 *   }
 * );
 */
export function useReactiveState<TMap, K extends keyof TMap & string>(
  state: TypedStateManager<TMap>,
  path: K,
  _lifecycle?: { _stateCleanups?: Array<() => void>; _effects?: Array<() => (() => void) | void> },
): Signal<TMap[K]> {
  // Signal 自身是惰性的，读取 .value 才建立依赖
  // 真正的 effect 清理由 onEffect / _reactiveText 的调用方负责
  // （onEffect 启动时把 dispose 收集到 _stateCleanups）
  return state.signal(path);
}

/**
 * 组件内使用状态的工具函数（useReactiveState 的命令式包装）
 *
 * 内部基于 useReactiveState 获取响应式 Signal，再通过 state.subscribe
 * 订阅 signal.value 变化，状态变化时自动调用 updater 更新 DOM：
 * - subscribe 内部基于 effect（自动追踪 sig.value，尊重 batch 批量提交）
 * - silent set 时通过 silentPaths 抑制订阅回调（signal 值同步但监听器不触发）
 * - === 短路：值未变化不触发通知
 * - 异常隔离：单个 updater 崩溃不影响其他
 *
 * 清理机制：使用 lifecycle._stateCleanups 数组收集所有取消订阅函数
 * 避免多次调用 useState 时互相覆盖 onDestroyed 导致清理丢失
 * destroy 时通过 invokeLifecycle → processLifecycleForNode 统一调用
 *
 * 推荐新代码使用 useReactiveState + onEffect / _reactiveText 实现声明式响应式，
 * useState 仅为向后兼容老代码保留。
 *
 * @param state - 类型安全的状态管理器实例
 * @param path - 状态路径，必须是 TMap 的 key
 * @param updater - 状态变化时的 DOM 更新回调，接收新值
 * @param lifecycle - 组件生命周期对象，用于在销毁时自动取消订阅
 * @returns 当前值
 *
 * @example
 * // 在 defineComponent 中使用
 * const MyComponent = defineComponent<{ state: TypedStateManager<AppStateMap> }>(
 *   (props, lifecycle) => {
 *     const volumeEl = h('span', { class: 'volume' });
 *
 *     // 订阅音量状态，变化时更新 DOM
 *     const volume = useState(
 *       props.state,
 *       AppStateKeyEnum.VOLUME,
 *       (newVol) => { volumeEl.el!.textContent = `${Math.round(newVol * 100)}%`; },
 *       lifecycle
 *     );
 *
 *     // 初始渲染
 *     volumeEl.el!.textContent = `${Math.round(volume ?? 0 * 100)}%`;
 *     return volumeEl;
 *   }
 * );
 */
export function useState<TMap, K extends keyof TMap & string>(
  state: TypedStateManager<TMap>,
  path: K,
  updater: (newVal: TMap[K], oldVal: TMap[K]) => void,
  lifecycle: {
    onDestroyed?: () => void;
    _stateCleanups?: Array<() => void>;
    _stateSubscriptions?: Array<() => () => void>;
    _effects?: Array<() => (() => void) | void>;
  },
): TMap[K] | undefined {
  // ★ 基于 useReactiveState 获取响应式 Signal（与 Pinia 风格 API 共用同一响应式原语）
  // useState 是 useReactiveState 的命令式包装：返回当前值 + updater 回调订阅
  useReactiveState(state, path, lifecycle);

  /**
   * ★ 订阅改为「可重放启动器」模式（与 onEffect 的 _effects 同构）：
   * 组件 setup 只执行一次，若在此直接订阅，控制流（Show/Switch）
   * 卸载 → destroy 退订 → 重挂（setup 不重跑）后订阅将永久丢失；
   * 收集启动器交由 mount.ts 在 onMounted 时建立订阅，
   * 重挂时先退旧再重建，保证任意时刻恰好一份活跃订阅。
   */
  const starters = (lifecycle._stateSubscriptions ??= []);
  starters.push((): (() => void) => {
    // state.subscribe 内部基于 effect 订阅 sig.value（自动追踪 + batch + silent + 异常隔离）
    const unsub = state.subscribe(path, updater);
    /**
     * 订阅建立后立即以当前值补一次同步：
     * subscribe 的「跳过初始」语义以订阅时刻为基准（prev = 订阅时的当前值），
     * 晚订阅 / 控制流重挂场景借此捕获挂载窗口期内已发生的状态变化，
     * 避免组件停留在 setup 期的旧快照。
     */
    const current = state.get(path);
    if (current !== undefined) {
      updater(current, current);
    }
    return unsub;
  });

  return state.get(path);
}
