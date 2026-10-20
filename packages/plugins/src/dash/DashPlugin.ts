/**
 * ============================================
 * DASH 流媒体插件 (DashPlugin)
 * ============================================
 * 基于 dash.js 的 DASH 格式流媒体播放器插件
 *
 * 功能：
 * - 静态导入 dash.js 库
 * - 支持自适应码率切换 (ABR)
 * - 支持 URL 字符串和清单对象两种加载方式
 * - 对象注入模式：将清单对象转换为 dash.js 清单对象后注入
 * - 提供缓冲、码率、帧率等实时统计信息
 * - 通过事件总线与播放器和其他插件通信（契约事件走播放器总线，
 *   StreamPluginEventEnum 私有事件走插件私有总线）
 * - 自动检测浏览器兼容性
 * - 首帧时间追踪
 *
 * 使用方式：
 * import { createDashPlugin } from '@lumina/plugins';
 * const player = new VideoPlayer({
 *   plugins: [createDashPlugin({ autoplay: true })]
 * });
 */

import { MediaPlayer } from 'dashjs';
import type { MediaPlayerClass, ErrorEvent, Representation } from 'dashjs';
import type { MediaManifest } from '../vendor/types';
import { manifestToDash } from '../vendor/manifest-to-dash';
import type { VideoPlayer } from '@lumina/nova';
import { StreamPluginTypeEnum, StreamPluginEventEnum, StreamFormatEnum, AUTO_QUALITY_ID, resolveVideoCodec } from '@/types/streamPlugin';
import { detectManifestProtocol } from '@/nova/utils/media/manifestProtocol';
import type { StreamPlugin, StreamConfig, StreamStats, BufferInfo, QualityLevel, MediaManifestSource, StreamQualityChangePayload } from '@/types/streamPlugin';
import type { PluginOptions } from '@/types/plugin';
import { PlayerEventEnum } from '@/core/events';
import type { PlayerEventBus } from '../../../player/src/core/plugin';
import { createStreamPluginEventBus } from '../stream/streamEventBus';
import type { StreamPluginEventBus } from '../stream/streamEventBus';
import { BrowserCapabilityDetector } from '@/nova/utils/browserCapabilityDetector';
import { createLogger } from '@/utils';

const logger = createLogger('DashPlugin');

/** 档位文案后缀（仅收录已确证的档位，其余档位只输出 `${height}P`） */
const QUALITY_LABEL_SUFFIX: Record<number, string> = {
  1080: ' 高清',
};

/**
 * 类型谓词：判断源是否为 MediaManifest 对象
 * MediaManifest 具有 duration 和 video 字段
 */
function isMediaManifest(source: string | MediaManifestSource): source is MediaManifest {
  return (
    typeof source === 'object' &&
    source !== null &&
    'duration' in source &&
    'video' in source
  );
}

/**
 * DASH 插件配置
 */
export interface DashPluginConfig {
  /** 是否自动播放，默认 true */
  autoplay?: boolean;
  /** ABR 自适应码率配置 */
  streaming?: {
    abr?: {
      /** 是否自动切换码率（可分别设置音频/视频） */
      autoSwitchBitrate?: boolean | { audio?: boolean; video?: boolean };
    };
    buffer?: {
      /** 是否启用快速切换 */
      fastSwitchEnabled?: boolean;
    };
  };
  /** 插件选项 */
  options?: PluginOptions;
}

/**
 * DASH 流媒体插件类
 * 实现 StreamPlugin 接口（StreamPlugin 继承 Plugin）
 * 基于 dash.js 提供 DASH 格式视频播放能力
 *
 * 支持两种加载模式：
 * 1. URL 字符串模式：MediaPlayer().create() → initialize(video, url, false) → attachSource(url)
 * 2. 对象注入模式：manifestToDash(source) → 设置 url/baseUri → attachSource(dashManifest)
 */
export class DashPlugin implements StreamPlugin {
  /** 插件名称（必须唯一） */
  readonly name = 'dash';
  /** 插件版本号 */
  readonly version = '1.0.0';
  /** 插件描述 */
  readonly description = 'DASH 格式流媒体播放器插件，基于 dash.js';
  /** 插件类型 */
  readonly type: StreamPluginTypeEnum = StreamPluginTypeEnum.DASH;

  /** dash.js 播放器实例 */
  private dashPlayer: MediaPlayerClass | null = null;

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
  private pluginConfig: DashPluginConfig;

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

  /** 清晰度列表变化订阅者集合 */
  private qualityListeners = new Set<(list: QualityLevel[]) => void>();

  /**
   * 构造函数
   * @param config - DASH 插件配置
   */
  constructor(config?: DashPluginConfig) {
    this.pluginConfig = {
      autoplay: true,
      streaming: {
        abr: {
          autoSwitchBitrate: true,
        },
        buffer: {
          fastSwitchEnabled: true,
        },
      },
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

    // 步骤 2：获取事件总线
    this.eventBus = player.events;

    // 步骤 3：浏览器能力检测
    this.browserCapability = BrowserCapabilityDetector.getFullCapabilityResult();
    logger.info(
      `浏览器能力检测: DASH支持=${this.browserCapability.dashSupported}, ` +
      `MSE支持=${this.browserCapability.mseSupported}, ` +
      `浏览器=${this.browserCapability.browserName} ${this.browserCapability.browserVersion}`
    );

    // 步骤 4：检测不通过时发出警告
    if (!this.browserCapability.dashSupported) {
      logger.warn(
        '当前浏览器不支持 DASH 协议（缺少 MSE 支持），' +
        '插件已安装但可能无法正常工作'
      );
    }

    // 步骤 5：监听播放器挂载事件，获取视频元素
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
   * 清理所有资源：销毁 dash.js 实例、释放引用
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
   * 检查浏览器是否支持 DASH 播放
   * 优先使用缓存的检测结果，否则实时检测
   *
   * @returns 是否支持 DASH
   */
  isSupported(): boolean {
    if (this.browserCapability) {
      return this.browserCapability.dashSupported;
    }
    return BrowserCapabilityDetector.isDASHSupported();
  }

  /**
   * 加载 DASH 流媒体
   * 使用静态导入的 dash.js 库，创建播放器实例并绑定到视频元素
   *
   * 支持两种加载模式：
   * 1. URL 字符串模式：MediaPlayer().create() → initialize(video, url, false) → attachSource(url)
   * 2. 对象注入模式：manifestToDash(source) → 设置 url/baseUri → attachSource(dashManifest)
   *
   * @param config - 流媒体配置（包含 URL 或清单对象、格式等）
   */
  load(config: StreamConfig): void {
    // 步骤 1：校验视频元素
    if (!this.videoElement) {
      const msg = '视频元素未设置，请确保播放器已挂载到 DOM';
      logger.error(msg);
      this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
      return;
    }

    // 步骤 2：校验浏览器兼容性
    if (!this.isSupported()) {
      const msg = `当前浏览器不支持 DASH 播放（${this.browserCapability?.browserName || '未知'} ${this.browserCapability?.browserVersion || ''}），需要 MSE 支持`;
      logger.error(msg);
      this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
      return;
    }

    // 步骤 3：保存配置、重置首帧追踪
    this.config = config;
    this.loadStartTime = Date.now();
    this.firstFrameRecorded = false;
    this.firstFrameTime = 0;

    // 步骤 4：注册首帧时间追踪
    this.registerFirstFrameTracking();

    const source = config.url;

    // 步骤 5：获取 dash.js 播放器实例——已创建则复用（互动视频分支切换 /
    // 换源场景不销毁重建实例，dash.js 的 initialize / attachSource 均支持
    // 重复调用换源：内部控制器只初始化一次，attachSource 会先卸载旧流）
    if (!this.dashPlayer) {
      this.dashPlayer = MediaPlayer().create();
      // 绑定 dash.js 内置事件：事件是实例级的，只在创建时绑定一次，
      // 复用换源不重复绑定（避免回调重复触发、统计事件多报）
      this.bindEvents();
    }

    // 步骤 6：应用用户自定义设置（每次 load 都应用——复用换源时把上一个
    // 视频手动选档残留的 ABR 关闭状态恢复成插件默认配置）
    this.applyStreamingSettings();

    // 步骤 7：根据源类型选择加载模式
    if (typeof source === 'string' && source.split('?')[0].toLowerCase().endsWith('.json')) {
      // ===== JSON Manifest 模式 =====
      // 先 fetch JSON，再转换为 dash.js 清单对象注入
      this.loadJsonManifest(source);
    } else if (typeof source === 'string') {
      // ===== URL 字符串模式 =====

      // 步骤 7a：初始化播放器（绑定视频元素、设置源、不自动播放；
      // dash.js 的 initialize 幂等——控制器只初始化一次，重复调用只重绑 view）
      this.dashPlayer.initialize(this.videoElement, source, false);

      // 步骤 7b：附加源 URL（attachSource 支持重复调用：先卸载旧流再加载新源）
      this.dashPlayer.attachSource(source);

      logger.info('DASH 流加载成功 (URL模式):', source);
    } else {
      // ===== 对象注入模式 =====

      // 步骤 7c：初始化播放器（绑定视频元素、不设置源、不自动播放）
      this.dashPlayer.initialize(this.videoElement, '', false);

      // 步骤 7d：转换清单对象为 dash.js 可识别的清单对象
      if (!isMediaManifest(source)) {
        const msg = '清单对象缺少 duration 或 video 字段';
        logger.error(msg);
        this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
        return;
      }
      const dashManifest = manifestToDash(source);

      // 步骤 7e：设置 url 和 baseUri（dash.js 内部依赖）
      const pageUrl = globalThis.location?.href ?? '';
      dashManifest.url = pageUrl;
      dashManifest.baseUri = pageUrl.substring(0, pageUrl.lastIndexOf('/') + 1);

      // 步骤 7f：注入清单对象
      this.dashPlayer.attachSource(dashManifest);

      logger.info('DASH 流加载成功 (对象注入模式): [清单对象]');
    }

    // 步骤 8：发射加载完成事件
    this.streamEventBus.emit(StreamPluginEventEnum.LOAD_COMPLETE, { url: source });

    // 步骤 9：如果有起始时间，跳转到指定位置
    if (config.startTime && config.startTime > 0) {
      this.seek(config.startTime);
    }
  }

  /**
   * 应用流媒体自定义设置到 dash.js 实例
   * 把插件配置里的 streaming.abr / streaming.buffer 转换成 dash.js 的
   * settings 形状后 updateSettings；每次 load 都调用——复用实例换源时
   * 用默认配置覆盖上一个视频手动选档残留的 ABR 关闭状态
   */
  private applyStreamingSettings(): void {
    if (!this.dashPlayer || !this.pluginConfig.streaming) return;

    // 将 boolean 类型的 autoSwitchBitrate 转换为 dash.js 要求的 { audio, video } 格式
    const autoSwitchBitrate = this.pluginConfig.streaming.abr?.autoSwitchBitrate;
    const normalizedAutoSwitchBitrate: { audio?: boolean; video?: boolean } | undefined =
      autoSwitchBitrate === undefined
        ? undefined
        : typeof autoSwitchBitrate === 'boolean'
          ? { audio: autoSwitchBitrate, video: autoSwitchBitrate }
          : autoSwitchBitrate;

    const streamingSettings = {
      abr: {
        ...this.pluginConfig.streaming.abr,
        autoSwitchBitrate: normalizedAutoSwitchBitrate,
      },
      buffer: this.pluginConfig.streaming.buffer,
    };
    this.dashPlayer.updateSettings({
      streaming: streamingSettings,
    });
  }

  /**
   * 把已解析的清单对象转交给其它流媒体插件
   *
   * JSON 清单的协议按内容判定（detectManifestProtocol）：当内容声明的协议不是本插件
   * 负责的协议、且对应插件已注册到流媒体中间件时，交给它加载，避免用错误的转换器
   * 解析清单（如把 HLS 清单转成 MPD）。
   *
   * @param manifest - 已解析的清单对象
   * @param format - 内容声明的协议对应的流媒体格式
   * @returns 是否已转交
   */
  private forwardToStreamPlugin(
    manifest: MediaManifest,
    format: StreamFormatEnum,
  ): boolean {
    const middleware = this.player?.streamMiddleware;
    if (!middleware) return false;

    const target = middleware.getPlugin(
      format === StreamFormatEnum.HLS
        ? StreamPluginTypeEnum.HLS
        : StreamPluginTypeEnum.DASH,
    );
    if (!target || target === (this as unknown as typeof target)) return false;

    // 本插件已创建的 dash.js 实例必须先行释放，避免残留实例继续占用 video 元素
    this.removeFirstFrameTracking();
    if (this.dashPlayer) {
      this.dashPlayer.reset();
      this.dashPlayer.destroy();
      this.dashPlayer = null;
    }
    this.config = null;

    middleware.load({ url: manifest, format });
    return true;
  }

  /**
   * 加载 JSON Manifest 文件
   * 先 fetch JSON，解析为 MediaManifest 对象，再转换为 dash.js 清单注入
   *
   * @param url - JSON manifest 文件 URL
   */
  private async loadJsonManifest(url: string): Promise<void> {
    try {
      logger.info('正在获取 JSON Manifest:', url);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const manifest = await response.json();

      if (!isMediaManifest(manifest)) {
        throw new Error('JSON 格式不是有效的 MediaManifest（缺少 duration 或 video 字段）');
      }

      // 按内容判定协议：不是 DASH 时转交给对应插件（已注册才转交）
      if (
        detectManifestProtocol(manifest) === 'hls' &&
        this.forwardToStreamPlugin(manifest, StreamFormatEnum.HLS)
      ) {
        return;
      }

      // 转换为 dash.js 清单对象
      const dashManifest = manifestToDash(manifest);
      const pageUrl = globalThis.location?.href ?? '';
      dashManifest.url = pageUrl;
      dashManifest.baseUri = url.substring(0, url.lastIndexOf('/') + 1);

      // 初始化 dash.js 播放器（绑定视频元素、不设置源、不自动播放）
      if (this.videoElement) {
        this.dashPlayer!.initialize(this.videoElement, '', false);
      }

      // 注入清单对象
      this.dashPlayer!.attachSource(dashManifest);

      logger.info('DASH 流加载成功 (JSON Manifest模式)');
      this.streamEventBus.emit(StreamPluginEventEnum.LOAD_COMPLETE, { url });
    } catch (err) {
      const msg = `加载 JSON Manifest 失败: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(msg);
      this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
    }
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
   * 绑定 dash.js 核心事件
   * 将 dash.js 的内部事件转换为统一的 StreamPlugin 事件
   *
   * 绑定事件列表：
   * - streamInitialized: 流初始化完成
   * - bufferStalled: 缓冲停滞
   * - bufferLoaded: 缓冲加载完成
   * - error: 播放器错误
   * - qualityChangeRendered: 画质切换完成
   * - fragmentLoadingCompleted: 片段加载完成
   */
  private bindEvents(): void {
    if (!this.dashPlayer) return;

    // 流初始化完成 → 元数据就绪
    this.dashPlayer.on('streamInitialized', () => {
      logger.info('流初始化完成');
      this.streamEventBus.emit(StreamPluginEventEnum.METADATA_LOADED, {});
      // 流初始化后清晰度列表就绪，推送给订阅者
      this.notifyQualitiesChange();
    });

    // 缓冲停滞开始 → 记录卡顿开始时间
    this.dashPlayer.on('bufferStalled', () => {
      this.lastStallTime = Date.now();
      this.streamEventBus.emit(StreamPluginEventEnum.BUFFER_START, {});
    });

    // 缓冲加载完成 → 计算卡顿时长
    this.dashPlayer.on('bufferLoaded', () => {
      if (this.lastStallTime > 0) {
        const stallDuration = Date.now() - this.lastStallTime;
        this.stats.totalStallTime = (this.stats.totalStallTime || 0) + stallDuration;
        this.stats.totalStallCount = (this.stats.totalStallCount || 0) + 1;
        this.lastStallTime = 0;
      }
      this.streamEventBus.emit(StreamPluginEventEnum.BUFFER_END, {});
    });

    // 播放器错误处理
    this.dashPlayer.on('error', (data: ErrorEvent) => {
      if ('error' in data && typeof data.error === 'string' && 'event' in data) {
        const errorData = { error: data.error, event: data.event };
        logger.error('播放器错误:', errorData);
        this.streamEventBus.emit(StreamPluginEventEnum.ERROR, errorData);
        // 向播放器总线广播契约事件 STREAM_ERROR
        // message 取 dash.js 错误详情里的字符串，error 传原始错误对象
        this.eventBus?.emit(PlayerEventEnum.STREAM_ERROR, {
          message: data.error,
          error: data,
        });
      } else {
        logger.error('播放器错误:', data);
        this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: String(data) });
        // 无详情字符串的错误：message 退化为错误对象的字符串形式，error 传原始错误对象
        this.eventBus?.emit(PlayerEventEnum.STREAM_ERROR, {
          message: String(data),
          error: data,
        });
      }
    });

    // 画质切换完成（手动选档后触发；ABR 每次切档也会触发）
    this.dashPlayer.on('qualityChangeRendered', () => {
      this.streamEventBus.emit(StreamPluginEventEnum.STATS_UPDATE, this.getStats());
      // 切换完成后档位信息可能变化，通知订阅者重新获取列表
      this.notifyQualitiesChange();

      // 取当前生效的视频 representation，附带档位 id / 名称 / 是否自动档
      const rep = this.dashPlayer?.getCurrentRepresentationForType('video');
      if (!rep) return;

      const payload: StreamQualityChangePayload = {
        width: rep.width,
        height: rep.height,
        bitrate: rep.bandwidth,
        isAuto: this.getCurrentQuality() === 'auto',
        qualityId: String(rep.index),
        label: `${rep.width}x${rep.height}`,
      };
      // 向播放器总线广播契约事件 STREAM_QUALITY_CHANGE（等价于旧名 QUALITY_CHANGE）
      this.eventBus?.emit(PlayerEventEnum.STREAM_QUALITY_CHANGE, payload);
    });

    // 片段加载完成 → 更新统计信息
    this.dashPlayer.on('fragmentLoadingCompleted', () => {
      this.streamEventBus.emit(StreamPluginEventEnum.STATS_UPDATE, this.getStats());
    });
  }

  /**
   * 开始播放
   * 直接调用视频元素的 play 方法
   */
  play(): void {
    if (this.videoElement) {
      this.videoElement.play()
        .then(() => {
          this.streamEventBus.emit(StreamPluginEventEnum.PLAY_START, {});
        })
        .catch((err: Error) => {
          const msg = `播放失败: ${err.message}`;
          logger.error(msg);
          this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
        });
    }
  }

  /**
   * 暂停播放
   * 直接调用视频元素的 pause 方法
   */
  pause(): void {
    if (this.videoElement) {
      this.videoElement.pause();
      this.streamEventBus.emit(StreamPluginEventEnum.PLAY_PAUSE, {});
    }
  }

  /**
   * 跳转到指定时间
   * 使用 dash.js 的 seek 方法确保精确跳转
   *
   * @param time - 目标时间（秒）
   */
  seek(time: number): void {
    if (this.dashPlayer) {
      this.dashPlayer.seek(time);
    }
  }

  /**
   * 销毁播放器实例
   * 重置并销毁 dash.js 播放器，清理所有引用
   */
  destroy(): void {
    this.removeFirstFrameTracking();
    if (this.dashPlayer) {
      this.dashPlayer.reset();
      this.dashPlayer.destroy();
      this.dashPlayer = null;
    }
    this.config = null;
    this.stats = {};
    this.lastStallTime = 0;
    this.loadStartTime = 0;
    this.firstFrameRecorded = false;
    this.firstFrameTime = 0;
    this.qualityListeners.clear();
  }

  /**
   * 获取缓冲信息
   * 计算当前播放位置到缓冲区末尾的时长
   *
   * @returns 缓冲信息（起始时间、结束时间、缓冲长度）
   */
  getBufferInfo(): BufferInfo {
    const video = this.videoElement;
    const buffered = video?.buffered;

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
   * 收集当前播放器状态，包括播放时间、缓冲长度、码率、分辨率、首帧时间等
   *
   * @returns 流媒体统计信息
   */
  getStats(): Partial<StreamStats> {
    const video = this.videoElement;
    const bufferInfo = this.getBufferInfo();
    const currentRepresentation = this.dashPlayer?.getCurrentRepresentationForType('video');
    // 单位换算：dash.js 的 getAverageThroughput() 返回 **kbit/s**
    // （dash.mediaplayer.debug.js：“The returned value is depicted in kbit/s”，
    //   底层 _getThroughputInBitPerMs = 8 * bytes / ms，即比特/毫秒 = kbit/s），
    // 而 StreamStats.downloadSpeed 约定为「字节/秒」→ kbit/s × 1000 ÷ 8
    // 注意：旁边的 videoBitrate 是另一个字段，语义本就是比特/秒，不做换算。
    const throughputKbit = this.dashPlayer?.getAverageThroughput('video') ?? 0;
    const downloadSpeed = throughputKbit > 0 ? (throughputKbit * 1000) / 8 : 0;

    return {
      ...this.stats,
      currentTime: this.dashPlayer?.time() ?? video?.currentTime ?? 0,
      duration: this.dashPlayer?.duration() ?? video?.duration ?? 0,
      bufferLength: bufferInfo.length,
      firstFrameTime: this.firstFrameTime,
      totalStallCount: this.stats.totalStallCount || 0,
      totalStallTime: this.stats.totalStallTime || 0,
      videoBitrate: currentRepresentation?.bandwidth,
      downloadSpeed,
      resolution: currentRepresentation?.width && currentRepresentation?.height
        ? { width: currentRepresentation.width, height: currentRepresentation.height }
        : undefined,
    };
  }

  /**
   * 取某个 representation 的视频编码原始串（库原始 API → 我们的 codecString）
   * 依据本地 dashjs@5.1.1 的 index.d.ts（node_modules/.pnpm/dashjs@5.1.1_[hash]/node_modules/dashjs/index.d.ts）：
   * - L986 `codecs: string | null`（如 "avc1.640028" / "hvc1.1.6.L93.B0" / "av01.0.08M.08"，首选）
   * - L999 `mimeType: string | null`（容器类型，如 "video/mp4"；dash.js 的 getMimeType() 才会拼上 codecs，
   *   单独的 mimeType 不含编码信息，这里只作为兜底，解析不出编码时由 resolveVideoCodec 返回空）
   *
   * @param rep - dash.js 的 Representation
   * @returns 视频编码原始串；取不到返回 undefined
   */
  private extractVideoCodecString(rep: Representation): string | undefined {
    return rep.codecs || rep.mimeType || undefined;
  }

  /**
   * 获取可用画质列表
   * 从 dash.js 获取所有可用的视频码率/分辨率列表
   *
   * 列表结构（真实档位在前，自动档固定在最后）：
   * - 自动档：id='auto' / isAuto=true；width/height/bitrate/codec 取「当前生效的视频 representation」，
   *   供 UI 拼出「自动(1080P 高清)」
   * - 真实档位：id 为 dash.js 的 representation.index 字符串，label 为 `${height}P`
   *
   * @returns 画质等级列表（QualityLevel[]）
   */
  getQualities(): QualityLevel[] {
    const dash = this.dashPlayer;
    if (!dash) return [];

    const representations = dash.getRepresentationsByType('video') ?? [];

    const list: QualityLevel[] = representations.map((rep) => {
      const { codec, codecString } = resolveVideoCodec(this.extractVideoCodecString(rep));
      return {
        id: String(rep.index),
        label: `${rep.height}P${QUALITY_LABEL_SUFFIX[rep.height] ?? ''}`,
        width: rep.width,
        height: rep.height,
        bitrate: rep.bandwidth,
        isAuto: false,
        codec,
        codecString,
      };
    });

    if (list.length <= 1) return list;

    const current = dash.getCurrentRepresentationForType('video');
    const autoCodec = resolveVideoCodec(
      current ? this.extractVideoCodecString(current) : undefined,
    );
    list.push({
      id: AUTO_QUALITY_ID,
      label: '自动',
      width: current?.width ?? 0,
      height: current?.height ?? 0,
      bitrate: current?.bandwidth ?? 0,
      isAuto: true,
      codec: autoCodec.codec,
      codecString: autoCodec.codecString,
    });

    return list;
  }

  /**
   * 设置播放画质
   * - 'auto'：开启视频轨 ABR 自动切档（不走手动选档）
   * - 具体档位：先关闭 ABR，避免自动切档覆盖手动选择，再手动选中对应 representation
   *
   * 「切回自动」的确切 API（依据本地 dashjs@5.1.1 index.d.ts）：
   * dash.js 没有 setAutoSwitchQuality 之类的方法，ABR 开关只存在于 settings 中：
   * - L2285 `updateSettings(settings: MediaPlayerSettingClass): void`（唯一的写入入口）
   * - L1925-1928 `autoSwitchBitrate?: { audio?: boolean; video?: boolean }`（位于 streaming.abr 下）
   * 因此把 streaming.abr.autoSwitchBitrate.video 置为 true 就是切回自动；
   * 之后 dash.js 的 ABR 控制器会在下一个切档点自行选档（getCurrentQuality() 也据此判定为 'auto'）。
   *
   * @param quality - 画质标识（QualityLevel.id，或 AUTO_QUALITY_ID）
   */
  setQuality(quality: string): void {
    const dash = this.dashPlayer;
    if (!dash) return;

    if (quality === AUTO_QUALITY_ID) {
      // 切回自动档：dash.js 无 setAutoSwitchQuality API，需通过 updateSettings 打开 ABR 开关
      dash.updateSettings({
        streaming: { abr: { autoSwitchBitrate: { video: true } } },
      });
      // 切自动档不会立刻触发 qualityChangeRendered；立即上报成功，避免播放器等待超时误判失败
      const autoRep = dash.getCurrentRepresentationForType('video');
      this.eventBus?.emit(PlayerEventEnum.STREAM_QUALITY_CHANGE, {
        width: autoRep?.width ?? 0,
        height: autoRep?.height ?? 0,
        bitrate: autoRep?.bandwidth ?? 0,
        isAuto: true,
        qualityId: AUTO_QUALITY_ID,
        label: '自动',
      });
      return;
    }

    const index = Number(quality);
    if (!Number.isInteger(index) || index < 0) {
      logger.warn(`忽略非法的画质档位: ${quality}`);
      return;
    }

    // 手动档位：先关闭 ABR，防止自动切档覆盖手动选择
    dash.updateSettings({
      streaming: { abr: { autoSwitchBitrate: { video: false } } },
    });
    dash.setRepresentationForTypeByIndex('video', index);
    // 同步上报成功，避免某些 dash.js 版本不触发 qualityChangeRendered 时被超时误判
    const rep = dash.getCurrentRepresentationForType('video');
    if (rep) {
      this.eventBus?.emit(PlayerEventEnum.STREAM_QUALITY_CHANGE, {
        width: rep.width,
        height: rep.height,
        bitrate: rep.bandwidth,
        isAuto: false,
        qualityId: String(rep.index),
        label: `${rep.width}x${rep.height}`,
      });
    }
  }

  /**
   * 获取当前生效的档位 id
   * - ABR 自动切档开启时视为自动档，返回 'auto'
   * - 否则返回当前视频 representation 的索引字符串
   *
   * @returns 'auto' | 档位索引字符串 | ''（实例未就绪或无法获取）
   */
  getCurrentQuality(): string {
    const dash = this.dashPlayer;
    if (!dash) return '';

    const autoSwitch = dash.getSettings()?.streaming?.abr?.autoSwitchBitrate?.video;
    if (autoSwitch === true) return 'auto';

    const rep = dash.getCurrentRepresentationForType('video');
    return rep ? String(rep.index) : '';
  }

  /**
   * 应用清晰度上限/下限限制（映射到 dash.js 的 ABR 码率上下限）
   * 说明：dash.js 只有 maxBitrate / minBitrate（单位比特/秒），没有像素高度上限 API，
   * 因此这里按像素高度取对应档位的码率作为阈值：
   * - 上限：取 height <= max 的最高档码率
   * - 下限：取 height >= min 的最低档码率
   *
   * @param limits - 上限/下限（像素高度）
   */
  applyLimits(limits: { max?: number; min?: number }): void {
    const dash = this.dashPlayer;
    if (!dash) return;
    if (limits.max === undefined && limits.min === undefined) return;

    const reps = dash.getRepresentationsByType('video') ?? [];
    const abr: {
      maxBitrate?: { video: number };
      minBitrate?: { video: number };
    } = {};

    if (limits.max !== undefined) {
      const maxBitrate = this.pickBitrateByHeight(reps, limits.max, true);
      if (maxBitrate !== undefined) abr.maxBitrate = { video: maxBitrate };
    }
    if (limits.min !== undefined) {
      const minBitrate = this.pickBitrateByHeight(reps, limits.min, false);
      if (minBitrate !== undefined) abr.minBitrate = { video: minBitrate };
    }
    if (abr.maxBitrate === undefined && abr.minBitrate === undefined) return;

    dash.updateSettings({ streaming: { abr } });
  }

  /**
   * 在视频 representation 列表中按像素高度匹配对应的码率阈值
   * @param reps - 视频 representation 列表
   * @param height - 目标高度（像素）
   * @param isMax - true 取 height <= 目标的最高档；false 取 height >= 目标的最低档
   * @returns 匹配到的码率，未匹配返回 undefined
   */
  private pickBitrateByHeight(
    reps: Representation[],
    height: number,
    isMax: boolean,
  ): number | undefined {
    let picked: Representation | undefined;
    for (const rep of reps) {
      if (isMax) {
        if (rep.height <= height && (!picked || rep.height > picked.height)) picked = rep;
      } else {
        if (rep.height >= height && (!picked || rep.height < picked.height)) picked = rep;
      }
    }
    return picked?.bandwidth;
  }

  /**
   * 订阅清晰度列表变化
   * @param cb - 列表变化回调
   * @returns 取消订阅函数
   */
  onQualitiesChange(cb: (list: QualityLevel[]) => void): () => void {
    this.qualityListeners.add(cb);
    return () => {
      this.qualityListeners.delete(cb);
    };
  }

  /**
   * 是否支持自动档（ABR 自适应码率）
   * dash.js 支持 ABR 自动切档
   * @returns 恒为 true
   */
  supportsAutoQuality(): boolean {
    return true;
  }

  /** 通知所有清晰度订阅者（流初始化时调用） */
  private notifyQualitiesChange(): void {
    if (this.qualityListeners.size === 0) return;
    const list = this.getQualities();
    this.qualityListeners.forEach((cb) => cb(list));
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
   * 获取底层 dash.js 播放器实例
   * 供统计监控（如 VideoInfo 的码率曲线）读取库原生实时数据
   *
   * @returns dash.js MediaPlayer 实例；未加载 / 已销毁返回 null
   */
  getNativePlayer(): unknown {
    return this.dashPlayer;
  }

  /**
   * 获取当前流媒体配置
   * @returns 流媒体配置，未加载返回 null
   */
  getConfig(): StreamConfig | null {
    return this.config;
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
   * 获取播放器实例引用
   * @returns 播放器实例，未安装返回 null
   */
  getPlayer(): VideoPlayer | null {
    return this.player;
  }
}

/**
 * DASH 插件工厂函数
 * 创建并返回一个新的 DashPlugin 实例
 *
 * @param config - DASH 插件配置
 * @returns DashPlugin 实例
 *
 * @example
 * // 基本用法
 * player.use(createDashPlugin());
 *
 * @example
 * // 自定义配置
 * player.use(createDashPlugin({
 *   autoplay: false,
 *   streaming: {
 *     abr: { autoSwitchBitrate: true }
 *   }
 * }));
 */
export function createDashPlugin(config?: DashPluginConfig): DashPlugin {
  return new DashPlugin(config);
}
