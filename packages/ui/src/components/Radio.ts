/**
 * ============================================
 * Radio 单选组（nano-ui: bui-radio → lui-radio）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass, nextRadioUid, type UiOption } from "../shared";
import { RadioDefaultIcon, RadioSelectedIcon } from "../icons";

export type RadioStyle = "normal" | "button";

export interface RadioProps {
  /** 初始值 */
  value?: string | number | null;
  /** 样式：normal（带图标）/ button（按钮组） */
  style?: RadioStyle;
  /** 选项 */
  labels?: UiOption[];
  /** 每行列数（normal） */
  columnCount?: number;
  /** 列间距 / 按钮间距 */
  columnGap?: number;
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 变化回调 */
  onChange?: (value: string | number) => void;
}

export interface RadioApi {
  setValue: (value: string | number) => void;
  getValue: () => string | number | null;
}

export const Radio = defineComponent<RadioProps>(
  (props: RadioProps, lifecycle: ComponentLifecycle) => {
    const uid = nextRadioUid();
    const current = signal<string | number | null>(props.value ?? null);
    const labels = props.labels ?? [];
    const style = props.style ?? "normal";
    const gap = props.columnGap ?? 8;
    const columns = props.columnCount ?? 3;

    const setValue = (value: string | number): void => {
      if (props.disabled) return;
      current.value = value;
      props.onChange?.(value);
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("radioMounted", {
        setValue,
        getValue: () => current.value,
      } satisfies RadioApi);
    };

    return h(
      "div",
      { class: rootClass("radio", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          { class: ["lui-radio-wrap", `lui-radio-${style}`] },
          h(
            "div",
            {
              class: "lui-radio-group",
              style: style === "button" ? { margin: `0 -${gap / 2}px` } : undefined,
            },
            ...labels.map((item) =>
              h(
                "label",
                {
                  class: "lui-radio-item",
                  style:
                    style === "normal"
                      ? { width: `${Number((100 / columns).toFixed(4))}%` }
                      : { margin: `0 ${gap / 2}px` },
                },
                h("input", {
                  type: "radio",
                  class: "lui-radio-input",
                  name: `lui-radio${uid}`,
                  value: item.value,
                  checked: current.value === item.value,
                  disabled: Boolean(props.disabled || item.disabled),
                  onChange: () => setValue(item.value),
                }),
                h(
                  "span",
                  { class: "lui-radio-label" },
                  ...(style === "normal"
                    ? [
                        h("span", { class: "lui-radio-icon lui-radio-icon-default" }, RadioDefaultIcon()),
                        h("span", { class: "lui-radio-icon lui-radio-icon-selected" }, RadioSelectedIcon()),
                      ]
                    : []),
                  h("span", { class: "lui-radio-text" }, item.name),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  },
);

export default Radio;
