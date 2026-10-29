/**
 * 协议自动检测模块
 *
 * 根据输入源的特征（URL 扩展名或对象内部字段）自动判断流媒体协议类型，
 * 支持 DASH（.mpd）和 HLS（.m3u8）两种协议的自动识别。
 */

import { StreamType } from '../types/index';
import type { MediaManifest } from '../types/index';
import { detectManifestProtocol } from '@lumina/nova';

/**
 * 从 URL 字符串自动检测流类型
 *
 * 通过 URL 的文件扩展名判断协议类型：
 * - .mpd → DASH
 * - .m3u8 → HLS
 *
 * @param url - 流媒体清单的 URL 字符串
 * @returns 检测到的流类型
 * @throws {Error} 当无法从 URL 识别协议类型时抛出
 */
export function detectStreamTypeFromUrl(url: string): StreamType {
  if (/\.mpd(\?|$)/i.test(url)) {
    return StreamType.DASH;
  }
  if (/\.m3u8(\?|$)/i.test(url)) {
    return StreamType.HLS;
  }
  throw new Error(`Unable to detect stream type from URL: ${url}`);
}

/**
 * 从源对象自动检测流类型
 *
 * 判定顺序与播放器完全一致（共用 detectManifestProtocol，唯一实现）：
 * 顶层 mediaSourceType → segmentInfo.mediaSequence → SegmentBase → 默认 DASH。
 *
 * @param source - DASH 或 HLS 源对象
 * @returns 检测到的流类型
 */
export function detectStreamTypeFromObject(
  source: MediaManifest,
): StreamType {
  return detectManifestProtocol(source) === 'hls' ? StreamType.HLS : StreamType.DASH;
}

/**
 * 综合检测流类型
 *
 * 根据输入源的类型（字符串或对象）自动选择合适的检测策略：
 * - 字符串 → 调用 detectStreamTypeFromUrl
 * - 对象 → 调用 detectStreamTypeFromObject
 *
 * @param source - 源对象或 URL 字符串
 * @returns 检测到的流类型
 */
export function detectStreamType(
  source: MediaManifest | string,
): StreamType {
  if (typeof source === 'string') {
    return detectStreamTypeFromUrl(source);
  }

  return detectStreamTypeFromObject(source);
}
