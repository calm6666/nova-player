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
import { isBrowser } from '@lumina/framework/utils';

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
  /** 上次统计的已下载字节数 (用于计算吞吐量) */
  private lastDownloadedBytes = 0;
  /** 上次统计时间 */
  private lastBitrateCheckTime = 0;

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
    // 检查 video 元素上是否有播放器实例
    const video = this.video as HTMLVideoElement & {
      dash?: DashPlayer;
      hls?: HlsPlayer;
      flv?: FlvPlayer;
    };

    if (video.dash) {
      this.player = video.dash;
      this.playerType = PlayerType.DASH;
    } else if (video.hls) {
      this.player = video.hls;
      this.playerType = PlayerType.HLS;
    } else if (video.flv) {
      this.player = video.flv;
      this.playerType = PlayerType.FLV;
    } else {
      this.playerType = PlayerType.NATIVE;
    }
  }

  /**
   * 开始监控
   */
  start(): void {
    if (this.isMonitoring) return;
    if (!isBrowser()) return;

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
   * 收集码率数据（当前选中清晰度的静态码率）
   */
  private collectBitrateData(timestamp: number): void {
    let totalBitrate = 0;
    let videoBitrate = 0;
    let audioBitrate = 0;

    switch (this.playerType) {
      case PlayerType.DASH: {
        const dash = this.player as DashPlayer;
        try {
          // 获取当前视频和音频表示的静态码率
          const videoRepresentation = dash.getCurrentRepresentationForType?.('video');
          const audioRepresentation = dash.getCurrentRepresentationForType?.('audio');
          videoBitrate = videoRepresentation?.bandwidth || 0;
          audioBitrate = audioRepresentation?.bandwidth || 0;
          totalBitrate = videoBitrate + audioBitrate;
        } catch {
          // 忽略错误
        }
        break;
      }
      case PlayerType.HLS: {
        const hls = this.player as HlsPlayer;
        try {
          // 获取当前选中 level 和 audio track 的静态码率
          if (hls.levels && hls.currentLevel >= 0) {
            videoBitrate = hls.levels[hls.currentLevel]?.bitrate || 0;
          }
          if (hls.audioTracks && hls.audioTrack >= 0) {
            audioBitrate = (hls.audioTracks[hls.audioTrack] as { bitrate?: number })?.bitrate || 0;
          }
          totalBitrate = videoBitrate + audioBitrate;
        } catch {
          // 忽略错误
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

    // 计算时间差（秒）
    const timeDelta = this.lastBitrateCheckTime > 0
      ? (timestamp - this.lastBitrateCheckTime) / 1000
      : 1;

    switch (this.playerType) {
      case PlayerType.DASH: {
        const dash = this.player as DashPlayer;
        try {
          // 使用 dash.js 的 DashMetrics 获取实际下载数据
          const dashMetrics = dash.getDashMetrics();
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

          // 计算下载速度 (bps)
          if (this.lastDownloadedBytes > 0 && timeDelta > 0) {
            const bytesDelta = totalDownloadedBytes - this.lastDownloadedBytes;
            totalThroughput = bytesDelta > 0 ? (bytesDelta * 8) / timeDelta : 0;
          }

          this.lastDownloadedBytes = totalDownloadedBytes;

          // 估算视频和音频吞吐量比例
          const videoRepresentation = dash.getCurrentRepresentationForType?.('video');
          const audioRepresentation = dash.getCurrentRepresentationForType?.('audio');
          const videoBandwidth = videoRepresentation?.bandwidth || 0;
          const audioBandwidth = audioRepresentation?.bandwidth || 0;
          const totalBandwidth = videoBandwidth + audioBandwidth;

          if (totalBandwidth > 0 && totalThroughput > 0) {
            videoThroughput = totalThroughput * (videoBandwidth / totalBandwidth);
            audioThroughput = totalThroughput * (audioBandwidth / totalBandwidth);
          } else {
            videoThroughput = totalThroughput;
          }
        } catch {
          // 忽略错误
        }
        break;
      }
      case PlayerType.HLS: {
        const hls = this.player as HlsPlayer;
        try {
          // hls.js 使用 stats 获取加载信息
          const stats = (hls as unknown as { stats?: { loaded: number } }).stats;
          const totalLoaded = stats?.loaded || 0;

          // 计算下载速度 (bps)
          if (this.lastDownloadedBytes > 0 && timeDelta > 0) {
            const bytesDelta = totalLoaded - this.lastDownloadedBytes;
            totalThroughput = bytesDelta > 0 ? (bytesDelta * 8) / timeDelta : 0;
          }

          this.lastDownloadedBytes = totalLoaded;

          // 估算视频和音频吞吐量比例
          let videoBandwidth = 0;
          let audioBandwidth = 0;
          if (hls.levels && hls.currentLevel >= 0) {
            videoBandwidth = hls.levels[hls.currentLevel]?.bitrate || 0;
          }
          if (hls.audioTracks && hls.audioTrack >= 0) {
            audioBandwidth = (hls.audioTracks[hls.audioTrack] as { bitrate?: number })?.bitrate || 0;
          }
          const totalBandwidth = videoBandwidth + audioBandwidth;

          if (totalBandwidth > 0 && totalThroughput > 0) {
            videoThroughput = totalThroughput * (videoBandwidth / totalBandwidth);
            audioThroughput = totalThroughput * (audioBandwidth / totalBandwidth);
          } else {
            videoThroughput = totalThroughput;
          }
        } catch {
          // 忽略错误
        }
        break;
      }
      case PlayerType.FLV: {
        const flv = this.player as FlvPlayer;
        // flv.js 的统计信息
        totalThroughput = (flv.statisticsInfo?.speed || 0) * 8; // 转换为 bps
        videoThroughput = totalThroughput * 0.9; // 估算
        audioThroughput = totalThroughput * 0.1;
        break;
      }
      case PlayerType.NATIVE: {
        // 原生视频无法获取吞吐量，使用 0
        break;
      }
    }

    this.lastBitrateCheckTime = timestamp;

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
        const dash = this.player as DashPlayer;
        // 使用 dash.js 真实 API
        try {
          videoBuffer = dash.getBufferLength?.('video') || 0;
          audioBuffer = dash.getBufferLength?.('audio') || 0;
        } catch {
          // 如果 API 调用失败，回退到原生 buffered
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
      const video = this.video as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => { droppedVideoFrames: number };
      };
      let droppedFrames = 0;
      if (video.getVideoPlaybackQuality) {
        const quality = video.getVideoPlaybackQuality();
        droppedFrames = quality.droppedVideoFrames - this.droppedFrameCount;
        this.droppedFrameCount = quality.droppedVideoFrames;
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
        const dash = this.player as DashPlayer;
        const track = dash.getCurrentTrackFor?.('video');
        return track?.codec || 'Unknown';
      }
      case PlayerType.HLS: {
        const hls = this.player as HlsPlayer;
        if (hls.levels && hls.currentLevel >= 0) {
          return hls.levels[hls.currentLevel]?.codecSet || 'H.264';
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
        const dash = this.player as DashPlayer;
        const track = dash.getCurrentTrackFor?.('audio');
        return track?.codec || 'Unknown';
      }
      case PlayerType.HLS: {
        const hls = this.player as HlsPlayer;
        if (hls.audioTracks && hls.audioTrack >= 0) {
          const track = hls.audioTracks[hls.audioTrack];
          // hls.js 的 audioTrack 可能没有 codec 属性，使用类型断言
          return (track as { codec?: string })?.codec || 'AAC';
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
        const dash = this.player as DashPlayer;
        // 使用 getRepresentationsByType 获取所有可用的表示
        try {
          const representations = dash.getRepresentationsByType?.('video') || [];
          return representations.map((rep: { height?: number }) => {
            const h = rep.height ?? 0;
            if (h >= 2160) return '4K';
            if (h >= 1440) return '2K';
            if (h >= 1080) return '1080P';
            if (h >= 720) return '720P';
            if (h >= 480) return '480P';
            return `${h}P`;
          });
        } catch {
          return [this.getCurrentQuality()];
        }
      }
      case PlayerType.HLS: {
        const hls = this.player as HlsPlayer;
        if (!hls.levels) return [];
        return hls.levels.map((level) => {
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
    this.lastDownloadedBytes = 0;
    this.lastBitrateCheckTime = 0;
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
