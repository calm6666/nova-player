/**
 * ============================================
 * Nova 播放器配置与契约类型
 * ============================================
 * 从原根 types/index.ts 拆分而来：Lumina 框架类型（VNode/Component/Lifecycle 等）
 * 已归属 @lumina/framework，本文件只保留播放器应用层类型。
 *
 * @module types/player
 */

import type { VNode } from "@lumina/framework/types";
import type { SubtitleConfig, SubtitleConfigSpace } from "./subtitle";

// ============================================
// 播放器状态枚举
// ============================================

/**
 * 播放器状态枚举
 * 表示视频播放的各种状态
 */
export enum PlayerState {
  /** 初始状态，尚未加载 */
  IDLE = "idle",
  /** 正在加载视频 */
  LOADING = "loading",
  /** 已加载，准备播放 */
  READY = "ready",
  /** 正在播放 */
  PLAYING = "playing",
  /** 暂停状态 */
  PAUSED = "paused",
  /** 播放结束 */
  ENDED = "ended",
  /** 发生错误 */
  ERROR = "error",
  /** 正在缓冲 */
  BUFFERING = "buffering",
}

/**
 * 播放模式枚举
 *
 * 说明：单曲循环语义由顶层 `loop: true` 承担，此处不再提供 SINGLE_LOOP。
 */
export enum PlayMode {
  /** 顺序播放 */
  ORDER = "order",
  /** 列表循环 */
  REPEAT_ALL = "repeatAll",
  /** 随机播放 */
  SHUFFLE = "shuffle",
}

import type { Plugin } from "../core/plugin";
import { LogLevel } from '@lumina/framework/utils';
import type { MediaManifestSource, QualityLevel } from "./streamPlugin";
// 弹幕 Provider 契约（纯类型，零运行时依赖）
import type { DanmakuItem } from "./danmaku";
// 阶段 C.1：插槽类型（SlotEntry / EndingSlot / SlotContext / SlotId）
import type { SlotEntry, SlotContent } from "./slots";
// 沿用 slots.ts 中已定义的同名类型，避免在此重复声明导致类型漂移
export type { SlotEntry, SlotEntryContent, SlotId, RegionSlotId, PluginSlotId, PluginSlotDefinition, NativeControlKey, EndingSlot, TopSlot, SlotContent, SlotMount } from "./slots";

// ============================================
// 播放器配置接口（命名空间化）
// ============================================
// 命名空间化约定：
//   - 顶层只保留资源类三项（container / src / poster）
//   - 其余按功能分组为命名空间，便于深度合并与运行时动态更新
// ============================================

/**
 * 深层可选：把某个值的可空联合展开为「可选」
 * - 数组整体替换（保留元素原类型，不逐元素深可选）
 * - 函数原样保留（避免把回调映射成空对象）
 * - 非纯对象的联合（如 `HTMLElement | string`）原样保留
 */
type OptionalOf<V> = undefined extends V ? undefined : never;

type DeepPartialValue<V> =
  NonNullable<V> extends (...args: never[]) => unknown
    ? V
    : NonNullable<V> extends readonly (infer U)[]
      ? OptionalOf<V> | U[]
      : string extends keyof NonNullable<V>
        ? V
        : NonNullable<V> extends object
          ? | OptionalOf<V>
            | {
                [K in keyof NonNullable<V>]?: DeepPartialValue<
                  NonNullable<V>[K]
                >;
              }
          : V;

/**
 * 深层可选类型
 *
 * 用于「用户输入配置」：嵌套命名空间可部分传参。
 */
export type DeepPartial<T> = {
  [K in keyof T]?: DeepPartialValue<T[K]>;
};

/**
 * 视频源
 * - `string`：单个 URL
 * - `ProgressiveVariant[]`：渐进式（MP4）多清晰度变体，**仅 MP4 使用**
 * - `MediaManifestSource`：HLS/DASH 的清单对象（对象注入模式）
 */
export type PlayerSource = string | ProgressiveVariant[] | MediaManifestSource;

/**
 * 清晰度选择模式
 * - `auto`：自适应（HLS/DASH 走 ABR；MP4 取默认档）
 * - `manual`：用户显式指定档位
 */
export type QualityMode = "auto" | "manual";

/**
 * 画面显示模式
 * - `normal`：普通
 * - `web`：网页全屏
 * - `wide`：宽屏
 * - `mini`：迷你播放器
 */
export type DisplayMode = "normal" | "web" | "wide" | "mini" | "cross";

/**
 * 播放列表条目
 * 复用同一 video 元素与整棵 DOM 换源时使用
 */
export interface MediaItem {
  /** 条目唯一标识 */
  id?: string;
  /** 视频源 */
  src: PlayerSource;
  /** 条目标题 */
  title?: string;
  /** 条目封面图 */
  poster?: string;
  /** 起播时间（秒） */
  startTime?: number; /** 该条目的字幕轨道列表 */
  subtitleList?: SubtitleConfig[];
}

/**
 * 播放行为配置
 * 键名沿用 HTMLMediaElement 惯例
 */
export interface PlaybackConfig {
  /** 自动播放 */
  autoplay?: boolean;
  /** 初始静音 */
  muted?: boolean;
  /** 初始音量 (0-1) */
  volume?: number;
  /** 初始倍速 */
  playbackRate?: number;
  /** 是否循环播放（单曲循环语义由此承担） */
  loop?: boolean;
  /** 播放模式（列表连播策略） */
  playMode?: PlayMode;
  /** 镜像画面（水平翻转） */
  mirror?: boolean;
  /** 音量均衡模式（0 关闭 / 1 标准 / 2 高动态） */
  loudness?: number;
  /** 播完暂停（不自动切集，对应 handoff=2） */
  pauseAfterEnd?: boolean;
  /** 跳过头尾（自动跳过片头 / 片尾断点） */
  skipIntroOutro?: boolean;
  /** 预加载策略 */
  preload?: "none" | "metadata" | "auto";
  /** 移动端内联播放 */
  playsinline?: boolean;
  /** 起播时间（秒），续播场景 */
  startTime?: number;
}

/**
 * 快捷键步长配置
 * 支持把 `keyboard` 从布尔升级为对象形式
 */
export interface KeyboardStepConfig {
  /** 方向键快进/快退步长（秒） */
  seekStep?: number;
  /** 方向键音量步长 (0-1) */
  volumeStep?: number;
  /** 长按加速倍率 */
  holdRate?: number;
}

/**
 * UI 外观与控件配置
 */
/** 播放场景：station=站内完整播放器；embedded=外链 / iframe 嵌入播放器 */
export type PlayerScene = "station" | "embedded";

/** 片尾相关推荐条目（external 数据由使用方提供，播放器不臆造） */
export interface EndingRelatedItem {
  /** 稿件 avid */
  aid?: number;
  /** 稿件 bvid */
  bvid?: string;
  /** 分 P cid */
  cid?: number;
  /** 标题 */
  title: string;
  /** 封面图 URL */
  pic?: string;
  /** 时长（秒；数字与字符串均可） */
  duration?: number | string;
  /** 点击跳转地址 */
  url?: string;
}

/** 片尾 UP 主信息（external 数据由使用方提供） */
export interface EndingUpInfo {
  /** UP 主 mid */
  mid?: number;
  /** 昵称 */
  name?: string;
  /** 头像 URL */
  face?: string;
  /** 个人空间地址 */
  url?: string;
  /** 是否已关注 */
  followed?: boolean;
}

/** 片尾分享面板数据 */
export interface ShareInfo {
  /** 视频地址（分享链接） */
  url?: string;
  /** 嵌入代码（iframe） */
  embedCode?: string;
  /** 二维码图片地址（未提供时展示占位提示，不绘制假二维码） */
  qrCodeUrl?: string;
}

/** 外链 / 嵌入场景配置（scene=embedded 时生效） */
export interface EmbeddedConfig {
  /** 视频标题（片尾页顶部展示） */
  title?: string;
  /** 顶部点赞 / 评论统计数（外链暂停页展示） */
  stats?: {
    like?: number;
    comment?: number;
  };
  /** UP 主信息 */
  up?: EndingUpInfo;
  /** 片尾相关推荐（最多渲染 10 张卡片） */
  related?: EndingRelatedItem[];
  /** 「进入哔哩哔哩观看」按钮跳转地址 */
  enterUrl?: string;
  /** 「下载客户端」按钮跳转地址 */
  downloadUrl?: string;
}

export interface UiConfig {
  /** 视频标题（顶部栏展示） */
  title?: string;
  /**
   * 播放场景
   *
   * - station（默认）：站内完整播放器，完整控制栏 + 浮层式片尾 + 自动连播倒计时
   * - embedded：外链 / iframe 嵌入播放器，简化控制栏 + 整页式片尾 + 进入站内入口
   */
  scene?: PlayerScene;
  /**
   * 是否在 .nova-player-container 上添加 state-disable-box-shadow 类名
   *
   * 添加后禁用容器外阴影（box-shadow: none），移除后恢复默认阴影。
   * 默认 false（显示阴影）；运行时可通过 setBoxShadowDisabled 切换。
   */
  disableBoxShadow?: boolean;
  /**
   * 初始加载遮罩是否随首屏直出显示（LoadingPanel 初值）
   *
   * true 时 SSR 直出与挂载渲染的 LoadingPanel 立即可见，覆盖
   * 「水合完成 → 流媒体插件接管 load() 广播 LOAD_START」之间的空窗，
   * 由 LOADED_METADATA / CAN_PLAY / ABORT / ERROR 统一收口隐藏。
   * 默认 false（保持既有行为：仅 LOAD_START 后显示）。
   */
  initialLoading?: boolean;
  /** 片尾形态（默认 standard；电视剧 / 番剧使用 ogv） */
  endingStyle?: PlayerEndingStyle;
  /** Top 形态：default（普通）/ tv（电视剧）/ music（音乐） */
  topStyle?: "default" | "tv" | "music";
  /** 音乐模式 Top 跑马灯文案 */
  musicTitle?: string;
  /** 外链 / 嵌入场景数据 */
  embedded?: EmbeddedConfig;
  /** 电视剧 / 番剧片尾数据（endingStyle=ogv 时生效） */
  ogv?: OgvEndingConfig;
  /** 互动视频片尾数据（endingStyle=interactive 时生效） */
  interactive?: InteractiveEndingConfig;
  /** 站内标准片尾的相关推荐数据（不传则为空列表） */
  related?: EndingRelatedItem[];
  /** 站内标准片尾的 UP 主信息（头像 / 昵称 / 关注态） */
  up?: EndingUpInfo;
  /** 片尾分享面板数据（视频地址 / 嵌入代码 / 二维码图片） */
  share?: ShareInfo;
  /** 控制条开关（单一来源） */
  controls?: ControlsConfig;
  /** Top 整体插槽：替换 .nova-player-top-wrap 内部内容 */
  top?: SlotContent;
  /** Ending 整体插槽：替换 .nova-player-ending-wrap 内部内容 */
  ending?: SlotContent;
  /**
   * 插槽项列表
   *
   * 每项按 slot（内置区域 id 或插件声明的插槽 id）注入对应区域，按 order 升序排列。
   * 框架无响应式：列表在挂载期读取一次，运行时变更需通过 setConfig 重渲染。
   */
  slots?: SlotEntry[];
}

/**
 * 交互配置
 */
export interface InteractionConfig {
  /** 快捷键：布尔开关，或对象形式配置步长 */
  keyboard?: boolean | KeyboardStepConfig;
}

/**
 * 清晰度配置
 */
export interface QualityConfig {
  /** 默认画质（档位 id，或 'auto'） */
  default?: string;
  /** 选择模式 */
  mode?: QualityMode;
  /** 清晰度上限（像素高度） */
  max?: number;
  /** 清晰度下限（像素高度） */
  min?: number;
  /** 自定义菜单文案，按档位 id 索引 */
  labels?: Record<string, string>;
}

/**
 * 进度条预览帧（预览图 Provider 的返回值）
 *
 * 由外部开发者实现获取逻辑（雪碧图裁切 / 逐帧 URL / 服务端接口皆可），
 * 播放器只消费 url 与可选样式字段，不做任何数据获取。
 */
export interface ProgressPreviewFrame {
  /** 图片地址（普通 URL 或 data URL） */
  url: string;
  /** 雪碧图模式：裁切窗口宽（如 '160px'）；逐帧模式缺省 */
  width?: string;
  /** 雪碧图模式：裁切窗口高（如 '90px'）；逐帧模式缺省 */
  height?: string;
  /** 雪碧图模式：img 的 object-fit 样式（'none'）；逐帧模式缺省 */
  objectFit?: string;
  /** 雪碧图模式：img 的 object-position 样式（如 '-320px -90px'）；逐帧模式缺省 */
  objectPosition?: string;
}

/**
 * 预览图提供者
 *
 * 进度条悬停时按「悬停时间 + 总时长」询问外部预览帧，
 * 支持同步或异步（Promise）返回；null 表示该时间点无预览。
 */
export type ProgressPreviewProvider = (
  time: number,
  duration: number,
) => ProgressPreviewFrame | null | Promise<ProgressPreviewFrame | null>;

/**
 * 高能进度条数据（外部 energyProvider 的返回值）
 *
 * 纯数据结构：播放器内部只做「采样点 → SVG 曲线」的纯换算，
 * 数据获取（接口请求 / 归一化）由外部完成。
 */
export interface EnergyProgressData {
  /** 采样间隔（秒） */
  stepSec: number;
  /** 采样点（0-1，首点对应 0 秒） */
  data: number[];
  /** 总时长（秒），用于把播放进度换算成采样点下标 */
  duration?: number;
}

/**
 * 高能进度条数据提供者
 *
 * 支持同步或异步（Promise）返回；null 表示无高能数据（不绘制曲线）。
 */
export type EnergyProgressProvider =
  | (() => EnergyProgressData | null)
  | (() => Promise<EnergyProgressData | null>);

/**
 * 进度条跳过片头 / 片尾断点
 *
 * 由外部数据源提供（电视剧 / 番剧的 op、ed 时间轴），
 * 供进度条渲染断点标记与「跳过头尾」自动跳过使用。
 */
export interface ProgressSkipPoints {
  /** 片头结束时间（秒） */
  introEnd?: number;
  /** 片尾开始时间（秒） */
  outroStart?: number;
}

/**
 * 片尾形态
 * - standard：普通视频的浮层片尾
 * - ogv：电视剧 / 番剧的整页片尾（封面 + 追剧 + 推荐 + 回看）
 */
export type PlayerEndingStyle = "standard" | "ogv" | "interactive";

/** 互动视频进度回溯节点 */
export interface InteractiveBacktrackItem {
  /** 节点标题 */
  title: string;
  /** 节点截图 */
  pic?: string;
  /** 点击跳转 / 回溯回调数据 */
  url?: string;
}

/** 互动视频片尾数据 */
export interface InteractiveEndingConfig {
  /** 关注人数（如 "6.3万"） */
  followers?: string;
  /** 打分提示文案 */
  ratingPrompt?: string;
  /** 进度回溯节点（按时间顺序） */
  backtrack?: InteractiveBacktrackItem[];
  /** 当前高亮节点下标 */
  activeBacktrackIndex?: number;
  /** 相关推荐（4 列展示） */
  related?: EndingRelatedItem[];
}

/** 电视剧 / 番剧片尾数据 */
export interface OgvEndingConfig {
  /** 剧集标题 */
  title?: string;
  /** 剧集封面（68×68 展示） */
  cover?: string;
  /** 是否已追剧 */
  followed?: boolean;
  /** 相关推荐（112×148 卡片） */
  related?: EndingRelatedItem[];
}

/**
 * 进度条配置
 */
export interface ProgressThumbAnimationSource {
  /** 动画 JSON URL（kind="lottie"）或图片 URL（kind="image"） */
  url: string;
  /** 资源类型，默认 lottie */
  kind?: "lottie" | "image";
  /** 动画总帧数（描述信息，决定常态停帧与落点延迟） */
  totalFrames?: number;
  /** 动画帧率（描述信息，与 totalFrames 一起计算落点延迟） */
  frameRate?: number;
  /** 常态停帧，默认 floor(totalFrames / 2) */
  idleFrame?: number;
  /** 尺寸（px），缺省取 thumbIcon.size，再缺省 20 */
  size?: number;
  /** 拖拽方向：跟随鼠标（默认）或固定正向 */
  direction?: "follow" | "fixed";
}

export interface ProgressThumbIconConfig {
  /** 拖拽动画；不传时使用内置兜底动画 */
  drag?: ProgressThumbAnimationSource;
  /** 松手落点动画；不传时使用内置兜底动画 */
  drop?: ProgressThumbAnimationSource;
  /** 完全没有动画时直接展示的静态图片 URL */
  staticImage?: string;
  /** 统一尺寸（px），单项 size 优先 */
  size?: number;
  /** 落点动画结束后的复位延迟；未提供时按 totalFrames / frameRate 计算 */
  dropDelayMs?: number;
}

export interface ProgressConfig {
  /** 进度条分段数据 */
  segments?: ProgressSegment[];
  /**
   * 分段进度条常驻展开开关
   *
   * 仅在存在多段（segments.length > 1）时生效；开启后底部影子进度条
   * 才添加 .permanent 展开分段文本，默认关闭。
   */
  shadowPermanent?: boolean;
  /**
   * 预览图提供者（进度条悬停时按时间获取预览帧）
   *
   * 数据获取逻辑由外部实现（如雪碧图下标裁切、逐帧 URL、服务端接口），
   * 播放器不内置任何预览数据获取。
   */
  previewProvider?: ProgressPreviewProvider;
  /** 高能进度条数据提供者（外部获取，播放器只负责绘制曲线） */
  energyProvider?: EnergyProgressProvider;
  /** 片头 / 片尾跳过断点（外部提供，用于进度条标记与自动跳过） */
  skipPoints?: ProgressSkipPoints;
  /**
   * 自定义进度条 thumb 图标
   *
   * 直接传动画 JSON URL 与动画描述；播放器内部 fetch 并交给 lottie，
   * 不区分 url1/url2 语义。没有动画时可用 staticImage 直接展示图片。
   */
  thumbIcon?: ProgressThumbIconConfig;
}

/**
 * 插件配置
 */
export interface PluginsConfig {
  /** 插件实例列表 */
  list?: Plugin[];
  /** 按插件名索引的插件选项 */
  options?: Record<string, unknown>;
}

/**
 * 持久化配置
 */
export interface StorageConfig {
  /** 是否启用持久化 */
  enabled?: boolean;
  /** localStorage 键前缀 */
  prefix?: string;
}

/**
 * 高级配置
 */
export interface AdvancedConfig {
  /** 日志级别 */
  logLevel?: LogLevel;
  /** 调试模式（等价 logLevel: 'debug'） */
  debug?: boolean;
}

/**
 * i18n 国际化配置
 *
 * 独立定义以避免公共类型文件导入业务逻辑（core/i18n.ts）。
 * 结构与 core/i18n.ts 的 I18nConfig 保持一致。
 */
export interface I18nPlayerConfig {
  /** 是否启用 i18n（默认 false，未启用时 t() 走零开销路径） */
  enabled?: boolean;
  /** 初始语言（默认 'en-US'） */
  locale?: string;
  /** fallback 语言（默认 'en-US'） */
  fallbackLocale?: string;
  /** 初始语言包映射（locale → { key → text }，结构与 core/i18n.ts 的 I18nConfig.messages 一致） */
  messages?: Record<string, Record<string, string>>;
}

/**
 * 播放器配置（命名空间形态）
 *
 * 顶层只保留资源类三项，其余按功能分组。
 * 这是「配置可动态更新」的对外类型，`mergePlayerConfig` 会与默认值深度合并。
 */
export type PlayerConfig = {
  // ── 资源（顶层）──
  /** 容器元素或选择器 */
  container?: HTMLElement | string;
  /** 视频源 */
  src?: PlayerSource;
  /** 封面图 URL */
  poster?: string;
  /** 播放器名称（用于容器 aria-label / 日志；缺省“嗨哩播放器”，与视频标题 ui.title 无关） */
  playerName?: string;

  // ── 分组 ──
  /** 播放行为 */
  playback?: PlaybackConfig;
  /** 播放列表（复用 DOM 换视频用） */
  playlist?: MediaItem[];
  /** 初始播放第几个 */
  playlistIndex?: number;
  /**
   * 显示模式（创建时确定，默认不传 = "normal"）
   *
   * - normal：普通形态
   * - cross：竖排紧凑形态（稍后再看 PiP）——容器 `data-screen="cross"`，
   *   不注册区域可见性监听（mini 自动切换从源头不存在）、弹幕发送栏
   *   移入控制栏中央并定死、悬浮上/下集通过 ui.slots 的 video.overlay
   *   注入、全屏 / 网页全屏退出后回到 cross
   *
   * 仅在创建时生效，不支持运行时在 normal ↔ cross 间动态切换。
   */
  mode?: DisplayMode;
  /** 外观与控件 */
  ui?: UiConfig;
  /** 交互与快捷键 */
  interaction?: InteractionConfig;
  /** 清晰度 */
  quality?: QualityConfig;
  /** 进度条 */
  progress?: ProgressConfig;
  /**
   * 弹幕数据与运行时能力完全由 DanmakuPlugin 管理；
   * PlayerConfig 不再提供 danmaku 配置入口。
   */
  /** 字幕配置（命名空间形态） */
  subtitle?: SubtitleConfigSpace;
  /** 插件 */
  plugins?: PluginsConfig;
  /** 持久化 */
  storage?: StorageConfig;
  /** 高级 */
  advanced?: AdvancedConfig;
  /** 配置式事件回调 */
  callbacks?: EventListeners;
  /**
   * 问题反馈面板（Top 的问题反馈图标打开）
   *
   * 提交接口与外链打开由宿主注入；未提供 submit 时仅对外广播事件。
   */
  feedback?: {
    /** 提交反馈：返回 0 成功，其它为失败码 */
    submit?: (data: {
      tagId: number;
      content: string;
      contact: string;
    }) => Promise<number> | number;
    /** 外链打开方式（默认 window.open） */
    openWindow?: (url: string) => void;
  };
  /** i18n 国际化配置（未配置时 t() 走零开销英文字面量路径） */
  i18n?: I18nPlayerConfig;
};

/**
 * 旧「扁平」配置形态
 *
 * 仅用于兼容层 `normalizeConfig()` 的输入类型描述，
 * 表示历史版本直接写在顶层的配置键。新代码请使用 `PlayerConfig`。
 */
export interface LegacyPlayerConfig {
  /** 容器元素或选择器 */
  container?: HTMLElement | string;
  /** 视频源（含旧的 string[] 备用源写法） */
  src?: string | string[] | ProgressiveVariant[];
  /** 封面图 URL */
  poster?: string;
  /** 自动播放 */
  autoplay?: boolean;
  /** 默认静音 */
  muted?: boolean;
  /** 默认音量 (0-1) */
  volume?: number;
  /** 默认播放速度 */
  playbackRate?: number;
  /** 是否循环播放 */
  loop?: boolean;
  /** 播放模式 */
  playMode?: PlayMode;
  /** 预加载策略 */
  preload?: "none" | "metadata" | "auto";
  /** 移动端内联播放 */
  playsinline?: boolean;
  /** 控制条配置（旧键名之一） */
  controls?: ControlsConfig;
  /** 控制条配置（更早的旧键名） */
  controlBtns?: ControlsConfig;
  /** 默认画质（档位 id） */
  defaultQuality?: string;
  /** 是否启用键盘快捷键 */
  keyboard?: boolean | KeyboardStepConfig;
  /** 视频进度条分段 */
  progressSegments?: ProgressSegment[];
  /** 播放器名称 */
  playerName?: string;
  /** 字幕轨道列表 */
  subtitles?: SubtitleConfig[];
  /** 插件列表 */
  plugins?: Plugin[];
  /** 是否开启调试模式 */
  debug?: boolean;
  /** 事件回调函数 */
  callbacks?: EventListeners;
}

/**
 * 控制条配置
 *
 * 由原 `ControlBtnConfig`（对外配置）与运行时 `ControlConfig` 合并而来，
 * 是控件开关的唯一类型来源。控件键与状态/事件名对齐（`wideScreen` / `webFullscreen`）。
 */
export interface ControlsConfig {
  /** 上一个分 P 按钮 */
  prev?: boolean;
  /** 下一个分 P 按钮 */
  next?: boolean;
  /** 看点按钮 */
  viewpoint?: boolean;
  /** 清晰度菜单 */
  quality?: boolean;
  /** 选集菜单 */
  episodes?: boolean;
  /** 设置菜单 */
  setting?: boolean;
  /** 画中画按钮 */
  pip?: boolean;
  /** 宽屏按钮 */
  wideScreen?: boolean;
  /** 网页全屏按钮 */
  webFullscreen?: boolean;
  /** 全屏按钮（运行时经 `ui.controls.fullscreen` 路径读取，显式 false 隐藏） */
  fullscreen?: boolean;
  /** 弹幕发送栏（embedded 场景默认显示；显式 false 强制关闭，如互动编辑器） */
  danmakuSend?: boolean;
  /** 进度条分段（运行时从配置透传给控制条） */
  progressSegments?: ProgressSegment[];
  /** 分段进度条常驻展开开关（仅多段时生效） */
  shadowPermanent?: boolean;
}

/**
 * 进度条分段数据
 */
export interface ProgressSegment {
  /** 分段起始时间（秒） */
  startTime: number;
  /** 分段结束时间（秒） */
  endTime: number;
  /**分段DOM元素 */
  element?: HTMLDivElement;
  /** 缓冲进度条DOM元素*/
  bufferElement?: HTMLDivElement;
  /** 视频播放进度条DOM元素 */
  currentElement?: HTMLDivElement;
  /** 分段阴影元素（用于显示预览图等） */
  shadowElement?: HTMLDivElement;
  /** 阴影缓冲进度条DOM元素 */
  shadowBufferElement?: HTMLDivElement;
  /** 阴影视频播放进度条DOM元素 */
  shadowCurrentElement?: HTMLDivElement;
  /** 阴影文本元素（用于显示时间预览等） */
  shadowTextElement?: HTMLDivElement;
  /** 分段文本描述 */
  label: string;
}

/**
 * 渐进式（MP4）清晰度变体
 *
 * ⚠️ 仅 MP4 多文件场景需要手填；HLS/DASH 的清晰度由 manifest 在运行时发现，不要传。
 * `height` 与 `label` 至少提供其一（都缺时开发环境会打印警告）。
 */
export interface ProgressiveVariant {
  /** 视频 URL */
  url: string;
  /** 显示名称（不传则由 height 推导） */
  label?: string;
  /** 视频宽度（像素） */
  width?: number;
  /** 视频高度（像素），既是标识也是排序依据 */
  height?: number;
  /** 视频码率（bps） */
  bitrate?: number;
  /** 档位标识（可选，默认用数组索引） */
  quality?: string;
}

// ============================================
// 播放器事件接口
// ============================================

/**
 * 播放器事件映射
 * 定义所有可监听的事件及其回调参数
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PlayerEvents extends Record<string, (...args: any[]) => void> {
  /** 播放器初始化完成 */
  ready: () => void;
  /** 播放开始 */
  play: () => void;
  /** 播放暂停 */
  pause: () => void;
  /** 播放结束 */
  ended: () => void;
  /** 播放进度更新 */
  timeupdate: (currentTime: number, duration: number) => void;
  /** 音量变化 */
  volumechange: (volume: number, muted: boolean) => void;
  /** 播放速度变化 */
  ratechange: (rate: number) => void;
  /** 画质切换 */
  qualitychange: (quality: string) => void;
  /** 进入全屏 */
  fullscreenchange: (isFullscreen: boolean) => void;
  /** 进入画中画 */
  pipchange: (isPip: boolean) => void;
  /** 缓冲状态变化 */
  waiting: () => void;
  /** 缓冲完成，可以继续播放 */
  canplay: () => void;
  /**
   * 已可播放至结尾（契约事件 `canPlayThrough`，直连内部总线）
   *
   * 注意与上面的 `canplay` 不是同一事件：`canplay` 由契约 `canPlay` 桥接而来，
   * 本条对应契约的 `canPlayThrough`，语义为「整个媒体可以播完而不中断」。
   */
  canPlayThrough: () => void;
  /** 加载进度更新 */
  progress: (buffered: TimeRanges) => void;
  /** 发生错误 */
  error: (error: MediaError) => void;
  /** 状态变化 */
  statechange: (state: PlayerState) => void;
  /** 点击播放器 */
  click: (event: MouseEvent) => void;
  /** 双击播放器 */
  dblclick: (event: MouseEvent) => void;

  // ===== HTML5 媒体元素标准事件（与 video 元素一一对应） =====
  /** 加载被中止（用户主动中断 / 切换源） */
  abort: () => void;
  /** 媒体时长变化 */
  durationchange: (duration: number) => void;
  /** 媒体被清空（重新加载前触发） */
  emptied: () => void;
  /** 首帧数据加载完成（readyState 达到 HAVE_CURRENT_DATA） */
  loadeddata: () => void;
  /** 媒体元数据加载完成（duration 可用） */
  loadedmetadata: (duration: number) => void;
  /** 开始加载媒体 */
  loadstart: () => void;
  /** 实际开始播放（缓冲结束后，与 play 区分） */
  playing: () => void;
  /** 跳转完成 */
  seeked: (currentTime: number) => void;
  /** 跳转开始 */
  seeking: (currentTime: number) => void;
  /** 数据停滞（网络/磁盘长时间无数据） */
  stalled: () => void;
  /** 浏览器主动暂停加载（非错误） */
  suspend: () => void;

  // ===== 以下为「总线直连」事件 =====
  // 这些事件在内部 TypedEventBus 上以 camelCase 键发射，未经桥接适配，
  // player.on('qualityListChange', cb) 会直接订阅总线，payload 即下列对象。
  // 命名与 core/events.ts 的 PlayerEventMap 保持一致，改动时需同步两处。

  /** 播放器被销毁 */
  destroy: () => void;
  /** 播放器尺寸变化 */
  resize: (width: number, height: number) => void;
  /** 用户提交了弹幕（发送栏触发；弹幕内容经 danmakuSend 传递） */
  sendDanmaku: () => void;

  // 生命周期
  /** 播放器挂载完成 */
  mounted: (payload: {
    container?: HTMLElement;
    video?: HTMLVideoElement;
    sendingArea?: HTMLElement;
  }) => void;
  /** 已从持久化存储恢复上次观看位置 */
  restoreProgress: (payload: { time: number }) => void;

  // 媒体属性
  /** 静音状态变化 */
  mutedChange: (muted: boolean) => void;
  /** 跳转开始 */
  seekStart: (payload: { time: number; previousTime: number }) => void;
  /** 跳转结束 */
  seekEnd: (payload: { time: number; previousTime: number }) => void;

  // 清晰度
  /** 清晰度列表就绪 / 变化 */
  qualityListChange: (payload: {
    qualities: QualityLevel[];
    mode: "none" | "static" | "adaptive";
  }) => void;
  /** 清晰度切换已请求（切换中） */
  qualityChangeRequested: (payload: {
    from: string;
    to: string;
    label?: string;
  }) => void;
  /** 清晰度切换成功 */
  qualityChangeRendered: (payload: {
    from: string;
    to: string;
    quality?: QualityLevel;
    elapsed: number;
  }) => void;
  /** 清晰度切换失败 */
  qualityChangeFailed: (payload: {
    from: string;
    to: string;
    reason: string;
  }) => void;
  /** 清晰度模式变化 */
  qualityModeChange: (payload: { mode: "auto" | "manual" }) => void;

  // 画面模式
  /** 网页全屏状态变化 */
  webFullscreenChange: (payload: { isWebFullscreen: boolean }) => void;
  /** 宽屏状态变化 */
  wideScreenChange: (payload: { isWideScreen: boolean }) => void;
  /**
   * 显示模式变化
   *
   * 阶段 D.1：normal / web / wide / mini 之间的切换会触发，
   * 与 webFullscreenChange / wideScreenChange 同时发出（互不替代）。
   */
  displayModeChange: (payload: { mode: DisplayMode }) => void;

  // 错误
  /** 错误恢复 */
  errorRecovery: () => void;

  // 弹幕
  /** 弹幕显隐变化 */
  danmakuToggle: (payload: { visible: boolean }) => void;
  /** 弹幕数据加载完成 */
  danmakuLoaded: (payload: { count: number; url?: string }) => void;
  /** 弹幕透明度变化 */
  danmakuOpacityChange: (opacity: number) => void;
  /** 弹幕速度变化 */
  danmakuSpeedChange: (speed: number) => void;
  /** 请求发送弹幕 */
  danmakuSend: (payload: {
    text: string;
    options?: Record<string, unknown>;
  }) => void;
  /** 弹幕发送成功 */
  danmakuSent: (payload: Record<string, unknown>) => void;
  /** 弹幕清空 */
  danmakuClear: () => void;

  // 发送栏互动计数（总线直连；服务端实时数据 / 本地发送自增驱动）
  /** 在线观看人数更新 */
  onlineCountChange: (payload: { count: number }) => void;
  /** 弹幕总条数更新 */
  danmakuCountChange: (payload: { count: number }) => void;

  // 字幕
  /** 字幕显隐变化 */
  subtitleToggle: (payload: { visible: boolean }) => void;
  /** 字幕语言变化 */
  subtitleLangChange: (lang: string) => void;
  /** 字幕切换 */
  subtitleSwitch: (payload: { lang: string }) => void;
  /**
   * 字幕列表变化
   * - count：字幕条数（loading / error 时为 0）
   * - status：AI 字幕加载状态（可选，未提供则表示普通列表更新）
   *   - 'loading'：AI 字幕请求中
   *   - 'ready'：AI 字幕已就绪
   *   - 'error'：AI 字幕加载失败
   */
  subtitleListChange: (payload: {
    count: number;
    status?: "loading" | "ready" | "error";
  }) => void;

  // 播放列表 / 多 P
  /** 当前播放条目变化 */
  episodeChange: (payload: {
    index: number;
    total: number;
    id?: string;
    title?: string;
  }) => void;
  /** 播放列表本身变化 */
  playlistChange: (payload: { index: number; total: number }) => void;
  /** 请求播放上一个 */
  prevRequest: () => void;
  /** 请求播放下一个 */
  nextRequest: () => void;

  // 互动
  /** 互动：点赞 */
  interactionLike: () => void;
  /** 互动：投币 */
  interactionCoin: () => void;
  /** 互动：收藏 */
  interactionCollect: () => void;
  /** 互动：关注 */
  interactionFollow: () => void;
  /** 互动：外链点击 */
  interactionLinkClick: () => void;
  /** 互动：投票选择 */
  interactionVoteSelect: (payload: {
    voteIndex: number;
    optionIndex: number;
  }) => void;
  /** 互动：评分选择 */
  interactionScoreSelect: (payload: {
    scoreIndex: number;
    value: number;
  }) => void;
  /** 互动：卡片关闭 */
  interactionCardClose: (payload: { type: string; index: number }) => void;
  /** 互动：卡片位置变化 */
  interactionPositionChange: (payload: {
    type: string;
    index: number;
    top: number;
    left: number;
  }) => void;

  // 流媒体
  /** 流媒体错误 */
  streamError: (payload: { message?: string; error?: unknown }) => void;
  /** 流媒体清晰度变化（自动或手动切换） */
  streamQualityChange: (payload: {
    width: number;
    height: number;
    bitrate?: number;
    isAuto?: boolean;
    qualityId?: string;
    label?: string;
  }) => void;
}

/**
 * 播放器状态数据
 * 当前播放器的完整状态快照
 */
export interface PlayerStateData {
  /** 当前播放状态 */
  state: PlayerState;
  /** 当前播放时间（秒） */
  currentTime: number;
  /** 视频总时长（秒） */
  duration: number;
  /** 当前音量 (0-1) */
  volume: number;
  /** 是否静音 */
  muted: boolean;
  /** 当前播放速度 */
  playbackRate: number;
  /** 当前画质（档位 id） */
  quality: string;
  /** 是否全屏 */
  isFullscreen: boolean;
  /** 是否画中画 */
  isPip: boolean;
  /** 缓冲范围 */
  buffered: TimeRanges | null;
  /** 视频宽高比 */
  aspectRatio: number;
}

// ============================================
// UI 组件属性接口
// ============================================

/**
 * 进度条组件属性
 */
export interface ProgressBarProps {
  /** 当前时间 */
  currentTime: number;
  /** 总时长（用于显示） */
  duration: number;
  /** 获取最新总时长的回调（用于计算，解决响应式问题） */
  getDuration?: () => number;
  /** 缓冲范围 */
  buffered: TimeRanges | null;
  /** 是否正在拖拽 */
  isDragging?: boolean;
  /** 进度变化回调 */
  onChange: (time: number) => void;
  /** 开始拖拽回调 */
  onDragStart?: () => void;
  /** 结束拖拽回调 */
  onDragEnd?: () => void;
}

/**
 * 音量控制组件属性
 */
export interface VolumeProps {
  /** 当前音量 (0-1) */
  volume: number;
  /** 是否静音 */
  muted: boolean;
  /** 音量变化回调 */
  onChange: (volume: number, muted: boolean) => void;
  /** 静音切换回调 */
  onMuteToggle?: () => void;
  /** 音量条显示回调 */
  onShow?: () => void;
  /** 音量条隐藏回调 */
  onHide?: () => void;
}

/**
 * 播放按钮组件属性
 */
export interface PlayButtonProps {
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 当前播放状态 */
  state: PlayerState;
  /** 点击回调 */
  onClick: () => void;
  /** 鼠标进入回调 */
  onMouseEnter?: () => void;
  /** 鼠标离开回调 */
  onMouseLeave?: () => void;
  /** 获得焦点回调 */
  onFocus?: () => void;
  /** 失去焦点回调 */
  onBlur?: () => void;
}

/**
 * 时间显示组件属性
 */
export interface TimeDisplayProps {
  /** 当前时间（秒） */
  currentTime: number;
  /** 总时长（秒） */
  duration: number;
  /** 点击回调（可用于切换剩余时间显示） */
  onClick?: () => void;
  /** 鼠标进入回调 */
  onMouseEnter?: () => void;
  /** 鼠标离开回调 */
  onMouseLeave?: () => void;
}

/**
 * 加载动画组件属性
 */
export interface LoadingProps {
  /** 是否显示 */
  visible: boolean;
  /** 加载提示文字 */
  text?: string;
  /** 显示回调 */
  onShow?: () => void;
  /** 隐藏回调 */
  onHide?: () => void;
}

/**
 * 错误提示组件属性
 */
export interface ErrorProps {
  /** 错误代码 */
  code: number;
  /** 错误信息 */
  message: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 显示回调 */
  onShow?: () => void;
  /** 关闭回调 */
  onClose?: () => void;
}

/**
 * 画质选择组件属性
 */
export interface QualitySelectorProps {
  /** 当前画质（档位 id） */
  current: string;
  /** 可用画质列表 */
  qualities: ProgressiveVariant[];
  /** 画质切换回调 */
  onChange: (quality: string) => void;
  /** 下拉菜单打开回调 */
  onOpen?: () => void;
  /** 下拉菜单关闭回调 */
  onClose?: () => void;
}

/**
 * 控制条组件属性
 */
export interface ControlBarProps {
  /** 是否显示 */
  visible: boolean;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 当前时间 */
  currentTime: number;
  /** 总时长 */
  duration: number;
  /** 缓冲范围 */
  buffered: TimeRanges | null;
  /** 当前音量 */
  volume: number;
  /** 是否静音 */
  muted: boolean;
  /** 播放速度 */
  playbackRate: number;
  /** 当前画质（档位 id） */
  quality: string;
  /** 可用画质列表 */
  qualities: ProgressiveVariant[];
  /** 播放模式 */
  playMode: PlayMode;
  /** 是否全屏 */
  isFullscreen: boolean;
  /** 播放/暂停回调 */
  onPlayPause: () => void;
  /** 进度跳转回调 */
  onSeek: (time: number) => void;
  /** 开始拖拽进度条回调 */
  onSeekStart?: () => void;
  /** 结束拖拽进度条回调 */
  onSeekEnd?: () => void;
  /** 获取最新总时长（用于解决响应式问题） */
  getDuration?: () => number;
  /** 音量变化回调 */
  onVolumeChange: (volume: number, muted: boolean) => void;
  /** 速度变化回调 */
  onRateChange: (rate: number) => void;
  /** 画质切换回调 */
  onQualityChange: (quality: string) => void;
  /** 播放模式切换回调 */
  onPlayModeChange: (mode: PlayMode) => void;
  /** 全屏切换回调 */
  onFullscreenToggle: () => void;
  /** 画中画切换回调 */
  onPipToggle: () => void;
  /** 鼠标进入控制条回调 */
  onMouseEnter?: () => void;
  /** 鼠标离开控制条回调 */
  onMouseLeave?: () => void;
  /** 设置按钮点击回调 */
  onSettingsClick?: () => void;
  /** 字幕按钮点击回调 */
  onSubtitleClick?: () => void;
  /** 弹幕按钮点击回调 */
  onDanmakuClick?: () => void;
}

// ============================================
// 工具类型
// ============================================

/**
 * 事件监听器映射类型
 */
export type EventListeners = {
  [K in keyof PlayerEvents]?: PlayerEvents[K];
};

/**
 * 播放器方法接口
 * 播放器实例暴露的所有方法
 */
export interface PlayerMethods {
  // ===== 播放控制 =====
  /** 播放视频 */
  play(): Promise<void>;
  /** 暂停视频 */
  pause(): void;
  /** 切换播放/暂停 */
  toggle(): void;
  /** 跳转到指定时间 */
  seek(time: number): void;
  /** 相对当前位置跳转 */
  seekBy(delta: number): void;
  /** 重新加载当前源 */
  reload(): void;

  // ===== 音量 / 倍速 / 播放模式 =====
  /** 设置音量 */
  setVolume(volume: number): void;
  /** 获取音量 */
  getVolume(): number;
  /** 切换静音 */
  toggleMute(): void;
  /** 设置静音 */
  setMuted(muted: boolean): void;
  /** 是否静音 */
  isMuted(): boolean;
  /** 设置播放速度 */
  setPlaybackRate(rate: number): void;
  /** 获取播放速度 */
  getPlaybackRate(): number;
  /** 设置单曲循环 */
  setLoop(loop: boolean): void;
  /** 设置播放模式 */
  setPlayMode(mode: PlayMode): void;

  // ===== 显示模式 =====
  /** 切换全屏 */
  toggleFullscreen(): Promise<void>;
  /** 进入全屏 */
  enterFullscreen(): Promise<void>;
  /** 退出全屏 */
  exitFullscreen(): Promise<void>;
  /** 是否全屏 */
  isFullscreen(): boolean;
  /** 切换画中画 */
  togglePip(): Promise<void>;
  /** 进入画中画 */
  enterPip(): Promise<void>;
  /** 退出画中画 */
  exitPip(): Promise<void>;
  /** 切换网页全屏 */
  toggleWebFullscreen(): void;
  /** 是否网页全屏 */
  isWebFullscreen(): boolean;
  /**
   * 切换宽屏
   *
   * 宽屏布局由播放器外部容器决定：播放器只切换内部宽屏状态并广播
   * `wideScreenChange`（回调参数为是否宽屏布尔值），外部监听后自行
   * 调整容器布局；播放器内部仅同步宽屏按钮 / 图标状态。
   */
  toggleWideScreen(): void;
  /**
   * 设置宽屏状态（外部容器驱动的布局开关）
   * @param isWide - 是否进入宽屏
   */
  setWideScreen(isWide: boolean): void;
  /** 是否处于宽屏状态 */
  isWideScreen(): boolean;
  /**
   * 设置是否禁用容器阴影
   *
   * 通过在 .nova-player-container 上添加 / 移除 state-disable-box-shadow
   * 类名实现：添加后禁用外阴影，移除后恢复默认阴影。
   * 同时写回配置，`getConfig` 可读到最新值。
   * @param disabled - 是否禁用阴影
   */
  setBoxShadowDisabled(disabled: boolean): void;
  /** 是否已禁用容器阴影 */
  isBoxShadowDisabled(): boolean;
  /**
   * 设置显示模式（normal / web / mini 会改播放器内部布局；
   * `wide` 只更新宽屏状态并广播 `wideScreenChange`，布局交给外部容器）
   */
  setDisplayMode(mode: DisplayMode): void;
  /** 重新计算尺寸 */
  resize(): void;

  // ===== 清晰度 =====
  /** 切换画质（档位 id，'auto' 表示自动档） */
  setQuality(quality: string): void;
  /** 获取当前档位 id */
  getCurrentQuality(): string;
  /** 获取可用档位列表 */
  getQualities(): QualityLevel[];
  /** 获取清晰度能力类型 */
  getQualityMode(): "none" | "static" | "adaptive";
  /** 设置清晰度模式（自动 / 手动） */
  setQualityMode(mode: QualityMode): void;
  /** 应用清晰度上下限 */
  applyQualityLimits(limits: { max?: number; min?: number }): void;

  // ===== 媒体加载与播放列表 =====
  /** 换源加载（复用同一 video 元素与 DOM） */
  load(
    source: PlayerSource,
    options?: { startTime?: number; autoplay?: boolean },
  ): Promise<void>;
  /** 播放列表内跳转到指定索引 */
  switchTo(index: number): Promise<void>;
  /** 播放下一个 */
  next(): Promise<void>;
  /** 播放上一个 */
  prev(): Promise<void>;
  /** 获取播放列表 */
  getPlaylist(): readonly MediaItem[];
  /** 获取当前条目索引 */
  getCurrentIndex(): number;
  /** 设置封面 */
  setPoster(url: string): void;

  // ===== 弹幕 =====
  /** 设置弹幕可见性 */
  setDanmakuVisible(visible: boolean): void;
  /** 切换弹幕可见性，返回切换后的状态 */
  toggleDanmaku(): boolean;
  /** 弹幕是否可见 */
  isDanmakuVisible(): boolean;
  /** 设置弹幕不透明度 */
  setDanmakuOpacity(opacity: number): void;
  /** 设置弹幕速度倍率 */
  setDanmakuSpeed(
    speed: number,
  ): void; /** 全量替换弹幕数据（外部请求后注入；播放器/插件不发请求） */
  loadDanmaku(list: readonly DanmakuItem[]): void;
  /** 追加单条弹幕 */
  addDanmaku(item: DanmakuItem): void;
  /** 更新单条弹幕 */
  updateDanmaku(id: DanmakuItem["id"], patch: Partial<DanmakuItem>): void;
  /** 删除单条弹幕 */
  removeDanmaku(id: DanmakuItem["id"]): void;
  /** 获取弹幕数据副本 */
  getDanmakuList(): DanmakuItem[];
  /** 挂载弹幕列表面板（必须显式传挂载点） */
  mountDanmakuList(target: string | HTMLElement): void;
  /** 卸载弹幕列表面板 */
  unmountDanmakuList(): void;
  /** 清空弹幕 */
  clearDanmaku(): void;
  /** 发送弹幕 */
  sendDanmaku(text: string, options?: Record<string, unknown>): void;

  // ===== 发送栏互动计数 =====
  /** 更新在线观看人数（服务端实时数据；发送栏「人正在看」响应式刷新） */
  setOnlineCount(count: number): void;
  /** 读取在线观看人数 */
  getOnlineCount(): number;
  /** 更新弹幕总条数（服务端实时数据，绝对值覆盖本地累计） */
  setDanmakuCount(count: number): void;
  /** 读取弹幕总条数 */
  getDanmakuCount(): number;
  /** 弹幕条数自增（本地发送成功后播放器自动调用；也可由外部按增量同步） */
  incrementDanmakuCount(delta?: number): void;

  // ===== 字幕 =====
  /** 设置字幕可见性 */
  setSubtitleVisible(visible: boolean): void;
  /** 切换字幕可见性，返回切换后的状态 */
  toggleSubtitle(): boolean;
  /** 设置字幕语言 */
  setSubtitleLang(lang: string): void;
  /** 设置字幕轨道列表 */
  setSubtitleList(list: SubtitleConfig[]): void;

  // ===== 状态查询 =====
  /** 获取播放器状态快照 */
  getState(): PlayerStateData;
  /** 获取当前时间（秒） */
  getCurrentTime(): number;
  /** 获取总时长（秒） */
  getDuration(): number;
  /** 获取缓冲进度（秒） */
  getBuffered(): number;
  /** 是否暂停中 */
  isPaused(): boolean;
  /** 是否正在播放 */
  isPlaying(): boolean;

  // ===== 配置 =====
  /** 读取当前生效配置 */
  getConfig(): Readonly<PlayerConfig>;
  /** 动态更新配置（深合并并立即生效） */
  setConfig(partial: DeepPartial<PlayerConfig>): void;

  // ===== 生命周期与插件 =====
  /** 挂载到容器 */
  mount(container: HTMLElement): void;
  /** 取客户端渲染 VNode */
  render(): VNode;
  /** 安装插件（可链式） */
  use(plugin: Plugin): PlayerMethods;
  /** 动态注册插件（UI 响应式自动挂载） */
  registerPlugin(plugin: Plugin): PlayerMethods;
  /** 动态卸载插件（UI 响应式自动移除） */
  unregisterPlugin(name: string): void;
  /** 是否已注册插件 */
  hasPlugin(name: string): boolean;
  /** 卸载插件 */
  uninstallPlugin(name: string): void;
  /** 按名字取插件实例 */
  getPlugin<T extends Plugin>(name: string): T | undefined;
  /** 按名字取插件向播放器暴露的 API */
  getPluginAPI<T extends Plugin>(name: string): T | undefined;
  /** 销毁播放器 */
  destroy(): void;

  // ===== 事件订阅 =====
  /** 注册事件监听，返回取消订阅函数 */
  on<K extends keyof PlayerEvents>(
    event: K,
    callback: PlayerEvents[K],
  ): () => void;
  /** 注册只触发一次的监听，返回取消订阅函数 */
  once<K extends keyof PlayerEvents>(
    event: K,
    callback: PlayerEvents[K],
  ): () => void;
  /** 移除事件监听 */
  off<K extends keyof PlayerEvents>(event: K, callback: PlayerEvents[K]): void;
}

