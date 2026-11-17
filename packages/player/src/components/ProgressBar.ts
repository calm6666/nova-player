import { h, defineComponent, useTemplateRef, useContext, signal, For, t } from '@lumina/framework/core';
import { useComponentUnmount } from "../core/componentUnmount";
import { ConfigStoreContext, type ConfigStore } from "../store/configStore";
import type { AnimationItem } from "lottie-web";
import type {
  ProgressThumbAnimationSource,
  ProgressThumbIconConfig,
} from "../types/player";
import thumbFallbackData from "../assets/lottie-icon/progress-thumb-fallback.json";
import pullIndicatorData from "../assets/lottie-icon/progress-pull-indicator.json";
import { normalizeSegmentSpan } from "../utils/media/progressSegment";
import type { VNode } from "@lumina/framework/types";
import type { ProgressPreviewFrame, ProgressPreviewProvider, ProgressSegment, ProgressSkipPoints } from "../types/player";

import { isBrowser } from '@lumina/framework/utils';
import { formatTime } from '@lumina/framework/utils/formatTime';
import { createLogger } from '@lumina/framework/utils';
import { isDev } from '@lumina/framework/core/warning';

/** 进度条组件日志（仅 error 级别的异常 / 非法配置诊断） */
const logger = createLogger("ProgressBar");

/** lottie-web 模块类型（动态导入后缓存，避免每个实例重复拉取） */
type ProgressLottie = typeof import("lottie-web").default;

let progressLottiePromise: Promise<ProgressLottie> | null = null;

/** 懒加载 lottie-web：与播放器其余图标共用同一模块缓存 */
function loadProgressLottie(): Promise<ProgressLottie> {
  if (progressLottiePromise === null) {
    progressLottiePromise = import("lottie-web").then((mod) => mod.default);
  }
  return progressLottiePromise;
}

/** 自定义 thumb 动画 JSON 缓存：同一 URL 只请求一次 */
const thumbDataCache = new Map<string, Promise<Record<string, unknown>>>();

/** 按 URL 拉取 thumb 动画 JSON（失败时从缓存移除，允许下次重试） */
function loadThumbData(url: string): Promise<Record<string, unknown>> {
  const cached = thumbDataCache.get(url);
  if (cached !== undefined) return cached;
  const promise = fetch(url).then(async (response) => {
    if (!response.ok) {
      throw new Error(`thumb icon fetch failed: ${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
  });
  thumbDataCache.set(url, promise);
  promise.catch(() => thumbDataCache.delete(url));
  return promise;
}

/** 动画常态停帧：描述优先，其次实际总帧数的一半 */
function resolveIdleFrame(
  source: ProgressThumbAnimationSource | undefined,
  totalFrames: number,
): number {
  if (source?.idleFrame !== undefined) return source.idleFrame;
  if (source?.totalFrames !== undefined) {
    return Math.floor(source.totalFrames / 2);
  }
  return Math.floor(totalFrames / 2);
}

/**
 * 计算单个分段在当前时间下的填充比例（纯函数，便于单元测试）
 *
 * 语义：某个分段只表示它自身 [startTime, endTime] 区间内的进度，
 * 因此同一时刻各分段的填充比例不同，未进入区间时为 0，走完后为 1。
 *
 * @param time - 当前时间（秒）
 * @param startTime - 分段起始时间（秒）
 * @param endTime - 分段结束时间（秒）
 * @returns 0-1 之间的比例；区间非法（endTime <= startTime）时返回 0，避免除零得到 NaN/Infinity
 */
export const computeSegmentRatio = (
  time: number,
  startTime: number,
  endTime: number,
): number => {
  // 脏分段（时段为 0 或倒挂）直接返回 0，防止 (time - start) / 0 产生 NaN/Infinity
  if (endTime <= startTime) return 0;
  if (time <= startTime) return 0;
  if (time >= endTime) return 1;
  return (time - startTime) / (endTime - startTime);
};

/**
 * 计算单个分段的缓冲比例
 *
 * 播放头所在分段直接按缓冲时间点求比例；播放头之前的分段已整段缓冲，返回 1；
 * 播放头之后的分段尚未触达，返回 0。这样缓冲条只会出现在播放头附近，
 * 不会因为「整段被缓冲」而在每段都画出一条满格缓冲条。
 *
 * @param buffer - 已缓冲到的时间（秒）
 * @param startTime - 分段起始时间（秒）
 * @param endTime - 分段结束时间（秒）
 * @param currentTime - 当前播放时间（秒）
 * @returns 0-1 之间的比例
 */
export const computeSegmentBufferRatio = (
  buffer: number,
  startTime: number,
  endTime: number,
  currentTime: number,
): number => {
  if (endTime <= startTime) return 0;
  if (!Number.isFinite(buffer)) return 0;
  if (currentTime >= endTime) return 1;
  if (currentTime < startTime && buffer < startTime) return 0;
  return computeSegmentRatio(buffer, startTime, endTime);
};

export interface ProgressBarProps {
  duration: number;
  progressSegments?: Array<ProgressSegment>;
  /**
   * 预览图提供者（progress.previewProvider 配置注入）
   *
   * 悬停时按「悬停时间 + 总时长」询问外部预览帧，支持同步或异步（Promise）返回；
   * 数据获取逻辑（雪碧图裁切 / 逐帧 URL / 服务端接口）完全由外部实现。
   */
  previewProvider?: ProgressPreviewProvider;
  /** 片头 / 片尾跳过断点（外部数据源提供，渲染进度条圆点） */
  skipPoints?: ProgressSkipPoints;
}

/**
 * ProgressBar 挂载后向上层暴露的更新 API
 */
export interface ProgressBarApi {
  /** 更新已播放进度 */
  updateProgress: (time: number) => void;
  /** 更新缓冲进度 */
  updateBuffer: (buffer: number) => void;
  /** 更新视频总时长（元数据加载后由上层回传） */
  setDuration: (duration: number) => void;
  /** 重建进度条分段（progress.segments 运行时变化时由上层调用） */
  rebuildSegments: (segments?: ProgressSegment[]) => void;
}

export type ProgressBarEvents = {
  seek: number;
  seekStart: undefined;
  seekEnd: undefined;
  progressBarMounted: ProgressBarApi;
};

type ProgressStrategy = (
  vp: ProgressSegment,
  duration: number,
) => {
  left: string;
  width: string;
  marginRight?: string;
};

/**
 * 分段几何计算策略
 *
 * 与参考实现 `controls/index.ts` 的 strategies 一致：
 * - first：left 固定 0%，右侧留 0.15% 缺口 + 0.3% 间隔
 * - last：左侧让出 0.15% 缺口，右侧不留间隔
 * - default：两侧各让出 0.15% 缺口，右侧留 0.3% 间隔
 */
const strategies: Record<"first" | "last" | "default", ProgressStrategy> = {
  first: (vp, duration) => ({
    left: "0%",
    width: `${((vp.endTime - vp.startTime) / duration) * 100 - 0.15}%`,
    marginRight: "0.3%",
  }),
  last: (vp, duration) => ({
    left: `${(vp.startTime / duration) * 100 + 0.15}%`,
    width: `${((vp.endTime - vp.startTime) / duration) * 100 - 0.15}%`,
  }),
  default: (vp, duration) => ({
    left: `${(vp.startTime / duration) * 100 + 0.15}%`,
    width: `${((vp.endTime - vp.startTime) / duration) * 100 - 0.3}%`,
    marginRight: "0.3%",
  }),
};

/**
 * 计算单个分段的几何盒子（底部影子进度条与本进度条共用，保证两条完全对齐）
 *
 * @param segment - 分段数据
 * @param index - 分段下标
 * @param total - 分段总数
 * @param duration - 视频总时长（秒）
 * @returns left / width / marginRight 三个内联样式值
 */
export function computeSegmentBox(
  segment: ProgressSegment,
  index: number,
  total: number,
  duration: number,
): { left: string; width: string; marginRight?: string } {
  const strategy =
    index === 0 ? "first" : index === total - 1 ? "last" : "default";
  return strategies[strategy](segment, duration);
}

/**
 * 单条整轴占位项
 *
 * 分段数量 <= 1 时 For 渲染一个无 hover / 无 padding 的整轴进度条
 * （与旧实现 createSegmentVNodes 的单条分支行为一致）。
 */
const SINGLE_BAR = Symbol("nova-progress-single-bar");

/** For 列表项类型：真实分段或单条整轴占位 */
type SegmentItem = ProgressSegment | typeof SINGLE_BAR;

/**
 * 运行时类型谓词：For 控制流的回调入参为 unknown（For 的 props 为
 * Record<string, unknown>，类型信息在回调边界丢失），
 * 用谓词收窄替代 as 断言
 */
const isProgressSegment = (item: unknown): item is ProgressSegment =>
  typeof item === "object" &&
  item !== null &&
  "startTime" in item &&
  typeof item.startTime === "number" &&
  "endTime" in item &&
  typeof item.endTime === "number";

export const ProgressBar = defineComponent<ProgressBarProps, ProgressBarEvents>(
  (props, lifecycle) => {
    /** 初始分段：仅用于信号初始化，后续经 rebuildSegments API 更新 */
    const initialSegments = props.progressSegments;

    // ============================================
    // 响应式 Signal（渲染层唯一数据源）
    // ============================================

    /**
     * 视频总时长信号（秒）
     *
     * 初值取自 props，元数据加载后经 setDuration API 写入。
     * 所有几何计算（分段 left/width、分钟刻度位置与数量）都依赖本信号，
     * 时长到手瞬间由响应式系统自动补齐，不再依赖事件时序。
     */
    const durationSignal = signal<number>(props.duration);

    /**
     * 分段列表信号（初值为 props 快照，运行时经 rebuildSegments 整体替换）
     * For 控制流按 key diff 自动同步 DOM，替代手动 mount/destroy 簿记
     */
    const segmentsSignal = signal<ProgressSegment[]>(initialSegments ?? []);

    /** 悬停位置对应的时间（秒），驱动预览弹窗的时间文本（响应式 _reactiveText） */
    const hoverTimeSignal = signal<number>(0);

    /** 预览弹窗显隐信号：驱动 .nova-player-progress-wrap 的 state-active 类 */
    const popupActiveSignal = signal<boolean>(false);

    /** 预览缩略图 src 信号：驱动 <img src> */
    const previewSrcSignal = signal<string | undefined>(undefined);

    /** 预览缩略图 width 样式信号 */
    const previewWidthSignal = signal<string>("");
    /** 预览缩略图 height 样式信号 */
    const previewHeightSignal = signal<string>("");
    /** 预览缩略图 objectFit 样式信号 */
    const previewObjectFitSignal = signal<string>("");
    /** 预览缩略图 objectPosition 样式信号 */
    const previewObjectPositionSignal = signal<string>("");

    /** 预览弹窗分段名称信号：驱动 hotspot 文本 */
    const hotspotTextSignal = signal<string>("");

    /** 当前悬停的分段下标信号：驱动各分段 hover 类 */
    const hoveredSegIdxSignal = signal<number>(-1);

    /**
     * 分段列表的稳定身份 = 位置下标
     *
     * For 的 key 只取下标（见主渲染处）：同样数量的分段重建时 key 不变，
     * 节点被复用、只在原节点上更新几何/内容；增删只发生在尾部。
     * 不再使用自增 generation —— 它让每次重建的 key 全变，退化为全量重挂，
     * 复用与函数 ref 缓存都会失效。
     */

    // ============================================
    // DOM 引用（模板 ref + For render 的函数 ref）
    // ============================================

    /** 进度条区域容器元素引用 */
    const progressAreaRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "progressAreaRef",
    );

    /** 预览弹窗元素引用（逐帧命令式定位 left） */
    const popupRef = useTemplateRef<HTMLDivElement>(lifecycle, "popupRef");

    /** 移动指示器元素引用（逐帧命令式定位 translateX） */
    const moveIndicatorRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "moveIndicatorRef",
    );

    /** 光标元素引用（逐帧命令式定位 left） */
    const cursorRef = useTemplateRef<HTMLDivElement>(lifecycle, "cursorRef");

    /** 拖拽滑块元素引用（逐帧命令式定位 translateX） */
    const thumbRef = useTemplateRef<HTMLDivElement>(lifecycle, "thumbRef");

    /** 轨道元素引用（精度模式上拉时改高度） */
    const trackRef = useTemplateRef<HTMLDivElement>(lifecycle, "progressTrackRef");

    /** 精度模式上拉指示器元素引用（与 thumb 同步 translateX） */
    const pullIndicatorRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "pullIndicatorRef",
    );

    /** thumb 图标容器（lottie 的 drag / drop DOM 动态挂入） */
    const thumbIconRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "thumbIconRef",
    );

    /** 精度模式状态：驱动 state-pulling 类（thumb 隐藏 / cursor 显示） */
    const pullingSignal = signal(false);

    /** 自定义 thumb 配置：来自 ConfigStore 的 progress.thumbIcon，运行时可变 */
    const configStore = useContext<ConfigStore | null>(ConfigStoreContext);
    const thumbConfigSignal = signal<ProgressThumbIconConfig | undefined>(
      configStore?.getPath<ProgressThumbIconConfig>("progress.thumbIcon"),
    );

    // ============================================
    // 状态（仅命令式路径使用，无声明式消费者）
    // ============================================

    /** 当前播放时间（秒），用于把缓冲条限定在播放头所在的分段 */
    let currentTime = 0;

    /** 是否正在拖拽 */
    let isDragging = false;

    /** 悬停显示预览弹窗的延迟定时器 ID（与既有实现 mouseEnter 的 300ms 延迟一致） */
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;

    /** 拖拽时的鼠标移动处理函数引用 */
    let dragMouseMove: ((e: MouseEvent) => void) | null = null;

    /** 拖拽时的鼠标释放处理函数引用 */
    let dragMouseUp: ((e: MouseEvent) => void) | null = null;

    /** 是否已提示过非法分段，避免每次 timeupdate 重复打印 */
    let hasWarnedInvalidSegment = false;

    /** 预览帧请求序号（异步 provider 竞态保护：仅应用最新一次悬停请求的结果） */
    let previewRequestId = 0;

    /** 精度模式：拖拽开始时记录的轨道基准高度 */
    let trackBaseHeight = 0;
    /** 精度模式是否已进入（驱动 state-pulling 与拖拽映射） */
    let pullingActive = false;
    /** 精度模式局部时间窗口（按上拉比例收窄） */
    let precisionLeftTime = 0;
    let precisionRightTime = 0;
    /** 拖拽起点百分比与 thumb 方向（demo 同款状态） */
    let startPercentage = 0;
    let thumbDirection = 0;
    let thumbClientX = 0;
    /** 当前上拉倍数（demo 的 ratioY） */
    let pullRatio = 1;

    /** thumb 拖拽 / 落点双动画与精度模式上拉动画 */
    let dragAnim: AnimationItem | null = null;
    let dropAnim: AnimationItem | null = null;
    let pullAnim: AnimationItem | null = null;
    let thumbDragDom: HTMLDivElement | null = null;
    let thumbDropDom: HTMLDivElement | null = null;
    /** thumb 尺寸、方向策略与自定义落点参数 */
    let thumbSize = 20;
    let dragDirection: "follow" | "fixed" = "follow";
    let hasCustomDrop = false;
    let dragIdleFrame = 0;
    let dropIdleFrame = 0;
    let dropDelayMs = 0;
    let dropResetTimer: ReturnType<typeof setTimeout> | null = null;
    let offThumbConfig: (() => void) | null = null;
    /** 拖拽期间收到配置更新：等松手后再重建，避免动画中途被销毁 */
    let pendingThumbRebuild = false;

    // ============================================
    // DOM 引用缓存（For render 的函数 ref 收集，零 querySelectorAll）
    // ============================================

    /**
     * 各分段缓冲条 DOM 引用缓存
     * 由 For render 内的函数 ref 按下标写入，updateBufferFills 直接读缓存写 scaleX
     */
    let segmentBufferRefs: Array<HTMLDivElement | null> = [];

    /**
     * 各分段已播放条 DOM 引用缓存
     * 由 For render 内的函数 ref 按下标写入，updateSegmentFills 直接读缓存写 scaleX
     */
    let segmentCurrentRefs: Array<HTMLDivElement | null> = [];

    /**
     * 各段上次已播放填充比例（钳制后的 0-1），用于 updateSegmentFills 去重
     * 比例未变时跳过 transform 写入，避免无意义的样式抖动。
     */
    let lastFillRatios: number[] = [];

    /** 各段上次缓冲填充比例（钳制后的 0-1），用于 updateBufferFills 去重 */
    let lastBufferRatios: number[] = [];

    /**
     * 按当前分段数量同步 DOM 引用缓存长度
     *
     * refs 是「位置缓存」：For 的 key 就是下标，节点按位置复用，函数 ref 只在
     * 节点创建时写一次对应下标。因此这里只截断尾部多余项，不能置空重建——
     * 置空后复用节点不会再触发函数 ref，数组会永远为空（进度填充一帧都不写）。
     * 节点销毁时框架的 clearRef 不处理函数 ref，不会回调清理，所以必须在这里
     * 主动把长度裁到当前节点数，避免继续攥着已销毁的 DOM。
     */
    const syncRefs = (): void => {
      // 0 段 / 1 段时渲染的是单条整轴（SINGLE_BAR），节点数恒为 1
      const length = Math.max(1, segmentsSignal.value.length);
      segmentBufferRefs.length = length;
      segmentCurrentRefs.length = length;
    };

    /**
     * 分段填充条的引用回调工厂
     *
     * 创建/水合时以元素回调一次写入对应下标；销毁时框架以 `null` 回调
     * （见 framework clearRef），这里按槽位清理，避免攥着已销毁的 DOM。
     * 仅当槽位仍是被销毁的那个节点时才清空：同一位置若已新建节点并先写入，
     * 旧节点的清理不能把它覆盖掉。
     * @param cache - 目标引用缓存（缓冲条 / 已播放条）
     * @param index - 分段位置下标
     */
    const fillRef =
      (cache: Array<HTMLDivElement | null>, index: number) =>
      (el: Element | null, vnode?: { el?: Element | null }): void => {
        if (el instanceof HTMLDivElement) {
          cache[index] = el;
          return;
        }
        const dying = vnode?.el ?? null;
        if (!cache[index] || cache[index] === dying) cache[index] = null;
      };

    // ============================================
    // 辅助函数
    // ============================================

    /**
     * 根据鼠标位置计算时间
     * @param clientX - 鼠标 X 坐标
     * @returns 对应的时间（秒）
     */
    const getTimeFromX = (clientX: number): number => {
      if (!progressAreaRef.value || durationSignal.value <= 0) return 0;
      /** 进度条区域的边界矩形 */
      const rect = progressAreaRef.value.getBoundingClientRect();
      /** 鼠标位置在进度条上的比例 (0-1) */
      const ratio = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width),
      );
      return ratio * durationSignal.value;
    };

    /** 根据鼠标位置计算整条进度条上的百分比（0-1） */
    const getPercentageFromX = (clientX: number): number => {
      if (!progressAreaRef.value) return 0;
      const rect = progressAreaRef.value.getBoundingClientRect();
      return Math.max(
        0,
        Math.min(1, (clientX - rect.left) / (rect.width || 1)),
      );
    };

    /**
     * 解析当前生效的分段区间列表
     * - 多分段（length > 1）：直接使用各分段自身的 [startTime, endTime]，逐段独立计算进度
     * - 单分段 / 无分段：整条进度条视作一个 [0, duration] 分段，退化为整体比例
     * @returns 用于逐段计算的比例区间列表
     */
    const resolveSegments = (): Array<
      Pick<ProgressSegment, "startTime" | "endTime">
    > => {
      const list = segmentsSignal.value;
      const dur = durationSignal.value;
      if (list.length > 1) return normalizeSegmentSpan(list, dur);
      return [{ startTime: 0, endTime: dur }];
    };

    /**
     * 开发环境提示一次非法分段（endTime <= startTime），生产环境静默
     */
    const warnInvalidSegment = (): void => {
      if (hasWarnedInvalidSegment || !isDev()) return;
      hasWarnedInvalidSegment = true;
      logger.error(
        "[ProgressBar] 检测到非法分段（endTime <= startTime），已跳过该分段的进度渲染",
      );
    };

    /**
     * 按分段逐个更新指定子元素的填充比例
     *
     * 多分段时每个分段只表示自身 [startTime, endTime] 区间内的进度，
     * 因此同一时刻各分段填充比例不同；单分段 / 无分段时整条视作一个分段。
     *
     * 直接读 segmentCurrentRefs/segmentBufferRefs 缓存写入 transform: scaleX，
     * 零 querySelectorAll；与 lastFillRatios[i]/lastBufferRatios[i] 对比，
     * 比例未变 continue，避免无意义样式抖动。
     * @param value - 当前时间或缓冲时间（秒）
     * @param childClass - 需要设置 scaleX 的子元素类名（缓冲条 / 已播放条）
     */
    const updateSegmentFills = (value: number, childClass: string): void => {
      if (!Number.isFinite(value)) return;
      const rangeList = resolveSegments();
      /** 缓存数组与去重数组按 childClass 二选一（已播放条 / 缓冲条） */
      const refs =
        childClass === "nova-player-progress-schedule-buffer"
          ? segmentBufferRefs
          : segmentCurrentRefs;
      const lastRatios =
        childClass === "nova-player-progress-schedule-buffer"
          ? lastBufferRatios
          : lastFillRatios;
      // 以「数据区间」为准遍历：refs 可能尚未收集齐（新节点未创建），
      // 但绝不允许因为 refs 短而整段跳过不写
      for (let i = 0; i < rangeList.length; i += 1) {
        const el = refs[i];
        const range = rangeList[i];
        if (!el || !range) continue;
        // 脏分段（endTime <= startTime）跳过，避免除零产生 NaN/Infinity
        if (range.endTime <= range.startTime) {
          warnInvalidSegment();
          continue;
        }
        /** 该分段自身的填充比例（0-1，钳制） */
        const ratio = computeSegmentRatio(
          value,
          range.startTime,
          range.endTime,
        );
        const clamped = Math.min(Math.max(ratio, 0), 1);
        // 比例未变跳过，避免无意义的 transform 写入
        if (lastRatios[i] === clamped) continue;
        lastRatios[i] = clamped;
        // SCSS 以 transform: scaleX 驱动进度条（transform-origin: 0 0）
        el.style.transform = `scaleX(${clamped})`;
      }
    };

    /**
     * 按分段逐个更新缓冲条填充比例
     * 只有播放头所在的分段按真实缓冲时间填充，播放头之前的分段整段为 1、
     * 之后的分段为 0，避免「每段都画一条满格缓冲条」。
     *
     * 直接读 segmentBufferRefs 缓存写入，零 querySelectorAll；
     * 与 lastBufferRatios[i] 对比去重。
     * @param buffer - 缓冲时间（秒）
     */
    const updateBufferFills = (buffer: number): void => {
      if (!Number.isFinite(buffer)) return;
      const rangeList = resolveSegments();
      const playhead = Number.isFinite(currentTime) ? currentTime : 0;
      for (let i = 0; i < rangeList.length; i += 1) {
        const el = segmentBufferRefs[i];
        const range = rangeList[i];
        if (!el || !range) continue;
        if (range.endTime <= range.startTime) {
          warnInvalidSegment();
          continue;
        }
        const ratio = computeSegmentBufferRatio(
          buffer,
          range.startTime,
          range.endTime,
          playhead,
        );
        const clamped = Math.min(Math.max(ratio, 0), 1);
        if (lastBufferRatios[i] === clamped) continue;
        lastBufferRatios[i] = clamped;
        el.style.transform = `scaleX(${clamped})`;
      }
    };

    /**
     * 更新缓冲条 UI
     * 缓冲条 DOM 引用由 For render 的函数 ref 收集到 segmentBufferRefs，
     * updateBufferFills 直接读缓存写入，零 querySelectorAll；
     * 只有播放头所在的分段按真实缓冲时间填充，之前的分段整段为 1、之后的分段为 0。
     * @param buffer - 缓冲时间（秒）
     */
    const updateBufferUI = (buffer: number): void => {
      if (durationSignal.value <= 0) return;
      updateBufferFills(buffer);
    };

    /**
     * 更新已播放进度 UI（各分段已播放条填充比例 + 拖拽滑块位置）
     * 参照既有实现 updateSegmentedProgress 与 updateThumbPosition
     * @param time - 当前播放时间（秒）
     */
    const updateProgressUI = (time: number): void => {
      // 边界处理：总时长非正时直接返回，避免除零得到 NaN/Infinity
      if (durationSignal.value <= 0) return;

      // 记录播放头，供缓冲条按「播放头所在分段」计算比例
      if (Number.isFinite(time)) currentTime = time;

      // 更新各分段已播放进度条：每段按自身区间独立计算比例
      updateSegmentFills(time, "nova-player-progress-schedule-current");

      // 滑块唯一：按当前时间在整条时间轴上的比例定位（与既有实现 updateThumbPosition 一致）
      // .nova-player-progress-thumb 是 flex 子项、非 position:absolute，故用 translateX 而非 left
      if (thumbRef.value && progressAreaRef.value) {
        /** 滑块的水平偏移量（像素），按整条比例换算并减去滑块自身宽度的一半 */
        const position =
          (time / durationSignal.value) *
            progressAreaRef.value.clientWidth -
          thumbSize / 2;
        thumbRef.value.style.transform = `translateX(${position}px)`;
        // 上拉指示器始终贴在 thumb 上方，使用同一位移
        if (pullIndicatorRef.value) {
          pullIndicatorRef.value.style.transform = `translateX(${position}px)`;
        }
      }
    };

    /**
     * 更新预览弹窗位置和时间（与既有实现 mouseMove 的位置算法一致：
     * 指示器贴边时弹窗随之收敛在可视范围内）
     * @param clientX - 鼠标 X 坐标
     */
    const updatePopup = (clientX: number): void => {
      if (!progressAreaRef.value || !popupRef.value) return;

      /** 进度条区域的边界矩形 */
      const rect = progressAreaRef.value.getBoundingClientRect();
      /** 鼠标位置相对进度条左侧的偏移（像素，钳制在 [0, width]） */
      const indicatorLeft = Math.min(
        Math.max(0, clientX - rect.left + 1),
        rect.width,
      );
      /** 鼠标位置对应的时间（秒）：写入信号驱动预览时间文本自动更新 */
      const hoverTime = (indicatorLeft / rect.width) * durationSignal.value;
      hoverTimeSignal.value = hoverTime;

      // 更新移动指示器位置
      if (moveIndicatorRef.value) {
        moveIndicatorRef.value.style.transform = `translateX(${indicatorLeft}px)`;
      }

      // 更新弹窗位置：贴左 / 贴右时收敛，其余时间居中于指针（与既有实现一致）
      /** 弹窗宽度（与既有实现的 160px 弹窗宽度一致） */
      const popupWidth = 160;
      let left: number;
      if (indicatorLeft <= 80) {
        left = 0;
      } else if (indicatorLeft >= rect.width - 80) {
        left = rect.width - popupWidth;
      } else {
        left = indicatorLeft - 80;
      }
      popupRef.value.style.left = `${left}px`;

      // 分段预览：按悬停时间取对应预览帧，并在弹窗内显示所在分段的名称
      updatePreviewFrame(hoverTime);
      updateHotspotLabel(hoverTime);
    };

    /**
     * 把预览帧应用到响应式信号（驱动 <img> 的 src 与裁切样式）
     *
     * 雪碧图模式帧携带 width/height/objectFit/objectPosition 可选样式字段，
     * 逐帧模式只有 url（样式信号统一清空）。
     * @param frame - 预览帧；null 表示该时间点无预览
     */
    const applyPreviewFrame = (frame: ProgressPreviewFrame | null): void => {
      if (!frame || !frame.url) {
        previewSrcSignal.value = undefined;
        previewWidthSignal.value = "";
        previewHeightSignal.value = "";
        previewObjectFitSignal.value = "";
        previewObjectPositionSignal.value = "";
        return;
      }

      if (previewSrcSignal.value !== frame.url) {
        previewSrcSignal.value = frame.url;
      }
      previewWidthSignal.value = frame.width ?? "";
      previewHeightSignal.value = frame.height ?? "";
      previewObjectFitSignal.value = frame.objectFit ?? "";
      previewObjectPositionSignal.value = frame.objectPosition ?? "";
    };

    /**
     * 更新预览图：经 previewProvider 询问外部预览帧（同步或异步均兼容）
     *
     * 异步 provider 的响应经请求序号校验：悬停期间会连续触发多次请求，
     * 仅应用最新一次的结果，避免慢响应回来后「闪回」旧帧。
     * @param time - 悬停时间（秒）
     */
    const updatePreviewFrame = (time: number): void => {
      const provider = props.previewProvider;
      if (!provider || durationSignal.value <= 0) {
        applyPreviewFrame(null);
        return;
      }

      previewRequestId += 1;
      const requestId = previewRequestId;
      const result = provider(time, durationSignal.value);
      if (result instanceof Promise) {
        void result
          .then((frame) => {
            // 过期响应丢弃：悬停位置已变，只认最新一次请求
            if (requestId !== previewRequestId) return;
            applyPreviewFrame(frame);
          })
          .catch(() => {
            if (requestId !== previewRequestId) return;
            applyPreviewFrame(null);
          });
        return;
      }
      applyPreviewFrame(result);
    };

    /**
     * 更新预览弹窗内的分段名称（命中 [startTime, endTime) 的分段）
     * @param time - 悬停时间（秒）
     */
    const updateHotspotLabel = (time: number): void => {
      const timeline = normalizeSegmentSpan(
        segmentsSignal.value,
        durationSignal.value,
      );
      const hit = timeline.find(
        (segment) => time >= segment.startTime && time < segment.endTime,
      );
      const text = timeline.length > 1 && hit ? hit.label : "";
      if (hotspotTextSignal.value !== text) {
        hotspotTextSignal.value = text;
      }
    };

    /**
     * 鼠标进入进度条区域：300ms 延迟后通过 popupActiveSignal 驱动 state-active 类
     * （弹窗与指示器的显隐由该类配合 CSS 控制，时间文本由 hoverTimeSignal 响应式更新）
     */
    const handleMouseEnter = (): void => {
      if (hoverTimer !== null) {
        clearTimeout(hoverTimer);
      }
      hoverTimer = setTimeout(() => {
        popupActiveSignal.value = true;
        hoverTimer = null;
      }, 300);
    };

    // ============================================
    // 事件处理函数
    // ============================================

    /**
     * 鼠标移动处理，更新预览弹窗、移动指示器和光标位置
     */
    const handleMouseMove = (event: MouseEvent): void => {
      event.preventDefault();
      if (isDragging) return;
      updatePopup(event.clientX);

      // 更新光标位置
      if (cursorRef.value && progressAreaRef.value) {
        /** 进度条区域的边界矩形 */
        const rect = progressAreaRef.value.getBoundingClientRect();
        /** 鼠标位置在进度条上的比例 (0-1) */
        const ratio = Math.max(
          0,
          Math.min(1, (event.clientX - rect.left) / rect.width),
        );
        cursorRef.value.style.left = `${ratio * 100}%`;
      }
    };

    /** 销毁 thumb / 上拉动画并清空挂载点（配置重建时复用） */
    const destroyThumbAnimations = (): void => {
      dragAnim?.destroy();
      dropAnim?.destroy();
      pullAnim?.destroy();
      dragAnim = null;
      dropAnim = null;
      pullAnim = null;
      thumbDragDom = null;
      thumbDropDom = null;
      thumbDirection = 0;
      if (dropResetTimer !== null) {
        clearTimeout(dropResetTimer);
        dropResetTimer = null;
      }
      if (thumbIconRef.value) thumbIconRef.value.replaceChildren();
    };

    /** thumb 尺寸：容器与图标同步，定位公式用 thumbSize / 2 居中 */
    const applyThumbSize = (size: number): void => {
      thumbSize = size;
      if (!thumbRef.value) return;
      thumbRef.value.style.width = `${size}px`;
      thumbRef.value.style.height = `${size}px`;
    };

    /**
     * thumb 拖拽动画（demo handleThumbAnim 同款）
     *
     * 方向不变时继续当前播放；方向反转时 setDirection(±1) 后从头播放；
     * 首次移动先把拖拽动画停在描述指定的常态帧。
     */
    const handleThumbAnim = (clientX: number): void => {
      if (!dragAnim || !thumbDragDom || !thumbIconRef.value) return;
      if (thumbIconRef.value.firstChild !== thumbDragDom) {
        thumbIconRef.value.replaceChildren(thumbDragDom);
      }
      if (thumbDirection === 0) {
        // 动画可能尚未触发 DOMLoaded，懒取一次实际中间帧
        if (dragIdleFrame === 0) {
          dragIdleFrame = Math.floor((dragAnim.totalFrames || 0) / 2);
        }
        dragAnim.goToAndStop(dragIdleFrame, true);
      }
      if (dragDirection === "fixed") {
        if (thumbDirection !== 1) {
          thumbDirection = 1;
          dragAnim.setDirection(1);
          dragAnim.play();
        }
      } else if (clientX > thumbClientX && thumbDirection < 1) {
        thumbDirection = 1;
        dragAnim.setDirection(1);
        dragAnim.play();
      } else if (clientX < thumbClientX && thumbDirection > -1) {
        thumbDirection = -1;
        dragAnim.setDirection(-1);
        dragAnim.play();
      }
      thumbClientX = clientX;
    };

    /** 松手落点动画：自定义落点播一次并延时复位，否则停在常态帧（demo 同款） */
    const showThumbDropFrame = (): void => {
      if (!dropAnim || !thumbDropDom || !thumbIconRef.value) return;
      thumbIconRef.value.replaceChildren(thumbDropDom);
      dropAnim.setDirection(1);
      if (hasCustomDrop) {
        dropAnim.goToAndPlay(0, true);
        if (dropDelayMs > 0) {
          if (dropResetTimer !== null) clearTimeout(dropResetTimer);
          dropResetTimer = setTimeout(() => {
            dropAnim?.goToAndStop(dropIdleFrame, true);
            dropResetTimer = null;
          }, dropDelayMs);
        }
      } else {
        dropAnim.goToAndStop(dropIdleFrame, true);
      }
      thumbDirection = 0;
    };

    /**
     * 重建 thumb 动画与精度模式上拉动画
     *
     * 配置来自 ConfigStore 的 progress.thumbIcon：
     * - 无配置：内置兜底动画
     * - drag/drop 传 URL：播放器 fetch JSON 后交给 lottie
     * - kind="image" 或 staticImage：直接渲染静态图片，不创建 lottie
     * - 描述里的 totalFrames / frameRate / idleFrame 决定停帧与落点延迟
     */
    const rebuildThumbAnimations = async (): Promise<void> => {
      if (!isBrowser()) return;
      const icon = thumbIconRef.value;
      if (!icon) return;
      const config = thumbConfigSignal.value;
      destroyThumbAnimations();

      dragDirection = config?.drag?.direction ?? "follow";
      applyThumbSize(
        config?.size ?? config?.drag?.size ?? config?.drop?.size ?? 20,
      );

      // 静态图片：不做拖拽 / 落点动画
      const staticImage =
        config?.staticImage ??
        (config?.drag?.kind === "image" ? config.drag.url : undefined);
      if (staticImage) {
        const image = document.createElement("img");
        image.src = staticImage;
        image.style.cssText = "width:100%;height:100%;object-fit:contain;";
        icon.appendChild(image);
        hasCustomDrop = false;
        dropIdleFrame = 0;
        dropDelayMs = 0;
        return;
      }

      const dragSource = config?.drag;
      const dropSource = config?.drop;
      dragIdleFrame =
        dragSource?.idleFrame ??
        (dragSource?.totalFrames !== undefined
          ? Math.floor(dragSource.totalFrames / 2)
          : 0);
      dropIdleFrame =
        dropSource?.idleFrame ??
        (dropSource?.totalFrames !== undefined
          ? Math.floor(dropSource.totalFrames / 2)
          : 0);
      hasCustomDrop = Boolean(dropSource?.url);
      dropDelayMs =
        config?.dropDelayMs ??
        (dropSource?.totalFrames && dropSource.frameRate
          ? (dropSource.totalFrames / dropSource.frameRate) * 1000 + 200
          : 0);

      let dragData: Record<string, unknown> = thumbFallbackData;
      let dropData: Record<string, unknown> = thumbFallbackData;
      if (dragSource?.url && dragSource.kind !== "image") {
        try {
          dragData = await loadThumbData(dragSource.url);
        } catch {
          dragData = thumbFallbackData;
        }
      }
      if (dropSource?.url && dropSource.kind !== "image") {
        try {
          dropData = await loadThumbData(dropSource.url);
        } catch {
          dropData = thumbFallbackData;
        }
      }

      const lottie = await loadProgressLottie();
      if (!thumbIconRef.value) return;
      thumbDragDom = document.createElement("div");
      thumbDropDom = document.createElement("div");
      thumbDragDom.style.cssText = "width:100%;height:100%;";
      thumbDropDom.style.cssText = "width:100%;height:100%;";

      dragAnim = lottie.loadAnimation({
        container: thumbDragDom,
        renderer: "svg",
        loop: false,
        autoplay: false,
        animationData: dragData,
      });
      dropAnim = lottie.loadAnimation({
        container: thumbDropDom,
        renderer: "svg",
        loop: false,
        autoplay: false,
        animationData: dropData,
      });
      dragAnim.addEventListener("DOMLoaded", () => {
        dragIdleFrame = resolveIdleFrame(
          dragSource,
          dragAnim?.totalFrames ?? 0,
        );
        dragAnim?.goToAndStop(dragIdleFrame, true);
      });
      dropAnim.addEventListener("DOMLoaded", () => {
        dropIdleFrame = resolveIdleFrame(
          dropSource,
          dropAnim?.totalFrames ?? 0,
        );
        dropAnim?.goToAndStop(dropIdleFrame, true);
      });
      // 自定义落点但没有描述延迟时，播完自动回常态帧，避免停在最后一帧
      if (hasCustomDrop && dropDelayMs <= 0) {
        dropAnim.addEventListener("complete", () => {
          dropAnim?.goToAndStop(dropIdleFrame, true);
        });
      }
      thumbIconRef.value.appendChild(thumbDragDom);

      if (pullIndicatorRef.value) {
        pullAnim = lottie.loadAnimation({
          container: pullIndicatorRef.value,
          renderer: "svg",
          loop: false,
          autoplay: false,
          animationData: pullIndicatorData,
        });
        // 首次按下发生在动画加载完成前时补一次播放
        pullAnim.addEventListener("DOMLoaded", () => {
          if (isDragging) pullAnim?.play();
        });
      }
    };

    /**
     * 精度模式：按鼠标上移距离抬高轨道，切换 pulling 状态并同步光标尺寸
     *
     * 上拉高度夹在 [基准高度, 11 倍基准高度]；高度变化时停止上拉动画（停在当前帧），
     * thumb 隐藏、cursor 显示并按原版公式随高度改变尺寸。
     */
    const applyPulling = (clientX: number, clientY: number): void => {
      const track = trackRef.value;
      if (!track) return;
      if (trackBaseHeight <= 0) trackBaseHeight = track.clientHeight || 4;
      const rect = track.getBoundingClientRect();
      const height = Math.min(
        Math.max(Math.floor(rect.bottom - clientY), trackBaseHeight),
        trackBaseHeight * 11,
      );
      track.style.height = `${height}px`;

      const ratio = height / trackBaseHeight;
      if (ratio !== pullRatio) {
        pullRatio = ratio;
        // demo 同款：高度变化时停止上拉动画，停在当前帧
        pullAnim?.stop();
        const duration = durationSignal.value;
        if (ratio > 1) {
          precisionLeftTime = (1 - 1 / ratio) * startPercentage * duration;
          precisionRightTime =
            precisionLeftTime + (1 / ratio) * duration;
        } else {
          precisionLeftTime = 0;
          precisionRightTime = duration;
        }
        const active = ratio > 1;
        if (active !== pullingActive) {
          pullingActive = active;
          pullingSignal.value = active;
        }
      }

      const cursor = cursorRef.value;
      if (!cursor) return;
      if (!pullingActive) {
        cursor.style.width = "";
        cursor.style.height = "";
        cursor.style.left = "";
        cursor.style.top = "";
        cursor.style.transform = "";
        return;
      }
      // 光标尺寸随轨道高度变化（bpx 原版公式）
      const cw = -0.205 * height + 13.026;
      const ch = 1.026 * height + 6.872;
      const pct = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / (rect.width || 1)),
      );
      cursor.style.width = `${cw}px`;
      cursor.style.height = `${ch}px`;
      cursor.style.left = `${-cw / 2}px`;
      cursor.style.top = `${(height - ch) / 2}px`;
      cursor.style.transform = `translateX(${pct * rect.width}px)`;
    };

    /** 退出精度模式：恢复轨道高度、pulling 类、光标尺寸与局部时间窗口 */
    const resetPulling = (): void => {
      const track = trackRef.value;
      if (track) track.style.height = "";
      pullAnim?.stop();
      pullRatio = 1;
      precisionLeftTime = 0;
      precisionRightTime = 0;
      if (pullingActive) {
        pullingActive = false;
        pullingSignal.value = false;
      }
      const cursor = cursorRef.value;
      if (cursor) {
        cursor.style.width = "";
        cursor.style.height = "";
        cursor.style.left = "";
        cursor.style.top = "";
        cursor.style.transform = "";
      }
      trackBaseHeight = 0;
    };

    /**
     * 鼠标按下处理（与既有实现 handleMouseDown 一致：点击立即跳转，
     * 随后进入拖拽状态，拖拽过程中连续 seek）
     */
    const handleMouseDown = (event: MouseEvent): void => {
      if (!isBrowser()) return;
      event.preventDefault();
      isDragging = true;
      trackBaseHeight = trackRef.value?.clientHeight || 4;
      startPercentage = getPercentageFromX(event.clientX);
      thumbDirection = 0;
      thumbClientX = event.clientX;
      // 按下即挂拖拽动画并播放 precision 上拉动画（demo handleDragDown 同款）
      if (thumbIconRef.value && thumbDragDom) {
        thumbIconRef.value.replaceChildren(thumbDragDom);
      }
      pullAnim?.play();

      lifecycle.emit?.("seekStart");

      // 点击立即 seek（与既有实现一致）
      /** 按下位置对应的时间 */
      const initialTime = getTimeFromX(event.clientX);
      updateProgressUI(initialTime);
      lifecycle.emit?.("seek", initialTime);

      /**
       * 拖拽过程中鼠标移动的处理函数：连续 seek（挂载在 document 上）
       */
      const onMouseMove = (e: MouseEvent): void => {
        if (!isDragging) return;
        e.preventDefault();
        const pct = getPercentageFromX(e.clientX);
        // 先处理精度模式高度，再决定拖拽映射（demo onDragMove 顺序一致）
        applyPulling(e.clientX, e.clientY);

        let target: number;
        if (pullingActive) {
          // 精度模式：局部时间窗口内取时间，不再更新全局预览与 thumb 动画
          target =
            precisionLeftTime +
            (precisionRightTime - precisionLeftTime) * pct;
        } else {
          handleThumbAnim(e.clientX);
          updatePopup(e.clientX);
          target = pct * durationSignal.value;
        }
        updateProgressUI(target);
        lifecycle.emit?.("seek", target);
      };

      /**
       * 拖拽结束时鼠标释放的处理函数
       */
      const onMouseUp = (): void => {
        isDragging = false;
        // 松手落点动画：无自定义图标时切回 drop 动画停在中间帧
        showThumbDropFrame();
        resetPulling();
        if (pendingThumbRebuild) {
          pendingThumbRebuild = false;
          void rebuildThumbAnimations();
        }
        lifecycle.emit?.("seekEnd");

        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        dragMouseMove = null;
        dragMouseUp = null;
      };

      dragMouseMove = onMouseMove;
      dragMouseUp = onMouseUp;

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    /**
     * 鼠标离开进度条区域时通过 popupActiveSignal 移除 state-active 类（收起预览弹窗与指示器）
     */
    const handleMouseLeave = (): void => {
      if (hoverTimer !== null) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (!isDragging) {
        popupActiveSignal.value = false;
        resetPulling();
      }
    };

    // ============================================
    // 响应式渲染辅助（For 的数据源与 render）
    // ============================================

    /**
     * 分段几何的响应式样式 getter
     *
     * 函数体内部读取 segmentsSignal / durationSignal 建立依赖：
     * 时长到手（setDuration）或分段重建（rebuildSegments）时，
     * 每个分段容器的 left/width/marginRight 由响应式系统增量更新，
     * 不再需要 applySegmentGeometry 命令式补写。
     *
     * 语义与旧实现 applySegmentGeometry 完全一致：
     * - 多分段：按 first / last / default 策略逐段计算
     * - 单分段：整条视作 [0, duration]，first 策略（右侧留缺口 + 间隔）
     * - 无分段：返回空对象（CSS 默认全宽）
     * - 时长未知（duration <= 0）：返回空对象，避免写进 NaN% / Infinity%
     * @param index - 分段下标
     */
    const segmentBoxStyle = (index: number): Record<string, string> => {
      const list = segmentsSignal.value;
      const dur = durationSignal.value;
      if (!(dur > 0)) return {};
      if (list.length > 1) {
        // 分段跨度与媒体总时长不一致时先归一（保证 Σwidth = 100%）
        const normalized = normalizeSegmentSpan(list, dur);
        const seg = normalized[index];
        if (!seg) return {};
        const box = computeSegmentBox(seg, index, list.length, dur);
        return box.marginRight
          ? { left: box.left, width: box.width, marginRight: box.marginRight }
          : { left: box.left, width: box.width };
      }
      if (list.length === 1) {
        const normalized = normalizeSegmentSpan(list, dur);
        const seg = normalized[0];
        if (!seg) return {};
        const box = computeSegmentBox(seg, 0, 1, dur);
        return { left: box.left, width: box.width, marginRight: "0.3%" };
      }
      return {};
    };

    /**
     * 渲染单个分段（For 的 render 回调，仅在新 key 创建项时调用）
     *
     * 多分段：segment 类 + padding 悬停区 + buffer/current 两条填充条；
     * 单条整轴（SINGLE_BAR）：无 hover / 无 padding，几何随 CSS 默认或单段策略。
     * buffer/current 的 DOM 引用经函数 ref 按下标收集到缓存数组，
     * 供 updateSegmentFills / updateBufferFills 逐帧命令式写 scaleX。
     * @param item - 分段数据或单条整轴占位
     * @param index - 列表下标（For 按当前列表顺序传入）
     * @returns 分段 VNode
     */
    const renderSegmentItem = (item: unknown, index: number): VNode => {
      if (isProgressSegment(item)) {
        return h(
          "div",
          {
            class: [
              "nova-player-progress-schedule nova-player-progress-schedule-segment",
              { hover: hoveredSegIdxSignal.value === index },
            ],
            // 响应式 style：几何随 segmentsSignal / durationSignal 自动更新
            style: segmentBoxStyle(index),
          },
          h("div", {
            class: "nova-player-progress-schedule-padding",
            // 分段悬停态：声明式 Enter/Leave 写信号驱动 hover 类
            //（替代旧实现动态挂载一次性 mouseout 的命令式写法）
            onMouseEnter: (): void => {
              hoveredSegIdxSignal.value = index;
            },
            onMouseLeave: (): void => {
              hoveredSegIdxSignal.value = -1;
            },
          }),
          h("div", {
            class: "nova-player-progress-schedule-buffer",
            style: { transform: "scaleX(0)" },
            // 函数 ref：materialize 时按当前列表下标收集 DOM 引用
            ref: fillRef(segmentBufferRefs, index),
          }),
          h("div", {
            class: "nova-player-progress-schedule-current",
            style: { transform: "scaleX(0)" },
            ref: fillRef(segmentCurrentRefs, index),
          }),
        );
      }
      if (item === SINGLE_BAR) {
        return h(
          "div",
          {
            class: "nova-player-progress-schedule",
            // 响应式 style：单分段时 first 策略几何、无分段时 CSS 默认全宽
            style: segmentBoxStyle(index),
          },
          h("div", {
            class: "nova-player-progress-schedule-buffer",
            style: { transform: "scaleX(0)" },
            ref: fillRef(segmentBufferRefs, index),
          }),
          h("div", {
            class: "nova-player-progress-schedule-current",
            style: { transform: "scaleX(0)" },
            ref: fillRef(segmentCurrentRefs, index),
          }),
        );
      }
      // 非法项兜底：渲染空节点保证 For key 语义完整
      return h("div", {});
    };

    /**
     * 分钟刻度序列 getter（刻度层 For 的 each 数据源）
     *
     * 读取 durationSignal 建立依赖：时长到手自动补建刻度、
     * 时长变化自动增删刻度并精准重排，彻底消除旧实现
     * 「仅在 setDuration 事件里手动 buildScaleplate」的时序缺陷。
     * @returns 分钟刻度数组 [1, 2, ..., floor(duration / 60)]
     */
    const scaleplateMinutes = (): number[] => {
      const dur = durationSignal.value;
      if (!(dur > 0)) return [];
      const totalMinutes = Math.floor(dur / 60);
      const minutes: number[] = [];
      for (let minute = 1; minute <= totalMinutes; minute += 1) {
        minutes.push(minute);
      }
      return minutes;
    };

    /**
     * 单根分钟刻度位置的响应式样式 getter
     *
     * 读取 durationSignal 建立依赖：时长变化时已渲染刻度的 left 位置
     * 由响应式系统增量更新（替代旧实现全量销毁重建）。
     * @param minute - 分钟数
     */
    const minuteTickStyle = (minute: number): Record<string, string> => {
      const dur = durationSignal.value;
      if (!(dur > 0)) return {};
      return { left: `${((minute * 60) / dur) * 100}%` };
    };

    // ============================================
    // API 方法（对外签名与旧实现完全一致）
    // ============================================

    /**
     * 更新播放进度
     */
    const updateProgress = (time: number): void => {
      updateProgressUI(time);
    };

    /**
     * 更新缓冲进度
     */
    const updateBuffer = (buffer: number): void => {
      updateBufferUI(buffer);
    };

    /**
     * 更新视频总时长
     * 组件挂载时 props.duration 可能仍为 0，元数据加载后由上层通过该 API 回传。
     * 写入信号即可：分段几何与分钟刻度全部由响应式系统自动同步。
     */
    const setDuration = (value: number): void => {
      durationSignal.value = value;
    };

    /**
     * 重建进度条分段
     *
     * 写入 segmentsSignal 即完成重建：For 按「下标」key 做 diff，数量不变时
     * 全部节点复用，只在原节点上更新几何；增删只发生在尾部。
     * 这里需要配合两件事：
     * - `syncRefs()`：把引用缓存裁到新数量（不能置空，复用节点不会重跑 ref）
     * - 清空去重缓存：节点可能被重建（单条整轴 ↔ 多段切换），必须强制重写一次
     * @param nextSegments 最新分段数据；不传则沿用当前数据强制重建
     */
    const rebuildSegments = (nextSegments?: ProgressSegment[]): void => {
      segmentsSignal.value = nextSegments ?? [...segmentsSignal.value];
      // 引用缓存按位置保留，只裁长度；绝不置空
      syncRefs();
      // 去重缓存清空：新建/重建的节点需要重新写入一次填充比例
      lastFillRatios = [];
      lastBufferRatios = [];
      // 悬停态归零（分段重建后 hover 下标失效）
      hoveredSegIdxSignal.value = -1;
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    /**
     * 组件挂载后向上层暴露更新方法
     *
     * 分段与分钟刻度由 For 在挂载期按初始信号值同步渲染
     *（effect 首跑同步，DOM 引用随函数 ref 就位），无需手动重建。
     */
    lifecycle.onMounted = (): void => {
      // 初始节点已由 For 同步渲染、函数 ref 已写入；这里只对齐缓存长度
      syncRefs();
      lifecycle.emit?.("progressBarMounted", {
        updateProgress,
        updateBuffer,
        setDuration,
        rebuildSegments,
      });
      void rebuildThumbAnimations();
      // 运行时更新 progress.thumbIcon：重建动画，不重启播放器
      if (configStore) {
        offThumbConfig = configStore.subscribePath(
          "progress.thumbIcon",
          (value) => {
            thumbConfigSignal.value =
              value as ProgressThumbIconConfig | undefined;
            if (!isBrowser()) return;
            // 拖拽中重建会打断动画，延迟到松手
            if (isDragging) pendingThumbRebuild = true;
            else void rebuildThumbAnimations();
          },
        );
      }
    };

    /**
     * 组件销毁前，移除 document 级别的事件监听并重置拖拽状态
     *
     * 幂等：既是统一卸载入口（最深子组件 → 根），也是契约钩子。
     * For 控制流的子 VNode 与响应式 effect 由框架 destroy 流程统一清理，
     * 这里只清空组件持有的 DOM 引用缓存，避免悬挂引用。
     */
    const teardown = (): void => {
      isDragging = false;
      if (hoverTimer !== null) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (dragMouseMove) {
        document.removeEventListener("mousemove", dragMouseMove);
        dragMouseMove = null;
      }
      if (dragMouseUp) {
        document.removeEventListener("mouseup", dragMouseUp);
        dragMouseUp = null;
      }
      destroyThumbAnimations();
      offThumbConfig?.();
      offThumbConfig = null;
      segmentBufferRefs = [];
      segmentCurrentRefs = [];
      lastFillRatios = [];
      lastBufferRatios = [];
    };

    useComponentUnmount(lifecycle, teardown);
    lifecycle.onBeforeDestroy = teardown;

    // ============================================
    // 主渲染函数
    // ============================================
    return h(
      "div",
      {
        class: "nova-player-progress-area",
        ref: "progressAreaRef",
        onMouseEnter: handleMouseEnter,
        onMouseMove: handleMouseMove,
        onMouseDown: handleMouseDown,
        onMouseLeave: handleMouseLeave,
      },
      h(
        "div",
        {
          class: [
            "nova-player-progress-wrap",
            {
              "state-active": popupActiveSignal.value,
              "state-pulling": pullingSignal.value,
            },
          ],
        },
        h(
          "div",
          { class: "nova-player-progress", ref: "progressTrackRef" },
          h(
            "div",
            { class: "nova-player-progress-schedule-wrap" },
            h(For, {
              // 多分段渲染真实分段列表；0/1 段渲染单条整轴（保留旧单条行为）
              each: (): SegmentItem[] => {
                const list = segmentsSignal.value;
                return list.length > 1 ? list : [SINGLE_BAR];
              },
              key: (item: unknown, index: number): string =>
                isProgressSegment(item) ? `segment:${index}` : "single",
              render: renderSegmentItem,
            }),
          ),
          h(
            "div",
            { class: "nova-player-progress-scaleplate" },
            h(For, {
              each: scaleplateMinutes,
              key: (item: unknown, index: number): string =>
                typeof item === "number" ? `m${item}` : `x${index}`,
              render: (item: unknown): VNode =>
                typeof item === "number"
                  ? h("div", {
                      // 整 5 分钟的刻度加高（CSS -2m 类），普通分钟为短线（-1m）
                      class:
                        item % 5 === 0
                          ? "nova-player-progress-scaleplate-2m"
                          : "nova-player-progress-scaleplate-1m",
                      // 响应式 style：随 durationSignal 精准更新刻度位置
                      style: minuteTickStyle(item),
                    })
                  : h("div", {}),
            }),
          ),
          // 进度点容器：片头结束 / 片尾开始断点（外部数据源提供）
          h(
            "div",
            { class: "nova-player-progress-point-wrap" },
            h(For, {
              each: (): Array<{ key: string; time: number; label: string }> => {
                const total = durationSignal.value;
                const points = props.skipPoints;
                if (!points || total <= 0) return [];
                const list: Array<{
                  key: string;
                  time: number;
                  label: string;
                }> = [];
                if (
                  typeof points.introEnd === "number" &&
                  points.introEnd > 0 &&
                  points.introEnd < total
                ) {
                  list.push({
                    key: "intro",
                    time: points.introEnd,
                    label: t("player.ui.progress.skip_intro"),
                  });
                }
                if (
                  typeof points.outroStart === "number" &&
                  points.outroStart > 0 &&
                  points.outroStart < total
                ) {
                  list.push({
                    key: "outro",
                    time: points.outroStart,
                    label: t("player.ui.progress.skip_outro"),
                  });
                }
                return list;
              },
              key: (item: unknown): string =>
                typeof item === "object" && item !== null && "key" in item
                  ? String((item as { key: string }).key)
                  : "point",
              render: (item: unknown): VNode => {
                if (typeof item !== "object" || item === null) {
                  return h("span", {});
                }
                const point = item as {
                  key: string;
                  time: number;
                  label: string;
                };
                const total = durationSignal.value;
                return h("span", {
                  class:
                    "nova-player-progress-point nova-player-progress-point-oped",
                  title: point.label,
                  "data-point": point.key,
                  style: {
                    width: "6px",
                    left: `${(point.time / total) * 100}%`,
                  },
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation();
                    lifecycle.emit?.("seek", point.time);
                  },
                });
              },
            }),
          ),
          // 拖拽滑块
          h(
            "div",
            {
              class: "nova-player-progress-thumb",
              ref: "thumbRef",
              style: { left: "0%" },
            },
            h("div", {
              class:
                "nova-player-progress-thumb-icon nova-player-progress-thumb-icon-dynamic nova-player-progress-thumb-active",
              // lottie 的 drag / drop 两个实例挂载点
              ref: "thumbIconRef",
            }),
          ),
          // 移动指示器
          h(
            "div",
            {
              class: "nova-player-progress-move-indicator",
              ref: "moveIndicatorRef",
            },
            h("div", { class: "nova-player-progress-move-indicator-down" }),
            h("div", { class: "nova-player-progress-move-indicator-up" }),
          ),
          h(
            "div",
            {
              class: "nova-player-progress-popup",
              ref: "popupRef",
            },
            h(
              "div",
              { class: "nova-player-progress-preview" },
              h("img", {
                class: "nova-player-progress-preview-image",
                src: previewSrcSignal.value,
                style: {
                  width: previewWidthSignal.value,
                  height: previewHeightSignal.value,
                  objectFit: previewObjectFitSignal.value,
                  objectPosition: previewObjectPositionSignal.value,
                },
              }),
              h(
                "div",
                { class: "nova-player-progress-preview-time" },
                // 响应式文本：hoverTimeSignal 变化时自动更新时间文案
                //（替代旧实现 previewTimeRef.innerText 命令式写入）
                () => formatTime(hoverTimeSignal.value),
              ),
            ),
            h(
              "div",
              { class: "nova-player-progress-hotspot" },
              // 响应式文本：必须传函数，信号变化才会重新求值
              () => hotspotTextSignal.value,
            ),
          ),
          // 精度模式上拉指示器（lottie 直接挂载到该容器，与 thumb 同步位移）
          h("div", {
            class: "nova-player-progress-pull-indicator",
            ref: "pullIndicatorRef",
            style: { transform: "translateX(0px)" },
          }),
          // 光标
          h("div", { class: "nova-player-progress-cursor", ref: "cursorRef" }),
        ),
      ),
    );
  },
);
