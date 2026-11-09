/**
 * 进度条分段数据归一
 *
 * 分段来源（/x/player/v2 的 view_points）有时按「清单/转码器声明的总时长」给出，
 * 与浏览器实际解出的媒体总时长不一致（例：分段跨度 600s、媒体 253.6s）。
 * 直接按媒体总时长算百分比会让各段 width 之和远大于 100%，整条进度条溢出。
 *
 * 这里把分段线性归一到媒体总时长，保证 Σwidth = 100%；
 * 只有偏差超过阈值才缩放，正常数据原样返回（不掩盖真实的轻微误差）。
 */

import type { ProgressSegment } from '../../types/player';

/** 允许的相对偏差（超过才归一） */
const SPAN_TOLERANCE = 0.01;

/**
 * 把分段跨度归一到媒体总时长
 *
 * @param segments - 原始分段
 * @param duration - 媒体总时长（秒）
 * @returns 归一后的分段（偏差在阈值内时原样返回）
 */
export function normalizeSegmentSpan(
  segments: ProgressSegment[],
  duration: number,
): ProgressSegment[] {
  if (segments.length === 0 || !(duration > 0)) return segments;

  let span = 0;
  for (const segment of segments) {
    if (Number.isFinite(segment.endTime) && segment.endTime > span) {
      span = segment.endTime;
    }
  }
  if (!(span > 0)) return segments;

  const scale = duration / span;
  if (Math.abs(scale - 1) <= SPAN_TOLERANCE) return segments;

  return segments.map((segment) => ({
    ...segment,
    startTime: (Number.isFinite(segment.startTime) ? segment.startTime : 0) * scale,
    endTime: (Number.isFinite(segment.endTime) ? segment.endTime : 0) * scale,
  }));
}
