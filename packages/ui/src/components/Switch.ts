/**
 * ============================================
 * Switch 开关（nano-ui: bui-switch → lui-switch）
 * ============================================
 */

import { h, defineComponent, signal, useTemplateRef } from "@lumina/framework/core";
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";
import { rootClass } from "../shared";

export interface SwitchProps {
  /** 初始选中 */
  value?: boolean;
  /** 文字 */
  name?: string;
  /** 圆点内图标 / 内容 */
  content?: VNode | string;
  /** 红点 */
  redDot?: boolean;
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 变化回调 */
  onChange?: (value: boolean) => void;
}

export interface SwitchApi {
  setValue: (value: boolean) => void;
  getValue: () => boolean;
}

export const Switch = defineComponent<SwitchProps>(
  (props: SwitchProps, lifecycle: ComponentLifecycle) => {
    const checked = signal<boolean>(Boolean(props.value));
    const inputRef = useTemplateRef<HTMLInputElement>(lifecycle, "inputRef");

    const setValue = (value: boolean): void => {
      if (props.disabled) return;
      checked.value = value;
      if (inputRef.value) inputRef.value.checked = value;
      props.onChange?.(value);
    };

    const handleChange = (event: Event): void => {
      if (props.disabled || !(event.target instanceof HTMLInputElement)) return;
      checked.value = event.target.checked;
      props.onChange?.(checked.value);
    };

    lifecycle.onMounted = (): void => {
      if (inputRef.value) inputRef.value.checked = checked.value;
      lifecycle.emit?.("switchMounted", {
        setValue,
        getValue: () => checked.value,
      } satisfies SwitchApi);
    };

    return h(
      "div",
      { class: rootClass("switch", props) },
      h(
        "div",
        { class: "lui-area" },
        h("input", {
          class: "lui-switch-input",
          type: "checkbox",
          ref: "inputRef",
          checked: checked.value,
          disabled: Boolean(props.disabled),
          onChange: handleChange,
        }),
        h(
          "label",
          { class: "lui-switch-label" },
          h(
            "span",
            { class: "lui-switch-name" },
            props.name ?? "",
            props.redDot ? h("span", { class: "lui-switch-reddot" }) : null,
          ),
          h(
            "span",
            { class: "lui-switch-body" },
            h(
              "span",
              { class: "lui-switch-dot" },
              h("span", null, props.content ?? ""),
            ),
          ),
        ),
      ),
    );
  },
);

export default Switch;
