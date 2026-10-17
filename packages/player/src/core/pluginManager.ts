/**
 * ============================================
 * 插件管理器
 * ============================================
 * 管理插件的生命周期，提供插件上下文
 * 每个插件管理器实例管理一组插件，拥有独立的状态、事件和钩子系统
 */

import type { Plugin, PluginContext } from "./plugin";
import type { VideoPlayer } from "@/nova/index";
import type { StreamPlugin } from "@/types/streamPlugin";
import { createStateManager } from "@/core/state";
import { createTypedEventBus } from "@/core/eventBus";
import { createHookSystem } from "@/core/hooks";
import type { TypedStateManager, PlayerEventBus, HookSystem } from "@/core";
import { PlayerEventMap } from "@/core/events";
import { createLogger } from "@/utils";

const logger = createLogger("PluginManager");

/**
 * 插件管理器类
 * 负责插件的安装、卸载和管理
 */
export class PluginManager {
  /**
   * 已安装插件的映射表
   * key: 插件名称
   * value: 插件实例
   */
  private plugins = new Map<string, Plugin>();

  /**
   * 关联的播放器实例
   */
  private player: VideoPlayer;

  /**
   * 插件专用的状态管理器
   * 插件可以使用此状态管理器存储自己的状态
   */
  state: TypedStateManager;

  /**
   * 插件专用的事件总线
   * 插件可以使用此事件总线进行通信
   */
  events: PlayerEventBus;

  /**
   * 插件专用的钩子系统
   * 插件可以使用此钩子系统扩展功能
   */
  hooks: HookSystem;

  /**
   * 插件上下文
   * 插件安装时获得的上下文对象，包含播放器实例和各种系统
   * 插件可通过 player.pluginManager.context 访问
   */
  context: PluginContext | null = null;

  /**
   * 创建插件管理器实例
   * @param player - 关联的播放器实例
   */
  constructor(player: VideoPlayer) {
    this.player = player;
    this.state = createStateManager();
    this.events = createTypedEventBus<PlayerEventMap>();
    this.hooks = createHookSystem();
  }

  /**
   * 判断插件是否为流媒体插件
   * @param p - 插件实例
   * @returns 是否为 StreamPlugin
   */
  private isStreamPlugin(p: Plugin): p is Plugin & StreamPlugin {
    return "type" in p && "load" in p && "getStats" in p;
  }

  /**
   * 安装插件
   * @param plugin - 要安装的插件
   */
  install(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      logger.warn(`Plugin "${plugin.name}" already installed`);
      return;
    }

    // 创建插件上下文（供插件使用）
    const context: PluginContext = {
      player: this.player,
      state: this.state,
      events: this.events,
      hooks: this.hooks,
      log: (msg) => logger.info(`[Plugin:${plugin.name}] ${msg}`),
    };

    // 保存上下文到 PluginManager，插件可通过 player.pluginManager.context 访问
    this.context = context;

    plugin.install(this.player);

    // 调试模式继承：如果插件有 options 且 options.debug 未定义，则继承播放器的 debug 设置
    if ("options" in plugin) {
      const pluginWithOpts = plugin as Plugin & {
        options: Record<string, unknown>;
      };
      if (
        pluginWithOpts.options &&
        pluginWithOpts.options.debug === undefined
      ) {
        // 新命名空间为 advanced.debug；兼容迁移期仍读取旧扁平键 debug 的调用方
        const legacy: Record<string, unknown> = this.player.props;
        const legacyDebug =
          typeof legacy.debug === "boolean" ? legacy.debug : undefined;
        pluginWithOpts.options.debug =
          this.player.props.advanced?.debug ?? legacyDebug;
      }
    }

    // StreamPlugin 检测：自动注册到流媒体中间件
    if (this.isStreamPlugin(plugin)) {
      this.player.streamMiddleware?.registerStreamPlugin(plugin);
    }

    this.plugins.set(plugin.name, plugin);
    logger.info(`Plugin "${plugin.name}" installed successfully`);
  }

  /**
   * 卸载插件
   * @param name - 要卸载的插件名称
   */
  uninstall(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) return;

    // StreamPlugin 检测：卸载前从流媒体中间件注销（只注销该插件，保留其它流媒体插件）
    if (this.isStreamPlugin(plugin)) {
      this.player.streamMiddleware?.unregisterStreamPlugin(plugin);
    }

    if (plugin.uninstall) {
      plugin.uninstall(this.player);
    }
    this.plugins.delete(name);
    logger.info(`Plugin "${name}" uninstalled successfully`);
  }

  /**
   * 获取已安装的插件
   * @param name - 插件名称
   * @returns 插件实例，未安装则返回 undefined
   */
  get<T extends Plugin>(name: string): T | undefined {
    // 泛型 T 是 Plugin 的子类型，Map 存储的是 Plugin 基类
    // 调用方通过泛型参数指定具体插件类型，类型安全由调用方保证
    const plugin = this.plugins.get(name);
    if (!plugin) return undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return plugin as T;
  }

  /**
   * 判断插件是否已安装（UI 按需渲染的依据：
   * 未装弹幕/字幕/交互插件时不挂载对应图层与控制入口）
   * @param name - 插件名称
   * @returns 是否已安装
   */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * 遍历所有已安装的插件
   * @param callback - 对每个插件执行的回调
   */
  forEachPlugin(callback: (plugin: Plugin) => void): void {
    this.plugins.forEach((plugin) => callback(plugin));
  }

  /**
   * 销毁插件管理器
   * 卸载所有插件并清理资源
   */
  destroy(): void {
    this.plugins.forEach((_, name) => this.uninstall(name));
  }
}
