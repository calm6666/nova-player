/**
 * 高性能弹幕系统 - DOM渲染引擎
 * 使用CSS3动画渲染弹幕，适合中少量弹幕场景
 */

import {
  DanmakuType,
  ScreenMode,
  DanmakuSpeed,
  DanmakuArea,
  type DanmakuItem,
  type DanmakuRenderItem,
  type DanmakuFilter,
  type DanmakuMaskConfig,
} from "./types";
import { DOMElementPool, DanmakuItemPool } from "./objectPool";
import { TrackManager } from "./trackManager";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import { calculateScale, calculateTrackHeight } from "./scaleHelper";

/** DOM引擎配置 */
interface DOMEngineConfig {
  /** 字体 */
  fontFamily: string;
  /** 基础字体大小 */
  baseFontSize: number;
  /** 字体大小缩放 */
  fontSizeScale: number;
  /** 屏幕自适应因子（resize 时按容器宽度计算，与用户字号缩放彻底分离） */
  screenScale: number;
  /** 透明度 */
  opacity: number;
  /** 速度档位 */
  speed: DanmakuSpeed;
  /** 速度倍率（连续值，优先于 speed 档位查表） */
  speedMultiplier?: number;
  /** 区域占比（0-1 连续值，兼容 DanmakuArea 档位枚举值） */
  area: number;
  /** 是否使用CSS动画 */
  useCSSAnimation: boolean;
  /** 是否使用Transform */
  useTransform: boolean;
  /** 是否开启硬件加速 */
  hardwareAcceleration: boolean;
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

/**
 * 点赞图标 SVG（B 站点赞手势，参考 DOM 提取）
 * 常驻插入每条弹幕元素内（absolute + opacity:0 不参与布局，DanmakuTip
 * 点赞后或后端点赞数 > 0 时经 .danmaku-x-liked 类切换为 opacity:1）
 */
const LIKED_ICON_SVG = `<svg data-pointer="none" viewBox="0 0 24 24"><path d="M4.909 8.543v15.275h-1.78a2.944 2.944 0 0 1-2.947-2.94v-9.395c0-1.624 1.32-2.94 2.948-2.94zm8.64-8.114c1.282.62 2.128 2.183 2.128 4.272q0 1.875-.468 3.842h5.655a2.955 2.955 0 0 1 2.868 3.662l-1.865 7.568a5.32 5.32 0 0 1-5.163 4.045H6.682V8.508l.132-.047c2.316-.894 3.634-3.072 3.957-6.64C10.9.396 12.256-.196 13.548.428"></path></svg>`;

export class DOMEngine {
  private container: HTMLElement;
  private danmakuLayer: HTMLElement;
  private config: DOMEngineConfig;
  private elementPool: DOMElementPool;
  private itemPool: DanmakuItemPool;
  private trackManager: TrackManager;

  // 渲染状态
  private renderItems: Map<string, DanmakuRenderItem> = new Map();
  private isPlaying = false;
  private isPaused = false; // 视频暂停状态
  private animationId: number | null = null;
  private lastFrameTime = 0;

  // 尺寸
  private width = 0;
  private height = 0;

  // 鼠标悬停回调
  private onDanmakuHover:
    | ((
        danmaku: DanmakuRenderItem | null,
        position: { x: number; y: number } | null,
      ) => void)
    | null = null;

  // 防挡遮罩
  private maskImage: HTMLImageElement | null = null;
  // 遮罩原始宽高（= 视频真实宽高比，用于计算 letterbox 黑边位置）
  private maskOriginalWidth = 0;
  private maskOriginalHeight = 0;
  private maskUpdateTimer: { id: number } | null = null;

  // 缓存遮罩计算参数
  private lastMaskParams: {
    containerWidth: number;
    containerHeight: number;
    videoRatio: number;
    gradient1: string;
    gradient2: string;
  } | null = null;

  constructor(
    container: HTMLElement,
    elementPool: DOMElementPool,
    itemPool: DanmakuItemPool,
    trackManager: TrackManager,
    config: Partial<DOMEngineConfig> = {},
  ) {
    this.container = container;
    this.elementPool = elementPool;
    this.itemPool = itemPool;
    this.trackManager = trackManager;
    this.config = {
      fontFamily: "Microsoft YaHei, PingFang SC, sans-serif",
      baseFontSize: 18,
      fontSizeScale: 1,
      screenScale: 1,
      opacity: 1,
      speed: DanmakuSpeed.NORMAL,
      area: DanmakuArea.FULL,
      useCSSAnimation: true,
      useTransform: true,
      hardwareAcceleration: true,
      filter: {},
      autoScale: true,
      ...config,
    };

    // 创建弹幕层（样式由 danmaku.scss 的 .danmaku-layer 提供，不在 TS 内联）
    this.danmakuLayer = document.createElement("div");
    this.danmakuLayer.className = "danmaku-layer dom-engine";

    container.appendChild(this.danmakuLayer);

    // 应用初始显示区域裁剪（构造即生效，避免初始区域非全屏时首帧闪现全屏弹幕）
    this.applyAreaClip();

    // 绑定鼠标事件
    this.bindMouseEvents();

    // 初始化防挡遮罩
    if (this.config.maskConfig?.enabled && this.config.maskConfig.maskImage) {
      this.loadMaskImage(this.config.maskConfig.maskImage);
    }

    this.resize();
  }

  /**
   * 将显示区域占比写入弹幕层 CSS 变量（底部裁剪百分比）
   *
   * .danmaku-layer 消费 --area-clip 做 clip-path 硬裁剪（danmaku.scss），
   * 保证区域变化时「在飞弹幕」超出区域的部分立即不可见——仅靠
   * initTracks 重建轨道只约束新弹幕，在飞弹幕仍按原 y 继续飞行，
   * 用户侧表现为「设置 50% 后弹幕仍然满屏」（本方法即该问题的修复）。
   * 裁剪为百分比，容器 resize 时无需重写。
   */
  private applyAreaClip(): void {
    const area = Math.min(1, Math.max(0.05, this.config.area));
    this.danmakuLayer.style.setProperty(
      "--area-clip",
      `${((1 - area) * 100).toFixed(2)}%`,
    );
  }

  /**
   * 加载防挡遮罩图片
   * @param url 图片URL
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
      this.maskOriginalWidth = originalWidth || img.naturalWidth || img.width;
      this.maskOriginalHeight =
        originalHeight || img.naturalHeight || img.height;
      // 尺寸/比例可能变化，让 applyMask 重新计算
      this.lastMaskParams = null;
      this.applyMask();
    };
    img.onerror = () => {
      // 静默处理错误
    };
    img.src = url;
  }

  /**
   * 应用防挡遮罩
   * 使用 CSS mask-size: contain 和 mask-position: center 实现自适应居中
   * 遮罩图片比例应与视频比例一致
   *
   * 蒙层图片格式：
   * - 黑色 = 背景，显示弹幕
   * - 透明/镂空 = 人物，不显示弹幕
   *
   * 哔哩哔哩实现方案：
   * 使用多层 mask 组合，参考 B站真实代码：
   * - 第1层：左边渐变（黑色到透明）
   * - 第2层：右边渐变（透明到黑色）
   * - 第3层：蒙层图片
   * - composite: source-over：多层叠加
   *
   * 结果：
   * - 蒙层图片黑色区域：显示弹幕
   * - 蒙层图片透明区域：不显示弹幕
   * - 蒙层图片外区域（两边/上下）：显示弹幕
   */
  private applyMask(): void {
    if (!this.maskImage || !this.config.maskConfig?.enabled) {
      this.danmakuLayer.style.maskImage = "";
      this.danmakuLayer.style.webkitMaskImage = "";
      return;
    }

    // 用缓存的 width/height（resize 时已更新），避免每次 mask 更新都读
    // clientWidth/clientHeight 触发「Forced reflow」性能告警。
    let containerWidth = this.width;
    let containerHeight = this.height;
    if (containerWidth === 0 || containerHeight === 0) {
      containerWidth = this.container.clientWidth;
      containerHeight = this.container.clientHeight;
    }

    // 视频真实宽高比：优先用遮罩原始尺寸（= 视频帧宽高比），其次 videoRect，最后 16:9。
    // 之前只认 videoRect，AI 分割没传 videoRect 就默认 16:9，导致非 16:9 视频的
    // letterbox 黑边没被渐变覆盖、黑边区域弹幕不显示。
    const videoRatio =
      this.maskOriginalWidth > 0 && this.maskOriginalHeight > 0
        ? this.maskOriginalWidth / this.maskOriginalHeight
        : this.config.maskConfig?.videoRect?.width &&
            this.config.maskConfig?.videoRect?.height
          ? this.config.maskConfig.videoRect.width /
            this.config.maskConfig.videoRect.height
          : 16 / 9;

    // 检查缓存：如果参数没有变化，直接应用蒙层图片
    if (
      this.lastMaskParams &&
      this.lastMaskParams.containerWidth === containerWidth &&
      this.lastMaskParams.containerHeight === containerHeight &&
      this.lastMaskParams.videoRatio === videoRatio
    ) {
      // 只更新蒙层图片 URL
      const maskLayer = `url(${this.maskImage.src})`;
      this.danmakuLayer.style.maskImage = `${this.lastMaskParams.gradient1}, ${this.lastMaskParams.gradient2}, ${maskLayer}`;
      this.danmakuLayer.style.webkitMaskImage = `${this.lastMaskParams.gradient1}, ${this.lastMaskParams.gradient2}, ${maskLayer}`;
      return;
    }

    // 计算容器比例
    const containerRatio = containerWidth / containerHeight;

    let gradient1: string;
    let gradient2: string;

    // 渐变扩展量（百分比），仅在有黑边时用于让渐变略侵入视频区，避免 1px 缝隙
    const gradientExtend = 0.5;
    // 无黑边时用全透明层（不填充）
    const transparentGradient = "linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0))";

    if (containerRatio > videoRatio) {
      // 容器比视频宽 → 左右留白（黑边在左右）
      const scaledWidth = containerHeight * videoRatio;
      const offsetX = (containerWidth - scaledWidth) / 2;

      if (offsetX <= 1) {
        // 视频左右基本抵满，无需填充（否则渐变会侵入视频区产生细线）
        gradient1 = transparentGradient;
        gradient2 = transparentGradient;
      } else {
        const leftPercent = Math.max(
          0,
          (offsetX / containerWidth) * 100 + gradientExtend,
        );
        const rightStartPercent = Math.min(
          100,
          ((offsetX + scaledWidth) / containerWidth) * 100 - gradientExtend,
        );
        gradient1 = `linear-gradient(to right, rgb(0,0,0), rgb(0,0,0) ${leftPercent.toFixed(2)}%, rgba(0,0,0,0) ${leftPercent.toFixed(2)}%)`;
        gradient2 = `linear-gradient(to right, rgba(0,0,0,0), rgba(0,0,0,0) ${rightStartPercent.toFixed(2)}%, rgb(0,0,0) ${rightStartPercent.toFixed(2)}%)`;
      }
    } else {
      // 容器比视频窄 → 上下留白（黑边在上下）
      const scaledHeight = containerWidth / videoRatio;
      const offsetY = (containerHeight - scaledHeight) / 2;

      if (offsetY <= 1) {
        // 视频上下基本抵满，无需填充（否则渐变会侵入视频区产生细线）
        gradient1 = transparentGradient;
        gradient2 = transparentGradient;
      } else {
        const topPercent = Math.max(
          0,
          (offsetY / containerHeight) * 100 + gradientExtend,
        );
        const bottomStartPercent = Math.min(
          100,
          ((offsetY + scaledHeight) / containerHeight) * 100 - gradientExtend,
        );
        gradient1 = `linear-gradient(to bottom, rgb(0,0,0), rgb(0,0,0) ${topPercent.toFixed(2)}%, rgba(0,0,0,0) ${topPercent.toFixed(2)}%)`;
        gradient2 = `linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0) ${bottomStartPercent.toFixed(2)}%, rgb(0,0,0) ${bottomStartPercent.toFixed(2)}%)`;
      }
    }

    // 缓存计算结果
    this.lastMaskParams = {
      containerWidth,
      containerHeight,
      videoRatio,
      gradient1,
      gradient2,
    };

    // 第3层：蒙层图片（contain 模式居中）
    const maskLayer = `url(${this.maskImage.src})`;

    this.danmakuLayer.style.maskImage = `${gradient1}, ${gradient2}, ${maskLayer}`;
    this.danmakuLayer.style.webkitMaskImage = `${gradient1}, ${gradient2}, ${maskLayer}`;

    // 渐变层覆盖整个容器，蒙层图片居中 contain
    this.danmakuLayer.style.maskSize = "100% 100%, 100% 100%, contain";
    this.danmakuLayer.style.webkitMaskSize = "100% 100%, 100% 100%, contain";

    // 渐变层从左上角开始，蒙层图片居中
    this.danmakuLayer.style.maskPosition = "0 0, 0 0, center";
    this.danmakuLayer.style.webkitMaskPosition = "0 0, 0 0, center";

    this.danmakuLayer.style.maskRepeat = "no-repeat, no-repeat, no-repeat";
    this.danmakuLayer.style.webkitMaskRepeat =
      "no-repeat, no-repeat, no-repeat";

    // 使用 source-over 让多层叠加
    // 只要有任意一层是不透明的（黑色），就显示弹幕
    this.danmakuLayer.style.maskComposite = "source-over, source-over";
    this.danmakuLayer.style.webkitMaskComposite = "source-over, source-over";
  }

  /**
   * 计算当前有效字号（基础字号 × 用户缩放 × 屏幕自适应因子）
   *
   * 屏幕自适应因子（screenScale）与用户字号缩放（fontSizeScale）彻底分离：
   * - screenScale 由 resize 按容器宽度计算，autoScale 关闭时不乘入
   * - fontSizeScale 仅承载用户字号设置，不再被 resize 覆盖
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
   * 并预留呼吸空间），否则字号放大后相邻轨道弹幕视觉重叠、间距过近。
   * 字号缩放 / 屏幕自适应开关 / resize 时均须调用。
   */
  private syncTrackMetrics(): void {
    if (this.width <= 0 || this.height <= 0) return;
    const fontPx = this.getEffectiveFontSize();
    this.trackManager.updateConfig({
      trackHeight: calculateTrackHeight(fontPx),
    });
    // 重建轨道时回填在飞弹幕占用（详见 TrackManager.initTracks 注释）：
    // 不回填则字号缩放 / resize 后全部占用蒸发，新弹幕可叠进在飞弹幕所在 y
    const inFlight = Array.from(this.renderItems.values()).filter(
      (item) => item.isRendering,
    );
    this.trackManager.initTracks(this.width, this.height, this.config.area, inFlight);
  }

  /**
   * 调整尺寸
   */
  resize(): void {
    const rect = this.container.getBoundingClientRect();

    // 如果尺寸没有变化，跳过
    if (rect.width === this.width && rect.height === this.height) {
      return;
    }

    const oldHeight = this.height;
    // 迁移前的有效字号因子（用于检测屏幕缩放是否改变了在飞弹幕的字号）
    const oldFontFactor =
      this.config.fontSizeScale *
      (this.config.autoScale ? this.config.screenScale : 1);

    this.width = rect.width;
    this.height = rect.height;

    // 屏幕自适应因子：无条件按容器宽度计算并更新。
    // autoScale 仅在 getEffectiveFontSize 中控制是否乘入，
    // 因此勾选开关对新弹幕即时生效，也不会反向覆盖用户字号
    // （旧实现的 updateConfig({ fontSizeScale: scale }) 同时承载两个语义，
    //  与 setFontSizeScale 互相覆盖是「弹幕不缩放」的根因）。
    this.config.screenScale = calculateScale(this.width);

    // 同步轨道高度并重建轨道（保持当前区域档位）
    this.syncTrackMetrics();

    // 尺寸变化时清除遮罩缓存，重新计算渐变
    if (this.lastMaskParams) {
      this.lastMaskParams = null;
      this.applyMask();
    }

    // 字号因子是否变化（autoScale 关闭时 screenScale 更新不影响字号）
    const newFontFactor =
      this.config.fontSizeScale *
      (this.config.autoScale ? this.config.screenScale : 1);
    const fontChanged = newFontFactor !== oldFontFactor;
    const heightScale = oldHeight > 0 ? this.height / oldHeight : 1;

    // 更新已有弹幕：滚动动画迁移距离 + 字号/垂直位置随屏幕缩放迁移，
    // 同时保持当前播放进度，避免全屏时跳回起点。
    this.migrateInFlightItems(heightScale, fontChanged);

    // CSS 动画无需重建节点，保持 compositor 层连续运行。
  }

  /**
   * 迁移/刷新在飞弹幕（resize 与字号类配置变化共用同一套逻辑）
   *
   * - fontChanged 为 true 时重写 --fontSize 并重测文本盒宽高；
   *   滚动弹幕还需按新宽度重写出口距离（--offset/--translateX），
   *   否则字号变化后弹幕会在错误位置结束动画
   * - heightScale 为容器高度变化比例，在飞弹幕垂直位置等比迁移
   *   （字号类配置变化场景传 1，位置保持不变）
   * - 滚动动画进度天然保持：迁移只改 CSS 变量、不触碰动画对象，
   *   keyframes 中的变量是活的，动画自动按新几何继续插值；
   *   CSS 类驱动的暂停态（danmaku-x-paused）不受任何干扰
   */
  private migrateInFlightItems(
    heightScale: number,
    fontChanged: boolean,
  ): void {
    for (const item of this.renderItems.values()) {
      if (!item.element) continue;

      if (item.type === DanmakuType.SCROLL) {
        const animation = item.element.getAnimations()[0];
        const duration = item.duration;
        const current =
          typeof animation?.currentTime === "number"
            ? animation.currentTime
            : 0;
        const progress =
          duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;

        // 字号变化（屏幕缩放 / 用户字号 / 自动缩放开关）：更新 --fontSize 并重测文本盒宽高
        if (fontChanged) {
          const fontSize = this.getEffectiveFontSize(item.fontSize);
          item.element.style.setProperty("--fontSize", `${fontSize}px`);
          const itemRect = item.element.getBoundingClientRect();
          item.width = itemRect.width;
          item.height = itemRect.height;
        }
        const distance = this.width + item.width;
        item.element.style.setProperty("--offset", `${this.width}px`);
        item.element.style.setProperty("--translateX", `-${distance}px`);
        item.element.style.setProperty("--duration", `${duration / 1000}s`);
        // 垂直位置随容器高度等比迁移，保持相对位置
        item.y *= heightScale;
        item.element.style.setProperty("--top", `${item.y}px`);
        // 迁移全程禁止调用 Web Animations 的 pause()/play()：
        // 引擎的暂停/恢复是类驱动（danmakuLayer 挂 danmaku-x-paused，
        // CSS animation-play-state:paused !important，恢复时仅移除类）。
        // 若在此调用 animation.pause()，会在 CSS 暂停之上叠加一层 API 级
        // 暂停，且该暂停不随类的移除而解除——视频恢复播放后在飞弹幕将
        // 永久冻结（「缩放后弹幕不动了」的根因）。keyframes 中的 CSS 变量
        // 是活的，--offset/--translateX 更新后动画自动按新几何继续插值，
        // 无需任何 WAAPI 干预
        item.x = this.width - distance * progress;
        item.createTime = performance.now() - progress * duration;
      } else {
        // 固定弹幕（顶部/底部）：水平居中由 CSS 类承担，迁移字号与垂直位置
        if (fontChanged) {
          const fontSize = this.getEffectiveFontSize(item.fontSize);
          item.element.style.setProperty("--fontSize", `${fontSize}px`);
          const itemRect = item.element.getBoundingClientRect();
          item.width = itemRect.width;
          item.height = itemRect.height;
        }
        item.y *= heightScale;
        item.element.style.setProperty("--translateY", `${item.y}px`);
      }
    }
  }

  /**
   * 添加弹幕
   * @param item 弹幕数据
   * @param currentTime 当前时间（performance.now()）
   * @param videoTime 视频当前时间（秒），用于快进后恢复显示
   * @returns 是否成功添加
   */
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

  addDanmaku(
    item: DanmakuItem,
    currentTime: number,
    videoTime?: number,
  ): boolean {
    // 检查是否被过滤
    if (this.isFiltered(item)) {
      return false;
    }

    // 获取元素
    const element = this.elementPool.acquire();

    // 组装内容：常驻点赞图标（absolute 定位 + opacity:0，不参与布局与
    // 尺寸测量，DanmakuTip 点赞后经 .danmaku-x-liked 类淡入，与后端
    // 点赞数 > 0 的初始态同一机制）+ 弹幕文本节点；
    // replaceChildren 先清空池化复用元素的旧内容（图标 + 文本），池回收
    // 侧 release 也会以 textContent='' 兜底清理
    element.replaceChildren();
    const likedIcon = document.createElement("span");
    likedIcon.className = "danmaku-x-liked-icon";
    likedIcon.innerHTML = LIKED_ICON_SVG;
    element.append(likedIcon, document.createTextNode(item.text));

    // 计算字体大小（含用户缩放与屏幕自适应因子）
    const fontSize = this.getEffectiveFontSize(item.fontSize);

    // 设置样式：外观统一由 danmaku.scss 的类体系提供（.danmaku-x-dm 消费
    // CSS 变量），引擎只写类名与变量，不在 TS 内联任何 CSS；
    // 滚动动画变量由 applyCSSAnimation、固定弹幕变量由 applyFixedCSSAnimation 后续写入
    const color = item.color || "#ffffff";
    // 判断是否为自己发布的弹幕（uid为1表示本人），追加 danmaku-x-self 白框高亮
    const isSelf = item.uid === 1 || item.uid === "1";
    // 后端返回的点赞数 > 0：弹幕文字前置点亮点赞图标（danmaku-x-liked）
    const isLiked = (item.like ?? 0) > 0;
    element.className = [
      "danmaku-x-dm",
      "danmaku-x-show",
      isSelf ? "danmaku-x-self" : "",
      isLiked ? "danmaku-x-liked" : "",
    ]
      .filter(Boolean)
      .join(" ");
    element.style.setProperty("--fontSize", `${fontSize}px`);
    element.style.setProperty("--color", color);
    element.style.setProperty("--opacity", `${this.config.opacity}`);
    element.style.setProperty("--fontFamily", this.config.fontFamily);
    element.style.setProperty("--textShadow", "1px 1px 2px rgba(0, 0, 0, 0.8)");

    // 添加到DOM以测量尺寸
    this.danmakuLayer.appendChild(element);
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // 计算动画持续时间
    // 滚动弹幕：根据距离和速度计算，确保完全移出屏幕
    const distance = item.type === DanmakuType.SCROLL ? this.width + width : 0;
    const baseSpeed = 150; // 基础速度：150px/秒
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
      element,
      isRendering: true,
    });

    if (!renderItem) {
      this.elementPool.release(element);
      element.remove();
      return false;
    }

    // 获取可用轨道
    const trackIndex = this.trackManager.getAvailableTrack(
      renderItem,
      currentTime,
    );
    if (trackIndex === -1) {
      this.elementPool.release(element);
      element.remove();
      this.itemPool.release(renderItem.renderId);
      return false;
    }

    // 添加到轨道（这会设置 renderItem.y）
    this.trackManager.addToTrack(trackIndex, renderItem);

    // 计算弹幕已经经过的时间（用于快进后恢复显示）
    let elapsedTime = 0;
    if (videoTime !== undefined && item.type === DanmakuType.SCROLL) {
      elapsedTime = Math.max(0, (videoTime - item.time) * 1000); // 转换为毫秒
      if (elapsedTime > 0 && elapsedTime < duration) {
        // 快进后的弹幕，调整 createTime 以反映已经经过的时间
        renderItem.createTime = currentTime - elapsedTime;
      }
    }

    // 设置初始位置
    if (item.type === DanmakuType.SCROLL) {
      // 如果有经过时间，计算当前位置；否则从右侧进入
      if (elapsedTime > 0 && elapsedTime < duration) {
        const progress = elapsedTime / duration;
        renderItem.x = this.width - distance * progress;
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
    // 注意：renderItem.y 已经在 addToTrack 中设置，不要重置为0

    // 应用固定弹幕样式（必须在CSS动画之前）
    this.applyFixedDanmakuStyle(renderItem);

    // 添加CSS动画或JS动画（二选一，不要同时用）
    if (this.config.useCSSAnimation) {
      if (item.type === DanmakuType.SCROLL) {
        // CSS动画会处理位置，不需要调用 updateElementPosition
        this.applyCSSAnimation(renderItem);
      } else {
        // 固定弹幕使用淡入淡出动画
        this.applyFixedCSSAnimation(renderItem);
      }
    } else {
      // 不使用CSS动画时，手动设置位置
      this.updateElementPosition(renderItem);
    }

    // 保存渲染项
    this.renderItems.set(renderItem.renderId, renderItem);

    return true;
  }

  /**
   * 批量添加弹幕
   * @param items 弹幕列表
   * @param currentTime 当前时间（performance.now()）
   * @param videoTime 视频当前时间（秒）
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
   * 应用CSS动画 - B站风格：使用CSS变量控制
   * @param item 弹幕项
   */
  private applyCSSAnimation(item: DanmakuRenderItem): void {
    if (!item.element) return;

    const { width, duration, y } = item;
    const distance = this.width + width;

    // 使用CSS变量控制动画，类似B站实现
    item.element.style.setProperty("--offset", `${this.width}px`);
    item.element.style.setProperty("--translateX", `-${distance}px`);
    item.element.style.setProperty("--duration", `${duration / 1000}s`);
    item.element.style.setProperty("--top", `${y}px`);

    // 添加CSS类来触发动画（danmaku.scss 的 .danmaku-x-dm.danmaku-x-roll 消费上述变量，
    // roll 关键帧做 translateX 0 → var(--translateX) 的滚动）
    item.element.classList.add("danmaku-x-roll");

    // 监听动画结束
    const onAnimationEnd = () => {
      this.removeDanmaku(item.renderId);
    };
    item.element.addEventListener("animationend", onAnimationEnd);
    item.animationEndHandler = onAnimationEnd;
  }

  /**
   * 应用固定弹幕样式
   * @param item 弹幕项
   */
  private applyFixedDanmakuStyle(item: DanmakuRenderItem): void {
    if (!item.element || item.type === DanmakuType.SCROLL) return;

    // 固定弹幕使用更深的文字阴影增强可读性（覆盖 addDanmaku 写入的基础阴影，
    // 由 danmaku.scss 的 .danmaku-x-dm 的 var(--textShadow) 消费）；
    // 与用户原版 .danmaku-x-center 固定弹幕一致，不额外加内边距
    item.element.style.setProperty(
      "--textShadow",
      "2px 2px 4px rgba(0, 0, 0, 0.9), 0 0 8px rgba(0, 0, 0, 0.8)",
    );
  }

  /**
   * 应用固定弹幕CSS动画（淡入淡出）- B站风格
   * @param item 弹幕项
   */
  private applyFixedCSSAnimation(item: DanmakuRenderItem): void {
    if (!item.element) return;

    const { duration, y } = item;

    // 使用CSS变量控制动画 - B站风格：
    // .danmaku-x-center 水平居中由 left:50% + translate(-50%) 提供，
    // 垂直位置走 --translateY（该类强制 top:0，不能写 --top）
    item.element.style.setProperty("--duration", `${duration / 1000}s`);
    item.element.style.setProperty("--translateY", `${y}px`);

    // 添加CSS类来触发动画（fixed-x-center 淡入淡出，见 danmaku.scss）
    item.element.classList.add("danmaku-x-center");

    // 监听动画结束
    const onAnimationEnd = () => {
      this.removeDanmaku(item.renderId);
    };
    item.element.addEventListener("animationend", onAnimationEnd);
    item.animationEndHandler = onAnimationEnd;
  }

  /**
   * 更新元素位置
   * @param item 弹幕项
   */
  private updateElementPosition(item: DanmakuRenderItem): void {
    if (!item.element) return;

    if (this.config.useTransform) {
      item.element.style.transform = `translate3d(${item.x}px, ${item.y}px, 0)`;
    } else {
      item.element.style.left = `${item.x}px`;
      item.element.style.top = `${item.y}px`;
    }
  }

  /**
   * 开始渲染
   */
  start(): void {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();

    // 如果不使用CSS动画，使用JS动画循环
    if (!this.config.useCSSAnimation) {
      this.renderLoop();
    }
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
   * 暂停所有弹幕动画（视频暂停时调用）
   */
  pauseAnimations(): void {
    // 设置暂停标志，停止JS动画更新
    this.isPaused = true;
    // 弹幕层加暂停类：danmaku.scss 的 .danmaku-layer.danmaku-x-paused 以
    // animation-play-state:paused!important 暂停全部子弹幕动画，
    // 与用户原版 .nova-player-row-dm-wrap.danmaku-x-paused 同一机制
    this.danmakuLayer.classList.add("danmaku-x-paused");
  }

  /**
   * 恢复所有弹幕动画（视频播放时调用）
   */
  resumeAnimations(): void {
    // 清除暂停标志，恢复JS动画更新
    this.isPaused = false;
    // 移除暂停类，CSS自动恢复所有子弹幕动画
    this.danmakuLayer.classList.remove("danmaku-x-paused");
    // 重置lastFrameTime以避免deltaTime累积导致跳变
    this.lastFrameTime = performance.now();
  }

  /**
   * 设置弹幕整体可见性
   * 通过引擎层切换 danmaku-x-hide 类实现（danmaku.scss 定义 opacity:0），
   * 与暂停机制同属类驱动的样式体系，不在 TS 内联样式
   */
  setVisible(visible: boolean): void {
    this.danmakuLayer.classList.toggle("danmaku-x-hide", !visible);
  }

  /**
   * 渲染循环 (用于JS动画)
   */
  private renderLoop = (): void => {
    if (!this.isPlaying) return;

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    // 如果视频暂停，不更新位置
    if (!this.isPaused) {
      this.update(deltaTime, currentTime);
    }

    this.animationId = requestAnimationFrame(this.renderLoop);
  };

  /**
   * 更新弹幕位置
   * @param _deltaTime 时间差（保留参数以兼容接口，当前未使用）
   * @param currentTime 当前时间
   */
  private update(_deltaTime: number, currentTime: number): void {
    const itemsToRemove: string[] = [];

    for (const [id, item] of this.renderItems) {
      if (!item.isRendering) {
        itemsToRemove.push(id);
        continue;
      }

      // 滚动弹幕更新位置（仅在不使用CSS动画时）
      if (item.type === DanmakuType.SCROLL && !this.config.useCSSAnimation) {
        const elapsedTime = currentTime - item.createTime;

        if (elapsedTime >= item.duration) {
          item.isRendering = false;
          itemsToRemove.push(id);
          continue;
        }

        const progress = elapsedTime / item.duration;
        item.x = this.width - (this.width + item.width) * progress;
        this.updateElementPosition(item);
      }
    }

    // 移除已结束的弹幕
    for (const id of itemsToRemove) {
      this.removeDanmaku(id);
    }

    // 清理轨道
    this.trackManager.cleanupFinishedItems(currentTime);
  }

  /**
   * 移除弹幕
   * @param renderId 渲染ID
   */
  removeDanmaku(renderId: string): void {
    const item = this.renderItems.get(renderId);
    if (item) {
      // 从轨道移除
      this.trackManager.removeFromTrack(item);

      // 回收元素
      if (item.element) {
        // 移除动画结束监听器
        const animationEndHandler = item.animationEndHandler;
        if (animationEndHandler) {
          item.element.removeEventListener("animationend", animationEndHandler);
        }
        this.elementPool.release(item.element);
        item.element.remove();
      }

      // 回收渲染项
      this.itemPool.release(renderId);

      // 从映射中移除
      this.renderItems.delete(renderId);
    }
  }

  /**
   * 清空弹幕
   */
  clear(): void {
    // 停止动画
    this.stop();

    // 移除所有弹幕
    for (const [id, item] of this.renderItems) {
      if (item.element) {
        this.elementPool.release(item.element);
        item.element.remove();
      }
      this.itemPool.release(id);
    }
    this.renderItems.clear();

    // 重置轨道
    this.trackManager.reset();
  }

  /**
   * 更新弹幕位置（用于小幅度seek）- B站风格：使用animation-delay调整动画进度
   * @param timeDiff 时间差（秒），正数表示快进，负数表示后退
   */
  updateDanmakuPositionsForSeek(timeDiff: number): void {
    const timeDiffSec = timeDiff; // 秒

    for (const item of this.renderItems.values()) {
      if (!item.isRendering || !item.element) continue;

      if (item.type === DanmakuType.SCROLL) {
        // 获取当前animation-delay（负值表示已经进行的时间）
        const currentDelay = parseFloat(
          item.element.style.animationDelay || "0",
        );

        // 计算新的animation-delay
        // 快进：delay变得更负（表示已经过去更多时间）
        // 后退：delay变得不那么负（表示回退时间）
        let newDelay = currentDelay - timeDiffSec;

        // 如果新的delay超出动画持续时间，移除弹幕
        if (newDelay <= -item.duration / 1000) {
          this.removeDanmaku(item.renderId);
          continue;
        }

        // 如果delay大于0，说明回退到了动画开始前，重置为0
        if (newDelay > 0) {
          newDelay = 0;
        }

        // 应用新的animation-delay（B站风格）
        item.element.style.animationDelay = `${newDelay}s`;

        // 更新createTime以保持同步
        item.createTime = performance.now() + newDelay * 1000;

        // 更新x坐标以匹配新的动画位置
        const distance = this.width + item.width;
        const progress = Math.abs(newDelay) / (item.duration / 1000);
        item.x = this.width - distance * progress;
      } else if (
        item.type === DanmakuType.TOP ||
        item.type === DanmakuType.BOTTOM
      ) {
        // 固定弹幕：同样使用animation-delay调整
        const currentDelay = parseFloat(
          item.element.style.animationDelay || "0",
        );
        const newDelay = currentDelay - timeDiffSec;

        if (newDelay <= -item.duration / 1000) {
          this.removeDanmaku(item.renderId);
        } else if (newDelay > 0) {
          item.element.style.animationDelay = "0s";
        } else {
          item.element.style.animationDelay = `${newDelay}s`;
        }
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
  updateConfig(config: Partial<DOMEngineConfig>): void {
    const oldArea = this.config.area;

    Object.assign(this.config, config);

    // 如果区域档位变化：
    // 1. 更新弹幕层裁剪变量——在飞弹幕超出区域的部分立即被裁剪不可见
    //    （仅重建轨道时在飞弹幕保持原 y 继续飞行，观感即「区域设置不生效」）
    // 2. 重新初始化轨道（回填在飞占用，防止新弹幕叠进在飞 y），
    //    新弹幕只分配到区域内的轨道
    if (config.area !== undefined && config.area !== oldArea) {
      this.applyAreaClip();
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
      // 字号类配置变化必须同步刷新在飞弹幕：重写 --fontSize、重测文本盒、
      // 滚动弹幕按新宽度重写出口距离并保持播放进度。此前只重建轨道不刷
      // 在飞弹幕，拖动「弹幕字号」滑杆或勾选「随屏幕缩放」时屏幕上已存在
      // 的弹幕纹丝不动，用户侧表现为「弹幕缩放不生效」
      this.migrateInFlightItems(1, true);
    }

    // 透明度变化时刷新已渲染弹幕元素的 --opacity 变量：
    // 新建元素在创建时读取 config.opacity（见弹幕元素构造），
    // 已上屏元素必须在此补写，否则设置面板拖动透明度只对后续弹幕生效
    if (config.opacity !== undefined) {
      for (const item of this.renderItems.values()) {
        item.element?.style.setProperty("--opacity", `${config.opacity}`);
      }
    }

    // 如果防挡配置变化，更新遮罩
    if (config.maskConfig !== undefined) {
      if (config.maskConfig.enabled && config.maskConfig.maskImage) {
        if (config.maskConfig.maskImageElement) {
          this.maskImage = config.maskConfig.maskImageElement;
          this.applyMask();
        } else if (config.maskConfig.maskImage !== this.maskImage?.src) {
          this.loadMaskImage(config.maskConfig.maskImage);
        } else {
          this.applyMask();
        }
      } else {
        this.maskImage = null;
        this.applyMask();
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
          this.applyMask();
        } else {
          this.loadMaskImage(config.maskImage);
        }
      }
    } else {
      this.maskImage = null;
      this.applyMask();
    }
  }

  /**
   * 清除当前防挡遮罩（弹幕恢复全部显示）
   */
  private clearMask(): void {
    this.maskImage = null;
    this.applyMask();
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

      // 只有视频暂停（时间基本没变）才跳过，播放中按 updateInterval 采样
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
          this.clearMask();
        } else if (result.maskImageElement) {
          this.maskImage = result.maskImageElement;
          this.applyMask();
        } else if (result.maskImage) {
          this.loadMaskImage(
            result.maskImage,
            result.originalWidth,
            result.originalHeight,
          );
        }
      } catch (error) {
        console.error(`[DOMEngine] Mask request failed:`, error);
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
   * 获取渲染统计
   */
  getStats(): {
    renderCount: number;
    poolStats: ReturnType<DOMElementPool["getStats"]>;
  } {
    return {
      renderCount: this.renderItems.size,
      poolStats: this.elementPool.getStats(),
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
   * 绑定鼠标事件（mouseover / mouseout 事件委托，对齐原版 rowdm 事件模型）
   *
   * 原版行为：逐条弹幕元素挂 mouseover / mouseout——弹幕移动到静止鼠标
   * 下方时浏览器原生触发 mouseover，无需鼠标移动；这里改为委托到弹幕层
   * 统一处理（对象池复用元素时不累积监听器）：
   * - mouseover：e.target 命中在飞弹幕元素 → 立即回调（Tip 侧立即暂停该弹幕）
   * - mouseout：离开当前悬停弹幕 → 回调 null（Tip 侧立即恢复滚动）
   * - mouseleave：鼠标离开弹幕层兜底清空
   */
  private bindMouseEvents(): void {
    // 当前悬停的弹幕
    let hoveredItem: DanmakuRenderItem | null = null;

    // 点击弹幕元素时不冒泡到播放器（避免误触播放/暂停）；
    // 委托到弹幕层统一拦截，避免对象池复用元素时逐个累积监听器
    this.danmakuLayer.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    // 悬停定位：弹幕底部中心相对弹幕容器坐标（Tip 以此为锚点展示）
    const resolvePosition = (element: HTMLElement): { x: number; y: number } => {
      const containerRect = this.container.getBoundingClientRect();
      const itemRect = element.getBoundingClientRect();
      return {
        x: itemRect.left - containerRect.left + itemRect.width / 2,
        y: itemRect.bottom - containerRect.top,
      };
    };

    this.danmakuLayer.addEventListener("mouseover", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      // 委托命中：target 即弹幕元素（弹幕元素内为纯文本，无子元素）
      let foundItem: DanmakuRenderItem | null = null;
      for (const item of this.renderItems.values()) {
        if (item.isRendering && item.element === target) {
          foundItem = item;
          break;
        }
      }
      if (!foundItem || foundItem === hoveredItem) return;
      hoveredItem = foundItem;
      const element = foundItem.element;
      if (element != null) {
        // 命中瞬间弹幕即在 Tip 侧立即暂停，位置即最终停点，锚点不漂移
        this.onDanmakuHover?.(foundItem, resolvePosition(element));
      }
    });

    this.danmakuLayer.addEventListener("mouseout", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      // 仅当离开的是当前悬停弹幕本身才解除（弹幕元素内无子元素，无需 relatedTarget 判定）
      if (hoveredItem?.element !== target) return;
      hoveredItem = null;
      this.onDanmakuHover?.(null, null);
    });

    this.danmakuLayer.addEventListener("mouseleave", () => {
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
    this.danmakuLayer.remove();
  }
}
