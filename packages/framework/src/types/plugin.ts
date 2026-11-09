/**
 * ============================================
 * 插件系统核心类型（框架层通用契约）
 * ============================================
 * 框架只定义与具体播放器实现无关的插件契约：
 * 宿主通过泛型参数 P 注入（默认 PlayerHost 最小契约），
 * 播放器包再以具体宿主类型绑定并对外导出。
 *
 * @module types/plugin
 */

/**
 * 插件宿主最小契约
 *
 * 框架不依赖任何具体播放器类型；宿主实现可以是播放器实例、
 * 元素控制器或测试替身。具体成员由上层包通过泛型约束补全。
 */
export interface PlayerHost {
  /** 宿主可暴露任意成员，由上层包按其真实契约收窄 */
  [key: string]: unknown;
}

/** 插件通用选项 */
export interface PluginOptions {
  /** 是否开启调试模式，默认继承播放器的 debug 设置 */
  debug?: boolean;
}

/** 插件基接口 — 所有插件必须实现 */
export interface Plugin<P = PlayerHost> {
  /** 插件名称，必须唯一 */
  readonly name: string;
  /** 插件版本号 */
  readonly version?: string;
  /** 插件描述 */
  readonly description?: string;
  /** 依赖的其他插件名称列表 */
  readonly dependencies?: string[];
  /** 插件选项 */
  readonly options?: PluginOptions;

  /**
   * 安装插件 — 在宿主初始化时调用
   * @param player - 宿主实例（由上层包收窄为具体类型）
   */
  install(player: P): void;

  /**
   * 卸载插件 — 清理资源 (可选)
   * @param player - 宿主实例
   */
  uninstall?(player: P): void;

  /** 启用插件 (可选) */
  enable?(): void;

  /** 禁用插件 (可选) */
  disable?(): void;
}

/** 插件工厂函数类型 */
export type PluginFactory<P = PlayerHost, TConfig = Record<string, unknown>> = (
  config?: TConfig & PluginOptions,
) => Plugin<P>;

/** 状态管理器接口 */
export interface StateManager {
  /** 获取完整状态对象的深拷贝 */
  getState(): Record<string, unknown>;
  /** 根据路径获取状态值 */
  get<R>(path: string): R | undefined;
  /** 设置状态值 */
  set(path: string, value: unknown, silent?: boolean): void;
  /** 订阅状态变化 */
  subscribe(path: string, listener: (newVal: unknown, oldVal: unknown) => void): () => void;
}

/** 事件总线接口 */
export interface EventBus {
  /** 监听事件，返回取消监听的函数 */
  on<T>(event: string, handler: (payload: T) => void): () => void;
  /** 一次性订阅 — 触发一次后自动取消 */
  once<T>(event: string, handler: (payload: T) => void): () => void;
  /** 取消监听事件 */
  off<T>(event: string, handler: (payload: T) => void): void;
  /** 清空指定事件的所有订阅者，不传则清空全部 */
  offAll(event?: string): void;
  /** 触发事件 */
  emit<T>(event: string, payload?: T): void;
}

/** 钩子系统接口 */
export interface HookSystem {
  /** 注册钩子处理器 */
  register<T, R>(name: string, handler: (ctx: T) => R): () => void;
  /** 执行钩子 */
  run<T, R>(name: string, context: T): R;
}

/** 插件上下文 — 插件安装时获得的上下文对象 */
export interface PluginContext<P = PlayerHost> {
  /** 宿主实例（由上层包收窄为具体类型） */
  player: P;
  /** 状态管理器 */
  state: StateManager;
  /** 事件总线 */
  events: EventBus;
  /** 钩子系统 */
  hooks: HookSystem;
  /** 日志输出函数 — 自动带插件名前缀 */
  log: (msg: string) => void;
}

/** 预定义钩子常量 */
export const PlayerHooks = {
  /** 播放前钩子 */
  BEFORE_PLAY: 'player:beforePlay',
  /** 播放后钩子 */
  AFTER_PLAY: 'player:afterPlay',
  /** 跳转前钩子 */
  BEFORE_SEEK: 'player:beforeSeek',
  /** 跳转后钩子 */
  AFTER_SEEK: 'player:afterSeek',
} as const;
