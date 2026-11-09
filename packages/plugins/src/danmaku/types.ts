/**
 * 弹幕插件类型定义
 *
 * 全部公共契约从根 types/danmaku.ts 重导出（唯一权威来源），
 * 本文件仅保留插件特有类型：IDanmakuManager 插件 API 契约。
 */

// ============================================
// 公共契约：从根 types/danmaku.ts 重导出
// ============================================

export { DanmakuType, DanmakuSpeed, DanmakuFontSize, DanmakuArea, DanmakuPosition, RenderMode, ScreenMode } from "@lumina/nova";

export type { DanmakuItem, DanmakuFilter, DanmakuSegment, DanmakuOptions, DanmakuMaskConfig, MaskLoader, MaskLoaderResult, PerformanceStats, DanmakuListProvider, DanmakuSendProvider } from "@lumina/nova";

import type { DanmakuItem, DanmakuFilter, DanmakuMaskConfig, PerformanceStats, RenderMode, ScreenMode, DanmakuSpeed, DanmakuArea } from "@lumina/nova";

// ============================================
// 插件特有类型
// ============================================

/**
 * 弹幕管理器接口 — DanmakuManager 的公开方法契约（供外部类型标注使用）
 * 与 utils/danmaku 的 DanmakuManager 实现保持一致。
 */
export interface IDanmakuManager {
  // 核心方法
  /** 播放 */
  play(): void;
  /** 暂停 */
  pause(): void;
  /** 停止 */
  stop(): void;
  /** 清空弹幕 */
  clear(): void;
  /** 销毁 */
  destroy(): void;

  // 弹幕操作
  /** 添加单条弹幕 */
  addDanmaku(danmaku: DanmakuItem): void;
  /** 批量添加弹幕 */
  loadDanmaku(list: DanmakuItem[]): void;
  /** 发送弹幕（立即显示） */
  sendDanmaku(text: string, options?: Partial<DanmakuItem>): void;
  /** 移除单条弹幕 */
  removeDanmaku(renderId: string): void;
  /** 设置分段数据源（调度器按 30 秒时间窗调用 loader） */
  setDataSource(
    loader: (startTime: number, endTime: number) => Promise<DanmakuItem[]>,
  ): void;
  /** 重置数据源与分段缓存（切换视频 / 更换弹幕源时调用） */
  resetDataSource(): void;

  // 设置方法
  /** 设置可见性 */
  setVisible(visible: boolean): void;
  /** 设置透明度 (0-1) */
  setOpacity(opacity: number): void;
  /** 设置密度 (0-1) */
  setDensity(density: number): void;
  /** 设置渲染模式 (DOM/Canvas) */
  setRenderMode(mode: RenderMode): void;
  /** 设置速度档位（1-5） */
  setSpeed(speed: DanmakuSpeed): void;
  /** 设置速度倍率（连续值，优先于档位） */
  setSpeedMultiplier(multiplier: number): void;
  /** 获取当前速度档位 */
  getSpeed(): DanmakuSpeed;
  /** 设置区域档位 */
  setArea(area: DanmakuArea): void;
  /** 设置区域占比（0-1 连续值） */
  setAreaRatio(ratio: number): void;
  /** 获取当前区域档位 */
  getArea(): DanmakuArea;
  /** 设置字号（像素） */
  setFontSize(fontSize: number): void;
  /** 设置字号缩放系数（连续值，1 = 基准） */
  setFontSizeScale(scale: number): void;
  /** 获取当前字号 */
  getFontSize(): number;
  /** 设置是否自动缩放 */
  setAutoScale(autoScale: boolean): void;
  /** 获取当前是否自动缩放 */
  getAutoScale(): boolean;
  /** 设置过滤器 */
  setFilter(filter: DanmakuFilter): void;
  /** 获取当前过滤器 */
  getFilter(): DanmakuFilter;
  /** 重置过滤器 */
  resetFilter(): void;
  /** 设置防挡遮罩 */
  setMaskConfig(config: DanmakuMaskConfig): void;
  /** 获取防挡遮罩配置 */
  getMaskConfig(): DanmakuMaskConfig | undefined;
  /** 启用防挡功能 */
  enableMask(
    maskImage: string,
    videoRect?: { x: number; y: number; width: number; height: number },
  ): void;
  /** 禁用防挡功能 */
  disableMask(): void;
  /** 设置底部安全区域 */
  setBottomSafeArea(height: number): void;

  // 屏幕模式
  /** 切换屏幕模式 */
  switchScreenMode(mode: "fullscreen" | "normal"): void;
  /** 切换全屏 */
  toggleFullscreen(): void;

  // 获取信息
  /** 获取弹幕数量 */
  getDanmakuCount(): number;
  /** 获取性能统计 */
  getPerformanceStats(): PerformanceStats;
  /** 获取轨道信息 */
  getTrackInfo(): {
    count: number;
    height: number;
    screenMode: ScreenMode;
    containerWidth: number;
    containerHeight: number;
  };
  /** 获取统计信息 */
  getStats(): {
    renderMode: RenderMode;
    screenMode: ScreenMode;
    isPlaying: boolean;
    performance: PerformanceStats;
  };

  /** 设置弹幕悬停回调 */
  setOnDanmakuHover(
    callback: (
      danmaku: DanmakuItem | null,
      position: { x: number; y: number } | null,
    ) => void,
  ): void;
}
