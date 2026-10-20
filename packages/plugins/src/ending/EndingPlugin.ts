/**
 * ============================================
 * Ending 插件（结构对齐 DanmakuPlugin）
 * ============================================
 * 插件只向核心已有的 .nova-player-ending-wrap 容器内挂载内容；
 * 不创建包装 DOM、不新增类名、不替换根容器。
 */

import type { Plugin } from "@/nova/core/plugin";
import type { SlotMount } from "@/nova/types/slots";


export interface EndingPluginConfig {
  /** 插件名 / 注册 id */
  id?: string;
  /** 在已有 Ending 根容器内渲染，返回可选清理函数 */
  mount: SlotMount["mount"];
}

interface EndingPluginHost {
  registerEndingPluginMount(mount: SlotMount["mount"]): void;
  unregisterEndingPluginMount(mount?: SlotMount["mount"]): void;
}

class EndingPluginClass implements Plugin {
  readonly name: string;
  readonly version = "1.0.0";
  readonly description: string;
  private readonly config: EndingPluginConfig;
  private player: EndingPluginHost | null = null;

  constructor(config: EndingPluginConfig) {
    this.config = config;
    this.name = config.id ?? "ending";
    this.description = `Ending plugin: ${this.name}`;
  }

  install(player: Parameters<Plugin["install"]>[0]): void {
    this.player = player as unknown as EndingPluginHost;
    this.player.registerEndingPluginMount(this.config.mount);
  }

  uninstall(): void {
    this.player?.unregisterEndingPluginMount(this.config.mount);
    this.player = null;
  }
}

/** 创建 Ending 插件 */
export function EndingPlugin(config: EndingPluginConfig): Plugin {
  return new EndingPluginClass(config);
}
