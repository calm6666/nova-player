/**
 * ============================================
 * Store 状态默认值定义（纯数据结构）
 * ============================================
 * 核心 store 只包含播放器通用设置
 * 弹幕/字幕等插件设置由各插件自己管理持久化
 */

import type {
  PlayerPersistentState,
  PlayerRuntimeState,
  UserPreferences,
  DanmakuPreferences,
  SubtitlePreferences,
  PlayerSettingsFlags,
  DanmakuPersistedSettings,
} from './types';

// ============================================
// 默认用户偏好（仅通用设置）
// ============================================

/**
 * 默认用户偏好
 * 对照 store.txt: bpx_player_profile.media
 */
export const defaultUserPreferences: UserPreferences = {
  /** 默认不自动播放下一集 */
  autoplay: false,
  /** 默认自动根据网速选择画质 */
  autoQuality: true,
  /** 默认音量 80% */
  defaultVolume: 0.8,
  /** 默认 1 倍速 */
  defaultPlaybackRate: 1,
  /** 默认不跳过片头片尾 */
  skipOpEd: false,
};

/**
 * 默认设置面板开关项（镜像/循环/自动开播/播完暂停，默认全关）
 * 关灯模式与画中画不持久化（见 types.ts PlayerSettingsFlags 注释）
 */
export const defaultSettingsFlags: PlayerSettingsFlags = {
  mirror: false,
  loop: false,
  autostart: false,
  pauseAfterEnd: false,
};

/**
 * 默认弹幕设置（与弹幕设置面板的复位默认值一致）
 */
export const defaultDanmakuSettings: DanmakuPersistedSettings = {
  visible: true,
  opacity: 1,
  speed: 1,
  area: 75,
  fontSize: 50,
  scaleWithScreen: true,
  // 智能防挡默认关闭：开启才懒加载模型（用户未开启不下载）
  maskEnabled: false,
};

/**
 * 默认弹幕偏好（由弹幕插件管理持久化）
 * 对照 store.txt: bpx_player_profile.dmSetting
 */
export const defaultDanmakuPreferences: DanmakuPreferences = {
  enabled: true,
  opacity: 1,
  fontSize: 1,
  density: 'normal',
  blockTypes: [],
};

/**
 * 默认字幕偏好（由字幕插件管理持久化）
 * 对照 store.txt: bpx_player_profile.subtitle
 */
export const defaultSubtitlePreferences: SubtitlePreferences = {
  enabled: true,
  language: 'zh-CN',
  fontSize: 1,
  opacity: 1,
  backgroundOpacity: 0.5,
};

// ============================================
// 默认持久化状态
// ============================================

/**
 * 默认持久化状态
 * 对应 localStorage 的 nova_player_profile JSON
 *
 * 对照 store.txt:
 *   volume/isMuted → bpx_player_profile.media.volume
 *   playbackRate   → bpx_player_profile.media（B站没有单独存，但我们存了）
 *   codecPreferType → bilibili_player_codec_prefer_type
 *   isWideScreen   → bpx_player_profile.iswide
 *   gpuRenderer    → bilibili_player_gpu_renderer
 *   maxVideoQn     → bilibili_player_playback_info_v1.maxVideoQn
 *   maxAudioQn     → bilibili_player_playback_info_v1.maxAudioQn
 */
export const defaultPersistentState: PlayerPersistentState = {
  // 音量设置
  volume: 0.8,
  isMuted: false,

  // 播放设置
  playbackRate: 1,
  codecPreferType: 0,
  loudness: 0,

  // 设置面板开关（用户可打开/关闭的全部项，默认全关）
  settings: defaultSettingsFlags,
  // 画面比例（"0:0" 默认自适应）
  aspect: '0:0',

  // 弹幕设置（与弹幕面板默认值一致）
  danmakuSettings: defaultDanmakuSettings,

  // 字幕样式（空对象 = 全默认，面板 patch 增量合并）
  subtitleStyle: {},

  // 画面设置
  isWideScreen: false,

  // 系统信息（运行时检测后更新）
  gpuRenderer: '',
  maxVideoQn: 80,
  maxAudioQn: 30280,

  // 进度条偏好 (PBP = Player Bar Progress)
  pbpHeight: 'm',       // 默认中等高度
  pbpOpacity: 'm',      // 默认中等不透明度
  pbpPin: 0,            // 默认不固定
  pbpTheme: 'b',        // 默认主题 b
  pbpVersion: '3.6.2',  // 版本号
  pbpState: 0,          // 默认不渲染高能进度条（对照当前播放器运行时默认）
  pbpStateClear: 1,     // 默认清晰模式

  // 通用用户偏好
  userPreferences: defaultUserPreferences,
};

// ============================================
// 默认运行时状态
// ============================================

/**
 * 默认运行时状态（仅内存，不持久化）
 */
export const defaultRuntimeState: PlayerRuntimeState = {
  // 播放控制状态
  isPlaying: false,
  isPaused: true,
  isLoading: false,
  isEnded: false,
  isWaiting: false,

  // 媒体信息
  duration: 0,
  buffered: 0,

  // 画质/音质
  currentQuality: 80,
  currentAudioQuality: 30280,
  availableQualities: [],
  availablePlaybackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],

  // 显示模式
  screenMode: 'normal',
  isPip: false,
};

// ============================================
// 完整默认状态（持久化 + 运行时合并）
// ============================================

export const defaultState = {
  ...defaultPersistentState,
  ...defaultRuntimeState,
};
