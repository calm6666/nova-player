import type { DisplayMode, PlayerState } from "@/types";
import type { QualityLevel } from "@/types/streamPlugin";
import type { SubtitleTrackInfo } from "@/types/subtitle";

/**
 * ============================================
 * 运行时状态管理器
 * ============================================
 * 管理播放器的运行时状态，包括高频更新的数据
 */

import { createTypedStateManager } from "@/core/state";
import type { TypedStateManager } from "@/core/state";
import { createContext } from "@/core/context";
import type { ControlsConfig } from "@/nova/types";

export type { TypedStateManager };

/**
 * 播放器状态枚举
 */
export enum PlayerStateEnum {
  IDLE = "IDLE",
  LOADING = "LOADING",
  PLAYING = "PLAYING",
  PAUSED = "PAUSED",
  ENDED = "ENDED",
  ERROR = "ERROR",
}

/**
 * 播放器状态键枚举
 * 用于状态管理器的路径定义
 */
export enum PlayerStateKeyEnum {
  // 播放状态
  STATE = "player.state",
  CURRENT_TIME = "player.currentTime",
  DURATION = "player.duration",
  BUFFERED = "player.buffered",

  // 音量状态
  VOLUME = "player.volume",
  MUTED = "player.muted",

  // 播放属性
  PLAYBACK_RATE = "player.playbackRate",
  QUALITY = "player.quality",
  /** 运行时可用清晰度列表（MP4 多变体同步就绪；HLS/DASH 在清单解析后异步就绪） */
  AVAILABLE_QUALITIES = "player.availableQualities",

  // 显示状态
  IS_FULLSCREEN = "player.isFullscreen",
  IS_PIP = "player.isPip",
  IS_WEB_FULLSCREEN = "player.isWebFullscreen",
  IS_WIDE_SCREEN = "player.isWideScreen",
  /** 画面显示模式：normal | web | wide | mini（原局部变量 dataScreen） */
  DISPLAY_MODE = "player.displayMode",
  /** 是否为迷你播放器（原局部变量） */
  IS_MIN_PLAYER = "player.isMinPlayer",

  // 清晰度（运行时模型）
  /** 当前生效档位 id（'auto' 或档位 id） */
  QUALITY_CURRENT = "player.qualityCurrent",
  /** 清晰度能力：none | static | adaptive */
  QUALITY_MODE = "player.qualityMode",
  /** 清晰度切换生命周期：idle | switching | switched | failed */
  QUALITY_SWITCH_STATE = "player.qualitySwitchState",

  // 播放列表
  /** 播放列表条目快照（右侧选集面板的数据源） */
  PLAYLIST = "player.playlist",
  /** 当前播放项索引 */
  PLAYLIST_INDEX = "player.playlistIndex",
  /** 播放列表长度 */
  PLAYLIST_LENGTH = "player.playlistLength",

  // 视频属性
  VIDEO_WIDTH = "video.width",
  VIDEO_HEIGHT = "video.height",
  ASPECT_RATIO = "video.aspectRatio",

  // 错误状态
  ERROR_CODE = "player.errorCode",
  ERROR_MESSAGE = "player.errorMessage",

  // 加载状态
  IS_LOADING = "player.isLoading",
  LOAD_PROGRESS = "player.loadProgress",

  // 控制栏状态
  CONTROLS_VISIBLE = "player.controlsVisible",
  CONTROLS_HOVER = "player.controlsHover",

  // 弹幕状态
  DANMAKU_VISIBLE = "player.danmakuVisible",
  DANMAKU_OPACITY = "player.danmakuOpacity",
  DANMAKU_SPEED = "player.danmakuSpeed",
  DANMAKU_DENSITY = "player.danmakuDensity",
  /** 弹幕显示区域（0-100，对应弹幕设置面板「显示区域」滑杆） */
  DANMAKU_AREA = "player.danmakuArea",
  /** 弹幕字号档位（0-100，对应弹幕设置面板「弹幕字号」滑杆） */
  DANMAKU_FONT_SIZE = "player.danmakuFontSize",
  /** 弹幕颜色（发送栏弹幕类型选择面板写入，如 '#FFFFFF'） */
  DANMAKU_COLOR = "player.danmakuColor",
  /** 弹幕模式（1 滚动 / 4 底部 / 5 顶部，发送栏弹幕类型选择面板写入） */
  DANMAKU_MODE = "player.danmakuMode",
  /** 弹幕随屏幕缩放（弹幕设置面板复选框） */
  DANMAKU_SCALE_WITH_SCREEN = "player.danmakuScaleWithScreen",

  // 高能进度条
  /** 高能进度条常驻（图钉 / 影子进度条共享同一状态源） */
  PBP_PERMANENT = "player.pbpPermanent",
  /**
   * 高能进度条是否渲染（设置面板「高能进度条」复选框）
   * 取消勾选 → PbpControls 整个不挂载（与常驻态解耦：常驻开关是右侧图钉图标）
   */
  PBP_RENDERED = "player.pbpRendered",

  // 字幕状态
  SUBTITLE_VISIBLE = "player.subtitleVisible",
  SUBTITLE_LANG = "player.subtitleLang",
  /** 运行时字幕轨道列表（文件轨/服务端轨/本地识别轨统一注册表，字幕面板数据源） */
  SUBTITLE_TRACKS = "player.subtitleTracks",
}

/**
 * 播放列表条目快照（运行时状态 player.playlist 的元素类型）
 *
 * 结构与 `components/EpisodesMenu.ts` 的 `EpisodeOption` 一致；
 * 这里就地定义而不从组件模块导入，避免 store ↔ components 循环依赖。
 */
export interface PlayerPlaylistItem {
  /** 唯一标识（对应 MediaItem.id） */
  id?: string | number;
  /** 显示标题（对应 MediaItem.title） */
  title?: string;
  /** 下标（必须与数组下标一致，即点击时回传给播放器的值） */
  index: number;
}

/**
 * 播放器状态路径到类型的映射
 * 用于 TypedStateManager 的类型安全访问
 * key 为 PlayerStateKeyEnum 的枚举值（路径式字符串），value 为对应的数据类型
 *
 * 使用 type 交叉而非 interface + 索引签名：
 * interface { [key: string]: unknown; 'player.volume': number; }
 * → TypeScript 将 'player.volume' 的类型也视为 unknown（索引签名覆盖）
 *
 * type 交叉 { 'player.volume': number; } & Record<string, unknown>
 * → TypeScript 保留具体属性的类型为 number，索引签名仅用于动态访问
 */
export type PlayerStateMap = {
  "player.state": PlayerState;
  "player.currentTime": number;
  "player.duration": number;
  "player.buffered": number;
  "player.volume": number;
  "player.muted": boolean;
  "player.playbackRate": number;
  "player.quality": string;
  /** 运行时可用清晰度列表（与 "player.quality" 的当前档位字符串区分） */
  "player.availableQualities": QualityLevel[];
  "player.isFullscreen": boolean;
  "player.isPip": boolean;
  "player.isWebFullscreen": boolean;
  "player.isWideScreen": boolean;
  /** 画面显示模式 */
  "player.displayMode": DisplayMode;
  /** 是否为迷你播放器 */
  "player.isMinPlayer": boolean;
  /** 当前生效档位 id（'auto' 或档位 id） */
  "player.qualityCurrent": string;
  /** 清晰度能力：none | static | adaptive */
  "player.qualityMode": "none" | "static" | "adaptive";
  /** 清晰度切换生命周期 */
  "player.qualitySwitchState": "idle" | "switching" | "switched" | "failed";
  /** 播放列表条目快照（右侧选集面板数据源） */
  "player.playlist": PlayerPlaylistItem[];
  /** 当前播放项索引 */
  "player.playlistIndex": number;
  /** 播放列表长度 */
  "player.playlistLength": number;
  "video.width": number;
  "video.height": number;
  "video.aspectRatio": string;
  "player.errorCode": number;
  "player.errorMessage": string;
  "player.isLoading": boolean;
  "player.loadProgress": number;
  "player.controlsVisible": boolean;
  "player.controlsHover": boolean;
  "player.danmakuVisible": boolean;
  "player.danmakuOpacity": number;
  "player.danmakuSpeed": number;
  "player.danmakuDensity": number;
  /** 弹幕显示区域（0-100） */
  "player.danmakuArea": number;
  /** 弹幕字号档位（0-100） */
  "player.danmakuFontSize": number;
  /** 弹幕颜色 */
  "player.danmakuColor": string;
  /** 弹幕模式（1 滚动 / 4 底部 / 5 顶部） */
  "player.danmakuMode": number;
  /** 弹幕随屏幕缩放 */
  "player.danmakuScaleWithScreen": boolean;
  /** 高能进度条常驻 */
  "player.pbpPermanent": boolean;
  /** 高能进度条是否渲染（false 时 PbpControls 整个不挂载） */
  "player.pbpRendered": boolean;
  "player.subtitleVisible": boolean;
  "player.subtitleLang": string;
  /** 运行时字幕轨道列表（空数组时字幕面板回退到配置语言列表） */
  "player.subtitleTracks": SubtitleTrackInfo[];
  browser: object;
} & Record<string, object>;

/**
 * 运行时状态接口
 */
export interface RuntimeState {
  // 播放状态
  state: PlayerStateEnum;
  currentTime: number;
  duration: number;
  buffered: TimeRanges | null;

  // 音量状态
  volume: number;
  muted: boolean;

  // 播放属性
  playbackRate: number;
  quality: number;
  /** 运行时可用清晰度列表 */
  availableQualities: QualityLevel[];

  // 显示状态
  isFullscreen: boolean;
  isPip: boolean;
  isWebFullscreen: boolean;
  isWideScreen: boolean;
  /** 画面显示模式：normal | web | wide | mini */
  displayMode: DisplayMode;
  /** 是否为迷你播放器 */
  isMinPlayer: boolean;

  // 清晰度（运行时模型）
  /** 当前生效档位 id（'auto' 或档位 id） */
  qualityCurrent: string;
  /** 清晰度能力：none | static | adaptive */
  qualityMode: "none" | "static" | "adaptive";
  /** 清晰度切换生命周期 */
  qualitySwitchState: "idle" | "switching" | "switched" | "failed";

  // 播放列表
  /** 播放列表条目快照（右侧选集面板数据源） */
  playlist: PlayerPlaylistItem[];
  /** 当前播放项索引 */
  playlistIndex: number;
  /** 播放列表长度 */
  playlistLength: number;

  // 视频属性
  videoWidth: number;
  videoHeight: number;

  // 错误状态
  errorCode: number;
  errorMessage: string;

  // 加载状态
  isLoading: boolean;
  loadProgress: number;

  // 控制栏状态
  controlsVisible: boolean;
  controlsHover: boolean;

  // 弹幕状态
  danmakuVisible: boolean;
  danmakuOpacity: number;
  danmakuSpeed: number;
  danmakuDensity: number;
  /** 弹幕显示区域（0-100） */
  danmakuArea: number;
  /** 弹幕字号档位（0-100） */
  danmakuFontSize: number;
  /** 弹幕颜色 */
  danmakuColor: string;
  /** 弹幕模式（1 滚动 / 4 底部 / 5 顶部） */
  danmakuMode: number;
  /** 弹幕随屏幕缩放 */
  danmakuScaleWithScreen: boolean;

  // 高能进度条
  /** 高能进度条常驻 */
  pbpPermanent: boolean;
  /** 高能进度条是否渲染（false 时 PbpControls 整个不挂载） */
  pbpRendered: boolean;

  // 字幕状态
  subtitleVisible: boolean;
  subtitleLang: string;
  /** 运行时字幕轨道列表 */
  subtitleTracks: SubtitleTrackInfo[];
}

/**
 * 默认运行时状态
 */
export const defaultRuntimeState: RuntimeState = {
  state: PlayerStateEnum.IDLE,
  currentTime: 0,
  duration: 0,
  buffered: null,
  volume: 1,
  muted: false,
  playbackRate: 1,
  quality: 0,
  availableQualities: [],
  isFullscreen: false,
  isPip: false,
  isWebFullscreen: false,
  isWideScreen: false,
  displayMode: "normal",
  isMinPlayer: false,
  qualityCurrent: "auto",
  qualityMode: "none",
  qualitySwitchState: "idle",
  playlist: [],
  playlistIndex: 0,
  playlistLength: 0,
  videoWidth: 0,
  videoHeight: 0,
  errorCode: 0,
  errorMessage: "",
  isLoading: false,
  loadProgress: 0,
  controlsVisible: true,
  controlsHover: false,
  danmakuVisible: true,
  danmakuOpacity: 1,
  danmakuSpeed: 1,
  danmakuDensity: 0.5,
  danmakuArea: 75,
  danmakuFontSize: 50,
  danmakuColor: "#FFFFFF",
  danmakuMode: 1,
  danmakuScaleWithScreen: true,
  pbpPermanent: false,
  pbpRendered: true,
  subtitleVisible: true,
  subtitleLang: "zh-CN",
  subtitleTracks: [],
};

/**
 * 创建运行时状态管理器
 * @param initialState - 初始状态
 * @returns 类型安全的运行时状态管理器
 */
export function createRuntimeStateManager(
  initialState: Partial<RuntimeState> = {},
): TypedStateManager<PlayerStateMap> {
  const state: Record<string, unknown> = {
    // 播放状态
    [PlayerStateKeyEnum.STATE]: initialState.state ?? defaultRuntimeState.state,
    [PlayerStateKeyEnum.CURRENT_TIME]:
      initialState.currentTime ?? defaultRuntimeState.currentTime,
    [PlayerStateKeyEnum.DURATION]:
      initialState.duration ?? defaultRuntimeState.duration,
    [PlayerStateKeyEnum.BUFFERED]:
      initialState.buffered ?? defaultRuntimeState.buffered,

    // 音量状态
    [PlayerStateKeyEnum.VOLUME]:
      initialState.volume ?? defaultRuntimeState.volume,
    [PlayerStateKeyEnum.MUTED]: initialState.muted ?? defaultRuntimeState.muted,

    // 播放属性
    [PlayerStateKeyEnum.PLAYBACK_RATE]:
      initialState.playbackRate ?? defaultRuntimeState.playbackRate,
    [PlayerStateKeyEnum.QUALITY]:
      initialState.quality ?? defaultRuntimeState.quality,
    [PlayerStateKeyEnum.AVAILABLE_QUALITIES]:
      initialState.availableQualities ?? defaultRuntimeState.availableQualities,

    // 显示状态
    [PlayerStateKeyEnum.IS_FULLSCREEN]:
      initialState.isFullscreen ?? defaultRuntimeState.isFullscreen,
    [PlayerStateKeyEnum.IS_PIP]:
      initialState.isPip ?? defaultRuntimeState.isPip,
    [PlayerStateKeyEnum.IS_WEB_FULLSCREEN]:
      initialState.isWebFullscreen ?? defaultRuntimeState.isWebFullscreen,
    [PlayerStateKeyEnum.IS_WIDE_SCREEN]:
      initialState.isWideScreen ?? defaultRuntimeState.isWideScreen,
    [PlayerStateKeyEnum.DISPLAY_MODE]:
      initialState.displayMode ?? defaultRuntimeState.displayMode,
    [PlayerStateKeyEnum.IS_MIN_PLAYER]:
      initialState.isMinPlayer ?? defaultRuntimeState.isMinPlayer,

    // 清晰度（运行时模型）
    [PlayerStateKeyEnum.QUALITY_CURRENT]:
      initialState.qualityCurrent ?? defaultRuntimeState.qualityCurrent,
    [PlayerStateKeyEnum.QUALITY_MODE]:
      initialState.qualityMode ?? defaultRuntimeState.qualityMode,
    [PlayerStateKeyEnum.QUALITY_SWITCH_STATE]:
      initialState.qualitySwitchState ?? defaultRuntimeState.qualitySwitchState,

    // 播放列表
    [PlayerStateKeyEnum.PLAYLIST]:
      initialState.playlist ?? defaultRuntimeState.playlist,
    [PlayerStateKeyEnum.PLAYLIST_INDEX]:
      initialState.playlistIndex ?? defaultRuntimeState.playlistIndex,
    [PlayerStateKeyEnum.PLAYLIST_LENGTH]:
      initialState.playlistLength ?? defaultRuntimeState.playlistLength,

    // 视频属性
    [PlayerStateKeyEnum.VIDEO_WIDTH]:
      initialState.videoWidth ?? defaultRuntimeState.videoWidth,
    [PlayerStateKeyEnum.VIDEO_HEIGHT]:
      initialState.videoHeight ?? defaultRuntimeState.videoHeight,

    // 错误状态
    [PlayerStateKeyEnum.ERROR_CODE]:
      initialState.errorCode ?? defaultRuntimeState.errorCode,
    [PlayerStateKeyEnum.ERROR_MESSAGE]:
      initialState.errorMessage ?? defaultRuntimeState.errorMessage,

    // 加载状态
    [PlayerStateKeyEnum.IS_LOADING]:
      initialState.isLoading ?? defaultRuntimeState.isLoading,
    [PlayerStateKeyEnum.LOAD_PROGRESS]:
      initialState.loadProgress ?? defaultRuntimeState.loadProgress,

    // 控制栏状态
    [PlayerStateKeyEnum.CONTROLS_VISIBLE]:
      initialState.controlsVisible ?? defaultRuntimeState.controlsVisible,
    [PlayerStateKeyEnum.CONTROLS_HOVER]:
      initialState.controlsHover ?? defaultRuntimeState.controlsHover,

    // 弹幕状态
    [PlayerStateKeyEnum.DANMAKU_VISIBLE]:
      initialState.danmakuVisible ?? defaultRuntimeState.danmakuVisible,
    [PlayerStateKeyEnum.DANMAKU_OPACITY]:
      initialState.danmakuOpacity ?? defaultRuntimeState.danmakuOpacity,
    [PlayerStateKeyEnum.DANMAKU_SPEED]:
      initialState.danmakuSpeed ?? defaultRuntimeState.danmakuSpeed,
    [PlayerStateKeyEnum.DANMAKU_DENSITY]:
      initialState.danmakuDensity ?? defaultRuntimeState.danmakuDensity,
    [PlayerStateKeyEnum.DANMAKU_AREA]:
      initialState.danmakuArea ?? defaultRuntimeState.danmakuArea,
    [PlayerStateKeyEnum.DANMAKU_FONT_SIZE]:
      initialState.danmakuFontSize ?? defaultRuntimeState.danmakuFontSize,
    [PlayerStateKeyEnum.DANMAKU_COLOR]:
      initialState.danmakuColor ?? defaultRuntimeState.danmakuColor,
    [PlayerStateKeyEnum.DANMAKU_MODE]:
      initialState.danmakuMode ?? defaultRuntimeState.danmakuMode,
    [PlayerStateKeyEnum.DANMAKU_SCALE_WITH_SCREEN]:
      initialState.danmakuScaleWithScreen ??
      defaultRuntimeState.danmakuScaleWithScreen,

    // 高能进度条
    [PlayerStateKeyEnum.PBP_PERMANENT]:
      initialState.pbpPermanent ?? defaultRuntimeState.pbpPermanent,

    // 字幕状态
    [PlayerStateKeyEnum.SUBTITLE_VISIBLE]:
      initialState.subtitleVisible ?? defaultRuntimeState.subtitleVisible,
    [PlayerStateKeyEnum.SUBTITLE_LANG]:
      initialState.subtitleLang ?? defaultRuntimeState.subtitleLang,
    [PlayerStateKeyEnum.SUBTITLE_TRACKS]:
      initialState.subtitleTracks ?? defaultRuntimeState.subtitleTracks,
  };

  return createTypedStateManager<PlayerStateMap>(state);
}

/**
 * 运行时状态管理器实例类型
 */
export type RuntimeStateManager = TypedStateManager<PlayerStateMap>;

/**
 * 播放器状态 Context
 * 组件通过 useContext(StateContext) 获取状态管理器实例
 * 无需 props 传递，避免层级穿透
 *
 * @example
 * // 在父组件中提供值（PlayerDocker）
 * h('div', {
 *   __providers: [{ contextId: StateContext.id, value: state }]
 * }, children)
 *
 * // 在子组件中使用（LeftControls / RightControls / VolumeSlider）
 * const state = useContext(StateContext);
 * if (state) {
 *   useState(state, PlayerStateKeyEnum.VOLUME, (newVol) => { ... }, lifecycle);
 * }
 */
export const StateContext =
  createContext<TypedStateManager<PlayerStateMap> | null>(null);

// 控件开关默认值的唯一来源在 config/defaultConfig.ts，
// 这里只做转发，避免与配置文件各写一份导致默认值漂移。
import { defaultControlConfig } from "@/nova/config/defaultConfig";

export { defaultControlConfig };

export const ConfigContext = createContext<ControlsConfig>(defaultControlConfig);
