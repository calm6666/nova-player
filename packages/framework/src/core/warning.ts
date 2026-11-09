/**
 * ============================================
 * 框架警告与错误处理系统
 * ============================================
 * 提供框架级别的警告输出、错误捕获和安全执行机制
 * 与 error/ErrorHandler.ts 的区别：
 *   - ErrorHandler 是播放器业务层的错误处理（网络/媒体/插件等）
 *   - 本模块是框架核心层的警告和错误处理（组件/h函数/SSR等）
 *
 * 设计原则：
 *   1. 开发环境输出详细警告，生产环境静默
 *   2. 框架内部错误不会中断用户代码执行
 *   3. 提供全局错误处理器注册，允许用户自定义错误处理
 *   4. 安全执行包装器，确保回调/生命周期等不会抛出未捕获异常
 */

/**
 * 框架警告来源
 */
export enum WarnSource {
  /** h() 函数相关警告 */
  H = 'h',
  /** defineComponent 相关警告 */
  COMPONENT = 'component',
  /** mount/hydrate 相关警告 */
  MOUNT = 'mount',
  /** Context 相关警告 */
  CONTEXT = 'context',
  /** SSR 相关警告 */
  SSR = 'ssr',
  /** 生命周期相关警告 */
  LIFECYCLE = 'lifecycle',
  /** 状态管理相关警告 */
  STATE = 'state',
  /** 事件总线相关警告 */
  EVENT_BUS = 'event-bus',
  /** i18n 相关警告 */
  I18N = 'i18n',
}

/**
 * 框架错误来源
 */
export enum ErrorSource {
  /** 组件渲染错误 */
  RENDER = 'render',
  /** 生命周期钩子执行错误 */
  LIFECYCLE = 'lifecycle',
  /** 事件处理错误 */
  EVENT_HANDLER = 'event-handler',
  /** SSR 渲染错误 */
  SSR = 'ssr',
  /** Hydrate 错误 */
  HYDRATE = 'hydrate',
  /** 组件 setup 错误 */
  SETUP = 'setup',
}

/**
 * 框架错误信息接口
 */
export interface FrameworkError {
  /** 错误来源 */
  source: ErrorSource;
  /** 错误消息 */
  message: string;
  /** 原始错误对象 */
  error?: Error;
  /** 附加数据 */
  data?: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 框架警告信息接口
 */
export interface FrameworkWarning {
  /** 警告来源 */
  source: WarnSource;
  /** 警告消息 */
  message: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
}

/**
 * 全局错误处理器类型
 */
export type GlobalErrorHandler = (error: FrameworkError) => void;

/**
 * 全局警告处理器类型
 */
export type GlobalWarningHandler = (warning: FrameworkWarning) => void;

/**
 * 是否为开发环境
 * 通过检查全局变量判断
 * 优先检查自定义标记 __LUMINA_DEV__，其次检查 Node.js 的 process.env
 * 浏览器环境通常由构建工具注入 NODE_ENV
 *
 * 安全策略：未注入时默认返回 false（生产安全优先）
 * 避免生产环境因未注入标记而输出不必要的警告
 */
declare const __LUMINA_DEV__: boolean | undefined;

export function isDev(): boolean {
  if (typeof __LUMINA_DEV__ !== 'undefined') {
    return __LUMINA_DEV__;
  }
  /** 检查 process.env.NODE_ENV（Node.js 环境） */
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production';
  }
  /** 未注入标记时默认为非开发环境（安全优先） */
  return false;
}

/**
 * 全局错误处理器列表
 */
const errorHandlers: Set<GlobalErrorHandler> = new Set();

/**
 * 全局警告处理器列表
 */
const warningHandlers: Set<GlobalWarningHandler> = new Set();

/**
 * 注册全局错误处理器
 * 框架内部捕获的错误会分发给所有注册的处理器
 *
 * @param handler - 错误处理函数
 * @returns 取消注册的函数
 *
 * @example
 * const unsubscribe = onFrameworkError((error) => {
 *   console.error(`[${error.source}] ${error.message}`, error.error);
 * });
 * // 取消注册
 * unsubscribe();
 */
export function onFrameworkError(handler: GlobalErrorHandler): () => void {
  errorHandlers.add(handler);
  return () => errorHandlers.delete(handler);
}

/**
 * 注册全局警告处理器
 * 框架内部产生的警告会分发给所有注册的处理器
 *
 * @param handler - 警告处理函数
 * @returns 取消注册的函数
 *
 * @example
 * const unsubscribe = onFrameworkWarning((warning) => {
 *   console.warn(`[${warning.source}] ${warning.message}`);
 * });
 */
export function onFrameworkWarning(handler: GlobalWarningHandler): () => void {
  warningHandlers.add(handler);
  return () => warningHandlers.delete(handler);
}

/**
 * 输出框架警告
 * 仅在开发环境输出到控制台，同时分发给所有注册的警告处理器
 * 生产环境只分发给处理器，不输出到控制台
 *
 * @param source - 警告来源
 * @param message - 警告消息
 * @param data - 附加数据
 *
 * @example
 * warn(WarnSource.COMPONENT, '组件缺少必要的 props', { component: 'MyComponent' });
 */
export function warn(source: WarnSource, message: string, data?: Record<string, unknown>): void {
  const warning: FrameworkWarning = { source, message, data };

  warningHandlers.forEach(handler => {
    try {
      handler(warning);
    } catch {
      /** 处理器异常不影响主流程 */
    }
  });

  if (isDev()) {
    console.warn(`[Lumina/${source}] ${message}`, data ?? '');
  }
}

/**
 * 报告框架错误
 * 分发给所有注册的错误处理器，开发环境输出到控制台
 * 不会抛出异常，确保框架内部错误不中断用户代码
 *
 * @param source - 错误来源
 * @param message - 错误消息
 * @param error - 原始错误对象
 * @param data - 附加数据
 *
 * @example
 * reportError(ErrorSource.RENDER, '组件渲染失败', error, { component: 'MyComponent' });
 */
export function reportError(
  source: ErrorSource,
  message: string,
  error?: Error,
  data?: Record<string, unknown>
): void {
  const frameworkError: FrameworkError = {
    source,
    message,
    error,
    data,
    timestamp: Date.now(),
  };

  errorHandlers.forEach(handler => {
    try {
      handler(frameworkError);
    } catch {
      /** 处理器异常不影响主流程 */
    }
  });

  if (isDev()) {
    console.error(`[Lumina/${source}] ${message}`, error ?? '', data ?? '');
  }
}

/**
 * 安全执行函数
 * 捕获异常并报告给框架错误处理器，不会向外抛出
 * 适用于生命周期钩子、事件处理函数等不应中断应用的场景
 *
 * @param fn - 要安全执行的函数
 * @param source - 错误来源
 * @param message - 错误描述
 * @param data - 附加数据
 * @returns 函数返回值，出错时返回 undefined
 *
 * @example
 * const result = safeCall(
 *   () => component.render(),
 *   ErrorSource.RENDER,
 *   '组件渲染失败',
 *   { component: 'MyComponent' }
 * );
 */
export function safeCall<T>(
  fn: () => T,
  source: ErrorSource,
  message: string,
  data?: Record<string, unknown>
): T | undefined {
  try {
    return fn();
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    reportError(source, message, error, data);
    return undefined;
  }
}

/**
 * 安全执行异步函数
 * 捕获异步异常并报告给框架错误处理器
 *
 * @param fn - 要安全执行的异步函数
 * @param source - 错误来源
 * @param message - 错误描述
 * @param data - 附加数据
 * @returns Promise，出错时 resolve undefined
 *
 * @example
 * const result = await safeAsyncCall(
 *   () => fetch('/api/data'),
 *   ErrorSource.RENDER,
 *   '数据加载失败'
 * );
 */
export async function safeAsyncCall<T>(
  fn: () => Promise<T>,
  source: ErrorSource,
  message: string,
  data?: Record<string, unknown>
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    reportError(source, message, error, data);
    return undefined;
  }
}

/**
 * 断言条件为真，否则输出警告
 * 用于开发环境下的防御性检查
 *
 * @param condition - 断言条件
 * @param source - 警告来源
 * @param message - 断言失败时的警告消息
 *
 * @example
 * assertWarn(props.src !== undefined, WarnSource.COMPONENT, '组件必须提供 src 属性');
 */
export function assertWarn(condition: boolean, source: WarnSource, message: string): void {
  if (!condition) {
    warn(source, message);
  }
}
