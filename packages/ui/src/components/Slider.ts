/**
 * ============================================
 * Slider 滑块（nano-ui: bui-slider → lui-slider）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass } from "../shared";
import { ThumbIcon } from "../icons";

export interface SliderMark {
  name: string;
  value: number;
}

export interface SliderProps {
  /** 0-100 */
  value?: number;
  /** 竖直 */
  vertical?: boolean;
  /** 轨道厚度 */
  trackBreadth?: number | null;
  /** 档位 */
  steps?: SliderMark[] | null;
  /** 档位别名 */
  labels?: SliderMark[] | null;
  /** 分段数据 */
  segmentedDate?: Array<{ width?: number; [key: string]: unknown }> | null;
  /** 分段总宽 */
  segmentedWidth?: number | null;
  /** thumb 宽度 */
  thumbWidth?: number | null;
  /** thumb 高度 */
  thumbHeight?: number | null;
  /** 显示 tooltip */
  showTooltip?: boolean;
  /** 特殊 thumb */
  thumbSpecial?: boolean;
  /** 视频进度（显示 buffer 条） */
  videoProgress?: boolean;
  /** 自动隐藏 thumb */
  autohideThumb?: boolean;
  /** 阴影 */
  shadow?: boolean;
  /** tooltip 格式化 */
  formatTooltip?: (value: number) => string;
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 变化回调 */
  onChange?: (value: number) => void;
}

export interface SliderApi {
  setValue: (value: number) => void;
  getValue: () => number;
}

export const Slider = defineComponent<SliderProps>(
  (props: SliderProps, lifecycle: ComponentLifecycle) => {
    const current = signal<number>(Math.max(0, Math.min(100, props.value ?? 0)));
    let track: HTMLDivElement | null = null;
    let dragging = false;

    const clamp = (value: number): number => Math.max(0, Math.min(100, value));

    const setValue = (value: number): void => {
      current.value = clamp(value);
      props.onChange?.(current.value);
    };

    const markerList = (): SliderMark[] | null => props.steps ?? props.labels ?? null;

    const valueFromEvent = (event: MouseEvent): number => {
      if (!track) return current.value;
      const rect = track.getBoundingClientRect();
      const ratio = props.vertical
        ? 1 - (event.clientY - rect.top) / rect.height
        : (event.clientX - rect.left) / rect.width;
      return clamp(ratio * 100);
    };

    const handleMove = (event: MouseEvent): void => {
      if (!dragging) return;
      setValue(valueFromEvent(event));
    };

    const handleUp = (): void => {
      dragging = false;
      if (typeof document !== "undefined") {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      }
    };

    const handleDown = (event: MouseEvent): void => {
      if (props.disabled) return;
      dragging = true;
      setValue(valueFromEvent(event));
      if (typeof document !== "undefined") {
        document.addEventListener("mousemove", handleMove);
        document.addEventListener("mouseup", handleUp);
      }
    };

    const handleClick = (event: MouseEvent): void => {
      if (props.disabled) return;
      setValue(valueFromEvent(event));
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("sliderMounted", {
        setValue,
        getValue: () => current.value,
      } satisfies SliderApi);
    };

    lifecycle.onBeforeDestroy = (): void => {
      if (typeof document !== "undefined") {
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      }
    };

    const percent = (): number => current.value;
    const tooltip = (): string =>
      props.formatTooltip ? props.formatTooltip(current.value) : `${Math.floor(current.value)}%`;

    const renderBars = () => {
      if (props.segmentedDate && props.segmentedDate.length > 0) {
        return props.segmentedDate.map(() =>
          h(
            "div",
            { class: "lui-bar-wrap lui-segmented" },
            props.shadow
              ? h("div", { class: "lui-segmented-padding shadow" })
              : h("div", { class: "lui-segmented-padding" }),
            props.videoProgress
              ? h("div", { class: "lui-bar lui-bar-buffer", style: { transform: "scaleX(0.001)" } })
              : null,
            h("div", {
              class: "lui-bar lui-bar-normal",
              role: "progressbar",
              style: { transform: `scaleX(${Math.max(0.001, percent() / 100)})` },
            }),
          ),
        );
      }
      const barWrap = h(
        "div",
        { class: "lui-bar-wrap" },
        props.videoProgress
          ? h("div", { class: "lui-bar lui-bar-buffer", style: { transform: "scaleX(0.001)" } })
          : null,
        h("div", {
          class: "lui-bar lui-bar-normal",
          role: "progressbar",
          style: { transform: `scaleX(${Math.max(0.001, percent() / 100)})` },
        }),
      );
      return [barWrap];
    };

    const markers = markerList();

    return h(
      "div",
      { class: rootClass("slider", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          {
            class: [
              "lui-track",
              {
                "lui-track-vertical": Boolean(props.vertical),
                "lui-track-autohide-thumb": Boolean(props.autohideThumb),
                "lui-track-video-progress": Boolean(props.videoProgress),
              },
            ],
            style: props.trackBreadth
              ? props.vertical
                ? { width: `${props.trackBreadth}px` }
                : { height: `${props.trackBreadth}px` }
              : undefined,
            onMouseDown: handleDown,
            onClick: handleClick,
            ref: (el: Element) => { track = el as HTMLDivElement; },
          },
          ...renderBars(),
          markers
            ? h(
                "div",
                { class: "lui-step" },
                ...markers.map((mark) =>
                  h(
                    "div",
                    {
                      class: [
                        "lui-step-item",
                        {
                          "lui-step-item-0": mark.value === 0,
                          "lui-step-item-100": mark.value === 1,
                        },
                      ],
                      style: { left: `${mark.value * 100}%` },
                    },
                    h("div", { class: "lui-step-dot" }),
                    h("div", { class: "lui-step-name" }, mark.name),
                  ),
                ),
              )
            : null,
          h(
            "div",
            {
              class: "lui-thumb",
              style: {
                position: "absolute",
                ...(props.vertical
                  ? { left: "50%", top: `${100 - percent()}%`, transform: "translate(-50%, -50%)" }
                  : { top: "50%", left: `${percent()}%`, transform: "translate(-50%, -50%)" }),
              },
            },
            props.showTooltip ? h("div", { class: "lui-thumb-tooltip" }, () => tooltip()) : null,
            props.thumbSpecial
              ? h("div", {
                  class: "lui-thumb-dot-special",
                  style: {
                    ...(props.thumbWidth ? { width: `${props.thumbWidth}px` } : {}),
                    ...(props.thumbHeight ? { height: `${props.thumbHeight}px` } : {}),
                  },
                })
              : h(
                  "div",
                  {
                    class: "lui-thumb-dot",
                    style: {
                      ...(props.thumbWidth ? { width: `${props.thumbWidth}px` } : {}),
                      ...(props.thumbHeight ? { height: `${props.thumbHeight}px` } : {}),
                    },
                  },
                  props.videoProgress && !props.thumbSpecial ? ThumbIcon() : null,
                ),
          ),
        ),
      ),
    );
  },
);

export default Slider;
