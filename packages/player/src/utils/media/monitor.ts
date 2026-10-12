/**
 * 媒体播放器监控器
 * 支持 dash.js、hls.js、flv.js 和原生视频播放器
 * 提供码率、缓冲区、帧率等实时监控
 */

import {
  PlayerType,
  StreamingProtocol,
  BitrateDataPoint,
  ThroughputDataPoint,
  BufferDataPoint,
  FrameRateDataPoint,
  PlayerStats,
  PlayerDetails,
  MonitorConfig,
  MonitorCallbacks,
  type DashPlayer,
  type HlsPlayer,
  type FlvPlayer,
} from './types';
import { createLogger } from '@/utils';

const logger = createLogger('Monitor');

// ============================================
// 类型守卫
// ============================================

/** 带有播放器实例的视频元素 */
interface VideoWithPlayer extends HTMLVideoElement {
  dash?: DashPlayer;
  hls?: HlsPlayer;
  flv?: FlvPlayer;
}

function hasPlayerInstance(video: HTMLVideoElement): video is VideoWithPlayer {
  return 'dash' in video || 'hls' in video || 'flv' in video;
}

function isDashPlayer(player: unknown): player is DashPlayer {
  return typeof player === 'object' && player !== null && 'getCurrentTrackFor' in player;
}

function isHlsPlayer(player: unknown): player is HlsPlayer {
  return typeof player === 'object' && player !== null && 'levels' in player;
}

function hasCodec(track: unknown): track is { codec?: string } {
  return typeof track === 'object' && track !== null && 'codec' in track;
}

/**
 * 从原生播放器实例读取当前选中清晰度的静态码率
 *
 * 实例来源：StreamPlugin.getNativePlayer()（hls.js 的 Hls 实例 /
 * dash.js 的 MediaPlayer 实例）；flv.js 与原生播放无静态码率概念，
 * 返回 null 由调用方回退到其它采样方式（如 webkitDecodedByteCount 差分）。
 *
 * 读取逻辑与 MediaPlayerMonitor.collectBitrateData 的 DASH/HLS 分支一致。
 *
 * @param instance - 原生播放器实例（unknown，经类型谓词收窄）
 * @returns 码率三元组（bps）；实例不可识别 / 未就绪时返回 null
 */
export function readNativeBitrate(
  instance: unknown,
): { totalBitrate: number; videoBitrate: number; audioBitrate: number } | null {
  if (isDashPlayer(instance)) {
    try {
      const videoRepresentation = instance.getCurrentRepresentationForType?.('video');
      const audioRepresentation = instance.getCurrentRepresentationForType?.('audio');
      const videoBitrate = videoRepresentation?.bandwidth || 0;
      const audioBitrate = audioRepresentation?.bandwidth || 0;
      return { totalBitrate: videoBitrate + audioBitrate, videoBitrate, audioBitrate };
    } catch (e) {
      logger.error('Failed to read DASH bitrate:', e);
      return null;
    }
  }
  if (isHlsPlayer(instance)) {
    try {
      let videoBitrate = 0;
      let audioBitrate = 0;
      if (instance.levels && instance.currentLevel >= 0) {
        videoBitrate = instance.levels[instance.currentLevel]?.bitrate || 0;
      }
      if (instance.audioTracks && instance.audioTrack >= 0) {
        audioBitrate = instance.audioTracks[instance.audioTrack]?.bitrate || 0;
      }
      return { totalBitrate: videoBitrate + audioBitrate, videoBitrate, audioBitrate };
    } catch (e) {
      logger.error('Failed to read HLS bitrate:', e);
      return null;
    }
  }
  return null;
}

/** 默认配置 */
const DEFAULT_CONFIG: Required<MonitorConfig> = {
  maxDataPoints: 60,
  updateInterval: 1000,
  enableBitrate: true,
  enableThroughput: true,
  enableBuffer: true,
  enableFPS: true,
};

export class MediaPlayerMonitor {
  /** 视频元素 */
  private video: HTMLVideoElement;
  /** 播放器实例 (dash.js/hls.js/flv.js) */
  private player: DashPlayer | HlsPlayer | FlvPlayer | null = null;
  /** 播放器类型 */
  private playerType: PlayerType = PlayerType.UNKNOWN;
  /** 配置 */
  private config: Required<MonitorConfig>;
  /** 回调函数 */
  private callbacks: MonitorCallbacks;
  /** 是否正在监控 */
  private isMonitoring = false;
  /** 定时器 ID */
  private timerId: number | null = null;
  /** 码率历史数据 (当前选中清晰度的静态码率) */
  private bitrateData: BitrateDataPoint[] = [];
  /** 吞吐量历史数据 (实际下载速度) */
  private throughputData: ThroughputDataPoint[] = [];
  /** 缓冲区历史数据 */
  private bufferData: BufferDataPoint[] = [];
  /** 帧率历史数据 */
  private fpsData: FrameRateDataPoint[] = [];
  /** 上一帧时间 */
  private lastFrameTime = 0;
  /** 帧计数 */
  private frameCount = 0;
  /** 丢帧计数 */
  private droppedFrameCount = 0;

  // 滑动窗口吞吐量计算
  private throughputWindow: number[] = [];
  private readonly THROUGHPUT_WINDOW_SIZE = 10;
  private lastCheckTime = 0;
  private lastCheckBytes = 0;

  constructor(
    video: HTMLVideoElement,
    config: MonitorConfig = {},
    callbacks: MonitorCallbacks = {}
  ) {
    this.video = video;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.callbacks = callbacks;
    this.detectPlayerType();
  }

  /**
   * 设置播放器实例
   * @param player dash.js/hls.js/flv.js 实例
   * @param type 播放器类型
   */
  setPlayer(player: DashPlayer | HlsPlayer | FlvPlayer, type: PlayerType): void {
    this.player = player;
    this.playerType = type;
  }

  /**
   * 检测播放器类型
   */
  private detectPlayerType(): void {
    if (hasPlayerInstance(this.video)) {
      if (this.video.dash) {
        this.player = this.video.dash;
        this.playerType = PlayerType.DASH;
      } else if (this.video.hls) {
        this.player = this.video.hls;
        this.playerType = PlayerType.HLS;
      } else if (this.video.flv) {
        this.player = this.video.flv;
        this.playerType = PlayerType.FLV;
      } else {
        this.playerType = PlayerType.NATIVE;
      }
    } else {
      this.playerType = PlayerType.NATIVE;
    }
  }

  /**
   * 开始监控
   */
  start(): void {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.droppedFrameCount = 0;

    // 开始定时收集数据
    this.timerId = window.setInterval(() => {
      this.collectData();
    }, this.config.updateInterval);

    // 监听帧渲染
    if (this.config.enableFPS) {
      this.observeFrameRate();
    }
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;

    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * 收集数据
   */
  private collectData(): void {
    if (!this.isMonitoring) return;

    const timestamp = Date.now();

    // 收集码率数据（当前选中清晰度的静态码率）
    if (this.config.enableBitrate) {
      this.collectBitrateData(timestamp);
    }

    // 收集吞吐量数据（实际下载速度）
    if (this.config.enableThroughput) {
      this.collectThroughputData(timestamp);
    }

    // 收集缓冲区数据
    if (this.config.enableBuffer) {
      this.collectBufferData(timestamp);
    }

    // 触发统计更新
    const stats = this.getStats();
    this.callbacks.onStatsUpdate?.(stats);
  }

  /**
   * 滑动窗口吞吐量计算
   * @param currentBytes 当前已下载字节数
   * @returns 平滑后的吞吐量 (bps)
   */
  private calculateThroughput(currentBytes: number): number {
    const timeDelta = (performance.now() - this.lastCheckTime) / 1000;
    if (timeDelta <= 0) return 0;
    const bytesDelta = currentBytes - this.lastCheckBytes;
    const throughput = (bytesDelta * 8) / timeDelta;
    this.throughputWindow.push(throughput);
    if (this.throughputWindow.length > this.THROUGHPUT_WINDOW_SIZE) {
      this.throughputWindow.shift();
    }
    const average = this.throughputWindow.reduce((a, b) => a + b, 0) / this.throughputWindow.length;
    this.lastCheckTime = performance.now();
    this.lastCheckBytes = currentBytes;
    return Math.round(average);
  }

  /**
   * 收集码率数据（当前选中清晰度的静态码率）
   */
  private collectBitrateData(timestamp: number): void {
    let totalBitrate = 0;
    let videoBitrate = 0;
    let audioBitrate = 0;

    switch (this.playerType) {
      case PlayerType.DASH: {
        try {
          // 获取当前视频和音频表示的静态码率
          const videoRepresentation = this.player?.getCurrentRepresentationForType?.('video');
          const audioRepresentation = this.player?.getCurrentRepresentationForType?.('audio');
          videoBitrate = videoRepresentation?.bandwidth || 0;
          audioBitrate = audioRepresentation?.bandwidth || 0;
          totalBitrate = videoBitrate + audioBitrate;
        } catch (e) {
          logger.error('获取DASH码率数据失败:', e);
        }
        break;
      }
      case PlayerType.HLS: {
        try {
          // 获取当前选中 level 和 audio track 的静态码率
          if (this.player?.levels && this.player.currentLevel >= 0) {
            videoBitrate = this.player.levels[this.player.currentLevel]?.bitrate || 0;
          }
          if (this.player?.audioTracks && this.player.audioTrack >= 0) {
            audioBitrate = this.player.audioTracks[this.player.audioTrack]?.bitrate || 0;
          }
          totalBitrate = videoBitrate + audioBitrate;
        } catch (e) {
          logger.error('获取HLS码率数据失败:', e);
        }
        break;
      }
      case PlayerType.FLV: {
        // flv.js 无法获取静态码率，使用 0
        break;
      }
      case PlayerType.NATIVE: {
        // 原生视频无法获取静态码率，使用 0
        break;
      }
    }

    const dataPoint: BitrateDataPoint = {
      timestamp,
      totalBitrate,
      videoBitrate,
      audioBitrate,
    };

    this.bitrateData.push(dataPoint);
    this.trimData(this.bitrateData);
    this.callbacks.onBitrateUpdate?.([...this.bitrateData]);
  }

  /**
   * 收集吞吐量数据（实际下载速度）
   */
  private collectThroughputData(timestamp: number): void {
    let totalThroughput = 0;
    let videoThroughput = 0;
    let audioThroughput = 0;

    switch (this.playerType) {
      case PlayerType.DASH: {
        try {
          // 使用 dash.js 的 DashMetrics 获取实际下载数据
          const dashMetrics = this.player?.getDashMetrics();
          if (!dashMetrics) break;
          const httpMetrics = dashMetrics.getHttpRequests('video') || [];

          // 计算总下载字节数
          let totalDownloadedBytes = 0;
          httpMetrics.forEach((req: { trace?: Array<{ s: number; b: number }> }) => {
            if (req.trace) {
              req.trace.forEach((trace) => {
                totalDownloadedBytes += trace.b || 0;
              });
            }
          });

          // 使用滑动窗口计算吞吐量
          if (this.lastCheckTime > 0) {
            totalThroughput = this.calculateThroughput(totalDownloadedBytes);
          } else {
            this.lastCheckTime = performance.now();
            this.lastCheckBytes = totalDownloadedBytes;
          }

          // 估算视频和音频吞吐量比例
          const videoRepresentation = this.player?.getCurrentRepresentationForType?.('video');
          const audioRepresentation = this.player?.getCurrentRepresentationForType?.('audio');
          const videoBandwidth = videoRepresentation?.bandwidth || 0;
          const audioBandwidth = audioRepresentation?.bandwidth || 0;
          const totalBandwidth = videoBandwidth + audioBandwidth;

          if (totalBandwidth > 0 && totalThroughput > 0) {
            videoThroughput = totalThroughput * (videoBandwidth / totalBandwidth);
            audioThroughput = totalThroughput * (audioBandwidth / totalBandwidth);
          } else {
            videoThroughput = totalThroughput;
          }
        } catch (e) {
          logger.error('获取DASH吞吐量数据失败:', e);
        }
        break;
      }
      case PlayerType.HLS: {
        try {
          // hls.js 使用 stats 获取加载信息
          const totalLoaded = this.player?.stats?.loaded || 0;

          // 使用滑动窗口计算吞吐量
          if (this.lastCheckTime > 0) {
            totalThroughput = this.calculateThroughput(totalLoaded);
          } else {
            this.lastCheckTime = performance.now();
            this.lastCheckBytes = totalLoaded;
          }

          // 估算视频和音频吞吐量比例
          let videoBandwidth = 0;
          let audioBandwidth = 0;
          if (this.player?.levels && this.player.currentLevel >= 0) {
            videoBandwidth = this.player.levels[this.player.currentLevel]?.bitrate || 0;
          }
          if (this.player?.audioTracks && this.player.audioTrack >= 0) {
            audioBandwidth = this.player.audioTracks[this.player.audioTrack]?.bitrate || 0;
          }
          const totalBandwidth = videoBandwidth + audioBandwidth;

          if (totalBandwidth > 0 && totalThroughput > 0) {
            videoThroughput = totalThroughput * (videoBandwidth / totalBandwidth);
            audioThroughput = totalThroughput * (audioBandwidth / totalBandwidth);
          } else {
            videoThroughput = totalThroughput;
          }
        } catch (e) {
          logger.error('获取HLS吞吐量数据失败:', e);
        }
        break;
      }
      case PlayerType.FLV: {
        // flv.js 的统计信息
        totalThroughput = (this.player?.statisticsInfo?.speed || 0) * 8; // 转换为 bps
        videoThroughput = totalThroughput * 0.9; // 估算
        audioThroughput = totalThroughput * 0.1;
        break;
      }
      case PlayerType.NATIVE: {
        // 原生视频无法获取吞吐量，使用 0
        break;
      }
    }

    const dataPoint: ThroughputDataPoint = {
      timestamp,
      totalThroughput,
      videoThroughput,
      audioThroughput,
    };

    this.throughputData.push(dataPoint);
    this.trimData(this.throughputData);
    this.callbacks.onThroughputUpdate?.([...this.throughputData]);
  }

  /**
   * 收集缓冲区数据
   */
  private collectBufferData(timestamp: number): void {
    let videoBuffer = 0;
    let audioBuffer = 0;

    switch (this.playerType) {
      case PlayerType.DASH: {
        // 使用 dash.js 真实 API
        try {
          videoBuffer = this.player?.getBufferLength?.('video') || 0;
          audioBuffer = this.player?.getBufferLength?.('audio') || 0;
        } catch (e) {
          logger.error('获取DASH缓冲区数据失败，回退到原生buffered:', e);
          const buffered = this.video.buffered;
          if (buffered.length > 0) {
            const currentTime = this.video.currentTime;
            for (let i = 0; i < buffered.length; i++) {
              if (buffered.start(i) <= currentTime && buffered.end(i) >= currentTime) {
                videoBuffer = buffered.end(i) - currentTime;
                break;
              }
            }
          }
          audioBuffer = videoBuffer;
        }
        break;
      }
      case PlayerType.HLS: {
        // hls.js 使用原生 buffered API
        const buffered = this.video.buffered;
        if (buffered.length > 0) {
          const currentTime = this.video.currentTime;
          for (let i = 0; i < buffered.length; i++) {
            if (buffered.start(i) <= currentTime && buffered.end(i) >= currentTime) {
              videoBuffer = buffered.end(i) - currentTime;
              break;
            }
          }
        }
        audioBuffer = videoBuffer;
        break;
      }
      case PlayerType.FLV:
      case PlayerType.NATIVE: {
        // 使用原生 buffered API
        const buffered = this.video.buffered;
        if (buffered.length > 0) {
          const currentTime = this.video.currentTime;
          for (let i = 0; i < buffered.length; i++) {
            if (buffered.start(i) <= currentTime && buffered.end(i) >= currentTime) {
              videoBuffer = buffered.end(i) - currentTime;
              break;
            }
          }
        }
        audioBuffer = videoBuffer;
        break;
      }
    }

    const dataPoint: BufferDataPoint = {
      timestamp,
      videoBuffer,
      audioBuffer,
    };

    this.bufferData.push(dataPoint);
    this.trimData(this.bufferData);
    this.callbacks.onBufferUpdate?.([...this.bufferData]);
  }

  /**
   * 观察帧率
   */
  private observeFrameRate(): void {
    if (!this.isMonitoring) return;

    const now = performance.now();
    const elapsed = now - this.lastFrameTime;

    if (elapsed >= 1000) {
      // 计算 FPS
      const fps = Math.round((this.frameCount * 1000) / elapsed);

      // 获取丢帧信息
      let droppedFrames = 0;
      if (typeof this.video.getVideoPlaybackQuality === 'function') {
        const quality = this.video.getVideoPlaybackQuality();
        if (quality) {
          droppedFrames = quality.droppedVideoFrames - this.droppedFrameCount;
          this.droppedFrameCount = quality.droppedVideoFrames;
        }
      }

      const dataPoint: FrameRateDataPoint = {
        timestamp: Date.now(),
        fps,
        droppedFrames,
      };

      this.fpsData.push(dataPoint);
      this.trimData(this.fpsData);
      this.callbacks.onFPSUpdate?.([...this.fpsData]);

      // 重置计数
      this.frameCount = 0;
      this.lastFrameTime = now;
    }

    this.frameCount++;
    requestAnimationFrame(() => this.observeFrameRate());
  }

  /**
   * 修剪数据数组，保持最大长度
   */
  private trimData<T>(data: T[]): void {
    if (data.length > this.config.maxDataPoints) {
      data.shift();
    }
  }

  /**
   * 获取当前统计信息
   */
  getStats(): PlayerStats {
    const latestBitrate = this.bitrateData[this.bitrateData.length - 1];
    const latestBuffer = this.bufferData[this.bufferData.length - 1];
    const latestFPS = this.fpsData[this.fpsData.length - 1];

    return {
      totalBitrate: latestBitrate?.totalBitrate || 0,
      videoBitrate: latestBitrate?.videoBitrate || 0,
      audioBitrate: latestBitrate?.audioBitrate || 0,
      videoBufferLength: latestBuffer?.videoBuffer || 0,
      audioBufferLength: latestBuffer?.audioBuffer || 0,
      currentFPS: latestFPS?.fps || 0,
      droppedFrames: this.droppedFrameCount,
      videoWidth: this.video.videoWidth,
      videoHeight: this.video.videoHeight,
      videoCodec: this.getVideoCodec(),
      audioCodec: this.getAudioCodec(),
      protocol: this.getProtocol(),
      currentQuality: this.getCurrentQuality(),
      availableQualities: this.getAvailableQualities(),
    };
  }

  /**
   * 获取播放器详细信息
   */
  getPlayerDetails(): PlayerDetails {
    const stats = this.getStats();

    return {
      playerType: this.playerType,
      protocol: stats.protocol,
      videoCodec: stats.videoCodec,
      audioCodec: stats.audioCodec,
      videoWidth: stats.videoWidth,
      videoHeight: stats.videoHeight,
      frameRate: stats.currentFPS,
      currentQuality: stats.currentQuality,
      availableQualities: stats.availableQualities,
      videoBitrate: stats.videoBitrate,
      audioBitrate: stats.audioBitrate,
      totalBitrate: stats.totalBitrate,
      videoBuffer: stats.videoBufferLength,
      audioBuffer: stats.audioBufferLength,
      currentTime: this.video.currentTime,
      duration: this.video.duration,
      videoUrl: this.video.currentSrc || this.video.src,
      mimeType: this.video.currentSrc?.split('.').pop()?.toUpperCase() || 'Unknown',
    };
  }

  /**
   * 获取视频编码
   */
  private getVideoCodec(): string {
    switch (this.playerType) {
      case PlayerType.DASH: {
        if (isDashPlayer(this.player)) {
          const track = this.player.getCurrentTrackFor?.('video');
          return track?.codec || 'Unknown';
        }
        return 'Unknown';
      }
      case PlayerType.HLS: {
        if (isHlsPlayer(this.player)) {
          if (this.player.levels && this.player.currentLevel >= 0) {
            return this.player.levels[this.player.currentLevel]?.codecSet || 'H.264';
          }
        }
        return 'Unknown';
      }
      default:
        return 'Unknown';
    }
  }

  /**
   * 获取音频编码
   */
  private getAudioCodec(): string {
    switch (this.playerType) {
      case PlayerType.DASH: {
        if (isDashPlayer(this.player)) {
          const track = this.player.getCurrentTrackFor?.('audio');
          return track?.codec || 'Unknown';
        }
        return 'Unknown';
      }
      case PlayerType.HLS: {
        if (isHlsPlayer(this.player)) {
          if (this.player.audioTracks && this.player.audioTrack >= 0) {
            const track = this.player.audioTracks[this.player.audioTrack];
            if (hasCodec(track)) {
              return track.codec || 'AAC';
            }
          }
        }
        return 'Unknown';
      }
      default:
        return 'Unknown';
    }
  }

  /**
   * 获取流媒体协议
   */
  private getProtocol(): StreamingProtocol {
    // 优先根据播放器类型判断协议
    switch (this.playerType) {
      case PlayerType.DASH:
        return StreamingProtocol.DASH;
      case PlayerType.HLS:
        return StreamingProtocol.HLS;
      case PlayerType.FLV:
        return StreamingProtocol.FLV;
      case PlayerType.NATIVE:
      default: {
        // 对于原生播放器，根据视频源判断
        const src = this.video.currentSrc || this.video.src;
        if (!src) return StreamingProtocol.UNKNOWN;

        if (src.includes('.mpd')) return StreamingProtocol.DASH;
        if (src.includes('.m3u8')) return StreamingProtocol.HLS;
        if (src.includes('.flv')) return StreamingProtocol.FLV;
        if (src.includes('.mp4')) return StreamingProtocol.MP4;
        if (src.includes('.webm')) return StreamingProtocol.WEBM;

        return StreamingProtocol.UNKNOWN;
      }
    }
  }

  /**
   * 获取当前清晰度
   */
  private getCurrentQuality(): string {
    const height = this.video.videoHeight;

    if (height >= 2160) return '4K';
    if (height >= 1440) return '2K';
    if (height >= 1080) return '1080P';
    if (height >= 720) return '720P';
    if (height >= 480) return '480P';
    if (height >= 360) return '360P';
    return `${height}P`;
  }

  /**
   * 获取可用清晰度列表
   */
  private getAvailableQualities(): string[] {
    switch (this.playerType) {
      case PlayerType.DASH: {
        // 使用 getRepresentationsByType 获取所有可用的表示
        try {
          const representations = this.player?.getRepresentationsByType?.('video') || [];
          return representations.map((rep: { height?: number }) => {
            const h = rep.height ?? 0;
            if (h >= 2160) return '4K';
            if (h >= 1440) return '2K';
            if (h >= 1080) return '1080P';
            if (h >= 720) return '720P';
            if (h >= 480) return '480P';
            return `${h}P`;
          });
        } catch (e) {
          logger.error('获取DASH可用清晰度失败:', e);
          return [this.getCurrentQuality()];
        }
      }
      case PlayerType.HLS: {
        if (!this.player) return [];
        return this.player.levels.map((level: { height: number }) => {
          if (level.height >= 2160) return '4K';
          if (level.height >= 1440) return '2K';
          if (level.height >= 1080) return '1080P';
          if (level.height >= 720) return '720P';
          if (level.height >= 480) return '480P';
          return `${level.height}P`;
        });
      }
      default:
        return [this.getCurrentQuality()];
    }
  }

  /**
   * 获取码率历史数据
   */
  getBitrateData(): BitrateDataPoint[] {
    return [...this.bitrateData];
  }

  /**
   * 获取吞吐量历史数据
   */
  getThroughputData(): ThroughputDataPoint[] {
    return [...this.throughputData];
  }

  /**
   * 获取缓冲区历史数据
   */
  getBufferData(): BufferDataPoint[] {
    return [...this.bufferData];
  }

  /**
   * 获取帧率历史数据
   */
  getFPSData(): FrameRateDataPoint[] {
    return [...this.fpsData];
  }

  /**
   * 清空历史数据
   */
  clearData(): void {
    this.bitrateData = [];
    this.throughputData = [];
    this.bufferData = [];
    this.fpsData = [];
    this.throughputWindow = [];
    this.lastCheckTime = 0;
    this.lastCheckBytes = 0;
  }

  /**
   * 销毁监控器
   */
  destroy(): void {
    this.stop();
    this.clearData();
    this.player = null;
  }
}
