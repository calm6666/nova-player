/**
 * 图标出口：实现已迁移到 src/assets（真实播放器 bundle 中的 SVG 资源）。
 *
 * 本文件不再包含手绘图标，仅做转发，保持既有引用路径可用。
 */
export * from '@/live/assets';

/**
 * 复选框勾选标记。
 *
 * 真实播放器未提供独立勾选 SVG，这里返回承载样式绘制的元素，避免新增自绘图标。
 */
export const checkIcon = (): string => '<span class="nova-live-player-tick" aria-hidden="true"></span>';
