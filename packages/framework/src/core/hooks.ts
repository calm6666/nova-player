/**
 * ============================================
 * 钩子系统
 * ============================================
 * 提供可扩展的钩子机制，允许插件在关键点介入处理
 * 支持链式处理，每个钩子可以修改上下文并传递给下一个钩子
 */

/**
 * 钩子系统接口
 * 提供可扩展的钩子机制
 */
export interface HookSystem {
  /**
   * 注册钩子处理器
   * @param name - 钩子名称
   * @param handler - 钩子处理函数，接收上下文并返回修改后的上下文
   * @returns 取消注册的函数
   */
  register<T, R>(name: string, handler: (ctx: T) => R): () => void;

  /**
   * 执行钩子
   * @param name - 钩子名称
   * @param context - 初始上下文
   * @returns 经过所有处理器处理后的上下文
   */
  run<T, R>(name: string, context: T): R;
}

/**
 * 创建钩子系统实例
 * 提供钩子注册和执行功能
 *
 * @returns 钩子系统实例
 *
 * @example
 * const hooks = createHookSystem();
 *
 * // 注册钩子
 * hooks.register<{ url: string }, { url: string }>('before:load', (ctx) => {
 *   // 修改 URL
 *   return { url: ctx.url + '?t=' + Date.now() };
 * });
 *
 * // 执行钩子
 * const result = hooks.run<{ url: string }, { url: string }>('before:load', { url: 'video.mp4' });
 * console.log(result.url); // video.mp4?t=1234567890
 */
export function createHookSystem(): HookSystem {
  /**
   * 钩子处理器映射表
   * key: 钩子名称
   * value: 该钩子下的处理器数组（按注册顺序执行）
   */
  const hooks = new Map<string, Array<(ctx: unknown) => unknown>>();

  return {
    /**
     * 注册钩子处理器
     * @param name - 钩子名称
     * @param handler - 钩子处理函数，接收上下文并返回修改后的上下文
     * @returns 取消注册的函数
     */
    register: <T, R>(name: string, handler: (ctx: T) => R) => {
      if (!hooks.has(name)) hooks.set(name, []);
      const wrapped = (ctx: unknown): unknown => handler(ctx as T);
      hooks.get(name)!.push(wrapped);
      return () => {
        const arr = hooks.get(name);
        if (arr) {
          const i = arr.indexOf(wrapped);
          if (i > -1) arr.splice(i, 1);
        }
      };
    },

    /**
     * 执行钩子
     * 按注册顺序依次执行所有处理器，每个处理器可以修改上下文
     * @param name - 钩子名称
     * @param context - 初始上下文
     * @returns 经过所有处理器处理后的上下文
     */
    run: <T, R>(name: string, context: T): R => {
      let result: unknown = context;
      hooks.get(name)?.forEach(fn => {
        try {
          const r = fn(result);
          if (r !== undefined) result = r;
        } catch (e) {
          console.error(e);
        }
      });
      return result as R;
    },
  };
}
