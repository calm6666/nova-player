/**
 * ============================================
 * Top 插件（结构对齐 DanmakuPlugin）
 * ============================================
 * 插件只向核心已有的 .nova-player-top-wrap 容器内挂载内容；
 * 不创建包装 DOM、不新增类名、不替换根容器。
 */

import type { Plugin } from "@/nova/core/plugin";
import type { SlotMount } from "@/nova/types/slots";


export interface TopPluginConfig {
  /** 插件名 / 注册 id */
  id?: string;
  /** 在已有 Top 根容器内渲染，返回可选清理函数 */
  mount: SlotMount["mount"];
}

interface TopPluginHost {
  registerTopPluginMount(mount: SlotMount["mount"]): void;
  unregisterTopPluginMount(mount?: SlotMount["mount"]): void;
}

class TopPluginClass implements Plugin {
  readonly name: string;
  readonly version = "1.0.0";
  readonly description: string;
  private readonly config: TopPluginConfig;
  private player: TopPluginHost | null = null;

  constructor(config: TopPluginConfig) {
    this.config = config;
    this.name = config.id ?? "top";
    this.description = `Top plugin: ${this.name}`;
  }

  install(player: Parameters<Plugin["install"]>[0]): void {
    this.player = player as unknown as TopPluginHost;
    this.player.registerTopPluginMount(this.config.mount);
  }

  uninstall(): void {
    this.player?.unregisterTopPluginMount(this.config.mount);
    this.player = null;
  }
}

/** 创建 Top 插件 */
export function TopPlugin(config: TopPluginConfig): Plugin {
  return new TopPluginClass(config);
}
