/**
 * ============================================
 * Ending 插件（结构对齐 DanmakuPlugin）
 * ============================================
 * 完整 Ending 视图已迁到本包；插件只向核心已有的 .nova-player-ending-wrap 容器内挂载，
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
import { Ending as EndingView, type EndingProps } from "./EndingView";

export interface EndingPluginMountContext extends SlotContext {
  props?: EndingProps;
}

export interface EndingPluginConfig {
  id?: string;
  /** 自定义挂载；不传则使用内置完整 Ending 视图 */
  mount?: SlotMount["mount"];
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
  private registered: SlotMount["mount"] | null = null;

  constructor(config: EndingPluginConfig) {
    this.config = config;
    this.name = config.id ?? "ending";
    this.description = `Ending plugin: ${this.name}`;
  }

  install(player: Parameters<Plugin["install"]>[0]): void {
    this.player = player as unknown as EndingPluginHost;
    const custom = this.config.mount;
    const registered: SlotMount["mount"] = (container, ctx) => {
      if (custom) return custom(container, ctx);
      const viewProps = (ctx as EndingPluginMountContext | null)?.props;
      const vnode = h(EndingView, { ...viewProps, host: container });
      mount(vnode, container);
      return () => destroy(vnode);
    };
    this.registered = registered;
    this.player.registerEndingPluginMount(registered);
  }

  uninstall(): void {
    if (this.registered) {
      this.player?.unregisterEndingPluginMount(this.registered);
    }
    this.registered = null;
    this.player = null;
  }
}

export function EndingPlugin(config: EndingPluginConfig = {}): Plugin {
  return new EndingPluginClass(config);
}
