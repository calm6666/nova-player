/**
 * ============================================
 * 字幕插件 (SubtitlePlugin)
 * ============================================
 * 字幕功能插件，通过 PlayerEventEnum 事件实现跨组件通信
 * 在 MOUNTED 时查找 .nova-player-subtitle-wrap 容器（不自行创建容器）
 * 使用 RAF (requestAnimationFrame) 驱动字幕更新循环
 * 使用二分查找进行字幕时间定位
 * 集成 @/utils/subtitle 解析器
 *
 * 双模式架构（docs/subtitle-dual-mode-design.md）：
 * - 模式 A（localAi）：本地 AI 实时识别——采集链 → VAD → AsrEngine →
 *   onCue 推送 → 增量有序 append（负数 id）→ 现有 RAF 渲染管线
 * - 模式 B（remoteProvider / 旧 aiBackend）：服务端返回——拉取型 Provider，
 *   支持多轨与增量窗口；旧 aiBackend 自动映射为单轨 Provider
 * - 两种模式统一归一到 SubtitleItem[]，渲染层（RAF + 二分查找）零改动
 * - 降级链：模式 A 失败自动降级模式 B（文档 6.5），
 *   降级原因经 SUBTITLE_AI_STATUS 广播
 *
 * 使用方式：
 * import { SubtitlePlugin } from '@lumina/plugins';
 *
 * plugins: [
 *   SubtitlePlugin({
 *     sources: [
 *       { src: 'subtitles/cn.srt', lang: 'zh', label: '中文' },
 *       { src: 'subtitles/en.srt', lang: 'en', label: 'English' }
 *     ],
 *     localAi: { engines: { zh: myEngine }, defaultLang: 'zh' },
 *     remoteProvider: myRemoteProvider
 *   })
 * ]
 */

import type { Plugin, PluginOptions } from "@/types/plugin";
import type {
  SubtitleItem,
  ParsedSubtitle,
  SubtitleSource,
  SubtitleStyle,
  LocalAiSubtitleConfig,
  LocalAiSubtitleProvider,
  RemoteSubtitleProvider,
  RemoteSubtitleTrack,
  SubtitleTrackInfo,
  SubtitleAiStatusPayload,
  SubtitleCueEvent,
  SubtitleEngineContext,
  AsrEngine,
  AiSubtitleEntry,
} from "@/types/subtitle";
import { SubtitleFormat } from "@/types/subtitle";

export type { SubtitleSource } from "@/types/subtitle";
import type { VideoPlayer } from "../../../player/src/player/VideoPlayer";
import type { PlayerEventBus } from "../../../player/src/core/plugin";
import { PlayerEventEnum } from "@/core/events";
import { parseSubtitle } from "@/utils/subtitle";
import { isBrowser, createLogger } from "@/utils";
import type { AiSubtitleBackendConfig } from "./aiSubtitleConfig";
import { aiSubtitleEntriesToItems } from "./aiSubtitleConfig";
import { AiSubtitleFetcher } from "./AiSubtitleFetcher";
import { AudioCapture } from "./asr/audioCapture";
import {
  createLocalAiProvider,
  LOCAL_AI_TRACK_ID,
} from './asr/localAiProvider';
import { createLocalAiWorkerProvider } from './asr/asrWorkerProvider';
import {
  createLegacyRemoteProvider,
  LEGACY_REMOTE_TRACK_ID,
} from "./remoteProvider";

/** 字幕插件日志（仅 error 级别的加载失败诊断） */
const logger = createLogger("SubtitlePlugin");

/** 翻译行样式类（双语拼装：原文 + 译文次级样式，设计文档 5.1） */
export const SUBTITLE_TRANSLATION_CLASS = "subtitle-translation";

/** 本地识别 partial 灰显样式类 */
const SUBTITLE_PARTIAL_CLASS = "subtitle-partial";

/** 增量拉取窗口（秒） */
const REMOTE_WINDOW_SECONDS = 60;

/** 增量预取提前量（秒）：播放头距已加载区间末尾不足该值时预取下一窗口 */
const REMOTE_PREFETCH_AHEAD = 15;

// ============================================
// 类型定义
// ============================================

/** 字幕插件配置 */
export interface SubtitlePluginConfig {
  /** 插件选项 */
  options?: PluginOptions;
  /** 字幕源列表 */
  sources?: SubtitleSource[];
  /** 默认语言 */
  defaultLang?: string;
  /** 是否可见 */
  visible?: boolean;
  /** 字体大小（px） */
  fontSize?: number;
  /** 字体颜色 */
  color?: string;
  /** 背景颜色（显式设置时优先于 backgroundOpacity；默认透明由不透明度计算） */
  backgroundColor?: string;
  /** 背景不透明度（0-1，默认 0.87；backgroundColor 未显式设置时生效） */
  backgroundOpacity?: number;
  /** 等比缩放：字号随播放器高度缩放（默认 true） */
  scale?: boolean;
  /** 淡入淡出：字幕切换时渐显（默认 false） */
  fade?: boolean;
  /** 水平对齐：-1 左 / 0 中 / 1 右（默认 0） */
  align?: number;
  /** 描边颜色 */
  strokeColor?: string;
  /** 描边宽度 */
  strokeWidth?: number;
  /** 位置：'bottom' | 'top' | 'middle' */
  position?: "bottom" | "top" | "middle";
  /** 底部偏移（px，控制栏隐藏时字幕距底部距离） */
  bottomOffset?: number;
  /**
   * AI 字幕后端接口配置（模式 B 旧路径，启用 AI 字幕模式时必填）
   * 与 remoteProvider 二选一：Provider 优先；旧配置自动映射为单轨 Provider
   */
  aiBackend?: AiSubtitleBackendConfig;
  /**
   * AI 字幕的视频 ID
   * 可静态字符串，或动态获取函数（推荐：从路由 / props 解析）
   */
  aiVideoId?: string | (() => string | undefined);
  /** 是否启用 AI 字幕模式（默认 false，启用后由 refreshAiSubtitle 拉取） */
  aiEnabled?: boolean;
  /** 模式 A：本地 AI 实时识别配置（传入即启用该模式的可用性，运行期经 startLocalAi/stopLocalAi 控制） */
  localAi?: LocalAiSubtitleConfig;
  /** 模式 B：服务端字幕 Provider（与 aiBackend 二选一，Provider 优先） */
  remoteProvider?: RemoteSubtitleProvider;
}

/** 字幕插件已解析配置 */
interface SubtitleResolvedConfig {
  sources: SubtitleSource[];
  defaultLang: string;
  visible: boolean;
  fontSize: number;
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  scale: boolean;
  fade: boolean;
  align: number;
  strokeColor: string;
  strokeWidth: number;
  position: "bottom" | "top" | "middle";
  bottomOffset: number;
}

// ============================================
// 字幕插件 API 接口
// ============================================

/** 字幕插件完整 API 接口 */
export interface SubtitlePluginAPI extends Plugin {
  /** 加载字幕源 */
  load(source: SubtitleSource): Promise<void>;
  /** 卸载字幕 */
  unload(): void;
  /** 显示字幕 */
  show(): void;
  /** 隐藏字幕 */
  hide(): void;
  /** 设置字幕样式 */
  setStyle(style: SubtitleStyle): void;
  /** 设置时间偏移（秒） */
  setOffset(offset: number): void;
  /** 获取当前字幕 */
  getCurrentSubtitle(): SubtitleItem | null;
  /** 跳转时更新字幕 */
  seek(time: number): void;
  /** 切换字幕语言（语言代码或轨道 id） */
  switchLanguage(lang: string): Promise<void>;
  /** 切换字幕开关 */
  toggle(): boolean;
  /** 设置字幕可见性 */
  setVisible(visible: boolean): void;
  /** 设置字体大小 */
  setFontSize(fontSize: number): void;
  /** 设置颜色 */
  setColor(color: string): void;
  /** 设置背景颜色 */
  setBackgroundColor(color: string): void;
  /** 设置背景不透明度（0-1，面板「背景不透明度」滑杆） */
  setBackgroundOpacity(opacity: number): void;
  /** 设置等比缩放（字号随播放器高度缩放） */
  setScale(scale: boolean): void;
  /** 设置淡入淡出（字幕切换时渐显） */
  setFade(fade: boolean): void;
  /** 设置水平对齐（-1 左 / 0 中 / 1 右） */
  setAlign(align: number): void;
  /** 设置描边 */
  setStroke(color?: string, width?: number): void;
  /** 设置位置 */
  setPosition(position?: "bottom" | "top" | "middle", offset?: number): void;
  /** 获取字幕状态 */
  getStatus(): {
    visible: boolean;
    currentLang: string | null;
    currentLabel: string | null;
    availableLangs: { lang: string; label: string }[];
    fontSize: number;
    color: string;
    position: string;
    itemCount: number;
    timeOffset: number;
    /** 当前字幕来源维度（设计文档 6.4） */
    source: "file" | "remote" | "local-ai" | null;
  };
  // ==================== AI 字幕 API（旧路径） ====================
  /** 启用 AI 字幕模式（启用后自动拉取一次） */
  enableAi(): void;
  /** 禁用 AI 字幕模式 */
  disableAi(): void;
  /** 查询 AI 字幕模式是否启用 */
  isAiEnabled(): boolean;
  /** 重新拉取 AI 字幕（后端未配置时静默 no-op） */
  refreshAiSubtitle(): Promise<void>;
  // ==================== 模式 A：本地实时识别 ====================
  /** 启动本地实时识别（幂等；模型懒加载，进度经 SUBTITLE_AI_STATUS 广播） */
  startLocalAi(lang?: string): Promise<void>;
  /** 停止本地识别并释放引擎资源（保留已识别字幕条目） */
  stopLocalAi(): void;
  /** 切换识别语言（换模型重启引擎，在途 partial 丢弃） */
  switchLocalAiLanguage(lang: string): Promise<void>;
  /** 获取本地识别完整转写（已保留的识别条目，含停止前的内容） */
  getFullTranscript(): SubtitleItem[];
  // ==================== 轨道注册表（模式 A/B/文件统一） ====================
  /** 列出可用字幕轨道（文件源 + 服务端轨 + 本地轨的并集） */
  listTracks(): SubtitleTrackInfo[];
  /** 激活某轨道（多轨并存时主字幕轨切换；local-ai 会启动本地识别） */
  activateTrack(trackId: string): Promise<void>;
  /** 设置翻译轨（双语拼装：主轨 + 译文轨叠加展示；null 清除） */
  setTranslationTrack(trackId: string | null): Promise<void>;
  // ==================== 模式 B：增量拉取 ====================
  /** 拉取指定时间区间的服务端字幕（增量窗口；整段 Provider 忽略区间） */
  refreshRange(from: number, to: number): Promise<void>;
}

// ============================================
// 字幕插件类
// ============================================

class SubtitlePluginClass implements SubtitlePluginAPI {
  readonly name = "subtitle";
  readonly version = "1.0.0";
  readonly description = "Subtitle rendering plugin";
  readonly options?: PluginOptions;

  private video: HTMLVideoElement | null = null;
  private subtitleWrap: HTMLElement | null = null;
  /** 字幕文本元素（拖拽手柄，注入 panel 内） */
  private subtitleEl: HTMLDivElement | null = null;
  /** 拖拽位置（panel 左上角 px，null = 未拖拽走档位基础位置） */
  private dragLeft: number | null = null;
  private dragTop: number | null = null;

  private config: SubtitleResolvedConfig;
  private currentSubtitle: ParsedSubtitle | null = null;
  private currentSource: SubtitleSource | null = null;
  private isVisible = true;
  private currentIndex = -1;
  private timeOffset = 0;

  // RAF 更新循环
  private rafId: number | null = null;

  // 事件取消订阅
  private unsubscribers: Array<() => void> = [];

  // ==================== AI 字幕（旧路径）相关 ====================
  /** 播放器事件总线引用（用于在 AI 字幕加载流程中向上广播状态） */
  private eventBus: PlayerEventBus | null = null;
  /** AI 字幕后端配置；为空表示未对接 */
  private aiBackend: AiSubtitleBackendConfig | null;
  /** AI 字幕 videoId 解析器（从字符串或函数归一） */
  private aiVideoIdResolver: (() => string | undefined) | null;
  /** AI 字幕模式开关 */
  private aiEnabled: boolean;
  /** AI 字幕获取器实例（懒构造，按需创建） */
  private aiFetcher: AiSubtitleFetcher | null = null;
  /** AI 字幕请求是否进行中（防并发刷新） */
  private aiLoading = false;

  // ==================== 模式 A（本地实时识别）相关 ====================
  /** 本地识别配置；为空表示模式 A 不可用 */
  private localAiConfig: LocalAiSubtitleConfig | null;
  /** 当前运行中的本地识别 Provider */
  private localAiProvider: LocalAiSubtitleProvider | null = null;
  /** 音频采集会话（AudioContext/Source 全实例复用） */
  private capture: AudioCapture | null = null;
  /** 当前识别语言 */
  private localAiLang = "";
  /** 本地识别是否运行中 */
  private localAiActive = false;
  /** 本地轨状态点（downloading/loading/ready/error，菜单状态点用） */
  private localAiStatus: SubtitleAiStatusPayload["phase"] | undefined =
    undefined;
  /** 本地轨字幕条目（负数 id 自增；停止后保留，切轨回来继续可用） */
  private localAiItems: SubtitleItem[] = [];
  /** 本地轨 id 序列（--seq 产出 -1, -2, …） */
  private localAiIdSeq = 0;
  /** 当前灰显中的 partial（不入 items，RAF 渲染时叠加） */
  private partialCue: SubtitleItem | null = null;

  // ==================== 模式 B（服务端）相关 ====================
  /** 使用方注入的 Provider（优先） */
  private readonly remoteProviderInjected: RemoteSubtitleProvider | null;
  /** 归一后的 Provider（注入的 或 旧 aiBackend 包装的；懒构造） */
  private remoteProvider: RemoteSubtitleProvider | null = null;
  /** 服务端轨道列表（listTracks 拉取后填充） */
  private remoteTracks: RemoteSubtitleTrack[] = [];
  /** 当前激活的服务端轨道 */
  private remoteActiveTrack: RemoteSubtitleTrack | null = null;
  /** 服务端主轨字幕条目（正数 id 自增） */
  private remoteItems: SubtitleItem[] = [];
  /** 服务端轨 id 序列（正数自增） */
  private remoteItemIdSeq = 0;
  /** 增量已加载区间 */
  private remoteLoadedRange: { from: number; to: number } | null = null;
  /** 主轨请求序号（竞态守卫：过期响应丢弃） */
  private remoteRequestId = 0;
  /** 主轨请求是否进行中 */
  private remoteLoading = false;

  // ==================== 翻译轨（双语拼装）====================
  /** 翻译轨字幕条目（整段拉取后按时间叠加到主轨条目下方） */
  private translationItems: SubtitleItem[] = [];
  /** 翻译轨 id 序列 */
  private translationItemIdSeq = 0;
  /** 翻译轨请求序号（竞态守卫） */
  private translationRequestId = 0;

  // ==================== 轨道注册表 =====================
  /** 当前激活的轨道 id（file:<lang> / remote:<trackId> / local-ai） */
  private activeTrackId: string | null = null;
  /** 渲染去重 key（RAF 逐帧调用，key 不变则跳过 DOM 写入） */
  private lastRenderedKey = "";

  constructor(config?: SubtitlePluginConfig) {
    this.config = {
      sources: config?.sources ?? [],
      defaultLang: config?.defaultLang ?? "",
      visible: config?.visible ?? true,
      fontSize: config?.fontSize ?? 24,
      color: config?.color ?? "#ffffff",
      backgroundColor: config?.backgroundColor ?? "transparent",
      backgroundOpacity: config?.backgroundOpacity ?? 0.87,
      scale: config?.scale ?? true,
      fade: config?.fade ?? false,
      align: config?.align ?? 0,
      strokeColor: config?.strokeColor ?? "#000000",
      strokeWidth: config?.strokeWidth ?? 2,
      position: config?.position ?? "bottom",
      // 底部基础偏移：控制栏隐藏时距底部距离（B 站式小间距，
      // 控制栏出现时由 CSS 抬升量避开，见 subtitlelayer.scss）
      bottomOffset: config?.bottomOffset ?? 12,
    };
    this.isVisible = this.config.visible;
    this.options = config?.options;

    // AI 字幕配置归一
    this.aiBackend = config?.aiBackend ?? null;
    if (typeof config?.aiVideoId === "function") {
      this.aiVideoIdResolver = config.aiVideoId;
    } else if (typeof config?.aiVideoId === "string") {
      const staticId = config.aiVideoId;
      this.aiVideoIdResolver = (): string => staticId;
    } else {
      this.aiVideoIdResolver = null;
    }
    this.aiEnabled = config?.aiEnabled ?? false;

    // 双模式配置归一
    this.localAiConfig = config?.localAi ?? null;
    this.remoteProviderInjected = config?.remoteProvider ?? null;
  }

  install(player: VideoPlayer): void {
    if (!isBrowser()) return;

    const events: PlayerEventBus = player.events;
    // 持有总线引用，供 AI 字幕加载流程向上广播 loading/ready/error
    this.eventBus = events;

    const unsubMounted = events.on(PlayerEventEnum.MOUNTED, (data): void => {
      if (data.video) {
        this.video = data.video;
      }

      if (data.container) {
        // 查找 .nova-subtitle-x-subtitle-panel 容器（SubtitleLayer 组件渲染的容器）
        this.subtitleWrap =
          data.container.querySelector(".nova-subtitle-x-subtitle-panel") ??
          null;

        // 在容器内创建字幕 DOM 元素（拖拽手柄：样式由 subtitlelayer.scss
        // 的 .subtitle-text 规则提供——fit-content 居中 + pointer-events:auto）
        if (this.subtitleWrap) {
          this.subtitleEl = document.createElement("div");
          this.subtitleEl.className = "subtitle-text";
          this.subtitleWrap.appendChild(this.subtitleEl);
          this.applyStyles();
          // 定位体系初始化：档位属性 + 偏移变量（控制栏抬升由 CSS 派生）
          this.applyPosition();
          this.bindDragHandlers();
        }
      }

      // 加载默认字幕
      if (this.config.sources.length > 0) {
        const defaultSource =
          this.config.sources.find((s) => s.default) ??
          this.config.sources.find((s) => s.lang === this.config.defaultLang) ??
          this.config.sources[0];
        if (defaultSource) {
          void this.load(defaultSource);
        }
      }

      // 启动 RAF 更新循环
      this.startUpdateLoop();

      // 已启用 AI 字幕模式：自动拉取一次
      // 后端未对接时 refreshAiSubtitle 会静默 no-op，不影响后续切换
      if (this.aiEnabled && this.aiBackend) {
        void this.refreshAiSubtitle();
      }

      // 模式 B：服务端轨列表异步加载（完成后广播 SUBTITLE_TRACKS_CHANGE）
      void this.loadRemoteTracks();

      // 广播初始轨道集合（文件源轨；本地轨/服务端轨就绪后会再次广播）
      this.broadcastTracksChange();
    });
    this.unsubscribers.push(unsubMounted);

    // 订阅 TIME_UPDATE 事件：字幕更新由 RAF 循环驱动；
    // 此事件用于增量拉取的播放头预取判断（模式 B）
    const unsubTimeUpdate = events.on(
      PlayerEventEnum.TIME_UPDATE,
      (data): void => {
        if (data && typeof data.time === "number") {
          this.maybePrefetchNextRange(data.time);
        }
      },
    );
    this.unsubscribers.push(unsubTimeUpdate);

    // 订阅 SEEK_END 事件：跳转时更新字幕
    const unsubSeekEnd = events.on(PlayerEventEnum.SEEK_END, (): void => {
      this.currentIndex = -1; // 重置索引，强制下次更新刷新字幕
      // 采集链时间锚点失效：seek 后下一音频块重新锚定（设计文档 4.7）
      this.capture?.reanchor();
    });
    this.unsubscribers.push(unsubSeekEnd);

    // 订阅 RATE_CHANGE 事件：采集链时间换算依赖倍速，变化后重锚点
    const unsubRateChange = events.on(PlayerEventEnum.RATE_CHANGE, (): void => {
      this.capture?.reanchor();
    });
    this.unsubscribers.push(unsubRateChange);

    // 订阅 SUBTITLE_TOGGLE 事件：同步字幕可见性
    // payload 携带目标值（VideoPlayer.setSubtitleVisible 的「设置」语义），
    // 必须按 payload 应用而非翻转——初始化状态同步也会走此事件，
    // 若误用翻转语义会把字幕意外关闭（isVisible 错位）
    const unsubToggle = events.on(
      PlayerEventEnum.SUBTITLE_TOGGLE,
      (data): void => {
        if (data && typeof data.visible === "boolean") {
          this.setVisible(data.visible);
        }
      },
    );
    this.unsubscribers.push(unsubToggle);

    // 订阅 SUBTITLE_SWITCH 事件：切换字幕语言（语言代码或轨道 id）
    const unsubSwitch = events.on(
      PlayerEventEnum.SUBTITLE_SWITCH,
      (data): void => {
        void this.switchLanguage(data.lang);
      },
    );
    this.unsubscribers.push(unsubSwitch);
  }

  uninstall(): void {
    // 停止 RAF 更新循环
    this.stopUpdateLoop();

    // 取消所有事件订阅
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];

    // 移除字幕 DOM 元素
    if (this.subtitleEl && this.subtitleWrap) {
      this.subtitleWrap.removeChild(this.subtitleEl);
    }
    this.subtitleEl = null;

    this.dragLeft = null;
    this.dragTop = null;

    this.subtitleWrap = null;
    this.video = null;
    this.currentSubtitle = null;
    this.currentSource = null;

    // 清理本地识别运行态（停止识别 + 释放采集链）
    this.stopLocalAi();
    this.capture?.dispose();
    this.capture = null;
    this.localAiProvider = null;
    this.localAiItems = [];
    this.localAiIdSeq = 0;
    this.partialCue = null;
    this.localAiStatus = undefined;

    // 清理模式 B 运行态
    this.remoteItems = [];
    this.remoteItemIdSeq = 0;
    this.remoteLoadedRange = null;
    this.remoteRequestId++;
    this.remoteActiveTrack = null;
    this.translationItems = [];
    this.activeTrackId = null;
    this.lastRenderedKey = "";

    // 清理 AI 字幕运行态
    this.eventBus = null;
    this.aiFetcher = null;
    this.aiLoading = false;
  }

  // ==================== RAF 更新循环 ====================

  /**
   * 启动 RAF 更新循环
   */
  private startUpdateLoop(): void {
    const loop = (): void => {
      this.updateSubtitle();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * 停止 RAF 更新循环
   */
  private stopUpdateLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ==================== 二分查找字幕 ====================

  /**
   * 二分查找：在按 startTime 排序的字幕数组中，
   * 找到当前时间应显示的字幕索引
   *
   * @param items - 按 startTime 升序排列的字幕数组
   * @param currentTime - 当前播放时间（秒）
   * @returns 匹配的字幕索引，未找到返回 -1
   */
  private binarySearchSubtitle(
    items: SubtitleItem[],
    currentTime: number,
  ): number {
    if (items.length === 0) return -1;

    let low = 0;
    let high = items.length - 1;

    // 二分查找最后一个 startTime <= currentTime 的项
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (items[mid].startTime <= currentTime) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // high 是最后一个 startTime <= currentTime 的索引
    // 检查该字幕是否仍在显示时间范围内
    if (
      high >= 0 &&
      high < items.length &&
      currentTime >= items[high].startTime &&
      currentTime <= items[high].endTime
    ) {
      return high;
    }

    return -1;
  }

  /**
   * 有序插入：按 startTime 二分定位插入点
   * 本地识别/增量拉取按播放顺序产出，seek 后可能乱序；
   * 插入而非 push 保证 items 升序（二分查找渲染管线的前提，设计文档 4.6）
   */
  private insertOrdered(items: SubtitleItem[], item: SubtitleItem): void {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (items[mid].startTime <= item.startTime) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    items.splice(low, 0, item);
  }

  // ==================== 字幕更新 ====================

  /**
   * 更新字幕显示（由 RAF 驱动）
   * 渲染优先级：final 条目 > partial 灰显（被 final 覆盖）> 清空；
   * 翻译轨启用时在 final 条目下方叠加译文行（双语拼装）
   */
  private updateSubtitle(): void {
    if (!this.subtitleEl) return;

    if (!this.isVisible || !this.currentSubtitle || !this.video) {
      if (this.subtitleEl.innerHTML !== "") {
        this.subtitleEl.innerHTML = "";
        this.lastRenderedKey = "";
      }
      return;
    }

    const currentTime = this.video.currentTime + this.timeOffset;
    const items = this.currentSubtitle.items;

    // 使用二分查找定位当前字幕
    const activeIndex = this.binarySearchSubtitle(items, currentTime);
    this.currentIndex = activeIndex;
    const activeItem = activeIndex >= 0 ? items[activeIndex] : null;

    // partial 灰显：无 final 命中且 partial 覆盖当前时间
    const partial = this.partialCue;
    const partialActive =
      activeItem === null &&
      partial !== null &&
      currentTime >= partial.startTime &&
      currentTime <= partial.endTime;

    // 翻译行：主轨条目命中时查译文（同一时间轴二分）
    let translationItem: SubtitleItem | null = null;
    if (activeItem !== null && this.translationItems.length > 0) {
      const translationIndex = this.binarySearchSubtitle(
        this.translationItems,
        currentTime,
      );
      translationItem =
        translationIndex >= 0 ? this.translationItems[translationIndex] : null;
    }

    // 渲染 key：final/partial/译文组合任一变化才写 DOM（RAF 逐帧调用，避免高频写入）
    const renderKey =
      activeItem !== null
        ? `f:${activeItem.id}:${translationItem !== null ? `t${translationItem.id}` : ""}`
        : partialActive && partial !== null
          ? `p:${partial.text}`
          : "";
    if (renderKey === this.lastRenderedKey) return;
    this.lastRenderedKey = renderKey;

    // 淡入淡出：内容变化时重触发渐显动画（移除→强制重排→回加）
    if (this.config.fade && renderKey !== "") {
      this.subtitleEl.classList.remove("subtitle-fade");
      void this.subtitleEl.offsetWidth;
      this.subtitleEl.classList.add("subtitle-fade");
    }

    if (activeItem !== null) {
      this.subtitleEl.innerHTML =
        translationItem !== null
          ? `${activeItem.text}<br><span class="${SUBTITLE_TRANSLATION_CLASS}" style="opacity:.8;font-size:.85em">${translationItem.text}</span>`
          : activeItem.text;
    } else if (partialActive && partial !== null) {
      // 临时灰显：文本仍在变动，被后续 finalCues 覆盖
      this.subtitleEl.innerHTML = `<span class="${SUBTITLE_PARTIAL_CLASS}" style="opacity:.55">${partial.text}</span>`;
    } else {
      this.subtitleEl.innerHTML = "";
    }
  }

  // ==================== 样式管理 ====================

  /**
   * 应用样式到字幕元素
   */
  private applyStyles(): void {
    if (!this.subtitleEl) return;

    // 字号：等比缩放开启时用 cqh 单位（容器高度百分比，基准 500px 高，
    // 播放器尺寸变化字号随之缩放，下限 12px）；关闭时固定 px
    if (this.config.scale) {
      this.subtitleEl.style.fontSize = `max(12px, ${(this.config.fontSize / 5).toFixed(2)}cqh)`;
    } else {
      this.subtitleEl.style.fontSize = `${this.config.fontSize}px`;
    }
    this.subtitleEl.style.color = this.config.color;
    // 背景：显式 backgroundColor（非 transparent）优先（兼容旧配置），
    // 否则黑底 + 不透明度（字幕设置面板「背景不透明度」实时生效）
    this.subtitleEl.style.backgroundColor =
      this.config.backgroundColor !== "transparent"
        ? this.config.backgroundColor
        : `rgba(0, 0, 0, ${this.config.backgroundOpacity})`;
    this.subtitleEl.style.textShadow = `0 0 ${this.config.strokeWidth}px ${this.config.strokeColor}`;
    this.subtitleEl.style.opacity = this.isVisible ? "1" : "0";
    // 淡入淡出：字幕切换时渐显（动画重触发在 updateSubtitle，keyframes 在 scss）
    if (this.config.fade) {
      this.subtitleEl.classList.add("subtitle-fade");
    } else {
      this.subtitleEl.classList.remove("subtitle-fade");
    }

    this.applyPosition();
  }

  /**
   * 应用位置到字幕容器
   *
   * 属性/变量驱动（唯一定位 owner，杜绝与组件层 inline 定位冲突）：
   * - 档位写 panel 的 data-position 属性（subtitlelayer.scss 按属性
   *   选择器派生 top/middle/bottom 基础定位）
   * - 底部偏移写 --subtitle-offset 变量（config.bottomOffset）
   * - 控制栏抬升不在此处理：subtitlelayer.scss 以
   *   .nova-player-container 属性选择器（data-ctrl-hidden / data-screen）
   *   纯 CSS 派生，无 JS 参与
   * - 拖拽位置（dragLeft/dragTop）写 inline left/top 接管档位定位
   */
  private applyPosition(): void {
    if (!this.subtitleWrap) return;

    // 档位属性（middle 为插件档位名，center 为组件档位名，统一归一）
    this.subtitleWrap.dataset.position = this.config.position;

    // 水平对齐属性（-1 左 / 0 中 / 1 右，subtitlelayer.scss 按属性派生）
    this.subtitleWrap.dataset.align = String(this.config.align);

    // 底部偏移变量
    this.subtitleWrap.style.setProperty(
      "--subtitle-offset",
      `${this.config.bottomOffset}px`,
    );

    // 拖拽接管定位：inline left/top 写在字幕文本小块上
    // （panel 档位定位由 CSS 保持不动）
    if (this.subtitleEl) {
      if (this.dragLeft !== null && this.dragTop !== null) {
        this.subtitleEl.style.left = `${this.dragLeft}px`;
        this.subtitleEl.style.top = `${this.dragTop}px`;
        this.subtitleEl.style.bottom = "auto";
        this.subtitleEl.style.transform = "none";
      } else {
        // 回档位基础位置（清 inline 接管痕迹，恢复 CSS 基础定位）
        this.subtitleEl.style.left = "";
        this.subtitleEl.style.top = "";
        this.subtitleEl.style.bottom = "";
        this.subtitleEl.style.transform = "";
      }
    }
  }

  /**
   * 绑定字幕拖拽（手柄 = 字幕文本元素，仅文本小块区域可拖不挡视频）
   *
   * 拖拽作用于字幕文本小块（subtitleEl）而非 panel：panel 保持
   * CSS 档位定位（data-position）不动，拖拽位置以 text 相对 panel
   * 的 inline left/top 接管其基础定位（bottom:0 + 居中）。
   * 按下移动超阈值进入拖拽；位置 clamp 在 panel 内；
   * 双击文本重置回档位基础位置。
   * 事件挂 subtitleEl（随面板销毁自动释放，unbind 不需要）
   */
  private bindDragHandlers(): void {
    const panel = this.subtitleWrap;
    const handle = this.subtitleEl;
    if (!panel || !handle) return;

    /** 拖拽起点（客户端坐标） */
    let startX = 0;
    let startY = 0;
    /** 拖拽起点文本块位置（相对 panel，px） */
    let startLeft = 0;
    let startTop = 0;
    /** 是否已越过拖拽阈值 */
    let moved = false;

    handle.addEventListener("pointerdown", (event: PointerEvent): void => {
      if (event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      const panelRect = panel.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      startLeft = handleRect.left - panelRect.left;
      startTop = handleRect.top - panelRect.top;
      moved = false;
      handle.setPointerCapture(event.pointerId);
    });

    handle.addEventListener("pointermove", (event: PointerEvent): void => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!moved) {
        // 阈值内不动（点击/微抖不算拖拽）
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        moved = true;
      }
      // clamp 域为字幕层容器（wrap，覆盖整个视频区域）；
      // text 的 left/top 相对 panel（高度 0 的基准线），边界需按
      // panel 原点在 wrap 内的偏移平移：[-off, wrapSize - handleSize - off]
      const wrap = panel.parentElement;
      if (!wrap) return;
      const wrapRect = wrap.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      const offLeft = panelRect.left - wrapRect.left;
      const offTop = panelRect.top - wrapRect.top;
      const nextLeft = Math.max(
        -offLeft,
        Math.min(startLeft + dx, wrapRect.width - handleRect.width - offLeft),
      );
      const nextTop = Math.max(
        -offTop,
        Math.min(startTop + dy, wrapRect.height - handleRect.height - offTop),
      );
      this.dragLeft = nextLeft;
      this.dragTop = nextTop;
      // 拖拽中直接写 text inline（不走路由，跟手优先）
      handle.style.left = `${nextLeft}px`;
      handle.style.top = `${nextTop}px`;
      handle.style.bottom = "auto";
      handle.style.transform = "none";
    });

    const endDrag = (event: PointerEvent): void => {
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);

    // 双击重置：清拖拽位置，回档位基础位置
    handle.addEventListener("dblclick", (): void => {
      this.dragLeft = null;
      this.dragTop = null;
      this.applyPosition();
    });
  }

  // ==================== 轨道注册表 ====================

  /** 广播轨道集合变化（菜单轨道列表渲染数据源） */
  private broadcastTracksChange(): void {
    this.eventBus?.emit(PlayerEventEnum.SUBTITLE_TRACKS_CHANGE, {
      tracks: this.listTracks(),
    });
  }

  /** 归一服务端 Provider：注入的优先，旧 aiBackend 包装为单轨 Provider（懒构造） */
  private getRemoteProvider(): RemoteSubtitleProvider | null {
    if (this.remoteProvider) return this.remoteProvider;
    if (this.remoteProviderInjected) {
      this.remoteProvider = this.remoteProviderInjected;
      return this.remoteProvider;
    }
    if (this.aiBackend) {
      this.remoteProvider = createLegacyRemoteProvider(
        this.aiBackend,
        (): {
          videoId?: string;
          lang?: string;
          duration?: number;
        } => ({
          videoId: this.aiVideoIdResolver?.() ?? undefined,
          lang: this.config.defaultLang || undefined,
          duration: this.video?.duration ?? undefined,
        }),
      );
      return this.remoteProvider;
    }
    return null;
  }

  /** 加载服务端轨道列表（listTracks 未提供时保持单轨语义） */
  private async loadRemoteTracks(): Promise<void> {
    const provider = this.getRemoteProvider();
    if (!provider?.listTracks) return;
    try {
      const tracks = await provider.listTracks();
      this.remoteTracks = Array.isArray(tracks) ? tracks : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Remote subtitle track list failed: ${message}`);
      this.remoteTracks = [];
      return;
    }
    this.broadcastTracksChange();
  }

  /**
   * 列出可用字幕轨道（文件源 + 服务端轨 + 本地轨的并集）
   */
  listTracks(): SubtitleTrackInfo[] {
    const tracks: SubtitleTrackInfo[] = [];

    // 文件源轨
    for (const source of this.config.sources) {
      tracks.push({
        trackId: `file:${source.lang}`,
        lang: source.lang,
        label: source.label,
        source: "file",
      });
    }

    // 服务端轨
    for (const track of this.remoteTracks) {
      tracks.push({
        trackId: `remote:${track.trackId}`,
        lang: track.lang,
        label: track.label,
        source: "remote",
        kind: track.kind,
      });
    }

    // 本地实时识别轨（配置可用即列出；徽标 + 状态点由菜单渲染）
    if (this.localAiConfig) {
      tracks.push({
        trackId: LOCAL_AI_TRACK_ID,
        lang: this.localAiLang || this.localAiConfig.defaultLang,
        label: "AI Live",
        source: "local-ai",
        isLive: true,
        status: this.localAiStatus,
      });
    }

    return tracks;
  }

  /**
   * 激活某轨道（主字幕轨切换）
   * local-ai → 启动本地识别；remote:* → 拉取服务端轨；file:* → 加载文件源
   */
  async activateTrack(trackId: string): Promise<void> {
    if (!isBrowser()) return;
    if (!this.eventBus) {
      logger.warn("Subtitle plugin is not installed");
      return;
    }

    if (trackId === LOCAL_AI_TRACK_ID) {
      await this.startLocalAi();
      return;
    }
    if (trackId.startsWith("remote:")) {
      await this.activateRemoteTrack(trackId.slice("remote:".length));
      return;
    }
    if (trackId.startsWith("file:")) {
      await this.switchLanguage(trackId);
      return;
    }
    logger.warn(`Unknown subtitle track: ${trackId}`);
  }

  /** 激活服务端轨道：切换 Provider 目标轨并按增量能力拉取 */
  private async activateRemoteTrack(remoteId: string): Promise<void> {
    const provider = this.getRemoteProvider();
    const bus = this.eventBus;
    if (!provider) {
      bus?.emit(PlayerEventEnum.SUBTITLE_LIST_CHANGE, {
        count: 0,
        status: "error",
      });
      return;
    }

    // 轨道信息（listTracks 未返回时合成为单轨）
    const track: RemoteSubtitleTrack = this.remoteTracks.find(
      (t) => t.trackId === remoteId,
    ) ?? {
      trackId: remoteId,
      lang: this.config.defaultLang || "ai",
      label: "AI Subtitle",
      kind: "original",
    };

    await provider.activateTrack?.(remoteId);
    this.remoteActiveTrack = track;
    // 切轨 = 新数据集：重置主轨数据
    this.remoteItems = [];
    this.remoteItemIdSeq = 0;
    this.remoteLoadedRange = null;
    this.remoteRequestId++;
    this.activeTrackId = `remote:${remoteId}`;

    if (provider.incremental) {
      // 增量模式：先拉首个窗口，后续由播放头预取推进
      await this.refreshRange(0, REMOTE_WINDOW_SECONDS);
    } else {
      // 整段模式：一次性拉全
      await this.refreshRange(0, Number.POSITIVE_INFINITY);
    }
  }

  /** 增量预取：播放头接近已加载区间末尾时拉取下一窗口 */
  private maybePrefetchNextRange(time: number): void {
    const provider = this.getRemoteProvider();
    if (!provider?.incremental) return;
    if (!this.activeTrackId?.startsWith("remote:")) return;
    const loaded = this.remoteLoadedRange;
    if (!loaded || this.remoteLoading) return;
    if (time <= loaded.to - REMOTE_PREFETCH_AHEAD) return;
    const duration = this.video?.duration ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(loaded.to) || loaded.to >= duration) return;
    void this.refreshRange(loaded.to, loaded.to + REMOTE_WINDOW_SECONDS);
  }

  /**
   * 拉取指定时间区间的服务端字幕（设计文档 5.2：增量窗口拉取）
   * 区间按序追加（有序插入容忍服务端乱序返回）；请求序号丢弃过期响应
   */
  async refreshRange(from: number, to: number): Promise<void> {
    if (!isBrowser()) return;
    const provider = this.getRemoteProvider();
    if (!provider || !this.remoteActiveTrack) return;
    if (this.remoteLoading) return;

    const bus = this.eventBus;
    const requestId = ++this.remoteRequestId;
    const isFirstWindow = this.remoteLoadedRange === null;
    this.remoteLoading = true;

    if (isFirstWindow) {
      bus?.emit(PlayerEventEnum.SUBTITLE_LIST_CHANGE, {
        count: 0,
        status: "loading",
      });
    }

    try {
      // 多轨 Provider 的 fetch 作用于「当前激活轨」：拉取前重申主轨
      //（译文轨整段拉取会临时切换 Provider 内部轨道，见 setTranslationTrack）
      await provider.activateTrack?.(this.remoteActiveTrack.trackId);

      const range =
        provider.incremental && Number.isFinite(to) ? { from, to } : undefined;
      const entries: AiSubtitleEntry[] = await provider.fetch(range);

      // 竞态守卫：过期响应丢弃
      if (requestId !== this.remoteRequestId) return;

      const startId = this.remoteItemIdSeq + 1;
      const items = aiSubtitleEntriesToItems(entries, startId);
      this.remoteItemIdSeq = startId + entries.length - 1;
      for (const item of items) {
        this.insertOrdered(this.remoteItems, item);
      }
      this.remoteLoadedRange = { from, to };

      // 激活轨即当前主轨时接入渲染管线
      if (
        this.remoteActiveTrack !== null &&
        this.activeTrackId === `remote:${this.remoteActiveTrack.trackId}`
      ) {
        this.currentSubtitle = {
          format: SubtitleFormat.UNKNOWN,
          items: this.remoteItems,
        };
        this.currentSource = {
          src: "",
          lang: this.remoteActiveTrack.lang,
          label: this.remoteActiveTrack.label,
        };
        this.currentIndex = -1;
        this.lastRenderedKey = "";
      }

      bus?.emit(PlayerEventEnum.SUBTITLE_LIST_CHANGE, {
        count: this.remoteItems.length,
        status: "ready",
      });
      bus?.emit(
        PlayerEventEnum.SUBTITLE_LANG_CHANGE,
        this.remoteActiveTrack.lang,
      );
    } catch (error) {
      if (requestId !== this.remoteRequestId) return;
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Remote subtitle fetch failed: ${message}`);
      bus?.emit(PlayerEventEnum.SUBTITLE_LIST_CHANGE, {
        count: 0,
        status: "error",
      });
    } finally {
      this.remoteLoading = false;
    }
  }

  /**
   * 设置翻译轨（双语拼装：主轨 + 译文轨叠加展示）
   * 译文轨整段拉取一次（增量窗口仅作用于主轨），按时间轴二分匹配叠加
   */
  async setTranslationTrack(trackId: string | null): Promise<void> {
    if (!isBrowser()) return;

    if (!trackId) {
      this.translationItems = [];
      this.lastRenderedKey = "";
      return;
    }

    const provider = this.getRemoteProvider();
    if (!provider) return;

    const remoteId = trackId.startsWith("remote:")
      ? trackId.slice("remote:".length)
      : trackId;
    const requestId = ++this.translationRequestId;

    try {
      await provider.activateTrack?.(remoteId);
      // 译文轨整段拉取（忽略增量区间）
      const entries = await provider.fetch();
      if (requestId !== this.translationRequestId) return;

      const startId = this.translationItemIdSeq + 1;
      const items = aiSubtitleEntriesToItems(entries, startId);
      this.translationItemIdSeq = startId + entries.length - 1;
      // 按时间排序保证二分匹配的前提（容忍服务端乱序返回）
      items.sort((a, b): number => a.startTime - b.startTime);
      this.translationItems = items;
      this.lastRenderedKey = "";

      // 恢复主轨指向（后续增量窗口拉取继续作用于主轨）
      if (this.remoteActiveTrack) {
        await provider.activateTrack?.(this.remoteActiveTrack.trackId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Translation track fetch failed: ${message}`);
    }
  }

  // ==================== 模式 A：本地实时识别 ====================

  /**
   * 处理本地识别 cue 推送：
   * - final：负数 id 重排 + 有序插入 + 广播 SUBTITLE_CUE
   * - partial：保存当前值并广播（不入 items，RAF 渲染时灰显）
   */
  private handleLocalCue(event: SubtitleCueEvent): void {
    for (const cue of event.finalCues) {
      const item: SubtitleItem = { ...cue, id: --this.localAiIdSeq };
      this.insertOrdered(this.localAiItems, item);
      this.eventBus?.emit(PlayerEventEnum.SUBTITLE_CUE, item);
    }
    this.partialCue = event.partialCue ?? null;
    this.lastRenderedKey = "";
    this.eventBus?.emit(PlayerEventEnum.SUBTITLE_PARTIAL, this.partialCue);
  }

  /**
   * 启动本地实时识别（幂等；模型懒加载，进度经 SUBTITLE_AI_STATUS 广播）
   * 失败（无引擎/环境不支持/采集异常）自动降级模式 B（设计文档 6.5）
   */
  async startLocalAi(lang?: string): Promise<void> {
    if (!isBrowser()) return;
    if (!this.eventBus) {
      logger.warn("Subtitle plugin is not installed");
      return;
    }

    const cfg = this.localAiConfig;
    if (
      !this.video ||
      !cfg ||
      (!cfg.provider && !cfg.engines && !cfg.engineKind)
    ) {
      await this.fallbackToRemote(
        this.video
          ? "local AI is not configured"
          : "video element is not ready",
      );
      return;
    }

    const targetLang = lang ?? (this.localAiLang || cfg.defaultLang);

    // 幂等：同语言运行中直接返回；异语言走切换（停引擎换模型重启）
    if (this.localAiActive) {
      if (targetLang === this.localAiLang) return;
      await this.switchLocalAiLanguage(targetLang);
      return;
    }

    const bus = this.eventBus;
    this.localAiStatus = "loading";
    bus.emit(PlayerEventEnum.SUBTITLE_AI_STATUS, { phase: "loading" });
    this.broadcastTracksChange();

    try {
      // 组装 Provider：自定义 Provider > Worker 引擎（engineKind）> 主线程 engines
      let provider = cfg.provider ?? null;
      // Worker 引擎：VAD + 推理全在 ASR 专用 Worker（主线程零阻塞），
      // 模型异步加载，就绪/失败经 onStatus 回调上报（本方法不阻塞等待）
      const usesWorkerEngine = !provider && !!cfg.engineKind;
      if (!provider && cfg.engineKind) {
        provider = createLocalAiWorkerProvider({
          engineKind: cfg.engineKind,
          lang: targetLang,
          modelBasePath: cfg.modelBasePath,
          wasmBasePath: cfg.wasmBasePath,
          confidenceThreshold: cfg.confidenceThreshold,
        });
      }
      if (!provider) {
        const engines = cfg.engines;
        const engine: AsrEngine | null =
          engines?.[targetLang] ?? engines?.[cfg.defaultLang] ?? null;
        if (!engine) {
          throw new Error(
            `no ASR engine available for language "${targetLang}"`,
          );
        }
        // 引擎初始化（模型懒加载；真实引擎在此阶段广播下载进度）
        await engine.init({
          lang: targetLang,
          modelBasePath: cfg.modelBasePath,
          wasmBasePath: cfg.wasmBasePath,
        });
        const engineStatus = engine.getStatus();
        if (engineStatus.state === "error") {
          throw new Error(engineStatus.message ?? "engine init failed");
        }
        provider = createLocalAiProvider({
          engine,
          lang: targetLang,
          confidenceThreshold: cfg.confidenceThreshold,
          maxSegmentSeconds: cfg.maxSegmentSeconds,
        });
      }

      // Worker 引擎的状态联动：就绪 → ready 广播；失败 → 降级模式 B
      // （主线程引擎同步就绪，无需挂此回调）
      if (usesWorkerEngine) {
        const workerProvider = provider;
        provider.onStatus = (phase, message): void => {
          if (phase === "ready") {
            // 就绪前已被停止/切换（快速开关场景）则忽略
            if (!this.localAiActive || this.localAiProvider !== workerProvider) {
              return;
            }
            this.localAiStatus = "ready";
            bus.emit(PlayerEventEnum.SUBTITLE_AI_STATUS, { phase: "ready" });
            this.broadcastTracksChange();
            return;
          }
          void this.fallbackToRemote(message ?? "worker ASR engine failed");
        };
      }

      // 采集链（AudioContext/Source 全实例复用；CORS 静音数据时上报并降级）
      if (!this.capture) {
        this.capture = new AudioCapture(this.video, {
          onSilenceError: (message): void => {
            void this.fallbackToRemote(message);
          },
        });
      }
      const audioStream = await this.capture.start();

      const context: SubtitleEngineContext = {
        audioStream,
        events: bus,
        getMediaTime: (): number => this.video?.currentTime ?? 0,
      };

      provider.onCue = (event): void => this.handleLocalCue(event);
      provider.start(context);

      this.localAiProvider = provider;
      this.localAiLang = targetLang;
      this.localAiActive = true;
      // Worker 引擎保持 loading（模型异步加载，onStatus('ready') 时翻转）；
      // 主线程引擎同步就绪，立即 ready
      if (!usesWorkerEngine) {
        this.localAiStatus = "ready";
      }

      // 激活为当前主字幕轨（复用现有 RAF + 二分查找渲染管线；
      // items 引用保持 localAiItems，增量 append 后 RAF 逐帧可见）
      this.activeTrackId = LOCAL_AI_TRACK_ID;
      this.currentSubtitle = {
        format: SubtitleFormat.UNKNOWN,
        items: this.localAiItems,
      };
      this.currentSource = {
        src: "",
        lang: LOCAL_AI_TRACK_ID,
        label: `AI Live (${targetLang})`,
      };
      this.currentIndex = -1;
      this.lastRenderedKey = "";

      if (!usesWorkerEngine) {
        bus.emit(PlayerEventEnum.SUBTITLE_AI_STATUS, { phase: "ready" });
      }
      bus.emit(PlayerEventEnum.SUBTITLE_LANG_CHANGE, LOCAL_AI_TRACK_ID);
      this.broadcastTracksChange();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to start local AI subtitle: ${message}`);
      await this.fallbackToRemote(message);
    }
  }

  /**
   * 停止本地识别并释放引擎资源
   * 已识别条目保留（localAiItems 不清空），切回本地轨时继续可用
   */
  stopLocalAi(): void {
    if (!this.localAiActive) return;
    this.localAiProvider?.stop();
    this.localAiProvider = null;
    this.capture?.stop();
    this.localAiActive = false;
    this.localAiStatus = undefined;
    this.partialCue = null;
    this.lastRenderedKey = "";
    this.eventBus?.emit(PlayerEventEnum.SUBTITLE_PARTIAL, null);
    this.broadcastTracksChange();
  }

  /**
   * 切换识别语言：停当前引擎实例 → 换模型重启（在途 partial 丢弃）
   */
  async switchLocalAiLanguage(lang: string): Promise<void> {
    if (this.localAiActive && lang === this.localAiLang) return;
    this.stopLocalAi();
    await this.startLocalAi(lang);
  }

  /**
   * 获取本地识别完整转写（已保留的识别条目快照，供外挂功能使用）
   */
  getFullTranscript(): SubtitleItem[] {
    return [...this.localAiItems];
  }

  /**
   * 降级链（设计文档 6.5）：
   * 模式 A 不可用/失败 → 广播 error → 尝试模式 B（remoteProvider/aiBackend）
   * → 模式 B 也未配置 → 维持文件源/无字幕 + warning
   */
  private async fallbackToRemote(reason: string): Promise<void> {
    const bus = this.eventBus;
    // 半启动的本地识别先停（保留已产出条目）
    this.stopLocalAi();
    this.localAiStatus = "error";
    // 降级原因经 SUBTITLE_AI_STATUS 广播，避免静默失败
    bus?.emit(PlayerEventEnum.SUBTITLE_AI_STATUS, {
      phase: "error",
      message: reason,
    });
    this.broadcastTracksChange();

    const provider = this.getRemoteProvider();
    if (provider) {
      logger.warn(
        `Local AI subtitle unavailable (${reason}), falling back to remote subtitle`,
      );
      try {
        await this.loadRemoteTracks();
        const first = this.remoteTracks[0];
        if (first) {
          await this.activateRemoteTrack(first.trackId);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Remote subtitle fallback failed: ${message}`);
      }
    } else {
      logger.warn("No AI subtitle source available, keeping current subtitle");
    }
  }

  // ==================== 公共 API ====================

  /**
   * 加载字幕源
   */
  async load(source: SubtitleSource): Promise<void> {
    try {
      const response = await fetch(source.src);
      if (!response.ok) {
        throw new Error(`Failed to load subtitle: ${response.status}`);
      }

      const content = await response.text();
      const parsed = parseSubtitle(content);

      this.currentSubtitle = parsed;
      this.currentSource = source;
      this.currentIndex = -1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Subtitle load failed: ${message}`);
    }
  }

  /**
   * 卸载字幕
   */
  unload(): void {
    this.currentSubtitle = null;
    this.currentSource = null;
    this.currentIndex = -1;
    this.activeTrackId = null;
    this.lastRenderedKey = "";
    if (this.subtitleEl) {
      this.subtitleEl.innerHTML = "";
    }
  }

  /**
   * 显示字幕
   */
  show(): void {
    this.isVisible = true;
    if (this.subtitleEl) {
      this.subtitleEl.style.opacity = "1";
    }
  }

  /**
   * 隐藏字幕
   */
  hide(): void {
    this.isVisible = false;
    if (this.subtitleEl) {
      this.subtitleEl.style.opacity = "0";
      this.subtitleEl.innerHTML = "";
    }
  }

  /**
   * 设置字幕样式
   */
  setStyle(style: SubtitleStyle): void {
    if (style.fontName) {
      this.subtitleEl?.style.setProperty("font-family", style.fontName);
    }
    if (style.fontSize !== undefined) {
      this.config.fontSize = Math.max(12, Math.min(72, style.fontSize));
    }
    if (style.primaryColor) {
      this.config.color = style.primaryColor;
    }
    if (style.outlineColor) {
      this.config.strokeColor = style.outlineColor;
    }
    if (style.outlineWidth !== undefined) {
      this.config.strokeWidth = Math.max(0, Math.min(5, style.outlineWidth));
    }
    if (style.bold !== undefined) {
      this.subtitleEl?.style.setProperty(
        "font-weight",
        style.bold ? "bold" : "normal",
      );
    }
    if (style.italic !== undefined) {
      this.subtitleEl?.style.setProperty(
        "font-style",
        style.italic ? "italic" : "normal",
      );
    }
    if (style.underline !== undefined) {
      this.subtitleEl?.style.setProperty(
        "text-decoration",
        style.underline ? "underline" : "none",
      );
    }
    this.applyStyles();
  }

  /**
   * 设置时间偏移（秒）
   */
  setOffset(offset: number): void {
    this.timeOffset = offset;
    this.currentIndex = -1; // 重置索引，强制刷新
    this.lastRenderedKey = "";
  }

  /**
   * 获取当前字幕
   */
  getCurrentSubtitle(): SubtitleItem | null {
    if (!this.currentSubtitle || this.currentIndex < 0) return null;
    return this.currentSubtitle.items[this.currentIndex] ?? null;
  }

  /**
   * 跳转时更新字幕
   */
  seek(time: number): void {
    this.currentIndex = -1; // 重置索引，强制下次更新刷新字幕
    if (this.video) {
      this.video.currentTime = time;
    }
  }

  /**
   * 切换字幕语言
   * 支持三种形态：轨道 id（local-ai / remote:* / file:*）路由到轨道激活；
   * 语言代码走文件源切换
   */
  async switchLanguage(lang: string): Promise<void> {
    if (
      lang === LOCAL_AI_TRACK_ID ||
      lang.startsWith("remote:") ||
      lang.startsWith("file:")
    ) {
      await this.activateTrack(lang);
      return;
    }
    const source = this.config.sources.find((s) => s.lang === lang);
    if (source) {
      await this.load(source);
      // 本地识别保持运行（条目继续累积，切回本地轨继续可用）
      this.activeTrackId = `file:${source.lang}`;
      this.lastRenderedKey = "";
    }
  }

  /**
   * 切换字幕开关
   */
  toggle(): boolean {
    const newVisible = !this.isVisible;
    this.setVisible(newVisible);
    return newVisible;
  }

  /**
   * 设置字幕可见性
   */
  setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (this.subtitleEl) {
      this.subtitleEl.style.opacity = visible ? "1" : "0";
    }
  }

  /**
   * 设置字体大小
   */
  setFontSize(fontSize: number): void {
    this.config.fontSize = Math.max(12, Math.min(72, fontSize));
    this.applyStyles();
  }

  /**
   * 设置颜色
   */
  setColor(color: string): void {
    this.config.color = color;
    this.applyStyles();
  }

  /**
   * 设置背景颜色
   */
  setBackgroundColor(color: string): void {
    this.config.backgroundColor = color;
    this.applyStyles();
  }

  /**
   * 设置背景不透明度（字幕设置面板「背景不透明度」滑杆，0-1）
   * 显式 backgroundColor（非 transparent）存在时会被其覆盖
   */
  setBackgroundOpacity(opacity: number): void {
    this.config.backgroundOpacity = Math.max(0, Math.min(1, opacity));
    this.applyStyles();
  }

  /**
   * 设置等比缩放（字幕设置面板「等比缩放」开关）
   * 开启时字号用 cqh 单位随播放器高度缩放
   */
  setScale(scale: boolean): void {
    this.config.scale = scale;
    this.applyStyles();
  }

  /**
   * 设置淡入淡出（字幕设置面板「淡入淡出」开关）
   * 开启时字幕内容切换时渐显
   */
  setFade(fade: boolean): void {
    this.config.fade = fade;
    this.applyStyles();
  }

  /**
   * 设置水平对齐（字幕设置面板位置档位的 左/中/右）
   * @param align - -1 左 / 0 中 / 1 右
   */
  setAlign(align: number): void {
    this.config.align = Math.max(-1, Math.min(1, align));
    this.applyPosition();
  }

  /**
   * 设置描边
   */
  setStroke(color?: string, width?: number): void {
    if (color !== undefined) {
      this.config.strokeColor = color;
    }
    if (width !== undefined) {
      this.config.strokeWidth = Math.max(0, Math.min(5, width));
    }
    this.applyStyles();
  }

  /**
   * 设置位置
   */
  setPosition(position?: "bottom" | "top" | "middle", offset?: number): void {
    if (position) {
      this.config.position = position;
      // 显式换档位 = 放弃拖拽位置（回档位基础位置）
      this.dragLeft = null;
      this.dragTop = null;
    }
    if (offset !== undefined) {
      this.config.bottomOffset = Math.max(0, offset);
    }
    this.applyPosition();
  }

  /** 当前字幕来源维度（设计文档 6.4） */
  private resolveActiveSource(): "file" | "remote" | "local-ai" | null {
    if (this.activeTrackId === LOCAL_AI_TRACK_ID) return "local-ai";
    if (this.activeTrackId?.startsWith("remote:")) return "remote";
    if (this.activeTrackId?.startsWith("file:")) return "file";
    return this.currentSource ? "file" : null;
  }

  /**
   * 获取字幕状态
   */
  getStatus(): {
    visible: boolean;
    currentLang: string | null;
    currentLabel: string | null;
    availableLangs: { lang: string; label: string }[];
    fontSize: number;
    color: string;
    position: string;
    itemCount: number;
    timeOffset: number;
    source: "file" | "remote" | "local-ai" | null;
  } {
    return {
      visible: this.isVisible,
      currentLang: this.currentSource?.lang ?? null,
      currentLabel: this.currentSource?.label ?? null,
      availableLangs: this.config.sources.map((s) => ({
        lang: s.lang,
        label: s.label,
      })),
      fontSize: this.config.fontSize,
      color: this.config.color,
      position: this.config.position,
      itemCount: this.currentSubtitle?.items.length ?? 0,
      timeOffset: this.timeOffset,
      source: this.resolveActiveSource(),
    };
  }

  // ==================== AI 字幕 API（旧路径） ====================

  /**
   * 启用 AI 字幕模式
   * 已启用时重复调用为 no-op；启用后自动拉取一次 AI 字幕
   * 后端未配置时仍会尝试拉取（refreshAiSubtitle 内部会静默 no-op）
   */
  enableAi(): void {
    if (this.aiEnabled) return;
    this.aiEnabled = true;
    void this.refreshAiSubtitle();
  }

  /**
   * 禁用 AI 字幕模式
   * 仅切换开关，不主动清空当前字幕（避免画面闪烁），由调用方决定后续动作
   */
  disableAi(): void {
    this.aiEnabled = false;
  }

  /**
   * 查询 AI 字幕模式是否启用
   */
  isAiEnabled(): boolean {
    return this.aiEnabled;
  }

  /**
   * 重新拉取 AI 字幕（语义收窄为「整段拉取一次」，设计文档 5.2）
   * 调用 fetcher 拿数据 → toSubtitleItems → 构造 ParsedSubtitle → 走现有 RAF 渲染管线
   * 加载状态通过 PlayerEventEnum.SUBTITLE_LIST_CHANGE 广播（count + 可选 status）：
   *   - loading：count=0, status='loading'
   *   - ready：count=items.length, status='ready'，并附带 SUBTITLE_LANG_CHANGE='ai'
   *   - error：count=0, status='error'
   *
   * 后端未配置（aiBackend 为空）或非启用状态时静默 no-op，保证「后续对接」语义。
   */
  async refreshAiSubtitle(): Promise<void> {
    // 静默 no-op：未启用 / 后端未配置 / 仍在加载中
    if (!this.aiEnabled) return;
    if (!this.aiBackend) return;
    if (this.aiLoading) return;
    if (!isBrowser()) return;

    const bus = this.eventBus;
    // bus 可能在 uninstall 后置空；置空时无法广播，但加载逻辑仍可执行
    if (bus) {
      bus.emit(PlayerEventEnum.SUBTITLE_LIST_CHANGE, {
        count: 0,
        status: "loading",
      });
    }

    this.aiLoading = true;
    try {
      if (!this.aiFetcher) {
        this.aiFetcher = new AiSubtitleFetcher(this.aiBackend);
      }

      const params = {
        videoId: this.aiVideoIdResolver?.() ?? undefined,
        lang: this.config.defaultLang || undefined,
        duration: this.video?.duration ?? undefined,
      };
      const entries = await this.aiFetcher.fetch(params);
      const items = this.aiFetcher.toSubtitleItems(entries);

      // 构造 ParsedSubtitle 走现有二分查找 + RAF 渲染管线
      // format 用 UNKNOWN：AI 字幕非文件格式，只是按时间区间渲染
      this.currentSubtitle = {
        format: SubtitleFormat.UNKNOWN,
        items,
      };
      this.currentSource = {
        src: "",
        lang: this.config.defaultLang || "ai",
        label: "AI Subtitle",
      };
      this.currentIndex = -1;
      this.lastRenderedKey = "";

      // 旧 aiBackend 路径映射为单轨 remote 轨（与 Provider 化的模式 B 一致）
      const trackLang = this.config.defaultLang || "ai";
      this.activeTrackId = `remote:${LEGACY_REMOTE_TRACK_ID}`;
      this.remoteActiveTrack = {
        trackId: LEGACY_REMOTE_TRACK_ID,
        lang: trackLang,
        label: "AI Subtitle",
        kind: "original",
      };
      this.remoteItems = items;

      if (bus) {
        bus.emit(PlayerEventEnum.SUBTITLE_LIST_CHANGE, {
          count: items.length,
          status: "ready",
        });
        bus.emit(PlayerEventEnum.SUBTITLE_LANG_CHANGE, "ai");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`AI subtitle load failed: ${message}`);
      if (bus) {
        bus.emit(PlayerEventEnum.SUBTITLE_LIST_CHANGE, {
          count: 0,
          status: "error",
        });
      }
    } finally {
      this.aiLoading = false;
    }
  }
}

/**
 * 字幕插件工厂函数
 *
 * @param config - 插件配置
 * @returns SubtitlePluginAPI 实例
 *
 * @example
 * plugins: [
 *   SubtitlePlugin({
 *     sources: [
 *       { src: 'subtitles/cn.srt', lang: 'zh', label: '中文' }
 *     ],
 *     fontSize: 20,
 *     position: 'bottom'
 *   })
 * ]
 */
export function SubtitlePlugin(
  config?: SubtitlePluginConfig,
): SubtitlePluginAPI {
  return new SubtitlePluginClass(config);
}

/**
 * 创建字幕插件（别名）
 */
export const createSubtitlePlugin = SubtitlePlugin;
