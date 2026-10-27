/**
 * ============================================
 * 弹幕类型定义
 * ============================================
 * 弹幕契约的唯一权威来源（纯类型定义，零运行时依赖）：
 * - 外部开发者与弹幕插件交互的所有公共类型（DanmakuItem / 枚举 / Provider / 遮罩）
 * - player 与 plugins 包均从此导入；引擎内部实现类型见 utils/danmaku/types.ts
 *
 * @module types/danmaku
 */

/** 弹幕类型 */
export enum DanmakuType {
  /** 滚动弹幕 */
  SCROLL = 1,
  /** 顶部固定 */
  TOP = 2,
  /** 底部固定 */
  BOTTOM = 3,
  /** 高级弹幕 */
  ADVANCED = 4,
}

/** 弹幕速度档位 - 5档 */
export enum DanmakuSpeed {
  /** 极慢 - 0.5倍速 */
  VERY_SLOW = 1,
  /** 较慢 - 0.75倍速 */
  SLOW = 2,
  /** 适中 - 1.0倍速（默认） */
  NORMAL = 3,
  /** 较快 - 1.5倍速 */
  FAST = 4,
  /** 极快 - 2.0倍速 */
  VERY_FAST = 5,
}

/** 弹幕字号档位 */
export enum DanmakuFontSize {
  /** 小字号 */
  SMALL = 0.8,
  /** 标准字号（默认） */
  NORMAL = 1.0,
}

/** 弹幕区域档位 - 4档 */
export enum DanmakuArea {
  /** 25% - 仅顶部区域 */
  QUARTER = 0.25,
  /** 50% - 上半区域 */
  HALF = 0.5,
  /** 75% - 大部分区域 */
  THREE_QUARTERS = 0.75,
  /** 100% - 全屏 */
  FULL = 1,
}

/** 渲染模式 */
export enum RenderMode {
  /** DOM渲染 - 适合少量弹幕 */
  DOM = "dom",
  /** Canvas渲染 - 适合大量弹幕 */
  CANVAS = "canvas",
  /** 自动模式 - 根据弹幕数量自动切换 */
  AUTO = "auto",
}

/** 屏幕状态 */
export enum ScreenMode {
  /** 正常模式 */
  NORMAL = "normal",
  /** 全屏模式 */
  FULLSCREEN = "fullscreen",
  /** 网页全屏 */
  WEB_FULLSCREEN = "webFullscreen",
}

/** 弹幕过滤器设置 */
export interface DanmakuFilter {
  /** 过滤滚动弹幕 */
  scroll?: boolean;
  /** 过滤固定弹幕（顶部+底部） */
  fixed?: boolean;
  /** 过滤彩色弹幕（非白色） */
  colorful?: boolean;
}

/** 弹幕位置（发送栏弹幕类型选择的字符串标识） */
export enum DanmakuPosition {
  /** 滚动 */
  SCROLL = "scroll",
  /** 顶部 */
  TOP = "top",
  /** 底部 */
  BOTTOM = "bottom",
}

/** 防挡遮罩配置 */
export interface DanmakuMaskConfig {
  /** 是否启用防挡 */
  enabled?: boolean;
  /** 遮罩图片URL（镂空PNG） */
  maskImage?: string;
  /** 遮罩图片元素（已预加载时直接传入） */
  maskImageElement?: HTMLImageElement;
  /** 视频在容器中的位置（用于对齐遮罩） */
  videoRect?: { x: number; y: number; width: number; height: number };
  /** 遮罩获取函数（外部自定义实现，可以是后端请求） */
  maskLoader?: MaskLoader;
  /** 遮罩更新间隔（毫秒），默认 1000ms */
  updateInterval?: number;
  /** 获取当前视频时间的回调函数（引擎内部注入，外部无需关心） */
  getCurrentTime?: () => number;
}

/**
 * 遮罩获取函数类型（防挡 Provider）
 *
 * 每次更新周期调用一次，返回下一时刻的人形镂空遮罩；
 * 返回 null 表示该时间没有遮罩（不应用 mask CSS）。
 * 遮罩图片应与视频画面比例一致，引擎按 object-fit: contain 自适应居中。
 */
export type MaskLoader = (
  currentTime: number,
) => Promise<MaskLoaderResult | null>;

/** 遮罩获取结果（黑色 = 可显示弹幕，透明 = 避让区域） */
export interface MaskLoaderResult {
  /** 遮罩图片URL（镂空PNG） */
  maskImage: string;
  /** 可选：遮罩图片元素（如果已预加载） */
  maskImageElement?: HTMLImageElement;
  /** 遮罩图片的原始宽度（用于比例计算） */
  originalWidth?: number;
  /** 遮罩图片的原始高度（用于比例计算） */
  originalHeight?: number;
  /** 置 true 时清除当前遮罩（例如该帧没有人物） */
  clearMask?: boolean;
}

/** 单条弹幕数据结构 */
export interface DanmakuItem {
  /** 唯一ID */
  id: string | number;
  /** 弹幕内容 */
  text: string;
  /** 出现时间 (秒) */
  time: number;
  /** 弹幕类型 */
  type: DanmakuType;
  /** 字体大小 */
  fontSize?: number;
  /** 字体颜色 */
  color?: string;
  /** 发送者ID */
  userId?: string;
  /** 发送者名称 */
  userName?: string;
  /** 是否会员 */
  isVip?: boolean;
  /** 弹幕权重 (用于优先级) */
  weight?: number;
  /** 弹幕速度档位 */
  speed?: DanmakuSpeed;
  /** 发送者UID */
  uid?:
    string | number; /** 点赞数（Tip 操作条展示；点赞/取消点赞后由插件维护） */
  like?: number;
  /**
   * 发送时间戳（Unix 毫秒）
   *
   * 数据源（B 站 XML 的 p[4]）或本地发送时写入；弹幕列表「发送时间」列与
   * 历史弹幕日期筛选使用。缺省时回落为「id 为毫秒时间戳则取 id」。
   */
  sentAt?: number;
}

/** 弹幕配置选项（创建 DanmakuManager 的完整参数） */
export interface DanmakuOptions {
  /** 容器元素 */
  container: HTMLElement;
  /** 视频元素 */
  video: HTMLVideoElement;
  /** 渲染模式 */
  renderMode?: RenderMode;
  /** 弹幕透明度 (0-1) */
  opacity?: number;
  /** 弹幕速度档位（连续倍率由 speedMultiplier 承担） */
  speed?: DanmakuSpeed;
  /**
   * 速度倍率（连续值，优先于 speed 档位）
   * 1.0 = 基准速度；0.5 = 半速；2.0 = 两倍速
   */
  speedMultiplier?: number;
  /** 弹幕区域占比 (0-1 连续值，也可传 DanmakuArea 档位) */
  area?: number;
  /** 字体大小（像素） */
  fontSize?: number;
  /** 字体大小档位 */
  fontSizeScale?: DanmakuFontSize;
  /** 是否自动随屏幕大小缩放弹幕 (默认true) */
  autoScale?: boolean;
  /** 是否显示弹幕 */
  visible?: boolean;
  /** 弹幕密度 (0-1) */
  density?: number;
  /** 是否防遮挡 */
  preventOverlap?: boolean;
  /** 轨道高度 (px) */
  trackHeight?: number;
  /** 分段时长 (秒) */
  segmentDuration?: number;
  /** 预加载分段数 */
  preloadSegments?: number;
  /** 最大同时渲染弹幕数 */
  maxRenderCount?: number;
  /** 是否开启硬件加速 */
  hardwareAcceleration?: boolean;
  /** 是否显示高级弹幕 */
  showAdvanced?: boolean;
  /** 是否合并相同弹幕 */
  mergeSame?: boolean;
  /** 弹幕过滤器 */
  filter?: DanmakuFilter;
}

/**
 * 弹幕悬停快照 — 弹幕进入/离开画面回调（DanmakuCallbacks.onEnter/onLeave）的载荷
 *
 * 注意：这是面向外部回调的只读快照契约；
 * 引擎内部渲染状态（x/y/width/track 等）见 utils/danmaku/types.ts 的扩展版 DanmakuRenderItem。
 */
export interface DanmakuRenderItem {
  /** 渲染ID */
  renderId: string;
  /** 原始弹幕数据 */
  item: DanmakuItem;
  /** 轨道索引 */
  trackIndex: number;
  /** 开始渲染时间戳 */
  startTime: number;
  /** 持续时间 (毫秒) */
  duration: number;
  /** DOM 元素 (DOM 模式) */
  element?: HTMLElement;
}

/** 弹幕分段 — 增量加载用 */
export interface DanmakuSegment {
  /** 分段索引 */
  index: number;
  /** 开始时间 (秒) */
  startTime: number;
  /** 结束时间 (秒) */
  endTime: number;
  /** 是否已加载 */
  loaded: boolean;
  /** 弹幕列表 */
  danmakuList: DanmakuItem[];
}

/** 性能统计 */
export interface PerformanceStats {
  /** FPS */
  fps: number;
  /** 渲染弹幕数 */
  renderCount: number;
  /** 对象池使用率 */
  poolUsage?: number;
  /** 内存使用（MB） */
  memoryUsage?: number;
  /** 平均渲染时间 (ms) */
  avgRenderTime?: number;
}

/**
 * ============================================
 * 弹幕数据 Provider（API 化数据获取）
 * ============================================
 * 与 ProgressPreviewProvider / EnergyProgressProvider 同一模式：
 * 数据获取逻辑（接口请求 / 本地过滤 / 分片缓存）全部由外部实现，
 * 播放器内部只按时间窗分段调用，不做任何内置 fetch。
 */

/**
 * 弹幕列表提供者
 *
 * 播放过程中按 30 秒时间窗分段调用（含预加载），外部返回该时间窗内的弹幕。
 * - 同步返回：数组或 null（该时间窗无弹幕）
 * - 异步返回：Promise 解析为数组或 null
 * 返回的列表无需排序（内部调度器会按 time 排序并应用密度限制）。
 */
export type DanmakuListProvider = (
  startTime: number,
  endTime: number,
) => DanmakuItem[] | Promise<DanmakuItem[]> | null;

/**
 * 弹幕发送确认提供者
 *
 * 语义：调用方（如弹幕设置面板）提交弹幕后，先经外部确认（服务器校验 / 落库），
 * 返回确认后的弹幕（通常回填服务端 id）才会上屏；抛错则不上屏并走失败回调。
 * 类型与 DanmakuCallbacks.onSend 一致，此处独立命名便于配置空间引用。
 */
export type DanmakuSendProvider = (
  danmaku: DanmakuItem,
) => Promise<DanmakuItem>;
