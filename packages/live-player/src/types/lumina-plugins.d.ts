/**
 * 本包使用到的 `packages/plugins` 模块的最小类型声明。
 *
 * 目的：让 `@lumina/live-player` 的类型检查与点播播放器包解耦，
 * 只消费插件在运行期真实提供的 API，避免把整个 `packages/player`
 * 的类型图谱拖进本包（两者定位互相独立）。
 *
 * 运行期仍然由 Vite alias 加载真实插件实现。
 */

interface LivePlayerPluginQuality {
  /** 档位 id（自动档为 'auto'）。 */
  id: string;
  /** 展示文案。 */
  label: string;
  /** 视频宽度。 */
  width: number;
  /** 视频高度。 */
  height: number;
  /** 码率。 */
  bitrate: number;
  /** 是否自动档。 */
  isAuto?: boolean;
}

interface LivePlayerStreamStats {
  downloadSpeed?: number;
  videoBitrate?: number;
  audioBitrate?: number;
  bufferLength?: number;
  totalStallCount?: number;
  totalStallTime?: number;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: { width: number; height: number };
}

/** 流媒体插件最小接口（HLS / FLV 共用）。 */
interface LivePlayerStreamPlugin {
  /** 视频元素。 */
  videoElement: HTMLVideoElement | null;
  /** 是否支持当前浏览器。 */
  isSupported(): boolean;
  /** 加载媒体。 */
  load(config: { url: string; format: unknown; isLive?: boolean; startTime?: number }): void;
  /** 销毁。 */
  destroy(): void;
  /** 设置清晰度。 */
  setQuality(quality: string): void;
  /** 当前清晰度。 */
  getCurrentQuality(): string;
  /** 清晰度列表。 */
  getQualities(): LivePlayerPluginQuality[];
  /** 统计信息。 */
  getStats(): LivePlayerStreamStats;
  /** 订阅清晰度变化。 */
  onQualitiesChange?(cb: (list: LivePlayerPluginQuality[]) => void): () => void;
  /** 插件私有事件总线。 */
  getStreamEventBus(): { on(type: string, cb: (payload: unknown) => void): () => void };
}

/** 插件返回的弹幕渲染项（继承 DanmakuItem 字段）。 */
interface LivePlayerDanmakuRenderItem {
  /** 渲染 id。 */
  renderId: string;
  /** 弹幕文本。 */
  text: string;
  /** 发送者 uid。 */
  uid?: string | number;
  /** 发送者名称。 */
  userName?: string;
  /** 颜色。 */
  color?: string;
  /** 所在 DOM 元素。 */
  element?: HTMLElement;
}

declare module '@/lumina/plugins/hls' {
  export function createHlsPlugin(config?: Record<string, unknown>): LivePlayerStreamPlugin;
}

declare module '@/lumina/plugins/flv' {
  export function createFlvPlugin(config?: Record<string, unknown>): LivePlayerStreamPlugin;
}

declare module '@/lumina/plugins/utils/injectStyle' {
  export function injectPluginStyle(id: string, css: string): void;
}

declare module '@/lumina/plugins/utils/danmaku' {
  export enum RenderMode {
    DOM = 'dom',
    CANVAS = 'canvas',
    AUTO = 'auto',
  }

  export class DanmakuManager {
    constructor(options: Record<string, unknown>, events?: Record<string, unknown>);
    setOnDanmakuHover(
      callback: (
        danmaku: LivePlayerDanmakuRenderItem | null,
        position: { x: number; y: number } | null,
      ) => void,
    ): void;
    play(): void;
    pause(): void;
    clear(): void;
    destroy(): void;
    loadDanmaku(list: unknown[]): void;
    sendDanmaku(text: string, options?: Record<string, unknown>): void;
    setVisible(visible: boolean): void;
    setOpacity(opacity: number): void;
    setAreaRatio(ratio: number): void;
    setFontSizeScale(scale: number): void;
    setSpeedMultiplier(multiplier: number): void;
    setDensity(density: number): void;
    setAutoScale(autoScale: boolean): void;
    setFilter(filter: Record<string, boolean | undefined>): void;
  }
}
