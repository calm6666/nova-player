/**
 * ============================================
 * Tabs 标签页（nano-ui: bui-tabs → lui-tabs）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";
import { rootClass, type UiOption } from "../shared";

export type TabsType = "normal" | "dropdown";

export interface TabsProps {
  /** 选项 */
  items?: UiOption[];
  /** 初始值 */
  value?: string | number;
  /** 形态 */
  type?: TabsType;
  /** 每个 tab 的内容（不传则空 div） */
  renderBody?: (item: UiOption, index: number) => VNode | string | null;
  /** 深色 */
  dark?: boolean;
  /** 变化回调 */
  onChange?: (value: string | number) => void;
}

export interface TabsApi {
  setValue: (value: string | number) => void;
  getValue: () => string | number | undefined;
}

export const Tabs = defineComponent<TabsProps>(
  (props: TabsProps, lifecycle: ComponentLifecycle) => {
    const items = props.items ?? [];
    const current = signal<string | number | undefined>(props.value ?? items[0]?.value);
    const type = props.type ?? "normal";

    const setValue = (value: string | number): void => {
      current.value = value;
      props.onChange?.(value);
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("tabsMounted", {
        setValue,
        getValue: () => current.value,
      } satisfies TabsApi);
    };

    return h(
      "div",
      { class: rootClass("tabs", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          { class: "lui-tabs-wrap" },
          h(
            "div",
            { class: "lui-tabs-header" },
            ...(type === "dropdown"
              ? []
              : items.map((item) =>
                  h(
                    "div",
                    {
                      class: [
                        "lui-tabs-header-item",
                        { "lui-tabs-header-item-active": item.value === current.value },
                      ],
                      "data-value": item.value,
                      onClick: () => setValue(item.value),
                    },
                    item.name,
                  ),
                )),
          ),
          h(
            "div",
            { class: "lui-tabs-body" },
            ...items.map((item, index) =>
              h(
                "div",
                {
                  class: [
                    "lui-tabs-body-item",
                    { "lui-tabs-body-item-active": item.value === current.value },
                  ],
                },
                props.renderBody?.(item, index) ?? null,
              ),
            ),
          ),
        ),
      ),
    );
  },
);

export default Tabs;
