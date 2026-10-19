/**
 * @lumina/live-player 公开类型。
 *
 * 本包对外只提供 Web Component：
 * - `LivePlayerElement`（`<nova-live-player>`）是播放器根元素；
 * - `<nova-live-player-danmaku>` 是独立的弹幕渲染组件（消费开发者传入的弹幕插件）；
 * - `<nova-live-player-dm-setting>` 是独立的弹幕设置面板组件；
 * - 其余面板（控制条 / 清晰度 / 速度 / 信息 / 快捷键 / 右键菜单）均为根元素内部 DOM。
 *
 * 流媒体与弹幕能力都必须由开发者通过 `plugins` / `danmakuPlugin` 传入
 * （`createHlsPlugin()` / `createFlvPlugin()` / `createDanmakuPlugin()`），
 * 本包不内置任何流媒体加载或弹幕渲染实现。
 *
 * 插件类型刻意只保留结构对齐的最小定义：既与点播播放器 `Plugin` / `StreamPlugin`
 * 的方法形状一致，又不把 player / plugins 的完整类型图谱拖进本包的 d.ts。
 */

/** 生命周期插件（结构对齐点播播放器 `Plugin`）。 */
export interface NovaLivePlugin {
  /** 插件名称，必须唯一。 */
  readonly name: string;
  /** 插件版本号。 */
  readonly version?: string;
  /** 插件描述。 */
  readonly description?: string;
  /** 依赖的插件名称。 */
  readonly dependencies?: string[];
  /** 安装插件（真实实现接收点播播放器实例）。 */
  install(player: never): void;
  /** 卸载插件。 */
  uninstall?(player: never): void;
  /** 启用插件。 */
  enable?(): void;
  /** 禁用插件。 */
  disable?(): void;
}

/** 流媒体插件最小结构（结构对齐点播播放器 `StreamPlugin`）。 */
export interface NovaLiveStreamPlugin extends NovaLivePlugin {
  /** 插件类型（hls / flv / dash）。 */
  readonly type: string;
  /** 视频元素。 */
  videoElement: HTMLVideoElement | null;
  /** 是否支持当前浏览器。 */
  isSupported(): boolean;
  /** 加载流媒体。 */
  load(config: {
    /** 流地址。 */
    url: string;
    /** 流格式（hls / flv / dash）。 */
    format: unknown;
    /** 是否直播。 */
    isLive?: boolean;
    /** 起播时间。 */
    startTime?: number;
  }): void;
  /** 获取清晰度列表。 */
  getQualities?(): Array<{
    /** 档位 id。 */
    id: string;
    /** 展示名。 */
    label: string;
    /** 视频高度。 */
    height: number;
    /** 是否自动档。 */
    isAuto?: boolean;
  }>;
  /** 切换清晰度。 */
  setQuality?(quality: string): void;
  /** 当前清晰度。 */
  getCurrentQuality?(): string;
  /** 统计信息。 */
  getStats?(): {
    /** 下载速度。 */
    downloadSpeed?: number;
    /** 视频码率。 */
    videoBitrate?: number;
    /** 分辨率。 */
    resolution?: { width: number; height: number };
  };
  /** 订阅清晰度变化。 */
  onQualitiesChange?(cb: (list: NovaLiveStreamQuality[]) => void): () => void;
  /** 设置编码偏好。 */
  setCodecPreference?(type: number): void;
  /** 插件私有事件总线。 */
  getStreamEventBus?(): {
    /** 订阅插件事件。 */
    on(type: string, handler: (payload: unknown) => void): () => void;
  };
}

/** 流媒体清晰度（插件返回值的结构镜像）。 */
export interface NovaLiveStreamQuality {
  /** 档位 id。 */
  id: string;
  /** 展示名。 */
  label: string;
  /** 视频宽度。 */
  width: number;
  /** 视频高度。 */
  height: number;
  /** 码率。 */
  bitrate: number;
  /** 是否自动档。 */
  isAuto?: boolean;
}

/** 弹幕插件（结构对齐 `@lumina/plugins` 的 `DanmakuPluginAPI`）。 */
export interface NovaLiveDanmakuPlugin extends NovaLivePlugin {
  /** 获取底层弹幕引擎。 */
  getManager(): unknown;
  /** 批量注入弹幕。 */
  loadDanmaku(list: unknown[]): void;
  /** 发送弹幕。 */
  send(text: string, options?: Record<string, unknown>): void;
  /** 设置可见性。 */
  setVisible(visible: boolean): void;
  /** 设置透明度。 */
  setOpacity(opacity: number): void;
  /** 设置速度倍率。 */
  setSpeedMultiplier(multiplier: number): void;
  /** 设置字号缩放。 */
  setFontSizeScale(scale: number): void;
  /** 设置显示区域占比。 */
  setAreaRatio(ratio: number): void;
  /** 设置密度。 */
  setDensity(density: number): void;
  /** 设置随屏幕缩放。 */
  setAutoScale(autoScale: boolean): void;
  /** 设置弹幕过滤器。 */
  setFilter(filter: {
    /** 过滤滚动弹幕。 */
    scroll?: boolean;
    /** 过滤固定弹幕。 */
    fixed?: boolean;
    /** 过滤彩色弹幕。 */
    colorful?: boolean;
  }): void;
  /** 播放弹幕动画。 */
  play(): void;
  /** 暂停弹幕动画。 */
  pause(): void;
  /** 清空弹幕。 */
  clear(): void;
}

/** `plugins` 接受的插件实例：流媒体插件或生命周期插件。 */
export type NovaLivePluginInput = NovaLivePlugin | NovaLiveStreamPlugin;

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
  /** 弹幕字色，形如 #FFFFFF。 */
  color: string;
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
  color: '#FFFFFF',
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
  | 'mini'
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
  /**
   * 开发者传入的插件实例（与点播播放器同一套插件体系）。
   *
   * 流媒体与弹幕必须由插件提供：
   * - `createHlsPlugin()` / `createFlvPlugin()` 负责 `.m3u8` / `.flv` 拉流；
   * - `createDanmakuPlugin()` 负责弹幕渲染（也可用 `danmakuPlugin` 单独传入）。
   */
  plugins?: NovaLivePluginInput[];
  /**
   * 弹幕插件（`createDanmakuPlugin()` 的返回值）。
   *
   * 与 `plugins` 中传入弹幕插件二选一；`danmakuPlugin` 为显式入口时优先生效。
   * 未传入时弹幕层不渲染，控制条弹幕入口禁用并 Toast 提示。
   */
  danmakuPlugin?: NovaLiveDanmakuPlugin;
}
