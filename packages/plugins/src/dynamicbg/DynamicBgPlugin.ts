/**
 * ============================================
 * 动态背景插件 (DynamicBgPlugin)
 * ============================================
 * 把视频当前帧定时绘制到一张「等比 cover 放大 + 高斯模糊」的全尺寸
 * 画布上，垫在 <video> 元素之下，再叠一层半透明遮罩压暗，形成播放器
 * 四周的氛围背景。
 *
 * 双播放器兼容（player 点播 / live-player 直播）：
 * - 只依赖公共契约：MOUNTED 事件（两端都会广播）+ video 原生事件
 *   （live 端插件总线没有 PLAY/PAUSE 等事件，原生事件两端必然存在）；
 * - DOM 插入统一用 video.parentElement.insertBefore(wrap, video)，
 *   不依赖 MOUNTED payload.container 的语义（live 端传的是弹幕层）；
 * - CORS 污染降级：跨域视频未带 CORS 头时 drawImage 抛 SecurityError，
 *   插件捕获后永久停画并清空画布，静默降级不报错刷屏。
 *
 * 使用方式：
 * import { DynamicBgPlugin } from '@lumina/plugins';
 *
 * // 点播：new VideoPlayer({ plugins: { list: [DynamicBgPlugin()] } })
 * // 直播：<nova-live-player :plugins="[DynamicBgPlugin()]">
 */

import type { Plugin, PluginOptions } from "@lumina/nova";
import type { PlayerEventBus } from "@lumina/nova";
import { PlayerEventEnum } from "@lumina/nova";
import { injectPluginStyle } from "../utils/injectStyle";
// 样式以字符串形式内联导入（Vite `?inline`），install 时运行时注入
import dynamicBgCss from "./style.scss?inline";

/** 渲染模式：realtime 实时 / framerate 按帧率 / firstframe 仅首帧 / poster 仅海报 */
export type DynamicBgMode = "realtime" | "framerate" | "firstframe" | "poster";

/** blur 半径提取：从 filter 字符串解析 px 数值（blur(50px) → 50） */
const BLUR_PX_RE = /blur\(([\d.]+)px\)/;

/** MOUNTED payload 的最小依赖面（两端广播的字段一致） */
interface MountedPayload {
  video?: HTMLVideoElement;
  container?: HTMLElement;
}

/** 插件宿主最小契约：只依赖事件总线，点播/直播宿主都满足 */
interface DynamicBgPluginHost {
  events: PlayerEventBus;
}

export interface DynamicBgPluginConfig extends PluginOptions {
  /** 插件注册名（默认 dynamicBg，需与其它插件区分时自定义） */
  id?: string;
  /** 是否禁用（默认 false，安装即生效；运行时开关用 enable()/disable()） */
  disable?: boolean;
  /** 渲染模式，默认 framerate */
  mode?: DynamicBgMode;
  /** framerate 模式的绘制帧率，默认 10（fps，模糊背景足够） */
  frameRate?: number;
  /** 模糊滤镜，默认 blur(50px)；仅 blur(px) 的半径会按分辨率缩放自动换算 */
  filter?: string;
  /** 是否叠加压暗遮罩，默认 true */
  addMask?: boolean;
  /** 遮罩颜色，默认 rgba(0,0,0,0.7) */
  maskBg?: string;
  /** 画面放大倍数（防止 blur 采样越过边缘露出透明边），默认 1.2，最小 1 */
  multiple?: number;
  /** 画布内部分辨率相对显示尺寸的缩放，默认 0.5（像素数降为 1/4），范围 0.1-1 */
  resolutionScale?: number;
  /** 视频首帧可用后额外连画的帧数（保证首屏不露底），默认 2 */
  startFrameCount?: number;
  /** 海报图地址：起播前先渲染海报作背景（可选） */
  poster?: string;
}

/** 归一化后的运行时配置（全部字段有确定值） */
interface DynamicBgResolvedConfig {
  mode: DynamicBgMode;
  frameRate: number;
  filter: string;
  addMask: boolean;
  maskBg: string;
  multiple: number;
  resolutionScale: number;
  startFrameCount: number;
  poster: string;
}

/** cover 布局几何缓存（全部为画布内部像素坐标） */
interface BgGeometry {
  /** 画布内部宽高 */
  cw: number;
  ch: number;
  /** 源宽高比 ×100 取整（0 表示未知） */
  srcPI: number;
  /** 绘制目标区域 */
  x: number;
  y: number;
  rwidth: number;
  rheight: number;
}

class DynamicBgPluginClass implements Plugin {
  readonly name: string;
  readonly version = "1.0.0";
  readonly description = "Dynamic blurred background behind the video (vod & live)";

  /** 归一化后的配置 */
  private readonly cfg: DynamicBgResolvedConfig;
  /** 调试开关（继承 PluginOptions.debug） */
  private readonly debug: boolean;

  /** 宿主事件总线（点播/直播通用） */
  private events: PlayerEventBus | null = null;
  /** 总线订阅取消函数列表 */
  private unsubscribers: Array<() => void> = [];

  /** 当前绑定的视频元素 */
  private video: HTMLVideoElement | null = null;
  /** 插入的背景容器（含 canvas 与遮罩） */
  private wrap: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  /** 当前浏览器是否支持 ctx.filter（Safari/Firefox 不支持时降级 CSS filter） */
  private supportsCtxFilter = false;
  /** 按 resolutionScale 换算后的 ctx.filter 字符串（CSS filter 路径用原始值） */
  private scaledFilter = "";
  /** CORS 污染等致命绘制错误：置位后永久停画 */
  private tainted = false;

  /** 画布尺寸观察器（尺寸变化才重算几何，替代逐帧 getBoundingClientRect） */
  private ro: ResizeObserver | null = null;
  /** 无 ResizeObserver 环境的 rect 轮询兜底：上次检查时间戳 */
  private lastRectCheck = 0;

  /** 绘制循环状态 */
  private looping = false;
  private rafId = 0;
  private timerId = 0;
  private preTime = 0;
  /** 节流间隔（ms）：realtime 模式为 0（每个 rAF 都画） */
  private readonly frameInterval: number;
  /** 间隔 ≥1s 时用 setTimeout 驱动，避免空转 rAF */
  private readonly useTimer: boolean;

  /** 几何缓存 */
  private readonly geo: BgGeometry = { cw: 0, ch: 0, srcPI: 0, x: 0, y: 0, rwidth: 0, rheight: 0 };

  /** 启用状态（enable/disable 切换） */
  private enabled = true;

  /** 初始禁用标记（config.disable，install 时决定初始启用态） */
  private readonly initiallyDisabled: boolean;

  constructor(config?: DynamicBgPluginConfig) {
    // 逐字段归一化（避免 {...DEFAULTS, ...config} 被显式 undefined 覆盖）
    const mode: DynamicBgMode = config?.mode ?? "framerate";
    const frameRate = Math.max(1, config?.frameRate ?? 10);
    // 分辨率缩放收敛到 0.1-1：过低会糊成色块，1 则退化为逐像素原版行为
    const resolutionScale = Math.min(1, Math.max(0.1, config?.resolutionScale ?? 0.5));

    this.cfg = {
      mode,
      frameRate,
      filter: config?.filter ?? "blur(50px)",
      addMask: config?.addMask ?? true,
      maskBg: config?.maskBg ?? "rgba(0, 0, 0, 0.7)",
      // 放大倍数最小为 1：cover 布局已保证铺满，倍数只用于防 blur 边缘露白
      multiple: Math.max(1, config?.multiple ?? 1.2),
      resolutionScale,
      startFrameCount: Math.max(1, config?.startFrameCount ?? 2),
      poster: config?.poster ?? "",
    };
    this.debug = config?.debug ?? false;
    this.name = config?.id ?? "dynamicBg";
    this.initiallyDisabled = config?.disable ?? false;

    // realtime 模式不节流（每个 rAF 都画），framerate 按 1000/frameRate 节流
    this.frameInterval = mode === "realtime" ? 0 : Math.max(16, Math.round(1000 / frameRate));
    // 节流间隔 ≥1s 时改用 setTimeout 驱动：低频定时场景下不受 rAF 对齐约束
    this.useTimer = mode !== "realtime" && this.frameInterval >= 1000;
  }

  install(player: Parameters<Plugin["install"]>[0]): void {
    this.enabled = !this.initiallyDisabled;
    // 运行时注入插件样式：幂等 + SSR 安全（与 danmaku/top 同构）
    injectPluginStyle("dynamicBg", dynamicBgCss);

    this.events = (player as unknown as DynamicBgPluginHost).events ?? null;

    // 订阅 MOUNTED：两端宿主都会广播，payload 携带 video 元素
    if (this.events) {
      this.unsubscribers.push(
        this.events.on(PlayerEventEnum.MOUNTED, (data): void => {
          this.handleMounted(data as MountedPayload);
        }),
      );
      // 播放器销毁时兜底清理（正常路径走 uninstall）
      this.unsubscribers.push(
        this.events.on(PlayerEventEnum.DESTROY, (): void => {
          this.teardownAll();
        }),
      );
    }

    // 页面隐藏即停画（省电），恢复可见后若在播放中自动重启循环
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
  }

  uninstall(): void {
    this.teardownAll();
  }

  /** 启用插件：恢复画布显示，若视频正在播放则重启绘制循环 */
  enable(): void {
    this.enabled = true;
    if (this.wrap) this.wrap.style.display = "";
    if (this.video && !this.video.paused) this.startLoop();
  }

  /** 禁用插件：停循环并隐藏背景 DOM（保留结构，enable 可直接恢复） */
  disable(): void {
    this.enabled = false;
    this.stopLoop();
    if (this.wrap) this.wrap.style.display = "none";
  }

  // ------------------------------------------------------------------
  // 挂载 / 拆卸
  // ------------------------------------------------------------------

  /** MOUNTED 处理：幂等；video 元素被替换（重连/重建）时重新挂载 */
  private handleMounted(data: MountedPayload | undefined): void {
    const video = data?.video;
    if (!video || !(video instanceof HTMLVideoElement) || !data.container) return;
    if (this.video === video) return;

    // 元素变化（首次挂载或替换）：先拆旧再建新
    this.teardownDom();
    this.initDom(video, data.container);
  }

  /** 创建背景三层 DOM 并插入到 video 之前（DOM 顺序即 z 序垫底） */
  private initDom(video: HTMLVideoElement, container: HTMLElement): void {
    const videoWrap = container.querySelector(".nova-player-video-wrap");
    if (!videoWrap) return;
    const parent = videoWrap.parentElement;
    if (!parent) return;
    this.video = video;

    const wrap = document.createElement("div");
    wrap.className = "nova-player-dynamic-bg";

    const canvas = document.createElement("canvas");
    canvas.className = "nova-player-dynamic-bg-canvas";
    wrap.appendChild(canvas);

    if (this.cfg.addMask) {
      const mask = document.createElement("div");
      mask.className = "nova-player-dynamic-bg-mask";
      mask.style.background = this.cfg.maskBg;
      wrap.appendChild(mask);
    }

    // 统一插入策略：插在 video 之前（兄弟节点 DOM 顺序决定层级），
    // 不依赖 MOUNTED payload.container（live 端传的是弹幕层，不可靠）
    parent.insertBefore(wrap, videoWrap);

    this.wrap = wrap;
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    this.ctx = ctx;

    if (!ctx) {
      // 极端环境拿不到 2D 上下文：整组 DOM 回收，插件保持空转
      this.teardownDom();
      return;
    }

    // 禁用态：结构保留，仅隐藏
    if (!this.enabled) {
      wrap.style.display = "none";
    }

    this.detectCanvasFilterSupport(ctx);
    this.prepareFilterStrings();

    // 尺寸观察：容器尺寸变化才重算画布与几何（热路径零 layout 读取）
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver((entries): void => {
        const entry = entries[entries.length - 1];
        if (entry) this.applyCanvasSize(entry.contentRect.width, entry.contentRect.height);
      });
      ro.observe(wrap);
      this.ro = ro;
    }

    // 跟随 video 原生事件（live 端总线没有播放状态事件，原生事件两端都有）
    for (const [event, handler] of this.videoEventHandlers) {
      video.addEventListener(event, handler);
    }

    // 海报先垫底（可选）：起播前背景不至于全黑
    if (this.cfg.poster) this.renderPoster(this.cfg.poster);

    // 若挂载时已在播放中（后安装插件 / 换源续播），直接进入循环
    if (!video.paused) this.startLoop();
  }

  /** 拆除背景 DOM：断开观察器、移除原生监听、移除节点 */
  private teardownDom(): void {
    this.ro?.disconnect();
    this.ro = null;

    if (this.video) {
      for (const [event, handler] of this.videoEventHandlers) {
        this.video.removeEventListener(event, handler);
      }
    }
    this.wrap?.remove();

    this.wrap = null;
    this.canvas = null;
    this.ctx = null;
    this.video = null;
    this.tainted = false;
    this.lastRectCheck = 0;
    this.resetGeometry();
  }

  /** 全量清理：停循环 + 注销订阅 + 移除 document 监听 + 拆 DOM */
  private teardownAll(): void {
    this.stopLoop();
    for (const unsub of this.unsubscribers.splice(0)) unsub();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.teardownDom();
    this.events = null;
  }

  // ------------------------------------------------------------------
  // video 原生事件处理（点播/直播通用）
  // ------------------------------------------------------------------

  private onVideoPlay = (): void => {
    this.startLoop();
  };

  private onVideoPause = (): void => {
    this.stopLoop();
  };

  private onVideoEmptied = (): void => {
    // 换源/清空：停循环并清掉旧画面与旧比例，等新流的 loadeddata 重建
    this.stopLoop();
    this.resetGeometry();
    const { canvas, ctx } = this;
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  private onLoadedData = (): void => {
    // 首帧可用：连画 startFrameCount 帧保证首屏不露底，再视播放状态进循环
    this.burst(this.cfg.startFrameCount);
    if (this.video && !this.video.paused) this.startLoop();
  };

  private onVideoSeeked = (): void => {
    // 暂停态拖动进度条时背景停留在旧帧，seeked 后补画一帧保持一致
    if (!this.looping && this.cfg.mode !== "poster") this.drawOnce();
  };

  private onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      // 页面不可见直接停循环（比继续空转 rAF/timer 更省）
      this.stopLoop();
    } else if (this.video && !this.video.paused) {
      this.startLoop();
    }
  };

  /**
   * video 原生事件 → 处理器映射。
   * 声明位置必须在各箭头函数字段之后（类字段按声明顺序初始化）。
   */
  private readonly videoEventHandlers: Array<readonly [string, EventListener]> = [
    ["play", this.onVideoPlay],
    ["pause", this.onVideoPause],
    ["ended", this.onVideoPause],
    ["emptied", this.onVideoEmptied],
    ["loadeddata", this.onLoadedData],
    ["seeked", this.onVideoSeeked],
  ];

  // ------------------------------------------------------------------
  // 绘制循环（rAF / timer 驱动 + 时间节流）
  // ------------------------------------------------------------------

  private startLoop(): void {
    if (this.looping || this.tainted || !this.enabled) return;
    if (this.cfg.mode === "firstframe" || this.cfg.mode === "poster") return;
    if (!this.video || this.video.paused) return;
    if (typeof document !== "undefined" && document.hidden) return;

    this.looping = true;
    this.preTime = 0; // 归零保证首帧立即绘制
    this.tick();
  }

  private stopLoop(): void {
    if (!this.looping) return;
    this.looping = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.timerId) {
      window.clearTimeout(this.timerId);
      this.timerId = 0;
    }
  }

  /** 单次循环步进：按模式/节流间隔决定是否真正绘制，再调度下一步 */
  private readonly tick = (): void => {
    if (!this.looping) return;

    const now = performance.now();
    if (this.frameInterval === 0 || now - this.preTime >= this.frameInterval) {
      this.drawOnce();
      this.preTime = now;
    }

    if (this.useTimer) {
      this.timerId = window.setTimeout(this.tick, this.frameInterval);
    } else {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  /** 起播时连画数帧（rAF 串行），保证首屏背景不露底 */
  private burst(count: number): void {
    let remaining = Math.max(1, count);
    const step = (): void => {
      this.drawOnce();
      remaining -= 1;
      if (remaining > 0) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ------------------------------------------------------------------
  // 绘制（热路径：只做一次 drawImage，几何全部来自缓存）
  // ------------------------------------------------------------------

  private drawOnce(): void {
    const video = this.video;
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!video || !canvas || !ctx || this.tainted || !this.enabled) return;
    if (!video.videoWidth || !video.videoHeight) return;

    // 无 ResizeObserver 环境：低频轮询显示尺寸兜底（500ms 一次）
    if (!this.ro) {
      const now = performance.now();
      if (now - this.lastRectCheck > 500) {
        this.lastRectCheck = now;
        const rect = this.wrap?.getBoundingClientRect();
        if (rect) this.applyCanvasSize(rect.width, rect.height);
      }
    }

    // 画面比例变化（换源/清晰度切换）时重算 cover 布局
    const srcPI = Math.round((video.videoWidth / video.videoHeight) * 100);
    if (srcPI !== this.geo.srcPI) {
      this.geo.srcPI = srcPI;
      this.computeFit();
    }
    if (!this.geo.rwidth) return;

    if (this.supportsCtxFilter) {
      ctx.filter = this.scaledFilter;
    }
    try {
      ctx.drawImage(video, this.geo.x, this.geo.y, this.geo.rwidth, this.geo.rheight);
    } catch (e) {
      // SecurityError：跨域视频未带 CORS 头，画布被污染。
      // 永久停画并清空画布，静默降级（与 xgplayer 行为一致）
      this.handleTaint(e, canvas, ctx);
    }
  }

  /** 海报渲染：起播前用静态图垫底（循环启动后会被视频帧覆盖） */
  private renderPoster(url: string): void {
    if (!url) return;
    const image = new Image();
    image.onload = (): void => {
      const canvas = this.canvas;
      const ctx = this.ctx;
      // 循环已启动（视频帧接管）或画布已拆则放弃海报绘制
      if (!canvas || !ctx || this.looping || this.tainted) return;

      // 海报比例与视频可能不同：以海报比例计算 cover 布局
      const posterPI = Math.round((image.naturalWidth / image.naturalHeight) * 100);
      if (posterPI !== this.geo.srcPI) {
        this.geo.srcPI = posterPI;
        this.computeFit();
      }
      if (this.supportsCtxFilter) {
        ctx.filter = this.scaledFilter;
      }
      try {
        ctx.drawImage(image, this.geo.x, this.geo.y, this.geo.rwidth, this.geo.rheight);
      } catch {
        // 海报跨域污染：仅放弃海报绘制并清屏，不影响后续视频帧
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    image.src = url;
  }

  private handleTaint(e: unknown, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    this.tainted = true;
    this.stopLoop();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.debug) {
      console.warn("[dynamicBg] drawImage failed (tainted canvas?), background disabled:", e);
    }
  }

  // ------------------------------------------------------------------
  // 几何计算（低频路径：只在尺寸/比例变化时执行）
  // ------------------------------------------------------------------

  /** 画布内部尺寸更新（ResizeObserver / rect 轮询触发） */
  private applyCanvasSize(width: number, height: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const scale = this.cfg.resolutionScale;
    const cw = Math.max(1, Math.round(width * scale));
    const ch = Math.max(1, Math.round(height * scale));
    if (cw === this.geo.cw && ch === this.geo.ch) return;

    this.geo.cw = cw;
    this.geo.ch = ch;
    // 重设画布尺寸会清空画布内容：只在真正变化时执行，避免逐帧清屏
    canvas.width = cw;
    canvas.height = ch;
    this.computeFit();

    // 尺寸变了立即补一帧，避免等到下一个节流点才出现空白
    if (!this.looping) this.drawOnce();
  }

  /** cover 布局：源等比放大到铺满画布，再乘 multiple 居中（防 blur 边缘露白） */
  private computeFit(): void {
    const { cw, ch, srcPI } = this.geo;
    if (!cw || !ch || !srcPI) return;

    const canvasPI = Math.round((cw / ch) * 100);
    let rwidth = cw;
    let rheight = ch;
    if (canvasPI < srcPI) {
      // 源比画布更宽：按高度撑满，宽度溢出
      rwidth = Math.round((ch * srcPI) / 100);
    } else if (canvasPI > srcPI) {
      // 源比画布更高：按宽度撑满，高度溢出
      rheight = Math.round((cw * 100) / srcPI);
    }

    const multiple = this.cfg.multiple;
    this.geo.rwidth = rwidth * multiple;
    this.geo.rheight = rheight * multiple;
    this.geo.x = (cw - this.geo.rwidth) / 2;
    this.geo.y = (ch - this.geo.rheight) / 2;
  }

  private resetGeometry(): void {
    this.geo.cw = 0;
    this.geo.ch = 0;
    this.geo.srcPI = 0;
    this.geo.x = 0;
    this.geo.y = 0;
    this.geo.rwidth = 0;
    this.geo.rheight = 0;
  }

  // ------------------------------------------------------------------
  // 滤镜准备
  // ------------------------------------------------------------------

  /** 探测 ctx.filter 支持（Safari/Firefox 不支持 → 降级 CSS filter） */
  private detectCanvasFilterSupport(ctx: CanvasRenderingContext2D): void {
    try {
      ctx.filter = "blur(2px)";
      // 支持的浏览器会原样读回；不支持的（旧 Safari）读回 none/空
      this.supportsCtxFilter = ctx.filter === "blur(2px)";
      ctx.filter = "none";
    } catch {
      this.supportsCtxFilter = false;
    }
  }

  /** 准备两条滤镜路径的字符串：
   *  - ctx.filter 路径：blur 半径按 resolutionScale 换算（画布内部像素空间），
   *    使降采样后的视觉模糊强度与原始一致；
   *  - CSS filter 路径：作用在元素盒（CSS 像素空间），内部分辨率无关，用原始值 */
  private prepareFilterStrings(): void {
    const filter = this.cfg.filter;
    const match = BLUR_PX_RE.exec(filter);
    if (!match || this.cfg.resolutionScale === 1) {
      this.scaledFilter = filter;
    } else {
      const scaled = Math.max(1, Math.round(parseFloat(match[1]) * this.cfg.resolutionScale));
      this.scaledFilter = filter.replace(BLUR_PX_RE, `blur(${scaled}px)`);
    }
    if (!this.supportsCtxFilter && this.canvas) {
      this.canvas.style.filter = filter;
    }
  }
}

/**
 * 创建动态背景插件
 *
 * @param config - 插件配置
 * @returns 插件实例（点播端放入 plugins.list 或 player.use() 注册，直播端经 plugins 属性传入）
 */
export function DynamicBgPlugin(config: DynamicBgPluginConfig = {}): Plugin {
  return new DynamicBgPluginClass(config);
}

/** DynamicBgPlugin 的别名（与 createDanmakuPlugin 等命名保持一致） */
export const createDynamicBgPlugin = DynamicBgPlugin;
