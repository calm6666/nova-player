/**
 * ============================================
 * 回调类型定义
 * ============================================
 * 弹幕插件回调和播放器回调的统一类型定义
 *
 * @module types/callbacks
 */

import type { DanmakuItem, DanmakuRenderItem, DanmakuSegment, PerformanceStats, RenderMode } from './danmaku';

/** 弹幕插件回调 */
export interface DanmakuCallbacks {
  /** 发送弹幕 → 服务器确认 (异步) */
  onSend?: (danmaku: DanmakuItem) => Promise<DanmakuItem>;
  /** 发送成功回调 */
  onSendSuccess?: (danmaku: DanmakuItem) => void;
  /** 发送失败回调 */
  onSendError?: (error: Error, danmaku: DanmakuItem) => void;
  /** 弹幕进入画面回调 */
  onEnter?: (item: DanmakuRenderItem) => void;
  /** 弹幕离开画面回调 */
  onLeave?: (item: DanmakuRenderItem) => void;
  /** 弹幕点击回调 */
  onClick?: (item: DanmakuItem, event: MouseEvent) => void;
  /** 增量更新: 新弹幕到达 */
  onIncrementalUpdate?: (newItems: DanmakuItem[], totalCount: number) => void;
  /** 分段加载完成回调 */
  onSegmentLoaded?: (segment: DanmakuSegment) => void;
  /** 全部加载完成回调 */
  onAllLoaded?: (totalCount: number) => void;
  /** 性能警告回调 */
  onPerformanceWarning?: (stats: PerformanceStats) => void;
  /** 渲染模式切换回调 */
  onModeChange?: (mode: RenderMode) => void;
  /** 弹幕点赞回调（Tip 操作条点赞按钮，liked 为点击后的新状态） */
  onDanmakuLike?: (danmaku: DanmakuItem, liked: boolean) => void;
  /** 弹幕复制回调（Tip 操作条复制按钮，剪贴板写入完成后触发） */
  onDanmakuCopy?: (danmaku: DanmakuItem) => void;
  /** 弹幕撤回回调（本人弹幕的撤回按钮，触发后插件自动从画面移除该弹幕） */
  onDanmakuRecall?: (danmaku: DanmakuItem) => void;
  /** 弹幕举报回调（Tip 操作条举报按钮） */
  onDanmakuReport?: (danmaku: DanmakuItem) => void;
}

/** 播放器回调 */
export interface PlayerCallbacks {
  /** 播放回调 */
  onPlay?: () => void;
  /** 暂停回调 */
  onPause?: () => void;
  /** 播放结束回调 */
  onEnded?: () => void;
  /** 时间更新回调 */
  onTimeUpdate?: (time: number) => void;
  /** 音量变化回调 */
  onVolumeChange?: (volume: number, muted: boolean) => void;
  /** 全屏变化回调 */
  onFullscreenChange?: (isFullscreen: boolean) => void;
  /** 播放模式变化回调 */
  onPlayerModeChange?: (mode: 'native' | 'streaming') => void;
}
