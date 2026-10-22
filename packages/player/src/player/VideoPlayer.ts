/**
 * ============================================
 * 视频播放器核心类
 * ============================================
 * 实现播放器的所有核心功能和状态管理
 */

import type {
  PlayerConfig,
  PlayerStateData,
  PlayerMethods,
  PlayerEvents,
  ProgressiveVariant,
  ComponentInstance,
  VNode,
  EventListeners,
  DeepPartial,
  MediaItem,
  PlayerSource,
  DisplayMode,
  SubtitleConfig,
  ProgressSkipPoints,
  ProgressSegment,
  EnergyProgressData,
} from "@/types";
import { PlayerState, PlayMode } from "@/types";
import {
  h,
  mount,
  hydrate as hydrateVNode,
  renderToString as renderVNodeToString,
  destroy,
  createTypedStateManager,
  createTypedEventBus,
  signal,
} from "@/core";
import type { TypedStateManager, TypedEventBus } from "@/core";
import type { Plugin } from "@/nova/core/plugin";
import type { ControlsAPI } from "@/nova/components/Controls";
import { PlayerEventEnum, PlayerEventMap } from "@/core/events";
import {
  PlayerStateKeyEnum,
  PlayerStateMap,
  StateContext,
  ConfigContext,
  defaultControlConfig,
} from "@/store/runtimeState";
import { createConfigStore, ConfigStoreContext } from "@/store/configStore";
import type { ConfigStore } from "@/store/configStore";
import type { PlayerPlaylistItem } from "@/store/runtimeState";
import { PlayerContext, type SlotMount } from "@/nova/types/slots";
import { PluginManager } from "@/nova/core/pluginManager";
import { teardownComponentTree } from "@/nova/core/componentUnmount";
import { createPlayerStore } from "@/nova/store";
import type { PlayerStore } from "@/nova/store";
import { createLogger, loggerManager, LogLevel, clearStyle, isBrowser } from "@/utils";
import { isDev } from "@/core/warning";
import {
  setLocale,
  getLocale,
  registerLocale,
  initI18n,
  subscribeLocale,
  localeSignal,
} from "@/core/i18n";
import type { Locale } from "@/core/i18n";
import type { Signal } from "@/core/signalsCore";
import { EventEmitter, fullscreen, pip, clamp } from "../utils";
import type { DanmakuListProvider } from "@/types/danmaku";
import { PlayerDocker } from "@/nova/components/PlayerDocker";
import type { PlayerPluginFlags } from "@/nova/components/PlayerDocker";
import { StreamMiddleware, PlayerMode } from "../utils/media/streamMiddleware";
import { detectManifestProtocol } from "../utils/media/manifestProtocol";
import { StreamFormatEnum } from "@/types/streamPlugin";
import type {
  StreamPlugin,
  QualityLevel as StreamQualityLevel,
  MediaManifestSource,
} from "@/types/streamPlugin";
import defaultConfig from "@/nova/config/defaultConfig";
import { mergePlayerConfig } from "@/nova/config/mergeConfig";
import { normalizeConfig } from "@/nova/config/normalizeConfig";
import {
  configureStorage,
  getStorage,
  removeStorage,
  setStorage,
} from "@/nova/utils/storage";
import { BrowserCapabilityDetector } from "../utils/browserCapabilityDetector";
import type { BrowserCapabilityResult } from "../utils/browserCapabilityDetector";

/**
 * 类型守卫：判断插件是否为流媒体插件
 *
 * 必须同时检测 type / load / getStats 三个特征（与 pluginManager.isStreamPlugin 一致）：
 * 仅检测 load 会把提供 load API 的普通插件（如 DanmakuPlugin.load 换源入口）
 * 误判为 StreamPlugin，注册后 attachActivePlugin 调 plugin.getQualities()
 * 抛 TypeError 中断挂载链（MOUNTED 不触发、视频源不加载）。
 * @param plugin - 插件实例
 * @returns 是否为 StreamPlugin
 */
function isStreamPlugin(plugin: Plugin): plugin is Plugin & StreamPlugin {
  return (
    "type" in plugin &&
    "load" in plugin &&
    typeof plugin.load === "function" &&
    "getStats" in plugin
  );
}

const logger = createLogger("VideoPlayer");

/**
 * 判断错误是否为浏览器自动播放策略拦截（NotAllowedError）
 * 用类型守卫替代 `as` 断言：`"name" in error` 窄化后访问 name 属性
 */
function isAutoplayBlocked(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotAllowedError"
  );
}

/**
 * 判断流媒体插件上报的错误是否为网络类（hls.js fatal data.type 为
 * 'networkError'，dash/flv 的错误对象带有同类 type 字段）
 * 网络类错误按 code=2 上报，错误面板据此显示本地网络排查提示
 */
function isNetworkStreamError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("type" in error)) return false;
  return String(error.type).includes("network");
}

/**
 * 清晰度能力类型
 * - none：无多档能力（单档 MP4 / FLV）
 * - static：静态多档（MP4 多变体，框架换 src）
 * - adaptive：自适应（HLS/DASH，库内切档 + ABR）
 *
 * 注意：与 types/index.ts 的 `QualityMode = 'auto' | 'manual'`（选择模式）同名不同义，
 * 故此处命名为 `QualityCapability` 以消歧。
 */
export type QualityCapability = "none" | "static" | "adaptive";

/** 清晰度切换超时（毫秒）：超过则视为切换失败 */

/**
 * 内部事件总线的全部事件名（camelCase）
 *
 * 用于 `on / once / off` 的通道路由：
 * - 已桥接到对外 emitter 的总线事件（bridgedBusKeys）→ 订阅 emitter，payload 已按对外签名适配
 * - 总线独有的事件（未桥接）→ 直接订阅总线，payload 为总线定义的对象
 * - 其余名称 → 订阅 emitter（对外小写键，如 'timeupdate'）
 */
const BUS_EVENT_NAMES: ReadonlySet<string> = new Set(
  Object.values(PlayerEventEnum),
);

/** 换源等待 loadedmetadata 的超时（毫秒）：避免异常源永不 resolve */
const LOAD_METADATA_TIMEOUT_MS = 10000;

/**
 * PlayerDocker 挂载回调传入的元素集合
 * （只取本类需要的字段，避免与 PlayerDocker 强耦合）
 */
interface PlayerDockerMountedElements {
  container: HTMLElement;
  /** 视频区域（比例计算的尺寸基准，画面比例需要） */
  videoArea: HTMLElement;
  /** 视频包裹层（画面比例的宽度作用目标） */
  videoWrap: HTMLElement;
  video: HTMLVideoElement;
  /** 弹幕发送区（未装 danmaku 插件时不渲染，为 null） */
  sendingArea: HTMLElement | null;
}

/**
 * 弹幕插件可选的运行时 API（存在则转发）
 *
 * 设置类调用（显隐/透明度/速度等）不再桥接：插件直接订阅
 * 9 个 DANMAKU_* 运行时状态键，状态即唯一数据源；
 * 发送走 DANMAKU_SEND 事件、清空走 DANMAKU_CLEAR 事件（均在事件总线收口）。
 * 此接口仅保留数据源换源通道（provider 优先，url 兜底）。
 */
interface DanmakuPluginApi {
  /** 更换弹幕数据源（provider 优先，url 兜底；换源时清空分段缓存） */
  load?(config: { provider?: DanmakuListProvider; url?: string }): void;
}

/**
 * 播放器实例映射表
 * 使用 WeakMap 存储，当 DOM 元素被销毁时自动释放引用
 * 避免内存泄漏，同时便于通过 DOM 元素查找播放器实例
 */
const playerInstanceMap = new WeakMap<HTMLElement, VideoPlayer>();

/**
 * 通过 DOM 元素获取播放器实例
 *
 * @param el - 播放器根元素或视频元素
 * @returns 播放器实例，如果不存在则返回 undefined
 */
export function getPlayerInstance(el: HTMLElement): VideoPlayer | undefined {
  if (el.tagName === "VIDEO") {
    const container = el.closest(".nova-player-container");
    if (!(container instanceof HTMLElement)) return undefined;
    return playerInstanceMap.get(container);
  }
  return playerInstanceMap.get(el);
}

/**
 * 从配置推导播放列表
 *
 * - 显式配置 `playlist` 时整体使用；
 * - 否则由顶层 `src` 构造单元素列表（poster / 弹幕 / 字幕 / 起播时间一并带入）。
 */
function normalizePlaylist(props: PlayerConfig): MediaItem[] {
  const list = props.playlist;
  if (Array.isArray(list) && list.length > 0) return [...list];

  const src = props.src;
  if (src === undefined || src === "") return [];

  return [
    {
      src,
      poster: props.poster,
      startTime: props.playback?.startTime,
      subtitleList: props.subtitle?.list,
    },
  ];
}

/**
 * 视频播放器类
 * 实现 ComponentInstance 接口，可作为组件使用
 */
export class VideoPlayer
  implements ComponentInstance<PlayerConfig>, PlayerMethods
{
  /** Top / Ending 插件挂载入口（插件 install 时注册，PlayerDocker 读取） */
  private topPluginMount: SlotMount["mount"] | null = null;
  private endingPluginMount: SlotMount["mount"] | null = null;

  registerTopPluginMount(mount: SlotMount["mount"]): void {
    this.topPluginMount = mount;
  }

  unregisterTopPluginMount(mount?: SlotMount["mount"]): void {
    if (!mount || this.topPluginMount === mount) this.topPluginMount = null;
  }

  getTopPluginMount(): SlotMount["mount"] | null {
    return this.topPluginMount;
  }

  registerEndingPluginMount(mount: SlotMount["mount"]): void {
    this.endingPluginMount = mount;
  }

  unregisterEndingPluginMount(mount?: SlotMount["mount"]): void {
    if (!mount || this.endingPluginMount === mount) this.endingPluginMount = null;
  }

  getEndingPluginMount(): SlotMount["mount"] | null {
    return this.endingPluginMount;
  }

  /** Top / Ending 视图动态刷新（不重建播放器） */
  private topViewRefresh: (() => void) | null = null;
  private endingViewRefresh: (() => void) | null = null;

  registerTopViewRefresh(refresh: (() => void) | null): void {
    this.topViewRefresh = refresh;
  }

  unregisterTopViewRefresh(refresh?: (() => void) | null): void {
    if (!refresh || this.topViewRefresh === refresh) this.topViewRefresh = null;
  }

  refreshTop(): void {
    this.topViewRefresh?.();
  }

  registerEndingViewRefresh(refresh: (() => void) | null): void {
    this.endingViewRefresh = refresh;
  }

  unregisterEndingViewRefresh(refresh?: (() => void) | null): void {
    if (!refresh || this.endingViewRefresh === refresh) {
      this.endingViewRefresh = null;
    }
  }

  refreshEnding(): void {
    this.endingViewRefresh?.();
  }

  /** 播放器配置（命名空间形态，可被 setConfig 动态更新） */
  props: PlayerConfig;

  /** 控制栏 API（控制栏挂载后由 PlayerDocker 回填） */
  private controlsApi: ControlsAPI | null = null;

  /** 挂载前注入的高能数据，Controls 挂载后补发 */
  private pendingEnergy: EnergyProgressData | null | undefined;

  /** 播放器根元素 */
  el?: HTMLElement;

  /** 视频元素 */
  private videoEl: HTMLVideoElement | null = null;

  /** 播放器容器元素 */
  private containerEl: HTMLElement | null = null;

  /** 视频区域（画面比例的尺寸基准） */
  private videoAreaEl: HTMLElement | null = null;

  /** 视频包裹层（画面比例的宽度作用目标） */
  private videoWrapEl: HTMLElement | null = null;

  /** 当前画面比例（"0:0" 自适应 | "4:3" | "16:9"） */
  private aspectRatio = "0:0";

  /** 片头 / 片尾跳过断点（progress.skipPoints，外部数据源提供） */
  private skipPoints: ProgressSkipPoints | null = null;

  /** 当前视频是否已执行过片头跳过（换源后重置） */
  private skipIntroDone = false;

  /** 当前视频是否已执行过片尾跳过（换源后重置） */
  private skipOutroDone = false;

  /** 画面比例随容器尺寸重算的观察器（：wrap 宽度百分比需跟随容器变化） */
  private aspectResizeObserver: ResizeObserver | null = null;

  /** 语言切换退订函数（data-locale 标识随语言响应式更新） */
  private localeUnsubscribe: (() => void) | null = null;

  /** 事件发射器（内部使用，向后兼容 on/off） */
  private emitter = new EventEmitter<PlayerEvents>();

  /** fullscreenchange 事件处理函数引用（用于清理） */
  private fullscreenChangeHandler: (() => void) | null = null;

  /** 状态管理器（唯一运行时状态源） */
  state: TypedStateManager<PlayerStateMap>;

  /** 持久化状态存储 */
  store: PlayerStore;

  /** 事件总线 */
  events: TypedEventBus<PlayerEventMap>;

  /** 可订阅配置中心：控件开关等配置动态更新的载体 */
  configStore: ConfigStore;

  /** 视频源列表（由 props.src 映射） */
  private sources: ProgressiveVariant[] = [];

  /**
   * 当前生效的清单对象（对象注入模式）
   *
   * props.src 为自定义扁平 JSON 清单对象时，sources 为空数组，
   * 清单本身保存在这里：协议判定（detectManifestProtocol）与加载目标解析都以它为准。
   */
  private manifestSource: MediaManifestSource | null = null;

  /** 当前播放的视频源索引 */
  private currentSourceIndex = 0;

  /** 当前尝试的备用源索引（用于错误恢复） */
  private currentBackupIndex = 0;

  /** 是否正在切换备用源 */
  private isSwitchingBackup = false;

  /** 虚拟节点引用 */
  private vnode: VNode | null = null;

  /** 插件管理器 */
  private pluginManager: PluginManager | null = null;

  /**
   * 插件安装标志信号（UI 按需渲染的响应式数据源）
   *
   * use / uninstallPlugin 时同步更新，render() 作为 plugins prop 传给
   * PlayerDocker：弹幕层 / 字幕层 / 交互层 / 互动视频层 / 弹幕发送栏 /
   * 控制栏字幕入口经 Show 控制流按标志条件挂载——未装插件的 DOM
   * 完全不进入文档流。effect 同步刷新保证后装插件时（demo 运行期
   * player.use 场景）信号更新即完成 DOM 挂载，install 内就地初始化
   * 能找到容器
   */
  private pluginFlags: Signal<PlayerPluginFlags> = signal<PlayerPluginFlags>({
    danmaku: false,
    subtitle: false,
    interaction: false,
    interactiveVideo: false,
    audioEffect: false,
  });

  /** 流媒体中间件：统一管理 Native 与 Streaming 两种模式 */
  streamMiddleware: StreamMiddleware | null = null;

  /** 清晰度列表订阅的取消函数 */
  private unsubscribeQuality: (() => void) | null = null;

  /** 清晰度切换成功信号（STREAM_QUALITY_CHANGE）的订阅取消函数 */
  private unsubscribeStreamQuality: (() => void) | null = null;

  /** 字幕轨道列表变化（SUBTITLE_TRACKS_CHANGE）的订阅取消函数 */
  private unsubscribeSubtitleTracks: (() => void) | null = null;

  /** 流媒体致命错误（STREAM_ERROR）的订阅取消函数 */
  private unsubscribeStreamError: (() => void) | null = null;

  /** 加载超时守卫定时器（loadstart 后长时间无元数据判定加载失败） */
  private loadGuardTimer: ReturnType<typeof setTimeout> | null = null;

  /** 缓冲超时守卫定时器（waiting 后长时间未恢复判定网络异常） */
  private bufferGuardTimer: ReturnType<typeof setTimeout> | null = null;

  /** 初始加载超时阈值（毫秒）：loadstart 后无 loadedmetadata 判定失败 */
  private static readonly LOAD_TIMEOUT_MS = 20000;

  /** 缓冲恢复超时阈值（毫秒）：waiting 后未恢复判定网络异常 */
  private static readonly BUFFER_TIMEOUT_MS = 12000;

  /** 事件桥接订阅的取消函数集合（bus → emitter 单向转发，destroy 时统一清理） */
  private bridgeUnsubscribes: Array<() => void> = [];

  /**
   * 已桥接到对外 emitter 的总线事件名（camelCase）
   *
   * `on / once / off` 依据它决定订阅通道：命中则走 emitter（避免同一事件被
   * 双通道重复投递，并保留桥接时按对外签名适配过的 payload）。
   */
  private bridgedBusKeys = new Set<string>();

  /** 浏览器能力检测结果 */
  private browserCapability: BrowserCapabilityResult | null = null;

  /** 用户回调函数 */
  private callbacks: EventListeners;

  /** 播放列表（复用同一 video 元素换源） */
  private playlist: MediaItem[] = [];

  /** 当前播放项索引 */
  private currentIndex = 0;

  /** 换源竞态守卫：每次 load/切换自增，过期回调丢弃 */
  private loadToken = 0;

  /** 待处理的起播时间（loadedmetadata 后应用，修复 currentTime 被截断） */
  private pendingSeek: {
    token: number;
    time: number;
    autoplay: boolean;
  } | null = null;

  /** 换源 Promise 的 resolve（loadedmetadata 或超时后调用） */
  private pendingLoadResolve: (() => void) | null = null;

  /** 换源等待定时器 */
  private pendingLoadTimer: ReturnType<typeof setTimeout> | null = null;

  /** 清晰度切换生命周期上下文 */
  private pendingQuality: {
    from: string;
    to: string;
    label?: string;
    startedAt: number;
    kind: "stream" | "native";
  } | null = null;

  /** bindVideoEvents 注册的全部监听器（destroy 时统一摘除） */
  private videoListeners: Array<{ type: string; handler: EventListener }> = [];

  /** 视频事件是否已绑定（防止 onMounted / hydrate 重复绑定） */
  private videoEventsBound = false;

  /**
   * 构造函数
   *
   * @param config - 播放器配置
   */
  constructor(config: PlayerConfig) {
    /**
     * 先归一化（兼容旧扁平写法），再深合并默认值。
     * 嵌套命名空间只覆盖用户显式提供的字段，同层其余默认值保留。
     */
    this.props = mergePlayerConfig(defaultConfig, normalizeConfig(config));

    /** 片头 / 片尾跳过断点（外部数据源提供；无数据时不渲染标记、不自动跳过） */
    this.skipPoints = this.props.progress?.skipPoints ?? null;

    /** 应用持久化配置（storage.enabled 默认 true，setConfig 可即时切换） */
    configureStorage(this.props.storage);

    /** 根据 advanced.debug / advanced.logLevel 设置日志级别 */
    this.applyLogLevel(this.props);

    /** 初始化 i18n 国际化（如果配置中启用了 i18n） */
    if (this.props.i18n) {
      initI18n(this.props.i18n);
    }

    /** 归一化播放列表（无 playlist 时由 src 构造单元素列表） */
    this.playlist = normalizePlaylist(this.props);
    this.currentIndex = clamp(
      this.props.playlistIndex ?? 0,
      0,
      Math.max(0, this.playlist.length - 1),
    );

    /** playlist 非空但 src 为空时，用当前条目作为播放源 */
    if (
      (!this.props.src || this.props.src === "") &&
      this.playlist.length > 0
    ) {
      this.props.src = this.playlist[this.currentIndex].src;
    }

    /** 同步进度条分段到控件配置（供 Controls 读取） */
    this.syncSegmentsToControls();

    /** 处理视频源 */
    this.processSources();

    /**
     * 初始化持久化状态存储：从 localStorage 读取用户偏好
     */
    this.store = createPlayerStore({
      persist: true,
    });

    const persistentState = this.store.getPersistentState();
    const playback = this.props.playback ?? {};
    /**
     * 「持久化优先」合并：localStorage 存在已保存的 profile 时，
     * 音量 / 静音 / 倍速一律以持久化值为准；外部传入的 playback
     * 配置仅作为无持久化数据（首次使用）时的默认值兜底。
     * 构造新对象避免污染共享默认值。
     * 【修复记录】原实现比较 `playback.volume === defaultConfig.playback?.volume`，
     * 用户未传时 undefined !== 1 恒不成立 → 持久化值被跳过（音量不持久化的根因）
     */
    const persisted = this.store.hasPersistedData();
    this.props.playback = {
      ...playback,
      volume: persisted
        ? persistentState.volume
        : (playback.volume ?? persistentState.volume),
      muted: persisted
        ? persistentState.isMuted
        : (playback.muted ?? persistentState.isMuted),
      playbackRate: persisted
        ? persistentState.playbackRate
        : (playback.playbackRate ?? persistentState.playbackRate),
      // 设置面板开关（镜像/循环/自动开播/播完暂停）——同样持久化优先；
      // 关灯不持久化（即时氛围功能），画中画是浏览器会话态亦不持久化；
      // 注意映射：「自动开播」面板项写 playback.autoplay（setAutostart 的落点）
      mirror: persisted
        ? persistentState.settings.mirror
        : (playback.mirror ?? persistentState.settings.mirror),
      loop: persisted
        ? persistentState.settings.loop
        : (playback.loop ?? persistentState.settings.loop),
      autoplay: persisted
        ? persistentState.settings.autostart
        : (playback.autoplay ?? persistentState.settings.autostart),
      pauseAfterEnd: persisted
        ? persistentState.settings.pauseAfterEnd
        : (playback.pauseAfterEnd ?? persistentState.settings.pauseAfterEnd),
      skipIntroOutro: persisted
        ? persistentState.settings.skipIntroOutro
        : (playback.skipIntroOutro ??
          persistentState.settings.skipIntroOutro),
    };

    /**
     * 字幕样式持久化优先合并：恢复的 patch 并入 subtitle 配置的 style
     * 字段——字幕菜单初值快照（props.style）与字幕插件共享同一来源，
     * 刷新后菜单直接显示上次设置
     */
    if (persisted) {
      const persistedStyle = persistentState.subtitleStyle;
      if (Object.keys(persistedStyle).length > 0) {
        const subtitle = this.props.subtitle ?? {};
        const mergedStyle = {
          ...(subtitle.style ?? {}),
          ...persistedStyle,
        };
        // 旧版本 bottomOffset 基准过大（60px，控制栏抬升改由 CSS 负责），
        // 收敛到 20px 内，避免恢复后字幕明显偏高
        if (
          typeof mergedStyle.bottomOffset === "number" &&
          mergedStyle.bottomOffset > 20
        ) {
          mergedStyle.bottomOffset = 12;
        }
        this.props.subtitle = { ...subtitle, style: mergedStyle };
      }
    }

    /**
     * 初始化运行时状态管理器（状态路径与 PlayerStateKeyEnum 一致）
     */
    const playbackInit = this.props.playback ?? {};
    const qualityInit = this.props.quality?.default ?? "auto";
    this.state = createTypedStateManager<PlayerStateMap>({
      player: {
        state: PlayerState.IDLE,
        currentTime: 0,
        duration: 0,
        volume: playbackInit.volume ?? 1,
        muted: playbackInit.muted ?? false,
        playbackRate: playbackInit.playbackRate ?? 1,
        buffered: 0,
        isFullscreen: false,
        isPip: false,
        isSeeking: false,
        quality: qualityInit,
        isLoading: false,
        loadProgress: 0,
        controlsVisible: true,
        controlsHover: false,
        danmakuVisible: true,
        danmakuOpacity: 1,
        danmakuSpeed: 1,
        danmakuDensity: 0.5,
        subtitleVisible: this.props.subtitle?.enabled ?? true,
        subtitleLang: "zh-CN",
        errorCode: 0,
        errorMessage: "",
        isWebFullscreen: false,
        isWideScreen: false,
        displayMode: "normal",
        isMinPlayer: false,
        qualityCurrent: qualityInit,
        qualityMode: "none",
        qualitySwitchState: "idle",
        playlistIndex: this.currentIndex,
        playlistLength: this.playlist.length,
        /** 编码偏好：持久化读回（下次加载即上次设置），面板单选经此状态同步 */
        codecPreferType: this.store.getPersistentState().codecPreferType,
        /**
         * 设置面板开关：持久化值读回（playback 已在上方「持久化优先」
         * 合并完成），面板 Switch 经运行时状态受控回显；
         * 关灯不持久化（即时氛围功能），恒为 false（默认开灯）
         */
        mirror: playbackInit.mirror ?? false,
        loop: playbackInit.loop ?? false,
        autostart: playbackInit.autoplay ?? false,
        lightoff: false,
        pauseAfterEnd: playbackInit.pauseAfterEnd ?? false,
        skipIntroOutro: playbackInit.skipIntroOutro ?? false,
      },
      video: {
        width: 0,
        height: 0,
        // 画面比例默认自适应（"0:0"），持久化值经 MOUNTED setAspectRatio 恢复
        aspectRatio: "0:0",
      },
    });

    /**
     * 弹幕设置 / 高能进度条「持久化优先」恢复：
     * 持久化值写回运行时状态键——DanmakuPlugin 安装时先读当前状态再
     * 订阅（subscribeStateKeys），恢复值随安装直达引擎；DmSetting
     * 打开时也读当前状态回显，两处 UI 一致
     */
    if (persisted) {
      const danmakuSaved = persistentState.danmakuSettings;
      this.state.set(PlayerStateKeyEnum.DANMAKU_VISIBLE, danmakuSaved.visible);
      this.state.set(PlayerStateKeyEnum.DANMAKU_OPACITY, danmakuSaved.opacity);
      this.state.set(PlayerStateKeyEnum.DANMAKU_SPEED, danmakuSaved.speed);
      this.state.set(PlayerStateKeyEnum.DANMAKU_AREA, danmakuSaved.area);
      this.state.set(
        PlayerStateKeyEnum.DANMAKU_FONT_SIZE,
        danmakuSaved.fontSize,
      );
      this.state.set(
        PlayerStateKeyEnum.DANMAKU_SCALE_WITH_SCREEN,
        danmakuSaved.scaleWithScreen,
      );
      // 智能防挡：持久化读回（插件安装时读当前状态直达引擎）
      this.state.set(
        PlayerStateKeyEnum.DANMAKU_MASK_ENABLED,
        danmakuSaved.maskEnabled,
      );
      // 高能进度条：渲染开关（pbpState 0/1）/ 常驻图钉（pbpPin 0/1）
      this.state.set(
        PlayerStateKeyEnum.PBP_RENDERED,
        persistentState.pbpState === 1,
      );
      this.state.set(
        PlayerStateKeyEnum.PBP_PERMANENT,
        persistentState.pbpPin === 1,
      );
    } else {
      // 无持久化数据：业务规则兜底初始化——渲染态默认开，常驻态默认关。
      // 常驻（图钉）是用户动作语义：只由图钉点击 / applyPermanent 写入并
      // 持久化，不再因「多段」自动常驻；shadowPermanent 配置只作用于
      // 底部影子进度条（ShadowProgressArea），与高能进度条图钉彻底解耦；
      // 写入早于落库订阅注册，兜底值不会被误落库
      this.state.set(PlayerStateKeyEnum.PBP_RENDERED, true);
      this.state.set(PlayerStateKeyEnum.PBP_PERMANENT, false);
    }

    /**
     * 持久化写回订阅：弹幕面板 / 高能进度条开关由 UI 直写运行时状态键，
     * 在此统一订阅落库——任何入口（面板 / API / 复位）都覆盖
     */
    this.state.subscribe(PlayerStateKeyEnum.DANMAKU_VISIBLE, (value) => {
      this.store.updateDanmakuSettings({ visible: value });
    });
    this.state.subscribe(PlayerStateKeyEnum.DANMAKU_OPACITY, (value) => {
      this.store.updateDanmakuSettings({ opacity: value });
    });
    this.state.subscribe(PlayerStateKeyEnum.DANMAKU_SPEED, (value) => {
      this.store.updateDanmakuSettings({ speed: value });
    });
    this.state.subscribe(PlayerStateKeyEnum.DANMAKU_AREA, (value) => {
      this.store.updateDanmakuSettings({ area: value });
    });
    this.state.subscribe(PlayerStateKeyEnum.DANMAKU_FONT_SIZE, (value) => {
      this.store.updateDanmakuSettings({ fontSize: value });
    });
    this.state.subscribe(
      PlayerStateKeyEnum.DANMAKU_SCALE_WITH_SCREEN,
      (value) => {
        this.store.updateDanmakuSettings({ scaleWithScreen: value });
      },
    );
    this.state.subscribe(PlayerStateKeyEnum.DANMAKU_MASK_ENABLED, (value) => {
      this.store.updateDanmakuSettings({ maskEnabled: value });
    });
    this.state.subscribe(PlayerStateKeyEnum.PBP_RENDERED, (value) => {
      this.store.setPbpState(value ? 1 : 0);
    });
    this.state.subscribe(PlayerStateKeyEnum.PBP_PERMANENT, (value) => {
      this.store.setPbpPin(value ? 1 : 0);
    });

    /**
     * 首帧同步播放列表到运行时状态（选集面板的数据源）：
     * 构造函数早于 render()/mount()，UI 组件渲染时即可读到列表，
     * 不必等到用户切集。
     */
    this.syncPlaylistState();

    /** 初始化事件总线 */
    this.events = createTypedEventBus<PlayerEventMap>();

    /**
     * 事件桥接：player.on/off/once 只监听 emitter（PlayerEvents 小写键），
     * 而内部事件大多发在 events 总线（PlayerEventEnum camelCase 键）。
     * 这里把「有对应 emitter 键」的总线事件单向转发到 emitter，
     * 保证外部 `player.on('play' | 'timeupdate' | ...)` 能收到事件。
     */
    this.bridgeEvents();

    /** 初始化配置中心（后续 setConfig 会整体替换并通知订阅者） */
    this.configStore = createConfigStore(this.props);

    /** 存储用户回调函数 */
    this.callbacks = this.props.callbacks ?? {};

    /**
     * 持久化偏好已在构造期「持久化优先」合并进 props.playback 与运行时状态；
     * 媒体元素同步移至 MOUNTED 回调（applyPlaybackToMedia，
     * 此时 videoEl 才存在，见方法注释）
     */

    /** 初始化插件管理器 */
    this.pluginManager = new PluginManager(this);

    /** 把 callbacks 中以契约键给出的项补挂到总线（小写门面键仍走既有直调，避免双发） */
    this.registerBusCallbacks();

    /** 自动注册配置的插件 */
    this.registerPlugins();

    /** 监听插件上报的清晰度切换成功信号 */
    this.unsubscribeStreamQuality = this.events.on(
      PlayerEventEnum.STREAM_QUALITY_CHANGE,
      (payload) => this.handleStreamQualityChange(payload),
    );

    /** 监听字幕插件上报的轨道列表变化（文件轨/服务端轨/本地识别轨统一注册表） */
    this.unsubscribeSubtitleTracks = this.events.on(
      PlayerEventEnum.SUBTITLE_TRACKS_CHANGE,
      (payload) => this.handleSubtitleTracksChange(payload),
    );

    /** 监听流媒体插件上报的致命错误（HLS/FLV/DASH fatal），统一收敛到错误面板 */
    this.unsubscribeStreamError = this.events.on(
      PlayerEventEnum.STREAM_ERROR,
      (payload) => this.handleStreamError(payload),
    );

    /** 检测浏览器能力 */
    this.detectCapability();
  }

  /**
   * 事件桥接（单向：events 总线 → emitter）
   *
   * 映射表依据实际类型定义逐条对照建立：
   * - bus 键：core/events.ts 的 PlayerEventEnum（camelCase，如 'timeUpdate'）
   * - emitter 键：types/index.ts 的 PlayerEvents（全小写，如 'timeupdate'）
   *
   * 说明：
   * - 这里桥接的是「已成对外契约」的事件：payload 按 PlayerEvents 定义做窄化透传，
   *   外部通过 player.on('<小写键>') 订阅。
   * - 未桥接的总线事件（mounted / qualityListChange / seekStart / danmaku* /
   *   subtitle* / playlist* / interaction* / stream* 等）不再要求外部改用
   *   player.events.on()：player.on('<camelCase 键>') 会直连总线，
   *   见 BUS_EVENT_NAMES 与 resolveEventChannel()。
   */
  /**
   * 把 callbacks 中以契约键给出的项补挂到内部事件总线
   *
   * `EventListeners` 是对 `PlayerEvents` 的映射类型，因此门面上新增的 camelCase 契约键
   * 也会出现在 `callbacks` 里。小写门面键与已桥接键继续由既有直调负责（此处跳过，避免双发），
   * 未桥接的契约键则在此挂到总线，使其首次真正生效。
   */
  private registerBusCallbacks(): void {
    for (const [key, fn] of Object.entries(this.callbacks)) {
      if (typeof fn !== "function") continue;
      if (this.resolveEventChannel(key) === "bus") {
        this.bridgeUnsubscribes.push(this.events.on(key as never, fn as never));
      }
    }
  }

  private bridgeEvents(): void {
    const busOn = this.events.on.bind(this.events);
    /**
     * 与总线订阅语义完全一致，额外记录「该总线事件已桥接」，
     * 供 on / once / off 判定订阅通道（见 BUS_EVENT_NAMES 注释）。
     */
    const subscribe = ((key: string, handler: (payload: never) => void) => {
      this.bridgedBusKeys.add(key);
      return busOn(key as never, handler as never);
    }) as unknown as typeof busOn;

    // ── 生命周期 ──
    this.bridgeUnsubscribes.push(
      subscribe(PlayerEventEnum.READY, () => this.emitter.emit("ready")),
      subscribe(PlayerEventEnum.LOAD_START, () =>
        this.emitter.emit("loadstart"),
      ),
      subscribe(PlayerEventEnum.LOADED_METADATA, (payload) => {
        this.emitter.emit("loadedmetadata", payload.duration);
      }),
      subscribe(PlayerEventEnum.LOADED_DATA, () =>
        this.emitter.emit("loadeddata"),
      ),
      subscribe(PlayerEventEnum.CAN_PLAY, () => this.emitter.emit("canplay")),
      subscribe(PlayerEventEnum.DESTROY, () => {
        // PlayerEvents 未声明 'destroy' 键，但 emitter 具备字符串索引签名，
        // 转发以保证销毁时可被外部感知
        this.emitter.emit("destroy");
      }),
    );

    // ── 播放状态 ──
    this.bridgeUnsubscribes.push(
      subscribe(PlayerEventEnum.STATE_CHANGE, (payload) => {
        // 总线侧声明为 string，实际由 setState 传入 PlayerState 枚举
        this.emitter.emit("statechange", payload as PlayerState);
      }),
      subscribe(PlayerEventEnum.PLAY, () => this.emitter.emit("play")),
      subscribe(PlayerEventEnum.PLAYING, () => this.emitter.emit("playing")),
      subscribe(PlayerEventEnum.PAUSE, () => this.emitter.emit("pause")),
      subscribe(PlayerEventEnum.ENDED, () => this.emitter.emit("ended")),
      subscribe(PlayerEventEnum.WAITING, () => this.emitter.emit("waiting")),
    );

    // ── 时间与缓冲 ──
    this.bridgeUnsubscribes.push(
      subscribe(PlayerEventEnum.TIME_UPDATE, (payload) => {
        this.emitter.emit("timeupdate", payload.time, this.getDuration());
      }),
      subscribe(PlayerEventEnum.PROGRESS, () => {
        const buffered = this.videoEl?.buffered;
        if (buffered) {
          this.emitter.emit("progress", buffered);
        }
      }),
      subscribe(PlayerEventEnum.DURATION_CHANGE, () => {
        this.emitter.emit("durationchange", this.getDuration());
      }),
      subscribe(PlayerEventEnum.SEEKING, (payload) => {
        this.emitter.emit("seeking", payload.currentTime);
      }),
      subscribe(PlayerEventEnum.SEEKED, (payload) => {
        this.emitter.emit("seeked", payload.currentTime);
      }),
      subscribe(PlayerEventEnum.RATE_CHANGE, (payload) => {
        this.emitter.emit("ratechange", payload);
      }),
    );

    // ── 音量与画面 ──
    this.bridgeUnsubscribes.push(
      subscribe(PlayerEventEnum.VOLUME_CHANGE, (payload) => {
        this.emitter.emit("volumechange", payload.volume, payload.muted);
      }),
      subscribe(PlayerEventEnum.FULLSCREEN_CHANGE, (payload) => {
        this.emitter.emit("fullscreenchange", payload.isFullscreen);
      }),
      subscribe(PlayerEventEnum.PIP_CHANGE, (payload) => {
        this.emitter.emit("pipchange", payload.isPip);
      }),
      subscribe(PlayerEventEnum.RESIZE, (payload) => {
        // PlayerEvents 未声明 'resize' 键，借字符串索引签名转发
        this.emitter.emit("resize", payload.width, payload.height);
      }),
    );

    // ── 清晰度 / 错误 ──
    this.bridgeUnsubscribes.push(
      subscribe(PlayerEventEnum.QUALITY_CHANGE, (payload) => {
        this.emitter.emit("qualitychange", payload.quality);
      }),
      subscribe(PlayerEventEnum.ERROR, (payload) => {
        // 总线侧 error 字段为 unknown，实际由 handleVideoError 传入 MediaError
        this.emitter.emit("error", payload.error as MediaError);
      }),
    );

    // ── 弹幕发送成功：本地弹幕条数自增 ──
    // 使用 events.on 直连总线（不走 subscribe），保持 danmakuSent 仍为
    // 总线直连事件，外部 player.on("danmakuSent") 语义不变。
    // 服务端实时总数由 setDanmakuCount 绝对值覆盖（见该方法注释）。
    this.bridgeUnsubscribes.push(
      this.events.on(PlayerEventEnum.DANMAKU_SENT, () => {
        this.incrementDanmakuCount();
      }),
    );
  }

  /**
   * 应用日志级别
   * @param config - 当前配置
   */
  private applyLogLevel(config: PlayerConfig): void {
    const advanced = config.advanced;
    const level = advanced?.debug
      ? LogLevel.DEBUG
      : (advanced?.logLevel ?? LogLevel.SILENT);
    loggerManager.setLevel(level);
  }

  /** 控制栏挂载后回填 API（仅内部 PlayerDocker 调用） */
  attachControlsApi(api: ControlsAPI): void {
    this.controlsApi = api;
    this.controlsApi.setShadowPermanent(
      this.props.progress?.shadowPermanent === true,
    );
    if (this.pendingEnergy !== undefined) {
      this.controlsApi.setEnergy(this.pendingEnergy);
    }
  }

  /**
   * 进度条公开 API（统一挂在 progress 命名空间下）
   *
   * 用法：
   * player.progress.applyPermanent(true)   // 展开底部影子进度条
   * player.progress.applyPermanent(false)  // 收起
   */
  readonly progress = {
    /** 是否展开底部常驻影子进度条（等价于 setShadowPermanent） */
    applyPermanent: (enabled: boolean): void => {
      this.setShadowPermanent(enabled);
    },
    /** 当前是否处于常驻展开态 */
    isPermanent: (): boolean => this.props.progress?.shadowPermanent === true,
    /**
     * 注入章节 / 分段数据。
     * 章节菜单、顶部进度条、底部影子进度条共用这一份数据。
     */
    setSegments: (segments: ProgressSegment[]): void => {
      this.props.progress = {
        ...(this.props.progress ?? {}),
        segments,
      };
      this.syncSegmentsToControls();
      // 通知 ConfigStore：章节菜单与进度条订阅 progress.segments 自动更新
      this.configStore.set(this.props);
      this.controlsApi?.setProgressSegments(segments);
    },
    /** 注入高能进度条数据（客户端水合后一次请求；挂载前调用会暂存） */
    setEnergy: (data: EnergyProgressData | null): void => {
      this.pendingEnergy = data;
      this.controlsApi?.setEnergy(data);
    },
  };

  /**
   * 设置分段进度条常驻展开
   *
   * 仅在 progress.segments 多段时生效；关闭后底部影子进度条不再展开。
   */
  setShadowPermanent(enabled: boolean): void {
    this.props.progress = {
      ...(this.props.progress ?? {}),
      shadowPermanent: enabled,
    };
    this.syncSegmentsToControls();
    this.controlsApi?.setShadowPermanent(enabled);
  }

  /** 把 progress.segments 同步进 ui.controls.progressSegments（Controls 读取路径） */
  private syncSegmentsToControls(): void {
    const segments = this.props.progress?.segments;
    if (segments === undefined) return;
    // 构造新对象，避免污染共享的 defaultControlConfig
    const controls = {
      ...(this.props.ui?.controls ?? defaultControlConfig),
      progressSegments: segments,
      shadowPermanent: this.props.progress?.shadowPermanent === true,
    };
    this.props.ui = { ...(this.props.ui ?? {}), controls };
  }

  // ============================================
  // 持久化（storage 配置，见 utils/storage.ts）
  // ============================================

  /** 进度记忆节流间隔（毫秒）：每 5 秒写一次，避免 timeupdate 高频写 localStorage */
  private static readonly PROGRESS_SAVE_INTERVAL_MS = 5000;

  /** 进度记忆的存储 key 前缀 */
  private static readonly PROGRESS_KEY_PREFIX = "progress:";

  /** 上次写入进度记忆的时间戳 */
  private lastProgressSaveAt = 0;

  /**
   * 当前源对应的进度记忆 key（src 字符串本身作标识；manifest 对象源无法作 key，跳过）
   */
  private progressStorageKey(): string | null {
    const src = this.props.src;
    if (typeof src !== "string" || src === "") return null;
    return `${VideoPlayer.PROGRESS_KEY_PREFIX}${src}`;
  }

  /**
   * 把已合并的播放偏好（音量 / 静音 / 倍速）应用到 video 元素
   *
   * 【修复记录】原 restorePersistedPlayback 从 localStorage 裸 key
   * （getStorage("volume") 等）读取——那是改名前的旧机制，store 现在
   * 写入 nova_player_profile JSON，裸 key 永远读不到值（恒 no-op），
   * 且构造期 setVolume 时 videoEl 尚为 null（只写 state 不写媒体），
   * 挂载后又无人同步 → 实际音量永远是 video 元素默认值 1。
   *
   * 现改为 MOUNTED 回调中调用：构造期「持久化优先」合并已把最终值
   * 写入运行时状态（state.player.*），挂载后在此统一应用到 media
   * 元素（媒体元素属性操作属约束允许的命令式场景），冗余事件不再发
   */
  private applyPlaybackToMedia(): void {
    if (!this.videoEl) return;
    const volume = this.state.get(PlayerStateKeyEnum.VOLUME);
    if (typeof volume === "number") {
      this.videoEl.volume = clamp(volume, 0, 1);
    }
    const muted = this.state.get(PlayerStateKeyEnum.MUTED);
    if (typeof muted === "boolean") {
      this.videoEl.muted = muted;
    }
    const rate = this.state.get(PlayerStateKeyEnum.PLAYBACK_RATE);
    if (typeof rate === "number" && rate > 0) {
      this.videoEl.playbackRate = rate;
    }
  }

  /**
   * timeupdate 节流写入进度记忆（每 5 秒一次），格式 `{ src, time, duration }`
   */
  private saveProgressThrottled(time: number, duration: number): void {
    const key = this.progressStorageKey();
    if (!key || !Number.isFinite(duration) || duration <= 0) return;
    const now = Date.now();
    if (now - this.lastProgressSaveAt < VideoPlayer.PROGRESS_SAVE_INTERVAL_MS) {
      return;
    }
    this.lastProgressSaveAt = now;
    setStorage(key, { src: this.props.src, time, duration });
  }

  /**
   * 清除进度记忆（播放结束时调用）
   */
  private clearSavedProgress(): void {
    const key = this.progressStorageKey();
    if (key) removeStorage(key);
  }

  /**
   * loadedmetadata 后恢复上次观看位置：
   * 进度 > 5 秒且 < duration - 10 秒时 seek，并广播 restoreProgress 事件
   * （UI 层订阅后提示「已为你恢复到上次观看位置」）
   */
  private restoreSavedProgress(duration: number): void {
    const key = this.progressStorageKey();
    if (!key || !Number.isFinite(duration) || duration <= 0) return;
    const saved = getStorage<{
      src: string;
      time: number;
      duration: number;
    } | null>(key, null);
    if (!saved || saved.src !== this.props.src) return;
    if (saved.time > 5 && saved.time < duration - 10) {
      if (this.videoEl) this.videoEl.currentTime = saved.time;
      this.state.set(PlayerStateKeyEnum.CURRENT_TIME, saved.time);
      this.events.emit(PlayerEventEnum.RESTORE_PROGRESS, { time: saved.time });
    }
  }

  /**
   * 注册配置的插件（plugins 现为 `{ list?: Plugin[] }`）
   */
  private registerPlugins(): void {
    const plugins = this.props.plugins?.list;
    if (!plugins || plugins.length === 0) return;

    plugins.forEach((plugin: Plugin) => {
      this.use(plugin);
    });
  }

  /**
   * 检测浏览器能力（客户端环境）
   */
  private detectCapability(): void {
    if (typeof window === "undefined") return;
    this.browserCapability =
      BrowserCapabilityDetector.getFullCapabilityResult();
    this.state.set("browser", this.browserCapability);
  }

  /**
   * 创建流媒体中间件并把已安装的流媒体插件注册进去
   */
  private setupStreamMiddleware(): void {
    if (!this.videoEl) return;
    this.streamMiddleware = new StreamMiddleware(this.videoEl);
    this.pluginManager?.forEachPlugin((plugin) => {
      if (isStreamPlugin(plugin)) {
        this.streamMiddleware!.registerStreamPlugin(plugin);
      }
    });
  }

  /**
   * 读取流媒体插件上报的下载速度
   *
   * 走既有入口 StreamMiddleware.getStats()（流媒体模式转发插件 getStats()），
   * 字段 `StreamStats.downloadSpeed` 的单位即「字节/秒」；
   * 原生模式（无流媒体插件）返回 0，由 PlayerDocker 回退到原生 Resource Timing 采样。
   *
   * @returns 下载速度（字节/秒）；无数据返回 0
   */
  private getStreamDownloadSpeed(): number {
    const stats = this.streamMiddleware?.getStats();
    if (!stats || !("downloadSpeed" in stats)) return 0;
    const speed = stats.downloadSpeed;
    return typeof speed === "number" && Number.isFinite(speed) && speed > 0
      ? speed
      : 0;
  }

  /**
   * 处理视频源配置
   * 支持字符串 URL、URL 数组（备用源）或渐进式多清晰度变体数组
   */
  private processSources(): void {
    const src = this.props.src;

    if (typeof src === "string") {
      this.manifestSource = null;
      this.sources = [{ url: src, label: "默认" }];
    } else if (Array.isArray(src) && src.length > 0) {
      this.manifestSource = null;
      if (typeof src[0] === "string") {
        const urlArray = src.filter(
          (item): item is string => typeof item === "string",
        );
        this.sources = urlArray.map((url, index) => ({
          url,
          label: index === 0 ? "默认" : `备用${index}`,
        }));
      } else {
        const variants = src.filter(
          (item): item is ProgressiveVariant =>
            typeof item === "object" && "url" in item,
        );
        variants.forEach((variant) => {
          if (isDev() && !variant.height && !variant.label) {
            logger.error(
              "[VideoPlayer] ProgressiveVariant 缺少 height 与 label（至少提供其一）:",
              variant,
            );
          }
        });
        this.sources = variants;
      }
    } else {
      this.sources = [];
      this.manifestSource =
        src !== null && typeof src === "object" ? src : null;
    }
  }

  /**
   * 渲染播放器
   *
   * 通过 props 把整包配置、ConfigStore 与清晰度快照传给 PlayerDocker；
   * 通过 onXxx 回调接收来自 PlayerDocker 的 UI 意图。
   *
   * @returns 虚拟节点
   */
  render(): VNode {
    return h(PlayerDocker, {
      player: this,
      src: this.getCurrentSourceUrl(),
      playerName: this.props.ui?.title,
      autoplay: this.props.playback?.autoplay,
      volume: this.props.playback?.volume,
      muted: this.props.playback?.muted,
      /** 整包配置：供 PlayerDocker 读取 ui.controls / danmaku / progress.segments 等 */
      config: this.props,
      /** 清晰度当前快照 */
      quality: {
        qualities: this.getQualities(),
        current: this.getCurrentQuality(),
        switchState:
          this.state.get(PlayerStateKeyEnum.QUALITY_SWITCH_STATE) ?? "idle",
        mode: this.getQualityMode(),
      },
      events: this.events,
      /**
       * 插件安装标志读取器：UI 按需渲染的数据源（未装插件的图层
       * 不挂载）。getter 形态传入——普通函数不触发 props 代理的
       * Signal 解包，透传链全程拿到函数本体，effect 内调用读取
       * signal.value 自动建立依赖
       */
      plugins: (): PlayerPluginFlags => this.pluginFlags.value,
      /** 音效插件 API：右键音效调节面板使用（未装插件返回 null） */
      getAudioEffect: () =>
        (this.getPluginAPI("audioEffect") as unknown as
          | import("@/nova/components/AudioPanel").AudioPanelApi
          | undefined) ?? null,
      /** 缓冲速度数据源（字节/秒）：流媒体插件统计优先，原生由 PlayerDocker 回退采样 */
      getStreamDownloadSpeed: () => this.getStreamDownloadSpeed(),
      /**
       * 原生流媒体播放器实例提供者（dash.js / hls.js / flv.js 实例）：
       * 由 PlayerDocker 转发给 VideoInfo，供码率曲线等统计监控读取库原生数据
       */
      getNativeStreamPlayer: () =>
        this.streamMiddleware?.getActivePlugin()?.getNativePlayer?.() ?? null,
      /**
       * 预览图提供者（progress.previewProvider 配置注入）
       * 进度条悬停时由 ProgressBar 按时间调用，数据获取逻辑完全由外部实现
       */
      previewProvider: this.props.progress?.previewProvider,
      /** 高能进度条数据提供者（progress.energyProvider 配置注入，外部获取数据） */
      energyProvider: this.props.progress?.energyProvider,
      onQualityChange: (quality: string) => {
        void this.setQuality(quality);
      },
      /** 容器点击 / 双击转发为对外事件（PlayerEvents.click / dblclick） */
      onPerchClick: (event: MouseEvent) => {
        this.emitter.emit("click", event);
      },
      onPerchDblclick: (event: MouseEvent) => {
        this.emitter.emit("dblclick", event);
      },
      onPrev: () => {
        void this.prev();
      },
      onNext: () => {
        void this.next();
      },
      /** 错误面板点击「刷新」：重载当前视频（清错误态 + 重新加载） */
      onRetry: () => {
        this.reload();
      },
      /** 选集面板点击某一集：按列表下标切集（UI → 播放列表） */
      onEplistChange: (index: number) => {
        void this.switchTo(index);
      },
      // 字幕设置面板：开关 / 语言 / 样式 / 双语 —— 落到播放器真实 API
      onSubtitleToggle: (visible: boolean) => {
        this.setSubtitleVisible(visible);
      },
      onSubtitleLangChange: (lang: string) => {
        this.setSubtitleLang(lang);
      },
      onSubtitleStyleChange: (patch: {
        fontSize?: number;
        color?: string;
        position?: "top" | "bottom";
        offset?: number;
        strokeColor?: string;
        strokeWidth?: number;
        opacity?: number;
        scale?: boolean;
        fade?: boolean;
      }) => {
        // 样式项全部下发给字幕插件真实生效：
        // - 字号：面板为比例档位（0.6-1.6），映射为绝对 px（基准 24）
        // - 位置：position=档位（上/下），offset=-1/0/1 为水平 左/中/右
        // - opacity=背景不透明度，scale=等比缩放（cqh），fade=淡入淡出
        // getPluginAPI 的泛型受 Plugin 约束，这里取回实例后按所需能力做结构化断言
        const api = this.getPluginAPI("subtitle") as
          | {
              setFontSize?: (size: number) => void;
              setColor?: (color: string) => void;
              setPosition?: (
                position?: "top" | "bottom",
                offset?: number,
              ) => void;
              setAlign?: (align: number) => void;
              setStroke?: (color?: string, width?: number) => void;
              setBackgroundOpacity?: (opacity: number) => void;
              setScale?: (scale: boolean) => void;
              setFade?: (fade: boolean) => void;
            }
          | undefined;
        if (!api) return;
        if (patch.fontSize !== undefined) {
          api.setFontSize?.(Math.round(24 * patch.fontSize));
        }
        if (patch.color !== undefined && patch.strokeColor === undefined) {
          api.setColor?.(patch.color);
        }
        // 位置档位（上/下）与水平对齐（左/中/右）分开发
        if (patch.position !== undefined) {
          api.setPosition?.(patch.position);
        }
        if (patch.offset !== undefined) {
          api.setAlign?.(patch.offset);
        }
        if (
          patch.strokeColor !== undefined ||
          patch.strokeWidth !== undefined
        ) {
          api.setStroke?.(patch.strokeColor, patch.strokeWidth);
        }
        if (patch.opacity !== undefined) {
          api.setBackgroundOpacity?.(patch.opacity);
        }
        if (patch.scale !== undefined) {
          api.setScale?.(patch.scale);
        }
        if (patch.fade !== undefined) {
          api.setFade?.(patch.fade);
        }
        // 持久化（语义化字段）：字号存换算后的 px，颜色/描边存字面量；
        // 位置/开关类（opacity/scale/fade/align）为即时偏好不落库
        const persistPatch: {
          fontSize?: number;
          primaryColor?: string;
          outlineColor?: string;
          outlineWidth?: number;
        } = {};
        if (patch.fontSize !== undefined) {
          persistPatch.fontSize = Math.round(24 * patch.fontSize);
        }
        if (patch.color !== undefined) {
          persistPatch.primaryColor = patch.color;
        }
        if (patch.strokeColor !== undefined) {
          persistPatch.outlineColor = patch.strokeColor;
        }
        if (patch.strokeWidth !== undefined) {
          persistPatch.outlineWidth = patch.strokeWidth;
        }
        if (Object.keys(persistPatch).length > 0) {
          this.store.updateSubtitleStyle(persistPatch);
        }
      },
      onBilingualChange: (enabled: boolean) => {
        // 双语字幕：转发到事件总线，由字幕插件自行处理（无对应能力时仅广播）
        this.events.emit(PlayerEventEnum.SUBTITLE_SWITCH, {
          lang: enabled ? "bilingual" : "",
        });
      },
      onDanmakuToggle: () => {
        this.toggleDanmaku();
      },
      onSendDanmaku: () => {
        this.emitter.emit("sendDanmaku");
      },
      onLike: () => {
        this.events.emit(PlayerEventEnum.INTERACTION_LIKE);
      },
      onCoin: () => {
        this.events.emit(PlayerEventEnum.INTERACTION_COIN);
      },
      onFavorite: () => {
        this.events.emit(PlayerEventEnum.INTERACTION_COLLECT);
      },
      onTripleLike: () => {
        this.events.emit(PlayerEventEnum.INTERACTION_LIKE);
        this.events.emit(PlayerEventEnum.INTERACTION_COIN);
        this.events.emit(PlayerEventEnum.INTERACTION_COLLECT);
      },
      onFollow: () => {
        this.events.emit(PlayerEventEnum.INTERACTION_FOLLOW);
      },
      onDisplayModeChange: (mode: DisplayMode) => {
        this.setDisplayMode(mode);
      },
      // 设置菜单项变化：mirror / loop / autostart / lightoff / pip / highenergy
      // + 单选组：handoff(播放方式) / aspect(视频比例) / codec(播放策略) / loudness(音量均衡)
      onSettingChange: (payload: {
        key: string;
        value: boolean | string | number;
      }) => {
        this.applySettingChange(payload.key, payload.value);
      },
      __providers: [
        { contextId: StateContext.id, value: this.state },
        { contextId: PlayerContext.id, value: this },
        {
          contextId: ConfigContext.id,
          value: this.props.ui?.controls ?? defaultControlConfig,
        },
        { contextId: ConfigStoreContext.id, value: this.configStore },
      ],
      onMounted: (elements: PlayerDockerMountedElements) => {
        // 保存 DOM 引用
        this.videoEl = elements.video;
        this.containerEl = elements.container;
        this.videoAreaEl = elements.videoArea;
        this.videoWrapEl = elements.videoWrap;
        this.el = elements.container;

        if (this.containerEl) {
          playerInstanceMap.set(this.containerEl, this);
        }

        /**
         * i18n 标识：nova-player-container 加 data-locale 属性，
         * 随语言切换响应式更新（初始写一次 + 订阅变更）
         */
        const localeTarget = this.videoEl?.closest(".nova-player-container");
        if (localeTarget instanceof HTMLElement) {
          localeTarget.dataset.locale = getLocale();
          this.localeUnsubscribe = subscribeLocale((locale) => {
            localeTarget.dataset.locale = locale;
          });
        }

        // 创建流媒体中间件并注册插件
        this.setupStreamMiddleware();

        /**
         * 起播前应用持久化编码偏好：流媒体插件实例创建/清单加载时
         * 即按偏好起播选流（HLS videoPreference 起播 tier），
         * 而非加载完成后回切
         */
        this.streamMiddleware?.setCodecPreference(
          this.store.getPersistentState().codecPreferType,
        );

        // 接通清晰度链路
        this.setupQualityPipeline();

        // 绑定视频事件
        this.bindVideoEvents();

        // 应用已合并的播放偏好到媒体元素（音量/静音/倍速，持久化优先合并的最终值）
        this.applyPlaybackToMedia();

        /**
         * 恢复画面比例 / 镜像 / 循环（持久化优先）：
         * 需要挂载后的视频元素才能应用，故在 MOUNTED 回调恢复
         * （此 props.playback 已在构造期完成持久化优先合并）。
         * 关灯模式不持久化（即时氛围功能），刷新后默认开灯，不在此恢复
         */
        if (this.store.hasPersistedData()) {
          const saved = this.store.getPersistentState();
          if (saved.aspect && saved.aspect !== "0:0") {
            this.setAspectRatio(saved.aspect);
          }
        }
        if (this.videoEl) {
          this.videoEl.loop = this.props.playback?.loop ?? false;
          if (this.props.playback?.mirror) {
            this.videoEl.style.transform = "scaleX(-1)";
          }
        }

        /**
         * 画面比例的动态重算：
         * 1. ResizeObserver——容器尺寸变化时重算 wrap 宽度百分比
         * 2. loadedmetadata 一次性——自适应模式需要视频原生宽高比，
         *    metadata 就绪后才有（在此之前按 contain 兜底不变形）
         */
        if (this.videoAreaEl && this.videoEl) {
          this.aspectResizeObserver = new ResizeObserver(() => {
            this.applyAspectRatio();
          });
          this.aspectResizeObserver.observe(this.videoAreaEl);
          this.videoEl.addEventListener(
            "loadedmetadata",
            () => this.applyAspectRatio(),
            { once: true },
          );
        }

        // 触发 ready 事件（经总线桥接转发到 emitter）
        this.events.emit(PlayerEventEnum.READY);
        const currentState = this.state.get(PlayerStateKeyEnum.STATE);
        if (currentState !== undefined) {
          // 初始状态同步到总线（emitter 侧由 STATE_CHANGE 桥接转发）
          this.events.emit(PlayerEventEnum.STATE_CHANGE, currentState);
        }

        // 触发插件挂载事件（sendingArea 兼容 undefined 契约：未装弹幕插件时为 null）
        this.events.emit("player:mounted", {
          container: this.containerEl,
          video: this.videoEl,
          sendingArea: elements.sendingArea ?? undefined,
        });
        this.events.emit(PlayerEventEnum.MOUNTED, {
          container: this.containerEl,
          video: this.videoEl,
          sendingArea: elements.sendingArea ?? undefined,
        });

        /**
         * 恢复音量均衡偏好（持久化优先）：音效插件（MOUNTED 回调内
         * 已完成音效链构建）据此激活压缩器，保证刷新/重建后面板
         * 设置与实际音频链路状态一致
         */
        const initialLoudness = this.store.hasPersistedData()
          ? this.store.getPersistentState().loudness
          : (this.props.playback?.loudness ?? 0);
        if (initialLoudness !== 0) {
          this.events.emit(PlayerEventEnum.AUDIO_EFFECT_CHANGE, {
            effect: "loudness",
            mode: initialLoudness,
          });
        }

        /**
         * 恢复持久化字幕样式（构造期「持久化优先」合并已把最终值
         * 写入 props.subtitle.style，此处落到字幕插件 API——语义化字段
         * 与插件 setStyle/.setPosition 一一对应；插件在字幕层挂载完成
         * 后统一 applyStyles，此处先写配置即可）
         */
        const persistedSubtitleStyle: Record<string, unknown> | undefined =
          this.props.subtitle?.style;
        if (
          persistedSubtitleStyle &&
          Object.keys(persistedSubtitleStyle).length > 0
        ) {
          const api = this.getPluginAPI("subtitle") as
            | {
                setStyle?: (style: {
                  fontName?: string;
                  fontSize?: number;
                  primaryColor?: string;
                  outlineColor?: string;
                  outlineWidth?: number;
                  bold?: boolean;
                }) => void;
                setPosition?: (
                  position?: "top" | "bottom",
                  offset?: number,
                ) => void;
              }
            | undefined;
          /** 类型守卫读取（style 为 Record<string, unknown>） */
          const readString = (key: string): string | undefined => {
            const value = persistedSubtitleStyle[key];
            return typeof value === "string" ? value : undefined;
          };
          const readNumber = (key: string): number | undefined => {
            const value = persistedSubtitleStyle[key];
            return typeof value === "number" ? value : undefined;
          };
          const readBoolean = (key: string): boolean | undefined => {
            const value = persistedSubtitleStyle[key];
            return typeof value === "boolean" ? value : undefined;
          };
          const stylePatch: {
            fontName?: string;
            fontSize?: number;
            primaryColor?: string;
            outlineColor?: string;
            outlineWidth?: number;
            bold?: boolean;
          } = {};
          const fontName = readString("fontName");
          if (fontName !== undefined) stylePatch.fontName = fontName;
          const fontSize = readNumber("fontSize");
          if (fontSize !== undefined) stylePatch.fontSize = fontSize;
          const primaryColor = readString("primaryColor");
          if (primaryColor !== undefined) {
            stylePatch.primaryColor = primaryColor;
          }
          const outlineColor = readString("outlineColor");
          if (outlineColor !== undefined) {
            stylePatch.outlineColor = outlineColor;
          }
          const outlineWidth = readNumber("outlineWidth");
          if (outlineWidth !== undefined) {
            stylePatch.outlineWidth = outlineWidth;
          }
          const bold = readBoolean("bold");
          if (bold !== undefined) stylePatch.bold = bold;
          if (Object.keys(stylePatch).length > 0) {
            api?.setStyle?.(stylePatch);
          }
          const bottomOffset = readNumber("bottomOffset");
          if (bottomOffset !== undefined) {
            api?.setPosition?.(undefined, bottomOffset);
          }
        }

        // 流媒体模式：通过中间件加载源
        // 清单对象（sources 为空数组）也必须在此处完成首帧加载，
        // 否则对象注入模式下首屏只会出现空壳 DOM。
        if (
          this.streamMiddleware &&
          this.streamMiddleware.getMode() !== PlayerMode.NATIVE &&
          this.props.src
        ) {
          // MSE 模式 video 元素不触发原生 loadstart（src 为 blob: 由插件供给），
          // 手动广播 LOAD_START 标记加载开始——LoadingPanel 初始加载遮罩
          // 由此显示（与 switchSource 的手动广播语义对齐）
          this.events.emit(PlayerEventEnum.LOAD_START);
          const target = this.resolveLoadTarget(this.props.src);
          if (target.url) {
            this.streamMiddleware.load({
              url: target.url,
              format: target.format,
            });
          }
        }

        // 自动播放（带声音播放失败则静音重试，确保自动起播）
        if (this.props.playback?.autoplay) {
          void this.attemptAutoplay();
        }
      },
    });
  }

  /**
   * 注册一个 video 监听器并记录引用（destroy 时统一摘除）
   */
  private addVideoListener(type: string, handler: EventListener): void {
    if (!this.videoEl) return;
    this.videoEl.addEventListener(type, handler);
    this.videoListeners.push({ type, handler });
  }

  /**
   * 绑定视频元素事件
   *
   * 覆盖 HTML5 媒体元素标准事件，每个事件会同步运行时状态并广播事件总线。
   */
  private bindVideoEvents(): void {
    if (!this.videoEl || this.videoEventsBound) return;
    this.videoEventsBound = true;

    // ============================================
    // 一、加载生命周期
    // ============================================

    /** loadstart：开始加载媒体 */
    this.addVideoListener("loadstart", () => {
      this.store.setLoading(true);
      this.state.set(PlayerStateKeyEnum.IS_LOADING, true);
      this.setState(PlayerState.LOADING);
      this.armLoadGuard();
      this.events.emit(PlayerEventEnum.LOAD_START);
      this.callbacks.loadstart?.();
    });

    /** loadedmetadata：元数据加载完成，duration 可用 */
    this.addVideoListener("loadedmetadata", () => {
      const duration = this.videoEl?.duration || 0;
      this.store.setLoading(false);
      this.clearLoadGuard();
      this.store.setDuration(duration);
      this.state.set(PlayerStateKeyEnum.IS_LOADING, false);
      this.state.set(PlayerStateKeyEnum.DURATION, duration);
      // 分辨率写入运行时状态（供「视频统计信息」面板等消费）；
      // 事件绑定归核心层独占后，此处为该键的唯一写入口
      this.state.set(
        PlayerStateKeyEnum.VIDEO_WIDTH,
        this.videoEl?.videoWidth ?? 0,
      );
      this.state.set(
        PlayerStateKeyEnum.VIDEO_HEIGHT,
        this.videoEl?.videoHeight ?? 0,
      );
      this.setState(PlayerState.IDLE);
      this.events.emit(PlayerEventEnum.LOADED_METADATA, { duration });
      this.callbacks.loadedmetadata?.(duration);

      // 换源/原生切档：等待 loadedmetadata 后再设 currentTime（修复被截断的 bug）
      const pending = this.pendingSeek;
      if (pending && pending.token === this.loadToken) {
        if (this.videoEl && pending.time > 0) {
          this.videoEl.currentTime = pending.time;
        }
        this.state.set(PlayerStateKeyEnum.CURRENT_TIME, pending.time);
        if (pending.autoplay) {
          void this.attemptAutoplay();
        }
      }
      this.pendingSeek = null;

      // 记忆播放进度恢复（本次加载没有显式起播时间时才恢复，
      // 避免与 startTime / 换源定位冲突）
      if (!(pending && pending.time > 0)) {
        this.restoreSavedProgress(duration);
      }

      // 原生 MP4 切档的成功信号
      const pendingQuality = this.pendingQuality;
      if (pendingQuality && pendingQuality.kind === "native") {
        this.resolveQualitySwitch(pendingQuality.to, pendingQuality.label);
      }

      // 完成换源 Promise（若存在）
      this.finishPendingLoad();
    });

    /** loadeddata：首帧数据加载完成 */
    this.addVideoListener("loadeddata", () => {
      this.events.emit(PlayerEventEnum.LOADED_DATA);
      this.callbacks.loadeddata?.();
    });

    /** canplay：缓冲足够，可以开始播放 */
    this.addVideoListener("canplay", () => {
      this.store.setWaiting(false);
      this.clearLoadGuards();
      this.events.emit(PlayerEventEnum.CAN_PLAY);
      this.callbacks.canplay?.();
    });

    /** canplaythrough：缓冲充足，可流畅播放至结尾 */
    this.addVideoListener("canplaythrough", () => {
      this.events.emit(PlayerEventEnum.CAN_PLAY_THROUGH);
    });

    /** durationchange：媒体时长变化 */
    this.addVideoListener("durationchange", () => {
      const duration = this.videoEl?.duration || 0;
      this.store.setDuration(duration);
      this.state.set(PlayerStateKeyEnum.DURATION, duration);
      this.events.emit(PlayerEventEnum.DURATION_CHANGE);
      this.callbacks.durationchange?.(duration);
    });

    /** progress：媒体数据周期性加载进度 */
    this.addVideoListener("progress", () => {
      if (this.videoEl && this.videoEl.buffered.length > 0) {
        const bufferedEnd = this.videoEl.buffered.end(
          this.videoEl.buffered.length - 1,
        );
        this.store.setBuffered(bufferedEnd);
        this.state.set(PlayerStateKeyEnum.BUFFERED, bufferedEnd);
        this.events.emit(PlayerEventEnum.PROGRESS);
        this.callbacks.progress?.(this.videoEl.buffered);
      }
    });

    /** suspend：浏览器主动暂停加载 */
    this.addVideoListener("suspend", () => {
      this.events.emit(PlayerEventEnum.SUSPEND);
      this.callbacks.suspend?.();
    });

    /** stalled：数据停滞 */
    this.addVideoListener("stalled", () => {
      this.events.emit(PlayerEventEnum.STALLED);
      this.callbacks.stalled?.();
    });

    /** abort：加载被中止 */
    this.addVideoListener("abort", () => {
      this.store.setLoading(false);
      this.state.set(PlayerStateKeyEnum.IS_LOADING, false);
      this.clearLoadGuards();
      this.events.emit(PlayerEventEnum.ABORT);
      this.callbacks.abort?.();
    });

    /** emptied：媒体被清空 */
    this.addVideoListener("emptied", () => {
      this.store.setEnded(false);
      this.clearLoadGuards();
      this.events.emit(PlayerEventEnum.EMPTIED);
      this.callbacks.emptied?.();
    });

    /** error：加载/解码错误 → 触发备用源切换 */
    this.addVideoListener("error", () => this.handleVideoError());

    // ============================================
    // 二、播放状态
    // ============================================

    this.addVideoListener("play", () => {
      this.store.setPlaying(true);
      this.store.setEnded(false);
      this.setState(PlayerState.PLAYING);
      this.events.emit(PlayerEventEnum.PLAY);
      this.callbacks.play?.();
    });

    this.addVideoListener("playing", () => {
      this.store.setWaiting(false);
      this.store.setPlaying(true);
      this.clearLoadGuards();
      this.setState(PlayerState.PLAYING);
      this.events.emit(PlayerEventEnum.PLAYING);
      this.callbacks.playing?.();
    });

    this.addVideoListener("pause", () => {
      this.store.setPlaying(false);
      // 主动暂停时画面静止：撤下缓冲超时守卫，避免误报网络错误
      this.clearBufferGuard();
      this.setState(PlayerState.PAUSED);
      this.events.emit(PlayerEventEnum.PAUSE);
      this.callbacks.pause?.();
    });

    /** ended：播放结束（loop=true 时不触发） */
    this.addVideoListener("ended", () => {
      this.store.setPlaying(false);
      this.store.setEnded(true);
      this.setState(PlayerState.ENDED);
      this.events.emit(PlayerEventEnum.ENDED);
      this.callbacks.ended?.();

      // 播放完成：清除该源的进度记忆（下次从头播放）
      this.clearSavedProgress();

      // 列表连播交由片尾面板的倒计时驱动（5s 可取消）：
      // 此处不立即切集，否则片尾面板会刚显示就被下一集覆盖。
      // 片尾面板在倒计时结束后通过 lifecycle「next」回到 VideoPlayer.next()。
    });

    // ============================================
    // 三、进度与跳转
    // ============================================

    this.addVideoListener("timeupdate", () => {
      const currentTime = this.videoEl?.currentTime || 0;
      const duration = this.videoEl?.duration || 0;
      this.state.set(PlayerStateKeyEnum.CURRENT_TIME, currentTime);
      // 跳过头尾：到达片头结束 / 片尾开始断点时自动跳转
      this.maybeSkipIntroOutro(currentTime, duration);
      // 进度记忆：节流写入持久化存储（记忆上次看到）
      this.saveProgressThrottled(currentTime, duration);
      this.events.emit(PlayerEventEnum.TIME_UPDATE, { time: currentTime });
      this.callbacks.timeupdate?.(currentTime, duration);
    });

    this.addVideoListener("seeking", () => {
      const currentTime = this.videoEl?.currentTime || 0;
      this.store.setWaiting(true);
      this.events.emit(PlayerEventEnum.SEEKING, { currentTime });
      this.callbacks.seeking?.(currentTime);
    });

    this.addVideoListener("seeked", () => {
      const currentTime = this.videoEl?.currentTime || 0;
      this.store.setWaiting(false);
      this.clearBufferGuard();
      this.state.set(PlayerStateKeyEnum.CURRENT_TIME, currentTime);
      this.events.emit(PlayerEventEnum.SEEKED, { currentTime });
      this.callbacks.seeked?.(currentTime);
    });

    // ============================================
    // 四、音量与速率
    // ============================================

    this.addVideoListener("volumechange", () => {
      const volume = this.videoEl?.volume ?? 1;
      const muted = this.videoEl?.muted ?? false;
      this.state.set(PlayerStateKeyEnum.VOLUME, volume);
      this.state.set(PlayerStateKeyEnum.MUTED, muted);
      // 音量 / 静音持久化：任何来源（滚轮 / 滑杆 / 快捷键 / API）的变化都会
      // 汇聚到 video 元素的 volumechange 事件，这里统一写入 profile JSON
      // （store.setVolume / setMuted 走 nova_player_profile；
      // 【修复记录】原 setStorage("volume") 写裸 key 是旧版机制，无人读回）
      this.store.setVolume(volume);
      this.store.setMuted(muted);
      this.events.emit(PlayerEventEnum.VOLUME_CHANGE, { volume, muted });
      this.callbacks.volumechange?.(volume, muted);
    });

    this.addVideoListener("ratechange", () => {
      const rate = this.videoEl?.playbackRate ?? 1;
      this.state.set(PlayerStateKeyEnum.PLAYBACK_RATE, rate);
      // 倍速持久化（同样以 video 元素的 ratechange 为唯一写入口，写 profile JSON）
      this.store.setPlaybackRate(rate);
      this.events.emit(PlayerEventEnum.RATE_CHANGE, rate);
      this.callbacks?.ratechange?.(rate);
    });

    // ============================================
    // 五、缓冲等待
    // ============================================

    this.addVideoListener("waiting", () => {
      this.store.setWaiting(true);
      this.armBufferGuard();
      this.events.emit(PlayerEventEnum.WAITING);
      this.callbacks.waiting?.();
    });

    // ============================================
    // 全屏变化监听（document 级原生事件）
    // ============================================
    this.fullscreenChangeHandler = (): void => {
      const isFullscreen = !!document.fullscreenElement;
      this.state.set(PlayerStateKeyEnum.IS_FULLSCREEN, isFullscreen);
      this.store.setScreenMode(isFullscreen ? "fullscreen" : "normal");
      this.events.emit(PlayerEventEnum.FULLSCREEN_CHANGE, { isFullscreen });
      this.callbacks.fullscreenchange?.(isFullscreen);
    };
    document.addEventListener("fullscreenchange", this.fullscreenChangeHandler);
  }

  /**
   * 移除 bindVideoEvents 注册的全部 video 监听器
   */
  private removeVideoListeners(): void {
    if (this.videoEl) {
      for (const { type, handler } of this.videoListeners) {
        this.videoEl.removeEventListener(type, handler);
      }
    }
    this.videoListeners = [];
    this.videoEventsBound = false;
  }

  /** 获取当前视频源 URL */
  private getCurrentSourceUrl(): string {
    if (this.sources.length === 0) return "";
    return this.sources[this.currentSourceIndex]?.url || this.sources[0].url;
  }

  /**
   * 根据源 URL 推断流媒体格式
   * @param url - 视频/流媒体源 URL
   * @returns 对应的 StreamFormatEnum 值
   */
  private detectStreamFormat(url: string): StreamFormatEnum {
    const lower = url.split("?")[0].toLowerCase();
    if (lower.endsWith(".m3u8") || /hls/i.test(url))
      return StreamFormatEnum.HLS;
    if (lower.endsWith(".mpd") || /dash/i.test(url))
      return StreamFormatEnum.DASH;
    if (lower.endsWith(".flv") || /flv/i.test(url)) return StreamFormatEnum.FLV;
    if (lower.endsWith(".json"))
      return /hls/i.test(url) ? StreamFormatEnum.HLS : StreamFormatEnum.DASH;
    return StreamFormatEnum.MP4;
  }

  /**
   * 解析换源目标（供中间件或原生 video 使用）
   *
   * 清单对象的协议由 detectManifestProtocol 按内容判定（mediaSourceType →
   * mediaSequence → SegmentBase → 默认 DASH），判定结果直接决定中间件选哪个插件。
   *
   * @param source - 视频源
   * @returns 中间件可消费的 url 与格式
   */
  private resolveLoadTarget(source: PlayerSource): {
    url: string | MediaManifestSource;
    format: StreamFormatEnum;
  } {
    if (typeof source === "string") {
      return { url: source, format: this.detectStreamFormat(source) };
    }
    if (Array.isArray(source)) {
      const first = source[0];
      const url = typeof first === "string" ? first : (first?.url ?? "");
      return { url, format: this.detectStreamFormat(url) };
    }
    return {
      url: source,
      format: this.formatOfProtocol(detectManifestProtocol(source)),
    };
  }

  /** 清单协议 → 流媒体格式 */
  private formatOfProtocol(protocol: "dash" | "hls"): StreamFormatEnum {
    return protocol === "hls" ? StreamFormatEnum.HLS : StreamFormatEnum.DASH;
  }

  /**
   * 当前源实际生效的流媒体格式
   *
   * 清单对象按内容判定协议；字符串源按 URL 推断。
   * 清晰度能力判定（getQualityMode）与首帧加载共用同一结果，避免两处分叉。
   *
   * @returns 流媒体格式
   */
  private currentStreamFormat(): StreamFormatEnum {
    if (this.manifestSource) {
      return this.formatOfProtocol(detectManifestProtocol(this.manifestSource));
    }
    const url = this.getCurrentSourceUrl();
    if (url) return this.detectStreamFormat(url);
    return StreamFormatEnum.MP4;
  }

  /**
   * 切换到下一个备用源（当前源加载失败时调用）
   * @returns 是否成功切换到备用源
   */
  private switchToNextBackupSource(): boolean {
    if (this.currentBackupIndex >= this.sources.length - 1) {
      logger.error("所有备用源都已尝试，无法播放");
      this.events.emit(PlayerEventEnum.ERROR, {
        error: "ALL_SOURCES_FAILED",
        code: undefined,
        message: "所有视频源都无法播放",
      });
      return false;
    }

    this.currentBackupIndex++;
    this.isSwitchingBackup = true;

    const backupSource = this.sources[this.currentBackupIndex];
    logger.info(`切换到备用源 ${this.currentBackupIndex}: ${backupSource.url}`);

    const wasPlaying = this.videoEl ? !this.videoEl.paused : false;
    const currentTime = this.videoEl ? this.videoEl.currentTime : 0;

    this.currentSourceIndex = this.currentBackupIndex;

    if (this.videoEl) {
      this.videoEl.src = backupSource.url;
      this.videoEl.load();
      this.pendingSeek = {
        token: this.loadToken,
        time: currentTime,
        autoplay: wasPlaying,
      };
    }

    this.isSwitchingBackup = false;

    this.events.emit(PlayerEventEnum.QUALITY_CHANGE, {
      quality: backupSource.label ?? backupSource.url,
      label: backupSource.label,
      isBackup: true,
    });

    // 备用源切换成功即视为从错误中恢复（§4.2 errorRecovery）
    this.events.emit(PlayerEventEnum.ERROR_RECOVERY);

    return true;
  }

  /**
   * 处理视频错误事件，尝试切换到备用源
   */
  private handleVideoError(): void {
    if (!this.videoEl || this.isSwitchingBackup) return;

    const error = this.videoEl.error;
    if (!error) return;

    this.clearLoadGuards();
    this.store.setLoading(false);
    this.state.set(PlayerStateKeyEnum.IS_LOADING, false);

    logger.error(`视频错误: ${error.code} - ${error.message}`);

    if (error.code === 2 || error.code === 4) {
      const switched = this.switchToNextBackupSource();
      if (!switched) {
        this.events.emit(PlayerEventEnum.ERROR, {
          error,
          code: error.code,
          message: error.message || "视频加载失败",
        });
      }
    } else {
      this.events.emit(PlayerEventEnum.ERROR, {
        error,
        code: error.code,
        message: error.message || "视频播放错误",
      });
    }
  }

  /**
   * 处理流媒体插件上报的致命错误（HLS/FLV/DASH fatal）
   *
   * 流媒体模式下媒体元素自身不会触发 error 事件（manifest/分片拉取
   * 失败发生在插件内部），若不在此收敛，UI 会永远停留在缓冲转圈。
   * 网络类错误与原生 error 同策略：优先切换备用源，无备用源才弹错误面板
   */
  private handleStreamError(payload: {
    message?: string;
    error?: unknown;
  }): void {
    // 备用源切换期间旧插件的 fatal（销毁竞态）不弹面板
    if (this.isSwitchingBackup) return;

    // 清晰度切换期间发生的流错误：视为本次切换失败并回调，不直接进入关播/错误面板
    if (this.pendingQuality) {
      this.failQualitySwitch(payload.message || "清晰度切换失败");
      return;
    }

    this.clearLoadGuards();
    this.store.setLoading(false);
    this.store.setWaiting(false);
    this.state.set(PlayerStateKeyEnum.IS_LOADING, false);

    logger.error(`流媒体错误: ${payload.message ?? "unknown stream error"}`);

    // 网络类致命错误按 code=2 上报（错误面板据此显示本地网络排查提示），
    // 并与原生网络错误同策略优先切换备用源
    const isNetwork = isNetworkStreamError(payload.error);
    if (isNetwork) {
      const switched = this.switchToNextBackupSource();
      if (switched) return;
    }

    this.events.emit(PlayerEventEnum.ERROR, {
      error: payload.error ?? null,
      code: isNetwork ? 2 : undefined,
      message: payload.message || "视频流加载失败",
    });
  }

  /**
   * 启动初始加载超时守卫（loadstart 时调用）
   * 超时未收到元数据则判定加载失败，弹出错误面板（替代无限转圈）
   */
  private armLoadGuard(): void {
    this.clearLoadGuard();
    this.loadGuardTimer = setTimeout(() => {
      this.loadGuardTimer = null;
      this.handleLoadTimeout("load-timeout");
    }, VideoPlayer.LOAD_TIMEOUT_MS);
  }

  /**
   * 启动缓冲恢复超时守卫（waiting 时调用）
   * 网络断开/CDN 卡死等场景 video 不再触发任何事件，超时兜底弹出错误面板
   */
  private armBufferGuard(): void {
    this.clearBufferGuard();
    this.bufferGuardTimer = setTimeout(() => {
      this.bufferGuardTimer = null;
      this.handleLoadTimeout("buffer-timeout");
    }, VideoPlayer.BUFFER_TIMEOUT_MS);
  }

  /** 清除初始加载超时守卫 */
  private clearLoadGuard(): void {
    if (this.loadGuardTimer !== null) {
      clearTimeout(this.loadGuardTimer);
      this.loadGuardTimer = null;
    }
  }

  /** 清除缓冲恢复超时守卫 */
  private clearBufferGuard(): void {
    if (this.bufferGuardTimer !== null) {
      clearTimeout(this.bufferGuardTimer);
      this.bufferGuardTimer = null;
    }
  }

  /** 清除全部加载/缓冲守卫（恢复播放、错误、销毁时调用） */
  private clearLoadGuards(): void {
    this.clearLoadGuard();
    this.clearBufferGuard();
  }

  /**
   * 加载/缓冲超时处理：停用加载态并广播 ERROR
   * message 缺省时错误面板回落到默认网络异常文案（i18n）
   */
  private handleLoadTimeout(code: "load-timeout" | "buffer-timeout"): void {
    this.store.setLoading(false);
    this.store.setWaiting(false);
    this.state.set(PlayerStateKeyEnum.IS_LOADING, false);
    logger.error(`load guard fired: ${code}`);
    this.events.emit(PlayerEventEnum.ERROR, { error: null, code });
  }

  /**
   * 挂载播放器到容器
   *
   * @param container - 容器元素
   */
  /**
   * 服务端渲染播放器为 HTML 字符串（不访问 DOM）
   *
   * 与 render() 共用同一 VNode 树；Node 环境可直接调用。
   * 客户端使用同一份 PlayerConfig 创建实例后调用 hydrate() 完成水合。
   */
  renderToString(): string {
    return renderVNodeToString(this.render());
  }

  /**
   * 在已有 SSR HTML 上水合播放器
   *
   * 必须使用与 SSR 相同的 PlayerConfig 创建实例，保证 VNode 结构一致。
   * @param container - 包含 SSR 播放器 HTML 的容器
   */
  hydrate(container: HTMLElement): void {
    this.vnode = this.render();
    hydrateVNode(this.vnode, container);
  }

  mount(container: HTMLElement): void {
    this.vnode = this.render();
    mount(this.vnode, container);
  }

  /**
   * 设置播放器状态
   *
   * @param state - 新状态
   */
  private setState(state: PlayerState): void {
    const prevState = this.state.get(PlayerStateKeyEnum.STATE);
    if (prevState !== state) {
      this.state.set(PlayerStateKeyEnum.STATE, state);
      // emitter 侧由 STATE_CHANGE 桥接统一转发，避免双发
      this.events.emit(PlayerEventEnum.STATE_CHANGE, state);
      this.callbacks.statechange?.(state);
    }
  }

  // ============================================
  // 公共 API 方法（插件）
  // ============================================

  /**
   * 使用插件（支持链式调用）
   *
   * @param plugin - 插件实例
   * @returns 当前播放器实例
   */
  use(plugin: Plugin): VideoPlayer {
    // SSR 环境只做数据侧初始化，插件 install 可能挂载 DOM / 读取 window
    if (!isBrowser()) return this;
    if (!this.pluginManager) {
      logger.error("插件管理器未初始化");
      return this;
    }
    /**
     * 先同步安装标志、再 install：
     * 后装场景（播放器已挂载后 player.use）插件 install 内会就地
     * 初始化（如 InteractionPlugin 检测 player.el 后挂载响应式根），
     * 此时对应图层 DOM 必须已挂载——effect 同步刷新，信号写入后
     * Show 立即完成 DOM 挂载，install 随后执行即可找到容器
     */
    this.syncPluginFlags(plugin.name, true);
    this.pluginManager.install(plugin);
    return this;
  }

  /**
   * 动态注册插件（use 的语义化别名）
   *
   * 插件 UI 的显示/隐藏由 pluginFlags 响应式驱动，
   * 运行期注册后无需手动操作 DOM，控制栏/图层会自动挂载。
   */
  registerPlugin(plugin: Plugin): VideoPlayer {
    return this.use(plugin);
  }

  /** 动态卸载插件（uninstallPlugin 的语义化别名），UI 自动移除 */
  unregisterPlugin(name: string): void {
    this.uninstallPlugin(name);
  }

  /** 是否已注册某个插件 */
  hasPlugin(name: string): boolean {
    return this.getPlugin(name) !== undefined;
  }

  /**
   * 获取已安装的插件
   *
   * @param name - 插件名称
   * @returns 插件实例，未安装则返回 undefined
   */
  getPlugin<T extends Plugin>(name: string): T | undefined {
    return this.pluginManager?.get<T>(name);
  }

  /**
   * 获取已安装插件的完整 API
   *
   * @param name - 插件名称
   * @returns 插件 API 实例，未安装则返回 undefined
   */
  getPluginAPI<T extends Plugin>(name: string): T | undefined {
    return this.pluginManager?.get<T>(name);
  }

  /**
   * 卸载插件
   *
   * @param name - 插件名称
   */
  uninstallPlugin(name: string): void {
    /**
     * 先 uninstall、再同步安装标志：
     * 插件 uninstall 清理（如卸载响应式根 / 解绑容器事件）需要
     * 对应图层 DOM 仍在场；清理完成后再写信号，Show 摘除 DOM
     */
    this.pluginManager?.uninstall(name);
    this.syncPluginFlags(name, false);
  }

  /**
   * 同步单个插件的安装标志到 pluginFlags 信号
   *
   * 仅处理与 UI 挂载相关的四个插件名（danmaku / subtitle /
   * interaction / interactiveVideo）；流媒体插件（dash / hls / flv）
   * 等不关联 UI 图层，静默忽略。信号以整体替换方式写入，
   * 各读取方（Show 控制流 / 右侧按钮渲染器）自动响应
   *
   * @param name - 插件名称
   * @param installed - 是否已安装
   */
  private syncPluginFlags(name: string, installed: boolean): void {
    /** 仅五个 UI 相关键有效，其它插件名直接忽略 */
    const isUIPluginKey = (key: string): key is keyof PlayerPluginFlags =>
      key === "danmaku" ||
      key === "subtitle" ||
      key === "interaction" ||
      key === "interactiveVideo" ||
      key === "audioEffect";
    if (!isUIPluginKey(name)) return;
    this.pluginFlags.value = {
      ...this.pluginFlags.value,
      [name]: installed,
    };
  }

  // ============================================
  // 配置动态更新
  // ============================================

  /**
   * 读取当前生效配置（只读）
   */
  getConfig(): Readonly<PlayerConfig> {
    return this.props;
  }

  /**
   * 视频元素访问器（只读）
   *
   * 供插件等外部消费方读取视频元素（如互动视频插件在 ENDED 后把
   * 最后一帧绘制到 canvas 上）；元素在 MOUNTED 前不可用，返回 null
   */
  get video(): HTMLVideoElement | null {
    return this.videoEl;
  }

  /**
   * 深合并并立即应用配置差异（不重建播放器、不重建 DOM）
   *
   * @param partial - 局部配置
   */
  setConfig(partial: DeepPartial<PlayerConfig>): void {
    const prev = this.props;
    const next = mergePlayerConfig(prev, partial);
    this.props = next;

    // 持久化配置即时生效（setConfig({storage:{enabled:false}}) 立即停用读写）
    configureStorage(next.storage);

    // 进度条分段同步到控件配置
    this.syncSegmentsToControls();

    // ── playback：音量 / 静音 / 倍速 / 循环 / 播放模式 ──
    const pb = next.playback ?? {};
    const prevPb = prev.playback ?? {};
    if (pb.volume !== undefined && pb.volume !== prevPb.volume) {
      this.setVolume(pb.volume);
    }
    if (pb.muted !== undefined && pb.muted !== prevPb.muted) {
      this.setMuted(pb.muted);
    }
    if (
      pb.playbackRate !== undefined &&
      pb.playbackRate !== prevPb.playbackRate
    ) {
      this.setPlaybackRate(pb.playbackRate);
    }
    if (pb.loop !== undefined && pb.loop !== prevPb.loop) {
      this.setLoop(pb.loop);
    }
    if (pb.playMode !== undefined && pb.playMode !== prevPb.playMode) {
      this.setPlayMode(pb.playMode);
    }

    // ── 资源：poster / src / playlist ──
    if (next.poster !== prev.poster) {
      this.setPoster(next.poster ?? "");
    }
    if (next.ui?.title !== prev.ui?.title) {
      this.applyTitle(next.ui?.title ?? "");
    }
    if (partial.playlist !== undefined) {
      this.playlist = normalizePlaylist(next);
      this.currentIndex = clamp(
        next.playlistIndex ?? 0,
        0,
        Math.max(0, this.playlist.length - 1),
      );
      /** 列表已归一化：同步 PLAYLIST / PLAYLIST_INDEX / PLAYLIST_LENGTH */
      this.syncPlaylistState();
      this.events.emit(PlayerEventEnum.PLAYLIST_CHANGE, {
        index: this.currentIndex,
        total: this.playlist.length,
      });
    }
    if (
      partial.playlistIndex !== undefined &&
      partial.playlistIndex !== prev.playlistIndex
    ) {
      void this.switchTo(next.playlistIndex ?? 0);
    } else if (partial.src !== undefined && next.src !== undefined) {
      void this.load(next.src);
    } else if (partial.playlist !== undefined && this.playlist.length > 0) {
      // 仅替换了列表：加载当前条目
      void this.switchTo(this.currentIndex);
    }

    // ── interaction.keyboard：写入配置中心，由 PlayerDocker 订阅后启停监听 ──
    // （键盘监听注册在 PlayerDocker，本类仅通过 ConfigStore 通知）

    // ── quality：上下限 / 默认档 / 选择模式 ──
    if (partial.quality !== undefined) {
      const q = next.quality ?? {};
      if (q.max !== undefined || q.min !== undefined) {
        this.applyQualityLimits({ max: q.max, min: q.min });
      }
      if (q.mode !== undefined && q.mode !== prev.quality?.mode) {
        this.setQualityMode(q.mode);
      }
      if (q.default !== undefined && q.default !== prev.quality?.default) {
        this.setQuality(q.default);
      }
    }

    // ── subtitle ──
    if (partial.subtitle !== undefined) {
      const st = next.subtitle ?? {};
      const prevSt = prev.subtitle ?? {};
      if (st.enabled !== undefined && st.enabled !== prevSt.enabled) {
        this.setSubtitleVisible(st.enabled);
      }
      if (st.list !== undefined && st.list !== prevSt.list) {
        this.setSubtitleList(st.list);
      }
    }

    // ── plugins：增量 use / uninstallPlugin ──
    if (partial.plugins !== undefined && partial.plugins.list !== undefined) {
      const nextList = next.plugins?.list ?? [];
      const prevList = prev.plugins?.list ?? [];
      for (const plugin of prevList) {
        const removed =
          !nextList.includes(plugin) &&
          !nextList.some((p) => p.name === plugin.name);
        if (removed) this.uninstallPlugin(plugin.name);
      }
      for (const plugin of nextList) {
        if (this.getPlugin(plugin.name) === undefined) this.use(plugin);
      }
    }

    // ── advanced：日志级别 ──
    if (partial.advanced !== undefined) {
      this.applyLogLevel(next);
    }

    // ── 通知配置中心（子组件按路径订阅，设置即生效） ──
    this.configStore.set(next);

    // ── 通知 UI：配置已变化（框架无响应式，需事件驱动） ──
    this.events.emit("configChange", { config: next });
  }

  /**
   * 把标题写入容器 aria-label
   * @param title - 播放器标题
   */
  private applyTitle(title: string): void {
    const container = this.getPlayerContainerEl();
    if (container) container.setAttribute("aria-label", title);
  }

  /** 获取 `.nova-player-container` 元素（兼容 containerEl 为 docker 根节点的情形） */
  private getPlayerContainerEl(): HTMLElement | null {
    if (!this.containerEl) return null;
    if (this.containerEl.classList.contains("nova-player-container")) {
      return this.containerEl;
    }
    const el = this.containerEl.querySelector(".nova-player-container");
    return el instanceof HTMLElement ? el : this.containerEl;
  }

  // ============================================
  // 播放控制
  // ============================================

  /**
   * 播放视频
   */
  async play(): Promise<void> {
    if (!this.videoEl) return;
    try {
      await this.videoEl.play();
      this.applyPlayingState();
    } catch (error) {
      logger.error("播放失败:", error);
      this.events.emit(PlayerEventEnum.ERROR, { error });
    }
  }

  /**
   * 应用播放中状态（play / attemptAutoplay 共用）
   */
  private applyPlayingState(): void {
    this.store.setPlaying(true);
    this.store.setPaused(false);
    this.store.setEnded(false);
    this.setState(PlayerState.PLAYING);
    this.events.emit(PlayerEventEnum.PLAY);
    this.callbacks.play?.();
  }

  /**
   * 尝试自动播放（浏览器自动播放策略 fallback）
   *
   * 工业级通用方案：
   *   1. 先尝试带声音播放（保留用户期望的音量状态）；
   *   2. 若被浏览器自动播放策略拦截（NotAllowedError），
   *      则强制静音后重试播放，确保视频一定能自动起播；
   *   3. 静音播放成功后保留静音状态，用户可手动取消静音。
   *
   * 仅在 autoplay=true 且非用户手动触发时调用。
   */
  async attemptAutoplay(): Promise<void> {
    if (!this.videoEl) return;
    // 第一次：带声音播放
    try {
      await this.videoEl.play();
      this.applyPlayingState();
      return;
    } catch (error) {
      if (!isAutoplayBlocked(error)) {
        // 非自动播放策略拦截（如加载未完成），按普通错误处理
        logger.error("自动播放失败:", error);
        this.events.emit(PlayerEventEnum.ERROR, { error });
        return;
      }
      // 浏览器拦截带声音自动播放：静音后重试
      logger.warn("自动播放被浏览器拦截，切换为静音播放");
      this.setMuted(true);
      try {
        await this.videoEl.play();
        this.applyPlayingState();
      } catch (err) {
        logger.error("静音自动播放仍失败:", err);
        this.events.emit(PlayerEventEnum.ERROR, { error: err });
      }
    }
  }

  /**
   * 暂停视频
   */
  pause(): void {
    if (!this.videoEl) return;
    this.videoEl.pause();
    this.store.setPlaying(false);
    this.store.setPaused(true);
    this.setState(PlayerState.PAUSED);
    this.events.emit(PlayerEventEnum.PAUSE);
    this.callbacks.pause?.();
  }

  /**
   * 切换播放/暂停
   */
  toggle(): void {
    const currentState = this.state.get(PlayerStateKeyEnum.STATE);
    if (currentState === PlayerState.PLAYING) {
      this.pause();
    } else {
      void this.play();
    }
  }

  /**
   * 跳转到指定时间
   *
   * @param time - 目标时间（秒）
   */
  seek(time: number): void {
    if (!this.videoEl) return;
    const duration = this.state.get(PlayerStateKeyEnum.DURATION);
    if (!duration || !isFinite(duration)) return;

    const clampedTime = clamp(time, 0, duration);
    const prevTime = this.state.get(PlayerStateKeyEnum.CURRENT_TIME) ?? 0;

    this.events.emit(PlayerEventEnum.SEEK_START, {
      time: clampedTime,
      previousTime: prevTime,
    });
    this.videoEl.currentTime = clampedTime;
    this.state.set(PlayerStateKeyEnum.CURRENT_TIME, clampedTime);
    this.events.emit(PlayerEventEnum.SEEK_END, {
      time: clampedTime,
      previousTime: prevTime,
    });
  }

  /**
   * 相对当前位置跳转
   *
   * @param delta - 相对秒数（可为负）
   */
  seekBy(delta: number): void {
    const current = this.state.get(PlayerStateKeyEnum.CURRENT_TIME) ?? 0;
    this.seek(current + delta);
  }

  /**
   * 重新加载视频
   */
  reload(): void {
    if (!this.videoEl) return;
    this.state.set(PlayerStateKeyEnum.ERROR_CODE, 0);
    this.state.set(PlayerStateKeyEnum.ERROR_MESSAGE, "");
    this.store.setLoading(true);
    this.store.setEnded(false);
    this.videoEl.load();
    this.setState(PlayerState.IDLE);
  }

  // ============================================
  // 音量 / 倍速
  // ============================================

  /**
   * 设置音量
   * @param volume - 音量值 (0-1)
   */
  setVolume(volume: number): void {
    const clampedVolume = clamp(volume, 0, 1);
    const isMuted = clampedVolume === 0;

    this.state.set(PlayerStateKeyEnum.VOLUME, clampedVolume);
    this.state.set(PlayerStateKeyEnum.MUTED, isMuted);
    this.store.setVolume(clampedVolume);
    this.store.setMuted(isMuted);

    if (this.videoEl) {
      this.videoEl.volume = clampedVolume;
      this.videoEl.muted = isMuted;
    }

    this.events.emit(PlayerEventEnum.VOLUME_CHANGE, {
      volume: clampedVolume,
      muted: isMuted,
    });
    this.callbacks.volumechange?.(clampedVolume, isMuted);
  }

  /**
   * 获取当前音量
   */
  getVolume(): number {
    return (
      this.state.get(PlayerStateKeyEnum.VOLUME) ?? this.videoEl?.volume ?? 1
    );
  }

  /**
   * 切换静音
   */
  toggleMute(): void {
    const currentVolume = this.state.get(PlayerStateKeyEnum.VOLUME) ?? 1;
    const currentMuted = this.state.get(PlayerStateKeyEnum.MUTED) ?? false;
    this.setVolume(currentVolume);
    this.setMuted(!currentMuted);
  }

  /**
   * 设置静音状态
   * @param muted - 是否静音
   */
  setMuted(muted: boolean): void {
    this.state.set(PlayerStateKeyEnum.MUTED, muted);
    this.store.setMuted(muted);

    if (this.videoEl) {
      this.videoEl.muted = muted;
    }

    this.events.emit(PlayerEventEnum.MUTED_CHANGE, muted);
  }

  /**
   * 是否静音
   */
  isMuted(): boolean {
    return (
      this.state.get(PlayerStateKeyEnum.MUTED) ?? this.videoEl?.muted ?? false
    );
  }

  /**
   * 设置播放速度
   * @param rate - 播放速度
   */
  setPlaybackRate(rate: number): void {
    this.state.set(PlayerStateKeyEnum.PLAYBACK_RATE, rate);
    this.store.setPlaybackRate(rate);

    if (this.videoEl) {
      this.videoEl.playbackRate = rate;
    }

    this.events.emit(PlayerEventEnum.RATE_CHANGE, rate);
    this.callbacks?.ratechange?.(rate);
  }

  /**
   * 获取播放速度
   */
  getPlaybackRate(): number {
    return (
      this.state.get(PlayerStateKeyEnum.PLAYBACK_RATE) ??
      this.videoEl?.playbackRate ??
      1
    );
  }

  /**
   * 设置是否循环（单曲循环语义）
   * 三路同步：运行时状态（面板 Switch 受控回显）+ 持久化（localStorage，
   * 刷新后经 MOUNTED 恢复）+ 视频元素 loop
   * @param loop - 是否循环
   */
  setLoop(loop: boolean): void {
    this.props.playback = { ...(this.props.playback ?? {}), loop };
    this.state.set(PlayerStateKeyEnum.LOOP, loop);
    this.store.updateSettingsFlags({ loop });
    if (this.videoEl) this.videoEl.loop = loop;
  }

  /**
   * 设置播放模式（列表连播策略）
   *
   * 说明：PlayerStateMap 未定义 playMode 状态键，这里写入配置对象，
   * 由 `ended` 处理逻辑读取生效。
   *
   * @param mode - ORDER | REPEAT_ALL | SHUFFLE
   */
  setPlayMode(mode: PlayMode): void {
    this.props.playback = { ...(this.props.playback ?? {}), playMode: mode };
    this.configStore.set(this.props);
  }

  // ============================================
  // 画面 / 全屏 / 画中画
  // ============================================

  /**
   * 切换全屏
   */
  async toggleFullscreen(): Promise<void> {
    const target = this.getPlayerContainerEl();
    if (!target) return;
    const wasFullscreen = fullscreen.isActive();
    await fullscreen.toggle(target);
    const isNowFullscreen = !wasFullscreen;

    this.store.setScreenMode(isNowFullscreen ? "fullscreen" : "normal");
    this.state.set(PlayerStateKeyEnum.IS_FULLSCREEN, isNowFullscreen);
    this.events.emit(PlayerEventEnum.FULLSCREEN_CHANGE, {
      isFullscreen: isNowFullscreen,
    });
  }

  /**
   * 进入全屏
   */
  async enterFullscreen(): Promise<void> {
    const target = this.getPlayerContainerEl();
    if (!target || fullscreen.isActive()) return;
    await fullscreen.request(target);
    this.state.set(PlayerStateKeyEnum.IS_FULLSCREEN, true);
    this.store.setScreenMode("fullscreen");
    this.events.emit(PlayerEventEnum.FULLSCREEN_CHANGE, { isFullscreen: true });
  }

  /**
   * 退出全屏
   */
  async exitFullscreen(): Promise<void> {
    if (!fullscreen.isActive()) return;
    await fullscreen.exit();
    this.state.set(PlayerStateKeyEnum.IS_FULLSCREEN, false);
    this.store.setScreenMode("normal");
    this.events.emit(PlayerEventEnum.FULLSCREEN_CHANGE, {
      isFullscreen: false,
    });
  }

  /**
   * 是否全屏
   */
  isFullscreen(): boolean {
    return (
      this.state.get(PlayerStateKeyEnum.IS_FULLSCREEN) ?? fullscreen.isActive()
    );
  }

  /**
   * 切换网页全屏
   */
  toggleWebFullscreen(): void {
    const isWeb = this.state.get(PlayerStateKeyEnum.IS_WEB_FULLSCREEN) ?? false;
    this.setDisplayMode(isWeb ? "normal" : "web");
  }

  /**
   * 是否网页全屏
   */
  isWebFullscreen(): boolean {
    return this.state.get(PlayerStateKeyEnum.IS_WEB_FULLSCREEN) ?? false;
  }

  /**
   * 切换宽屏
   *
   * 宽屏布局完全由播放器外部容器决定：播放器只切换内部宽屏状态并广播
   * `wideScreenChange`（payload 为是否宽屏），由外部监听后自行调整容器尺寸；
   * 播放器内部不修改 `data-screen`、不搬移发送栏，避免与控制权冲突。
   */
  toggleWideScreen(): void {
    this.setWideScreen(!this.isWideScreen());
  }

  /**
   * 设置宽屏状态（外部容器驱动的布局开关）
   *
   * 只做两件事：写运行时状态 `IS_WIDE_SCREEN`（控制栏宽屏按钮高亮 /
   * Lottie 图标随之响应式更新）+ 广播 `wideScreenChange`，回调参数为
   * 是否宽屏布尔值。外部程序通过 `player.on("wideScreenChange", ...)`
   * 或 `callbacks.wideScreenChange` 监听后自行控制外部容器布局。
   * @param isWide - 是否进入宽屏
   */
  setWideScreen(isWide: boolean): void {
    this.state.set(PlayerStateKeyEnum.IS_WIDE_SCREEN, isWide);
    this.events.emit(PlayerEventEnum.WIDE_SCREEN_CHANGE, {
      isWideScreen: isWide,
    });
  }

  /** 是否处于宽屏状态 */
  isWideScreen(): boolean {
    return this.state.get(PlayerStateKeyEnum.IS_WIDE_SCREEN) ?? false;
  }

  /**
   * 切换画中画
   *
   * 浏览器可能拒绝请求（无用户手势 / 视频未就绪 / 不支持），
   * 结束后一律以 document.pictureInPictureElement 的真实状态收敛三路状态，
   * 不按「请求成功」假设写值，避免面板 / 控制栏 / 播放器状态不一致。
   */
  async togglePip(): Promise<void> {
    if (!this.videoEl) return;
    try {
      if (pip.isActive()) {
        await pip.exit();
      } else {
        await pip.request(this.videoEl);
      }
    } catch {
      // 请求失败不抛出：继续按浏览器真实状态收敛（保持原状态并广播）
    }
    this.syncPipStateFromBrowser();
  }

  /**
   * 进入画中画
   */
  async enterPip(): Promise<void> {
    if (!this.videoEl || pip.isActive()) {
      this.syncPipStateFromBrowser();
      return;
    }
    try {
      await pip.request(this.videoEl);
    } catch {
      // 浏览器拒绝 / 不支持：不抛出，交由下方按真实状态收敛
    }
    this.syncPipStateFromBrowser();
  }

  /**
   * 退出画中画
   */
  async exitPip(): Promise<void> {
    if (!pip.isActive()) {
      this.syncPipStateFromBrowser();
      return;
    }
    try {
      await pip.exit();
    } catch {
      // 退出失败：同样以真实状态收敛
    }
    this.syncPipStateFromBrowser();
  }

  /**
   * 以浏览器真实画中画状态收敛 state / store，并广播 PIP_CHANGE
   *
   * 单一状态源：`document.pictureInPictureElement`。设置面板复选框、
   * 控制栏 state-active、播放器 store 标志都订阅这条链路，不再各自假设。
   * @returns 收敛后的画中画状态
   */
  private syncPipStateFromBrowser(): boolean {
    const isPip = pip.isActive();
    this.store.setPip(isPip);
    this.state.set(PlayerStateKeyEnum.IS_PIP, isPip);
    this.events.emit(PlayerEventEnum.PIP_CHANGE, { isPip });
    return isPip;
  }

  /**
   * 设置画面显示模式
   *
   * 宽屏（wide）是例外：布局由播放器外部容器决定，播放器只更新宽屏状态
   * 并广播 `wideScreenChange`，不写 `data-screen`、不改变播放器 DOM 布局，
   * 因此 `mode === 'wide'` 直接走 setWideScreen(true) 后返回。
   * 从宽屏切换到其它模式时先广播退出宽屏（外部容器据此还原）。
   * @param mode - normal | web | wide | mini
   */
  setDisplayMode(mode: DisplayMode): void {
    if (mode === "wide") {
      this.setWideScreen(true);
      return;
    }
    // 退出宽屏：先对外广播，外部容器负责还原布局
    if (this.isWideScreen()) {
      this.setWideScreen(false);
    }

    this.state.set(PlayerStateKeyEnum.DISPLAY_MODE, mode);
    this.state.set(PlayerStateKeyEnum.IS_MIN_PLAYER, mode === "mini");
    this.state.set(PlayerStateKeyEnum.IS_WEB_FULLSCREEN, mode === "web");

    const container = this.getPlayerContainerEl();
    if (container) {
      container.setAttribute("data-screen", mode === "web" ? "web" : mode);
    }

    this.events.emit(PlayerEventEnum.WEB_FULLSCREEN_CHANGE, {
      isWebFullscreen: mode === "web",
    });
  }

  // ============================================
  // 设置面板（mirror / loop / autostart / lightoff / pip / highenergy + 单选组）
  // ============================================

  /**
   * 应用设置面板项变化
   *
   * SettingMenu emit settingChange 的 key：
   * - 开关：mirror / loop / autostart / lightoff / pip / highenergy
   * - 单选组：handoff(播放方式) / aspect(视频比例) / codec(播放策略) / loudness(音量均衡)
   *
   * @param key - 配置键
   * @param value - 配置值
   */
  applySettingChange(key: string, value: boolean | string | number): void {
    switch (key) {
      case "mirror":
        this.setMirror(value === true);
        break;
      case "loop":
        this.setLoop(value === true);
        break;
      case "autostart":
        this.setAutostart(value === true);
        break;
      case "lightoff":
        this.setLightoff(value === true);
        break;
      case "skipIntroOutro":
        this.setSkipIntroOutro(value === true);
        break;
      case "pip":
        if (value === true) void this.enterPip();
        else void this.exitPip();
        break;
      // 「高能进度条」复选框只控制渲染态（PBP_RENDERED，由 SettingMenu 直写），
      // 常驻态（PBP_PERMANENT）归图钉（pbpPinClick）管理，此处不再代写，避免复选框悄悄切换图钉常驻
      case "handoff":
        // 0 = 自动切集（顺序播放），2 = 播完暂停（不自动切集）
        this.props.playback = {
          ...(this.props.playback ?? {}),
          playMode: PlayMode.ORDER,
          pauseAfterEnd: value === 2,
        };
        this.configStore.set(this.props);
        // 运行时状态（面板单选受控回显）+ 持久化（刷新后经构造期恢复）
        this.state.set(PlayerStateKeyEnum.PAUSE_AFTER_END, value === 2);
        this.store.updateSettingsFlags({ pauseAfterEnd: value === 2 });
        break;
      case "aspect":
        this.setAspectRatio(typeof value === "string" ? value : "0:0");
        break;
      case "codec":
        this.setCodecPrefer(typeof value === "number" ? value : 0);
        break;
      case "loudness":
        this.setLoudness(typeof value === "number" ? value : 0);
        break;
      default:
        break;
    }
  }

  /**
   * 设置镜像画面（水平翻转）
   * 三路同步：运行时状态（面板 Switch 受控回显）+ 持久化（localStorage，
   * 刷新后经构造期「持久化优先」合并恢复）+ 视频元素 transform
   * @param mirror - 是否镜像
   */
  setMirror(mirror: boolean): void {
    this.props.playback = { ...(this.props.playback ?? {}), mirror };
    this.configStore.set(this.props);
    this.state.set(PlayerStateKeyEnum.MIRROR, mirror);
    this.store.updateSettingsFlags({ mirror });
    if (this.videoEl) {
      this.videoEl.style.transform = mirror ? "scaleX(-1)" : "";
    }
  }

  /**
   * 设置自动开播
   * @param autostart - 是否自动开播
   */
  setAutostart(autostart: boolean): void {
    this.props.playback = {
      ...(this.props.playback ?? {}),
      autoplay: autostart,
    };
    this.configStore.set(this.props);
    this.state.set(PlayerStateKeyEnum.AUTOSTART, autostart);
    this.store.updateSettingsFlags({ autostart });
  }

  /**
   * 设置跳过头尾（自动跳过片头 / 片尾断点）
   * 三路同步：运行时状态（面板 Switch 受控回显）+ 持久化 + props 配置
   * @param skip - 是否开启
   */
  setSkipIntroOutro(skip: boolean): void {
    this.props.playback = {
      ...(this.props.playback ?? {}),
      skipIntroOutro: skip,
    };
    this.configStore.set(this.props);
    this.state.set(PlayerStateKeyEnum.SKIP_INTRO_OUTRO, skip);
    this.store.updateSettingsFlags({ skipIntroOutro: skip });
  }

  /**
   * 设置片头 / 片尾断点（外部数据源可运行时更新）
   * @param points - 断点秒数；传 null 清除
   */
  setSkipPoints(points?: ProgressSkipPoints | null): void {
    this.skipPoints = points ?? null;
    this.skipIntroDone = false;
    this.skipOutroDone = false;
  }

  /**
   * 跳过头尾：到达片头结束断点时跳到片头结束，到达片尾开始断点时切下一集 /
   * 跳到结尾。只在开关开启且存在对应断点时触发，每个视频只执行一次。
   * @param currentTime - 当前播放时间（秒）
   * @param duration - 总时长（秒）
   */
  private maybeSkipIntroOutro(currentTime: number, duration: number): void {
    if (this.state.get(PlayerStateKeyEnum.SKIP_INTRO_OUTRO) !== true) return;
    const points = this.skipPoints;
    if (!points) return;

    const introEnd = points.introEnd;
    if (
      !this.skipIntroDone &&
      typeof introEnd === "number" &&
      introEnd > 0 &&
      currentTime > 0.2 &&
      currentTime < introEnd
    ) {
      this.skipIntroDone = true;
      this.seek(introEnd);
      return;
    }

    const outroStart = points.outroStart;
    if (
      !this.skipOutroDone &&
      typeof outroStart === "number" &&
      outroStart > 0 &&
      duration > 0 &&
      currentTime >= outroStart
    ) {
      this.skipOutroDone = true;
      if (this.playlist.length > 1) {
        void this.next();
      } else {
        this.seek(Math.max(0, duration - 0.05));
      }
    }
  }

  /**
   * 设置关灯模式（不持久化：即时氛围功能，刷新后默认开灯）
   *
   * 开启时给播放器根节点（.nova-player-docker.nova-player-docker-major）
   * 加 nova-state-light-off 类（样式由 player.scss / sendbar.scss 消费），
   * 同时写运行时状态驱动设置面板 Checkbox 受控回显
   * @param on - 是否关灯
   */
  setLightoff(on: boolean): void {
    this.state.set(PlayerStateKeyEnum.LIGHTOFF, on);
    const docker = this.containerEl?.closest(
      ".nova-player-docker.nova-player-docker-major",
    );
    if (docker instanceof HTMLElement) {
      docker.classList.toggle("nova-state-light-off", on);
    }
  }

  /**
   * 设置视频画面比例
   * 本实现同款：
   * - "0:0" 自适应：目标比例 = 视频原生宽高比（metadata 就绪后），
   *   未就绪时 wrap 100% + contain 兜底不变形
   * - "4:3" / "16:9"：目标比例 = 指定值（与视频原生比例无关，
   *   画面会被拉伸到指定比例）
   * - 容器 resize（ResizeObserver）与 loadedmetadata 时自动重算
   *
   * 三路同步：运行时状态（面板单选受控回显）+ 持久化（localStorage，
   * 刷新后经 MOUNTED 恢复）+ wrap/video 元素样式
   * @param ratio - "0:0" 自动 | "4:3" | "16:9"
   */
  setAspectRatio(ratio: string): void {
    this.state.set(PlayerStateKeyEnum.ASPECT_RATIO, ratio);
    this.store.setAspect(ratio);
    this.aspectRatio = ratio;
    this.applyAspectRatio();
  }

  /**
   * 应用画面比例到 DOM（wrap 宽度百分比 + video fill）
   *
   * 纯样式计算（读取 clientWidth/Height + 写两个 style 属性），
   * ResizeObserver 回调频率下开销可忽略；不进响应式系统（DOM 度量
   * 不能被 Signal 依赖追踪）
   */
  private applyAspectRatio(): void {
    const video = this.videoEl;
    const wrap = this.videoWrapEl;
    const area = this.videoAreaEl;
    if (!video || !wrap || !area) return;

    const clear = () => {
      clearStyle(wrap, ["width", "height"]);
      clearStyle(video, "object-fit");
    };

    // 原始比例：只清除，不设置
    if (this.aspectRatio === "0:0") {
      clear();
      return;
    }

    // 指定比例：解析
    const [w, h] = this.aspectRatio.split(":");
    const wNum = Number(w);
    const hNum = Number(h);
    if (!(wNum > 0 && hNum > 0)) {
      clear(); // 非法比例：避免残留上一次的样式
      return;
    }

    const target = wNum / hNum;
    const areaW = area.clientWidth;
    const areaH = area.clientHeight;
    if (areaW <= 0 || areaH <= 0) return;

    // contain 双向适配：
    // - 容器更宽 → 宽度收缩，高度撑满
    // - 容器更窄 → 高度收缩，宽度撑满
    // 未撑满的一边按目标比例计算，撑满的一边恒为 100%
    const widthPct = Math.min(100, ((areaH * target) / areaW) * 100);
    const heightPct = Math.min(100, (areaW / target / areaH) * 100);

    wrap.style.width = `${widthPct.toFixed(4)}%`;
    wrap.style.height = `${heightPct.toFixed(4)}%`;
    video.style.objectFit = "fill";
  }

  /**
   * 设置编码偏好
   *
   * 三路同步：store 持久化（localStorage，下次加载经构造函数读回）+
   * 运行时状态（设置面板「编码格式」单选受控信号）+ 流媒体插件
   * （真实生效：HLS 按偏好起播选流；插件未实现时静默忽略）
   * @param type - 0 默认 / 1 HEVC / 2 AVC / 3 AV1
   */
  setCodecPrefer(type: number): void {
    if (type < 0 || type > 3) {
      logger.warn("Invalid codec prefer type", type);
      return;
    }
    this.store.setCodecPreferType(type);
    this.state.set(PlayerStateKeyEnum.CODEC_PREFER_TYPE, type);
    this.streamMiddleware?.setCodecPreference(type);
  }

  /**
   * 设置音量均衡模式
   *
   * 0 = 关闭（移除压缩器），1 = 标准，2 = 高动态
   * 通过事件总线广播，由音效插件 AudioEffectPlugin 订阅并应用对应动态压缩配置。
   * 未注册音效插件时仅存储偏好，不报错。
   * 同时持久化到 store（nova_player_profile.loudness），刷新/重建后
   * 由挂载期「持久化优先」恢复逻辑读回生效
   * @param mode - 0 关闭 / 1 标准 / 2 高动态
   */
  setLoudness(mode: number): void {
    this.props.playback = { ...(this.props.playback ?? {}), loudness: mode };
    this.configStore.set(this.props);
    // 持久化：下次加载即本次设置
    this.store.setLoudness(mode);
    // 广播音量均衡变化，音效插件据此调整 DynamicsCompressorNode 参数
    this.events.emit(PlayerEventEnum.AUDIO_EFFECT_CHANGE, {
      effect: "loudness",
      mode,
    });
  }

  // ============================================
  // 清晰度
  // ============================================

  /**
   * 切换清晰度（带「切换中/成功/失败」生命周期）
   *
   * @param quality - 目标档位 id（流媒体为档位索引字符串或 'auto'）
   */
  setQuality(quality: string): void {
    const from = this.getCurrentQuality();
    if (quality === from) return;

    const isStream =
      !!this.streamMiddleware &&
      this.streamMiddleware.getMode() !== PlayerMode.NATIVE;

    if (isStream) {
      this.streamAutoQuality = quality === "auto";
    }

    if (!isStream && this.resolveSourceIndex(quality) === -1) return;

    this.beginQualitySwitch(
      from,
      quality,
      this.qualityLabel(quality),
      isStream ? "stream" : "native",
    );

    if (isStream) {
      this.streamMiddleware?.setQuality(quality);
      return;
    }

    // 原生 / MP4 多变体：切换 currentSourceIndex，保留进度并等待 loadedmetadata 后恢复
    const index = this.resolveSourceIndex(quality);
    const wasPlaying =
      this.state.get(PlayerStateKeyEnum.STATE) === PlayerState.PLAYING;
    const currentTime = this.state.get(PlayerStateKeyEnum.CURRENT_TIME) ?? 0;
    this.currentSourceIndex = index;
    this.pendingSeek = {
      token: this.loadToken,
      time: currentTime,
      autoplay: wasPlaying,
    };
    if (this.videoEl) {
      this.videoEl.src = this.getCurrentSourceUrl();
    }
  }

  /**
   * 开始一次清晰度切换的生命周期
   */
  private beginQualitySwitch(
    from: string,
    to: string,
    label: string | undefined,
    kind: "stream" | "native",
  ): void {
    // 上一个未完成的切换直接作废（不视为失败，避免噪声）
    this.pendingQuality = null;

    const pending: NonNullable<VideoPlayer["pendingQuality"]> = {
      from,
      to,
      label,
      startedAt: Date.now(),
      kind,
    };

    this.pendingQuality = pending;
    this.state.set(PlayerStateKeyEnum.QUALITY_SWITCH_STATE, "switching");
    this.events.emit(PlayerEventEnum.QUALITY_CHANGE_REQUESTED, {
      from,
      to,
      label,
    });
  }

  /** 流媒体当前是否处于自动档（由插件回调 isAuto 得到，用于清晰度能力判定） */
  private streamAutoQuality: boolean | null = null;

  /**
   * 插件上报字幕轨道列表变化：写入运行时状态（字幕面板数据源）
   * payload 由字幕插件广播（SUBTITLE_TRACKS_CHANGE），tracks 为空表示回到纯配置语言模式
   */
  private handleSubtitleTracksChange(
    payload: PlayerEventMap["subtitleTracksChange"],
  ): void {
    this.state.set(PlayerStateKeyEnum.SUBTITLE_TRACKS, payload.tracks);
  }

  /**
   * 插件上报清晰度变化（HLS: LEVEL_SWITCHED / DASH: qualityChangeRendered）
   */
  private handleStreamQualityChange(
    payload: PlayerEventMap["streamQualityChange"],
  ): void {
    if (typeof payload.isAuto === "boolean") {
      this.streamAutoQuality = payload.isAuto;
    }
    const pending = this.pendingQuality;
    if (!pending || pending.kind !== "stream") {
      // 非切换期：仅同步当前档位
      if (payload.qualityId) {
        this.state.set(PlayerStateKeyEnum.QUALITY_CURRENT, payload.qualityId);
        this.state.set(PlayerStateKeyEnum.QUALITY, payload.qualityId);
      }
      return;
    }
    const toId = payload.qualityId ?? pending.to;
    const level: StreamQualityLevel = {
      id: toId,
      label: payload.label ?? toId,
      width: payload.width,
      height: payload.height,
      bitrate: payload.bitrate ?? 0,
      isAuto: payload.isAuto ?? toId === "auto",
    };
    this.resolveQualitySwitch(toId, payload.label, level);
  }

  /**
   * 标记切换成功并广播
   */
  private resolveQualitySwitch(
    toId: string,
    label?: string,
    level?: StreamQualityLevel,
  ): void {
    const pending = this.pendingQuality;
    if (!pending) return;
    this.pendingQuality = null;

    const elapsed = Date.now() - pending.startedAt;
    this.state.set(PlayerStateKeyEnum.QUALITY_CURRENT, toId);
    this.state.set(PlayerStateKeyEnum.QUALITY, toId);
    this.state.set(PlayerStateKeyEnum.QUALITY_SWITCH_STATE, "switched");

    this.events.emit(PlayerEventEnum.QUALITY_CHANGE_RENDERED, {
      from: pending.from,
      to: pending.to,
      quality: level,
      elapsed,
    });
    this.events.emit(PlayerEventEnum.QUALITY_CHANGE, {
      quality: toId,
      label,
      isAuto: level?.isAuto ?? toId === "auto",
    });
    this.callbacks.qualitychange?.(toId);
  }

  /**
   * 标记切换失败并广播
   */
  private failQualitySwitch(reason: string): void {
    const pending = this.pendingQuality;
    if (!pending) return;
    this.pendingQuality = null;

    this.state.set(PlayerStateKeyEnum.QUALITY_SWITCH_STATE, "failed");
    this.events.emit(PlayerEventEnum.QUALITY_CHANGE_FAILED, {
      from: pending.from,
      to: pending.to,
      reason,
    });
  }

  /** 取档位展示名 */
  private qualityLabel(id: string): string | undefined {
    const list = this.state.get(PlayerStateKeyEnum.AVAILABLE_QUALITIES) ?? [];
    const found = list.find((q) => q.id === id);
    return found?.label ?? this.props.quality?.labels?.[id];
  }

  /**
   * 获取当前生效档位 id（'auto' 或档位 id）
   */
  getCurrentQuality(): string {
    if (
      this.streamMiddleware &&
      this.streamMiddleware.getMode() !== PlayerMode.NATIVE
    ) {
      const current = this.streamMiddleware.getCurrentQuality();
      if (current) return current;
    }
    return (
      this.state.get(PlayerStateKeyEnum.QUALITY_CURRENT) ??
      this.state.get(PlayerStateKeyEnum.QUALITY) ??
      this.props.quality?.default ??
      "auto"
    );
  }

  /**
   * 获取当前可用清晰度列表
   */
  getQualities(): StreamQualityLevel[] {
    if (
      this.streamMiddleware &&
      this.streamMiddleware.getMode() !== PlayerMode.NATIVE
    ) {
      return this.streamMiddleware.getQualities();
    }
    return this.getNativeQualities();
  }

  /** 原生 / MP4 多变体：由 sources 映射出清晰度列表 */
  private getNativeQualities(): StreamQualityLevel[] {
    return this.sources.map((source, index) => ({
      id: String(index),
      label:
        source.label || (source.height ? `${source.height}p` : `档位 ${index}`),
      width: source.width ?? 0,
      height: source.height ?? 0,
      bitrate: source.bitrate ?? 0,
    }));
  }

  /**
   * 清晰度能力类型
   * - 原生单档 → 'none'；原生多变体 → 'static'
   * - HLS/DASH → 'adaptive'；FLV → 'none'
   */
  getQualityMode(): QualityCapability {
    if (
      this.streamMiddleware &&
      this.streamMiddleware.getMode() !== PlayerMode.NATIVE
    ) {
      const format = this.currentStreamFormat();
      if (format === StreamFormatEnum.FLV) return "none";
      if (format === StreamFormatEnum.HLS || format === StreamFormatEnum.DASH) {
        return this.streamAutoQuality === false ? "static" : "adaptive";
      }
      return "static";
    }
    return this.sources.length > 1 ? "static" : "none";
  }

  /**
   * 设置清晰度选择模式（自动 / 手动）
   * @param mode - 'auto' | 'manual'
   */
  setQualityMode(mode: "auto" | "manual"): void {
    this.props.quality = { ...(this.props.quality ?? {}), mode };
    this.configStore.set(this.props);
    this.events.emit(PlayerEventEnum.QUALITY_MODE_CHANGE, { mode });
    if (mode === "auto") this.setQuality("auto");
  }

  /**
   * 应用清晰度上下限（映射到 provider）
   * @param limits - 高度上限 / 下限（像素）
   */
  applyQualityLimits(limits: { max?: number; min?: number }): void {
    this.props.quality = {
      ...(this.props.quality ?? {}),
      max: limits.max,
      min: limits.min,
    };
    this.configStore.set(this.props);
    this.streamMiddleware?.applyLimits(limits);
  }

  /** 将档位 id 解析为 sources 索引（档位 id 即数组索引字符串；'auto' 取首档） */
  private resolveSourceIndex(quality: string): number {
    if (quality === "auto") return 0;
    const asIndex = Number(quality);
    if (
      Number.isInteger(asIndex) &&
      asIndex >= 0 &&
      asIndex < this.sources.length
    ) {
      return asIndex;
    }
    return -1;
  }

  /**
   * 接通清晰度链路：订阅中间件档位变化并写入运行时状态
   */
  private setupQualityPipeline(): void {
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    if (this.streamMiddleware) {
      this.unsubscribeQuality = this.streamMiddleware.onQualitiesChange(
        (list) => this.writeAvailableQualities(list),
      );
    }
    this.writeAvailableQualities(this.getQualities());
  }

  /** 写入运行时清晰度列表并广播 */
  private writeAvailableQualities(list: StreamQualityLevel[]): void {
    this.store.setAvailableQualities(list);
    this.state.set(PlayerStateKeyEnum.AVAILABLE_QUALITIES, list);
    this.state.set(PlayerStateKeyEnum.QUALITY_MODE, this.getQualityMode());
    this.events.emit(PlayerEventEnum.QUALITY_LIST_CHANGE, {
      qualities: list,
      mode: this.getQualityMode(),
    });
  }

  // ============================================
  // 媒体加载与播放列表（复用同一 video 元素）
  // ============================================

  /**
   * 换源加载（复用同一 `<video>` 元素与整棵 DOM）
   *
   * @param source - 新视频源
   * @param options - 起播时间 / 是否自动播放
   */
  load(
    source: PlayerSource,
    options?: { startTime?: number; autoplay?: boolean },
  ): Promise<void> {
    // 1. 竞态守卫：自增 token，过期回调（loadedmetadata）直接丢弃
    this.loadToken++;
    const token = this.loadToken;

    // 换源后重置片头 / 片尾跳过标记，避免新视频沿用上一个视频的跳过状态
    this.skipIntroDone = false;
    this.skipOutroDone = false;

    // 2. 暂停、清错误态、进度归零
    this.pause();
    this.state.set(PlayerStateKeyEnum.ERROR_CODE, 0);
    this.state.set(PlayerStateKeyEnum.ERROR_MESSAGE, "");
    this.state.set(PlayerStateKeyEnum.CURRENT_TIME, 0);
    this.state.set(PlayerStateKeyEnum.DURATION, 0);
    this.store.setLoading(true);
    this.store.setEnded(false);

    // 3. 弹幕清空；数据源换源完全由弹幕插件控制
    this.clearDanmaku();

    // 更新源并重建 sources
    this.props.src = source;
    this.processSources();
    this.currentSourceIndex = 0;
    this.currentBackupIndex = 0;

    // 4. 记录待应用的起播时间（loadedmetadata 后生效）
    const startTime = options?.startTime ?? this.props.playback?.startTime ?? 0;
    const autoplay =
      options?.autoplay ?? this.props.playback?.autoplay ?? false;
    this.pendingSeek = { token, time: startTime, autoplay };

    // 5. 触发 loadStart
    this.events.emit(PlayerEventEnum.LOAD_START);
    this.callbacks.loadstart?.();

    const isStream =
      !!this.streamMiddleware &&
      this.streamMiddleware.getMode() !== PlayerMode.NATIVE;

    if (isStream) {
      const target = this.resolveLoadTarget(source);
      this.streamMiddleware!.load({
        url: target.url,
        format: target.format,
        startTime,
      });
    } else if (this.videoEl) {
      this.videoEl.src = this.getCurrentSourceUrl();
    }

    // 6. 返回在 loadedmetadata（或超时）后 resolve 的 Promise
    return new Promise<void>((resolve) => {
      this.clearPendingLoad();
      this.pendingLoadResolve = resolve;
      this.pendingLoadTimer = setTimeout(() => {
        if (this.pendingLoadResolve === resolve) {
          this.pendingLoadResolve = null;
          this.pendingLoadTimer = null;
          resolve();
        }
      }, LOAD_METADATA_TIMEOUT_MS);
    });
  }

  /** 完成换源 Promise */
  private finishPendingLoad(): void {
    const hadPending = this.pendingLoadResolve !== null;
    this.clearPendingLoad();
    if (hadPending) this.emitEpisodeChange();
  }

  /** 清理并 resolve 未完成的换源 Promise */
  private clearPendingLoad(): void {
    if (this.pendingLoadTimer !== null) {
      clearTimeout(this.pendingLoadTimer);
      this.pendingLoadTimer = null;
    }
    const resolve = this.pendingLoadResolve;
    this.pendingLoadResolve = null;
    resolve?.();
  }

  /**
   * 播放列表 → 运行时状态快照（选集面板的数据源）
   *
   * - `id` / `title` 取 `MediaItem` 对应字段，`index` 取数组下标
   * - 每次调用都产生新的数组引用，订阅方（选集面板）据此感知列表变化
   *
   * @returns 结构为 `EpisodeOption[]` 的列表快照
   */
  private toPlaylistItems(): PlayerPlaylistItem[] {
    return this.playlist.map((item, index) => ({
      id: item.id,
      title: item.title,
      index,
    }));
  }

  /**
   * 同步播放列表相关的 3 个运行时状态键
   *
   * - `PLAYLIST`：列表快照（选集面板渲染用）
   * - `PLAYLIST_INDEX`：当前下标（选集面板高亮跟随用）
   * - `PLAYLIST_LENGTH`：列表长度
   *
   * 写入时机：构造期（首帧数据）、`emitEpisodeChange()`（切集完成）、
   * `setConfig()` 替换列表时。
   */
  private syncPlaylistState(): void {
    this.state.set(PlayerStateKeyEnum.PLAYLIST, this.toPlaylistItems());
    this.state.set(PlayerStateKeyEnum.PLAYLIST_INDEX, this.currentIndex);
    this.state.set(PlayerStateKeyEnum.PLAYLIST_LENGTH, this.playlist.length);
  }

  /** 广播当前播放条目变化 */
  private emitEpisodeChange(): void {
    const total = this.playlist.length;
    const item = this.playlist[this.currentIndex];
    /** 同步选集面板数据（PLAYLIST / PLAYLIST_INDEX / PLAYLIST_LENGTH） */
    this.syncPlaylistState();
    this.events.emit(PlayerEventEnum.EPISODE_CHANGE, {
      index: this.currentIndex,
      total,
      id: item?.id,
      title: item?.title,
    });
  }

  /**
   * 跳转到播放列表指定索引
   * @param index - 目标索引
   */
  async switchTo(index: number): Promise<void> {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.playlist.length
    ) {
      return;
    }
    const wasPlaying =
      this.state.get(PlayerStateKeyEnum.STATE) === PlayerState.PLAYING;
    this.currentIndex = index;
    this.state.set(PlayerStateKeyEnum.PLAYLIST_INDEX, index);

    const item = this.playlist[index];
    if (item.poster !== undefined) this.setPoster(item.poster);
    if (item.danmakuUrl !== undefined) this.setDanmakuSource(item.danmakuUrl);
    if (item.subtitleList !== undefined) {
      this.setSubtitleList(item.subtitleList);
    }

    await this.load(item.src, {
      startTime: item.startTime,
      autoplay: wasPlaying || (this.props.playback?.autoplay ?? false),
    });
  }

  /**
   * 播放下一个（按 playMode 决定越界行为）
   */
  async next(): Promise<void> {
    // §4.2 next：切换请求事件（越界不切换时也代表一次请求）
    this.events.emit(PlayerEventEnum.NEXT_REQUEST);
    await this.step(1);
  }

  /**
   * 播放上一个（按 playMode 决定越界行为）
   */
  async prev(): Promise<void> {
    // §4.2 prev：切换请求事件
    this.events.emit(PlayerEventEnum.PREV_REQUEST);
    await this.step(-1);
  }

  /**
   * 列表步进
   * - REPEAT_ALL：越界循环
   * - SHUFFLE：随机
   * - ORDER：到头 emit ENDED 且不切换
   */
  private async step(delta: 1 | -1): Promise<void> {
    const total = this.playlist.length;
    if (total <= 1) return;

    const mode = this.props.playback?.playMode ?? PlayMode.ORDER;
    let target = this.currentIndex + delta;

    if (target >= total || target < 0) {
      if (mode === PlayMode.REPEAT_ALL) {
        target = (target + total) % total;
      } else if (mode === PlayMode.SHUFFLE) {
        target = Math.floor(Math.random() * total);
      } else {
        this.events.emit(PlayerEventEnum.ENDED);
        this.callbacks.ended?.();
        return;
      }
    }

    await this.switchTo(target);
  }

  /**
   * 获取播放列表（只读副本）
   */
  getPlaylist(): readonly MediaItem[] {
    return [...this.playlist];
  }

  /**
   * 获取当前条目索引
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * 设置封面
   * @param url - 封面图 URL（空字符串表示为无封面）
   */
  setPoster(url: string): void {
    this.props.poster = url;
    const posterEl = this.containerEl?.querySelector(
      ".nova-player-video-poster",
    );
    if (posterEl instanceof HTMLElement) {
      posterEl.style.backgroundImage = url ? `url("${url}")` : "";
      posterEl.hidden = url === "";
    }
  }

  // ============================================
  // 弹幕
  // ============================================

  /**
   * 设置弹幕可见性
   */
  setDanmakuVisible(visible: boolean): void {
    this.state.set(PlayerStateKeyEnum.DANMAKU_VISIBLE, visible);
    // 插件订阅 DANMAKU_VISIBLE 状态键自动应用；此处仅向外部广播切换事件
    this.events.emit(PlayerEventEnum.DANMAKU_TOGGLE, { visible });
  }

  /** 切换弹幕显示，返回切换后的可见性 */
  toggleDanmaku(): boolean {
    const next = !this.isDanmakuVisible();
    this.setDanmakuVisible(next);
    return next;
  }

  /** 弹幕是否可见 */
  isDanmakuVisible(): boolean {
    return this.state.get(PlayerStateKeyEnum.DANMAKU_VISIBLE) ?? true;
  }

  /** 获取弹幕可见性（isDanmakuVisible 别名，对外公开 API） */
  getDanmakuVisible(): boolean {
    return this.isDanmakuVisible();
  }

  /** 设置弹幕不透明度 (0-1) */
  setDanmakuOpacity(opacity: number): void {
    const value = clamp(opacity, 0, 1);
    this.state.set(PlayerStateKeyEnum.DANMAKU_OPACITY, value);
    // 插件订阅 DANMAKU_OPACITY 状态键自动应用；此处仅向外部广播变化事件
    this.events.emit(PlayerEventEnum.DANMAKU_OPACITY_CHANGE, value);
  }

  /** 设置弹幕速度倍率 */
  setDanmakuSpeed(speed: number): void {
    const value = speed <= 0 ? 0.1 : speed;
    this.state.set(PlayerStateKeyEnum.DANMAKU_SPEED, value);
    // 插件订阅 DANMAKU_SPEED 状态键自动应用；此处仅向外部广播变化事件
    this.events.emit(PlayerEventEnum.DANMAKU_SPEED_CHANGE, value);
  }

  /**
   * 设置弹幕数据源（url 便捷通道，变化则通知插件换源）
   *
   * 数据获取逻辑全部由弹幕插件承担（provider 优先 / url 包装为分段 loader），
   * 播放器不再内置 fetch，避免与插件的分段加载协议冲突。
   */
  setDanmakuSource(url: string): void {
    // 数据源由弹幕插件持有；播放器只把换源请求转交插件 API
    this.getDanmakuApi()?.load?.({ url });
  }

  /** 清空弹幕（插件订阅 DANMAKU_CLEAR 事件清空渲染层） */
  clearDanmaku(): void {
    this.events.emit(PlayerEventEnum.DANMAKU_CLEAR);
  }

  /**
   * 发送弹幕（提交请求）
   *
   * 仅广播 DANMAKU_SEND 事件：弹幕插件订阅后组装完整弹幕
   * （读取状态中的颜色/模式），经 onSend 确认后上屏并广播 DANMAKU_SENT。
   * @param text - 弹幕文本
   * @param options - 发送选项（透传给插件，运行时校验后收窄）
   */
  sendDanmaku(text: string, options?: Record<string, unknown>): void {
    this.events.emit(PlayerEventEnum.DANMAKU_SEND, { text, options });
  }

  // ============================================
  // 发送栏互动计数（在线观看人数 / 弹幕总条数）
  // ============================================

  /**
   * 更新在线观看人数（服务端实时数据入口）
   *
   * 写入运行时状态 ONLINE_COUNT，发送栏底部「X 人正在看」经状态信号
   * 响应式刷新；同时广播 ONLINE_COUNT_CHANGE 供外部订阅。
   * 负数 / NaN / 小数按「非负整数」归一化。
   * @param count - 在线观看人数
   */
  setOnlineCount(count: number): void {
    const value = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    this.state.set(PlayerStateKeyEnum.ONLINE_COUNT, value);
    this.events.emit(PlayerEventEnum.ONLINE_COUNT_CHANGE, { count: value });
  }

  /** 读取在线观看人数 */
  getOnlineCount(): number {
    return this.state.get(PlayerStateKeyEnum.ONLINE_COUNT) ?? 0;
  }

  /**
   * 更新弹幕总条数（服务端实时数据入口，绝对值覆盖本地累计）
   *
   * 服务端推送的实时总数应调用本方法（而不是自增），保证与服务器一致；
   * 本地发送成功后由播放器监听 DANMAKU_SENT 自动 incrementDanmakuCount()，
   * 下一次服务端数据到达时再被本方法覆盖校准。
   * @param count - 弹幕总条数
   */
  setDanmakuCount(count: number): void {
    const value = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    this.state.set(PlayerStateKeyEnum.DANMAKU_COUNT, value);
    this.events.emit(PlayerEventEnum.DANMAKU_COUNT_CHANGE, { count: value });
  }

  /** 读取弹幕总条数 */
  getDanmakuCount(): number {
    return this.state.get(PlayerStateKeyEnum.DANMAKU_COUNT) ?? 0;
  }

  /**
   * 弹幕条数自增（本地发送成功后播放器自动调用）
   *
   * 也供外部按增量同步使用；负增量 / 非数字忽略（服务端总数校准请用
   * setDanmakuCount 绝对值覆盖）。
   * @param delta - 增量，默认 1
   */
  incrementDanmakuCount(delta = 1): void {
    const step = Number.isFinite(delta) ? Math.floor(delta) : 0;
    if (step === 0) return;
    this.setDanmakuCount(this.getDanmakuCount() + step);
  }

  /** 取弹幕插件 API（存在则转发） */
  private getDanmakuApi(): (Plugin & DanmakuPluginApi) | undefined {
    return this.getPluginAPI<Plugin & DanmakuPluginApi>("danmaku");
  }

  // ============================================
  // 字幕
  // ============================================

  /** 设置字幕可见性 */
  setSubtitleVisible(visible: boolean): void {
    this.state.set(PlayerStateKeyEnum.SUBTITLE_VISIBLE, visible);
    this.events.emit(PlayerEventEnum.SUBTITLE_TOGGLE, { visible });
  }

  /** 切换字幕显示，返回切换后的可见性 */
  toggleSubtitle(): boolean {
    const next = !(this.state.get(PlayerStateKeyEnum.SUBTITLE_VISIBLE) ?? true);
    this.setSubtitleVisible(next);
    return next;
  }

  /** 字幕是否可见 */
  isSubtitleVisible(): boolean {
    return this.state.get(PlayerStateKeyEnum.SUBTITLE_VISIBLE) ?? true;
  }

  /** 获取字幕可见性（isSubtitleVisible 别名，对外公开 API） */
  getSubtitleVisible(): boolean {
    return this.isSubtitleVisible();
  }

  /** 设置字幕语言 */
  setSubtitleLang(lang: string): void {
    this.state.set(PlayerStateKeyEnum.SUBTITLE_LANG, lang);
    this.events.emit(PlayerEventEnum.SUBTITLE_LANG_CHANGE, lang);
    this.events.emit(PlayerEventEnum.SUBTITLE_SWITCH, { lang });
  }

  /** 设置字幕轨道列表 */
  setSubtitleList(list: SubtitleConfig[]): void {
    const normalized = list ?? [];
    this.props.subtitle = { ...(this.props.subtitle ?? {}), list: normalized };
    this.events.emit(PlayerEventEnum.SUBTITLE_LIST_CHANGE, {
      count: normalized.length,
    });
  }

  // ============================================
  // 查询
  // ============================================

  /** 获取当前时间（秒） */
  getCurrentTime(): number {
    return this.state.get(PlayerStateKeyEnum.CURRENT_TIME) ?? 0;
  }

  /** 获取总时长（秒） */
  getDuration(): number {
    return this.state.get(PlayerStateKeyEnum.DURATION) ?? 0;
  }

  /** 获取缓冲进度（秒） */
  getBuffered(): number {
    return this.state.get(PlayerStateKeyEnum.BUFFERED) ?? 0;
  }

  /** 是否暂停中 */
  isPaused(): boolean {
    return this.state.get(PlayerStateKeyEnum.STATE) === PlayerState.PAUSED;
  }

  /** 是否正在播放 */
  isPlaying(): boolean {
    return this.state.get(PlayerStateKeyEnum.STATE) === PlayerState.PLAYING;
  }

  /**
   * 调整大小（广播容器尺寸）
   */
  resize(): void {
    const el = this.containerEl;
    this.events.emit(PlayerEventEnum.RESIZE, {
      width: el?.clientWidth ?? 0,
      height: el?.clientHeight ?? 0,
    });
  }

  // ============================================
  // 状态 / 事件
  // ============================================

  /**
   * 获取当前状态快照
   */
  getState(): PlayerStateData {
    const fullState = this.state.getState();
    const isRecord = (val: unknown): val is Record<string, unknown> =>
      typeof val === "object" && val !== null && !Array.isArray(val);
    const playerState: Record<string, unknown> = isRecord(fullState.player)
      ? fullState.player
      : {};
    const videoState: Record<string, unknown> = isRecord(fullState.video)
      ? fullState.video
      : {};

    const isNumber = (v: unknown): v is number => typeof v === "number";
    const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
    const isString = (v: unknown): v is string => typeof v === "string";

    const videoWidth = videoState.videoWidth;
    const videoHeight = videoState.videoHeight;
    const aspectRatio =
      isNumber(videoWidth) && isNumber(videoHeight)
        ? videoWidth / videoHeight
        : 16 / 9;

    const getPlayerState = (value: unknown): PlayerState => {
      if (value === PlayerState.PLAYING) return PlayerState.PLAYING;
      if (value === PlayerState.PAUSED) return PlayerState.PAUSED;
      if (value === PlayerState.ENDED) return PlayerState.ENDED;
      if (value === PlayerState.ERROR) return PlayerState.ERROR;
      if (value === PlayerState.LOADING) return PlayerState.LOADING;
      return PlayerState.IDLE;
    };

    return {
      state: getPlayerState(playerState.state),
      currentTime: isNumber(playerState.currentTime)
        ? playerState.currentTime
        : 0,
      duration: isNumber(playerState.duration) ? playerState.duration : 0,
      volume: isNumber(playerState.volume) ? playerState.volume : 1,
      muted: isBoolean(playerState.muted) ? playerState.muted : false,
      playbackRate: isNumber(playerState.playbackRate)
        ? playerState.playbackRate
        : 1,
      quality: isString(playerState.quality) ? playerState.quality : "auto",
      isFullscreen: isBoolean(playerState.isFullscreen)
        ? playerState.isFullscreen
        : false,
      isPip: isBoolean(playerState.isPip) ? playerState.isPip : false,
      buffered:
        playerState.buffered instanceof TimeRanges
          ? playerState.buffered
          : null,
      aspectRatio,
    };
  }

  /**
   * 注册事件监听
   *
   * @param event - 事件名
   * @param callback - 回调函数
   */
  /**
   * 解析事件名对应的订阅通道
   *
   * - `'bus'`：总线独有事件（未桥接，如 qualityListChange / seekStart）→ 直连内部总线
   * - `'emitter'`：已桥接事件或对外小写键（如 timeupdate）→ 走对外 emitter
   *
   * 已桥接的事件必须走 emitter：既避免同一事件经两条通道重复投递，
   * 也保留桥接时按对外签名做过的 payload 适配（如 progress 的 TimeRanges）。
   *
   * @param name - 事件名（对外小写键或总线 camelCase 键）
   */
  private resolveEventChannel(name: string): "bus" | "emitter" {
    return !this.bridgedBusKeys.has(name) && BUS_EVENT_NAMES.has(name)
      ? "bus"
      : "emitter";
  }

  /**
   * 监听播放器事件
   *
   * 支持两类事件名，按名称自动选择通道：
   * - 对外事件（小写键，如 `'timeupdate'`）：由 emitter 投递，回调为多参数形态
   * - 总线事件（camelCase 键，如 `'qualityListChange'`）：直连内部总线，回调收到单个 payload
   *
   * @param event - 事件名
   * @param callback - 回调函数
   * @returns 取消该监听的函数（与 `events.on` 语义一致）
   */
  on<K extends keyof PlayerEvents>(
    event: K,
    callback: PlayerEvents[K],
  ): () => void {
    const name = event as string;
    if (this.resolveEventChannel(name) === "bus") {
      const offBus = this.events.on(name as never, callback as never);
      return () => offBus();
    }
    this.emitter.on(name, callback);
    return () => {
      this.emitter.off(name, callback);
    };
  }

  /**
   * 监听播放器事件（只触发一次，触发后自动解除）
   *
   * 说明：没有直接复用 `EventEmitter.once` / 总线的一次性监听，因为它们不暴露
   * 内部包装函数，无法通过 `off(event, callback)` 取消。这里手动包装以便返回可用的取消函数。
   *
   * @param event - 事件名
   * @param callback - 回调函数
   * @returns 取消该监听的函数
   */
  once<K extends keyof PlayerEvents>(
    event: K,
    callback: PlayerEvents[K],
  ): () => void {
    const name = event as string;
    let fired = false;

    if (this.resolveEventChannel(name) === "bus") {
      const busHandler = ((payload: unknown) => {
        if (fired) return;
        fired = true;
        this.events.off(name as never, busHandler as never);
        (callback as (p: unknown) => void)(payload);
      }) as never;
      this.events.on(name as never, busHandler);
      return () => this.events.off(name as never, busHandler);
    }

    const handler = ((...args: Parameters<PlayerEvents[K]>) => {
      if (fired) return;
      fired = true;
      this.emitter.off(name, handler);
      callback(...args);
    }) as PlayerEvents[K];
    this.emitter.on(name, handler);
    return () => {
      this.emitter.off(name, handler);
    };
  }

  /**
   * 移除事件监听
   *
   * @param event - 事件名
   * @param callback - 回调函数
   */
  off<K extends keyof PlayerEvents>(event: K, callback: PlayerEvents[K]): void {
    const name = event as string;
    if (this.resolveEventChannel(name) === "bus") {
      this.events.off(name as never, callback as never);
      return;
    }
    this.emitter.off(name, callback);
  }

  // ============================================
  // 生命周期
  // ============================================

  /**
   * 销毁播放器
   *
   * 卸载顺序按 Vue 的组件树卸载语义编排：
   * 1. 暂停 + 取消换源竞态 / 定时器 + 复位运行时状态；
   * 2. 从最深子组件逐层向上到根，执行各组件的统一卸载入口（DOM 调用 / 事件 /
   *    定时器 / ResizeObserver / IntersectionObserver / 模板 ref），此时 DOM 仍在；
   * 3. 销毁流媒体中间件（含 dash.js / hls.js 实例）；
   * 4. 销毁插件管理器（卸载其余插件）；
   * 5. 取消清晰度与事件桥接订阅；
   * 6. 解绑根级监听（video 监听 / document 监听）并安全断开媒体（pause → 清 src → load，
   *    放在插件销毁之后，避免 dash.js 的 SourceBuffer 已被摘除后仍被轮询）；
   * 7. 广播 DESTROY，最后移除根节点（destroy(vnode) 由子到父移除 DOM）。
   */
  destroy(): void {
    // ── 1. 暂停并取消竞态 ──
    this.pause();

    // ── 释放 画面比例的动态重算资源 + 语言标识订阅 ──
    this.aspectResizeObserver?.disconnect();
    this.aspectResizeObserver = null;
    this.localeUnsubscribe?.();
    this.localeUnsubscribe = null;

    this.loadToken++;
    this.clearPendingLoad();
    this.pendingSeek = null;
    this.pendingQuality = null;

    // 重置 Store 运行时状态
    this.store.setPlaying(false);
    this.store.setPaused(true);
    this.store.setEnded(false);
    this.store.setLoading(false);
    this.store.setWaiting(false);

    // ── 2. 组件树：最深子组件 → 根 ──
    if (this.vnode) {
      teardownComponentTree(this.vnode);
    }

    // ── 3. 流媒体中间件（含 activePlugin.destroy）──
    this.streamMiddleware?.destroy();
    this.streamMiddleware = null;

    // ── 4. 插件管理器 ──
    this.pluginManager?.destroy();
    this.pluginManager = null;

    // ── 5. 取消清晰度 / 桥接订阅 ──
    this.unsubscribeQuality?.();
    this.unsubscribeQuality = null;
    this.unsubscribeStreamQuality?.();
    this.unsubscribeStreamQuality = null;
    this.unsubscribeSubtitleTracks?.();
    this.unsubscribeSubtitleTracks = null;
    this.unsubscribeStreamError?.();
    this.unsubscribeStreamError = null;
    // 释放加载/缓冲超时守卫定时器
    this.clearLoadGuards();

    // ── 6. 解绑根级监听并安全断开媒体 ──
    this.removeVideoListeners();

    // 媒体断开必须在流媒体插件销毁之后：先摘 src 会把 MediaSource 从 video 元素上摘除，
    // 此时若 dash.js 仍在轮询 buffer ranges 就会抛
    // 「SourceBuffer has been removed from the parent media source」。
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute("src");
      this.videoEl.load();
    }

    this.emitter.removeAllListeners();

    if (this.fullscreenChangeHandler) {
      document.removeEventListener(
        "fullscreenchange",
        this.fullscreenChangeHandler,
      );
      this.fullscreenChangeHandler = null;
    }

    // ── 7. 广播销毁事件 + 移除根节点 ──
    // 广播销毁事件（桥接仍生效，destroy 会同步转发到 emitter）
    this.events.emit(PlayerEventEnum.DESTROY);

    // 取消事件桥接订阅（destroy 事件转发完成后统一清理）
    for (const unsubscribe of this.bridgeUnsubscribes) {
      unsubscribe();
    }
    this.bridgeUnsubscribes = [];

    // 销毁虚拟节点（由子到父移除 DOM，根节点最后移除）
    if (this.vnode) {
      destroy(this.vnode);
    }

    // 从 WeakMap 中移除
    if (this.containerEl) {
      playerInstanceMap.delete(this.containerEl);
    }

    // 清理引用
    this.videoEl = null;
    this.containerEl = null;
    this.vnode = null;
    this.manifestSource = null;
  }

  /**
   * 挂载前钩子
   */
  onBeforeMount(): void {
    // 可在此做预处理
  }

  /**
   * 挂载完成钩子
   */
  onMounted(): void {
    // 初始化逻辑已移入 render 的 onMounted 回调
  }

  /**
   * 销毁前钩子
   */
  onBeforeDestroy(): void {
    this.pause();
  }

  /**
   * 销毁完成钩子
   */
  onDestroyed(): void {
    // 清理工作已在 destroy 方法中完成
  }

  // ============================================
  // i18n 国际化
  // ============================================

  /**
   * 切换当前语言
   *
   * 触发所有读取 localeSignal 的 effect 重跑（编译期 _reactiveText 包装的文本节点
   * 会自动更新 DOM），实现精准更新而非全量重渲染。
   *
   * @param locale - 语言代码，如 'zh-CN'、'en-US'
   */
  setLocale(locale: Locale): void {
    setLocale(locale);
  }

  /**
   * 获取当前语言
   * @returns 当前语言代码
   */
  getLocale(): Locale {
    return getLocale();
  }

  /**
   * 注册语言包
   *
   * @param locale - 语言代码
   * @param messages - 翻译映射 { key: text }
   */
  registerLocale(locale: Locale, messages: Record<string, string>): void {
    registerLocale(locale, messages);
  }

  /**
   * 订阅语言变化
   *
   * 适用于插槽内容或命令式 DOM 操作：插槽不在编译期追踪范围内，
   * 开发者可通过此 API 在 onMounted 中订阅，手动更新 DOM 文本。
   *
   * @param listener - 语言变化回调
   * @returns 取消订阅函数
   */
  subscribeLocale(listener: (locale: Locale) => void): () => void {
    return subscribeLocale(listener);
  }

  /**
   * 获取语言响应式 Signal
   *
   * 供插槽组件配合 onEffect 实现编译期外响应式更新：
   * ```ts
   * const player = useContext(PlayerContext);
   * const locale$ = player.getLocaleSignal();
   * onEffect(() => {
   *   const locale = locale$.value; // 读取建立依赖
   *   el.textContent = t('my.key'); // setLocale 时自动重跑
   * });
   * ```
   *
   * @returns 语言 Signal（与 core/i18n.ts 的 localeSignal 同一实例）
   */
  getLocaleSignal(): Signal<Locale> {
    return localeSignal;
  }
}
