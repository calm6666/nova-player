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
} from "@/types";
import { PlayerState, PlayMode } from "@/types";
import "../styles/style.scss";
import {
  h,
  mount,
  destroy,
  createTypedStateManager,
  createTypedEventBus,
} from "@/core";
import type { TypedStateManager, TypedEventBus } from "@/core";
import type { Plugin } from "@/nova/core/plugin";
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
import { PluginManager } from "@/nova/core/pluginManager";
import { teardownComponentTree } from "@/nova/core/componentUnmount";
import { createPlayerStore } from "@/nova/store";
import type { PlayerStore } from "@/nova/store";
import { createLogger, loggerManager, LogLevel } from "@/utils";
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
const QUALITY_SWITCH_TIMEOUT_MS = 10000;

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
  video: HTMLVideoElement;
  sendingArea: HTMLElement;
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
      danmakuUrl: props.danmaku?.url,
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
  /** 播放器配置（命名空间形态，可被 setConfig 动态更新） */
  props: PlayerConfig;

  /** 播放器根元素 */
  el?: HTMLElement;

  /** 视频元素 */
  private videoEl: HTMLVideoElement | null = null;

  /** 播放器容器元素 */
  private containerEl: HTMLElement | null = null;

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

  /** 流媒体中间件：统一管理 Native 与 Streaming 两种模式 */
  streamMiddleware: StreamMiddleware | null = null;

  /** 清晰度列表订阅的取消函数 */
  private unsubscribeQuality: (() => void) | null = null;

  /** 清晰度切换成功信号（STREAM_QUALITY_CHANGE）的订阅取消函数 */
  private unsubscribeStreamQuality: (() => void) | null = null;

  /** 字幕轨道列表变化（SUBTITLE_TRACKS_CHANGE）的订阅取消函数 */
  private unsubscribeSubtitleTracks: (() => void) | null = null;

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
    timer: ReturnType<typeof setTimeout> | null;
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
    /** 只在用户未显式指定时用持久化偏好覆盖；构造新对象避免污染共享默认值 */
    this.props.playback = {
      ...playback,
      volume:
        playback.volume === defaultConfig.playback?.volume
          ? persistentState.volume
          : playback.volume,
      muted:
        playback.muted === defaultConfig.playback?.muted
          ? persistentState.isMuted
          : playback.muted,
      playbackRate:
        playback.playbackRate === defaultConfig.playback?.playbackRate
          ? persistentState.playbackRate
          : playback.playbackRate,
    };

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
        danmakuVisible: this.props.danmaku?.visible ?? true,
        danmakuOpacity: this.props.danmaku?.opacity ?? 1,
        danmakuSpeed: this.props.danmaku?.speed ?? 1,
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
      },
      video: {
        width: 0,
        height: 0,
        aspectRatio: 0,
      },
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

    /** 存储用户回调函数（必须在 restorePersistedPlayback 之前：后者会经 setPlaybackRate 触发 ratechange） */
    this.callbacks = this.props.callbacks ?? {};

    /** 持久化偏好读回并应用（音量 / 静音 / 倍速，仅用户未显式配置时生效） */
    this.restorePersistedPlayback();

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

  /** 把 progress.segments 同步进 ui.controls.progressSegments（Controls 读取路径） */
  private syncSegmentsToControls(): void {
    const segments = this.props.progress?.segments;
    if (segments === undefined) return;
    // 构造新对象，避免污染共享的 defaultControlConfig
    const controls = {
      ...(this.props.ui?.controls ?? defaultControlConfig),
      progressSegments: segments,
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
   * 读回并应用持久化的音量 / 静音 / 倍速
   *
   * 应用顺序与既有实现一致：构造期读取 → setVolume / setMuted / setPlaybackRate。
   * 仅在用户未显式配置对应项时生效（与构造期 store 持久化的语义一致）。
   */
  private restorePersistedPlayback(): void {
    const playback = this.props.playback ?? {};
    if (playback.volume === defaultConfig.playback?.volume) {
      const savedVolume = getStorage<number>("volume", Number.NaN);
      if (!Number.isNaN(savedVolume)) this.setVolume(savedVolume);
    }
    if (playback.muted === defaultConfig.playback?.muted) {
      const savedMuted = getStorage<boolean | null>("muted", null);
      if (savedMuted !== null) this.setMuted(savedMuted);
    }
    if (playback.playbackRate === defaultConfig.playback?.playbackRate) {
      const savedRate = getStorage<number>("playbackRate", Number.NaN);
      if (!Number.isNaN(savedRate) && savedRate > 0) {
        this.setPlaybackRate(savedRate);
      }
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
   * SSR 水合：将服务端渲染的 DOM 与播放器实例关联，复用已有 DOM
   *
   * @param container - 服务端渲染的容器元素
   */
  hydrate(container: HTMLElement): void {
    this.containerEl = container;
    this.el = container;

    /** 查找或创建 video 元素 */
    const existingVideo = container.querySelector("video");
    if (existingVideo instanceof HTMLVideoElement) {
      this.videoEl = existingVideo;
    } else {
      this.videoEl = document.createElement("video");
      const videoWrap = container.querySelector(".nova-player-video-wrap");
      if (videoWrap) {
        videoWrap.appendChild(this.videoEl);
      }
    }

    /** 注册到 WeakMap */
    playerInstanceMap.set(container, this);

    this.setupStreamMiddleware();
    this.setupQualityPipeline();
    this.bindVideoEvents();
    this.registerPlugins();
    this.detectCapability();

    /** 触发 ready 事件（经总线桥接转发到 emitter） */
    this.events.emit(PlayerEventEnum.READY);
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
        // 样式项直接下发给字幕插件（有对应能力才调用，未接入的项忽略）
        // getPluginAPI 的泛型受 Plugin 约束，这里取回实例后按所需能力做结构化断言
        const api = this.getPluginAPI("subtitle") as
          | {
              setFontSize?: (size: number) => void;
              setColor?: (color: string) => void;
              setPosition?: (
                position?: "top" | "bottom",
                offset?: number,
              ) => void;
              setStroke?: (color?: string, width?: number) => void;
              setStyle?: (style: Record<string, unknown>) => void;
            }
          | undefined;
        if (!api) return;
        if (patch.fontSize !== undefined) api.setFontSize?.(patch.fontSize);
        if (patch.color !== undefined && patch.strokeColor === undefined) {
          api.setColor?.(patch.color);
        }
        if (patch.position !== undefined || patch.offset !== undefined) {
          api.setPosition?.(patch.position, patch.offset);
        }
        if (
          patch.strokeColor !== undefined ||
          patch.strokeWidth !== undefined
        ) {
          api.setStroke?.(patch.strokeColor, patch.strokeWidth);
        }
        const rest: Record<string, unknown> = {};
        if (patch.opacity !== undefined) rest.opacity = patch.opacity;
        if (patch.scale !== undefined) rest.scale = patch.scale;
        if (patch.fade !== undefined) rest.fade = patch.fade;
        if (Object.keys(rest).length > 0) api.setStyle?.(rest);
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
        this.el = elements.container;

        if (this.containerEl) {
          playerInstanceMap.set(this.containerEl, this);
        }

        // 创建流媒体中间件并注册插件
        this.setupStreamMiddleware();

        // 接通清晰度链路
        this.setupQualityPipeline();

        // 绑定视频事件
        this.bindVideoEvents();

        // 触发 ready 事件（经总线桥接转发到 emitter）
        this.events.emit(PlayerEventEnum.READY);
        const currentState = this.state.get(PlayerStateKeyEnum.STATE);
        if (currentState !== undefined) {
          // 初始状态同步到总线（emitter 侧由 STATE_CHANGE 桥接转发）
          this.events.emit(PlayerEventEnum.STATE_CHANGE, currentState);
        }

        // 触发插件挂载事件
        this.events.emit("player:mounted", {
          container: this.containerEl,
          video: this.videoEl,
          sendingArea: elements.sendingArea,
        });
        this.events.emit(PlayerEventEnum.MOUNTED, {
          container: this.containerEl,
          video: this.videoEl,
          sendingArea: elements.sendingArea,
        });

        // 恢复音量均衡偏好：配置/持久化里的非零 loudness 在挂载后广播一次，
        // 音效插件（MOUNTED 回调内已完成音效链构建）据此激活压缩器，
        // 保证刷新/重建后面板设置与实际音频链路状态一致
        const initialLoudness = this.props.playback?.loudness ?? 0;
        if (initialLoudness !== 0) {
          this.events.emit(PlayerEventEnum.AUDIO_EFFECT_CHANGE, {
            effect: 'loudness',
            mode: initialLoudness,
          });
        }

        // 流媒体模式：通过中间件加载源
        // 清单对象（sources 为空数组）也必须在此处完成首帧加载，
        // 否则对象注入模式下首屏只会出现空壳 DOM。
        if (
          this.streamMiddleware &&
          this.streamMiddleware.getMode() !== PlayerMode.NATIVE &&
          this.props.src
        ) {
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
      this.events.emit(PlayerEventEnum.LOAD_START);
      this.callbacks.loadstart?.();
    });

    /** loadedmetadata：元数据加载完成，duration 可用 */
    this.addVideoListener("loadedmetadata", () => {
      const duration = this.videoEl?.duration || 0;
      this.store.setLoading(false);
      this.store.setDuration(duration);
      this.state.set(PlayerStateKeyEnum.IS_LOADING, false);
      this.state.set(PlayerStateKeyEnum.DURATION, duration);
      // 分辨率写入运行时状态（供「视频统计信息」面板等消费）；
      // 事件绑定归核心层独占后，此处为该键的唯一写入口
      this.state.set(PlayerStateKeyEnum.VIDEO_WIDTH, this.videoEl?.videoWidth ?? 0);
      this.state.set(PlayerStateKeyEnum.VIDEO_HEIGHT, this.videoEl?.videoHeight ?? 0);
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
      this.events.emit(PlayerEventEnum.ABORT);
      this.callbacks.abort?.();
    });

    /** emptied：媒体被清空 */
    this.addVideoListener("emptied", () => {
      this.store.setEnded(false);
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
      this.setState(PlayerState.PLAYING);
      this.events.emit(PlayerEventEnum.PLAYING);
      this.callbacks.playing?.();
    });

    this.addVideoListener("pause", () => {
      this.store.setPlaying(false);
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

      // 列表连播：非末尾或循环/随机模式时自动切下一集
      if (this.playlist.length > 1 && this.shouldAutoAdvance()) {
        void this.next();
      }
    });

    // ============================================
    // 三、进度与跳转
    // ============================================

    this.addVideoListener("timeupdate", () => {
      const currentTime = this.videoEl?.currentTime || 0;
      const duration = this.videoEl?.duration || 0;
      this.state.set(PlayerStateKeyEnum.CURRENT_TIME, currentTime);
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
      // 汇聚到 video 元素的 volumechange 事件，这里统一写入
      setStorage("volume", volume);
      setStorage("muted", muted);
      this.events.emit(PlayerEventEnum.VOLUME_CHANGE, { volume, muted });
      this.callbacks.volumechange?.(volume, muted);
    });

    this.addVideoListener("ratechange", () => {
      const rate = this.videoEl?.playbackRate ?? 1;
      this.state.set(PlayerStateKeyEnum.PLAYBACK_RATE, rate);
      // 倍速持久化（同样以 video 元素的 ratechange 为唯一写入口）
      setStorage("playbackRate", rate);
      this.events.emit(PlayerEventEnum.RATE_CHANGE, rate);
      this.callbacks?.ratechange?.(rate);
    });

    // ============================================
    // 五、缓冲等待
    // ============================================

    this.addVideoListener("waiting", () => {
      this.store.setWaiting(true);
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
   * 挂载播放器到容器
   *
   * @param container - 容器元素
   */
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
    if (!this.pluginManager) {
      logger.error("插件管理器未初始化");
      return this;
    }
    this.pluginManager.install(plugin);
    return this;
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
    this.pluginManager?.uninstall(name);
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
   * 应用矩阵见 docs/nova-player-api-design.md §3.2。
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

    // ── danmaku ──
    if (partial.danmaku !== undefined) {
      const dn = next.danmaku ?? {};
      const prevDn = prev.danmaku ?? {};
      if (dn.visible !== undefined && dn.visible !== prevDn.visible) {
        this.setDanmakuVisible(dn.visible);
      }
      if (dn.opacity !== undefined && dn.opacity !== prevDn.opacity) {
        this.setDanmakuOpacity(dn.opacity);
      }
      if (dn.speed !== undefined && dn.speed !== prevDn.speed) {
        this.setDanmakuSpeed(dn.speed);
      }
      // provider 优先：更换 provider 时通知插件换源（函数引用比较）
      if (dn.provider !== undefined && dn.provider !== prevDn.provider) {
        this.getDanmakuApi()?.load?.({ provider: dn.provider });
      }
      if (dn.url !== undefined && dn.url !== prevDn.url) {
        this.setDanmakuSource(dn.url);
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
   * @param loop - 是否循环
   */
  setLoop(loop: boolean): void {
    this.props.playback = { ...(this.props.playback ?? {}), loop };
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
   */
  toggleWideScreen(): void {
    const isWide = this.state.get(PlayerStateKeyEnum.IS_WIDE_SCREEN) ?? false;
    this.setDisplayMode(isWide ? "normal" : "wide");
  }

  /**
   * 切换画中画
   */
  async togglePip(): Promise<void> {
    if (!this.videoEl) return;
    const wasPip = pip.isActive();
    await pip.toggle(this.videoEl);
    const isNowPip = !wasPip;

    this.store.setPip(isNowPip);
    this.state.set(PlayerStateKeyEnum.IS_PIP, isNowPip);
    this.events.emit(PlayerEventEnum.PIP_CHANGE, { isPip: isNowPip });
  }

  /**
   * 进入画中画
   */
  async enterPip(): Promise<void> {
    if (!this.videoEl || pip.isActive()) return;
    await pip.request(this.videoEl);
    this.store.setPip(true);
    this.state.set(PlayerStateKeyEnum.IS_PIP, true);
    this.events.emit(PlayerEventEnum.PIP_CHANGE, { isPip: true });
  }

  /**
   * 退出画中画
   */
  async exitPip(): Promise<void> {
    if (!pip.isActive()) return;
    await pip.exit();
    this.store.setPip(false);
    this.state.set(PlayerStateKeyEnum.IS_PIP, false);
    this.events.emit(PlayerEventEnum.PIP_CHANGE, { isPip: false });
  }

  /**
   * 设置画面显示模式
   * @param mode - normal | web | wide | mini
   */
  setDisplayMode(mode: DisplayMode): void {
    this.state.set(PlayerStateKeyEnum.DISPLAY_MODE, mode);
    this.state.set(PlayerStateKeyEnum.IS_MIN_PLAYER, mode === "mini");
    this.state.set(PlayerStateKeyEnum.IS_WEB_FULLSCREEN, mode === "web");
    this.state.set(PlayerStateKeyEnum.IS_WIDE_SCREEN, mode === "wide");

    const container = this.getPlayerContainerEl();
    if (container) {
      container.setAttribute("data-screen", mode === "web" ? "web" : mode);
    }

    this.events.emit(PlayerEventEnum.WEB_FULLSCREEN_CHANGE, {
      isWebFullscreen: mode === "web",
    });
    this.events.emit(PlayerEventEnum.WIDE_SCREEN_CHANGE, {
      isWideScreen: mode === "wide",
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
   * @param mirror - 是否镜像
   */
  setMirror(mirror: boolean): void {
    this.props.playback = { ...(this.props.playback ?? {}), mirror };
    this.configStore.set(this.props);
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
  }

  /**
   * 设置关灯模式（容器加 data-lightoff 属性，CSS 据此加暗色蒙层）
   * @param on - 是否关灯
   */
  setLightoff(on: boolean): void {
    const container = this.getPlayerContainerEl();
    if (container) {
      if (on) container.setAttribute("data-lightoff", "on");
      else container.removeAttribute("data-lightoff");
    }
  }

  /**
   * 设置视频画面比例
   * @param ratio - "0:0" 自动 | "4:3" | "16:9"
   */
  setAspectRatio(ratio: string): void {
    this.state.set(PlayerStateKeyEnum.ASPECT_RATIO, ratio);
    if (this.videoEl) {
      if (ratio === "0:0") {
        this.videoEl.style.aspectRatio = "";
        this.videoEl.style.objectFit = "";
      } else {
        this.videoEl.style.aspectRatio = ratio.replace(":", "/");
        this.videoEl.style.objectFit = "contain";
      }
    }
  }

  /**
   * 设置编码偏好（持久化到 store，下次加载按此偏好选流）
   * @param type - 0 默认 / 1 HEVC / 2 AVC / 3 AV1
   */
  setCodecPrefer(type: number): void {
    this.store.setCodecPreferType(type);
  }

  /**
   * 设置音量均衡模式
   *
   * 0 = 关闭（移除压缩器），1 = 标准，2 = 高动态
   * 通过事件总线广播，由音效插件 AudioEffectPlugin 订阅并应用对应动态压缩配置。
   * 未注册音效插件时仅存储偏好，不报错。
   * @param mode - 0 关闭 / 1 标准 / 2 高动态
   */
  setLoudness(mode: number): void {
    this.props.playback = { ...(this.props.playback ?? {}), loudness: mode };
    this.configStore.set(this.props);
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
    if (this.pendingQuality?.timer) {
      clearTimeout(this.pendingQuality.timer);
    }
    this.pendingQuality = null;

    const pending: NonNullable<VideoPlayer["pendingQuality"]> = {
      from,
      to,
      label,
      startedAt: Date.now(),
      kind,
      timer: null,
    };
    pending.timer = setTimeout(() => {
      if (this.pendingQuality === pending) {
        this.failQualitySwitch("切换超时");
      }
    }, QUALITY_SWITCH_TIMEOUT_MS);

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
    if (pending.timer) clearTimeout(pending.timer);
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
    if (pending.timer) clearTimeout(pending.timer);
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

    // 2. 暂停、清错误态、进度归零
    this.pause();
    this.state.set(PlayerStateKeyEnum.ERROR_CODE, 0);
    this.state.set(PlayerStateKeyEnum.ERROR_MESSAGE, "");
    this.state.set(PlayerStateKeyEnum.CURRENT_TIME, 0);
    this.state.set(PlayerStateKeyEnum.DURATION, 0);
    this.store.setLoading(true);
    this.store.setEnded(false);

    // 3. 弹幕清空（并按新源重拉）
    this.clearDanmaku();
    const nextDanmakuUrl =
      this.playlist[this.currentIndex]?.danmakuUrl ?? this.props.danmaku?.url;
    if (nextDanmakuUrl) this.setDanmakuSource(nextDanmakuUrl);

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

  /** ended 时是否应自动连播下一集 */
  private shouldAutoAdvance(): boolean {
    const mode = this.props.playback?.playMode ?? PlayMode.ORDER;
    if (mode === PlayMode.ORDER) {
      return this.currentIndex < this.playlist.length - 1;
    }
    return true;
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
    this.props.danmaku = { ...(this.props.danmaku ?? {}), visible };
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
    this.props.danmaku = { ...(this.props.danmaku ?? {}), opacity: value };
    // 插件订阅 DANMAKU_OPACITY 状态键自动应用；此处仅向外部广播变化事件
    this.events.emit(PlayerEventEnum.DANMAKU_OPACITY_CHANGE, value);
  }

  /** 设置弹幕速度倍率 */
  setDanmakuSpeed(speed: number): void {
    const value = speed <= 0 ? 0.1 : speed;
    this.state.set(PlayerStateKeyEnum.DANMAKU_SPEED, value);
    this.props.danmaku = { ...(this.props.danmaku ?? {}), speed: value };
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
    this.props.danmaku = { ...(this.props.danmaku ?? {}), url };
    // 插件内部处理换源：provider 已配置时忽略 url 变化；
    // url 通道首次全量拉取完成后由插件广播 danmakuLoaded（§4.2）
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

    this.loadToken++;
    this.clearPendingLoad();
    this.pendingSeek = null;
    if (this.pendingQuality?.timer) {
      clearTimeout(this.pendingQuality.timer);
    }
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
