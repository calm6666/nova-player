/**
 * 流媒体加载器。
 *
 * 复用 `packages/plugins` 的 `createHlsPlugin` / `createFlvPlugin`：
 * - `.m3u8` 交给 HLS 插件；
 * - `.flv` 交给 FLV 插件；
 * - 其它地址按浏览器原生 `<video>` 源处理。
 *
 * 插件在真正加载时才动态导入，避免服务端求值与首屏无关的库体积。
 * 清晰度、错误与统计信息统一收敛成本模块的结构化结果，供根元素消费。
 */

import { StreamFormatEnum, StreamPluginEventEnum } from '@/types/streamPlugin';

/** 流类型。 */
export type StreamKind = 'hls' | 'flv' | 'native';

/** 插件给出的清晰度（未本地化）。 */
export interface StreamQuality {
  /** 档位标识。 */
  qn: string;
  /** 展示文案（自动档为空串，由调用方本地化）。 */
  label: string;
  /** 视频高度（像素）。 */
  height: number;
  /** 是否自动档。 */
  auto: boolean;
}

/** 流统计信息。 */
export interface StreamSnapshot {
  /** 缓冲秒数。 */
  buffer: number;
  /** 下载速度（字节/秒）。 */
  downloadSpeed: number;
  /** 视频码率（比特/秒）。 */
  videoBitrate: number;
  /** 分辨率文本。 */
  resolution: string;
}

/**
 * 根据地址推断流类型。
 *
 * @param url - 流地址。
 * @returns 流类型。
 */
export function detectStreamKind(url: string): StreamKind {
  let pathname = url;
  try {
    pathname = new URL(url, window.location.href).pathname;
  } catch {
    pathname = url.split('?')[0];
  }
  const lower = pathname.toLowerCase();
  if (lower.endsWith('.m3u8')) return 'hls';
  if (lower.endsWith('.flv')) return 'flv';
  return 'native';
}

/** 直播流加载器。 */
export class LiveStreamLoader {
  /** 视频元素。 */
  private readonly video: HTMLVideoElement;

  /** 当前插件。 */
  private plugin: LivePlayerStreamPlugin | null = null;

  /** 当前流类型。 */
  private kind: StreamKind = 'native';

  /** 当前流地址。 */
  private url = '';

  /** 插件订阅取消函数。 */
  private unsubs: Array<() => void> = [];

  /** 清晰度变化回调。 */
  public onQualities: ((list: StreamQuality[], current: string) => void) | null = null;

  /** 流错误回调。 */
  public onError: ((message: string) => void) | null = null;

  /**
   * @param video - 承载播放的视频元素。
   */
  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  /** 当前流类型。 */
  getKind(): StreamKind {
    return this.kind;
  }

  /** 当前流地址。 */
  getUrl(): string {
    return this.url;
  }

  /** 加载流地址。 */
  async load(url: string): Promise<void> {
    this.disposePlugin();
    this.url = url;
    this.kind = detectStreamKind(url);

    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();

    try {
      if (this.kind === 'hls') {
        const module = await import('@/lumina/plugins/hls');
        if (!this.url) return;
        const plugin = module.createHlsPlugin({ autoplay: false, useLocalHls: false });
        if (!plugin.isSupported()) {
          this.onError?.('HLS is not supported in the current browser');
          return;
        }
        this.plugin = plugin;
        plugin.videoElement = this.video;
        const offQualities = plugin.onQualitiesChange?.((list): void => {
          this.emitQualities(list);
        });
        const offError = plugin.getStreamEventBus().on(StreamPluginEventEnum.ERROR, (payload): void => {
          this.onError?.(readErrorMessage(payload));
        });
        this.unsubs.push(offError);
        if (offQualities) this.unsubs.push(offQualities);
        plugin.load({ url, format: StreamFormatEnum.HLS, isLive: true });
        this.emitQualities(plugin.getQualities());
      } else if (this.kind === 'flv') {
        const module = await import('@/lumina/plugins/flv');
        if (!this.url) return;
        const plugin = module.createFlvPlugin({ autoplay: false, isLive: true });
        if (!plugin.isSupported()) {
          this.onError?.('FLV is not supported in the current browser');
          return;
        }
        this.plugin = plugin;
        plugin.videoElement = this.video;
        const offError = plugin.getStreamEventBus().on(StreamPluginEventEnum.ERROR, (payload): void => {
          this.onError?.(readErrorMessage(payload));
        });
        this.unsubs.push(offError);
        plugin.load({ url, format: StreamFormatEnum.FLV, isLive: true });
        this.emitQualities([]);
      } else {
        this.video.src = url;
        this.emitQualities([]);
      }
    } catch (error) {
      this.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /** 切换清晰度（仅 HLS 支持）。 */
  setQuality(qn: string): void {
    this.plugin?.setQuality(qn);
  }

  /** 当前清晰度。 */
  getCurrentQuality(): string {
    return this.plugin?.getCurrentQuality() ?? '';
  }

  /** 实时统计。 */
  getSnapshot(): StreamSnapshot {
    const video = this.video;
    const buffered = video.buffered;
    const buffer =
      buffered.length > 0 ? Math.max(0, buffered.end(buffered.length - 1) - video.currentTime) : 0;
    const nativeStats = this.plugin?.getStats() ?? {};
    const width = video.videoWidth;
    const height = video.videoHeight;
    return {
      buffer,
      downloadSpeed: nativeStats.downloadSpeed ?? 0,
      videoBitrate: nativeStats.videoBitrate ?? 0,
      resolution: width > 0 && height > 0 ? `${width} x ${height}` : '-',
    };
  }

  /** 重新加载。 */
  async reload(): Promise<void> {
    const url = this.url;
    if (!url) return;
    await this.load(url);
  }

  /** 销毁。 */
  destroy(): void {
    this.disposePlugin();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    this.url = '';
  }

  /** 释放插件。 */
  private disposePlugin(): void {
    for (const off of this.unsubs.splice(0)) off();
    this.plugin?.destroy();
    this.plugin = null;
  }

  /** 广播清晰度。 */
  private emitQualities(list: LivePlayerPluginQuality[]): void {
    const mapped: StreamQuality[] = list.map((level) => ({
      qn: level.isAuto ? 'auto' : level.id,
      label: level.isAuto ? '' : level.label || `${level.height}p`,
      height: level.height,
      auto: Boolean(level.isAuto),
    }));
    this.onQualities?.(mapped, this.getCurrentQuality());
  }
}

/** 从插件错误载荷提取可读文案。 */
function readErrorMessage(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'stream error';
}
