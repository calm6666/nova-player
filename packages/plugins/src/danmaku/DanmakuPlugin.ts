/**
 * ============================================
 * 弹幕插件 (DanmakuPlugin)
 * ============================================
 * 弹幕功能插件，基于「状态订阅 + 事件总线」双通道实现跨组件通信：
 *
 * - 设置面板通道：订阅 9 个 DANMAKU_* 运行时状态键（唯一数据源），
 *   在插件内部完成面板数值 → 引擎参数的转换（见「数值转换表」注释）
 * - 发送链路通道：订阅 DANMAKU_SEND 提交事件，发送时从状态读取
 *   弹幕颜色 / 弹幕模式组装完整弹幕，经 onSend 确认后上屏
 * - 数据通道：插件不发起任何网络请求。弹幕数据全部由外部经
 *   DanmakuPluginAPI 传入（loadDanmaku / addDanmaku / updateDanmaku /
 *   removeDanmaku / clearDanmaku），插件负责渲染与列表面板同步。
 *
 * 渲染引擎（DanmakuManager）自带 video 事件绑定（play/pause/seeking/timeupdate）、
 * ResizeObserver 与 fullscreenchange 监听，插件不再重复订阅播放器事件。
 *
 * 使用方式：
 * import { DanmakuPlugin } from '@lumina/plugins';
 *
 * plugins: [
 *   DanmakuPlugin({
 *     callbacks: {
 *       onSend: async (danmaku) => { ... return confirmed; },
 *       onSendSuccess: (danmaku) => { ... },
 *       onSendError: (err, danmaku) => { ... },
 *     }
 *   })
 * ]
 *
 * 数据注入（外部负责请求，插件只消费数据）：
 * player.loadDanmaku(list);            // 播放器便捷 API
 * player.mountDanmakuList("#danmaku-list"); // 列表面板（必须显式传挂载点）
 *
 * 数据链路：loadDanmaku 替换全网数据并重置调度器；addDanmaku/updateDanmaku/
 * removeDanmaku/clearDanmaku 同时同步渲染调度器与列表面板，保证画面与列表一致。
 */

import type { Plugin, PluginOptions } from "@/types/plugin";
import type { DanmakuCallbacks } from "@/types/callbacks";
import type {
  DanmakuItem,
  DanmakuSpeed,
  DanmakuFontSize,
  DanmakuArea,
  DanmakuFilter,
  DanmakuMaskConfig,
  MaskLoader,
} from "@/types/danmaku";
import { DanmakuType, ScreenMode, RenderMode } from "@/types/danmaku";
import type { VideoPlayer } from "../../../player/src/player/VideoPlayer";
import type { PlayerEventBus } from "../../../player/src/core/plugin";
import { PlayerEventEnum } from "@/core/events";
import { PlayerStateKeyEnum } from "../../../player/src/store/runtimeState";
import { DanmakuManager } from "../utils/danmaku";
import { DanmakuTip } from "./DanmakuTip";
import { injectPluginStyle } from "../utils/injectStyle";
import {
  mountDanmakuListView,
  type DanmakuListViewHandle,
} from "./DanmakuList/DanmakuList";
import type { DanmakuListHandlers, DanmakuListRow } from "./DanmakuList/types";
import danmakuListStyle from "./DanmakuList/DanmakuList.scss?inline";
// 防挡分割器仅类型引用（运行时经 applyMaskEnabled 内动态 import 懒加载，
// 编译期被完全擦除，不产生静态依赖 → 未开启防挡时 chunk 不进主包）
import type { DanmakuMaskSegmenter } from "../utils/danmakuMask";
// 弹幕插件样式以字符串形式内联导入（Vite `?inline`），install 时运行时注入
import danmakuCss from "./danmaku.scss?inline";

// ============================================
// 类型定义
// ============================================

/** 弹幕列表面板配置 */
export interface DanmakuListConfig {
  /** 是否登录态（举报 / 查看历史弹幕 / 同步屏蔽列表） */
  loggedIn?: boolean;
  /** 面板整体高度 px（默认 380） */
  height?: number;
  /** 历史弹幕可点日期（yyyy-MM-dd）；不传时按弹幕发送日期推导 */
  historyDates?: readonly string[];
}

/** 弹幕插件配置 */
export interface DanmakuPluginConfig {
  /** 插件选项 */
  options?: PluginOptions;
  /** 弹幕回调 */
  callbacks?: DanmakuCallbacks;
  /**
   * 弹幕渲染方式：
   * - 'dom'（默认）：CSS 动画渲染，中少量弹幕性能最佳
   * - 'canvas'：Canvas 批量绘制，大量弹幕场景性能更佳
   * - 'auto'：弹幕量超过阈值（200 条）时自动切换 Canvas
   */
  renderer?: RenderMode;
  /** 弹幕列表面板配置（挂载 / 登录态 / 历史日期） */
  list?: DanmakuListConfig;
  /** 智能防挡数据源（外部 provider） */
  mask?: {
    provider?: MaskLoader;
  };
}

// ============================================
// 运行时类型谓词（替代 as 断言的收窄方案）
// ============================================

/** 类型谓词：合法的弹幕类型枚举值 */
function isDanmakuTypeValue(value: unknown): value is DanmakuType {
  return (
    value === DanmakuType.SCROLL ||
    value === DanmakuType.TOP ||
    value === DanmakuType.BOTTOM ||
    value === DanmakuType.ADVANCED
  );
}

/**
 * 从事件透传的发送选项中安全提取弹幕字段
 *
 * DANMAKU_SEND 事件的 options 是 Record<string, unknown>（事件契约），
 * 这里逐字段做运行时校验后收窄为 Partial<DanmakuItem>，避免 as 断言。
 */
function pickSendOptions(
  raw: Record<string, unknown> | undefined,
): Partial<DanmakuItem> {
  const picked: Partial<DanmakuItem> = {};
  if (!raw) return picked;
  if (typeof raw.id === "string" || typeof raw.id === "number") {
    picked.id = raw.id;
  }
  if (typeof raw.time === "number") picked.time = raw.time;
  if (isDanmakuTypeValue(raw.type)) picked.type = raw.type;
  if (typeof raw.fontSize === "number") picked.fontSize = raw.fontSize;
  if (typeof raw.color === "string") picked.color = raw.color;
  if (typeof raw.userId === "string") picked.userId = raw.userId;
  if (typeof raw.userName === "string") picked.userName = raw.userName;
  if (typeof raw.weight === "number") picked.weight = raw.weight;
  if (typeof raw.uid === "string" || typeof raw.uid === "number") {
    picked.uid = raw.uid;
  }
  if (typeof raw.like === "number") picked.like = raw.like;
  return picked;
}

/**
 * 发送栏模式值 → 弹幕类型
 *
 * 状态键 DANMAKU_MODE 沿用 B 站协议：1 滚动 / 4 底部 / 5 顶部，
 * 引擎枚举为 DanmakuType.SCROLL(1) / BOTTOM(3) / TOP(2)，两套编码不同，
 * 发送时在插件层完成映射（缺省值与其余值一律按滚动处理）。
 */
function danmakuModeToType(mode: number): DanmakuType {
  if (mode === 5) return DanmakuType.TOP;
  if (mode === 4) return DanmakuType.BOTTOM;
  return DanmakuType.SCROLL;
}

// ============================================
// 弹幕插件 API 接口（暴露给外部使用的完整类型）
// ============================================

/** 弹幕插件完整 API 接口 */
export interface DanmakuPluginAPI extends Plugin {
  /** 获取 DanmakuManager 实例 */
  getManager(): DanmakuManager | null;
  /** 全量替换弹幕数据（重置调度器并同步列表面板） */
  loadDanmaku(list: readonly DanmakuItem[]): void;
  /** 追加单条弹幕（调度器 + 列表面板同步） */
  addDanmaku(item: DanmakuItem): void;
  /** 更新单条弹幕（按 id 合并字段，调度器 + 列表面板同步） */
  updateDanmaku(id: DanmakuItem["id"], patch: Partial<DanmakuItem>): void;
  /** 删除单条弹幕（调度器 + 列表面板同步） */
  removeDanmaku(id: DanmakuItem["id"]): void;
  /** 清空弹幕数据与渲染层 */
  clearDanmaku(): void;
  /** 获取当前弹幕数据副本 */
  getDanmakuList(): DanmakuItem[];
  /** 挂载列表面板（必须显式传入挂载点；不传不挂载） */
  mountList(target: string | HTMLElement): void;
  /** 卸载列表面板 */
  unmountList(): void;
  /** 设置弹幕可见性 */
  setVisible(visible: boolean): void;
  /** 发送弹幕（内部读取状态中的颜色/模式组装，经 onSend 确认后上屏） */
  send(text: string, options?: Partial<DanmakuItem>): void;
  /** 批量发送弹幕 */
  sendBatch(danmakus: DanmakuItem[]): void;
  /** 继续弹幕动画 */
  play(): void;
  /** 暂停弹幕动画 */
  pause(): void;
  /** 停止弹幕 */
  stop(): void;
  /** 清空弹幕 */
  clear(): void;
  /** 设置弹幕透明度 (0-1) */
  setOpacity(opacity: number): void;
  /** 设置弹幕速度档位 */
  setSpeed(speed: DanmakuSpeed): void;
  /** 设置弹幕速度倍率（连续值，面板滑杆直连） */
  setSpeedMultiplier(multiplier: number): void;
  /** 设置弹幕字号档位 */
  setFontSize(size: DanmakuFontSize): void;
  /** 设置弹幕字号缩放系数（连续值，1 = 基准 18px） */
  setFontSizeScale(scale: number): void;
  /** 设置弹幕显示区域档位 */
  setArea(area: DanmakuArea): void;
  /** 设置弹幕显示区域占比（连续值 0.05-1） */
  setAreaRatio(ratio: number): void;
  /** 设置是否随屏幕缩放弹幕 */
  setAutoScale(autoScale: boolean): void;
  /** 设置弹幕密度 (0-1) */
  setDensity(density: number): void;
  /** 设置渲染模式 (DOM/Canvas) */
  setRenderMode(mode: RenderMode): void;
  /** 设置屏幕模式 */
  setScreenMode(mode: ScreenMode): void;
  /** 设置弹幕过滤器 */
  setFilter(filter: DanmakuFilter): void;
  /** 设置防挡配置 */
  setMaskConfig(config: DanmakuMaskConfig): void;
  /** 获取弹幕统计信息 */
  getStats(): ReturnType<DanmakuManager["getStats"]> | null;
  /** 跳转到指定时间 */
  seek(time: number): void;
  /** 重新计算布局 */
  resize(): void;
}

// ============================================
// 弹幕插件类
// ============================================

class DanmakuPluginClass implements DanmakuPluginAPI {
  readonly name = "danmaku";
  readonly version = "2.0.0";
  readonly description = "Danmaku rendering plugin";
  readonly options?: PluginOptions;

  private manager: DanmakuManager | null = null;
  /** 弹幕悬停操作条（原版 player-dm-tip 移植，挂在弹幕容器内） */
  private tip: DanmakuTip | null = null;
  private callbacks: DanmakuCallbacks;
  /** 弹幕渲染方式（'dom' 默认 / 'canvas' / 'auto'），创建引擎时传入 */
  private renderer: RenderMode; /** 列表面板配置（登录态 / 高度 / 历史日期） */
  private listConfig?: DanmakuListConfig;
  /** 插件自持的智能防挡 provider */
  private maskProvider?: MaskLoader;
  private player: VideoPlayer | null = null;
  private video: HTMLVideoElement | null = null;
  private danmakuList: DanmakuItem[] = [];
  private listHandle: DanmakuListViewHandle | null = null;
  /** 列表挂载容器（卸载时移除 .danmaku-wrap 样式作用域类） */
  private listContainer: HTMLElement | null = null;
  /**
   * 本地语义分割器（智能防挡运行时，仅类型引用——模块经动态 import
   * 懒加载，type-only import 会被编译器完全擦除，不产生静态依赖，
   * 开发者未开启防挡功能时 danmakuMask chunk 不进主包）
   */
  private maskSegmenter: DanmakuMaskSegmenter | null = null;
  /** 事件总线订阅的取消函数列表（MOUNTED/SEND/CLEAR） */
  private unsubscribers: Array<() => void> = [];
  /** 状态键订阅的取消函数列表（7 个即时生效的设置键） */
  private stateUnsubscribers: Array<() => void> = [];
  /** 播放器事件总线（即 player.events，用于向外部广播弹幕事件） */
  private eventBus: PlayerEventBus | null = null;

  constructor(config?: DanmakuPluginConfig) {
    this.callbacks = config?.callbacks ?? {};
    this.options = config?.options;
    this.renderer = config?.renderer ?? RenderMode.DOM;
    this.listConfig = config?.list;
    this.maskProvider = config?.mask?.provider;
  }

  install(player: VideoPlayer): void {
    // 运行时注入弹幕插件样式：样式随插件分发，与播放器样式包彻底解耦
    // injectPluginStyle 内部自带 SSR 守卫（无 document 时跳过）与幂等保护
    injectPluginStyle("danmaku", danmakuCss);

    this.player = player;
    const events: PlayerEventBus = player.events;
    // 持有播放器总线引用，供发送成功等场景向上广播事件
    this.eventBus = events;

    // 订阅 MOUNTED 事件：RowDm 容器随播放器整树挂载完成后初始化引擎
    const unsubMounted = events.on(PlayerEventEnum.MOUNTED, (data): void => {
      // 幂等守卫：重复 MOUNTED 不重建引擎
      if (this.manager) return;
      const video = data.video ?? null;
      this.video = video;

      // 弹幕渲染容器：RowDm 组件渲染的基础弹幕容器
      // （MOUNTED 时整树已挂载，容器必然存在；找不到则保持无引擎的空转状态）
      const containerEl =
        data.container?.querySelector(".nova-player-bas-dm-wrap") ??
        data.container?.querySelector(".nova-player-row-dm-wrap") ??
        null;
      if (!video || !(containerEl instanceof HTMLElement)) return;

      this.manager = new DanmakuManager({
        container: containerEl,
        video,
        // 渲染方式由插件配置决定（默认 DOM，可选 canvas / auto）
        renderMode: this.renderer,
      }); // 挂载即同步当前状态值（覆盖播放器构造期写入的初始配置）
      this.applyInitialSettings();
      this.subscribeStateKeys();

      // 悬停操作条 Tip（原版行为：悬停 300ms 展示，展示期间该弹幕挂 danmaku-x-paused 暂停）
      // 操作回调转发到插件 callbacks 通道；撤回额外从画面移除该弹幕
      this.tip = new DanmakuTip(containerEl, {
        onLike: (danmaku, liked): void => {
          this.callbacks.onDanmakuLike?.(danmaku, liked);
        },
        onCopy: (danmaku): void => {
          this.callbacks.onDanmakuCopy?.(danmaku);
        },
        onRecall: (danmaku): void => {
          this.callbacks.onDanmakuRecall?.(danmaku);
          // 撤回上屏：从渲染引擎移除该弹幕（渲染项含 renderId）
          this.manager?.removeDanmaku(danmaku.renderId);
        },
        onReport: (danmaku): void => {
          this.callbacks.onDanmakuReport?.(danmaku);
        },
      });
      this.manager.setOnDanmakuHover((danmaku, position) => {
        if (danmaku && position) {
          this.tip?.show(danmaku, position);
        } else {
          this.tip?.hide();
        }
      });
    });
    this.unsubscribers.push(unsubMounted);

    // 订阅 DANMAKU_SEND 事件：发送链路唯一入口
    // （SendBar 提交 / player.sendDanmaku 均只广播本事件，插件内部组装弹幕）
    const unsubSend = events.on(PlayerEventEnum.DANMAKU_SEND, (data): void => {
      void this.handleSend(data.text, pickSendOptions(data.options));
    });
    this.unsubscribers.push(unsubSend);

    // 订阅 DANMAKU_CLEAR 事件：清空当前渲染的弹幕    // （列表数据与调度器同步清空，保证画面和列表面板一致）
    const unsubClear = events.on(PlayerEventEnum.DANMAKU_CLEAR, (): void => {
      this.clearDanmaku();
    });
    this.unsubscribers.push(unsubClear);
  }

  uninstall(): void {
    // 取消事件总线订阅
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];

    // 取消运行时状态订阅
    this.stateUnsubscribers.forEach((unsub) => unsub());
    this.stateUnsubscribers = [];

    // 释放本地分割器（终止防挡 Worker，停止模型推理）
    this.maskSegmenter?.dispose();
    this.maskSegmenter = null;

    // 销毁引擎（内部解除 video 事件 / ResizeObserver / 全屏监听 / Worker）
    if (this.manager) {
      this.manager.destroy();
      this.manager = null;
    }

    // 销毁悬停操作条（清理定时器并移除覆盖层）
    this.tip?.destroy();
    this.tip = null;
    this.unmountList();
    this.danmakuList = [];

    this.player = null;
    this.video = null;
    this.eventBus = null;
  }

  // ============================================
  // 状态订阅（设置面板数值 → 引擎参数的转换）
  // ============================================

  /**
   * 数值转换表（订阅与初始同步共用）：
   * - DANMAKU_VISIBLE      boolean       → setVisible
   * - DANMAKU_OPACITY      0-1           → setOpacity（直传）
   * - DANMAKU_SPEED        倍率          → setSpeedMultiplier（引擎内部收敛到 0.1-5）
   * - DANMAKU_DENSITY      0-1           → setDensity（直传）
   * - DANMAKU_AREA         0-100         → setAreaRatio(v / 100)
   * - DANMAKU_FONT_SIZE    0-100         → setFontSizeScale(0.5 + v / 100)
   * - DANMAKU_SCALE_WITH_SCREEN boolean  → setAutoScale
   * - DANMAKU_COLOR        '#RRGGBB'     → 发送时读取（无即时效果）
   * - DANMAKU_MODE         1/4/5         → 发送时映射为弹幕类型（无即时效果）
   */
  private applyInitialSettings(): void {
    const state = this.player?.state;
    if (!state || !this.manager) return;

    this.manager.setVisible(
      state.get(PlayerStateKeyEnum.DANMAKU_VISIBLE) ?? true,
    );
    this.manager.setOpacity(state.get(PlayerStateKeyEnum.DANMAKU_OPACITY) ?? 1);
    this.manager.setSpeedMultiplier(
      state.get(PlayerStateKeyEnum.DANMAKU_SPEED) ?? 1,
    );
    this.manager.setDensity(state.get(PlayerStateKeyEnum.DANMAKU_DENSITY) ?? 1);
    this.applyArea(state.get(PlayerStateKeyEnum.DANMAKU_AREA) ?? 75);
    this.applyFontSize(state.get(PlayerStateKeyEnum.DANMAKU_FONT_SIZE) ?? 50);
    this.manager.setAutoScale(
      state.get(PlayerStateKeyEnum.DANMAKU_SCALE_WITH_SCREEN) ?? true,
    );
    // 智能防挡：安装时读当前状态（构造期持久化读回值已写入状态键）
    this.applyMaskEnabled(
      state.get(PlayerStateKeyEnum.DANMAKU_MASK_ENABLED) ?? false,
    );
  }

  /** 订阅 7 个即时生效的弹幕状态键（COLOR/MODE 在发送时读取，不订阅） */
  private subscribeStateKeys(): void {
    const state = this.player?.state;
    if (!state) return;

    this.stateUnsubscribers.push(
      state.subscribe(PlayerStateKeyEnum.DANMAKU_VISIBLE, (visible) => {
        this.manager?.setVisible(visible);
      }),
      state.subscribe(PlayerStateKeyEnum.DANMAKU_OPACITY, (opacity) => {
        this.manager?.setOpacity(opacity);
      }),
      state.subscribe(PlayerStateKeyEnum.DANMAKU_SPEED, (speed) => {
        this.manager?.setSpeedMultiplier(speed);
      }),
      state.subscribe(PlayerStateKeyEnum.DANMAKU_DENSITY, (density) => {
        this.manager?.setDensity(density);
      }),
      state.subscribe(PlayerStateKeyEnum.DANMAKU_AREA, (area) => {
        this.applyArea(area);
      }),
      state.subscribe(PlayerStateKeyEnum.DANMAKU_FONT_SIZE, (fontSize) => {
        this.applyFontSize(fontSize);
      }),
      state.subscribe(PlayerStateKeyEnum.DANMAKU_SCALE_WITH_SCREEN, (auto) => {
        this.manager?.setAutoScale(auto);
      }),
      state.subscribe(PlayerStateKeyEnum.DANMAKU_MASK_ENABLED, (enabled) => {
        this.applyMaskEnabled(enabled);
      }),
    );
  }

  /** 数值转换：显示区域 0-100 → 区域占比 0.05-1（引擎内部收敛越界值） */
  private applyArea(area: number): void {
    this.manager?.setAreaRatio(area / 100);
  }

  /** 数值转换：字号档位 0-100 → 缩放系数 0.5-1.5（50 = 基准 1.0） */
  private applyFontSize(fontSize: number): void {
    this.manager?.setFontSizeScale(0.5 + fontSize / 100);
  }

  // ============================================
  // 智能防挡接线（外部 provider 优先 / 本地语义分割懒加载）
  // ============================================

  /**
   * 应用弹幕智能防挡开关（持久化于 danmakuSettings.maskEnabled）
   *
   * 两种模式（优先级从高到低）：
   * 1. 外部 provider：danmaku.mask.provider 直接作为引擎 maskLoader，
   *    外部自行按 currentTime 返回遮罩图（与字幕 provider 同一模式）
   * 2. 本地语义分割：动态 import danmakuMask 模块（Vite 拆独立 chunk：
   *    开发者未配置不打包进主包；用户未开启不下载不初始化），
   *    MediaPipe ImageSegmenter 在 Web Worker 内推理（主线程零阻塞，
   *    视频播放无卡顿）；帧结果带时间戳，stale 帧（seek 后的过期结果）
   *    丢弃，保证遮罩与视频时钟同步
   */
  private async applyMaskEnabled(enabled: boolean): Promise<void> {
    const manager = this.manager;
    const video = this.video;
    if (!manager || !video) return;

    // 关闭：停用引擎遮罩 + 释放本地分割器（终止 Worker，停止模型推理）
    if (!enabled) {
      manager.setMaskConfig({ enabled: false });
      this.maskSegmenter?.dispose();
      this.maskSegmenter = null;
      return;
    }

    // 模式 1：外部 provider（免模型，遮罩由外部获取）
    const external = this.maskProvider;
    if (external) {
      manager.setMaskConfig({ enabled: true, maskLoader: external });
      return;
    }

    // 模式 2：本地语义分割（懒加载模块 + Worker 推理 + 时钟同步校验）
    try {
      if (!this.maskSegmenter) {
        // 动态 import：只有用户真正开启防挡才会加载模块与下载模型
        const { DanmakuMaskSegmenter } = await import("../utils/danmakuMask");
        const segmenter = new DanmakuMaskSegmenter({});
        await segmenter.init();
        // init 期间用户可能已关闭（竞态）：复核当前状态再落位
        const stillEnabled =
          this.player?.state.get(PlayerStateKeyEnum.DANMAKU_MASK_ENABLED) ===
          true;
        if (!stillEnabled) {
          segmenter.dispose();
          return;
        }
        this.maskSegmenter = segmenter;
      }
      const segmenter = this.maskSegmenter;
      /**
       * 预处理流水线：segmenter 内部自驱循环持续分割「当前帧」
       * （完成一帧立即下一帧，GPU 下 20-30fps），本 loader 仅按
       * 引擎采样间隔消费最新缓存结果（getLatest 同步返回，
       * 不触发推理）——遮罩延迟 = 单帧推理耗时，与采样间隔无关
       */
      segmenter.startRealtime(video);
      const loader: MaskLoader = async (currentTime: number) => {
        const result = segmenter.getLatest(currentTime);
        if (!result || !result.image) {
          return { maskImage: "", clearMask: true };
        }
        return {
          maskImage: result.image,
          originalWidth: result.width,
          originalHeight: result.height,
        };
      };
      manager.setMaskConfig({
        enabled: true,
        maskLoader: loader,
        // 采样间隔缩短：仅消费缓存结果（无推理开销），可以高频取
        updateInterval: 300,
      });
    } catch {
      // 模型下载/初始化失败（网络中断/能力不足）：释放并降级为无遮罩
      this.maskSegmenter?.dispose();
      this.maskSegmenter = null;
    }
  }

  // ============================================
  // 数据同步（外部注入 → 调度器 + 列表面板）
  // ============================================

  /** 数据变化后重置调度器并整表装载（保证画面与列表数据一致） */
  private syncScheduler(): void {
    const manager = this.manager;
    if (!manager) return;
    manager.resetDataSource();
    if (this.danmakuList.length > 0) {
      manager.loadDanmaku([...this.danmakuList]);
    }
  }

  /** 数据变化后刷新列表面板 */
  private syncView(): void {
    this.refreshList();
  }

  /** 全量替换弹幕数据（外部数据注入通道；调度器与列表面板同步） */
  loadDanmaku(list: readonly DanmakuItem[]): void {
    this.danmakuList = [...list].sort((a, b) => a.time - b.time);
    this.syncScheduler();
    this.syncView();
    this.eventBus?.emit(PlayerEventEnum.DANMAKU_LOADED, {
      count: this.danmakuList.length,
    });
  }

  /** 追加单条弹幕（调度器与列表面板同步） */
  addDanmaku(item: DanmakuItem): void {
    if (
      this.danmakuList.some((entry) => String(entry.id) === String(item.id))
    ) {
      return;
    }
    this.danmakuList = [...this.danmakuList, item].sort(
      (a, b) => a.time - b.time,
    );
    this.manager?.addDanmaku(item);
    this.syncView();
  }

  /** 更新单条弹幕（按 id 合并字段；调度器与列表面板同步） */
  updateDanmaku(id: DanmakuItem["id"], patch: Partial<DanmakuItem>): void {
    let changed = false;
    this.danmakuList = this.danmakuList.map((item) => {
      if (String(item.id) !== String(id)) return item;
      changed = true;
      return { ...item, ...patch, id: item.id };
    });
    if (!changed) return;
    this.syncScheduler();
    this.syncView();
  }

  /** 删除单条弹幕（调度器与列表面板同步） */
  removeDanmaku(id: DanmakuItem["id"]): void {
    const next = this.danmakuList.filter(
      (item) => String(item.id) !== String(id),
    );
    if (next.length === this.danmakuList.length) return;
    this.danmakuList = next;
    this.syncScheduler();
    this.syncView();
  }

  /** 清空弹幕数据与渲染层 */
  clearDanmaku(): void {
    this.danmakuList = [];
    this.manager?.clear();
    this.manager?.resetDataSource();
    this.syncView();
  }

  /** 获取当前弹幕数据副本 */
  getDanmakuList(): DanmakuItem[] {
    return [...this.danmakuList];
  }

  // ============================================
  // 发送链路（DANMAKU_SEND → 组装 → 确认 → 上屏）
  // ============================================

  /**
   * 处理发送弹幕
   *
   * 1. 从状态读取弹幕颜色 / 弹幕模式，组装完整弹幕（uid=1 标记本人，
   *    引擎据此追加 danmaku-x-self 白框高亮）
   * 2. 配置了 onSend（插件 callbacks 或播放器 danmaku.onSend）时先走
   *    外部确认流程，返回确认弹幕才上屏；抛错不上屏并走失败回调
   * 3. 未配置 onSend 时本地直接上屏
   */
  private async handleSend(
    text: string,
    options?: Partial<DanmakuItem>,
  ): Promise<void> {
    const manager = this.manager;
    const video = this.video;
    if (!manager || !video) return;

    const state = this.player?.state;
    const color = state?.get(PlayerStateKeyEnum.DANMAKU_COLOR) ?? "#FFFFFF";
    const mode = state?.get(PlayerStateKeyEnum.DANMAKU_MODE) ?? 1;

    const danmaku: DanmakuItem = {
      id: options?.id ?? Date.now(),
      text,
      time: options?.time ?? video.currentTime,
      type: options?.type ?? danmakuModeToType(mode),
      color: options?.color ?? color,
      uid: options?.uid ?? 1,
      // 发送时间戳：列表「发送时间」列 / 历史弹幕日期筛选使用
      sentAt: options?.sentAt ?? Date.now(),
    };
    if (options?.fontSize !== undefined) danmaku.fontSize = options.fontSize;
    if (options?.userId !== undefined) danmaku.userId = options.userId;
    if (options?.userName !== undefined) danmaku.userName = options.userName;
    if (options?.weight !== undefined) danmaku.weight = options.weight;
    if (options?.isVip !== undefined) danmaku.isVip = options.isVip;
    if (options?.speed !== undefined) danmaku.speed = options.speed;
    if (options?.like !== undefined) danmaku.like = options.like;

    // 发送确认提供者：完全由插件 callbacks 控制
    const sendProvider = this.callbacks.onSend;

    if (sendProvider) {
      try {
        const confirmed = await sendProvider(danmaku);
        manager.sendDanmaku(confirmed.text, confirmed);
        // 数据来源同步：发送成功的弹幕追加进列表面板
        this.appendToList(confirmed);
        this.callbacks.onSendSuccess?.(confirmed);
        // 服务器确认成功：向播放器总线广播 DANMAKU_SENT
        this.eventBus?.emit(PlayerEventEnum.DANMAKU_SENT, {
          text: confirmed.text,
          id: confirmed.id,
        });
      } catch (error) {
        this.callbacks.onSendError?.(
          error instanceof Error ? error : new Error(String(error)),
          danmaku,
        );
      }
      return;
    }

    // 本地直发：无需确认，立即上屏并广播发送成功；
    // 同步触发 onSendSuccess——本地直发同样是「发送成功」，外部
    // （如弹幕列表面板）依赖该回调把本地弹幕汇入列表
    manager.sendDanmaku(danmaku.text, danmaku);
    // 数据来源同步：本地直发的弹幕追加进列表面板
    this.appendToList(danmaku);
    this.callbacks.onSendSuccess?.(danmaku);
    this.eventBus?.emit(PlayerEventEnum.DANMAKU_SENT, {
      text: danmaku.text,
      id: danmaku.id,
    });
  }

  // ==================== 公共 API ====================

  /** 获取 DanmakuManager 实例 */
  getManager(): DanmakuManager | null {
    return this.manager;
  }

  /** 动态更新列表；不传 list 时刷新当前数据 */
  updateList(list?: DanmakuItem[]): void {
    if (list) this.danmakuList = [...list];
    this.refreshList();
  }

  /** 获取当前弹幕列表副本 */
  getList(): DanmakuItem[] {
    return [...this.danmakuList];
  } /**
   * 挂载弹幕列表
   *
   * 挂载点由调用方显式传入（选择器或元素）；不传 / 找不到则不挂载，
   * 插件不内置默认容器，避免在播放器 DOM 内隐式创建列表。
   */
  mountList(target: string | HTMLElement): void {
    if (typeof document === "undefined") return;
    const el =
      typeof target === "string" ? document.querySelector(target) : target;
    if (!(el instanceof HTMLElement)) return;
    // 样式随插件分发：列表私有样式（ui-* 公共样式在播放器样式包内）
    injectPluginStyle("danmaku-list", danmakuListStyle);
    // 样式作用域类由挂载方追加（组件不额外包 DOM）
    el.classList.add("danmaku-wrap");
    this.listContainer = el;
    this.listHandle?.dispose();
    this.listHandle = mountDanmakuListView(el, this.danmakuList, {
      loggedIn: this.listConfig?.loggedIn ?? true,
      height: this.listConfig?.height,
      historyDates: this.listConfig?.historyDates,
      handlers: this.buildListHandlers(),
    });
  }

  /** 卸载弹幕列表 */
  unmountList(): void {
    this.listHandle?.dispose();
    this.listHandle = null;
    // 移除挂载时追加的样式作用域类，容器交还调用方
    this.listContainer?.classList.remove("danmaku-wrap");
    this.listContainer = null;
  }

  /** 列表视图交互 → 插件行为接线（UI 逻辑不写在插件里） */
  private buildListHandlers(): DanmakuListHandlers {
    return {
      // 点击弹幕行：跳转到该弹幕出现时间
      onSeek: (seconds: number): void => {
        this.seek(seconds);
      },
      // 举报：回查原始弹幕后转发插件回调
      onReport: (row: DanmakuListRow): void => {
        const item = this.danmakuList.find(
          (entry) => String(entry.id) === String(row.id),
        );
        if (item) this.callbacks.onDanmakuReport?.(item);
      },
      // 高级弹幕：测试效果直接上屏预览，发送走统一发送链路
      onAdvSubmit: (form, kind): void => {
        if (kind === "send") {
          this.send(form.text);
          return;
        }
        const preview: Partial<DanmakuItem> = {
          color: form.color,
          type: DanmakuType.ADVANCED,
        };
        const size = Number(form.size);
        if (Number.isFinite(size) && size > 0) preview.fontSize = size;
        this.manager?.sendDanmaku(form.text, preview);
      },
    };
  }

  /** 刷新列表视图数据 */
  private refreshList(): void {
    this.listHandle?.setList(this.danmakuList);
  }

  /** 追加单条弹幕进列表（发送成功通道使用） */
  private appendToList(item: DanmakuItem): void {
    if (
      this.danmakuList.some((entry) => String(entry.id) === String(item.id))
    ) {
      return;
    }
    this.danmakuList = [...this.danmakuList, item].sort(
      (a, b) => a.time - b.time,
    );
    this.refreshList();
  }

  /** 设置弹幕可见性 */
  setVisible(visible: boolean): void {
    this.manager?.setVisible(visible);
  }

  /** 发送弹幕（与 DANMAKU_SEND 事件同一链路） */
  send(text: string, options?: Partial<DanmakuItem>): void {
    void this.handleSend(text, options);
  } /** 批量发送弹幕（逐条走 addDanmaku：调度器 + 列表面板同步） */
  sendBatch(danmakus: DanmakuItem[]): void {
    if (danmakus.length === 0) return;
    for (const danmaku of danmakus) {
      this.addDanmaku(danmaku);
      this.manager?.addDanmaku(danmaku);
    }
  }

  /** 继续弹幕动画 */
  play(): void {
    this.manager?.play();
  }

  /** 暂停弹幕动画 */
  pause(): void {
    this.manager?.pause();
  }

  /** 停止弹幕（清空所有弹幕） */
  stop(): void {
    this.manager?.stop();
  }

  /** 清空弹幕 */
  clear(): void {
    this.manager?.clear();
  }

  /** 设置弹幕透明度 (0-1) */
  setOpacity(opacity: number): void {
    this.manager?.setOpacity(opacity);
  }

  /** 设置弹幕速度档位 */
  setSpeed(speed: DanmakuSpeed): void {
    this.manager?.setSpeed(speed);
  }

  /** 设置弹幕速度倍率（连续值） */
  setSpeedMultiplier(multiplier: number): void {
    this.manager?.setSpeedMultiplier(multiplier);
  }

  /** 设置弹幕字号档位 */
  setFontSize(size: DanmakuFontSize): void {
    this.manager?.setFontSize(size * 18);
  }

  /** 设置弹幕字号缩放系数（连续值） */
  setFontSizeScale(scale: number): void {
    this.manager?.setFontSizeScale(scale);
  }

  /** 设置弹幕显示区域档位 */
  setArea(area: DanmakuArea): void {
    this.manager?.setArea(area);
  }

  /** 设置弹幕显示区域占比（连续值） */
  setAreaRatio(ratio: number): void {
    this.manager?.setAreaRatio(ratio);
  }

  /** 设置是否随屏幕缩放弹幕 */
  setAutoScale(autoScale: boolean): void {
    this.manager?.setAutoScale(autoScale);
  }

  /** 设置弹幕密度 (0-1) */
  setDensity(density: number): void {
    this.manager?.setDensity(density);
  }

  /** 设置渲染模式 (DOM/Canvas) */
  setRenderMode(mode: RenderMode): void {
    this.manager?.setRenderMode(mode);
  }

  /** 设置屏幕模式 (全屏/滚动/顶部/底部) */
  setScreenMode(mode: ScreenMode): void {
    this.manager?.switchScreenMode(
      mode === ScreenMode.FULLSCREEN ? "fullscreen" : "normal",
    );
  }

  /** 设置弹幕过滤器 */
  setFilter(filter: DanmakuFilter): void {
    this.manager?.setFilter(filter);
  }

  /** 设置防挡配置 */
  setMaskConfig(config: DanmakuMaskConfig): void {
    this.manager?.setMaskConfig(config);
  }

  /** 获取弹幕统计信息 */
  getStats(): ReturnType<DanmakuManager["getStats"]> | null {
    return this.manager ? this.manager.getStats() : null;
  }

  /** 跳转到指定时间 */
  seek(time: number): void {
    if (!this.video) return;
    this.video.currentTime = time;
  }

  /** 重新计算布局 */
  resize(): void {
    this.manager?.resize();
  }
}

/**
 * 弹幕插件工厂函数
 *
 * @param config - 插件配置
 * @returns DanmakuPluginAPI 实例
 *
 * @example
 * plugins: [
 *   DanmakuPlugin({
 *     callbacks: {
 *       onSend: async (danmaku) => { return await sendToServer(danmaku); },
 *       onSendSuccess: (danmaku) => console.log('sent'),
 *       onSendError: (err, danmaku) => console.error('failed', err),
 *     }
 *   })
 * ]
 */
export function DanmakuPlugin(config?: DanmakuPluginConfig): DanmakuPluginAPI {
  return new DanmakuPluginClass(config);
}

/**
 * 创建弹幕插件（别名）
 */
export const createDanmakuPlugin = DanmakuPlugin;
