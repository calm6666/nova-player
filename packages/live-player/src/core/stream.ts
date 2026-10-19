/**
 * 流媒体工具。
 *
 * 本包不再自己实现 HLS / FLV 加载：真正的拉流、解封装、清晰度切换与统计
 * 全部由开发者通过 `options.plugins` 传入的流媒体插件（`createHlsPlugin()` /
 * `createFlvPlugin()` / `createDashPlugin()`）提供。
 *
 * 这里只保留两个无副作用的小工具：
 * - `detectStreamKind` / `detectStreamFormat`：按地址后缀得到格式；
 *   `setStream()` 用它按插件声明的 `type` 选择插件，选不到则回退原生 `<video>`；
 * - `StreamQuality` / `StreamSnapshot`：插件能力映射到直播 UI 的数据结构。
 */

import { StreamFormatEnum } from '@/types/streamPlugin';

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
  return kindOfFormat(detectStreamFormat(url));
}

/**
 * 根据地址推断流媒体格式；无法识别时返回 null（按原生视频处理）。
 *
 * 这里只做「后缀 → 格式」映射，不解析清单内容；格式到插件的选择交给
 * 插件自己声明的 `type`（见 `LivePluginHost`）。
 *
 * @param url - 流地址。
 * @returns 流媒体格式；非 HLS / FLV 地址返回 null。
 */
export function detectStreamFormat(url: string): StreamFormatEnum | null {
  let pathname = url;
  try {
    pathname = new URL(url, window.location.href).pathname;
  } catch {
    pathname = url.split('?')[0];
  }
  const lower = pathname.toLowerCase();
  if (lower.endsWith('.m3u8')) return StreamFormatEnum.HLS;
  if (lower.endsWith('.flv')) return StreamFormatEnum.FLV;
  return null;
}

/** 格式 → 流类型（保留旧公开类型语义）。 */
function kindOfFormat(format: StreamFormatEnum | null): StreamKind {
  if (format === StreamFormatEnum.HLS) return 'hls';
  if (format === StreamFormatEnum.FLV) return 'flv';
  return 'native';
}

/**
 * 从插件错误载荷提取可读文案。
 *
 * @param payload - 插件事件载荷。
 * @returns 错误文案。
 */
export function readStreamErrorMessage(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return 'stream error';
}
