/**
 * ============================================
 * 流媒体插件类型定义
 * ============================================
 */

import type { Plugin } from '@lumina/nova';
import type { EventBus } from '@lumina/framework/core/eventBus';
// 枚举以运行时真正使用的那份为准（@/types/streamPlugin）；
// ./enums 下曾有一份同名但取值不同的旧版（大写 'HLS' …），已删除
import { StreamPluginTypeEnum, StreamFormatEnum } from '@lumina/nova';

/**
 * 缓冲信息接口
 */
export interface BufferInfo {
  /** 缓冲开始时间 */
  start: number;
  /** 缓冲结束时间 */
  end: number;
  /** 缓冲长度（秒） */
  length: number;
}

/**
 * 流媒体统计信息接口
 */
export interface StreamStats {
  /** 当前下载速度（字节/秒） */
  downloadSpeed: number;
  /** 视频码率（比特/秒） */
  videoBitrate: number;
  /** 音频码率（比特/秒） */
  audioBitrate: number;
  /** 丢包率（0-1） */
  dropRate: number;
  /** 当前缓冲时长（秒） */
  bufferLength: number;
  /** 当前播放时间 */
  currentTime: number;
  /** 视频总时长 */
  duration: number;
  /** 首帧时间（毫秒） */
  firstFrameTime: number;
  /** 总卡顿次数 */
  totalStallCount: number;
  /** 总卡顿时间（毫秒） */
  totalStallTime: number;
  /** 视频编码信息 */
  videoCodec?: string;
  /** 音频编码信息 */
  audioCodec?: string;
  /** 视频分辨率 */
  resolution?: {
    width: number;
    height: number;
  };
}

/**
 * 清单源对象类型
 * 用于对象注入模式，当 StreamConfig.url 为对象时使用
 * 可以是 MediaManifest 格式或直接包含 variants/audioGroups 的对象
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type MediaManifestSource = object;

/**
 * 流媒体配置接口
 */
export interface StreamConfig {
  /** 流媒体 URL 或清单对象（用于对象注入模式） */
  url: string | MediaManifestSource;
  /** 流媒体格式 */
  format: StreamFormatEnum;
  /** 是否直播 */
  isLive?: boolean;
  /** 开始播放时间 */
  startTime?: number;
  /** 自定义配置 */
  custom?: Record<string, string | number | boolean | object | null>;
}

/**
 * 流媒体插件接口
 * 所有流媒体插件（flv.js、hls.js、dash.js）必须实现此接口
 */
export interface StreamPlugin extends Plugin {
  /** 插件类型 */
  readonly type: StreamPluginTypeEnum;

  /** 视频元素 */
  videoElement: HTMLVideoElement | null;

  /** 事件总线 */
  eventBus: EventBus | null;

  /**
   * 检查浏览器是否支持
   * @returns 是否支持
   */
  isSupported(): boolean;

  /**
   * 加载流媒体
   * @param config - 流媒体配置
   */
  load(config: StreamConfig): void;

  /**
   * 播放
   */
  play(): void;

  /**
   * 暂停
   */
  pause(): void;

  /**
   * 跳转
   * @param time - 时间（秒）
   */
  seek(time: number): void;

  /**
   * 销毁播放器实例
   */
  destroy(): void;

  /**
   * 获取缓冲信息
   * @returns 缓冲信息
   */
  getBufferInfo(): BufferInfo;

  /**
   * 获取统计信息
   * @returns 统计信息
   */
  getStats(): Partial<StreamStats>;
}

/**
 * 流媒体插件构造函数
 */
export type StreamPluginConstructor = new (
  videoElement: HTMLVideoElement,
  eventBus: EventBus
) => StreamPlugin;
