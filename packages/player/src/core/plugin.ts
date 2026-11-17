/**
 * ============================================
 * 插件系统核心类型定义
 * ============================================
 * 定义插件系统所需的所有接口和类型
 * 包括插件接口、状态管理器、事件总线、钩子系统等
 */

import type { VideoPlayer } from "../player/VideoPlayer";
import type { TypedStateManager } from "@lumina/framework/core";
import type { PlayerEventBus } from "../types/events";
import type { PluginOptions } from "@lumina/framework/types/plugin";
import type { VNode } from "@lumina/framework/types";
export type { PlayerEventBus };

/**
 * 插件 UI 区域贡献
 *
 * 播放器只提供区域和宿主 props，具体渲染由插件决定；
 * SSR 阶段同样读取该贡献，保证发送栏等关键 UI 不掉首屏。
 */
export interface PluginUiContribution {
  /** 唯一 id */
  id: string;
  /** 目标区域 */
  region: "controls.sendbar";
  /** 渲染函数：入参为播放器提供的宿主 props */
  render: (host: unknown) => VNode | null;
}
// 通用插件选项由框架层定义，播放器出口统一再导出（插件包经 @lumina/nova 消费）
export type { PluginOptions };

/**
 * 插件接口
 * 所有插件必须实现此接口
 */
export interface Plugin {
  /** 插件名称，必须唯一 */
  readonly name: string;
  /** 插件版本号 */
  readonly version?: string;
  /** 插件描述 */
  readonly description?: string;
  /** 依赖的其他插件名称列表 */
  readonly dependencies?: string[];
  /**
   * 插件贡献的 UI 区域内容
   *
   * 以普通属性声明，SSR 阶段无需执行 install 即可被播放器读取。
   */
  readonly uiContributions?: readonly PluginUiContribution[];

  /**
   * 安装插件
   * 插件被安装时调用，用于初始化插件
   * @param player - 播放器实例
   */
  install(player: VideoPlayer): void;

  /**
   * 卸载插件（可选）
   * 插件被卸载时调用，用于清理资源
   * @param player - 播放器实例
   */
  uninstall?(player: VideoPlayer): void;

  /**
   * 启用插件（可选）
   * 插件被启用时调用
   */
  enable?(): void;

  /**
   * 禁用插件（可选）
   * 插件被禁用时调用
   */
  disable?(): void;

  /**
   * 加载流媒体（可选，仅流媒体插件实现）
   * @param config - 流媒体配置
   */
  load?(config: unknown): void;
}

/**
 * 状态管理器接口
 * 提供集中式状态存储和订阅机制
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
}

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
 * 插件上下文
 * 插件安装时获得的上下文对象，包含播放器实例和各种系统
 */
export interface PluginContext {
  /** 播放器实例 */
  player: VideoPlayer;
  /** 状态管理器 */
  state: TypedStateManager;
  /** 事件总线 */
  events: PlayerEventBus;
  /** 钩子系统 */
  hooks: HookSystem;
  /** 日志输出函数 */
  log: (msg: string) => void;
}

/**
 * 预定义钩子常量
 * 定义播放器核心钩子名称，插件可以注册这些钩子来介入播放器行为
 */
export const PlayerHooks = {
  /** 播放前钩子，可用于修改播放参数 */
  BEFORE_PLAY: "player:beforePlay",
  /** 播放后钩子，可用于统计播放次数 */
  AFTER_PLAY: "player:afterPlay",
  /** 跳转前钩子，可用于修改跳转目标时间 */
  BEFORE_SEEK: "player:beforeSeek",
  /** 跳转后钩子，可用于记录跳转历史 */
  AFTER_SEEK: "player:afterSeek",
} as const;
