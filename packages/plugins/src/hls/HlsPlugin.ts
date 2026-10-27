/**
 * ============================================
 * HLS 流媒体插件 (HlsPlugin)
 * ============================================
 * 基于 fork 版本 hls.js 的 HLS 格式流媒体播放器插件
 *
 * 功能：
 * - 静态导入 fork 版本 hls.js 库（支持对象注入模式）
 * - 支持自适应码率切换 (ABR)
 * - 支持直播和点播模式
 * - 支持 URL 字符串和清单对象两种加载方式
 * - fork 版本通过 loadManifest() 支持对象注入模式
 * - useLocalHls 选项支持 Safari 原生 HLS 回退
 * - 提供缓冲、码率、帧率等实时统计信息
 * - 通过事件总线与播放器和其他插件通信（契约事件走播放器总线，
 *   StreamPluginEventEnum 私有事件走插件私有总线）
 * - 自动检测浏览器兼容性（含 iOS/macOS Safari 特殊处理）
 * - 致命错误自动恢复（recoverMediaError）
 * - 首帧时间追踪
 *
 * 使用方式：
 * import { createHlsPlugin } from '@lumina/plugins';
 * const player = new VideoPlayer({
 *   plugins: [createHlsPlugin({ autoplay: true })]
 * });
 */

import Hls from 'hls.js';
import type { ManifestVariant, ManifestAudioGroup, ManifestParsedData, ErrorData, LevelSwitchedData, Level } from 'hls.js';
import type { MediaManifest } from '../vendor/types';
import { manifestToHls } from '../vendor/manifest-to-hls';
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

const logger = createLogger('HlsPlugin');

/**
 * 清单源对象类型（直接传入 ManifestVariant[] + ManifestAudioGroup[]）
 */
interface ManifestSourceObject {
  variants: ManifestVariant[];
  audioGroups?: ManifestAudioGroup[];
  [key: string]: string | number | boolean | ManifestVariant[] | ManifestAudioGroup[] | undefined;
}

/**
 * 类型谓词：判断源是否为 URL 字符串
 */
function isUrlString(source: string | MediaManifestSource): source is string {
  return typeof source === 'string';
}

/**
 * 类型谓词：判断源是否为 MediaManifest 对象
 * MediaManifest 具有 duration 和 video 字段
 */
function isMediaManifest(source: unknown): source is MediaManifest {
  return (
    typeof source === 'object' &&
    source !== null &&
    'duration' in source &&
    'video' in source
  );
}

/**
 * 类型谓词：判断源是否为普通对象（ManifestSourceObject）
 */
function isManifestObject(source: string | MediaManifestSource): source is ManifestSourceObject {
  return typeof source === 'object' && source !== null;
}

/**
 * HLS 插件配置
 */
export interface HlsPluginConfig {
  /** 是否自动播放，默认 true */
  autoplay?: boolean;
  /** 是否使用浏览器原生 HLS 支持（如 Safari），默认 false */
  useLocalHls?: boolean;
  /** 初始画质级别（-1 为自动） */
  startLevel?: number;
  /** ABR 快速直播权重 */
  abrEwmaFastLive?: number;
  /** ABR 慢速直播权重 */
  abrEwmaSlowLive?: number;
  /** 最大缓冲长度（秒） */
  maxBufferLength?: number;
  /** 最大最大缓冲长度（秒，用于自动暂停的硬限制） */
  maxMaxBufferLength?: number;
  /** 直播同步时长计数 */
  liveSyncDurationCount?: number;
  /** 片段加载超时（毫秒） */
  fragLoadingTimeOut?: number;
  /** 插件选项 */
  options?: PluginOptions;
}

/**
 * HLS 流媒体插件类
 * 实现 StreamPlugin 接口（StreamPlugin 继承 Plugin）
 * 基于 fork 版本 hls.js 提供 HLS 格式视频播放能力
 *
 * 支持三种加载模式：
 * 1. URL 字符串模式：new Hls() → attachMedia() → loadSource(url)
 * 2. 对象注入模式：new Hls({ autoStartLoad: false }) → attachMedia() → 等待 MEDIA_ATTACHED → manifestToHls(source) → loadManifest(variants, audioGroups) → startLoad()
 * 3. Safari 原生 HLS：直接设置 video.src
 */
export class HlsPlugin implements StreamPlugin {
  /** 插件名称（必须唯一） */
  readonly name = 'hls';
  /** 插件版本号 */
  readonly version = '1.0.0';
  /** 插件描述 */
  readonly description = 'HLS 格式流媒体播放器插件，基于 fork 版本 hls.js';
  /** 插件类型 */
  readonly type: StreamPluginTypeEnum = StreamPluginTypeEnum.HLS;

  /** hls.js 播放器实例 */
  private hlsPlayer: Hls | null = null;

  /**
   * 当前 hls.js 实例创建时的 autoStartLoad 配置
   * URL 模式创建的实例为 true（loadSource 拉完清单自动开始加载），
   * 对象注入模式创建的实例为 false（由 loadManifest / startLoad 显式启动）。
   * 复用实例换源时据此判断是否需要手动补 startLoad（fork 版 loadSource
   * 完成清单加载后按 autoStartLoad 决定是否自动开始加载分片）。
   */
  private hlsAutoStartLoad = true;

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

  /**
   * 视频编码偏好（0 默认 / 1 HEVC / 2 AVC / 3 AV1）
   * 设置面板「编码格式」→ VideoPlayer.setCodecPrefer → 此处；
   * 实例未创建时仅暂存，load() 创建实例后统一应用到起播选流
   */
  private codecPreferenceType = 0;

  /**
   * 设置视频编码偏好（StreamPlugin 可选能力的 HLS 实现）
   *
   * 真实生效链路：偏好写入 hls.js config.videoPreference.videoCodec，
   * ABR 起播选流（getStartCodecTier）按 fourCC 匹配优先选择对应
   * 编码的流；已在播时软重载（回到当前位置继续播放）触发 ABR
   * 状态重置（MANIFEST_LOADING → codecTiers/firstSelection 清空），
   * 让新偏好立即生效——不重载则仅对下次清单加载生效（起播
   * tier 选择已缓存不会重跑）
   * @param type - 编码偏好：0 默认（清除偏好）/ 1 HEVC / 2 AVC / 3 AV1
   */
  setCodecPreference(type: number): void {
    this.codecPreferenceType = type;
    this.applyVideoCodecPreference();

    // 已在播的 URL 流：软重载让 ABR 按新偏好重新起播选流
    if (
      this.hlsPlayer &&
      this.config &&
      typeof this.config.url === 'string' &&
      this.videoElement &&
      this.videoElement.currentTime > 0 &&
      !this.videoElement.ended
    ) {
      const resumeTime = this.videoElement.currentTime;
      const wasPaused = this.videoElement.paused;
      this.load({ ...this.config, startTime: resumeTime });
      if (!wasPaused) {
        void this.play();
      }
    }
  }

  /**
   * 把编码偏好应用到 hls.js 实例配置（0 = 清除偏好）
   *
   * fourCC 约定与 hls.js rendition 匹配规则对齐：
   * HEVC → 'hvc1'、AVC → 'avc1'、AV1 → 'av01'；
   * 清单无匹配流时 hls.js 自动回退默认选择（优雅降级）
   */
  private applyVideoCodecPreference(): void {
    if (!this.hlsPlayer) return;
    const preference = { ...(this.hlsPlayer.config.videoPreference ?? {}) };
    if (this.codecPreferenceType === 1) {
      preference.videoCodec = 'hvc1';
    } else if (this.codecPreferenceType === 2) {
      preference.videoCodec = 'avc1';
    } else if (this.codecPreferenceType === 3) {
      preference.videoCodec = 'av01';
    } else {
      delete preference.videoCodec;
    }
    this.hlsPlayer.config.videoPreference = preference;
  }

  /** 插件自定义配置 */
  private pluginConfig: HlsPluginConfig;

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
   * @param config - HLS 插件配置
   */
  constructor(config?: HlsPluginConfig) {
    this.pluginConfig = {
      autoplay: true,
      useLocalHls: false,
      startLevel: -1,
      abrEwmaFastLive: 3.0,
      abrEwmaSlowLive: 9.0,
      maxBufferLength: 30,
      maxMaxBufferLength: 600,
      liveSyncDurationCount: 3,
      fragLoadingTimeOut: 20000,
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
    // 1. 保存播放器实例引用
    this.player = player;
    // 2. 从播放器获取事件总线（公共属性）
    this.eventBus = player.events;
    // 3. 检测浏览器能力（HLS 在 iOS 上使用原生播放，在桌面端依赖 MSE）
    this.browserCapability = BrowserCapabilityDetector.getFullCapabilityResult();
    const hlsSupport = BrowserCapabilityDetector.checkHlsjsSupport();
    logger.info(
      `浏览器能力检测: HLS支持=${hlsSupport.supported}, ` +
      `详情=${hlsSupport.detail}, ` +
      `浏览器=${this.browserCapability.browserName} ${this.browserCapability.browserVersion}, ` +
      `系统=${this.browserCapability.osName} ${this.browserCapability.osVersion}`
    );
    // 4. 监听播放器挂载完成事件，获取视频元素
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
   * 清理所有资源：销毁 hls.js 实例、释放引用
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
   * 检查浏览器是否支持 hls.js 播放
   * 优先使用缓存的检测结果，否则实时检测
   *
   * @returns 是否支持 hls.js
   */
  isSupported(): boolean {
    // 优先使用安装时缓存的检测结果
    if (this.browserCapability) {
      return this.browserCapability.hlsjsSupported;
    }
    // 降级：实时检测
    if (typeof window === 'undefined') return false;
    return Hls.isSupported();
  }

  /**
   * 加载 HLS 流媒体
   * 使用 fork 版本 hls.js 创建播放器实例
   *
   * 支持三种加载模式：
   * 1. URL 字符串模式：new Hls() → attachMedia() → loadSource(url)
   * 2. 对象注入模式：new Hls({ autoStartLoad: false }) → attachMedia() → 等待 MEDIA_ATTACHED → manifestToHls(source) → loadManifest(variants, audioGroups) → startLoad()
   * 3. Safari 原生 HLS：直接设置 video.src
   *
   * @param config - 流媒体配置（包含 URL 或清单对象、格式等）
   */
  load(config: StreamConfig): void {
    if (!this.videoElement) {
      const msg = '视频元素未设置，请确保播放器已挂载到 DOM';
      logger.error(msg);
      this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
      return;
    }

    this.config = config;
    this.loadStartTime = Date.now();
    this.firstFrameRecorded = false;
    this.firstFrameTime = 0;

    // 注册首帧时间追踪
    this.registerFirstFrameTracking();

    const source = config.url;

    // Safari 原生 HLS 支持：useLocalHls 且浏览器原生支持 HLS 且源为 URL 字符串
    if (
      this.pluginConfig.useLocalHls &&
      isUrlString(source) &&
      this.videoElement.canPlayType('application/vnd.apple.mpegurl')
    ) {
      this.videoElement.src = source;
      this.streamEventBus.emit(StreamPluginEventEnum.LOAD_COMPLETE, { url: source });

      if (this.pluginConfig.autoplay) {
        this.play();
      }
      if (config.startTime && config.startTime > 0) {
        this.seek(config.startTime);
      }

      logger.info('使用原生 HLS 支持:', source);
      return;
    }

    // 检查浏览器是否支持 hls.js
    if (!Hls.isSupported()) {
      const msg = `hls.js 检测到当前浏览器不支持 HLS 播放（${this.browserCapability?.browserName || '未知'} ${this.browserCapability?.browserVersion || ''}）`;
      logger.error(msg);
      this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
      return;
    }

    if (!this.videoElement) {
      const msg = '视频元素已被移除，无法加载';
      logger.error(msg);
      this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
      return;
    }

    // 根据源类型选择加载方式
    if (isUrlString(source) && source.split('?')[0].toLowerCase().endsWith('.json')) {
      // ============================================
      // JSON Manifest 模式
      // ============================================
      // 先 fetch JSON，再转换为 hls.js 清单对象注入
      this.loadJsonManifest(source);
    } else if (isUrlString(source)) {
      // ============================================
      // URL 字符串模式
      // ============================================
      if (this.hlsPlayer) {
        // 复用已有实例换源（互动视频分支切换 / 换视频场景不销毁重建）：
        // fork 版 loadSource 支持重复调用（内部 stopLoad + MediaSource 重建）；
        // 事件在实例创建时已绑定，不重复绑定
        this.hlsPlayer.loadSource(source);
        // 实例来自对象注入路径（autoStartLoad=false）时，loadSource 拉完
        // 清单后不会自动开始加载分片，手动补一次 startLoad
        if (!this.hlsAutoStartLoad) {
          this.hlsPlayer.startLoad();
        }
      } else {
        // 1. 创建 Hls 实例（autoStartLoad 默认 true）
        this.hlsPlayer = new Hls({
          startLevel: this.pluginConfig.startLevel,
          abrEwmaFastLive: this.pluginConfig.abrEwmaFastLive,
          abrEwmaSlowLive: this.pluginConfig.abrEwmaSlowLive,
          maxBufferLength: this.pluginConfig.maxBufferLength,
          maxMaxBufferLength: this.pluginConfig.maxMaxBufferLength,
          liveSyncDurationCount: this.pluginConfig.liveSyncDurationCount,
          fragLoadingTimeOut: this.pluginConfig.fragLoadingTimeOut,
        });
        this.hlsAutoStartLoad = true;

        // 应用编码偏好（实例就绪，在起播选流前写入 videoPreference）
        this.applyVideoCodecPreference();

        // 2. 绑定视频元素
        this.hlsPlayer.attachMedia(this.videoElement);

        // 3. 加载 URL 源
        this.hlsPlayer.loadSource(source);

        // 4. 绑定 hls.js 事件（实例级，只在创建时绑定一次）
        this.bindEvents();
      }

      logger.info('HLS 流加载成功:', source);
    } else if (isMediaManifest(source)) {
      // ============================================
      // 对象注入模式（MediaManifest）
      // ============================================
      if (this.hlsPlayer) {
        // 复用已有实例换源：video 元素已 attach，无需等待 MEDIA_ATTACHED，
        // 直接转换注入——fork 版 loadManifest 支持重复调用（内部 stopLoad +
        // MediaSource 重建）且自带 startLoad(0) 启动加载
        const hlsData = manifestToHls(source);
        this.hlsPlayer.loadManifest(hlsData.variants, hlsData.audioGroups);

        logger.info('HLS 流加载成功（对象注入模式·复用实例）');
      } else {
        // 1. 创建 Hls 实例，autoStartLoad 必须设为 false
        this.hlsPlayer = new Hls({
          autoStartLoad: false,
          startLevel: this.pluginConfig.startLevel,
          abrEwmaFastLive: this.pluginConfig.abrEwmaFastLive,
          abrEwmaSlowLive: this.pluginConfig.abrEwmaSlowLive,
          maxBufferLength: this.pluginConfig.maxBufferLength,
          maxMaxBufferLength: this.pluginConfig.maxMaxBufferLength,
          liveSyncDurationCount: this.pluginConfig.liveSyncDurationCount,
          fragLoadingTimeOut: this.pluginConfig.fragLoadingTimeOut,
        });
        this.hlsAutoStartLoad = false;

        // 应用编码偏好（实例就绪，在起播选流前写入 videoPreference）
        this.applyVideoCodecPreference();

        // 2. 绑定视频元素
        this.hlsPlayer.attachMedia(this.videoElement);

        // 3. 绑定 hls.js 事件（在 MEDIA_ATTACHED 之前绑定，确保不遗漏事件）
        this.bindEvents();

        // 4. 等待 MEDIA_ATTACHED 事件后，转换清单并注入
        const doManifestInjection = (): void => {
          if (!this.hlsPlayer) return;

          // 4a. 转换清单对象
          const hlsData = manifestToHls(source as MediaManifest);

          // 5. 加载清单
          this.hlsPlayer.loadManifest(hlsData.variants, hlsData.audioGroups);

          // 6. 开始加载片段
          this.hlsPlayer.startLoad();

          logger.info('HLS 流加载成功（对象注入模式）');
        };

        // 等待 MEDIA_ATTACHED 事件
        this.hlsPlayer.once(Hls.Events.MEDIA_ATTACHED, () => {
          doManifestInjection();
        });
      }
    } else if (isManifestObject(source)) {
      // ============================================
      // 对象注入模式（直接传入 ManifestVariant[] + ManifestAudioGroup[]）
      // ============================================
      if (this.hlsPlayer) {
        // 复用已有实例换源：video 元素已 attach，无需等待 MEDIA_ATTACHED，
        // 直接注入——fork 版 loadManifest 支持重复调用且自带 startLoad(0)
        const manifestSource = source as ManifestSourceObject;
        if (manifestSource.variants && Array.isArray(manifestSource.variants)) {
          this.hlsPlayer.loadManifest(
            manifestSource.variants,
            manifestSource.audioGroups,
          );
          logger.info('HLS 流加载成功（对象注入模式 - 直接传入·复用实例）');
        } else {
          const msg = '清单对象缺少 variants 字段';
          logger.error(msg);
          this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
          return;
        }
      } else {
        // 1. 创建 Hls 实例，autoStartLoad 必须设为 false
        this.hlsPlayer = new Hls({
          autoStartLoad: false,
          startLevel: this.pluginConfig.startLevel,
          abrEwmaFastLive: this.pluginConfig.abrEwmaFastLive,
          abrEwmaSlowLive: this.pluginConfig.abrEwmaSlowLive,
          maxBufferLength: this.pluginConfig.maxBufferLength,
          maxMaxBufferLength: this.pluginConfig.maxMaxBufferLength,
          liveSyncDurationCount: this.pluginConfig.liveSyncDurationCount,
          fragLoadingTimeOut: this.pluginConfig.fragLoadingTimeOut,
        });
        this.hlsAutoStartLoad = false;

        // 应用编码偏好（实例就绪，在起播选流前写入 videoPreference）
        this.applyVideoCodecPreference();

        // 2. 绑定视频元素
        this.hlsPlayer.attachMedia(this.videoElement);

        // 3. 绑定 hls.js 事件
        this.bindEvents();

        // 4. 等待 MEDIA_ATTACHED 事件后，直接注入 variants 和 audioGroups
        const doDirectInjection = (): void => {
          if (!this.hlsPlayer) return;

          const manifestSource = source as ManifestSourceObject;
          if (manifestSource.variants && Array.isArray(manifestSource.variants)) {
            // 5. 加载清单
            this.hlsPlayer.loadManifest(
              manifestSource.variants,
              manifestSource.audioGroups,
            );

            // 6. 开始加载片段
            this.hlsPlayer.startLoad();

            logger.info('HLS 流加载成功（对象注入模式 - 直接传入）');
          } else {
            const msg = '清单对象缺少 variants 字段';
            logger.error(msg);
            this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
            return;
          }
        };

        // 等待 MEDIA_ATTACHED 事件
        this.hlsPlayer.once(Hls.Events.MEDIA_ATTACHED, () => {
          doDirectInjection();
        });
      }
    } else {
      const msg = '不支持的源类型';
      logger.error(msg);
      this.streamEventBus.emit(StreamPluginEventEnum.ERROR, { message: msg });
      return;
    }

    this.streamEventBus.emit(StreamPluginEventEnum.LOAD_COMPLETE, { url: source });

    if (this.pluginConfig.autoplay) {
      this.play();
    }
    if (config.startTime && config.startTime > 0) {
      this.seek(config.startTime);
    }
  }

  /**
   * 把已解析的清单对象转交给其它流媒体插件
   *
   * JSON 清单的协议按内容判定（detectManifestProtocol）：内容声明为 DASH 且 DASH 插件
   * 已注册时交给它处理，避免用 HLS 转换器解析 DASH 清单。
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
      format === StreamFormatEnum.DASH
        ? StreamPluginTypeEnum.DASH
        : StreamPluginTypeEnum.HLS,
    );
    if (!target || target === (this as unknown as typeof target)) return false;

    this.removeFirstFrameTracking();
    if (this.hlsPlayer) {
      this.hlsPlayer.stopLoad();
      this.hlsPlayer.destroy();
      this.hlsPlayer = null;
    }
    this.config = null;

    middleware.load({ url: manifest, format });
    return true;
  }

  /**
   * 加载 JSON Manifest 文件
   * 先 fetch JSON，解析为 MediaManifest 对象，再转换为 hls.js 清单注入
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
      const manifest: unknown = await response.json();

      if (!isMediaManifest(manifest)) {
        throw new Error('JSON 格式不是有效的 MediaManifest（缺少 duration 或 video 字段）');
      }

      // 按内容判定协议：不是 HLS 时转交给对应插件（已注册才转交）
      if (
        detectManifestProtocol(manifest) === 'dash' &&
        this.forwardToStreamPlugin(manifest, StreamFormatEnum.DASH)
      ) {
        return;
      }

      // 转换清单对象
      const hlsData = manifestToHls(manifest);

      if (this.hlsPlayer) {
        // 复用已有实例换源：video 元素已 attach，直接注入
        //（fork 版 loadManifest 支持重复调用且自带 startLoad(0)）
        this.hlsPlayer.loadManifest(hlsData.variants, hlsData.audioGroups);
      } else {
        // 创建 Hls 实例（autoStartLoad 必须设为 false）
        this.hlsPlayer = new Hls({
          autoStartLoad: false,
          startLevel: this.pluginConfig.startLevel,
          abrEwmaFastLive: this.pluginConfig.abrEwmaFastLive,
          abrEwmaSlowLive: this.pluginConfig.abrEwmaSlowLive,
          maxBufferLength: this.pluginConfig.maxBufferLength,
          maxMaxBufferLength: this.pluginConfig.maxMaxBufferLength,
          liveSyncDurationCount: this.pluginConfig.liveSyncDurationCount,
          fragLoadingTimeOut: this.pluginConfig.fragLoadingTimeOut,
        });
        this.hlsAutoStartLoad = false;

        this.hlsPlayer.attachMedia(this.videoElement!);
        this.bindEvents();

        // 加载清单
        this.hlsPlayer.loadManifest(hlsData.variants, hlsData.audioGroups);
        this.hlsPlayer.startLoad();
      }

      logger.info('HLS 流加载成功 (JSON Manifest模式)');
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
   * 绑定 hls.js 核心事件
   * 将 hls.js 的内部事件转换为统一的 StreamPlugin 事件
   *
   * 绑定事件列表：
   * - MEDIA_ATTACHED: 媒体附加完成
   * - MANIFEST_PARSED: 清单解析完成
   * - ERROR: 播放器错误（区分致命/非致命）
   * - FRAG_LOADED: 片段加载完成
   * - LEVEL_SWITCHED: 画质级别切换
   * - BUFFER_APPENDED: 片段缓冲追加完成
   */
  private bindEvents(): void {
    if (!this.hlsPlayer) return;

    const Events = Hls.Events;

    // 媒体附加完成
    this.hlsPlayer.on(Events.MEDIA_ATTACHED, () => {
      logger.info('媒体已附加到视频元素');
    });

    // 清单解析完成 → 获取可用画质信息
    this.hlsPlayer.on(Events.MANIFEST_PARSED, (_event: string, data: ManifestParsedData) => {
      if (data && 'levels' in data && Array.isArray(data.levels)) {
        logger.info('清单解析完成，可用画质:', data.levels.length);
        this.streamEventBus.emit(StreamPluginEventEnum.METADATA_LOADED, data);
        // 清单解析后清晰度列表就绪，推送给订阅者
        this.notifyQualitiesChange();
      }
    });

    // 播放器错误处理（区分致命/非致命错误）
    this.hlsPlayer.on(Events.ERROR, (_event: string, data: ErrorData) => {
      logger.error('播放器错误:', data);

      if (data.fatal) {
        // 致命错误：向播放器总线广播契约事件 STREAM_ERROR
        // message 取 hls.js 错误详情里的字符串，error 传原始错误对象
        this.eventBus?.emit(PlayerEventEnum.STREAM_ERROR, {
          message: data.error?.message || String(data.details),
          error: data,
        });

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            this.streamEventBus.emit(StreamPluginEventEnum.NETWORK_ERROR, data);
            // 网络错误：尝试重新加载
            this.hlsPlayer?.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            this.streamEventBus.emit(StreamPluginEventEnum.DECODE_ERROR, data);
            // 媒体错误：尝试恢复
            this.hlsPlayer?.recoverMediaError();
            break;
          default:
            this.streamEventBus.emit(StreamPluginEventEnum.ERROR, data);
            break;
        }
      }
    });

    // 缓冲追加完成 → 计算卡顿时长
    this.hlsPlayer.on(Events.BUFFER_APPENDED, () => {
      if (this.lastStallTime > 0) {
        const stallDuration = Date.now() - this.lastStallTime;
        this.stats.totalStallTime = (this.stats.totalStallTime || 0) + stallDuration;
        this.stats.totalStallCount = (this.stats.totalStallCount || 0) + 1;
        this.lastStallTime = 0;
      }
      this.streamEventBus.emit(StreamPluginEventEnum.BUFFER_END, {});
    });

    // 片段加载完成 → 广播一次统计信息
    // 下载速度本身由 fork 版 hls.js 内部采样（见 getStats 中的 getDownloadSpeed 调用）
    this.hlsPlayer.on(Events.FRAG_LOADED, () => {
      this.streamEventBus.emit(StreamPluginEventEnum.STATS_UPDATE, this.getStats());
    });

    // 画质级别切换
    this.hlsPlayer.on(Events.LEVEL_SWITCHED, (_event: string, data: LevelSwitchedData) => {
      logger.info('画质切换至级别:', data.level);
      this.streamEventBus.emit(StreamPluginEventEnum.STATS_UPDATE, this.getStats());
      // 级别切换时列表可能已变化，重新推送一次
      this.notifyQualitiesChange();

      // 从 levels 中取实际生效的档位（Auto 模式下 data.level 为 ABR 选中的真实档位）
      const levelObj = this.hlsPlayer?.levels[data.level];
      if (!levelObj) return;

      // 切到 auto 时同样会触发 LEVEL_SWITCHED，此时 isAuto=true 且附带真实档位 id，
      // 作为「切换成功」的信号上报给上层
      const payload: StreamQualityChangePayload = {
        width: levelObj.width,
        height: levelObj.height,
        bitrate: levelObj.bitrate,
        isAuto: this.isAutoQuality(),
        qualityId: String(data.level),
        label: levelObj.height ? `${levelObj.height}p` : `Level ${data.level}`,
      };
      // 向播放器总线广播契约事件 STREAM_QUALITY_CHANGE（等价于旧名 QUALITY_CHANGE）
      this.eventBus?.emit(PlayerEventEnum.STREAM_QUALITY_CHANGE, payload);
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
   * 直接设置视频元素的 currentTime（hls.js 会自动处理缓冲）
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
   * 停止加载、销毁 hls.js 实例，清理所有引用
   */
  destroy(): void {
    this.removeFirstFrameTracking();
    if (this.hlsPlayer) {
      this.hlsPlayer.stopLoad();
      this.hlsPlayer.destroy();
      this.hlsPlayer = null;
      // 复位 autoStartLoad 标记（下次 load 走全新创建路径时重新记录）
      this.hlsAutoStartLoad = true;
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
    const currentLevel = this.hlsPlayer?.levels[this.hlsPlayer?.currentLevel ?? 0];

    return {
      ...this.stats,
      currentTime: video?.currentTime || 0,
      duration: video?.duration || 0,
      bufferLength: bufferInfo.length,
      firstFrameTime: this.firstFrameTime,
      totalStallCount: this.stats.totalStallCount || 0,
      totalStallTime: this.stats.totalStallTime || 0,
      videoBitrate: currentLevel?.bitrate,
      // 缓冲速度由 fork 版 hls.js 的 getDownloadSpeed() 提供（字节/秒；无采样返回 0）
      downloadSpeed: this.hlsPlayer?.getDownloadSpeed() || 0,
      resolution: currentLevel?.width && currentLevel?.height
        ? { width: currentLevel.width, height: currentLevel.height }
        : undefined,
    };
  }

  /**
   * 取某个 level 的视频编码原始串（库原始 API → 我们的 codecString）
   * 依据本地 fork（packages/plugins/hls）的 dist/hls.d.ts：
   * - L3030 `readonly videoCodec: string | undefined`（清单解析出的视频编码，首选）
   * - L3077 `CODECS?: string`（LevelAttributes，即 #EXT-X-STREAM-INF 的 CODECS 原串，如 "avc1.640028,mp4a.40.2"）
   * - L3052 `get codecs(): string`（同一 CODECS 串的 getter）
   * - L3023 `readonly codecSet: string`（由 videoCodec/audioCodec 拼成，见 hls/src/types/level.ts:153）
   *
   * @param level - hls.js 的 Level 对象
   * @returns 视频编码原始串；取不到返回 undefined
   */
  private extractVideoCodecString(level: Level): string | undefined {
    if (level.videoCodec) return level.videoCodec;
    const raw = level.attrs?.CODECS || level.codecs || level.codecSet;
    return raw || undefined;
  }

  /**
   * ABR（自动档）是否可用
   * 判据：hls.js 实例就绪 且 levels 中存在多个真实档位。
   * 只有一档时不存在可自适应的码率，视为「无 ABR 场景」，列表里不出现自动档。
   * 注意：手动锁定某档后 autoLevelEnabled 会变成 false，但 ABR 能力仍在，
   * 此时自动档必须保留（否则用户无法切回自动），因此判据不含 autoLevelEnabled。
   */
  private isAbrAvailable(): boolean {
    return (this.hlsPlayer?.levels?.length ?? 0) > 1;
  }

  /**
   * 取自动档当前实际生效的档位对象（供 UI 显示「自动(1080P 高清)」）
   * 依据本地 fork（packages/plugins/hls）的 dist/hls.d.ts：
   * - L1996-1998 `get currentLevel(): number`「Index of quality level (variant) currently played」
   *   —— 自动档下它返回 ABR 实际选中的档位索引（不是 -1），仅起播前为 -1
   * - L2014-2017 `get loadLevel(): number`（当前/最近一次加载片段的档位）
   * - L2104-2107 `get nextAutoLevel(): number`（ABR 预估的下一档）
   *
   * @returns 命中的档位；三级取值都不可用时返回 undefined
   */
  private getAutoLevelInfo(): Level | undefined {
    const hls = this.hlsPlayer;
    if (!hls) return undefined;

    const levels = hls.levels ?? [];
    for (const index of [hls.currentLevel, hls.loadLevel, hls.nextAutoLevel]) {
      if (index >= 0 && index < levels.length) return levels[index];
    }
    return undefined;
  }

  /**
   * 获取可用画质列表
   * 从 hls.js 获取所有可用的码率/分辨率级别
   *
   * 列表结构（自动档放在最前，即 index 0）：
   * - 第 0 项（ABR 可用时才有）：自动档，id='auto' / isAuto=true；
   *   width/height/bitrate/codec 取「当前 ABR 实际选中的档位」，供 UI 拼出「自动(1080P 高清)」
   * - 其余项：真实档位，id 为 hls.js 的 level 索引字符串，原有字段与顺序保持不变
   *
   * @returns 画质列表（id + label + 分辨率 + 码率 + 编码 + 是否自动档）
   */
  getQualities(): QualityLevel[] {
    const hls = this.hlsPlayer;
    if (!hls) return [];

    const levels = hls.levels ?? [];

    // 真实档位：hls.js 的 Level.videoCodec / attrs.CODECS → 我们的 codec / codecString
    const list: QualityLevel[] = levels.map((level, index) => {
      const { codec, codecString } = resolveVideoCodec(this.extractVideoCodecString(level));
      return {
        id: String(index),
        label: level.height ? `${level.height}p` : `Level ${index}`,
        width: level.width,
        height: level.height,
        bitrate: level.bitrate,
        isAuto: false,
        codec,
        codecString,
      };
    });

    // 无 ABR 场景（单档）不产出自动档
    if (!this.isAbrAvailable()) return list;

    const autoLevel = this.getAutoLevelInfo();
    const autoCodec = resolveVideoCodec(autoLevel ? this.extractVideoCodecString(autoLevel) : undefined);
    list.unshift({
      id: AUTO_QUALITY_ID,
      label: '自动',
      width: autoLevel?.width ?? 0,
      height: autoLevel?.height ?? 0,
      bitrate: autoLevel?.bitrate ?? 0,
      isAuto: true,
      codec: autoCodec.codec,
      codecString: autoCodec.codecString,
    });

    return list;
  }

  /**
   * 设置播放画质
   * - 'auto' / '-1'：切回 ABR 自动档
   * - 其它：切到指定索引的真实档位
   *
   * 「切回自动」的确切 API（依据本地 fork（packages/plugins/hls）的 dist/hls.d.ts）：
   * - L2000-2002 `set currentLevel(newLevel: number)`，其 JSDoc 明写
   *   「Set to -1 for automatic level selection」，因此 `currentLevel = -1` 就是切回自动的入口；
   * - hls/src/hls.ts:1022-1026 该 setter 内部执行 `levelController.manualLevel = -1`
   *   并调用 `streamController.immediateLevelSwitch()`，切换真实生效；
   * - autoLevelEnabled 是只读 getter（d.ts L2088-2090 / src/hls.ts:1220-1221
   *   `return this.levelController.manualLevel === -1`），不能直接赋值，
   *   所以只能通过 currentLevel = -1 把 manualLevel 复位为 -1 来间接打开 ABR。
   *
   * @param quality - 画质标识（级别索引字符串，或 AUTO_QUALITY_ID / '-1'）
   */
  setQuality(quality: string): void {
    const hls = this.hlsPlayer;
    if (!hls) return;

    // 'auto' 与 '-1' 等价：都表示切回 ABR 自动档
    const level = quality === AUTO_QUALITY_ID ? -1 : Number(quality);

    // 非法档位（非整数、超出 levels 范围）直接忽略，避免把 NaN/-2 写进 hls.js
    if (!Number.isInteger(level) || level < -1 || level >= (hls.levels?.length ?? 0)) {
      logger.warn(`忽略非法的画质档位: ${quality}`);
      return;
    }

    hls.currentLevel = level;
  }

  /**
   * 获取当前生效的档位 id
   * - 处于 ABR 自动档时返回 'auto'
   * - 否则返回当前实际播放的档位索引字符串
   *
   * 注意：hls.js 在自动档下 currentLevel 仍返回实际选中的档位索引，
   * 因此自动档判断基于 autoLevelEnabled（manualLevel === -1），
   * 并兼容 currentLevel === -1 的未加载 / 显式自动态。
   *
   * @returns 'auto' | 档位索引字符串 | ''（实例未就绪）
   */
  getCurrentQuality(): string {
    const hls = this.hlsPlayer;
    if (!hls) return '';
    if (this.isAutoQuality()) return 'auto';
    return String(hls.currentLevel);
  }

  /**
   * 应用清晰度上限/下限限制（映射到 hls.js 原生配置）
   * - 上限（像素高度）：autoLevelCapping 取 levels 中 height <= max 的最高档索引；max 为空表示不限制（-1）
   * - 下限（像素高度）：hls.js 无直接「最低档」API，用 config.minAutoBitrate（码率阈值）近似，
   *   取 levels 中 height >= min 的最低档的码率；min 为空表示不限制（0）
   *
   * @param limits - 上限/下限（像素高度）
   */
  applyLimits(limits: { max?: number; min?: number }): void {
    const hls = this.hlsPlayer;
    if (!hls) return;

    const levels = hls.levels ?? [];

    // 上限：levels 按码率/分辨率升序，取 height <= max 的最高档索引
    if (limits.max === undefined) {
      hls.autoLevelCapping = -1;
    } else {
      let capIndex = -1;
      for (let i = 0; i < levels.length; i++) {
        if (levels[i].height > 0 && levels[i].height <= limits.max) {
          capIndex = i;
        }
      }
      hls.autoLevelCapping = capIndex;
    }

    // 下限：取 height >= min 的最低档码率作为 minAutoBitrate 阈值
    if (limits.min === undefined) {
      hls.config.minAutoBitrate = 0;
    } else {
      let minBitrate = Number.POSITIVE_INFINITY;
      for (const level of levels) {
        if (level.height >= limits.min && level.bitrate < minBitrate) {
          minBitrate = level.bitrate;
        }
      }
      hls.config.minAutoBitrate = Number.isFinite(minBitrate) ? minBitrate : 0;
    }
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
   * hls.js 支持 `currentLevel = -1` 的自动档
   * @returns 恒为 true
   */
  supportsAutoQuality(): boolean {
    return true;
  }

  /**
   * 当前是否处于 ABR 自动档
   * 优先依据 hls.js 的 autoLevelEnabled（manualLevel === -1），
   * 并兼容 currentLevel === -1 的未加载 / 显式自动态
   */
  private isAutoQuality(): boolean {
    const hls = this.hlsPlayer;
    if (!hls) return false;
    return hls.autoLevelEnabled || hls.currentLevel === -1;
  }

  /** 通知所有清晰度订阅者（清单解析/级别切换时调用） */
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
   * 获取底层 hls.js 播放器实例
   * 供统计监控（如 VideoInfo 的码率曲线）读取库原生实时数据
   *
   * @returns hls.js 实例；未加载 / 已销毁 / Safari 原生 HLS 模式返回 null
   */
  getNativePlayer(): unknown {
    return this.hlsPlayer;
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
 * HLS 插件工厂函数
 * 创建并返回一个新的 HlsPlugin 实例
 *
 * @param config - HLS 插件配置
 * @returns HlsPlugin 实例
 *
 * @example
 * // 基本用法
 * player.use(createHlsPlugin());
 *
 * @example
 * // 自定义缓冲配置
 * player.use(createHlsPlugin({
 *   maxBufferLength: 60,
 *   autoplay: false
 * }));
 *
 * @example
 * // 使用 Safari 原生 HLS 回退
 * player.use(createHlsPlugin({
 *   useLocalHls: true
 * }));
 */
export function createHlsPlugin(config?: HlsPluginConfig): HlsPlugin {
  return new HlsPlugin(config);
}
