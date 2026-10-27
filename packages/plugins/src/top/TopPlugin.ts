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
import { injectPluginStyle } from "../utils/injectStyle";
import topCss from "./style.scss?inline";

export interface TopPluginMountContext extends SlotContext {
  props?: TopProps;
}

export interface TopPluginConfig {
  id?: string;
  /** Top 数据（标题 / UP / 追剧态 / 音乐信息等）由插件自己持有 */
  data?: Partial<TopProps>;
  /** 自定义挂载；不传则使用内置完整 Top 视图 */
  mount?: SlotMount["mount"];
}

/** 音乐插件最小可调用接口（避免 top 包反向依赖 music 实现） */
interface MusicPluginLike {
  open?(): void;
  isOpen?(): boolean;
}

interface TopPluginHost {
  registerTopPluginMount(mount: SlotMount["mount"]): void;
  unregisterTopPluginMount(mount?: SlotMount["mount"]): void;
  refreshTop?(): void;
  /** 是否已安装指定插件（音乐模式 gating 用） */
  hasPlugin?(name: string): boolean;
  /** 获取已安装插件实例（Top 音乐条打开面板用） */
  getPlugin?(name: string): MusicPluginLike | undefined;
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
    injectPluginStyle("top", topCss);
    const custom = this.config.mount;
    const registered: SlotMount["mount"] = (container, ctx) => {
      if (custom) return custom(container, ctx);
      const viewProps = (ctx as TopPluginMountContext | null)?.props;
      /**
       * 音乐模式 gating：只有安装了音乐插件（默认名 music）时才允许
       * 进入音乐 Top 形态；未安装时即使调用方传入 music 也回落普通 Top。
       *
       * 数据优先级沿用原合并语义：插件 config.data 优先于播放器透传的 viewProps。
       */
      const musicInstalled = this.player?.hasPlugin?.("music") ?? false;
      const requestedMusic =
        this.config.data?.music ?? viewProps?.music ?? false;
      const vnode = h(TopView, {
        ...viewProps,
        ...this.config.data,
        music: requestedMusic && musicInstalled,
        host: container,
        /** 点击 Top 音乐条：音乐面板默认关闭，只有这里主动 open */
        onMusicClick: (): void => {
          const music = this.player?.getPlugin?.("music");
          if (!music || music.isOpen?.()) return;
          music.open?.();
        },
      });
      mount(vnode, container);
      return () => destroy(vnode);
    };
    this.registered = registered;
    this.player.registerTopPluginMount(registered);
    this.player.refreshTop?.();
  }

  uninstall(): void {
    if (this.registered) {
      this.player?.unregisterTopPluginMount(this.registered);
    }
    this.player?.refreshTop?.();
    this.registered = null;
    this.player = null;
  }
}

export function TopPlugin(config: TopPluginConfig = {}): Plugin {
  return new TopPluginClass(config);
}
