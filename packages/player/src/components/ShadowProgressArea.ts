/**
 * ============================================
 * 底部影子进度条组件 (ShadowProgressArea)
 * ============================================
 * 响应式迁移决策：整体保留命令式（B 类·性能关键路径）。
 * - updateProgress/updateBuffer 按播放头/缓冲更新频率逐帧写 scaleX，
 *   与 ProgressBar.ts 同属高频进度渲染（缓存 DOM + 精准 style 写入实现
 *   零重渲染），signal 化只会引入逐次 effect 调度开销，无收益
 * - 分段 DOM 由 createSegmentElement 命令式创建并在
 *   segment.shadowElement 等字段建立数据↔DOM 交叉引用（与
 *   ProgressBar.ts 同款契约），rebuildSegments 增量复用
 * - permanent/duration 等状态与命令式分段 DOM 强耦合
 *   （applyPermanent 直写 text.textContent），单独 signal 化会造成
 *   半信号半命令式的混合状态，不如整组件统一命令式
 */

import { h, defineComponent, useTemplateRef } from "@/core";
import { useComponentUnmount } from "@/nova/core/componentUnmount";
import type { ProgressSegment } from "@/types";
import {
  computeSegmentBox,
  computeSegmentRatio,
  computeSegmentBufferRatio,
} from "./ProgressBar";
import { normalizeSegmentSpan } from "@/nova/utils/media/progressSegment";

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

export const ShadowProgressArea = defineComponent<
  ShadowProgressAreaProps,
  ShadowProgressAreaEvents
>((props, lifecycle) => {
  /** 视频总时长（秒），元数据加载后通过 setDuration 更新 */
  let duration = props.duration ?? 0;

  /** 当前分段数据 */
  let segments: ProgressSegment[] = props.progressSegments ?? [];

  /** 是否常驻形态（参考实现为 isEdit 且存在多个分段） */
  let permanent = props.permanent === true;

  /** 当前播放时间（秒），用于把缓冲条限定在播放头所在的分段 */
  let currentTime = 0;

  /** 影子进度条容器 */
  const areaRef = useTemplateRef<HTMLDivElement>(lifecycle, "shadowAreaRef");

  /** 影子进度条分段容器 */
  const wrapRef = useTemplateRef<HTMLDivElement>(
    lifecycle,
    "shadowScheduleWrapRef",
  );

  /**
   * 解析当前生效的分段区间列表
   * 多分段直接用各段自身区间；单分段 / 无分段时整条视作 [0, duration]
   */
  const resolveSegments = (): Array<
    Pick<ProgressSegment, "startTime" | "endTime">
  > => {
    if (segments.length > 1) return normalizeSegmentSpan(segments, duration);
    return [{ startTime: 0, endTime: duration }];
  };

  /** 影子分段基础元素列表（与分段顺序一一对应） */
  const getScheduleElements = (): HTMLDivElement[] => {
    if (!wrapRef.value) return [];
    return Array.from(
      wrapRef.value.querySelectorAll<HTMLDivElement>(
        ".nova-player-progress-schedule",
      ),
    );
  };

  /**
   * 按分段逐个更新影子子元素的填充比例
   * @param value - 当前时间或缓冲时间（秒）
   * @param childClass - 需要设置 scaleX 的子元素类名
   */
  const updateSegmentFills = (value: number, childClass: string): void => {
    if (!Number.isFinite(value)) return;
    const rangeList = resolveSegments();
    getScheduleElements().forEach((schedule, index) => {
      const range = rangeList[index];
      if (!range) return;
      if (range.endTime <= range.startTime) return;
      const ratio = computeSegmentRatio(value, range.startTime, range.endTime);
      schedule
        .querySelectorAll<HTMLDivElement>(`.${childClass}`)
        .forEach((el) => {
          el.style.transform = `scaleX(${Math.min(Math.max(ratio, 0), 1)})`;
        });
    });
  };

  /**
   * 按分段逐个更新影子缓冲条比例
   * 只有播放头所在的分段按真实缓冲时间填充，之前的分段整段为 1、之后的分段为 0，
   * 与顶部进度条的缓冲表现保持一致。
   * @param buffer - 缓冲时间（秒）
   */
  const updateBufferFills = (buffer: number): void => {
    if (!Number.isFinite(buffer)) return;
    const rangeList = resolveSegments();
    const playhead = Number.isFinite(currentTime) ? currentTime : 0;
    getScheduleElements().forEach((schedule, index) => {
      const range = rangeList[index];
      if (!range) return;
      if (range.endTime <= range.startTime) return;
      const ratio = computeSegmentBufferRatio(
        buffer,
        range.startTime,
        range.endTime,
        playhead,
      );
      schedule
        .querySelectorAll<HTMLDivElement>(
          ".nova-player-progress-schedule-buffer",
        )
        .forEach((el) => {
          el.style.transform = `scaleX(${Math.min(Math.max(ratio, 0), 1)})`;
        });
    });
  };

  /**
   * 落一个分段的几何：时长未知时跳过，避免写进 NaN% / Infinity%
   * @param schedule - 分段元素
   * @param segment - 分段数据
   * @param index - 分段下标
   * @param total - 分段总数
   */
  const applySegmentBox = (
    schedule: HTMLDivElement,
    segment: ProgressSegment,
    index: number,
    total: number,
  ): void => {
    if (!(duration > 0)) return;
    const { left, width, marginRight } = computeSegmentBox(
      segment,
      index,
      total,
      duration,
    );
    schedule.style.left = left;
    schedule.style.width = width;
    if (marginRight) {
      schedule.style.marginRight = marginRight;
    }
  };

  /** 按当前 segments 与 duration 重算所有影子分段的几何 */
  const applySegmentGeometry = (): void => {
    if (!(duration > 0)) return;
    const list = getScheduleElements();
    const normalized = normalizeSegmentSpan(segments, duration);
    list.forEach((schedule, index) => {
      const segment = normalized.length > 1 ? normalized[index] : normalized[0];
      if (!segment) return;
      applySegmentBox(schedule, segment, index, Math.max(list.length, 1));
    });
  };

  /** 创建影子分段元素（与参考实现的 createViewPointElement 一致：buffer + current + text） */
  const createSegmentElement = (
    hasSegments: boolean,
    index?: number,
    segment?: ProgressSegment,
  ): HTMLDivElement => {
    const schedule = document.createElement("div");
    schedule.classList.add(
      "nova-player-progress-schedule",
      ...(hasSegments ? ["nova-player-progress-schedule-segment"] : []),
    );

    const buffer = document.createElement("div");
    buffer.classList.add("nova-player-progress-schedule-buffer");
    buffer.style.transform = "scaleX(0)";

    const current = document.createElement("div");
    current.classList.add("nova-player-progress-schedule-current");
    current.style.transform = "scaleX(0)";

    const text = document.createElement("div");
    text.classList.add("nova-player-progress-schedule-text");
    // 文本仅在常驻形态（.permanent）下填充，与参考实现一致
    // （参考：仅 isEdit 且多分段时写入 pointText）

    schedule.appendChild(buffer);
    schedule.appendChild(current);
    schedule.appendChild(text);

    if (segment && typeof index === "number") {
      applySegmentBox(schedule, segment, index, segments.length);
      segment.shadowElement = schedule;
      segment.shadowBufferElement = buffer;
      segment.shadowCurrentElement = current;
      segment.shadowTextElement = text;
    }

    return schedule;
  };

  /** 按当前分段数据重建影子分段 DOM */
  const build = (): void => {
    const wrap = wrapRef.value;
    if (!wrap) return;

    wrap.textContent = "";
    segments.forEach((segment) => {
      segment.shadowElement = undefined;
      segment.shadowBufferElement = undefined;
      segment.shadowCurrentElement = undefined;
      segment.shadowTextElement = undefined;
    });

    const hasSegments = segments.length > 1;
    if (hasSegments) {
      segments.forEach((segment, index) => {
        wrap.appendChild(createSegmentElement(true, index, segment));
      });
    } else {
      wrap.appendChild(createSegmentElement(false));
    }
    applyPermanent();
  };

  /** 应用常驻形态：类名 + 逐分段文本（仅在常驻时填充文本） */
  const applyPermanent = (): void => {
    areaRef.value?.classList.toggle("permanent", permanent);
    segments.forEach((segment) => {
      const text = segment.shadowTextElement;
      if (!text) return;
      text.textContent = permanent ? segment.label : "";
    });
  };

  /** 切换常驻形态 */
  const setPermanent = (next: boolean): void => {
    permanent = next;
    applyPermanent();
  };

  /** 更新已播放进度（影子条与顶部进度条同步） */
  const updateProgress = (time: number): void => {
    if (duration <= 0) return;
    if (Number.isFinite(time)) currentTime = time;
    updateSegmentFills(time, "nova-player-progress-schedule-current");
  };

  /** 更新缓冲进度 */
  const updateBuffer = (buffer: number): void => {
    if (duration <= 0) return;
    updateBufferFills(buffer);
  };

  /** 更新视频总时长 */
  const setDuration = (value: number): void => {
    duration = value;
    applySegmentGeometry();
  };

  /** 重建分段 */
  const rebuildSegments = (nextSegments?: ProgressSegment[]): void => {
    if (nextSegments) segments = nextSegments;
    build();
    applySegmentGeometry();
  };

  lifecycle.onMounted = (): void => {
    build();
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
    segments.forEach((segment) => {
      segment.shadowElement = undefined;
      segment.shadowBufferElement = undefined;
      segment.shadowCurrentElement = undefined;
      segment.shadowTextElement = undefined;
    });
  });

  return h(
    "div",
    { class: "nova-player-shadow-progress-area", ref: "shadowAreaRef" },
    h("div", {
      class: "nova-player-shadow-progress-schedule-wrap",
      ref: "shadowScheduleWrapRef",
    }),
  );
});
