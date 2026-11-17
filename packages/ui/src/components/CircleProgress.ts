/**
 * ============================================
 * CircleProgress 圆环进度（nano-ui: bui-circle-progress）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass } from "../shared";

export interface CircleProgressProps {
  /** 0-100 */
  value?: number;
  /** 顶部文案 */
  topText?: string;
  /** 底部文案 */
  bottomText?: string;
  /** 深色 */
  dark?: boolean;
  /** 变化回调 */
  onChange?: (value: number) => void;
}

export interface CircleProgressApi {
  setValue: (value: number) => void;
  getValue: () => number;
}

export const CircleProgress = defineComponent<CircleProgressProps>(
  (props: CircleProgressProps, lifecycle: ComponentLifecycle) => {
    const current = signal<number>(Math.max(0, Math.min(100, props.value ?? 0)));

    const setValue = (value: number): void => {
      current.value = Math.max(0, Math.min(100, value));
      props.onChange?.(current.value);
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("circleProgressMounted", {
        setValue,
        getValue: () => current.value,
      } satisfies CircleProgressApi);
    };

    const leftDeg = (): number => -45 - 3.6 * Math.min(50, current.value);
    const rightDeg = (): number => {
      const rest = current.value - 50;
      return rest <= 0 ? -45 : -45 - 3.6 * rest;
    };

    return h(
      "div",
      { class: rootClass("circle-progress", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          { class: "lui-circle-progress" },
          h(
            "div",
            { class: "lui-circle-progress-left" },
            h("div", {
              class: "lui-circle-progress-left-content",
              style: { transform: `rotate(${leftDeg()}deg)` },
            }),
          ),
          h(
            "div",
            { class: "lui-circle-progress-right" },
            h("div", {
              class: "lui-circle-progress-right-content",
              style: { transform: `rotate(${rightDeg()}deg)` },
            }),
          ),
          h(
            "div",
            { class: "lui-circle-progress-content" },
            h("div", { class: "lui-circle-progress-top" }, props.topText ?? ""),
            h("div", { class: "lui-circle-progress-percent" }, () => `${Math.floor(current.value)}%`),
            h("div", { class: "lui-circle-progress-bottom" }, props.bottomText ?? ""),
          ),
        ),
      ),
    );
  },
);

export default CircleProgress;
