/**
 * ============================================
 * 事件总线
 * ============================================
 * 提供跨组件/插件的事件通信机制
 * 支持基于事件映射表的类型安全
 *
 * 通知策略：同步调用 + try-catch 异常隔离
 * - 瞬时通知：emit 后监听器立即执行，零延迟
 * - 异常隔离：每个监听器用 try-catch 包裹，单个崩溃不影响其他
 * - 顺序保证：严格按 emit 调用顺序处理，保证事件间依赖关系
 *   （例如 emit('player:mounted') 后立即调用 load()，
 *     要求 mounted 监听器已执行完毕）
 */

/**
 * 类型安全的事件总线接口
 * 泛型参数 TMap 为事件名到 payload 类型的映射表
 *
 * @example
 * interface MyEvents {
 *   PLAY: undefined;
 *   VOLUME_CHANGE: { volume: number };
 *   ERROR: { message: string };
 * }
 * const bus = createTypedEventBus<MyEvents>();
 * bus.on('VOLUME_CHANGE', (data) => { data.volume }); // 类型安全
 * bus.emit('VOLUME_CHANGE', { volume: 0.5 });         // payload 类型检查
 */
export interface TypedEventBus<TMap = Record<string, unknown>> {
  /**
   * 监听事件
   * @param event - 事件名称（受 TMap 约束）
   * @param handler - 事件处理函数，参数类型由 TMap[event] 决定
   * @returns 取消监听的函数
   */
  on<K extends keyof TMap>(
    event: K,
    handler: TMap[K] extends undefined ? () => void : (payload: TMap[K]) => void
  ): () => void;

  /**
   * 取消监听事件
   * @param event - 事件名称
   * @param handler - 事件处理函数
   */
  off<K extends keyof TMap>(
    event: K,
    handler: TMap[K] extends undefined ? () => void : (payload: TMap[K]) => void
  ): void;

  /**
   * 触发事件
   * 监听器同步执行，异常隔离（try-catch 包裹每个监听器）
   * @param event - 事件名称
   * @param payload - 事件数据（undefined 类型的事件不需要传）
   */
  emit<K extends keyof TMap>(
    event: K,
    ...args: TMap[K] extends undefined ? [] : [payload: TMap[K]]
  ): void;
}

/**
 * 创建类型安全的事件总线实例
 * 监听器同步执行，异常隔离（try-catch 包裹每个监听器）
 *
 * @returns 类型安全的事件总线实例
 *
 * @example
 * interface MyEvents {
 *   PLAY: undefined;
 *   VOLUME_CHANGE: { volume: number };
 * }
 * const bus = createTypedEventBus<MyEvents>();
 *
 * // 监听事件（handler 参数自动推断类型）
 * const unsub = bus.on('VOLUME_CHANGE', (data) => {
 *   console.log(data.volume); // ✅ 类型安全
 * });
 *
 * // 触发事件（payload 类型检查）
 * bus.emit('VOLUME_CHANGE', { volume: 0.5 }); // ✅
 * bus.emit('PLAY');                            // ✅ 无 payload
 *
 * // 取消监听
 * unsub();
 */
export function createTypedEventBus<TMap>(): TypedEventBus<TMap> {
  const listeners = new Map<keyof TMap, Set<(payload: unknown) => void>>();

  return {
    on: <K extends keyof TMap>(
      event: K,
      handler: TMap[K] extends undefined ? () => void : (payload: TMap[K]) => void
    ) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      const fn = handler as (payload: unknown) => void;
      listeners.get(event)!.add(fn);
      return () => listeners.get(event)?.delete(fn);
    },

    off: <K extends keyof TMap>(
      event: K,
      handler: TMap[K] extends undefined ? () => void : (payload: TMap[K]) => void
    ): void => {
      const fn = handler as (payload: unknown) => void;
      listeners.get(event)?.delete(fn);
    },

    emit: <K extends keyof TMap>(
      event: K,
      ...args: TMap[K] extends undefined ? [] : [payload: TMap[K]]
    ): void => {
      const payload = args[0];
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of set) {
        try {
          fn(payload);
        } catch (e) {
          console.error(e);
        }
      }
    },
  };
}

/**
 * 向后兼容的无类型 EventBus 接口
 * 保留用于不使用 PlayerEventMap 的场景
 */
export interface EventBus {
  on<T>(event: string, handler: (payload: T) => void): () => void;
  off<T>(event: string, handler: (payload: T) => void): void;
  emit<T>(event: string, payload?: T): void;
}

/**
 * 向后兼容的无类型事件总线工厂函数
 * @deprecated 请使用 createTypedEventBus 替代
 */
export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  return {
    on: <T>(event: string, handler: (payload: T) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      const fn = handler as (payload: unknown) => void;
      listeners.get(event)!.add(fn);
      return () => listeners.get(event)?.delete(fn);
    },

    off: <T>(event: string, handler: (payload: T) => void): void => {
      const fn = handler as (payload: unknown) => void;
      listeners.get(event)?.delete(fn);
    },

    emit: <T>(event: string, payload?: T): void => {
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of set) {
        try {
          fn(payload);
        } catch (e) {
          console.error(e);
        }
      }
    },
  };
}
