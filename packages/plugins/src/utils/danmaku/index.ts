/**
 * 高性能弹幕系统 - 主入口
 * High Performance Danmaku System
 *
 * 特性：
 * 1. 分段渲染 - 后端按时间分段返回，每次只渲染当前时间段弹幕
 * 2. 双引擎 - DOM引擎(少量) + Canvas引擎(大量)
 * 3. 轨道管理 - 全屏/非全屏统一轨道系统，自动适配尺寸
 * 4. 性能优化 - RAF动画、对象池、离屏Canvas、CSS3硬件加速
 */

import {
  DanmakuType,
  DanmakuSpeed,
  DanmakuFontSize,
  DanmakuArea,
  RenderMode,
  ScreenMode,
  type DanmakuItem,
  type DanmakuOptions,
  type DanmakuEvents,
  type PerformanceStats,
  type DanmakuFilter,
  type DanmakuMaskConfig,
  type DanmakuRenderItem as DanmakuRenderItemType,
} from "./types";
import { DOMElementPool, DanmakuItemPool } from "./objectPool";
import { TrackManager } from "./trackManager";
import { DOMEngine } from "./domEngine";
import { CanvasEngine } from "./canvasEngine";
import { DanmakuScheduler } from "./scheduler";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";

// 重新导出类型
export {
  DanmakuType,
  DanmakuSpeed,
  DanmakuFontSize,
  DanmakuArea,
  RenderMode,
  ScreenMode,
  type DanmakuItem,
  type DanmakuOptions,
  type DanmakuEvents,
  type PerformanceStats,
  type DanmakuFilter,
  type DanmakuMaskConfig,
  type MaskLoader,
  type DanmakuSegment,
  type DanmakuTrack,
  type DanmakuRenderItem,
} from "./types";

// 导出子模块
export { DOMElementPool, DanmakuItemPool } from "./objectPool";
export { TrackManager } from "./trackManager";
export { DOMEngine } from "./domEngine";
export { CanvasEngine } from "./canvasEngine";
export { DanmakuScheduler } from "./scheduler";

/** 弹幕管理器配置 */
interface DanmakuManagerConfig {
  /** 自动切换阈值 (弹幕数量超过此值切换到Canvas) */
  autoSwitchThreshold: number;
  /** 性能监控间隔 (毫秒) */
  performanceMonitorInterval: number;
  /** 最小FPS */
  minFps: number;
}

/**
 * 速度档位 → 连续倍率的权威映射表
 * 注意：DOMEngine/CanvasEngine 各自持有同值表（引擎内部实现细节），
 * 修改档位倍率时两处需同步。
 */
const SPEED_MULTIPLIERS: Record<DanmakuSpeed, number> = {
  [DanmakuSpeed.VERY_SLOW]: 0.5,
  [DanmakuSpeed.SLOW]: 0.75,
  [DanmakuSpeed.NORMAL]: 1.0,
  [DanmakuSpeed.FAST]: 1.5,
  [DanmakuSpeed.VERY_FAST]: 2.0,
};

/** 弹幕管理器 */
export class DanmakuManager {
  private container: HTMLElement;
  private video: HTMLVideoElement;
  private options: Required<DanmakuOptions>;
  private events: DanmakuEvents;

  // 核心组件
  private elementPool!: DOMElementPool;
  private itemPool!: DanmakuItemPool;
  private trackManager!: TrackManager;
  private domEngine: DOMEngine | null = null;
  private canvasEngine: CanvasEngine | null = null;
  private scheduler!: DanmakuScheduler;

  // 状态
  private isPlaying = false;
  private currentMode: RenderMode;
  private currentScreenMode: ScreenMode = ScreenMode.NORMAL;
  private lastVideoTime = 0;
  private animationId: number | null = null;
  private renderQueryPending = false;
  private resizeTimeout: { id: number } | null = null;
  private pauseStartTime = 0; // 暂停开始时间

  // 配置
  private config: DanmakuManagerConfig;

  // 性能监控
  private performanceStats: PerformanceStats = {
    fps: 60,
    renderCount: 0,
    poolUsage: 0,
    memoryUsage: 0,
    avgRenderTime: 0,
  };
  private performanceMonitorTimer: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private fullscreenHandler: (() => void) | null = null;
  private lastContainerWidth = 0;
  private lastContainerHeight = 0;

  constructor(options: DanmakuOptions, events: DanmakuEvents = {}) {
    this.container = options.container;
    this.video = options.video;
    this.options = {
      // 默认 DOM 渲染：开发者可通过 DanmakuPlugin({ renderer }) 选择
      // 'canvas' 或 'auto'（auto 在弹幕量超阈值时自动切换 Canvas）
      renderMode: RenderMode.DOM,
      opacity: 1,
      speed: DanmakuSpeed.NORMAL,
      speedMultiplier: 1, // 连续速度倍率，与 speed 档位双轨：setSpeedMultiplier 优先
      area: DanmakuArea.FULL,
      fontSize: 18,
      fontSizeScale: DanmakuFontSize.NORMAL, // 字号档位默认标准（setFontSizeScale 连续值优先）
      autoScale: true, // 默认开启自动缩放
      visible: true,
      density: 1,
      preventOverlap: true,
      trackHeight: 24,
      segmentDuration: 30,
      preloadSegments: 2,
      maxRenderCount: 2000, // 增加最大渲染数量，Canvas模式可以处理更多
      hardwareAcceleration: true,
      showAdvanced: true,
      mergeSame: false,
      filter: {},
      ...options,
    };
    this.events = events;
    this.currentMode = this.options.renderMode;

    this.config = {
      autoSwitchThreshold: 200,
      performanceMonitorInterval: 5000,
      minFps: 30,
    };

    this.init();
  }

  /** 初始化 */
  private init(): void {
    // 初始化对象池
    this.elementPool = new DOMElementPool({
      initialCapacity: 100,
      maxCapacity: this.options.maxRenderCount,
    });

    this.itemPool = new DanmakuItemPool({
      initialCapacity: 200,
      maxCapacity: this.options.maxRenderCount * 2,
    });

    // 初始化轨道管理器
    this.trackManager = new TrackManager({
      trackHeight: this.options.trackHeight,
      trackGap: 4,
      topMargin: 10,
      bottomMargin: 10,
      bottomSafeArea: 80, // 底部安全区域80px（字幕区域）
      safeDistance: 20,
    });

    // 初始化调度器
    this.scheduler = new DanmakuScheduler({
      segmentDuration: this.options.segmentDuration,
      preloadSegments: this.options.preloadSegments,
      maxCachedSegments: 10,
      densityLimit: this.options.density,
    });

    // 初始化渲染引擎
    this.initEngines();

    // 初始化容器尺寸记录
    this.lastContainerWidth = this.container.clientWidth;
    this.lastContainerHeight = this.container.clientHeight;

    // 绑定视频事件
    this.bindVideoEvents();

    // 启动性能监控
    this.startPerformanceMonitor();
  }

  /** 初始化渲染引擎 */
  private initEngines(): void {
    // 只创建 DOM 引擎（DOM 弹幕不依赖 canvas）。
    // Canvas 引擎改为懒创建：只有真正切到 Canvas 模式时才 new CanvasEngine，
    // 从而保证「DOM 模式下页面不会出现 <canvas>」，符合需求。
    this.domEngine = new DOMEngine(
      this.container,
      this.elementPool,
      this.itemPool,
      this.trackManager,
      {
        opacity: this.options.opacity,
        fontSizeScale: this.options.fontSize / 18,
        speed: this.options.speed,
        speedMultiplier: this.options.speedMultiplier,
        area: this.options.area,
        hardwareAcceleration: this.options.hardwareAcceleration,
        filter: this.options.filter,
        autoScale: this.options.autoScale,
      },
    );
  }

  /** 懒创建 Canvas 引擎（首次进入 Canvas 模式时调用，避免 DOM 模式白建 canvas） */
  private ensureCanvasEngine(): CanvasEngine {
    if (!this.canvasEngine) {
      this.canvasEngine = new CanvasEngine(
        this.container,
        this.itemPool,
        this.trackManager,
        {
          opacity: this.options.opacity,
          fontSizeScale: this.options.fontSize / 18,
          speed: this.options.speed,
          speedMultiplier: this.options.speedMultiplier,
          area: this.options.area,
          filter: this.options.filter,
          autoScale: this.options.autoScale,
        },
      );
      // 懒创建时用户可能已关闭弹幕显示，同步显隐类避免 canvas 裸露
      this.canvasEngine.setVisible(this.options.visible);
    }
    return this.canvasEngine;
  }

  /** 绑定视频事件 */
  private bindVideoEvents(): void {
    this.video.addEventListener("play", () => this.play());
    this.video.addEventListener("pause", () => this.pause());
    this.video.addEventListener("seeking", () => this.onSeeking());
    this.video.addEventListener("timeupdate", () => this.onTimeUpdate());
    this.video.addEventListener("ended", () => this.stop());

    // 使用ResizeObserver监听容器大小变化（更精确）
    this.initResizeObserver();
  }

  /** 初始化ResizeObserver */
  private initResizeObserver(): void {
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;

        // 检查尺寸是否真的变化了
        if (
          width !== this.lastContainerWidth ||
          height !== this.lastContainerHeight
        ) {
          this.lastContainerWidth = width;
          this.lastContainerHeight = height;

          // 尺寸刚开始变化时立即保留当前 Canvas 画面，不能等到防抖回调才创建快照。
          this.canvasEngine?.beginResizeTransition();

          // 在布局稳定后的下一帧执行，避免全屏过渡期间重复重建画布。
          if (this.resizeTimeout) {
            cancelRaf(this.resizeTimeout);
          }
          this.resizeTimeout = rafTimeout(() => {
            requestAnimationFrame(() => {
              this.domEngine?.resize();
              this.canvasEngine?.resize();
            });
          }, 32);
        }
      }
    });

    this.resizeObserver.observe(this.container);

    // 全屏事件必须直接通知弹幕管理器，不能只依赖 ResizeObserver。
    this.fullscreenHandler = () => {
      const mode = document.fullscreenElement ? "fullscreen" : "normal";
      this.switchScreenMode(mode);
    };
    document.addEventListener("fullscreenchange", this.fullscreenHandler);
  }

  /** 播放 */
  play(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;

    // 计算暂停时间并调整弹幕
    if (this.pauseStartTime > 0) {
      const pauseDuration = performance.now() - this.pauseStartTime;
      this.canvasEngine?.adjustDanmakuTime(pauseDuration);
      this.pauseStartTime = 0;
    }

    const engine = this.getActiveEngine();
    engine?.start();

    // 恢复现有弹幕动画
    this.domEngine?.resumeAnimations();
    this.canvasEngine?.resumeAnimations();

    // 弹幕关闭（visible=false）时不启动渲染循环：调度器不查询不发射，
    // 引擎已清空无在飞弹幕（关闭即不渲染）；setVisible(true) 时恢复启动
    if (this.options.visible) {
      this.renderLoop();
    }
  }

  /** 暂停 */
  pause(): void {
    this.isPlaying = false;
    this.pauseStartTime = performance.now();

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    // 暂停现有弹幕动画（而不是停止）
    this.domEngine?.pauseAnimations();
    this.canvasEngine?.pauseAnimations();
  }

  /** 停止 */
  stop(): void {
    this.isPlaying = false;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    this.domEngine?.stop();
    this.canvasEngine?.stop();
    this.clear();
  }

  /** 渲染循环 */
  private renderLoop = (): void => {
    if (!this.isPlaying) return;

    const currentTime = this.video.currentTime;

    // 时间变化较大时，可能是seek操作
    if (Math.abs(currentTime - this.lastVideoTime) > 1) {
      this.onSeeking();
    }

    this.lastVideoTime = currentTime;

    // 更新调度器时间
    this.scheduler.setCurrentTime(currentTime);

    // 以活跃渲染数量为硬上限；历史弹幕数量不会无限转化为 DOM/Canvas 对象。
    const activeEngine = this.getActiveEngine();
    const activeCount = activeEngine?.getStats().renderCount || 0;
    const available = Math.max(0, this.options.maxRenderCount - activeCount);
    if (available > 0 && !this.renderQueryPending) {
      this.renderQueryPending = true;
      this.scheduler
        .getDanmakuToRenderAsync(currentTime, Math.min(10, available))
        .then((danmakuToRender) => {
          if (Math.abs(this.video.currentTime - currentTime) > 0.5) return;
          if (danmakuToRender.length > 0) this.renderDanmaku(danmakuToRender);
        })
        .finally(() => {
          this.renderQueryPending = false;
        });
    }

    this.animationId = requestAnimationFrame(this.renderLoop);
  };

  /** 渲染弹幕（弹幕关闭时拦截：seek 同步路径与调度器异步路径的统一守卫） */
  private renderDanmaku(items: DanmakuItem[]): void {
    if (!this.options.visible) return;
    const engine = this.getActiveEngine();
    if (!engine) return;

    const currentTime = performance.now();
    const videoTime = this.video.currentTime;

    // 根据引擎类型调用不同方法
    if (this.currentMode === RenderMode.DOM && this.domEngine) {
      this.domEngine.addDanmakuBatch(items, currentTime, videoTime);
    } else if (this.canvasEngine) {
      this.canvasEngine.addDanmakuBatch(items, currentTime, videoTime);
    }
  }

  /** 获取当前激活的引擎 */
  private getActiveEngine(): DOMEngine | CanvasEngine | null {
    // 自动模式：根据弹幕数量切换
    if (this.currentMode === RenderMode.AUTO) {
      const stats = this.scheduler.getStats();
      if (stats.totalLoaded > this.config.autoSwitchThreshold) {
        this.currentMode = RenderMode.CANVAS;
        this.domEngine?.stop();
        const canvas = this.ensureCanvasEngine();
        if (this.isPlaying) canvas.start();
        return canvas;
      } else {
        this.currentMode = RenderMode.DOM;
        this.canvasEngine?.stop();
        if (this.isPlaying) this.domEngine?.start();
        return this.domEngine;
      }
    }

    return this.currentMode === RenderMode.DOM
      ? this.domEngine
      : this.ensureCanvasEngine();
  }

  /** 时间更新处理 */
  private onTimeUpdate(): void {
    // 已在renderLoop中处理
  }

  /** Seeking处理 */
  private onSeeking(): void {
    const currentTime = this.video.currentTime;
    const timeDiff = currentTime - this.lastVideoTime;

    // 判断seek幅度
    const isSmallSeek = Math.abs(timeDiff) <= 5; // 5秒内认为是小幅度seek

    if (isSmallSeek) {
      // 小幅度seek：保留现有弹幕，只更新位置
      this.handleSmallSeek(currentTime, timeDiff);
    } else {
      // 大幅度seek：清空并重新加载
      this.handleLargeSeek(currentTime);
    }
  }

  /** 处理小幅度seek（几秒） */
  private handleSmallSeek(currentTime: number, timeDiff: number): void {
    // 更新调度器时间
    this.scheduler.setCurrentTime(currentTime);

    // 更新现有弹幕的位置（根据seek的时间差）
    this.domEngine?.updateDanmakuPositionsForSeek(timeDiff);
    this.canvasEngine?.updateDanmakuPositionsForSeek(timeDiff);

    // 获取新进入时间窗口的弹幕
    const danmakuToRender = this.scheduler.getDanmakuToRender(currentTime, 10);
    if (danmakuToRender.length > 0) {
      this.renderDanmaku(danmakuToRender);
    }
  }

  /** 处理大幅度seek（超过5秒）- B站风格：保留弹幕，调整位置 */
  private handleLargeSeek(currentTime: number): void {
    const timeDiff = currentTime - this.lastVideoTime;

    // 更新调度器时间
    this.scheduler.setCurrentTime(currentTime);

    // B站风格：不清空弹幕，而是调整所有现有弹幕的位置
    // 对于已经在屏幕上的弹幕，调整它们的动画进度
    this.domEngine?.updateDanmakuPositionsForLargeSeek(timeDiff);
    this.canvasEngine?.updateDanmakuPositionsForLargeSeek(timeDiff);

    // 获取新进入时间窗口的弹幕并渲染
    const danmakuToRender = this.scheduler.getDanmakuToRender(currentTime, 10);
    if (danmakuToRender.length > 0) {
      this.renderDanmaku(danmakuToRender);
    }
  }

  /** 清空弹幕 */
  clear(): void {
    this.domEngine?.clear();
    this.canvasEngine?.clear();
    this.scheduler.resetEmission();
  }

  /** 移除单条弹幕 */
  removeDanmaku(renderId: string): void {
    this.domEngine?.removeDanmaku(renderId);
    this.canvasEngine?.removeDanmaku(renderId);
  }

  /** 设置弹幕数据源 */
  setDataSource(
    loader: (startTime: number, endTime: number) => Promise<DanmakuItem[]>,
  ): void {
    this.scheduler.setLoadCallback(loader);
  }

  /**
   * 重置数据源与分段缓存（切换视频 / 更换弹幕源时调用）
   *
   * 与 clear() 的区别：clear() 只清空渲染引擎并允许当前窗口重新发射，
   * 分段缓存保留（同一数据源下的 seek 场景）；本方法额外清空调度器
   * 的全部分段缓存与统计，保证旧数据源的弹幕不会残留到新视频。
   */
  resetDataSource(): void {
    this.domEngine?.clear();
    this.canvasEngine?.clear();
    this.scheduler.reset();
  }

  /** 添加单条弹幕 */
  addDanmaku(danmaku: DanmakuItem): void {
    this.scheduler.addDanmaku(danmaku);
  }

  /** 批量加载弹幕（首次加载大量弹幕时用，避免逐条 addDanmaku 的 O(n²) 卡顿） */
  loadDanmaku(list: DanmakuItem[]): void {
    this.scheduler.loadDanmakuBatch(list);
  }

  /** 发送弹幕 */
  sendDanmaku(text: string, options: Partial<DanmakuItem> = {}): void {
    const danmaku: DanmakuItem = {
      id: Date.now(),
      text,
      time: this.video.currentTime,
      type: DanmakuType.SCROLL,
      // 不携带 fontSize：options.fontSize 是「用户缩放后的基准像素值」，
      // 若作为弹幕自带字号传入，引擎会再乘一次 fontSizeScale，
      // 导致本地弹幕字号双重缩放（比历史弹幕大一圈）；
      // 引擎对缺省字号使用 baseFontSize，与历史弹幕同一缩放基准
      color: "#ffffff",
      ...options,
    };

    this.addDanmaku(danmaku);

    // 标记「已发射」：sendDanmaku 会入调度器并立即渲染，若不标记，
    // 下一帧查询窗口 [t - renderDelay, t + 0.5] 仍覆盖刚发送的时间点，
    // 调度器会再次发射同一条弹幕 → 屏幕出现两条一模一样的弹幕。
    this.scheduler.markEmitted(danmaku);

    // 弹幕关闭时不立即上屏（该条随 markEmitted 保留在历史，不重复发射，
    // 与 B 站行为一致：关闭弹幕时发送照样入库但不上屏）
    if (!this.options.visible) return;

    // 立即渲染
    const engine = this.getActiveEngine();
    if (engine instanceof DOMEngine) {
      engine.addDanmaku(danmaku, performance.now());
    } else if (engine instanceof CanvasEngine) {
      engine.addDanmaku(danmaku, performance.now());
    }
  }

  /**
   * 设置可见性（关闭 = 真正不渲染，非透明度遮蔽）
   *
   * 关闭时：清空全部在飞弹幕（引擎回收 DOM/渲染项）+ 重置发射窗口 +
   * 停止渲染循环（调度器不再查询发射），弹幕系统零渲染开销；
   * danmaku-x-hide 类仅作容器级视觉兜底。
   * 重新打开时：视频仍在播放则重启渲染循环，调度器从当前时间窗继续发射
   */
  setVisible(visible: boolean): void {
    if (this.options.visible === visible) return; // 幂等：状态未变不重复清理
    this.options.visible = visible;
    this.domEngine?.setVisible(visible);
    this.canvasEngine?.setVisible(visible);
    if (!visible) {
      this.clear();
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    } else if (this.isPlaying && this.animationId === null) {
      this.renderLoop();
    }
  }

  /** 设置透明度 */
  setOpacity(opacity: number): void {
    this.options.opacity = opacity;
    this.domEngine?.updateConfig({ opacity });
    this.canvasEngine?.updateConfig({ opacity });
  }

  /** 设置密度 */
  setDensity(density: number): void {
    this.options.density = density;
    this.scheduler.updateConfig({ densityLimit: density });
  }

  /** 设置渲染模式 */
  setRenderMode(mode: RenderMode): void {
    const wasPlaying = this.isPlaying;
    this.currentMode = mode;
    this.options.renderMode = mode;

    // 清空并重启
    this.clear();
    if (wasPlaying) {
      this.isPlaying = false;
      this.play();
    }
  }

  /** 切换全屏 */
  toggleFullscreen(): void {
    if (!document.fullscreenElement) {
      this.container.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  /** 启动性能监控 */
  private startPerformanceMonitor(): void {
    this.performanceMonitorTimer = window.setInterval(() => {
      this.updatePerformanceStats();
    }, this.config.performanceMonitorInterval);
  }

  /** 更新性能统计 */
  private updatePerformanceStats(): void {
    const domStats = this.domEngine?.getStats();
    const canvasStats = this.canvasEngine?.getStats();
    const poolStats = this.itemPool.getStats();

    this.performanceStats = {
      fps: canvasStats?.fps || 60,
      renderCount: domStats?.renderCount || canvasStats?.renderCount || 0,
      poolUsage: poolStats.inUse / poolStats.total,
      memoryUsage: this.getMemoryUsage(),
      avgRenderTime: 0, // 需要更精细的测量
    };

    // 性能警告
    if (this.performanceStats.fps < this.config.minFps) {
      this.events.onPerformanceWarning?.(this.performanceStats);
    }
  }

  /** 获取内存使用 */
  // private getMemoryUsage(): number {
  //   if ('memory' in performance) {
  //     const memory = (performance as any).memory;
  //     return memory ? Math.round(memory.usedJSHeapSize / 1048576) : 0;
  //   }

  //   return 0;
  // }

  private getMemoryUsage(): number {
    if ("memory" in performance) {
      const memory = (performance as { memory: { usedJSHeapSize: number } })
        .memory;
      return Math.round(memory.usedJSHeapSize / 1048576);
    }
    return 0;
  }

  /** 获取性能统计 */
  getPerformanceStats(): PerformanceStats {
    return { ...this.performanceStats };
  }

  /** 获取统计信息 */
  getStats(): {
    renderMode: RenderMode;
    screenMode: ScreenMode;
    isPlaying: boolean;
    performance: PerformanceStats;
    scheduler: ReturnType<DanmakuScheduler["getStats"]>;
  } {
    return {
      renderMode: this.currentMode,
      screenMode: this.currentScreenMode,
      isPlaying: this.isPlaying,
      performance: this.performanceStats,
      scheduler: this.scheduler.getStats(),
    };
  }

  /** 调整尺寸 */
  resize(): void {
    this.domEngine?.resize();
    this.canvasEngine?.resize();
  }

  /**
   * 切换屏幕模式（全屏/非全屏）
   * @param mode 屏幕模式：'fullscreen' 或 'normal'
   */
  switchScreenMode(mode: "fullscreen" | "normal"): void {
    const newMode =
      mode === "fullscreen" ? ScreenMode.FULLSCREEN : ScreenMode.NORMAL;

    if (newMode !== this.currentScreenMode) {
      this.currentScreenMode = newMode;

      // 在浏览器开始 fullscreen layout 前先保留当前画面，避免中间过渡帧闪白。
      this.canvasEngine?.beginResizeTransition();

      // 等待浏览器完成 fullscreen layout 后只做一次原子 resize。
      if (this.resizeTimeout) cancelRaf(this.resizeTimeout);
      this.resizeTimeout = rafTimeout(() => {
        requestAnimationFrame(() => {
          this.domEngine?.switchScreenMode(newMode);
          this.canvasEngine?.switchScreenMode(newMode);
          this.domEngine?.resize();
          this.canvasEngine?.resize();
        });
      }, 32);
    }
  }

  /**
   * 设置底部安全区域高度（字幕区域）
   * @param height 安全区域高度（像素）
   */
  setBottomSafeArea(height: number): void {
    // 更新轨道管理器配置
    this.trackManager.updateConfig({ bottomSafeArea: height });
    // 重新初始化轨道
    this.trackManager.initTracks(
      this.container.clientWidth,
      this.container.clientHeight,
      this.options.area,
    );
  }

  /**
   * 获取当前轨道信息
   * @returns 轨道数量和尺寸信息
   */
  getTrackInfo(): {
    count: number;
    height: number;
    screenMode: ScreenMode;
    containerWidth: number;
    containerHeight: number;
  } {
    return {
      count: this.trackManager.getTrackCount(),
      // 轨道高度已随有效字号动态化（calculateTrackHeight），以轨道管理器实际值为准
      height: this.trackManager.getTrackConfig().height,
      screenMode: this.currentScreenMode,
      containerWidth: this.container.clientWidth,
      containerHeight: this.container.clientHeight,
    };
  }

  /** 销毁 */
  destroy(): void {
    this.stop();

    if (this.performanceMonitorTimer) {
      clearInterval(this.performanceMonitorTimer);
    }

    // 清理ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.fullscreenHandler) {
      document.removeEventListener("fullscreenchange", this.fullscreenHandler);
      this.fullscreenHandler = null;
    }

    this.domEngine?.destroy();
    this.canvasEngine?.destroy();
    this.scheduler.destroy();
    this.elementPool.destroy();

    // 清理引用
    this.domEngine = null;
    this.canvasEngine = null;
  }

  /**
   * 设置弹幕悬停回调
   * @param callback 回调函数，参数为弹幕项和位置（悬停时为数据，离开时为空）
   * @example
   * danmakuManager.setOnDanmakuHover((danmaku, position) => {
   *   if (danmaku && position) {
   *     console.log('悬停弹幕:', danmaku.text);
   *     console.log('位置:', position); // { x: 100, y: 200 }
   *   } else {
   *     console.log('离开弹幕');
   *   }
   * });
   */
  setOnDanmakuHover(
    callback: (
      danmaku: DanmakuRenderItemType | null,
      position: { x: number; y: number } | null,
    ) => void,
  ): void {
    this.domEngine?.setOnDanmakuHover(callback);
    this.canvasEngine?.setOnDanmakuHover(callback);
  }

  /**
   * 设置弹幕速度档位
   * @param speed 速度档位：VERY_SLOW(极慢), SLOW(较慢), NORMAL(适中), FAST(较快), VERY_FAST(极快)
   * @description 修改后新渲染的弹幕会使用新速度，已存在的弹幕保持原速度；
   * 档位与连续倍率双轨并存，调用本方法会同步把 speedMultiplier 重置为该档位对应倍率
   */
  setSpeed(speed: DanmakuSpeed): void {
    this.options.speed = speed;
    // 档位驱动时同步连续倍率，保证两条路径状态一致
    this.options.speedMultiplier = SPEED_MULTIPLIERS[speed] ?? 1;
    this.domEngine?.updateConfig({ speed, speedMultiplier: this.options.speedMultiplier });
    this.canvasEngine?.updateConfig({ speed, speedMultiplier: this.options.speedMultiplier });
  }

  /**
   * 设置弹幕速度倍率（连续值，面板滑杆直连）
   * @param multiplier 速度倍率：1.0 = 基准；0.5 = 半速；2.0 = 两倍速（有效范围 0.1-5，越界收敛）
   * @description 与 speed 档位双轨并存，本方法优先（引擎速度计算优先读 speedMultiplier）；
   * 修改后新渲染的弹幕会使用新速度，已存在的弹幕保持原速度
   */
  setSpeedMultiplier(multiplier: number): void {
    const value = Math.min(5, Math.max(0.1, multiplier));
    this.options.speedMultiplier = value;
    this.domEngine?.updateConfig({ speedMultiplier: value });
    this.canvasEngine?.updateConfig({ speedMultiplier: value });
  }

  /**
   * 获取当前速度倍率
   */
  getSpeedMultiplier(): number {
    return this.options.speedMultiplier;
  }

  /**
   * 获取当前速度档位
   */
  getSpeed(): DanmakuSpeed {
    return this.options.speed;
  }

  /**
   * 设置弹幕区域档位
   * @param area 区域档位：QUARTER(25%), HALF(50%), THREE_QUARTERS(75%), FULL(100%)
   * @description 修改后新渲染的弹幕会使用新区域，已存在的弹幕保持原位置
   */
  setArea(area: DanmakuArea): void {
    this.options.area = area;
    this.domEngine?.updateConfig({ area });
    this.canvasEngine?.updateConfig({ area });
  }

  /**
   * 设置弹幕区域占比（连续值，面板滑杆直连）
   * @param ratio 显示区域占比：0.25 = 仅顶部 1/4；1 = 全屏（有效范围 0.05-1，越界收敛）
   * @description 与 setArea 档位等效但支持任意比例；
   * 修改后新渲染的弹幕会使用新区域，已存在的弹幕保持原位置
   */
  setAreaRatio(ratio: number): void {
    const value = Math.min(1, Math.max(0.05, ratio));
    this.options.area = value;
    this.domEngine?.updateConfig({ area: value });
    this.canvasEngine?.updateConfig({ area: value });
  }

  /**
   * 获取当前区域占比
   */
  getArea(): DanmakuArea {
    return this.options.area;
  }

  /**
   * 设置弹幕字号
   * @param fontSize 字号大小（像素）
   * @description 修改后在飞弹幕立即按新字号刷新（重测文本盒、重写滚动距离），
   * 新渲染的弹幕同样使用新字号
   */
  setFontSize(fontSize: number): void {
    this.options.fontSize = fontSize;
    const fontSizeScale = fontSize / 18;
    this.domEngine?.updateConfig({ fontSizeScale });
    this.canvasEngine?.updateConfig({ fontSizeScale });
  }

  /**
   * 设置弹幕字号缩放系数（连续值，面板滑杆直连）
   * @param scale 缩放系数：1 = 基准 18px；1.5 = 27px；0.5 = 9px（有效范围 0.5-2，越界收敛）
   * @description 与 setFontSize 像素值等效；修改后在飞弹幕与新弹幕均立即按新字号生效
   */
  setFontSizeScale(scale: number): void {
    const value = Math.min(2, Math.max(0.5, scale));
    this.setFontSize(value * 18);
  }

  /**
   * 获取当前字号
   */
  getFontSize(): number {
    return this.options.fontSize;
  }

  /**
   * 设置是否自动随屏幕大小缩放弹幕
   * @param autoScale 是否自动缩放，默认true
   * @description 开启后弹幕随容器大小自动缩放，关闭后保持固定大小；
   * 切换时在飞弹幕立即按新开关刷新字号（引擎同步重建轨道），新弹幕同样即时生效
   */
  setAutoScale(autoScale: boolean): void {
    this.options.autoScale = autoScale;
    // 只更新配置不触发 resize（容器尺寸未变，screenScale 无需重算）；
    // 引擎在字号类配置变化时会刷新在飞弹幕字号并重建轨道
    this.domEngine?.updateConfig({ autoScale });
    this.canvasEngine?.updateConfig({ autoScale });
  }

  /**
   * 获取当前是否自动缩放弹幕
   */
  getAutoScale(): boolean {
    return this.options.autoScale ?? true;
  }

  /**
   * 设置弹幕过滤器
   * @param filter 过滤器配置：{ scroll?: boolean, fixed?: boolean, colorful?: boolean }
   * @description 修改后立即生效，新添加的弹幕会根据过滤器判断是否显示
   */
  setFilter(filter: DanmakuFilter): void {
    this.options.filter = filter;
    this.domEngine?.updateConfig({ filter });
    this.canvasEngine?.updateConfig({ filter });
  }

  /**
   * 获取当前过滤器设置
   */
  getFilter(): DanmakuFilter {
    return { ...this.options.filter };
  }

  /**
   * 重置过滤器（清除所有过滤）
   */
  resetFilter(): void {
    this.setFilter({});
  }

  /**
   * 设置防挡遮罩
   * @param config 防挡遮罩配置
   * @description 启用后，弹幕会在遮罩镂空区域显示，被遮挡区域不显示弹幕
   */
  setMaskConfig(config: DanmakuMaskConfig): void {
    // 只给当前使用的引擎设置遮罩配置，并传入获取视频时间的回调
    const activeEngine = this.getActiveEngine();
    if (activeEngine) {
      activeEngine.setMaskConfig({
        ...config,
        getCurrentTime: () => this.video.currentTime,
      });
    }
  }

  /**
   * 获取当前防挡遮罩配置
   */
  getMaskConfig(): DanmakuMaskConfig | undefined {
    // 从 DOM 引擎获取配置（两个引擎配置保持一致）
    return (
      this.domEngine?.["config"]?.maskConfig ??
      this.canvasEngine?.["config"]?.maskConfig
    );
  }

  /**
   * 启用防挡功能
   * @param maskImage 遮罩图片URL（镂空PNG）
   * @param videoRect 视频在容器中的位置（可选，用于对齐遮罩）
   */
  enableMask(
    maskImage: string,
    videoRect?: { x: number; y: number; width: number; height: number },
  ): void {
    this.setMaskConfig({
      enabled: true,
      maskImage,
      videoRect,
    });
  }

  /**
   * 禁用防挡功能
   */
  disableMask(): void {
    this.setMaskConfig({
      enabled: false,
    });
  }
}

// 默认导出
export default DanmakuManager;
