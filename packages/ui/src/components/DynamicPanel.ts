/**
 * ============================================
 * DynamicPanel 动态面板（nano-ui: bui-dynamic-panel）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";
import { rootClass } from "../shared";

export interface DynamicPanelProps {
  /** 页面内容 */
  pages?: VNode[];
  /** 当前页 */
  value?: number;
  /** 深色 */
  dark?: boolean;
  /** 页切换回调 */
  onChange?: (index: number) => void;
}

export interface DynamicPanelApi {
  setValue: (index: number) => void;
  getValue: () => number;
}

export const DynamicPanel = defineComponent<DynamicPanelProps>(
  (props: DynamicPanelProps, lifecycle: ComponentLifecycle) => {
    const pages = props.pages ?? [];
    const current = signal<number>(props.value ?? 0);

    const setValue = (index: number): void => {
      current.value = Math.max(0, Math.min(pages.length - 1, index));
      props.onChange?.(current.value);
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("dynamicPanelMounted", {
        setValue,
        getValue: () => current.value,
      } satisfies DynamicPanelApi);
    };

    return h(
      "div",
      { class: rootClass("dynamic-panel", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          { class: "lui-dynamic-panel-wrap" },
          h(
            "div",
            { class: "lui-dynamic-panel-move" },
            ...pages.map((page, index) =>
              h(
                "div",
                {
                  class: [
                    "lui-dynamic-panel-item",
                    { "lui-dynamic-panel-item-active": index === current.value },
                  ],
                },
                page,
              ),
            ),
          ),
        ),
      ),
    );
  },
);

export default DynamicPanel;
