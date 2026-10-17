/**
 * 高性能弹幕系统 - Canvas渲染引擎
 * 使用Canvas 2D API渲染大量弹幕，支持离屏渲染和批量绘制
 */

import {
  DanmakuType,
  DanmakuSpeed,
  DanmakuArea,
  ScreenMode,
  type DanmakuItem,
  type DanmakuRenderItem,
  type DanmakuFilter,
  type DanmakuMaskConfig,
} from "./types";
import { DanmakuItemPool } from "./objectPool";
import { TrackManager } from "./trackManager";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import { calculateScale, calculateTrackHeight } from "./scaleHelper";

/** Canvas引擎配置 */
interface CanvasEngineConfig {
  /** 字体 */
  fontFamily: string;
  /** 基础字体大小 */
  baseFontSize: number;
  /** 字体大小缩放 */
  fontSizeScale: number;
  /** 屏幕自适应因子（resize 时按容器宽度计算，与用户字号缩放彻底分离） */
  screenScale: number;
  /** 阴影模糊 */
  shadowBlur: number;
  /** 阴影颜色 */
  shadowColor: string;
  /** 描边宽度 */
  strokeWidth: number;
  /** 描边颜色 */
  strokeColor: string;
  /** 透明度 */
  opacity: number;
  /** 速度档位 */
  speed: DanmakuSpeed;
  /** 速度倍率（连续值，优先于 speed 档位查表） */
  speedMultiplier?: number;
  /** 区域占比（0-1 连续值，兼容 DanmakuArea 档位枚举值） */
  area: number;
  /** 是否开启抗锯齿 */
  antialias: boolean;
  /** 过滤器 */
  filter: DanmakuFilter;
  /** 是否自动随屏幕大小缩放 */
  autoScale: boolean;
  /** 防挡遮罩配置 */
  maskConfig?: DanmakuMaskConfig;
  /** 视频元素（用于防挡遮罩获取当前时间） */
  video?: HTMLVideoElement;
}

/** 速度档位对应的倍率 */
const SPEED_MULTIPLIERS: Record<DanmakuSpeed, number> = {
  [DanmakuSpeed.VERY_SLOW]: 0.5,
  [DanmakuSpeed.SLOW]: 0.75,
  [DanmakuSpeed.NORMAL]: 1.0,
  [DanmakuSpeed.FAST]: 1.5,
  [DanmakuSpeed.VERY_FAST]: 2.0,
};

export class CanvasEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private config: CanvasEngineConfig;
  private itemPool: DanmakuItemPool;
  private trackManager: TrackManager;

  // 渲染状态
  private renderItems: Map<string, DanmakuRenderItem> = new Map();
  private isPlaying = false;
  private isPaused = false;
  private animationId: number | null = null;
  private lastFrameTime = 0;
  private frameCount = 0;
  private lastFpsTime = 0;
  private fps = 60;

  // 性能优化
  private offscreenCanvas: HTMLCanvasElement;
  private offscreenCtx: CanvasRenderingContext2D;
  private textMeasureCache: Map<string, TextMetrics> = new Map();
  // 文本精灵缓存：把每段弹幕文字预渲染成离屏 canvas，每帧 drawImage 代替 fillText，
  // 省掉重复的字体栅格化（这是 fillText 最贵的部分）。
  private textSpriteCache: Map<string, HTMLCanvasElement> = new Map();
  private textSpriteCacheMax = 400;

  // 尺寸
  private width = 0;
  private height = 0;
  private dpr = window.devicePixelRatio || 1;
  private isResizing = false;
  private resizeOverlay: HTMLCanvasElement | null = null;

  // 鼠标悬停回调
  private onDanmakuHover:
    | ((
        danmaku: DanmakuRenderItem | null,
        position: { x: number; y: number } | null,
      ) => void)
    | null = null;

  // 暂停的弹幕
  private pausedItems: Set<string> = new Set();

  // 防挡遮罩
  private maskImage: HTMLImageElement | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  private maskUpdateTimer: { id: number } | null = null;
  // 遮罩原始尺寸（用于比例计算）
  private maskOriginalWidth = 0;
  private maskOriginalHeight = 0;
  // 缓存的临时 canvas 和处理后的遮罩数据
  private maskTempCanvas: HTMLCanvasElement | null = null;
  private maskTempCtx: CanvasRenderingContext2D | null = null;
  // 缓存的计算结果
  private maskDrawParams: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;

  constructor(
    container: HTMLElement,
    itemPool: DanmakuItemPool,
    trackManager: TrackManager,
    config: Partial<CanvasEngineConfig> = {},
  ) {
    this.container = container;
    this.itemPool = itemPool;
    this.trackManager = trackManager;
    this.config = {
      fontFamily: "Microsoft YaHei, PingFang SC, sans-serif",
      baseFontSize: 18,
      fontSizeScale: 1,
      screenScale: 1,
      shadowBlur: 2,
      shadowColor: "rgba(0, 0, 0, 0.8)",
      strokeWidth: 1,
      strokeColor: "#000000",
      opacity: 1,
      speed: DanmakuSpeed.NORMAL,
      area: DanmakuArea.FULL,
      antialias: true,
      filter: {},
      autoScale: true,
      ...config,
    };

    this.canvas = document.createElement("canvas");
    // 样式由 danmaku.scss 的 .danmaku-canvas 提供（定位/尺寸/硬件加速），不在 TS 内联
    this.canvas.className = "danmaku-canvas";

    // 启用硬件加速的 Canvas 上下文配置
    const ctx = this.canvas.getContext("2d", {
      alpha: true,
      desynchronized: true, // 启用去同步渲染，减少延迟
    });
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }
    this.ctx = ctx;

    // 离屏Canvas - 用于双缓冲渲染
    this.offscreenCanvas = document.createElement("canvas");
    const offscreenCtx = this.offscreenCanvas.getContext("2d", {
      alpha: true,
    });
    if (!offscreenCtx) {
      throw new Error("Failed to get offscreen canvas context");
    }
    this.offscreenCtx = offscreenCtx;

    container.appendChild(this.canvas);

    // 绑定鼠标事件
    this.bindMouseEvents();

    // 初始化防挡遮罩
    if (this.config.maskConfig?.enabled && this.config.maskConfig.maskImage) {
      this.loadMaskImage(this.config.maskConfig.maskImage);
    }

    this.resize();
  }

  /**
   * 加载防挡遮罩图片
   * @param url 图片URL
   * @param originalWidth 遮罩原始宽度（可选）
   * @param originalHeight 遮罩原始高度（可选）
   */
  private loadMaskImage(
    url: string,
    originalWidth?: number,
    originalHeight?: number,
  ): void {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this.maskImage = img;
      // 保存原始尺寸，如果没有提供则使用图片实际尺寸
      this.maskOriginalWidth = originalWidth || img.naturalWidth || img.width;
      this.maskOriginalHeight =
        originalHeight || img.naturalHeight || img.height;
      // 关键：换新遮罩图时清空缓存的临时画布，否则会复用上一帧的旧 mask，
      // 导致人物移动了但镂空位置还停在第一帧（对不齐）。
      this.maskTempCanvas = null;
      this.maskTempCtx = null;
      this.maskDrawParams = null;
      this.createMaskCanvas();
    };
    img.onerror = () => {
      // 静默处理错误
    };
    img.src = url;
  }

  /**
   * 创建遮罩Canvas
   */
  private createMaskCanvas(): void {
    if (!this.maskImage) return;

    this.maskCanvas = document.createElement("canvas");
    // 遮罩画布要和主画布一样按 DPR 建立，否则遮罩被放大后边缘模糊、和人物对不齐
    this.maskCanvas.width = Math.round(this.width * this.dpr);
    this.maskCanvas.height = Math.round(this.height * this.dpr);

    const ctx = this.maskCanvas.getContext("2d");
    if (!ctx) return;
    this.maskCtx = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(this.dpr, this.dpr);

    this.updateMaskCanvas();
  }

  /**
   * 更新遮罩Canvas
   * 使用 contain 模式保持比例自适应居中
   *
   * 蒙层图片格式：透明/镂空区域=不显示弹幕，其他区域(黑色)=显示弹幕
   * 最终 maskCanvas：透明=切除弹幕(不显示)，黑色=保留弹幕(显示)
   */
  private updateMaskCanvas(): void {
    if (!this.maskImage || !this.maskCtx || !this.maskCanvas) return;

    // 使用遮罩原始尺寸或图片实际尺寸计算比例
    const imgWidth =
      this.maskOriginalWidth ||
      this.maskImage.naturalWidth ||
      this.maskImage.width;
    const imgHeight =
      this.maskOriginalHeight ||
      this.maskImage.naturalHeight ||
      this.maskImage.height;

    if (imgWidth === 0 || imgHeight === 0) return;

    // contain 模式：保持比例，撑满长或宽，另一边居中
    const scaleX = this.width / imgWidth;
    const scaleY = this.height / imgHeight;
    const scale = Math.min(scaleX, scaleY);

    const drawWidth = Math.ceil(imgWidth * scale);
    const drawHeight = Math.ceil(imgHeight * scale);
    const x = Math.floor((this.width - drawWidth) / 2);
    const y = Math.floor((this.height - drawHeight) / 2);

    // 缓存当前绘制参数
    const newParams = { x, y, width: drawWidth, height: drawHeight };
    const paramsChanged =
      !this.maskDrawParams ||
      this.maskDrawParams.x !== x ||
      this.maskDrawParams.y !== y ||
      this.maskDrawParams.width !== drawWidth ||
      this.maskDrawParams.height !== drawHeight;

    // 步骤1：先把整个 maskCanvas 填充为黑色（显示弹幕）。
    // maskCtx 已按 DPR 缩放，这里用逻辑尺寸 this.width/this.height。
    this.maskCtx.fillStyle = "#000000";
    this.maskCtx.fillRect(0, 0, this.width, this.height);

    // 步骤2：检查是否需要重新处理遮罩数据
    let tempCanvas: HTMLCanvasElement;

    if (!paramsChanged && this.maskTempCanvas && this.maskTempCtx) {
      // 复用缓存的临时 canvas
      tempCanvas = this.maskTempCanvas;
    } else {
      // 需要重新创建或重置临时 canvas
      if (
        !this.maskTempCanvas ||
        this.maskTempCanvas.width !== drawWidth ||
        this.maskTempCanvas.height !== drawHeight
      ) {
        this.maskTempCanvas = document.createElement("canvas");
        this.maskTempCanvas.width = drawWidth;
        this.maskTempCanvas.height = drawHeight;
        this.maskTempCtx = this.maskTempCanvas.getContext("2d");
      }

      tempCanvas = this.maskTempCanvas;

      // 在临时 canvas 上绘制蒙层图片
      if (this.maskTempCtx != null) {
        this.maskTempCtx.drawImage(this.maskImage, 0, 0, drawWidth, drawHeight);
        // 获取像素数据并处理（只处理一次，后续复用）
        const imageData = this.maskTempCtx.getImageData(
          0,
          0,
          drawWidth,
          drawHeight,
        );
        const data = imageData.data;
        const len = data.length;

        // 优化：使用局部变量减少属性访问
        for (let i = 0; i < len; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          // 透明或浅色区域设为白色（用于切除），深色区域设为透明（保留弹幕）
          if (a < 128 || (r > 200 && g > 200 && b > 200)) {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255;
          } else {
            data[i + 3] = 0;
          }
        }

        this.maskTempCtx.putImageData(imageData, 0, 0);

        // 更新缓存参数
        this.maskDrawParams = newParams;
      }
    }

    // 步骤3：使用 destination-out 将镂空区域（白色）从黑色背景中切除
    this.maskCtx.globalCompositeOperation = "destination-out";
    this.maskCtx.drawImage(tempCanvas, x, y);
    this.maskCtx.globalCompositeOperation = "source-over";
  }

  /**
   * 调整Canvas尺寸
   */
  beginResizeTransition(): void {
    if (this.resizeOverlay || this.canvas.width <= 0 || this.canvas.height <= 0)
      return;

    const overlay = document.createElement("canvas");
    overlay.width = this.canvas.width;
    overlay.height = this.canvas.height;
    const overlayCtx = overlay.getContext("2d");
    if (overlayCtx) overlayCtx.drawImage(this.canvas, 0, 0);
    overlay.className = "danmaku-canvas-resize-overlay";
    // 样式由 danmaku.scss 的 .danmaku-canvas-resize-overlay 提供，不在 TS 内联
    this.container.appendChild(overlay);
    this.resizeOverlay = overlay;
  }

  /**
   * 计算当前有效字号（基础字号 × 用户缩放 × 屏幕自适应因子）
   *
   * 与 DOMEngine 同一公式：screenScale（resize 计算）与 fontSizeScale（用户设置）
   * 彻底分离，autoScale 关闭时屏幕因子不乘入。
   * @param itemFontSize 弹幕数据自带字号（缺省用引擎基础字号）
   */
  private getEffectiveFontSize(itemFontSize?: number): number {
    const base = itemFontSize || this.config.baseFontSize;
    const factor = this.config.autoScale ? this.config.screenScale : 1;
    return base * this.config.fontSizeScale * factor;
  }

  /**
   * 同步轨道高度并重建轨道
   *
   * 轨道高度必须随有效字号缩放（calculateTrackHeight 覆盖文本盒高度
   * 并预留呼吸空间），字号缩放 / 屏幕自适应开关 / resize 时均须调用。
   */
  private syncTrackMetrics(): void {
    if (this.width <= 0 || this.height <= 0) return;
    const fontPx = this.getEffectiveFontSize();
    this.trackManager.updateConfig({
      trackHeight: calculateTrackHeight(fontPx),
    });
    // 重建轨道时回填在飞弹幕占用（详见 TrackManager.initTracks 注释）：
    // 与 DOMEngine 同一策略，防止字号缩放 / resize 后占用蒸发导致弹幕重叠
    const inFlight = Array.from(this.renderItems.values()).filter(
      (item) => item.isRendering,
    );
    this.trackManager.initTracks(this.width, this.height, this.config.area, inFlight);
  }

  resize(): void {
    // 使用getBoundingClientRect获取尺寸，它比clientWidth更实时
    const rect = this.container.getBoundingClientRect();

    // 使用rect的宽度和高度
    const newWidth = rect.width;
    const newHeight = rect.height;

    // 如果尺寸没有变化，跳过
    if (newWidth === this.width && newHeight === this.height) {
      return;
    }

    this.isResizing = true;
    const oldWidth = this.width;
    const oldHeight = this.height;
    // 迁移前的有效字号因子（用于在飞弹幕的尺寸缩放迁移）
    const oldFontFactor =
      this.config.fontSizeScale *
      (this.config.autoScale ? this.config.screenScale : 1);

    // backing store 重建会清空主画布；快照应在 fullscreenchange 的第一时间创建。
    this.beginResizeTransition();
    // 先保存逻辑进度，不能在全屏切换时简单沿用旧像素坐标。
    const scrollProgress = new Map<string, number>();
    if (oldWidth > 0) {
      for (const item of this.renderItems.values()) {
        if (item.type !== DanmakuType.SCROLL || !item.isRendering) continue;
        const oldDistance = oldWidth + item.width;
        scrollProgress.set(item.renderId, (oldWidth - item.x) / oldDistance);
      }
    }
    this.width = newWidth;
    this.height = newHeight;

    // 限制DPR最大为2，避免在高DPR屏幕上渲染过大的画布
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // 设置Canvas实际尺寸
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;

    // 设置显示尺寸
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    // 缩放上下文
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(this.dpr, this.dpr);

    // 离屏Canvas
    this.offscreenCanvas.width = this.width * this.dpr;
    this.offscreenCanvas.height = this.height * this.dpr;
    this.offscreenCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.offscreenCtx.scale(this.dpr, this.dpr);

    // 屏幕自适应因子：无条件按容器宽度计算并更新。
    // autoScale 仅在 getEffectiveFontSize 中控制是否乘入，
    // 与用户字号缩放（fontSizeScale）彻底分离，互不覆盖
    // （旧实现的 updateConfig({ fontSizeScale: scale }) 同时承载两个语义，
    //  与 setFontSizeScale 互相覆盖是「弹幕不缩放」的根因）。
    this.config.screenScale = calculateScale(this.width);

    // 同步轨道高度并重建轨道（保持当前区域档位）
    this.syncTrackMetrics();

    // 清空缓存
    this.textMeasureCache.clear();
    this.textSpriteCache.clear();

    // 如果启用了防挡遮罩，重新创建遮罩Canvas
    if (this.maskImage && this.config.maskConfig?.enabled) {
      this.createMaskCanvas();
    }

    // 更新遮罩canvas尺寸
    if (this.maskCanvas && this.maskImage) {
      this.maskCanvas.width = Math.round(this.width * this.dpr);
      this.maskCanvas.height = Math.round(this.height * this.dpr);
      this.maskCtx?.setTransform(1, 0, 0, 1, 0, 0);
      this.maskCtx?.scale(this.dpr, this.dpr);
      // 尺寸变化，清除缓存的绘制参数，强制重新计算
      this.maskDrawParams = null;
      this.updateMaskCanvas();
    }

    // 在飞弹幕的缩放迁移比：新/旧「有效字号因子」的比值
    // （fontSizeScale 与 screenScale 的乘积，autoScale 关闭时屏幕因子不参与）
    const newFontFactor =
      this.config.fontSizeScale *
      (this.config.autoScale ? this.config.screenScale : 1);
    const fontScaleRatio = oldFontFactor > 0 ? newFontFactor / oldFontFactor : 1;
    const heightScale = oldHeight > 0 ? this.height / oldHeight : 1;

    // 字体缩放后同步更新已有弹幕的测量尺寸和轨道位置，避免旧尺寸/新尺寸混用。
    for (const item of this.renderItems.values()) {
      item.y *= heightScale;
      item.width *= fontScaleRatio;
      item.height *= fontScaleRatio;
      const progress = scrollProgress.get(item.renderId);
      if (item.type === DanmakuType.SCROLL && progress !== undefined) {
        item.x = this.width - (this.width + item.width) * progress;
      }
      if (item.type === DanmakuType.TOP || item.type === DanmakuType.BOTTOM) {
        item.x = (this.width - item.width) / 2;
      }
    }

    this.isResizing = false;
    // resize 会重置 backing store；立即绘制当前帧，避免出现空白帧。
    if (this.isPlaying) this.draw();
    if (this.resizeOverlay) {
      const overlay = this.resizeOverlay;
      requestAnimationFrame(() => {
        if (this.resizeOverlay === overlay) {
          overlay.remove();
          this.resizeOverlay = null;
        }
      });
    }
  }

  /**
   * 检查弹幕是否被过滤
   */
  private isFiltered(item: DanmakuItem): boolean {
    const filter = this.config.filter;
    if (!filter) return false;

    // 过滤滚动弹幕
    if (filter.scroll && item.type === DanmakuType.SCROLL) {
      return true;
    }

    // 过滤固定弹幕（顶部+底部）
    if (
      filter.fixed &&
      (item.type === DanmakuType.TOP || item.type === DanmakuType.BOTTOM)
    ) {
      return true;
    }

    // 过滤彩色弹幕（非白色）
    if (filter.colorful) {
      const color = item.color || "#ffffff";
      const isWhite =
        color.toLowerCase() === "#ffffff" ||
        color.toLowerCase() === "white" ||
        color.toLowerCase() === "#fff";
      if (!isWhite) {
        return true;
      }
    }

    return false;
  }

  /**
   * 添加弹幕
   * @param item 弹幕数据
   * @param currentTime 当前时间
   * @returns 是否成功添加
   */
  addDanmaku(
    item: DanmakuItem,
    currentTime: number,
    videoTime?: number,
  ): boolean {
    // 检查是否被过滤
    if (this.isFiltered(item)) {
      return false;
    }

    // 如果正在resize，延迟添加弹幕
    if (this.isResizing) {
      requestAnimationFrame(() =>
        this.addDanmaku(item, currentTime, videoTime),
      );
      return true;
    }

    // 测量文本尺寸
    const { width, height } = this.measureText(item.text, item.fontSize);

    // 计算动画持续时间
    // 滚动弹幕：根据距离和速度计算，确保完全移出屏幕
    const distance = item.type === DanmakuType.SCROLL ? this.width + width : 0;
    // 根据屏幕宽度调整基础速度，确保全屏时弹幕不会太慢
    // 窗口模式(800px)约150px/s，全屏模式(1920px)约200px/s
    const baseSpeed = Math.min(200, 120 + (this.width / 1920) * 80);
    // 速度倍率双轨：优先使用弹幕数据中的 speed 档位倍率；
    // 否则用当前配置 speedMultiplier（连续值，面板滑杆直连），
    // speedMultiplier 未设置时回退到 speed 档位查表
    const speedToUse =
      item.speed !== undefined ? item.speed : this.config.speed;
    const speedMultiplier =
      item.speed !== undefined
        ? (SPEED_MULTIPLIERS[speedToUse] ?? 1)
        : (this.config.speedMultiplier ??
          SPEED_MULTIPLIERS[speedToUse] ??
          1);
    const adjustedSpeed = baseSpeed * speedMultiplier;
    const scrollDuration =
      item.type === DanmakuType.SCROLL ? (distance / adjustedSpeed) * 1000 : 0;
    // 固定弹幕显示4秒
    const fixedDuration = 4000;
    const duration =
      item.type === DanmakuType.SCROLL ? scrollDuration : fixedDuration;

    // 计算弹幕已经经过的时间（用于快进后恢复显示）
    let elapsedTime = 0;
    if (videoTime !== undefined && item.type === DanmakuType.SCROLL) {
      elapsedTime = Math.max(0, (videoTime - item.time) * 1000); // 转换为毫秒
    }

    // 创建渲染项
    const renderItem = this.itemPool.acquire({
      ...item,
      x: this.width,
      y: 0,
      width,
      height,
      speed:
        item.type === DanmakuType.SCROLL ? distance / (duration / 1000) : 0,
      duration,
      isRendering: true,
      scrollDistance: item.type === DanmakuType.SCROLL ? distance : undefined,
    });

    if (!renderItem) {
      return false;
    }

    // 获取可用轨道
    const trackIndex = this.trackManager.getAvailableTrack(
      renderItem,
      currentTime,
    );
    if (trackIndex === -1) {
      this.itemPool.release(renderItem.renderId);
      return false;
    }

    // 添加到轨道
    this.trackManager.addToTrack(trackIndex, renderItem);

    // 设置初始位置
    if (item.type === DanmakuType.SCROLL) {
      // 如果有经过时间，计算当前位置；否则从右侧进入
      if (elapsedTime > 0 && elapsedTime < duration) {
        const progress = elapsedTime / duration;
        renderItem.x = this.width - distance * progress;
        renderItem.createTime = currentTime - elapsedTime;
      } else {
        renderItem.x = this.width;
      }
    } else if (item.type === DanmakuType.TOP) {
      // 顶部固定弹幕居中
      renderItem.x = (this.width - width) / 2;
    } else if (item.type === DanmakuType.BOTTOM) {
      // 底部固定弹幕居中
      renderItem.x = (this.width - width) / 2;
    }

    // 保存渲染项
    this.renderItems.set(renderItem.renderId, renderItem);

    return true;
  }

  /**
   * 批量添加弹幕
   * @param items 弹幕列表
   * @param currentTime 当前时间
   */
  addDanmakuBatch(
    items: DanmakuItem[],
    currentTime: number,
    videoTime?: number,
  ): void {
    // 按时间排序
    const sortedItems = items.sort((a, b) => a.time - b.time);

    // 批量添加
    for (const item of sortedItems) {
      this.addDanmaku(item, currentTime, videoTime);
    }
  }

  /**
   * 测量文本尺寸
   * @param text 文本
   * @param fontSize 字体大小
   * @returns 尺寸
   */
  private measureText(
    text: string,
    fontSize?: number,
  ): { width: number; height: number } {
    // 有效字号 = 弹幕自带字号（或基础字号）× 用户缩放 × 屏幕自适应因子
    const size = this.getEffectiveFontSize(fontSize);
    const cacheKey = `${text}_${size}`;

    let metrics = this.textMeasureCache.get(cacheKey);
    if (!metrics) {
      // 使用离屏Canvas进行文本测量，避免影响主Canvas
      this.offscreenCtx.font = `bold ${size}px ${this.config.fontFamily}`;
      metrics = this.offscreenCtx.measureText(text);
      this.textMeasureCache.set(cacheKey, metrics);
    }

    return {
      width: metrics.width,
      height: size * 1.2,
    };
  }

  /**
   * 开始渲染
   */
  start(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.renderLoop();
  }

  /**
   * 停止渲染
   */
  stop(): void {
    this.isPlaying = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  /**
   * 暂停渲染（视频暂停时调用）
   */
  pauseAnimations(): void {
    // Canvas 引擎由 rAF 循环驱动，暂停只需置标志位，无需任何样式类
    this.isPaused = true;
  }

  /**
   * 恢复渲染（视频播放时调用）
   */
  resumeAnimations(): void {
    this.isPaused = false;
    this.lastFrameTime = performance.now();
  }

  /**
   * 设置弹幕整体显隐（样式由 danmaku.scss 的 .danmaku-x-hide 提供，不在 TS 内联）
   */
  setVisible(visible: boolean): void {
    this.canvas.classList.toggle("danmaku-x-hide", !visible);
  }

  /**
   * 调整弹幕时间（用于补偿暂停时间）
   * @param deltaTime 需要补偿的时间（毫秒）
   */
  adjustDanmakuTime(deltaTime: number): void {
    for (const item of this.renderItems.values()) {
      if (item.isRendering && !this.pausedItems.has(item.renderId)) {
        item.createTime += deltaTime;
      }
    }
  }

  /**
   * 清空弹幕
   */
  clear(): void {
    if (this.resizeOverlay) {
      this.resizeOverlay.remove();
      this.resizeOverlay = null;
    }
    this.renderItems.forEach((item) => {
      this.itemPool.release(item.renderId);
    });
    this.renderItems.clear();
    this.trackManager.reset();
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  /**
   * 移除单条弹幕
   * @param renderId 渲染ID
   */
  removeDanmaku(renderId: string): void {
    const item = this.renderItems.get(renderId);
    if (item) {
      // 从轨道移除
      this.trackManager.removeFromTrack(item);
      // 回收对象
      this.itemPool.release(renderId);
      this.renderItems.delete(renderId);
    }
  }

  /**
   * 更新弹幕位置（用于小幅度seek）- B站风格：保留屏幕弹幕，调整动画进度
   * @param timeDiff 时间差（秒），正数表示快进，负数表示后退
   */
  updateDanmakuPositionsForSeek(timeDiff: number): void {
    const timeDiffMs = timeDiff * 1000; // 转换为毫秒
    const itemsToRemove: string[] = [];

    for (const [id, item] of this.renderItems) {
      if (!item.isRendering) continue;

      if (item.type === DanmakuType.SCROLL) {
        // 滚动弹幕：根据时间差调整位置
        // 使用保存的scrollDistance，避免屏幕尺寸变化影响
        const distance = item.scrollDistance || this.width + item.width;

        // 快进：弹幕应该向前移动；后退：弹幕应该向后移动
        // 调整 createTime 来影响动画进度
        item.createTime -= timeDiffMs;

        // 重新计算当前位置
        const elapsed = performance.now() - item.createTime;
        const progress = elapsed / item.duration;
        item.x = this.width - distance * progress;

        // 如果弹幕已经移出屏幕，标记为移除
        if (item.x < -item.width || progress >= 1) {
          item.isRendering = false;
          itemsToRemove.push(id);
          this.trackManager.removeFromTrack(item);
        }
      }
      // 固定弹幕不需要调整位置
    }

    // 释放已结束的弹幕
    for (const id of itemsToRemove) {
      const item = this.renderItems.get(id);
      if (item) {
        this.itemPool.release(id);
        this.renderItems.delete(id);
      }
    }
  }

  /**
   * 更新弹幕位置（用于大幅度seek）- B站风格
   * 与小幅度seek相同处理：保留弹幕，调整动画进度
   * @param timeDiff 时间差（秒），正数表示快进，负数表示后退
   */
  updateDanmakuPositionsForLargeSeek(timeDiff: number): void {
    // 大幅度seek也使用相同的处理方式
    this.updateDanmakuPositionsForSeek(timeDiff);
  }

  /**
   * 渲染循环
   */
  private renderLoop = (): void => {
    if (!this.isPlaying) return;

    const currentTime = performance.now();

    // 如果视频暂停，不更新lastFrameTime，避免deltaTime累积
    if (this.isPaused) {
      this.draw();
      this.animationId = requestAnimationFrame(this.renderLoop);
      return;
    }

    const deltaTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    // 计算FPS（每秒一次）
    this.frameCount++;
    if (currentTime - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = currentTime;
    }

    this.update(deltaTime, currentTime);
    this.draw();

    this.animationId = requestAnimationFrame(this.renderLoop);
  };

  /**
   * 更新弹幕位置
   * @param deltaTime 时间差
   * @param currentTime 当前时间
   */
  private update(deltaTime: number, currentTime: number): void {
    // 清理已结束的弹幕
    const itemsToRemove: string[] = [];
    const width = this.width; // 缓存宽度避免重复访问
    const pausedItems = this.pausedItems; // 缓存引用
    const renderItems = this.renderItems; // 缓存引用
    const itemPool = this.itemPool; // 缓存引用
    const trackManager = this.trackManager; // 缓存引用

    for (const [id, item] of renderItems) {
      if (!item.isRendering) {
        itemsToRemove.push(id);
        continue;
      }

      // 跳过鼠标悬停暂停的弹幕
      if (pausedItems.has(id)) {
        item.createTime += deltaTime;
        continue;
      }

      // 计算经过时间
      const elapsedTime = currentTime - item.createTime;

      // 检查是否结束
      if (elapsedTime >= item.duration) {
        item.isRendering = false;
        itemsToRemove.push(id);
        trackManager.removeFromTrack(item);
        continue;
      }

      // 更新位置 (滚动弹幕) - 内联计算减少函数调用
      if (item.type === DanmakuType.SCROLL) {
        const progress = elapsedTime / item.duration;
        item.x = width - (item.scrollDistance || width + item.width) * progress;
      }
    }

    // 批量释放已结束的弹幕
    const removeCount = itemsToRemove.length;
    if (removeCount > 0) {
      for (let i = 0; i < removeCount; i++) {
        const id = itemsToRemove[i];
        renderItems.delete(id);
        itemPool.release(id);
      }
    }

    // 清理轨道
    trackManager.cleanupFinishedItems(currentTime);
  }

  /**
   * 绘制弹幕
   */
  private draw(): void {
    // 优化：使用透明填充代替clearRect，在某些浏览器上更快
    this.ctx.clearRect(0, 0, this.width, this.height);

    // 收集可见弹幕
    const visibleItems: DanmakuRenderItem[] = [];
    for (const item of this.renderItems.values()) {
      if (!item.isRendering) continue;
      // 优化：只绘制在屏幕内的弹幕
      if (item.x + item.width < 0 || item.x > this.width) continue;
      visibleItems.push(item);
    }

    // 如果没有可见弹幕，直接返回
    if (visibleItems.length === 0) return;

    // 显示区域控制不做 ctx.clip() 裁切：区域变化时引擎已在 updateConfig
    // 物理移除超界在飞弹幕并重建区域内轨道，此处无需每帧裁剪，
    // 弹幕真实只存在于新区域内，无隐藏绘制开销（与 DOM 引擎同一语义）

    // 每帧只贴精灵位图（drawImage），不再逐条 fillText，字体已在精灵里栅格化好了
    for (const item of visibleItems) {
      this.drawItem(item);
    }

    // 应用防挡遮罩
    this.applyMask();
  }

  /**
   * 应用防挡遮罩
   */
  private applyMask(): void {
    if (
      !this.maskImage ||
      !this.maskCanvas ||
      !this.config.maskConfig?.enabled
    ) {
      return;
    }

    // 使用 destination-in 模式：只保留 maskCanvas 中不透明（黑色）区域的弹幕
    // maskCanvas: 黑色=显示弹幕, 透明=不显示弹幕
    // destination-in: 保留源（已绘制弹幕）和目标（maskCanvas）都重叠的不透明区域
    // 注意：maskCanvas 是设备像素尺寸，主 ctx 已 scale(dpr)，这里必须显式指定
    // 逻辑尺寸 this.width/this.height，否则会被当成 dpr² 放大、遮罩和视频错位。
    this.ctx.globalCompositeOperation = "destination-in";
    this.ctx.drawImage(this.maskCanvas, 0, 0, this.width, this.height);
    this.ctx.globalCompositeOperation = "source-over";
  }

  /**
   * 绘制单个弹幕
   * @param item 弹幕项
   */
  /**
   * 获取（或创建）弹幕文本的「精灵」canvas：把文字预渲染成位图。
   * 每帧用 drawImage 贴图代替 fillText，避免重复的字体栅格化（fillText 最贵的部分）。
   */
  private getTextSprite(item: DanmakuRenderItem): HTMLCanvasElement {
    const isSelf = item.uid === 1 || item.uid === "1";
    // 有效字号 = 弹幕自带字号（或基础字号）× 用户缩放 × 屏幕自适应因子
    const size = this.getEffectiveFontSize(item.fontSize);
    const color = item.color || "#ffffff";
    const key = `${item.text}|${size.toFixed(1)}|${color}|${isSelf}`;

    const cached = this.textSpriteCache.get(key);
    if (cached) return cached;

    const padding = isSelf ? 4 : 0;
    const halfPad = isSelf ? 2 : 0;
    const spriteW = Math.max(1, Math.ceil(item.width) + padding * 2);
    const spriteH = Math.max(1, Math.ceil(item.height) + halfPad * 2);

    const sprite = document.createElement("canvas");
    sprite.width = spriteW;
    sprite.height = spriteH;
    const ctx = sprite.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "middle";
      ctx.font = `bold ${size}px ${this.config.fontFamily}`;
      if (isSelf) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(0, 0, spriteW, spriteH);
        ctx.strokeRect(1, 1, spriteW - 2, spriteH - 2);
      }
      ctx.fillStyle = color;
      ctx.fillText(item.text, padding, spriteH / 2);
    }

    // 容量控制：超过上限清掉前一半，避免弹幕文本很多时内存膨胀
    if (this.textSpriteCache.size >= this.textSpriteCacheMax) {
      let removed = 0;
      for (const k of this.textSpriteCache.keys()) {
        this.textSpriteCache.delete(k);
        if (++removed >= this.textSpriteCacheMax / 2) break;
      }
    }
    this.textSpriteCache.set(key, sprite);
    return sprite;
  }

  /**
   * 绘制单个弹幕（贴精灵位图，替代逐帧 fillText）
   */
  private drawItem(item: DanmakuRenderItem): void {
    const isSelf = item.uid === 1 || item.uid === "1";
    const padding = isSelf ? 4 : 0;
    const halfPad = isSelf ? 2 : 0;
    const sprite = this.getTextSprite(item);
    // 精灵左上角对齐到弹幕项左上角（本人弹幕已包含边框 padding）
    this.ctx.drawImage(sprite, item.x - padding, item.y - halfPad);
  }

  /**
   * 切换屏幕模式
   * @param _mode 屏幕模式（已废弃，保留参数用于兼容性）
   */
  switchScreenMode(_mode: ScreenMode): void {
    // 尺寸由 DanmakuManager 在 fullscreen layout 稳定后统一提交，避免重复 resize。
  }

  /**
   * 更新配置
   * @param config 配置
   */
  updateConfig(config: Partial<CanvasEngineConfig>): void {
    const oldArea = this.config.area;

    Object.assign(this.config, config);
    this.textMeasureCache.clear();
    this.textSpriteCache.clear();

    // 区域档位变化（不使用 ctx.clip() 裁切，直接物理移除超界弹幕）：
    // 移除在飞弹幕中超出新区域底界的项（removeDanmaku 回收渲染项、
    // 释放轨道占用），观感即「区域缩小后超界弹幕立即消失」，
    // 弹幕真实只存在于新区域内，draw() 无需每帧裁剪；
    // 再重新初始化轨道（回填剩余在飞占用），新弹幕只分配区域内轨道
    if (config.area !== undefined && config.area !== oldArea) {
      const areaValue = Math.min(1, Math.max(0.05, config.area));
      const areaBottom = this.height * areaValue;
      for (const item of Array.from(this.renderItems.values())) {
        if (item.isRendering && item.y + item.height > areaBottom) {
          this.removeDanmaku(item.renderId);
        }
      }
      const inFlight = Array.from(this.renderItems.values()).filter(
        (item) => item.isRendering,
      );
      this.trackManager.initTracks(this.width, this.height, config.area, inFlight);
    }

    // 字号相关配置变化（用户字号缩放 / 屏幕自适应因子 / 自动缩放开关）时，
    // 轨道高度必须随有效字号重建，否则文本盒超高导致相邻轨道弹幕重叠
    if (
      config.fontSizeScale !== undefined ||
      config.screenScale !== undefined ||
      config.autoScale !== undefined
    ) {
      this.syncTrackMetrics();
    }

    // 如果防挡配置变化，更新遮罩
    if (config.maskConfig !== undefined) {
      if (config.maskConfig.enabled && config.maskConfig.maskImage) {
        if (config.maskConfig.maskImageElement) {
          this.maskImage = config.maskConfig.maskImageElement;
          this.createMaskCanvas();
        } else if (config.maskConfig.maskImage !== this.maskImage?.src) {
          this.loadMaskImage(config.maskConfig.maskImage);
        } else {
          this.updateMaskCanvas();
        }
      } else {
        this.maskImage = null;
        this.maskCanvas = null;
        this.maskCtx = null;
      }
    }
  }

  /**
   * 设置防挡遮罩
   * @param config 防挡遮罩配置
   */
  setMaskConfig(config: DanmakuMaskConfig): void {
    // 清理旧的定时器
    if (this.maskUpdateTimer) {
      cancelRaf(this.maskUpdateTimer);
      this.maskUpdateTimer = null;
    }

    this.config.maskConfig = config;

    if (config.enabled) {
      // 如果提供了遮罩获取函数，启动定时更新
      if (config.maskLoader) {
        this.startMaskAutoUpdate(config);
      } else if (config.maskImage) {
        // 使用静态遮罩图片
        if (config.maskImageElement) {
          this.maskImage = config.maskImageElement;
          this.createMaskCanvas();
        } else {
          this.loadMaskImage(config.maskImage);
        }
      }
    } else {
      this.maskImage = null;
      this.maskCanvas = null;
      this.maskCtx = null;
    }
  }

  /**
   * 清除当前防挡遮罩（弹幕恢复全部显示）
   */
  private clearMask(): void {
    this.maskImage = null;
    this.maskCanvas = null;
    this.maskCtx = null;
    this.maskTempCanvas = null;
    this.maskTempCtx = null;
    this.maskDrawParams = null;
  }

  /**
   * 启动遮罩自动更新
   */
  private startMaskAutoUpdate(config: DanmakuMaskConfig): void {
    const updateInterval = config.updateInterval || 1000;
    let lastTimeKey = -1;

    const updateMask = async () => {
      if (!config.maskLoader) {
        return;
      }

      // 通过回调获取当前视频时间
      const currentTime = config.getCurrentTime ? config.getCurrentTime() : 0;

      // 只有视频暂停（时间基本没变）才跳过，播放中按 updateInterval 采样。
      // 之前用 Math.floor(currentTime) 按「秒」去重，把采样率卡死在 1 次/秒。
      if (Math.abs(currentTime - lastTimeKey) < 0.01) {
        // 继续下一次更新
        if (config.enabled) {
          this.maskUpdateTimer = rafTimeout(updateMask, updateInterval);
        }
        return;
      }

      lastTimeKey = currentTime;

      try {
        const result = await config.maskLoader(currentTime);

        // 返回 null 表示该时间没有遮罩：保持现状，继续下一轮
        if (result === null) {
          // no-op
        } else if (result.clearMask) {
          // 明确要求清除遮罩（例如该帧没有人，不应用 mask CSS）
          this.clearMask();
        } else if (result.maskImageElement) {
          this.maskImage = result.maskImageElement;
          // 保存原始尺寸
          this.maskOriginalWidth =
            result.originalWidth ||
            result.maskImageElement.naturalWidth ||
            result.maskImageElement.width;
          this.maskOriginalHeight =
            result.originalHeight ||
            result.maskImageElement.naturalHeight ||
            result.maskImageElement.height;
          this.createMaskCanvas();
        } else if (result.maskImage) {
          this.loadMaskImage(
            result.maskImage,
            result.originalWidth,
            result.originalHeight,
          );
        }
      } catch (error) {
        console.error(`[CanvasEngine] Mask request failed:`, error);
      }

      // 继续下一次更新
      if (config.enabled) {
        this.maskUpdateTimer = rafTimeout(updateMask, updateInterval);
      }
    };

    // 立即执行一次
    updateMask();
  }

  /**
   * 获取FPS
   */
  getFps(): number {
    return this.fps;
  }

  /**
   * 获取渲染统计
   */
  getStats(): { renderCount: number; fps: number } {
    return {
      renderCount: this.renderItems.size,
      fps: this.fps,
    };
  }

  /**
   * 设置鼠标悬停回调
   * @param callback 回调函数，参数为弹幕项和位置（悬停时为数据，离开时为空）
   */
  setOnDanmakuHover(
    callback: (
      danmaku: DanmakuRenderItem | null,
      position: { x: number; y: number } | null,
    ) => void,
  ): void {
    this.onDanmakuHover = callback;
  }

  /**
   * 绑定鼠标事件
   */
  private bindMouseEvents(): void {
    // 当前悬停的弹幕
    let hoveredItem: DanmakuRenderItem | null = null;
    // 自动恢复定时器
    let autoResumeTimer: { id: number } | null = null;
    let lastMouseMoveTime = 0;

    this.canvas.addEventListener("mousemove", (e) => {
      const now = performance.now();
      if (now - lastMouseMoveTime < 50) return;
      lastMouseMoveTime = now;
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 查找鼠标下的弹幕
      let foundItem: DanmakuRenderItem | null = null;

      for (const item of this.renderItems.values()) {
        if (!item.isRendering) continue;

        // 计算弹幕当前位置
        const itemLeft = item.x;
        const itemRight = item.x + item.width;
        const itemTop = item.y;
        const itemBottom = item.y + item.height;

        // 检查鼠标是否在弹幕范围内
        if (
          mouseX >= itemLeft &&
          mouseX <= itemRight &&
          mouseY >= itemTop &&
          mouseY <= itemBottom
        ) {
          foundItem = item;
          break;
        }
      }

      if (foundItem !== hoveredItem) {
        // 清除之前的定时器
        if (autoResumeTimer) {
          cancelRaf(autoResumeTimer);
          autoResumeTimer = null;
        }

        // 恢复之前悬停的弹幕
        if (hoveredItem) {
          this.pausedItems.delete(hoveredItem.renderId);
        }

        hoveredItem = foundItem;

        if (hoveredItem) {
          // 暂停当前悬停的弹幕
          this.pausedItems.add(hoveredItem.renderId);

          // 计算底部中间位置
          const position = {
            x: hoveredItem.x + hoveredItem.width / 2,
            y: hoveredItem.y + hoveredItem.height,
          };

          // 触发回调
          this.onDanmakuHover?.(hoveredItem, position);

          // 3秒后自动恢复
          autoResumeTimer = rafTimeout(() => {
            if (hoveredItem) {
              this.pausedItems.delete(hoveredItem.renderId);
            }
            hoveredItem = null;
            this.onDanmakuHover?.(null, null);
          }, 3000);
        } else {
          this.onDanmakuHover?.(null, null);
        }
      }
    });

    this.canvas.addEventListener("mouseleave", () => {
      // 清除自动恢复定时器
      if (autoResumeTimer) {
        cancelRaf(autoResumeTimer);
        autoResumeTimer = null;
      }

      if (hoveredItem) {
        this.pausedItems.delete(hoveredItem.renderId);
      }
      hoveredItem = null;
      this.onDanmakuHover?.(null, null);
    });
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    this.stop();
    this.clear();
    this.canvas.remove();
    this.resizeOverlay?.remove();
    this.resizeOverlay = null;
    this.textMeasureCache.clear();
    this.textSpriteCache.clear();
  }
}
