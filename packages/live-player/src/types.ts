/**
 * @lumina/live-player 公开类型。
 *
 * 本包对外只提供 Web Component：
 * - `LivePlayerElement`（`<nova-live-player>`）是播放器根元素；
 * - `<nova-live-player-danmaku>` 是独立的弹幕渲染组件（基于 plugins 的 DanmakuManager）；
 * - `<nova-live-player-dm-setting>` 是独立的弹幕设置面板组件；
 * - 其余面板（控制条 / 清晰度 / 速度 / 信息 / 快捷键 / 右键菜单）均为根元素内部 DOM。
 */

/** 屏幕形态：常规 / 网页全屏 / 原生全屏。 */
export type NovaScreenMode = 'normal' | 'webscreen' | 'fullscreen';

/** 可通过根元素打开的内部面板名称。 */
export type NovaPanelName = 'quality' | 'speed' | 'danmaku' | 'info' | 'hotkey' | 'codec';

/** 直播清晰度档位（只保留直播 UI 需要的字段）。 */
export interface NovaQualityCandidate {
  /** 档位标识，切换时原样回传给流媒体插件。 */
  qn: string;
  /** 档位展示文案，例如 `原画` / `1080P` / `流畅`。 */
  label: string;
  /** 该档位的补充提示。 */
  hint?: string;
}

/** 直播线路候选。 */
export interface NovaLineCandidate {
  /** 线路标识。 */
  line: string;
  /** 线路展示文案，例如 `主线` / `备线1`。 */
  label: string;
}

/** 视频编码候选（AVC / HEVC / AV1 等）。 */
export interface NovaCodecCandidate {
  /** 编码标识，切换时原样派发给上层。 */
  codec: string;
  /** 编码展示文案，例如 `AVC` / `HEVC` / `AV1`。 */
  label: string;
  /** 该编码的补充提示。 */
  hint?: string;
}

/** 弹幕显示区域档位（与 player 面板一致）。 */
export type NovaDanmakuArea = 25 | 50 | 75 | 100;

/** 弹幕描边类型（与 player 面板一致）。 */
export type NovaDanmakuStroke = 'heavy' | 'outline' | 'projection';

/** 弹幕设置（面板与持久化共用同一份结构）。 */
export interface NovaDanmakuSetting {
  /** 是否显示弹幕。 */
  visible: boolean;
  /** 不透明度，取值 0-1。 */
  opacity: number;
  /** 字号（像素），取值 12-48。 */
  fontsize: number;
  /** 速度档位，取值 1-10，数值越大滚动越快。 */
  speed: number;
  /** 显示区域占比（百分比），取值 25-100。 */
  area: number;
  /** 密度，取值 0-1。 */
  density: number;
  /** 是否随屏幕缩放。 */
  autoScale: boolean;
  /** 弹幕速度是否跟随播放倍速。 */
  speedSync: boolean;
  /** 是否防挡字幕（面板展示，遮罩能力由 plugins 提供）。 */
  preventShade: boolean;
  /** 是否启用智能遮罩（面板展示）。 */
  mask: boolean;
  /** 弹幕字体。 */
  fontFamily: string;
  /** 是否加粗。 */
  bold: boolean;
  /** 描边类型。 */
  fontBorder: NovaDanmakuStroke;
  /** 屏蔽词列表。 */
  blockWords: string[];
  /** 按类型过滤：滚动弹幕。 */
  filterScroll: boolean;
  /** 按类型过滤：固定弹幕。 */
  filterFixed: boolean;
  /** 按类型过滤：彩色弹幕。 */
  filterColorful: boolean;
}

/** 弹幕设置默认值。 */
export const DEFAULT_DANMAKU_SETTING: NovaDanmakuSetting = {
  visible: true,
  opacity: 0.8,
  fontsize: 25,
  speed: 5,
  area: 100,
  density: 1,
  autoScale: true,
  speedSync: true,
  preventShade: false,
  mask: true,
  fontFamily: "SimHei, 'Microsoft JhengHei'",
  bold: true,
  fontBorder: 'heavy',
  blockWords: [],
  filterScroll: false,
  filterFixed: false,
  filterColorful: false,
};

/** 弹幕条目：用于 `sendDanmaku` / `loadDanmaku`。 */
export interface NovaDanmakuItem {
  /** 文本内容。 */
  text: string;
  /** 文本颜色（`#rrggbb`）。 */
  color?: string;
  /** 弹幕模式：1 滚动 / 4 底部 / 5 顶部（映射到插件引擎的弹幕类型）。 */
  mode?: number;
  /** 出现时间（秒，直播场景可省略）。 */
  time?: number;
  /** 发送者 uid，用于屏蔽与举报上下文。 */
  uid?: string;
  /** 发送者昵称。 */
  uname?: string;
}

/** 右键菜单上下文：命中的弹幕信息（未命中弹幕时为 null）。 */
export interface NovaContextMenuTarget {
  /** 发送者 uid。 */
  uid: string;
  /** 发送者昵称。 */
  uname: string;
  /** 弹幕文本。 */
  message: string;
}

/** 右键菜单动作。 */
export type NovaContextMenuAction =
  | 'toggle-danmaku'
  | 'more-danmaku-setting'
  | 'video-info'
  | 'video-codec';

/** 控制条动作。 */
export type NovaControlAction =
  | 'toggle-play'
  | 'toggle-mute'
  | 'refresh'
  | 'toggle-danmaku'
  | 'danmaku-setting'
  | 'quality'
  | 'speed'
  | 'send-danmaku'
  | 'webscreen'
  | 'fullscreen';

/** 播放信息面板的数据快照（每 500ms 刷新一次）。 */
export interface NovaVideoInfo {
  /** 房间标识。 */
  room: string;
  /** 直播状态文案。 */
  status: string;
  /** 当前清晰度文案。 */
  quality: string;
  /** 当前线路文案。 */
  line: string;
  /** 缓冲秒数。 */
  buffer: number;
  /** 累计丢帧数。 */
  droppedFrames: number;
  /** 分辨率文本。 */
  resolution: string;
  /** 帧率。 */
  fps: number;
  /** 流媒体协议 / 播放内核。 */
  player: string;
  /** 已开播时长文本。 */
  liveDuration: string;
}

/** 快捷键展示项（只读展示，不参与注册）。 */
export interface NovaHotkeyItem {
  /** 按键文本。 */
  keys: string;
  /** 描述文案的 i18n key。 */
  descKey: string;
}

/** 错误面板内容。 */
export interface NovaErrorContent {
  /** 错误码。 */
  code?: string;
  /** 错误文案（已本地化）。 */
  message: string;
}

/** 根元素的构造配置（通过 property 传入，不使用 attribute）。 */
export interface NovaLivePlayerOptions {
  /** 初始流地址；也可在挂载后通过 `setStream()` 切换。 */
  streamUrl?: string;
  /** 是否在挂载后自动播放（直播通常需要静音才能自动播放）。 */
  autoplay?: boolean;
  /** 是否静音。 */
  muted?: boolean;
  /** 初始音量 0-100。 */
  volume?: number;
  /** 初始清晰度 qn。 */
  quality?: string;
  /** 初始清晰度候选列表。 */
  qualityCandidates?: NovaQualityCandidate[];
  /** 初始线路候选列表。 */
  lineCandidates?: NovaLineCandidate[];
  /** 初始线路文案。 */
  line?: string;
  /** 语言代码（默认 zh-CN）。 */
  locale?: string;
  /** 是否把用户设置写入 localStorage（默认 true）。 */
  persist?: boolean;
  /** 初始弹幕设置。 */
  danmaku?: Partial<NovaDanmakuSetting>;
  /** 房间标识（只用于信息面板展示）。 */
  room?: string;
}
