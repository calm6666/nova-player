/**
 * ============================================
 * 流媒体插件类型
 * ============================================
 * StreamPlugin 继承 Plugin，添加流媒体专有方法
 * 所有流媒体相关类型的唯一来源
 *
 * @module types/streamPlugin
 */

import type { Plugin } from './plugin';
import type { PlayerEventBus } from '@/core/events';

/** 流媒体插件类型枚举 */
export enum StreamPluginTypeEnum {
  HLS = 'hls',
  DASH = 'dash',
  FLV = 'flv',
}

/** 流媒体格式枚举 */
export enum StreamFormatEnum {
  HLS = 'hls',
  DASH = 'dash',
  FLV = 'flv',
  MP4 = 'mp4',
}

/** 流媒体插件事件枚举 */
export enum StreamPluginEventEnum {
  LOAD_COMPLETE = 'STREAM_LOAD_COMPLETE',
  METADATA_LOADED = 'STREAM_METADATA_LOADED',
  PLAY_START = 'STREAM_PLAY_START',
  PLAY_PAUSE = 'STREAM_PLAY_PAUSE',
  BUFFER_START = 'STREAM_BUFFER_START',
  BUFFER_END = 'STREAM_BUFFER_END',
  STATS_UPDATE = 'STREAM_STATS_UPDATE',
  NETWORK_ERROR = 'STREAM_NETWORK_ERROR',
  DECODE_ERROR = 'STREAM_DECODE_ERROR',
  ERROR = 'STREAM_ERROR',
  /** 清晰度变化（自动或手动切换），payload: { width, height, bitrate, isAuto } */
  QUALITY_CHANGE = 'streamQualityChange',
}

/** 缓冲信息 */
export interface BufferInfo {
  /** 缓冲开始时间 (秒) */
  start: number;
  /** 缓冲结束时间 (秒) */
  end: number;
  /** 缓冲长度 (秒) */
  length: number;
}

/** 流媒体统计信息 */
export interface StreamStats {
  /** 当前下载速度 (字节/秒) */
  downloadSpeed: number;
  /** 视频码率 (比特/秒) */
  videoBitrate: number;
  /** 音频码率 (比特/秒) */
  audioBitrate: number;
  /** 丢包率 (0-1) */
  dropRate: number;
  /** 当前缓冲时长 (秒) */
  bufferLength: number;
  /** 当前播放时间 (秒) */
  currentTime: number;
  /** 视频总时长 (秒) */
  duration: number;
  /** 首帧时间 (毫秒) */
  firstFrameTime: number;
  /** 总卡顿次数 */
  totalStallCount: number;
  /** 总卡顿时间 (毫秒) */
  totalStallTime: number;
  /** 视频编码信息 */
  videoCodec?: string;
  /** 音频编码信息 */
  audioCodec?: string;
  /** 视频分辨率 */
  resolution?: { width: number; height: number };
}

/** 清单源对象类型（用于对象注入模式） */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type MediaManifestSource = object;

/** 流媒体配置 */
export interface StreamConfig {
  /** 流媒体 URL 或清单对象 */
  url: string | MediaManifestSource;
  /** 流媒体格式 */
  format: StreamFormatEnum;
  /** 是否直播 */
  isLive?: boolean;
  /** 开始播放时间 (秒) */
  startTime?: number;
  /** 自定义配置 */
  custom?: Record<string, string | number | boolean | object | null>;
}

/** 画质等级 */
export interface QualityLevel {
  /** 画质标识（自动档为 AUTO_QUALITY_ID，即 'auto'） */
  id: string;
  /** 画质显示名称 */
  label: string;
  /** 视频宽度（自动档为当前 ABR 实际选中档位的宽度） */
  width: number;
  /** 视频高度（自动档为当前 ABR 实际选中档位的高度） */
  height: number;
  /** 码率 (比特/秒)（自动档为当前 ABR 实际选中档位的码率） */
  bitrate: number;
  /** 是否为自动档（ABR）。MP4 场景恒为 false */
  isAuto?: boolean;
  /**
   * 视频编码格式（规范化后的短名，取值见 VideoCodecEnum：AVC / HEVC / AV1 / VP9 …）
   * 供控制栏清晰度面板渲染编码徽标；无法识别时缺省（不产出徽标）
   */
  codec?: string;
  /** 视频编码原始串（如 avc1.640028 / hvc1.1.6.L93.B0），便于排查与二次解析 */
  codecString?: string;
}

/** 自动档（ABR）档位 id：QualityLevel.id / setQuality() / getCurrentQuality() 共用 */
export const AUTO_QUALITY_ID = 'auto';

/**
 * 视频编码格式枚举（规范化后的短名）
 * 各流媒体插件把库返回的原始编码串（hls.js 的 avc1.640028、dash.js 的 hvc1.1.6.L93.B0 等）
 * 统一映射为下列短名，控制栏清晰度面板直接用它渲染编码徽标。
 */
export enum VideoCodecEnum {
  /** H.264 / AVC（avc1、avc3） */
  AVC = 'AVC',
  /** H.265 / HEVC（hvc1、hev1、hvc2、hev2、dvh1、dvhe） */
  HEVC = 'HEVC',
  /** AV1（av01） */
  AV1 = 'AV1',
  /** VP9（vp09、vp9） */
  VP9 = 'VP9',
  /** VP8（vp08、vp8） */
  VP8 = 'VP8',
  /** MPEG-4 Visual（mp4v） */
  MPEG4 = 'MPEG4',
}

/** 音频编码 fourCC 前缀（用于从 CODECS 全串中剔除音频项，只保留视频项） */
const AUDIO_CODEC_PREFIXES = [
  'mp4a', 'ac-3', 'ec-3', 'ac-4', 'opus', 'vorbis', 'flac',
  'dtsc', 'dtsh', 'dtsl', 'dtse', 'alac', 'mp3',
];

/**
 * 把编码 fourCC 规范化成 VideoCodecEnum 短名
 * 映射表（取第一个「.」之前的一段，忽略大小写）：
 * - avc1 / avc3 → AVC（H.264）
 * - hvc1 / hev1 / hvc2 / hev2 / dvh1 / dvhe → HEVC（H.265；dvh1/dvhe 为 HEVC 基底的 Dolby Vision）
 * - av01 → AV1
 * - vp09 / vp9 → VP9
 * - vp08 / vp8 → VP8
 * - mp4v → MPEG4
 * - 其它 → undefined（不产出徽标，原始串仍可由 codecString 拿到）
 *
 * @param codecString - 原始编码串，如 'avc1.640028' 或 'hvc1.1.6.L93.B0'
 * @returns 规范化短名；无法识别返回 undefined
 */
export function normalizeVideoCodec(codecString?: string | null): VideoCodecEnum | undefined {
  if (!codecString) return undefined;

  const fourCC = codecString.trim().toLowerCase().split('.')[0];
  switch (fourCC) {
    case 'avc1':
    case 'avc3':
      return VideoCodecEnum.AVC;
    case 'hvc1':
    case 'hev1':
    case 'hvc2':
    case 'hev2':
    case 'dvh1':
    case 'dvhe':
      return VideoCodecEnum.HEVC;
    case 'av01':
      return VideoCodecEnum.AV1;
    case 'vp09':
    case 'vp9':
      return VideoCodecEnum.VP9;
    case 'vp08':
    case 'vp8':
      return VideoCodecEnum.VP8;
    case 'mp4v':
      return VideoCodecEnum.MPEG4;
    default:
      return undefined;
  }
}

/**
 * 从编解码串解析出视频编码，产出可直接写进 QualityLevel 的 codec / codecString
 * 输入可以是单个 fourCC（'avc1.640028'）、CODECS 全串（'avc1.640028,mp4a.40.2'），
 * 或带 codecs 参数的 mimeType（'video/mp4; codecs="avc1.640028"'）。
 *
 * @param codecs - 原始编码串 / CODECS 列表 / 带 codecs 参数的 mimeType
 * @returns codec（规范化短名）与 codecString（原始视频编码串）；解析不出时两者皆缺省
 */
export function resolveVideoCodec(codecs?: string | null): {
  codec?: VideoCodecEnum;
  codecString?: string;
} {
  if (!codecs) return {};

  // 兼容 mimeType 形式：截取 codecs= 之后的内容并去掉引号
  let raw = codecs;
  const codecsIndex = raw.toLowerCase().indexOf('codecs=');
  if (codecsIndex >= 0) {
    raw = raw.slice(codecsIndex + 'codecs='.length);
  }
  raw = raw.replace(/["']/g, '');

  // CODECS 串里通常同时含音频项（mp4a.40.2 / ec-3 …），取第一项视频编码；
  // 含「/」的项是容器 mimeType（video/mp4），不是编码串，跳过
  const videoCodec = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !item.includes('/'))
    .find((item) => !AUDIO_CODEC_PREFIXES.some((prefix) => item.toLowerCase().startsWith(prefix)));

  if (!videoCodec) return {};

  return { codec: normalizeVideoCodec(videoCodec), codecString: videoCodec };
}

/**
 * 清晰度变化事件 payload（对应 StreamPluginEventEnum.QUALITY_CHANGE / PlayerEventEnum.STREAM_QUALITY_CHANGE）
 * 在基础分辨率信息之外，附带切换后生效的档位 id 与展示名，便于上层判断「切到了哪一档」
 */
export interface StreamQualityChangePayload {
  /** 视频宽度 */
  width: number;
  /** 视频高度 */
  height: number;
  /** 码率 (比特/秒) */
  bitrate?: number;
  /** 是否自动档（ABR） */
  isAuto?: boolean;
  /** 切换后生效的档位 id（'auto' 表示自动档） */
  qualityId?: string;
  /** 档位展示名 */
  label?: string;
}

/** 流媒体插件接口 — 继承 Plugin */
export interface StreamPlugin extends Plugin {
  /** 插件类型 */
  readonly type: StreamPluginTypeEnum;
  /** 视频元素引用 */
  videoElement: HTMLVideoElement | null;
  /** 事件总线 */
  eventBus: PlayerEventBus | null;

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

  /** 播放 */
  play(): void;

  /** 暂停 */
  pause(): void;

  /**
   * 跳转
   * @param time - 目标时间 (秒)
   */
  seek(time: number): void;

  /** 销毁播放器实例 */
  destroy(): void;

  /**
   * 获取缓冲信息
   * @returns 缓冲信息
   */
  getBufferInfo(): BufferInfo;

  /**
   * 获取统计信息
   * @returns 部分统计信息
   */
  getStats(): Partial<StreamStats>;

  /**
   * 获取可用画质列表
   * @returns 画质等级列表
   */
  getQualities(): QualityLevel[];

  /**
   * 设置画质
   * @param quality - 画质标识（'auto' 表示自动档）
   */
  setQuality(quality: string): void;

  /**
   * 获取当前生效的档位 id（'auto' 表示自动档）
   * @returns 档位 id；插件未就绪或不支持时返回 ''
   */
  getCurrentQuality(): string;

  /**
   * 订阅清晰度列表的变化/就绪
   * HLS 在清单解析完成后（MANIFEST_PARSED）、DASH 在流初始化完成后（STREAM_INITIALIZED）推送
   * @param cb - 列表变化回调
   * @returns 取消订阅函数
   */
  onQualitiesChange?(cb: (list: QualityLevel[]) => void): () => void;

  /**
   * 是否支持自动档（ABR 自适应码率）
   * @returns 是否支持自动档；未实现时按不支持处理
   */
  supportsAutoQuality?(): boolean;

  /**
   * 应用清晰度上限/下限限制（映射到各流媒体库的原生配置）
   * @param limits - 上限/下限（像素高度）
   */
  applyLimits?(limits: { max?: number; min?: number }): void;

  /**
   * 获取底层原生播放器实例（dash.js / hls.js / flv.js）
   *
   * 供统计监控（如 VideoInfo 的码率曲线）读取库原生实时数据；
   * 返回值具体形态由各流媒体库决定（调用方配合类型谓词使用），
   * 因此此处收窄为 unknown 以避免公共类型依赖具体库。
   *
   * @returns 原生播放器实例；插件未就绪 / 原生播放（非流媒体模式）返回 null
   */
  getNativePlayer?(): unknown;
}
