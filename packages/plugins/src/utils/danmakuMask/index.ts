/**
 * 弹幕防遮挡（人像分割）模块
 * ============================================================
 * 能力检测 + MediaPipe 人像分割（Worker）+ mask → SVG 轮廓 + mock 降级。
 *
 * 使用示例：
 * ```ts
 * import { DanmakuMaskSegmenter, CapabilityDetector } from './danmakuMask';
 *
 * const segmenter = new DanmakuMaskSegmenter({ maskWidth: 96, maskHeight: 54 });
 * const cap = await segmenter.init();
 * if (cap.supported) {
 *   const { image } = await segmenter.segment(videoEl, performance.now());
 *   // 把 image（data URL 遮罩）作为防挡区域交给弹幕渲染层
 * }
 * ```
 */

export { CapabilityDetector } from './capabilityDetector';
export { DanmakuMaskSegmenter } from './segmentationClient';
export { maskToSvg } from './maskToSvg';
export { createMockMaskSvg, createMockResult } from './mockMask';
export { DEFAULT_MASK_CONFIG } from './types';
export type {
  CapabilityInfo,
  SegmentationBackend,
  SegmentationConfig,
  SegmentationResult,
} from './types';
