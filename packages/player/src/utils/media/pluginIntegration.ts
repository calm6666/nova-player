/**
 * ============================================
 * 媒体监控集成模块 (MediaIntegration)
 * ============================================
 * 统一管理原生视频和三个流媒体插件的视频信息监控
 * 集成浏览器能力检测，提供全向监控能力
 *
 * 功能：
 * - 自动检测播放器类型（native/dash/hls/flv）并启动对应监控
 * - 集成 browserCapabilityDetector 获取浏览器/系统版本信息
 * - 提供统一的视频信息获取 API
 * - 支持实时统计（码率、缓冲、帧率、吞吐量）
 * - 支持监控数据回调订阅
 *
 * 使用方式：
 * import { createMediaIntegration } from './media';
 * const integration = createMediaIntegration(videoElement, playerInstance);
 * integration.startMonitoring();
 */

import { MediaPlayerMonitor } from './monitor';
import { PlayerType, StreamingProtocol } from './types';
import type {
  PlayerStats,
  PlayerDetails,
  MonitorConfig,
  MonitorCallbacks,
  BitrateDataPoint,
  ThroughputDataPoint,
  BufferDataPoint,
  FrameRateDataPoint,
  DashPlayer as MonitorDashPlayer,
  HlsPlayer as MonitorHlsPlayer,
  FlvPlayer as MonitorFlvPlayer,
} from './types';
import { BrowserCapabilityDetector } from '../browserCapabilityDetector';
import type { BrowserCapabilityResult } from '../browserCapabilityDetector';
import type { EventBus } from '@lumina/framework/core/eventBus';
import { createLogger } from '@lumina/framework/utils';
const logger = createLogger('MediaIntegration');

// ============================================
// 类型守卫
// ============================================

function isMonitorDashPlayer(plugin: StreamPluginInstance): plugin is StreamPluginInstance & MonitorDashPlayer {
  return 'getCurrentRepresentationForType' in plugin || 'getDashMetrics' in plugin;
}

function isMonitorHlsPlayer(plugin: StreamPluginInstance): plugin is StreamPluginInstance & MonitorHlsPlayer {
  return 'levels' in plugin;
}

function isMonitorFlvPlayer(plugin: StreamPluginInstance): plugin is StreamPluginInstance & MonitorFlvPlayer {
  return 'statisticsInfo' in plugin;
}

/**
 * 流媒体插件实例接口
 * 用于从插件获取播放器实例和相关统计信息
 */
interface StreamPluginInstance {
  /** 视频元素 */
  videoElement: HTMLVideoElement | null;
  /** 事件总线 */
  eventBus: EventBus | null;
  /** 检查浏览器是否支持 */
  isSupported(): boolean;
  /** 获取缓冲信息 */
  getBufferInfo(): { start: number; end: number; length: number };
  /** 获取统计信息 */
  getStats(): Partial<{
    currentTime: number;
    duration: number;
    bufferLength: number;
    downloadSpeed: number;
    videoBitrate: number;
    audioBitrate: number;
    totalStallCount: number;
    totalStallTime: number;
    videoCodec: string;
    audioCodec: string;
    resolution: { width: number; height: number };
  }>;
  /** 获取浏览器能力检测结果 */
  getBrowserCapability?: () => BrowserCapabilityResult | null;
}

/**
 * 全向监控集成类
 * 统一管理原生视频 + DASH + HLS + FLV 的监控
 */
export class MediaIntegration {
  /** 视频元素 */
  private video: HTMLVideoElement;

  /** 媒体监控器实例 */
  private monitor: MediaPlayerMonitor;

  /** 浏览器能力检测结果 */
  private browserCapability: BrowserCapabilityResult;

  /** 当前流媒体插件实例（dash/hls/flv） */
  private streamPlugin: StreamPluginInstance | null = null;

  /** 事件总线（用于和其他插件通信） */
  private eventBus: EventBus | null = null;

  /** 是否正在监控 */
  private isMonitoring = false;

  /**
   * 构造函数
   * 初始化监控器、执行浏览器能力检测
   *
   * @param video - 视频元素
   * @param monitorConfig - 监控器配置
   * @param monitorCallbacks - 监控数据回调
   */
  constructor(
    video: HTMLVideoElement,
    monitorConfig?: MonitorConfig,
    monitorCallbacks?: MonitorCallbacks
  ) {
    this.video = video;

    // 创建媒体监控器实例
    this.monitor = new MediaPlayerMonitor(video, monitorConfig, monitorCallbacks);

    // 执行浏览器能力检测
    this.browserCapability = BrowserCapabilityDetector.getFullCapabilityResult();
    this.logBrowserInfo();
  }

  /**
   * 设置流媒体插件实例
   * 将 dash/hls/flv 插件连接到监控系统
   *
   * @param plugin - 流媒体插件实例
   * @param pluginType - 插件类型
   */
  setStreamPlugin(plugin: StreamPluginInstance, pluginType: PlayerType): void {
    this.streamPlugin = plugin;

    // 将插件实例注册到监控器（用于获取播放器内部的实时数据）
    // 使用类型谓词验证插件是否实现了监控所需的接口
    switch (pluginType) {
      case PlayerType.DASH:
        if (isMonitorDashPlayer(plugin)) {
          this.monitor.setPlayer(plugin, PlayerType.DASH);
          logger.info('已注册 DASH 插件到监控系统');
        } else {
          logger.warn('DASH 插件未实现监控所需接口，监控数据可能不完整');
        }
        break;
      case PlayerType.HLS:
        if (isMonitorHlsPlayer(plugin)) {
          this.monitor.setPlayer(plugin, PlayerType.HLS);
          logger.info('已注册 HLS 插件到监控系统');
        } else {
          logger.warn('HLS 插件未实现监控所需接口，监控数据可能不完整');
        }
        break;
      case PlayerType.FLV:
        if (isMonitorFlvPlayer(plugin)) {
          this.monitor.setPlayer(plugin, PlayerType.FLV);
          logger.info('已注册 FLV 插件到监控系统');
        } else {
          logger.warn('FLV 插件未实现监控所需接口，监控数据可能不完整');
        }
        break;
      default:
        logger.info('使用原生播放器监控模式');
        break;
    }
  }

  /**
   * 设置事件总线
   * 用于将监控数据通过事件总线发送给其他插件
   *
   * @param eventBus - 事件总线实例
   */
  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  /**
   * ============================================
   * 监控控制
   * ============================================
   */

  /**
   * 启动监控
   * 开始收集视频播放数据（码率、缓冲、帧率、吞吐量）
   */
  startMonitoring(): void {
    if (this.isMonitoring) return;

    // 配置监控回调：将监控数据通过事件总线广播
    const originalCallbacks = this.monitor['callbacks'];
    this.monitor['callbacks'] = {
      ...(typeof originalCallbacks === 'object' ? originalCallbacks : {}),
      onStatsUpdate: (stats: PlayerStats): void => {
        // 通过事件总线发送监控数据
        if (this.eventBus) {
          this.eventBus.emit('monitor:stats', stats);
        }
        // 调用原始回调（如果存在）
        if (typeof originalCallbacks === 'object' && originalCallbacks?.onStatsUpdate) {
          originalCallbacks.onStatsUpdate(stats);
        }
      },
      onBitrateUpdate: (data: BitrateDataPoint[]): void => {
        if (this.eventBus) {
          this.eventBus.emit('monitor:bitrate', data);
        }
      },
      onThroughputUpdate: (data: ThroughputDataPoint[]): void => {
        if (this.eventBus) {
          this.eventBus.emit('monitor:throughput', data);
        }
      },
      onBufferUpdate: (data: BufferDataPoint[]): void => {
        if (this.eventBus) {
          this.eventBus.emit('monitor:buffer', data);
        }
      },
      onFPSUpdate: (data: FrameRateDataPoint[]): void => {
        if (this.eventBus) {
          this.eventBus.emit('monitor:fps', data);
        }
      },
    };

    this.monitor.start();
    this.isMonitoring = true;

    logger.info('视频监控已启动');
  }

  /**
   * 停止监控
   * 停止收集数据，释放定时器和动画帧资源
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    this.monitor.stop();
    this.isMonitoring = false;

    logger.info('视频监控已停止');
  }

  /**
   * ============================================
   * 数据获取 API
   * ============================================
   */

  /**
   * 获取当前播放器统计信息
   * 整合监控器和流媒体插件的统计数据
   *
   * @returns 播放器统计信息
   */
  getStats(): PlayerStats & {
    browserName: string;
    browserVersion: string;
    osName: string;
    osVersion: string;
    isIOS: boolean;
    isSafari: boolean;
    streamPluginName: string | null;
  } {
    const monitorStats = this.monitor.getStats();

    return {
      ...monitorStats,
      // 附加浏览器和系统信息
      browserName: this.browserCapability.browserName,
      browserVersion: this.browserCapability.browserVersion,
      osName: this.browserCapability.osName,
      osVersion: this.browserCapability.osVersion,
      isIOS: this.browserCapability.isIOS,
      isSafari: this.browserCapability.isSafari,
      // 当前使用的流媒体插件名称
      streamPluginName: this.streamPlugin?.getBrowserCapability
        ? '已连接'
        : null,
    };
  }

  /**
   * 获取播放器详细信息
   * 包括视频编码、清晰度、码率、缓冲等全向信息
   *
   * @returns 播放器详细信息
   */
  getPlayerDetails(): PlayerDetails & {
    browser: {
      name: string;
      version: string;
      isSafari: boolean;
      isIOS: boolean;
      isMacOS: boolean;
      osName: string;
      osVersion: string;
    };
    mseSupported: boolean;
    dashSupported: boolean;
    hlsjsSupported: boolean;
    flvjsSupported: boolean;
    hardwareInfo: BrowserCapabilityResult['hardwareInfo'];
  } {
    const details = this.monitor.getPlayerDetails();

    return {
      ...details,
      // 附加完整浏览器能力信息
      browser: {
        name: this.browserCapability.browserName,
        version: this.browserCapability.browserVersion,
        isSafari: this.browserCapability.isSafari,
        isIOS: this.browserCapability.isIOS,
        isMacOS: this.browserCapability.isMacOS,
        osName: this.browserCapability.osName,
        osVersion: this.browserCapability.osVersion,
      },
      mseSupported: this.browserCapability.mseSupported,
      dashSupported: this.browserCapability.dashSupported,
      hlsjsSupported: this.browserCapability.hlsjsSupported,
      flvjsSupported: this.browserCapability.flvjsSupported,
      hardwareInfo: this.browserCapability.hardwareInfo,
    };
  }

  /**
   * 获取浏览器能力检测结果
   *
   * @returns 浏览器能力检测结果
   */
  getBrowserCapability(): BrowserCapabilityResult {
    return this.browserCapability;
  }

  /**
   * 获取码率历史数据
   *
   * @returns 码率数据点数组
   */
  getBitrateData(): BitrateDataPoint[] {
    return this.monitor.getBitrateData();
  }

  /**
   * 获取吞吐量历史数据
   *
   * @returns 吞吐量数据点数组
   */
  getThroughputData(): ThroughputDataPoint[] {
    return this.monitor.getThroughputData();
  }

  /**
   * 获取缓冲历史数据
   *
   * @returns 缓冲数据点数组
   */
  getBufferData(): BufferDataPoint[] {
    return this.monitor.getBufferData();
  }

  /**
   * 获取帧率历史数据
   *
   * @returns 帧率数据点数组
   */
  getFPSData(): FrameRateDataPoint[] {
    return this.monitor.getFPSData();
  }

  /**
   * 获取当前协议信息
   *
   * @returns 流媒体协议类型
   */
  getProtocol(): StreamingProtocol {
    return this.monitor.getPlayerDetails().protocol;
  }

  /**
   * 获取当前播放器类型
   *
   * @returns 播放器类型
   */
  getPlayerType(): PlayerType {
    const details = this.monitor.getPlayerDetails();
    return details.playerType;
  }

  /**
   * ============================================
   * 辅助方法
   * ============================================
   */

  /**
   * 输出浏览器信息到控制台
   * 开发环境用于调试和验证
   */
  private logBrowserInfo(): void {
    const cap = this.browserCapability;
    logger.info(
      `浏览器环境: ${cap.browserName} ${cap.browserVersion} ` +
      `| 系统: ${cap.osName} ${cap.osVersion} ` +
      `| MSE: ${cap.mseSupported ? '✅' : '❌'} ` +
      `| DASH: ${cap.dashSupported ? '✅' : '❌'} ` +
      `| HLS: ${cap.hlsjsSupported ? '✅' : '❌'} ` +
      `| FLV: ${cap.flvjsSupported ? '✅' : '❌'}`
    );
  }

  /**
   * 获取监控器实例（供高级用户直接使用）
   *
   * @returns MediaPlayerMonitor 实例
   */
  getMonitor(): MediaPlayerMonitor {
    return this.monitor;
  }

  /**
   * 获取视频元素引用
   *
   * @returns 视频元素
   */
  getVideoElement(): HTMLVideoElement {
    return this.video;
  }

  /**
   * 清空历史数据
   * 重置所有监控图表数据
   */
  clearData(): void {
    this.monitor.clearData();
  }

  /**
   * 销毁集成实例
   * 停止监控、释放所有资源
   */
  destroy(): void {
    this.stopMonitoring();
    this.monitor.destroy();
    this.streamPlugin = null;
    this.eventBus = null;
    logger.info('已销毁');
  }
}

/**
 * 创建媒体监控集成实例
 * 工厂函数，方便创建和配置 MediaIntegration
 *
 * @param video - 视频元素
 * @param monitorConfig - 监控器配置（可选）
 * @param monitorCallbacks - 监控数据回调（可选）
 * @returns MediaIntegration 实例
 *
 * @example
 * // 基本用法
 * const integration = createMediaIntegration(videoElement);
 * integration.startMonitoring();
 *
 * @example
 * // 配置监控参数
 * const integration = createMediaIntegration(videoElement, {
 *   updateInterval: 2000,
 *   maxDataPoints: 120,
 * });
 */
export function createMediaIntegration(
  video: HTMLVideoElement,
  monitorConfig?: MonitorConfig,
  monitorCallbacks?: MonitorCallbacks
): MediaIntegration {
  return new MediaIntegration(video, monitorConfig, monitorCallbacks);
}
