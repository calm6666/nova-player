/**
 * ============================================
 * Progress 进度条（nano-ui: bui-progress → lui-progress）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass } from "../shared";

export interface ProgressStep {
  value: number;
}

export interface ProgressProps {
  /** 0-100 */
  value?: number;
  /** 档位标记 */
  steps?: ProgressStep[] | null;
  /** 数值文本宽度（传了才显示右侧数值） */
  valWidth?: number | null;
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 变化回调 */
  onChange?: (value: number) => void;
}

export interface ProgressApi {
  setValue: (value: number) => void;
  getValue: () => number;
}

export const Progress = defineComponent<ProgressProps>(
  (props: ProgressProps, lifecycle: ComponentLifecycle) => {
    const current = signal<number>(Math.max(0, Math.min(100, props.value ?? 0)));

    const setValue = (value: number): void => {
      current.value = Math.max(0, Math.min(100, value));
      props.onChange?.(current.value);
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("progressMounted", {
        setValue,
        getValue: () => current.value,
      } satisfies ProgressApi);
    };

    return h(
      "div",
      { class: rootClass("progress", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          { class: "lui-progress-wrap" },
          h(
            "div",
            { class: "lui-progress-bar", style: { width: `${current.value}%` } },
            h("span", { class: "lui-progress-dot" }),
          ),
          props.steps && props.steps.length > 0
            ? h(
                "div",
                { class: "lui-progress-step" },
                ...props.steps.map((step) =>
                  h(
                    "div",
                    {
                      class: "lui-progress-item",
                      style: { left: `${step.value}%` },
                    },
                    h("div", { class: "lui-progress-lab" }),
                  ),
                ),
              )
            : null,
        ),
        props.valWidth
          ? h(
              "div",
              {
                class: "lui-progress-val",
                style: { width: `${props.valWidth}px` },
              },
              () => `${Math.floor(current.value)}%`,
            )
          : null,
      ),
    );
  },
);

export default Progress;
