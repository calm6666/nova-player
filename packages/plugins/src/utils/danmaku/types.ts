/**
 * 高性能弹幕系统 - 引擎内部类型定义
 * High Performance Danmaku System - Engine Type Definitions
 *
 * 公共契约（枚举 / DanmakuItem / Provider / 遮罩等）唯一权威来源是根 types/danmaku.ts，
 * 此处仅作重导出（引擎各模块继续从 './types' 导入，路径不变）；
 * 本文件只保留引擎私有类型：轨道 / 渲染项扩展版 / 引擎事件 / 轨道配置 / 管理器状态。
 */

/// <reference lib="dom" />

import type {
  DanmakuItem,
  PerformanceStats,
  ScreenMode,
} from "@/types/danmaku";

// ============================================
// 公共契约：从根 types/danmaku.ts 重导出
// ============================================

export {
  DanmakuType,
  DanmakuSpeed,
  DanmakuFontSize,
  DanmakuArea,
  DanmakuPosition,
  RenderMode,
  ScreenMode,
} from "@/types/danmaku";

export type {
  DanmakuItem,
  DanmakuFilter,
  DanmakuOptions,
  DanmakuSegment,
  DanmakuMaskConfig,
  MaskLoader,
  MaskLoaderResult,
  PerformanceStats,
  DanmakuListProvider,
  DanmakuSendProvider,
} from "@/types/danmaku";

// ============================================
// 引擎私有类型
// ============================================

/**
 * 渲染中的弹幕项（引擎内部版，平铺 DanmakuItem 并携带渲染几何状态）
 *
 * 注意：与公共层面向回调的悬停快照（types/danmaku.ts DanmakuRenderItem）同名不同构，
 * 该版本只在引擎内部流转，不对插件外暴露。
 */
export interface DanmakuRenderItem extends DanmakuItem {
  /** 渲染ID */
  renderId: string;
  /** 当前X坐标 */
  x: number;
  /** 当前Y坐标 */
  y: number;
  /** 弹幕宽度 */
  width: number;
  /** 弹幕高度 */
  height: number;
  /** 移动速度 (像素/毫秒) */
  speed: number;
  /** 所在轨道 */
  trackIndex: number;
  /** 是否正在渲染 */
  isRendering: boolean;
  /** 创建时间 */
  createTime: number;
  /** DOM元素引用 */
  element?: HTMLElement;
  /** 动画持续时间 */
  duration: number;
  /** 滚动距离（创建时计算，用于位置更新） */
  scrollDistance?: number;
  /** 动画结束处理方法 */
  animationEndHandler?: () => void;
  /**
   * 动画真实已播放时长读取器（毫秒，可选）
   *
   * DOM 引擎由 CSS 动画的 currentTime 提供：暂停 / 被冻结时返回值保持不变。
   * 轨道占用判定必须以此为准，不能用 `performance.now() - createTime` 的墙钟
   * 差值——暂停期间动画不动而墙钟继续走，会把暂停时长算成弹幕已前进的距离，
   * 轨道被提前判空，新弹幕叠进仍停在屏幕上的同一轨道（本地连发即重叠）。
   *
   * Canvas 引擎不提供该读取器（其位置本身由 createTime 墙钟驱动），
   * 轨道管理器会回退到墙钟差值。
   */
  getElapsedTime?: () => number;
}

/** 弹幕轨道（引擎内部轨道占用状态） */
export interface DanmakuTrack {
  /** 轨道ID */
  id: number;
  /** 轨道索引 */
  index: number;
  /** 轨道高度 */
  height: number;
  /** 轨道Y坐标 */
  y: number;
  /** 当前轨道上的弹幕 */
  items: Set<DanmakuRenderItem>;
  /** 最后一条弹幕的结束位置 */
  lastItemEndX: number;
  /** 最后一条弹幕的结束时间 */
  lastItemEndTime: number;
}

/** 弹幕管理器状态 */
export interface DanmakuState {
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 当前时间 */
  currentTime: number;
  /** 屏幕模式 */
  screenMode: ScreenMode;
  /** 容器宽度 */
  containerWidth: number;
  /** 容器高度 */
  containerHeight: number;
  /** 当前渲染的弹幕数量 */
  renderCount: number;
  /** 当前激活的分段 */
  activeSegments: Set<number>;
}

/** 弹幕事件（引擎构造事件回调） */
export interface DanmakuEvents {
  /** 弹幕点击 */
  onClick?: (item: DanmakuItem) => void;
  /** 弹幕进入 */
  onEnter?: (item: DanmakuRenderItem) => void;
  /** 弹幕离开 */
  onLeave?: (item: DanmakuRenderItem) => void;
  /** 性能警告 */
  onPerformanceWarning?: (stats: PerformanceStats) => void;
}

/** 轨道配置 */
export interface TrackConfig {
  /** 轨道数量 */
  count: number;
  /** 轨道高度 */
  height: number;
  /** 轨道间距 */
  gap: number;
  /** 顶部边距 */
  topMargin: number;
  /** 底部边距 */
  bottomMargin: number;
}
