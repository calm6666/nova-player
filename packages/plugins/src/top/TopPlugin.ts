/**
 * ============================================
 * Top 插件（结构对齐 DanmakuPlugin）
 * ============================================
 * 完整 Top 视图已迁到本包；插件只向核心已有的 .nova-player-top-wrap 容器内挂载，
 * 不创建包装 DOM、不新增类名、不替换根容器。
 */

import {
  h,
  mount,
  destroy,
  type Plugin,
  type SlotContext,
  type SlotMount,
} from "@lumina/nova";
import { Top as TopView, type TopProps } from "./TopView";

export interface TopPluginMountContext extends SlotContext {
  props?: TopProps;
}

export interface TopPluginConfig {
  id?: string;
  /** 自定义挂载；不传则使用内置完整 Top 视图 */
  mount?: SlotMount["mount"];
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
  private registered: SlotMount["mount"] | null = null;

  constructor(config: TopPluginConfig) {
    this.config = config;
    this.name = config.id ?? "top";
    this.description = `Top plugin: ${this.name}`;
  }

  install(player: Parameters<Plugin["install"]>[0]): void {
    this.player = player as unknown as TopPluginHost;
    const custom = this.config.mount;
    const registered: SlotMount["mount"] = (container, ctx) => {
      if (custom) return custom(container, ctx);
      const viewProps = (ctx as TopPluginMountContext | null)?.props;
      const vnode = h(TopView, { ...viewProps, host: container });
      mount(vnode, container);
      return () => destroy(vnode);
    };
    this.registered = registered;
    this.player.registerTopPluginMount(registered);
  }

  uninstall(): void {
    if (this.registered) {
      this.player?.unregisterTopPluginMount(this.registered);
    }
    this.registered = null;
    this.player = null;
  }
}

export function TopPlugin(config: TopPluginConfig = {}): Plugin {
  return new TopPluginClass(config);
}
