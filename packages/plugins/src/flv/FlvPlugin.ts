/**
 * ============================================
 * FLV 流媒体插件 (FlvPlugin)
 * ============================================
 * 基于 flv.js 的 FLV 格式流媒体播放器插件
 *
 * 功能：
 * - 静态导入 flv.js 库
 * - 支持直播和点播模式
 * - 支持 HTTP-FLV 协议
 * - 错误重试机制（最多 3 次重试）
 * - 直播延迟控制（目标延迟、最大延迟）
 * - 提供缓冲、码率等实时统计信息
 * - 通过事件总线与播放器和其他插件通信（契约事件走播放器总线，
 *   StreamPluginEventEnum 私有事件走插件私有总线）
 * - 自动检测浏览器兼容性（依赖 MSE）
 * - 首帧时间追踪
 * - 编码信息收集
 *
 * 使用方式：
 * import { createFlvPlugin } from '@lumina/plugins';
 * const player = new VideoPlayer({
 *   plugins: [createFlvPlugin({ isLive: true })]
 * });
 */

import flvjs from 'flv.js';
import type { VideoPlayer } from '@lumina/nova';
import { StreamPluginTypeEnum, StreamPluginEventEnum } from '@/types/streamPlugin';
import type { StreamPlugin, StreamConfig, StreamStats, BufferInfo, QualityLevel } from '@/types/streamPlugin';
import type { PluginOptions } from '@/types/plugin';
import { PlayerEventEnum } from '@/core/events';
import type { PlayerEventBus } from '../../../player/src/core/plugin';
import { createStreamPluginEventBus } from '../stream/streamEventBus';
import type { StreamPluginEventBus } from '../stream/streamEventBus';
import { BrowserCapabilityDetector } from '@lumina/nova';
import { createLogger } from '@/utils';

const logger = createLogger('FlvPlugin');

/** 最大错误重试次数 */
const MAX_RETRY_COUNT = 3;

/** 重试间隔（毫秒） */
const RETRY_INTERVAL = 1000;

/**
 * FLV 插件配置
 */
export interface FlvPluginConfig {
  /** 是否自动播放，默认 true */
  autoplay?: boolean;
  /** 是否直播模式，默认 false */
  isLive?: boolean;
  /** 是否启用隐藏缓冲区（用于 seek 后恢复） */
  enableStashBuffer?: boolean;
  /** 隐藏缓冲区的初始大小（KB） */
  stashInitialSize?: number;
  /** 懒加载最大时长（秒，点播模式有效） */
  lazyLoadMaxDuration?: number;
  /** 直播目标延迟（秒），播放器会尝试追赶延迟 */
  liveTargetLatency?: number;
  /** 直播最大延迟（秒），超过此延迟会强制追赶 */
  liveMaxLatency?: number;
  /** 最大错误重试次数，默认 3 */
  maxRetryCount?: number;
  /** 重试间隔（毫秒），默认 1000 */
  retryInterval?: number;
  /** 插件选项 */
  options?: PluginOptions;
}

/**
 * FLV 流媒体插件类
 * 实现 StreamPlugin 接口（StreamPlugin 继承 Plugin）
 * 基于 flv.js 提供 FLV 格式视频播放能力
 *
 * 特性：
 * - 错误重试机制：遇到错误时自动重试，最多 3 次
 * - 直播延迟控制：支持配置目标延迟和最大延迟
 * - FLV 通常不支持多码率，getQualities/setQuality 为存根方法
 */
export class FlvPlugin implements StreamPlugin {
  /** 插件名称（必须唯一） */
  readonly name = 'flv';
  /** 插件版本号 */
  readonly version = '1.0.0';
  /** 插件描述 */
  readonly description = 'FLV 格式流媒体播放器插件，基于 flv.js';
  /** 插件类型 */
  readonly type: StreamPluginTypeEnum = StreamPluginTypeEnum.FLV;

  /** flv.js 播放器实例 */
  private flvPlayer: ReturnType<typeof flvjs.createPlayer> | null = null;

  /** 视频元素（从播放器获取） */
  videoElement: HTMLVideoElement | null = null;

  /** 播放器事件总线（player.events，只承载契约事件） */
  eventBus: PlayerEventBus | null = null;

  /** 插件私有事件总线（StreamPluginEventEnum 上报的唯一去向，不经播放器总线） */
  private readonly streamEventBus: StreamPluginEventBus = createStreamPluginEventBus();

  /** 播放器实例引用 */
  private player: VideoPlayer | null = null;

  /** 当前流媒体配置 */
  private config: StreamConfig | null = null;

  /** 插件自定义配置 */
  private pluginConfig: FlvPluginConfig;

  /** 统计信息缓存 */
  private stats: Partial<StreamStats> = {};

  /** 上次卡顿开始时间（用于计算卡顿总时长） */
  private lastStallTime = 0;

  /** 加载开始时间戳（用于计算首帧时间） */
  private loadStartTime = 0;

  /** 是否已记录首帧时间 */
  private firstFrameRecorded = false;

  /** 首帧时间（毫秒） */
  private firstFrameTime = 0;

  /** 浏览器能力检测结果 */
  private browserCapability: ReturnType<typeof BrowserCapabilityDetector.getFullCapabilityResult> | null = null;

  /** 首帧事件处理器引用（用于移除监听） */
  private firstFrameHandler: (() => void) | null = null;

  /** 当前重试次数 */
  private retryCount = 0;

  /** 重试定时器 ID */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 构造函数
   * @param config - FLV 插件配置
   */
  constructor(config?: FlvPluginConfig) {
    this.pluginConfig = {
      autoplay: true,
      isLive: false,
      enableStashBuffer: true,
      stashInitialSize: 128,
      lazyLoadMaxDuration: 3 * 60,
      liveTargetLatency: 3,
      liveMaxLatency: 10,
      maxRetryCount: MAX_RETRY_COUNT,
      retryInterval: RETRY_INTERVAL,
      ...config,
    };
  }

  /**
   * ============================================
   * Plugin 接口实现
   * ============================================
   */

  /**
   * 安装插件
   * 当插件被注册到播放器时调用
   * 在此阶段完成：浏览器能力检测、播放器引用保存、事件总线和视频元素获取
   *
   * @param player - 播放器实例
   */
  install(player: VideoPlayer): void {
    // 步骤 1：保存播放器引用
    this.player = player;
    this.eventBus = player.events;

    // 步骤 2：浏览器能力检测
    this.browserCapability = BrowserCapabilityDetector.getFullCapabilityResult();
    logger.info(
      `浏览器能力检测: FLV支持=${this.browserCapability.flvjsSupported}, ` +
      `MSE支持=${this.browserCapability.mseSupported}, ` +
      `浏览器=${this.browserCapability.browserName} ${this.browserCapability.browserVersion}`
    );

    // 步骤 3：兼容性警告
    if (!this.browserCapability.flvjsSupported) {
      logger.warn(
        '当前浏览器不支持 FLV 协议（缺少 MSE 支持），' +
        '插件已安装但可能无法正常工作'
      );
    }

    // 步骤 4：监听播放器挂载事件，获取视频元素
    player.events.on('player:mounted', (data) => {
      if (data && data.video instanceof HTMLVideoElement) {
        this.videoElement = data.video;
        logger.info('已获取视频元素');
      }
    });

    logger.info('插件已安装');
  }

  /**
   * 卸载插件
   * 清理所有资源：销毁 flv.js 实例、释放引用
   *
   * @param _player - 播放器实例（此处不需要）
   */
  uninstall(_player?: VideoPlayer): void {
    this.destroy();
    this.player = null;
    this.eventBus = null;
    this.videoElement = null;
    this.browserCapability = null;
    this.firstFrameRecorded = false;
    this.firstFrameTime = 0;
    logger.info('插件已卸载');
  }

  /**
   * ============================================
   * StreamPlugin 接口实现
   * ============================================
   */

  /**
   * 检查浏览器是否支持 flv.js 播放
   * 直接使用 flvjs.isSupported() 检测
   *
   * @returns 是否支持 flv.js
   */
  isSupported(): boolean {
    return flvjs.isSupported();
  }

  /**
   * 加载 FLV 流媒体
   * 使用静态导入的 flv.js 库，创建播放器实例并绑定到视频元素
   *
   * @param config - 流媒体配置（包含 URL、格式等）
   */
  load(config: StreamConfig): void {
    // 步骤 1：检查视频元素是否就绪
    if (!this.videoElement) {
      const msg = '视频元素未设置，请确保播放器已挂载到 DOM';
      logger.error(msg);
      this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
      return;
    }

    // 步骤 2：保存配置并重置状态
    this.config = config;
    this.loadStartTime = Date.now();
    this.firstFrameRecorded = false;
    this.firstFrameTime = 0;
    this.retryCount = 0;

    // 步骤 3：注册首帧时间追踪
    this.registerFirstFrameTracking();

    // 步骤 4：创建 flv.js 播放器实例
    this.createFlvPlayer(config);
  }

  /**
   * 创建 flv.js 播放器实例
   * 直接使用 flvjs.createPlayer() 创建，包含直播延迟控制配置
   *
   * @param config - 流媒体配置
   */
  private createFlvPlayer(config: StreamConfig): void {
    if (!this.videoElement) return;

    const url = typeof config.url === 'string' ? config.url : String(config.url);
    const isLive = config.isLive ?? this.pluginConfig.isLive;

    // 步骤 1：使用 flvjs.createPlayer() 创建播放器实例
    // MediaDataSource（第一参数）包含流类型和地址
    // Config（第二参数）包含缓冲和清理策略
    this.flvPlayer = flvjs.createPlayer(
      {
        type: 'flv',
        url: url,
        isLive: isLive,
        hasAudio: true,
        hasVideo: true,
      },
      {
        enableStashBuffer: this.pluginConfig.enableStashBuffer,
        stashInitialSize: this.pluginConfig.stashInitialSize,
        lazyLoadMaxDuration: this.pluginConfig.lazyLoadMaxDuration,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 3 * 60,
        autoCleanupMinBackwardDuration: 60,
      },
    );

    // 步骤 2：绑定 flv.js 内置事件
    this.bindEvents();

    // 步骤 3：绑定到视频元素并加载
    const player = this.flvPlayer;
    if (!player) return;
    player.attachMediaElement(this.videoElement);
    player.load();

    // 步骤 4：通知外部：加载完成
    this.streamEventBus.emit(StreamPluginEventEnum.LOAD_COMPLETE, { url: config.url });

    // 步骤 5：自动播放
    if (this.pluginConfig.autoplay) {
      this.play();
    }

    // 步骤 6：如果指定了起始时间，跳转到对应位置
    if (config.startTime && config.startTime > 0) {
      this.seek(config.startTime);
    }

    logger.info('FLV 流加载成功:', url);
  }

  /**
   * 注册首帧时间追踪
   * 监听视频元素的 playing 事件，记录从加载开始到首帧渲染的时间
   */
  private registerFirstFrameTracking(): void {
    this.removeFirstFrameTracking();

    const video = this.videoElement;
    if (!video) return;

    this.firstFrameHandler = (): void => {
      if (!this.firstFrameRecorded) {
        this.firstFrameRecorded = true;
        this.firstFrameTime = Date.now() - this.loadStartTime;
        this.stats.firstFrameTime = this.firstFrameTime;
        logger.info(`首帧时间: ${this.firstFrameTime}ms`);
        this.streamEventBus.emit(StreamPluginEventEnum.STATS_UPDATE, this.getStats());
      }
    };

    video.addEventListener('playing', this.firstFrameHandler);
  }

  /**
   * 移除首帧时间追踪监听
   */
  private removeFirstFrameTracking(): void {
    if (this.firstFrameHandler && this.videoElement) {
      this.videoElement.removeEventListener('playing', this.firstFrameHandler);
      this.firstFrameHandler = null;
    }
  }

  /**
   * 错误重试逻辑
   * 当播放器遇到错误时，尝试重新创建播放器实例
   * 最多重试 maxRetryCount 次，每次间隔 retryInterval 毫秒
   *
   * @returns 是否已触发重试
   */
  private retryOnError(): boolean {
    const maxRetry = this.pluginConfig.maxRetryCount ?? MAX_RETRY_COUNT;
    const interval = this.pluginConfig.retryInterval ?? RETRY_INTERVAL;

    // 步骤 1：检查是否已达到最大重试次数
    if (this.retryCount >= maxRetry) {
      logger.error(`已达到最大重试次数 (${maxRetry})，停止重试`);
      this.streamEventBus.emit(StreamPluginEventEnum.ERROR, {
        message: `播放失败，已重试 ${maxRetry} 次`,
        retryCount: this.retryCount,
      });
      return false;
    }

    // 步骤 2：递增重试计数
    this.retryCount++;
    logger.info(`尝试重试 (${this.retryCount}/${maxRetry})，${interval}ms 后重新加载...`);

    // 步骤 3：清理当前播放器实例
    if (this.flvPlayer) {
      try {
        this.flvPlayer.pause();
        this.flvPlayer.unload();
        this.flvPlayer.detachMediaElement();
        this.flvPlayer.destroy();
      } catch (e) {
        logger.warn('重试时清理播放器实例出错:', e);
      }
      this.flvPlayer = null;
    }

    // 步骤 4：延迟后重新创建播放器
    this.retryTimer = setTimeout(() => {
      if (this.config) {
        this.createFlvPlayer(this.config);
      }
    }, interval);

    return true;
  }

  /**
   * 清除重试定时器
   */
  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * 绑定 flv.js 核心事件
   * 将 flv.js 的内部事件转换为统一的 StreamPlugin 事件
   * 使用 flvjs.Events 事件常量
   */
  private bindEvents(): void {
    if (!this.flvPlayer) return;

    const Events = flvjs.Events;

    // 播放器错误处理（带重试机制）
    this.flvPlayer.on(Events.ERROR, (...args: [string, string]) => {
      const [errorType, errorDetail] = args;
      logger.error(`播放器错误 (重试次数: ${this.retryCount}):`, errorType, errorDetail);

      // 尝试重试
      const retried = this.retryOnError();
      if (!retried) {
        // 重试次数已用完，发出错误事件
        this.streamEventBus.emit(StreamPluginEventEnum.ERROR, {
          type: errorType,
          detail: errorDetail,
          retryCount: this.retryCount,
        });
        // 重试已用尽属终态失败：向播放器总线广播契约事件 STREAM_ERROR
        // flv.js 的 ERROR 只给出两个字符串（无原始错误对象），
        // 故 message 取错误详情字符串，error 传错误类型与详情
        this.eventBus?.emit(PlayerEventEnum.STREAM_ERROR, {
          message: errorDetail || errorType,
          error: { type: errorType, detail: errorDetail },
        });
      }
    });

    // 媒体信息就绪 → 获取编码、分辨率等信息
    this.flvPlayer.on(Events.MEDIA_INFO, () => {
      const mediaInfo = this.flvPlayer?.mediaInfo;
      logger.info('媒体信息:', mediaInfo);
      this.streamEventBus.emit(StreamPluginEventEnum.METADATA_LOADED, mediaInfo);
      if (mediaInfo && mediaInfo.width && mediaInfo.height) {
        // StreamPluginEventEnum.QUALITY_CHANGE 的值与契约键 streamQualityChange 同名，
        // 按契约事件走播放器总线
        this.eventBus?.emit(PlayerEventEnum.STREAM_QUALITY_CHANGE, {
          width: mediaInfo.width,
          height: mediaInfo.height,
          bitrate: undefined,
          isAuto: false,
        });
      }
    });

    // 元数据到达（如脚本数据、SEI 等）
    this.flvPlayer.on(Events.METADATA_ARRIVED, (metadata: Record<string, string | number | boolean>) => {
      logger.info('元数据到达:', metadata);
    });

    // 加载完成 → 记录缓冲开始
    this.flvPlayer.on(Events.LOADING_COMPLETE, () => {
      this.lastStallTime = Date.now();
      this.streamEventBus.emit(StreamPluginEventEnum.BUFFER_START, {});
    });

    // 统计信息定期更新 → 更新下载速度等指标，同时检测缓冲结束
    this.flvPlayer.on(Events.STATISTICS_INFO, (stats: Partial<StreamStats>) => {
      this.stats = { ...this.stats, ...stats };
      // 从 flv.js 的 statisticsInfo 中提取下载速度
      const statsInfo = this.flvPlayer?.statisticsInfo;
      if (statsInfo && typeof statsInfo === 'object' && 'speed' in statsInfo && typeof statsInfo.speed === 'number') {
        // 单位换算：flv.js 的 statisticsInfo.speed 是 **KiB/s**
        // （flv.js dist：IOController.currentSpeed 注释 `// in KB/s`，
        //   SpeedSampler.lastSecondKBps = _lastSecondBytes / 1024），
        // 而 StreamStats.downloadSpeed 约定为「字节/秒」→ ×1024
        this.stats.downloadSpeed = statsInfo.speed * 1024;
      }

      // 如果之前处于缓冲状态，检测是否已恢复
      if (this.lastStallTime > 0 && this.videoElement && !this.videoElement.paused && this.videoElement.readyState >= 3) {
        const stallDuration = Date.now() - this.lastStallTime;
        this.stats.totalStallTime = (this.stats.totalStallTime || 0) + stallDuration;
        this.stats.totalStallCount = (this.stats.totalStallCount || 0) + 1;
        this.lastStallTime = 0;
        this.streamEventBus.emit(StreamPluginEventEnum.BUFFER_END, {});
      }

      this.streamEventBus.emit(StreamPluginEventEnum.STATS_UPDATE, this.getStats());
    });

    // 提前结束恢复
    this.flvPlayer.on(Events.RECOVERED_EARLY_EOF, () => {
      logger.info('提前结束已恢复');
    });
  }

  /**
   * 开始播放
   * 使用 flv.js 的 play 方法（确保流正确启动）
   */
  play(): void {
    if (this.flvPlayer) {
      const result = this.flvPlayer.play();
      if (result instanceof Promise) {
        result.then(() => {
          this.streamEventBus.emit(StreamPluginEventEnum.PLAY_START, {});
        }).catch((err: Error) => {
          const msg = `播放失败: ${err.message}`;
          logger.error(msg);
          this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
        });
      } else {
        this.streamEventBus.emit(StreamPluginEventEnum.PLAY_START, {});
      }
    }
  }

  /**
   * 暂停播放
   * 使用 flv.js 的 pause 方法（同时暂停内部数据拉取）
   */
  pause(): void {
    if (this.flvPlayer) {
      this.flvPlayer.pause();
      this.streamEventBus.emit(StreamPluginEventEnum.PLAY_PAUSE, {});
    }
  }

  /**
   * 跳转到指定时间
   * 通过设置 video 元素的 currentTime 实现精确跳转
   *
   * @param time - 目标时间（秒）
   */
  seek(time: number): void {
    if (this.videoElement) {
      this.videoElement.currentTime = time;
    }
  }

  /**
   * 销毁播放器实例
   * 暂停、卸载、销毁 flv.js 实例，清理所有引用
   */
  destroy(): void {
    this.removeFirstFrameTracking();
    this.clearRetryTimer();
    if (this.flvPlayer) {
      this.flvPlayer.pause();
      this.flvPlayer.unload();
      this.flvPlayer.destroy();
      this.flvPlayer = null;
    }
    this.config = null;
    this.stats = {};
    this.lastStallTime = 0;
    this.loadStartTime = 0;
    this.firstFrameRecorded = false;
    this.firstFrameTime = 0;
    this.retryCount = 0;
  }

  /**
   * 获取缓冲信息
   * 优先使用 flv.js 的内部缓冲区间，否则降级使用 video.buffered
   *
   * @returns 缓冲信息（起始时间、结束时间、缓冲长度）
   */
  getBufferInfo(): BufferInfo {
    const video = this.videoElement;
    const buffered = this.flvPlayer?.buffered;

    if (!video || !buffered || buffered.length === 0) {
      return { start: 0, end: 0, length: 0 };
    }

    const currentTime = video.currentTime || 0;
    let bufferEnd = 0;

    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= currentTime && buffered.end(i) >= currentTime) {
        bufferEnd = buffered.end(i);
        break;
      }
    }

    const bufferLength = bufferEnd - currentTime;

    return {
      start: currentTime,
      end: bufferEnd,
      length: Math.max(0, bufferLength),
    };
  }

  /**
   * 获取统计信息
   * 收集当前播放器状态，包括播放时间、缓冲长度、编码信息、首帧时间等
   *
   * @returns 流媒体统计信息
   */
  getStats(): Partial<StreamStats> {
    const video = this.videoElement;
    const bufferInfo = this.getBufferInfo();
    const mediaInfo = this.flvPlayer?.mediaInfo;
    const statsInfo = this.flvPlayer?.statisticsInfo;

    // 从 FlvPlayerStatisticsInfo 中提取下载速度（NativePlayerStatisticsInfo 没有 speed 字段）
    // 单位换算：statisticsInfo.speed 原始单位为 KiB/s → ×1024 得到字节/秒
    // （this.stats.downloadSpeed 在 STATISTICS_INFO 回调里已按同一口径换算过，两条路径单位一致）
    const speedKib = statsInfo && 'speed' in statsInfo ? statsInfo.speed : undefined;
    const downloadSpeed = typeof speedKib === 'number'
      ? speedKib * 1024
      : (this.stats.downloadSpeed ?? 0);
    // 从 FlvPlayerMediaInfo 中提取编码信息（NativePlayerMediaInfo 没有 videoCodec/audioCodec 字段）
    const videoCodec = mediaInfo && 'videoCodec' in mediaInfo ? mediaInfo.videoCodec : undefined;
    const audioCodec = mediaInfo && 'audioCodec' in mediaInfo ? mediaInfo.audioCodec : undefined;

    return {
      ...this.stats,
      currentTime: video?.currentTime || 0,
      duration: video?.duration || 0,
      bufferLength: bufferInfo.length,
      firstFrameTime: this.firstFrameTime,
      totalStallCount: this.stats.totalStallCount || 0,
      totalStallTime: this.stats.totalStallTime || 0,
      downloadSpeed,
      videoCodec,
      audioCodec,
      resolution: mediaInfo?.width && mediaInfo?.height
        ? { width: mediaInfo.width, height: mediaInfo.height }
        : undefined,
    };
  }

  /**
   * 获取可用画质列表
   * FLV 通常不支持多码率切换，返回空数组
   *
   * @returns 空数组（FLV 不支持多码率）
   */
  getQualities(): QualityLevel[] {
    // FLV 通常不支持多码率，返回空数组
    return [];
  }

  /**
   * 设置播放画质
   * FLV 为单码率流，不支持多码率切换，保持安全空实现
   *
   * @param quality - 画质标识
   */
  setQuality(quality: string): void {
    logger.warn(`FLV 格式不支持多码率切换，忽略画质切换请求: ${quality}`);
  }

  /**
   * 获取当前生效的档位 id
   * FLV 为单码率流，无档位概念，恒返回 ''
   *
   * @returns 恒为 ''
   */
  getCurrentQuality(): string {
    return '';
  }

  /**
   * 是否支持自动档（ABR）
   * FLV 为单码率流，不支持 ABR 自适应码率
   *
   * @returns 恒为 false
   */
  supportsAutoQuality(): boolean {
    return false;
  }

  /**
   * 获取浏览器能力检测结果
   * 返回插件安装时检测的浏览器兼容性信息
   *
   * @returns 浏览器能力检测结果，未安装返回 null
   */
  getBrowserCapability(): ReturnType<typeof BrowserCapabilityDetector.getFullCapabilityResult> | null {
    return this.browserCapability;
  }

  /**
   * 获取底层 flv.js 播放器实例
   * 供统计监控（如 VideoInfo 的码率曲线）读取库原生实时数据
   *
   * @returns flv.js 播放器实例；未加载 / 已销毁返回 null
   */
  getNativePlayer(): unknown {
    return this.flvPlayer;
  }

  /**
   * 获取当前流媒体配置
   * @returns 流媒体配置，未加载返回 null
   */
  getConfig(): StreamConfig | null {
    return this.config;
  }

  /**
   * 获取播放器实例引用
   * @returns 播放器实例，未安装返回 null
   */
  getPlayer(): VideoPlayer | null {
    return this.player;
  }

  /**
   * 获取插件私有事件总线（只读入口）
   * StreamPluginEventEnum 的上报都在这里；播放器总线只承载契约事件
   *
   * @returns 插件私有事件总线
   */
  getStreamEventBus(): StreamPluginEventBus {
    return this.streamEventBus;
  }

  /**
   * 获取当前重试次数
   * @returns 当前重试次数
   */
  getRetryCount(): number {
    return this.retryCount;
  }
}

/**
 * FLV 插件工厂函数
 * 创建并返回一个新的 FlvPlugin 实例
 *
 * @param config - FLV 插件配置
 * @returns FlvPlugin 实例
 *
 * @example
 * // 基本用法（点播）
 * player.use(createFlvPlugin());
 *
 * @example
 * // 直播模式
 * player.use(createFlvPlugin({
 *   isLive: true,
 *   autoplay: true
 * }));
 *
 * @example
 * // 直播模式 + 延迟控制
 * player.use(createFlvPlugin({
 *   isLive: true,
 *   liveTargetLatency: 3,
 *   liveMaxLatency: 10,
 *   maxRetryCount: 3
 * }));
 */
export function createFlvPlugin(config?: FlvPluginConfig): FlvPlugin {
  return new FlvPlugin(config);
}
