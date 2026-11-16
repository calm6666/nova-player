/**
 * ============================================
 * 底部影子进度条组件 (ShadowProgressArea)
 * ============================================
 * 声明式响应式版本（与顶部 ProgressBar 同款契约）：
 * - 分段节点由 segmentsSignal 驱动 For 控制流，key = 位置下标：
 *   数量不变时节点复用、只在原节点上更新几何；增删只发生在尾部。
 * - 几何走响应式 style（segmentBoxStyle 读 segmentsSignal/durationSignal），
 *   时长到手或分段重建时自动重算，不再命令式 applySegmentGeometry。
 * - 已播放/缓冲填充按「引用缓存 + 下标」精准写 transform: scaleX，
 *   不每帧 querySelectorAll；引用缓存只裁不置空（函数 ref 只在创建时回调）。
 * - 常驻文本由 reactive Text 节点精准更新（只改 Text，不重建节点）。
 * - 销毁时按引用清理槽位（框架 clearRef 会以 null 回调函数 ref）。
 */

import { h, defineComponent, signal, For } from '@lumina/framework/core';
import type { VNode } from "@lumina/framework/types";
import { useComponentUnmount } from "../core/componentUnmount";
import type { ProgressSegment } from "../types/player";
import {
  computeSegmentBox,
  computeSegmentRatio,
  computeSegmentBufferRatio,
} from "./ProgressBar";
import { normalizeSegmentSpan } from "../utils/media/progressSegment";

/** 影子进度条挂载后回传的控制 API */
export interface ShadowProgressAreaApi {
  /** 更新已播放进度 */
  updateProgress: (time: number) => void;
  /** 更新缓冲进度 */
  updateBuffer: (buffer: number) => void;
  /** 更新视频总时长 */
  setDuration: (duration: number) => void;
  /** 重建分段（progress.segments 运行时变化时调用） */
  rebuildSegments: (segments?: ProgressSegment[]) => void;
  /** 切换「高能进度条」常驻形态（高度 30px + 显示分段文本） */
  setPermanent: (permanent: boolean) => void;
}

export interface ShadowProgressAreaProps {
  /** 视频总时长（秒） */
  duration?: number;
  /** 进度条分段信息（与顶部进度条同一份数据） */
  progressSegments?: ProgressSegment[];
  /** 是否常驻形态（参考实现为 isEdit 且存在多个分段） */
  permanent?: boolean;
}

export type ShadowProgressAreaEvents = {
  shadowProgressAreaMounted: ShadowProgressAreaApi;
};

/** 运行时类型谓词：For 的 render 入参为 unknown，用谓词收窄替代断言 */
const isProgressSegment = (item: unknown): item is ProgressSegment =>
  typeof item === "object" &&
  item !== null &&
  "startTime" in item &&
  typeof item.startTime === "number" &&
  "endTime" in item &&
  typeof item.endTime === "number";

/** 分段不足 2 个时的「单条整轴」占位（保持旧结构：一个 schedule 节点） */
const SINGLE_BAR: unique symbol = Symbol("shadow-single-bar");

export const ShadowProgressArea = defineComponent<
  ShadowProgressAreaProps,
  ShadowProgressAreaEvents
>((props, lifecycle) => {
  // ============================================
  // 响应式信号（渲染层唯一数据源）
  // ============================================

  /** 视频总时长（秒），挂载后经 setDuration 写入 */
  const durationSignal = signal<number>(props.duration ?? 0);

  /** 分段列表信号（rebuildSegments 整体替换，For 按下标 key diff） */
  const segmentsSignal = signal<ProgressSegment[]>(props.progressSegments ?? []);

  /** 常驻形态信号：驱动根节点 permanent 类与分段文本 */
  const permanentSignal = signal<boolean>(props.permanent === true);

  /** 当前播放时间（秒），用于把缓冲条限定在播放头所在的分段 */
  let currentTime = 0;

  /** 最近一次播放头时间（时长/分段变化后重放填充用） */
  let lastTime = 0;

  /** 最近一次缓冲时间（时长/分段变化后重放填充用） */
  let lastBuffer = 0;

  // ============================================
  // DOM 引用缓存（函数 ref 按位置写入）
  // ============================================

  /** 各分段缓冲条 */
  const bufferRefs: Array<HTMLDivElement | null> = [];

  /** 各分段已播放条 */
  const currentRefs: Array<HTMLDivElement | null> = [];

  /** 各段上次已播放填充比例（钳制后 0-1，去重写入） */
  let lastFillRatios: number[] = [];

  /** 各段上次缓冲填充比例（钳制后 0-1，去重写入） */
  let lastBufferRatios: number[] = [];

  /**
   * 按当前分段数量同步引用缓存长度
   *
   * 只裁尾部、绝不置空：节点按下标复用，函数 ref 只在创建时写一次，
   * 置空后不会再有回调把它填回来（填充会一帧都不写）。
   */
  const syncRefs = (): void => {
    // 0 段 / 1 段时渲染单条整轴，节点数恒为 1
    const length = Math.max(1, segmentsSignal.value.length);
    bufferRefs.length = length;
    currentRefs.length = length;
  };

  /**
   * 填充条的引用回调工厂
   *
   * 创建/水合时以元素回调写入下标；销毁时框架以 `null` 回调，按槽位清理
   * （仅当槽位仍是被销毁节点时清空，避免覆盖同位置先创建的新节点）。
   * @param cache - 目标引用缓存
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
  // 分段解析与填充计算
  // ============================================

  /**
   * 解析当前生效的分段区间列表
   * 多分段直接用各段自身区间；单分段 / 无分段时整条视作 [0, duration]
   */
  const resolveSegments = (): Array<
    Pick<ProgressSegment, "startTime" | "endTime">
  > => {
    const list = segmentsSignal.value;
    if (list.length > 1) return normalizeSegmentSpan(list, durationSignal.value);
    return [{ startTime: 0, endTime: durationSignal.value }];
  };

  /**
   * 按分段逐段写填充比例
   * @param value - 当前时间或缓冲时间（秒）
   * @param cache - 目标引用缓存
   * @param ratios - 去重缓存
   * @param bufferMode - 是否按缓冲规则（播放头之前整段 1、之后 0）
   */
  const updateFills = (
    value: number,
    cache: Array<HTMLDivElement | null>,
    ratios: number[],
    bufferMode: boolean,
  ): void => {
    if (!Number.isFinite(value)) return;
    const rangeList = resolveSegments();
    const playhead = Number.isFinite(currentTime) ? currentTime : 0;
    // 以数据区间为准遍历：引用缓存可能尚未收集齐，但绝不整体跳过不写
    for (let i = 0; i < rangeList.length; i += 1) {
      const el = cache[i];
      const range = rangeList[i];
      if (!el || !range) continue;
      // 脏分段（endTime <= startTime）跳过，避免除零产生 NaN
      if (range.endTime <= range.startTime) continue;
      const ratio = bufferMode
        ? computeSegmentBufferRatio(
            value,
            range.startTime,
            range.endTime,
            playhead,
          )
        : computeSegmentRatio(value, range.startTime, range.endTime);
      const clamped = Math.min(Math.max(ratio, 0), 1);
      if (ratios[i] === clamped) continue;
      ratios[i] = clamped;
      el.style.transform = `scaleX(${clamped})`;
    }
  };

  /** 重放已播放填充（时长/分段变化后调用，避免暂停时无人写入） */
  const applyProgress = (): void => {
    if (!(durationSignal.value > 0)) return;
    updateFills(lastTime, currentRefs, lastFillRatios, false);
  };

  /** 重放缓冲填充 */
  const applyBuffer = (): void => {
    if (!(durationSignal.value > 0)) return;
    updateFills(lastBuffer, bufferRefs, lastBufferRatios, true);
  };

  // ============================================
  // 对外 API
  // ============================================

  /** 更新已播放进度（影子条与顶部进度条同步） */
  const updateProgress = (time: number): void => {
    if (Number.isFinite(time)) {
      currentTime = time;
      lastTime = time;
    }
    applyProgress();
  };

  /** 更新缓冲进度 */
  const updateBuffer = (buffer: number): void => {
    if (Number.isFinite(buffer)) lastBuffer = buffer;
    applyBuffer();
  };

  /** 更新视频总时长：几何由响应式 style 重算，填充需要重放一次 */
  const setDuration = (value: number): void => {
    durationSignal.value = value;
    lastFillRatios = [];
    lastBufferRatios = [];
    applyProgress();
    applyBuffer();
  };

  /** 重建分段：节点按下标复用，只裁引用长度并重放填充 */
  const rebuildSegments = (nextSegments?: ProgressSegment[]): void => {
    segmentsSignal.value = nextSegments ?? [...segmentsSignal.value];
    syncRefs();
    // 去重缓存清空：单条整轴 ↔ 多段切换时节点结构不同会被重建，需强制重写
    lastFillRatios = [];
    lastBufferRatios = [];
    applyProgress();
    applyBuffer();
  };

  /** 切换常驻形态（类名与文本都由响应式驱动） */
  const setPermanent = (next: boolean): void => {
    permanentSignal.value = next;
  };

  // ============================================
  // 分段几何（响应式 style getter）
  // ============================================

  /**
   * 分段几何样式
   *
   * 函数体读取 segmentsSignal / durationSignal 建立依赖：时长到手或分段重建时
   * 由响应式系统增量更新 left/width，不再命令式 applySegmentGeometry。
   * 单分段 / 无分段沿用 CSS 默认全宽（与旧实现一致）。
   * @param index - 分段下标
   */
  const segmentBoxStyle = (index: number): Record<string, string> => {
    const list = segmentsSignal.value;
    const dur = durationSignal.value;
    if (!(dur > 0) || list.length <= 1) return {};
    const normalized = normalizeSegmentSpan(list, dur);
    const seg = normalized[index];
    if (!seg) return {};
    const box = computeSegmentBox(seg, index, list.length, dur);
    return box.marginRight
      ? { left: box.left, width: box.width, marginRight: box.marginRight }
      : { left: box.left, width: box.width };
  };

  // ============================================
  // 分段节点渲染
  // ============================================

  /**
   * 渲染单个分段节点（For 的 render，仅在新 key 创建时调用）
   * @param item - 分段数据或单条整轴占位
   * @param index - 列表下标
   * @returns 分段 VNode（buffer / current / text 三个子节点结构恒定）
   */
  const renderItem = (item: unknown, index: number): VNode => {
    const segment = isProgressSegment(item) ? item : undefined;
    return h(
      "div",
      {
        class: [
          "nova-player-progress-schedule",
          { "nova-player-progress-schedule-segment": segment !== undefined },
        ],
        style: segmentBoxStyle(index),
      },
      h("div", {
        class: "nova-player-progress-schedule-buffer",
        style: { transform: "scaleX(0)" },
        ref: fillRef(bufferRefs, index),
      }),
      h("div", {
        class: "nova-player-progress-schedule-current",
        style: { transform: "scaleX(0)" },
        ref: fillRef(currentRefs, index),
      }),
      // 文本：零参箭头函数作为子节点 → _reactiveText，
      // 只更新 Text 节点内容、不重建元素；内容从信号现读，
      // 保证节点复用时（同位置分段被替换）标题也能精准更新
      h(
        "div",
        { class: "nova-player-progress-schedule-text" },
        () =>
          permanentSignal.value
            ? (segmentsSignal.value[index]?.label ?? "")
            : "",
      ),
    );
  };

  // ============================================
  // 生命周期
  // ============================================

  lifecycle.onMounted = (): void => {
    // 初始节点已由 For 同步渲染、函数 ref 已写入；这里只对齐缓存长度
    syncRefs();
    setPermanent(props.permanent === true);
    lifecycle.emit?.("shadowProgressAreaMounted", {
      updateProgress,
      updateBuffer,
      setDuration,
      rebuildSegments,
      setPermanent,
    });
  };

  useComponentUnmount(lifecycle, (): void => {
    // 主动清空引用缓存，避免组件销毁后继续持有已卸载 DOM
    bufferRefs.length = 0;
    currentRefs.length = 0;
    lastFillRatios = [];
    lastBufferRatios = [];
  });

  return h(
    "div",
    {
      class: [
        "nova-player-shadow-progress-area",
        { permanent: permanentSignal.value },
      ],
    },
    h("div", { class: "nova-player-shadow-progress-schedule-wrap" },
      h(For, {
        // 多分段渲染真实分段列表；0/1 段渲染单条整轴（保持旧结构）
        each: (): Array<ProgressSegment | typeof SINGLE_BAR> => {
          const list = segmentsSignal.value;
          return list.length > 1 ? list : [SINGLE_BAR];
        },
        // key = 位置下标：同类型内重建时 key 不变，节点复用；kind 前缀区分结构
        key: (item: unknown, index: number): string =>
          isProgressSegment(item) ? `segment:${index}` : "single",
        render: renderItem,
      }),
    ),
  );
});
