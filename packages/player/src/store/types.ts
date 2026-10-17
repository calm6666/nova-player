/**
 * ============================================
 * Store 类型定义
 * ============================================
 *
 * 核心 store 只管理播放器通用设置，不包含插件专属配置
 * 弹幕/字幕等插件设置由各插件自己管理持久化
 */

import type { QualityLevel } from '@/types/streamPlugin';

/**
 * 画质选项
 * @deprecated 用运行时清晰度模型 `QualityLevel` 代替（字段更全，插件直接产出）
 */
export type QualityOption = QualityLevel;

/**
 * 用户偏好设置（仅包含播放器通用偏好，插件设置由插件自己管理）
 * 对照 store.txt: bpx_player_profile.media
 */
export interface UserPreferences {
  /** 自动播放下一集 */
  autoplay: boolean;
  /** 自动根据网速选择画质 */
  autoQuality: boolean;
  /** 默认音量 (0-1) */
  defaultVolume: number;
  /** 默认播放速度 */
  defaultPlaybackRate: number;
  /** 跳过片头片尾 */
  skipOpEd: boolean;
}

/**
 * 弹幕偏好（由弹幕插件管理持久化）
 * 对照 store.txt: bpx_player_profile.dmSetting
 */
export interface DanmakuPreferences {
  /** 弹幕开关 */
  enabled: boolean;
  /** 不透明度 (0-1) */
  opacity: number;
  /** 字体大小 */
  fontSize: number;
  /** 密度: low | normal | high */
  density: 'low' | 'normal' | 'high';
  /** 屏蔽类型列表 */
  blockTypes: string[];
}

/**
 * 字幕偏好（由字幕插件管理持久化）
 * 对照 store.txt: bpx_player_profile.subtitle
 */
export interface SubtitlePreferences {
  /** 字幕开关 */
  enabled: boolean;
  /** 语言 */
  language: string;
  /** 字体大小 */
  fontSize: number;
  /** 不透明度 (0-1) */
  opacity: number;
  /** 背景不透明度 (0-1) */
  backgroundOpacity: number;
}

/**
 * 弹幕设置持久化（弹幕设置面板全部可调项）
 * 写入点：VideoPlayer 订阅运行时 DANMAKU_* 状态键统一落库；
 * 恢复点：构造期「持久化优先」写回运行时状态（插件安装时读取）
 */
export interface DanmakuPersistedSettings {
  /** 弹幕开关 */
  visible: boolean;
  /** 不透明度 (0-1) */
  opacity: number;
  /** 速度倍率 */
  speed: number;
  /** 显示区域占比 (0-100) */
  area: number;
  /** 字号缩放 (12-100) */
  fontSize: number;
  /** 弹幕随屏幕缩放 */
  scaleWithScreen: boolean;
  /** 弹幕智能防挡开关（开启后插件懒加载防挡运行时：外部 provider 或本地语义分割） */
  maskEnabled: boolean;
}

/**
 * 设置面板可持久化开关项（用户可打开/关闭且跨会话保持的全部设置）
 * 对照 store.txt 各散落 key 的归一化整合
 *
 * 注意：关灯模式（lightoff）与画中画（pip）不持久化——
 * 前者是即时氛围功能（刷新后默认开灯，B站同款行为），
 * 后者是浏览器会话态（刷新后 PiP 窗口必然关闭），
 * 两者仅走运行时状态（见 PlayerStateKeyEnum.LIGHTOFF / IS_PIP）
 */
export interface PlayerSettingsFlags {
  /** 镜像画面 */
  mirror: boolean;
  /** 循环播放 */
  loop: boolean;
  /** 自动开播 */
  autostart: boolean;
  /** 播完暂停（不自动连播） */
  pauseAfterEnd: boolean;
}

/**
 * 播放器持久化状态
 * 对应 localStorage 中的 nova_player_profile JSON 对象
 *
 * 对照 store.txt:
 *   volume/isMuted/playbackRate ≈ bpx_player_profile.media
 *   codecPreferType             ≈ bilibili_player_codec_prefer_type（也独立存储）
 *   gpuRenderer                 ≈ bilibili_player_gpu_renderer
 *   isWideScreen                ≈ bpx_player_profile.iswide
 *   maxVideoQn/maxAudioQn       ≈ bilibili_player_playback_info_v1
 *   pbpHeight/pbpOpacity/...    ≈ pbp_height_v3 / pbp_opacity_v3 / pbp_pin_v3 / pbp_theme_v4
 *   pbpState/pbpStateClear      ≈ pbpstate / pbpstate_clear
 */
export interface PlayerPersistentState {
  // ========== 音量 ==========
  /** 当前音量 (0-1) */
  volume: number;
  /** 是否静音 */
  isMuted: boolean;

  // ========== 播放 ==========
  /** 播放速度 */
  playbackRate: number;
  /** 编解码器偏好类型：0=自动 1=AV1 2=HEVC 3=AVC */
  codecPreferType: number;
  /**
   * 音量均衡模式（0 关闭 / 1 标准 / 2 高动态）
   * 设置面板「音量均衡」驱动；刷新/重建后按此值恢复音效链状态
   */
  loudness: number;

  // ========== 设置面板开关（用户可打开/关闭的全部项） ==========
  /** 设置面板各开关项（镜像/循环/自动开播/关灯/播完暂停） */
  settings: PlayerSettingsFlags;
  /** 画面比例（"0:0" 默认自适应） */
  aspect: string;

  // ========== 弹幕设置 ==========
  /** 弹幕设置面板全部可调项 */
  danmakuSettings: DanmakuPersistedSettings;

  // ========== 字幕样式 ==========
  /** 字幕样式增量 patch（设置面板「字幕样式」驱动，语义化字段见 SubtitleStyleSettings） */
  subtitleStyle: SubtitleStyleSettings;

  // ========== 画面 ==========
  /** 是否宽屏模式 */
  isWideScreen: boolean;

  // ========== 系统信息 ==========
  /** GPU 渲染器信息 */
  gpuRenderer: string;
  /** 最高视频清晰度编号 */
  maxVideoQn: number;
  /** 最高音频质量编号 */
  maxAudioQn: number;

  // ========== 进度条偏好 (PBP = Player Bar Progress) ==========
  /** 进度条高度：s(小) / m(中) / l(大)，对照 pbp_height_v3 */
  pbpHeight: string;
  /** 进度条不透明度：s(低) / m(中) / l(高)，对照 pbp_opacity_v3 */
  pbpOpacity: string;
  /** 进度条固定状态：0=关闭 1=开启，对照 pbp_pin_v3 */
  pbpPin: number;
  /** 进度条主题色，对照 pbp_theme_v4 */
  pbpTheme: string;
  /** 进度条偏好版本号，对照 pbp_version */
  pbpVersion: string;
  /** 进度条状态开关：0=关闭 1=开启，对照 pbpstate */
  pbpState: number;
  /** 进度条清晰状态：0=关闭 1=开启，对照 pbpstate_clear */
  pbpStateClear: number;

  // ========== 用户偏好设置 ==========
  /** 通用用户偏好（不含弹幕/字幕等插件设置） */
  userPreferences: UserPreferences;
}

/**
 * 字幕样式持久化（语义化字段，非 CSS 字符串）
 *
 * 与 SubtitlePlugin.applyStyle 消费的 SubtitleStylePatch 字段一一对应：
 * 持久化存语义值（如 fontSize: 24、primaryColor: "#ffffff"），
 * 构造期原样合并进 props.subtitle.style 由插件直读——
 * 存储格式与渲染样式之间不做 CSS 转换，避免双重转换偏差与解析开销
 */
export interface SubtitleStyleSettings {
  /** 字号（px） */
  fontSize?: number;
  /** 字幕字体（CSS font-family 字面量，如 "Microsoft YaHei"） */
  fontName?: string;
  /** 字幕颜色（hex/rgb 字面量） */
  primaryColor?: string;
  /** 描边颜色 */
  outlineColor?: string;
  /** 描边宽度（px） */
  outlineWidth?: number;
  /** 加粗 */
  bold?: boolean;
  /** 距底部偏移（px，向上为正） */
  bottomOffset?: number;
}

/**
 * 播放器运行时状态（仅内存，不持久化）
 */
export interface PlayerRuntimeState {
  // ========== 播放控制状态 ==========
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 是否已暂停 */
  isPaused: boolean;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 是否已结束 */
  isEnded: boolean;
  /** 是否等待缓冲 */
  isWaiting: boolean;

  // ========== 媒体信息 ==========
  /** 视频总时长（秒） */
  duration: number;
  /** 已缓冲时长（秒） */
  buffered: number;

  // ========== 画质/音质 ==========
  /** 当前画质编号 */
  currentQuality: number;
  /** 当前音频质量编号 */
  currentAudioQuality: number;
  /** 可用画质列表 */
  availableQualities: QualityOption[];
  /** 可用播放速度列表 */
  availablePlaybackRates: number[];

  // ========== 显示模式 ==========
  /** 屏幕模式：normal | wide | web_fullscreen | fullscreen */
  screenMode: 'normal' | 'wide' | 'web_fullscreen' | 'fullscreen';
  /** 是否画中画 */
  isPip: boolean;
}

/**
 * 完整的播放器状态（持久化 + 运行时）
 */
export interface PlayerState extends PlayerPersistentState, PlayerRuntimeState {}

/**
 * Store 配置选项
 */
export interface StoreOptions {
  /** 是否启用 localStorage 持久化，默认 true */
  persist?: boolean;
  /** 自定义主 profile key，默认 nova_player_profile */
  persistKey?: string;
}

/**
 * 状态监听器类型
 */
export type StateListener<T = unknown> = (newVal: T, oldVal: T) => void;

/**
 * 状态变更事件
 */
export interface StateChange<T = unknown> {
  key: string;
  newValue: T;
  oldValue: T;
}

/**
 * 播放器 Store 接口
 */
export interface PlayerStore {
  // ========== 状态获取 ==========
  /** 获取持久化状态 */
  getPersistentState(): PlayerPersistentState;
  /** 获取运行时状态 */
  getRuntimeState(): PlayerRuntimeState;
  /** 获取完整状态 */
  getState(): PlayerState;

  // ========== 持久化状态写入 ==========
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setPlaybackRate(rate: number): void;
  setCodecPreferType(type: number): void;
  setLoudness(mode: number): void;
  /**
   * 是否存在已持久化的用户数据（nova_player_profile 曾被写入过）
   *
   * 「持久化优先」语义的判定依据：存在 → 持久化值优先于外部传入的
   * 默认配置；不存在（首次使用）→ 外部传入值 ?? store 默认值
   */
  hasPersistedData(): boolean;
  /** 设置面板开关项增量合并持久化（镜像/循环/自动开播/关灯/播完暂停） */
  updateSettingsFlags(flags: Partial<PlayerSettingsFlags>): void;
  /** 画面比例持久化（"0:0" 自适应） */
  setAspect(aspect: string): void;
  /** 弹幕设置增量合并持久化（弹幕面板全部可调项） */
  updateDanmakuSettings(patch: Partial<DanmakuPersistedSettings>): void;
  /** 字幕样式增量 patch 持久化（合并到既有样式对象） */
  updateSubtitleStyle(patch: Record<string, unknown>): void;
  updateUserPreferences(preferences: Partial<UserPreferences>): void;
  // 进度条偏好 (PBP)
  setPbpHeight(height: string): void;
  setPbpOpacity(opacity: string): void;
  setPbpPin(pin: number): void;
  setPbpTheme(theme: string): void;
  setPbpState(state: number): void;
  setPbpStateClear(clear: number): void;
  // 系统信息
  setGpuRenderer(renderer: string): void;
  setMaxVideoQn(qn: number): void;
  setMaxAudioQn(qn: number): void;
  setIsWideScreen(wide: boolean): void;

  // ========== 运行时状态写入 ==========
  setPlaying(playing: boolean): void;
  setPaused(paused: boolean): void;
  setLoading(loading: boolean): void;
  setEnded(ended: boolean): void;
  setWaiting(waiting: boolean): void;
  setDuration(duration: number): void;
  setBuffered(buffered: number): void;
  setQuality(qn: number): void;
  setAudioQuality(qn: number): void;
  setAvailableQualities(qualities: QualityOption[]): void;
  setScreenMode(mode: PlayerRuntimeState['screenMode']): void;
  setPip(pip: boolean): void;

  // ========== 批量更新 ==========
  batchUpdateRuntime(updates: Partial<PlayerRuntimeState>): void;

  // ========== 订阅 ==========
  subscribe<K extends keyof PlayerState>(key: K, listener: StateListener<PlayerState[K]>): () => void;

  // ========== 重置 ==========
  resetRuntime(): void;
  resetAll(): void;
}
