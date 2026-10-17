/**
 * ============================================
 * 播放器事件和方法枚举定义
 * ============================================
 * 用于事件总线通信和暴露外部方法，防止名称拼写错误
 * 参考 dash.js 和 hls.js 的枚举命名风格：大写驼峰 + 下划线分隔
 */

import type { TypedEventBus } from './eventBus';
import type { QualityLevel } from '@/types/streamPlugin';
import type { DisplayMode } from '@/types';
import type {
  SubtitleAiStatusPayload,
  SubtitleItem,
  SubtitleTrackInfo,
} from '@/types/subtitle';

/**
 * 播放器事件数据类型映射
 * 将 PlayerEventEnum 的每个事件名映射到其 payload 类型
 * 用于 TypedEventBus 的类型安全
 *
 * 使用 type 交叉而非 interface + 索引签名：
 * interface { [key: string]: unknown; play: undefined; }
 * → TypeScript 将 'play' 的类型也视为 unknown（索引签名覆盖）
 *
 * type 交叉 { play: undefined; } & Record<string, unknown>
 * → TypeScript 保留具体属性的类型，索引签名仅用于动态访问
 */
export type PlayerEventMap = {
  // 播放状态相关事件
  stateChange: string;
  play: undefined;
  pause: undefined;
  ended: undefined;
  timeUpdate: { time: number };
  progress: undefined;
  waiting: undefined;
  canPlay: undefined;
  canPlayThrough: undefined;

  // HTML5 媒体元素标准事件（与 <video> 事件一一对应）
  loadStart: undefined;
  loadedMetadata: { duration: number };
  loadedData: undefined;
  emptied: undefined;
  abort: undefined;
  stalled: undefined;
  suspend: undefined;
  playing: undefined;
  seeking: { currentTime: number };
  seeked: { currentTime: number };

  // 视频属性相关事件
  volumeChange: { volume: number; muted: boolean };
  mutedChange: boolean;
  rateChange: number;
  /**
   * 清晰度切换完成（等价于 qualityChangeRendered，保留此名以兼容既有调用方）
   *
   * 注意：该载荷此前是 `{...} | string` 的联合类型，导致消费方必须做类型判断。
   * 现统一为确定的对象形态。
   */
  qualityChange: {
    /** 切换后的档位 id（'auto' 表示自动档） */
    quality: string;
    /** 档位展示名 */
    label?: string;
    /** 是否自动档 */
    isAuto?: boolean;
    /** 是否切换到备用源（原生 MP4 降级场景） */
    isBackup?: boolean;
  };
  /** 清晰度列表就绪/变化：payload 为运行时档位列表与清晰度能力类型 */
  qualityListChange: {
    qualities: QualityLevel[];
    mode: 'none' | 'static' | 'adaptive';
  };
  /** 清晰度切换请求已发出（切换中）：UI 应显示「正在切换」反馈 */
  qualityChangeRequested: {
    /** 切换前的档位 id */
    from: string;
    /** 目标档位 id */
    to: string;
    /** 目标档位展示名 */
    label?: string;
  };
  /** 清晰度切换成功（新档位已真正生效，可播放）：UI 应给出成功提示 */
  qualityChangeRendered: {
    from: string;
    to: string;
    /** 生效后的档位信息（自动档下由库回传实际档位） */
    quality?: QualityLevel;
    /** 从请求到生效的耗时（毫秒） */
    elapsed: number;
  };
  /** 清晰度切换失败（超时或库报错） */
  qualityChangeFailed: {
    from: string;
    to: string;
    /** 失败原因描述 */
    reason: string;
  };
  /** 清晰度模式变化（自动 / 手动） */
  qualityModeChange: { mode: 'auto' | 'manual' };
  resize: { width: number; height: number };
  durationChange: undefined;

  // 全屏/画中画相关事件
  fullscreenChange: { isFullscreen: boolean };
  pipChange: { isPip: boolean };
  webFullscreenChange: { isWebFullscreen: boolean };
  wideScreenChange: { isWideScreen: boolean };
  /** 音效设置变化（音量均衡等），payload: { effect, mode } */
  audioEffectChange: { effect: string; mode: number };

  // 显示模式相关事件
  /**
   * 显示模式变化（normal / web / wide / mini 切换）
   *
   * 阶段 D.1：与 webFullscreenChange / wideScreenChange 同时发出，
   * payload.mode 为切换后的目标模式。
   */
  displayModeChange: { mode: DisplayMode };

  // 持久化相关事件
  /** 已从持久化存储恢复上次观看位置，payload: { time }（秒） */
  restoreProgress: { time: number };

  // 错误相关事件
  /** code：MediaError 数字码（1-4）或语义字符串码（如 'load-timeout'） */
  error: { error: unknown; code?: number | string; message?: string };
  errorRecovery: undefined;

  // 控制栏相关事件
  seekStart: { time: number; previousTime: number };
  seekEnd: { time: number; previousTime: number };

  // 生命周期事件
  ready: undefined;
  mounted: { container?: HTMLElement; video?: HTMLVideoElement; sendingArea?: HTMLElement };
  /** 插件约定的挂载事件名（兼容旧插件） */
  'player:mounted': { container?: HTMLElement; video?: HTMLVideoElement; sendingArea?: HTMLElement };
  destroy: undefined;

  // 弹幕相关事件
  /** 弹幕显示状态切换，payload 为切换后的可见性 */
  danmakuToggle: { visible: boolean };
  /** 弹幕数据加载完成 */
  danmakuLoaded: { count: number; url?: string };
  danmakuOpacityChange: number;
  danmakuSpeedChange: number;
  danmakuSend: { text: string; options?: Record<string, unknown> };
  danmakuSent: Record<string, unknown>;
  danmakuClear: undefined;

  // 字幕相关事件
  /** 字幕显示状态切换，payload 为切换后的可见性 */
  subtitleToggle: { visible: boolean };
  subtitleLangChange: string;
  subtitleSwitch: { lang: string };
  /**
   * 字幕列表变化
   * - count：字幕条数（loading / error 时为 0）
   * - status：AI 字幕加载状态（兼容老监听器，未提供则表示普通列表更新）
   *   - 'loading'：AI 字幕请求中
   *   - 'ready'：AI 字幕已就绪（count 为实际条数）
   *   - 'error'：AI 字幕加载失败
   */
  subtitleListChange: { count: number; status?: 'loading' | 'ready' | 'error' };
  /**
   * 本地 AI 引擎状态（模型下载/初始化/就绪/失败，UI 进度条与状态点用）
   */
  subtitleAiStatus: SubtitleAiStatusPayload;
  /** 本地识别部分结果（灰显中的临时文本），null 表示清除 */
  subtitlePartial: SubtitleItem | null;
  /** 本地识别 final 结果（新字幕落定） */
  subtitleCue: SubtitleItem;
  /** 可用字幕轨道集合变化（服务端轨列表返回 / 本地轨就绪） */
  subtitleTracksChange: { tracks: SubtitleTrackInfo[] };

  // 播放列表 / 多 P 相关事件
  /** 当前播放的条目发生变化（换源成功） */
  episodeChange: { index: number; total: number; id?: string; title?: string };
  /** 播放列表本身变化（setConfig 更换列表时） */
  playlistChange: { index: number; total: number };
  /** 请求切换上一个 / 下一个分 P（由 UI 触发的意图事件） */
  prevRequest: undefined;
  nextRequest: undefined;

  // 互动相关事件
  interactionLike: undefined;
  interactionCoin: undefined;
  interactionCollect: undefined;
  interactionFollow: undefined;
  interactionLinkClick: undefined;
  interactionVoteSelect: { voteIndex: number; optionIndex: number };
  interactionScoreSelect: { scoreIndex: number; value: number };
  interactionCardClose: { type: string; index: number };
  interactionPositionChange: { type: string; index: number; top: number; left: number };

  // 流媒体相关事件
  streamError: { message?: string; error?: unknown; [key: string]: unknown };
  streamQualityChange: {
    width: number;
    height: number;
    bitrate?: number;
    isAuto?: boolean;
    /** 档位 id（'auto' 或 provider 定义的档位标识） */
    qualityId?: string;
    /** 档位展示名 */
    label?: string;
  };
} & Record<string, unknown>;

/** 播放器类型安全事件总线类型 */
export type PlayerEventBus = TypedEventBus<PlayerEventMap>;

/**
 * 播放器事件枚举
 * 用于事件总线通信，防止事件名称拼写错误
 */
export enum PlayerEventEnum {
  // 播放状态相关事件
  /** 播放状态改变 */
  STATE_CHANGE = 'stateChange',
  /** 开始播放 */
  PLAY = 'play',
  /** 暂停播放 */
  PAUSE = 'pause',
  /** 播放结束 */
  ENDED = 'ended',
  /** 播放时间更新 */
  TIME_UPDATE = 'timeUpdate',
  /** 播放进度 */
  PROGRESS = 'progress',
  /** 等待缓冲 */
  WAITING = 'waiting',
  /** 缓冲完成可以继续播放 */
  CAN_PLAY = 'canPlay',
  /** 可播放至结尾 */
  CAN_PLAY_THROUGH = 'canPlayThrough',

  // HTML5 媒体元素标准事件（与 <video> 事件一一对应）
  /** 开始加载媒体 */
  LOAD_START = 'loadStart',
  /** 媒体元数据加载完成（duration 可用） */
  LOADED_METADATA = 'loadedMetadata',
  /** 首帧数据加载完成（readyState 达到 HAVE_CURRENT_DATA） */
  LOADED_DATA = 'loadedData',
  /** 媒体被清空（重新加载前触发） */
  EMPTIED = 'emptied',
  /** 加载被中止（用户主动中断 / 切换源） */
  ABORT = 'abort',
  /** 数据停滞（网络/磁盘长时间无数据） */
  STALLED = 'stalled',
  /** 浏览器主动暂停加载（非错误，通常是已缓冲足够） */
  SUSPEND = 'suspend',
  /** 实际开始播放（缓冲结束后，与 play 区分） */
  PLAYING = 'playing',
  /** 跳转开始 */
  SEEKING = 'seeking',
  /** 跳转完成 */
  SEEKED = 'seeked',

  // 视频属性相关事件
  /** 音量改变 */
  VOLUME_CHANGE = 'volumeChange',
  /** 静音状态改变 */
  MUTED_CHANGE = 'mutedChange',
  /** 播放速度改变 */
  RATE_CHANGE = 'rateChange',
  /** 画质改变（切换完成，兼容名） */
  QUALITY_CHANGE = 'qualityChange',
  /** 清晰度列表就绪/变化，payload: { qualities, mode } */
  QUALITY_LIST_CHANGE = 'qualityListChange',
  /** 清晰度切换请求已发出（切换中），payload: { from, to, label } */
  QUALITY_CHANGE_REQUESTED = 'qualityChangeRequested',
  /** 清晰度切换成功，payload: { from, to, quality, elapsed } */
  QUALITY_CHANGE_RENDERED = 'qualityChangeRendered',
  /** 清晰度切换失败，payload: { from, to, reason } */
  QUALITY_CHANGE_FAILED = 'qualityChangeFailed',
  /** 清晰度模式变化（自动 / 手动），payload: { mode } */
  QUALITY_MODE_CHANGE = 'qualityModeChange',
  /** 视频尺寸改变 */
  RESIZE = 'resize',
  /** 时长改变 */
  DURATION_CHANGE = 'durationChange',

  // 全屏/画中画相关事件
  /** 全屏状态改变 */
  FULLSCREEN_CHANGE = 'fullscreenChange',
  /** 画中画状态改变 */
  PIP_CHANGE = 'pipChange',
  /** 网页全屏状态改变 */
  WEB_FULLSCREEN_CHANGE = 'webFullscreenChange',
  /** 宽屏模式改变 */
  WIDE_SCREEN_CHANGE = 'wideScreenChange',
  /** 音效设置变化（音量均衡等），payload: { effect, mode } */
  AUDIO_EFFECT_CHANGE = 'audioEffectChange',
  /** 显示模式改变（normal / web / wide / mini 切换），payload: { mode } */
  DISPLAY_MODE_CHANGE = 'displayModeChange',

  // 持久化相关事件
  /** 已从持久化存储恢复上次观看位置，payload: { time }（秒） */
  RESTORE_PROGRESS = 'restoreProgress',

  // 错误相关事件
  /** 播放错误 */
  ERROR = 'error',
  /** 错误恢复 */
  ERROR_RECOVERY = 'errorRecovery',

  // 控制栏相关事件
  /** 进度条拖动开始 */
  SEEK_START = 'seekStart',
  /** 进度条拖动结束 */
  SEEK_END = 'seekEnd',

  // 生命周期事件
  /** 播放器初始化完成 */
  READY = 'ready',
  /** 播放器挂载完成 */
  MOUNTED = 'mounted',
  /** 播放器销毁 */
  DESTROY = 'destroy',

  // 弹幕相关事件
  /** 弹幕显示状态改变，payload: { visible } */
  DANMAKU_TOGGLE = 'danmakuToggle',
  /** 弹幕数据加载完成，payload: { count, url? } */
  DANMAKU_LOADED = 'danmakuLoaded',
  /** 弹幕透明度改变 */
  DANMAKU_OPACITY_CHANGE = 'danmakuOpacityChange',
  /** 弹幕速度改变 */
  DANMAKU_SPEED_CHANGE = 'danmakuSpeedChange',
  /** 发送弹幕 */
  DANMAKU_SEND = 'danmakuSend',
  /** 弹幕发送成功 */
  DANMAKU_SENT = 'danmakuSent',
  /** 清空弹幕 */
  DANMAKU_CLEAR = 'danmakuClear',

  // 字幕相关事件
  /** 字幕显示状态改变，payload: { visible } */
  SUBTITLE_TOGGLE = 'subtitleToggle',
  /** 字幕语言改变 */
  SUBTITLE_LANG_CHANGE = 'subtitleLangChange',
  /** 字幕切换 */
  SUBTITLE_SWITCH = 'subtitleSwitch',
  /** 字幕列表变化，payload: { count } */
  SUBTITLE_LIST_CHANGE = 'subtitleListChange',
  /** 本地 AI 引擎状态，payload: { phase, progress?, message? } */
  SUBTITLE_AI_STATUS = 'subtitleAiStatus',
  /** 本地识别部分结果（灰显临时文本），payload: SubtitleItem | null */
  SUBTITLE_PARTIAL = 'subtitlePartial',
  /** 本地识别 final 结果，payload: SubtitleItem */
  SUBTITLE_CUE = 'subtitleCue',
  /** 可用轨道集合变化，payload: { tracks } */
  SUBTITLE_TRACKS_CHANGE = 'subtitleTracksChange',

  // 播放列表 / 多 P 相关事件
  /** 当前播放条目发生变化 */
  EPISODE_CHANGE = 'episodeChange',
  /** 播放列表变化 */
  PLAYLIST_CHANGE = 'playlistChange',
  /** 请求切换上一个分 P */
  PREV_REQUEST = 'prevRequest',
  /** 请求切换下一个分 P */
  NEXT_REQUEST = 'nextRequest',

  // 互动相关事件
  /** 互动点赞 */
  INTERACTION_LIKE = 'interactionLike',
  /** 互动投币 */
  INTERACTION_COIN = 'interactionCoin',
  /** 互动收藏 */
  INTERACTION_COLLECT = 'interactionCollect',
  /** 互动关注 */
  INTERACTION_FOLLOW = 'interactionFollow',
  /** 外链点击 */
  INTERACTION_LINK_CLICK = 'interactionLinkClick',
  /** 投票选择 */
  INTERACTION_VOTE_SELECT = 'interactionVoteSelect',
  /** 评分选择 */
  INTERACTION_SCORE_SELECT = 'interactionScoreSelect',
  /** 卡片关闭 */
  INTERACTION_CARD_CLOSE = 'interactionCardClose',
  /** 位置变化 */
  INTERACTION_POSITION_CHANGE = 'interactionPositionChange',

  // 流媒体相关事件
  /** 流媒体错误 */
  STREAM_ERROR = 'streamError',
  /** 流媒体清晰度变化（自动或手动切换），payload: { width, height, bitrate, isAuto } */
  STREAM_QUALITY_CHANGE = 'streamQualityChange',
}

/**
 * 播放器方法枚举
 * 用于暴露给外部调用的方法名称，防止方法名拼写错误
 */
export enum PlayerMethodEnum {
  // 播放控制方法
  /** 播放视频 */
  PLAY = 'play',
  /** 暂停视频 */
  PAUSE = 'pause',
  /** 跳转指定时间 */
  SEEK = 'seek',
  /** 重新加载 */
  RELOAD = 'reload',

  // 音量控制方法
  /** 设置音量 */
  SET_VOLUME = 'setVolume',
  /** 获取音量 */
  GET_VOLUME = 'getVolume',
  /** 设置静音 */
  SET_MUTED = 'setMuted',
  /** 切换静音 */
  TOGGLE_MUTED = 'toggleMuted',

  // 播放速度方法
  /** 设置播放速度 */
  SET_PLAYBACK_RATE = 'setPlaybackRate',
  /** 获取播放速度 */
  GET_PLAYBACK_RATE = 'getPlaybackRate',

  // 画质方法
  /** 设置画质 */
  SET_QUALITY = 'setQuality',
  /** 获取当前画质（档位 id，'auto' 表示自动档） */
  GET_CURRENT_QUALITY = 'getCurrentQuality',
  /** 获取可用画质列表 */
  GET_QUALITIES = 'getQualities',
  /** 设置清晰度模式（自动 / 手动） */
  SET_QUALITY_MODE = 'setQualityMode',
  /** 应用清晰度上下限 */
  APPLY_QUALITY_LIMITS = 'applyQualityLimits',

  // 全屏/画中画方法
  /** 进入全屏 */
  ENTER_FULLSCREEN = 'enterFullscreen',
  /** 退出全屏 */
  EXIT_FULLSCREEN = 'exitFullscreen',
  /** 切换全屏 */
  TOGGLE_FULLSCREEN = 'toggleFullscreen',
  /** 进入画中画 */
  ENTER_PIP = 'enterPip',
  /** 退出画中画 */
  EXIT_PIP = 'exitPip',
  /** 切换画中画 */
  TOGGLE_PIP = 'togglePip',
  /** 进入网页全屏 */
  ENTER_WEB_FULLSCREEN = 'enterWebFullscreen',
  /** 退出网页全屏 */
  EXIT_WEB_FULLSCREEN = 'exitWebFullscreen',
  /** 切换网页全屏 */
  TOGGLE_WEB_FULLSCREEN = 'toggleWebFullscreen',
  /** 切换宽屏 */
  TOGGLE_WIDE_SCREEN = 'toggleWideScreen',
  /** 设置显示模式（普通 / 网页全屏 / 宽屏） */
  SET_DISPLAY_MODE = 'setDisplayMode',

  // 配置方法
  /** 动态更新配置（深合并并立即生效） */
  SET_CONFIG = 'setConfig',
  /** 读取当前生效配置 */
  GET_CONFIG = 'getConfig',

  // 媒体加载与播放列表方法
  /** 换源加载（复用同一 video 元素与 DOM） */
  LOAD = 'load',
  /** 播放列表内跳转到指定索引 */
  SWITCH_TO = 'switchTo',
  /** 播放下一个 */
  NEXT = 'next',
  /** 播放上一个 */
  PREV = 'prev',
  /** 获取播放列表 */
  GET_PLAYLIST = 'getPlaylist',
  /** 获取当前条目索引 */
  GET_CURRENT_INDEX = 'getCurrentIndex',
  /** 设置封面 */
  SET_POSTER = 'setPoster',

  // 状态获取方法
  /** 获取播放器状态 */
  GET_STATE = 'getState',
  /** 获取当前时间 */
  GET_CURRENT_TIME = 'getCurrentTime',
  /** 获取总时长 */
  GET_DURATION = 'getDuration',
  /** 获取缓冲进度 */
  GET_BUFFERED = 'getBuffered',
  /** 是否暂停中 */
  IS_PAUSED = 'isPaused',
  /** 是否正在播放 */
  IS_PLAYING = 'isPlaying',
  /** 是否全屏 */
  IS_FULLSCREEN = 'isFullscreen',
  /** 是否静音 */
  IS_MUTED = 'isMuted',
  /** 相对当前位置跳转 */
  SEEK_BY = 'seekBy',

  // 弹幕方法
  /** 发送弹幕 */
  SEND_DANMAKU = 'sendDanmaku',
  /** 显示/隐藏弹幕（返回切换后的可见性） */
  TOGGLE_DANMAKU = 'toggleDanmaku',
  /** 设置弹幕可见性 */
  SET_DANMAKU_VISIBLE = 'setDanmakuVisible',
  /** 查询弹幕是否可见 */
  IS_DANMAKU_VISIBLE = 'isDanmakuVisible',
  /** 设置弹幕不透明度 */
  SET_DANMAKU_OPACITY = 'setDanmakuOpacity',
  /** 设置弹幕速度 */
  SET_DANMAKU_SPEED = 'setDanmakuSpeed',
  /** 设置弹幕数据源 */
  SET_DANMAKU_SOURCE = 'setDanmakuSource',
  /** 清除弹幕 */
  CLEAR_DANMAKU = 'clearDanmaku',

  // 字幕方法
  /** 切换字幕显示 */
  TOGGLE_SUBTITLE = 'toggleSubtitle',
  /** 设置字幕可见性 */
  SET_SUBTITLE_VISIBLE = 'setSubtitleVisible',
  /** 设置字幕语言 */
  SET_SUBTITLE_LANG = 'setSubtitleLang',
  /** 设置字幕列表 */
  SET_SUBTITLE_LIST = 'setSubtitleList',

  // 播放器控制方法
  /** 销毁播放器 */
  DESTROY = 'destroy',
  /** 调整大小 */
  RESIZE = 'resize',
}

/**
 * 组件内部事件枚举
 * 用于组件间通信的事件名称
 */
export enum ComponentEventEnum {
  // Controls组件事件
  /** 播放按钮点击 */
  PLAY_CLICK = 'playClick',
  /** 暂停按钮点击 */
  PAUSE_CLICK = 'pauseClick',
  /** 进度条改变 */
  PROGRESS_CHANGE = 'progressChange',
  /** 音量改变 */
  VOLUME_CHANGE = 'volumeChange',
  /** 全屏按钮点击 */
  FULLSCREEN_CLICK = 'fullscreenClick',
  /** 画中画按钮点击 */
  PIP_CLICK = 'pipClick',
  /** 设置按钮点击 */
  SETTINGS_CLICK = 'settingsClick',
  /** 画质按钮点击 */
  QUALITY_CLICK = 'qualityClick',
  /** 上一集按钮点击 */
  PREV_CLICK = 'prevClick',
  /** 下一集按钮点击 */
  NEXT_CLICK = 'nextClick',

  // Top组件事件
  /** 返回按钮点击 */
  BACK_CLICK = 'backClick',
  /** 更多按钮点击 */
  MORE_CLICK = 'moreClick',
  /** 标题点击 */
  TITLE_CLICK = 'titleClick',

  // Loading组件事件
  /** 重试按钮点击 */
  RETRY_CLICK = 'retryClick',

  // State组件事件
  /** 状态改变 */
  STATE_CHANGE = 'stateChange',

  // Toast组件事件
  /** Toast关闭 */
  TOAST_CLOSE = 'toastClose',
  /** Toast跳转 */
  TOAST_JUMP = 'toastJump',
}

/**
 * 插件事件枚举
 * 用于插件系统的事件通信
 */
export enum PluginEventEnum {
  // 插件生命周期事件
  /** 插件安装前 */
  BEFORE_INSTALL = 'beforeInstall',
  /** 插件安装后 */
  AFTER_INSTALL = 'afterInstall',
  /** 插件卸载前 */
  BEFORE_UNINSTALL = 'beforeUninstall',
  /** 插件卸载后 */
  AFTER_UNINSTALL = 'afterUninstall',
  /** 插件启用 */
  ENABLE = 'enable',
  /** 插件禁用 */
  DISABLE = 'disable',

  // 插件错误事件
  /** 插件错误 */
  ERROR = 'error',
  /** 插件警告 */
  WARNING = 'warning',
}

/**
 * 播放器配置枚举
 * 用于配置项的键名定义，防止拼写错误
 */
export enum PlayerConfigEnum {
  // 基础配置
  SRC = 'src',
  CONTAINER = 'container',
  AUTOPLAY = 'autoplay',
  MUTED = 'muted',
  VOLUME = 'volume',
  PLAYBACK_RATE = 'playbackRate',
  CONTROLS = 'controls',
  LOOP = 'loop',
  PRELOAD = 'preload',
  POSTER = 'poster',

  // 画质配置
  DEFAULT_QUALITY = 'defaultQuality',
  QUALITIES = 'qualities',

  // 播放模式配置
  PLAY_MODE = 'playMode',

  // 功能开关配置
  KEYBOARD = 'keyboard',
  PIP = 'pip',
  FULLSCREEN = 'fullscreen',

  // 主题配置
  THEME_COLOR = 'themeColor',

  // 弹幕配置
  DANMAKU_ENABLED = 'danmakuEnabled',
  DANMAKU_SOURCE = 'danmakuSource',
  DANMAKU_OPACITY = 'danmakuOpacity',
  DANMAKU_SPEED = 'danmakuSpeed',
  DANMAKU_VISIBLE = 'danmakuVisible',

  // 字幕配置
  SUBTITLES = 'subtitles',

  // SSR配置
  SSR_ENABLED = 'ssrEnabled',
  SSR_DEFER_HYDRATION = 'ssrDeferHydration',

  // 插件配置
  PLUGINS = 'plugins',
}
