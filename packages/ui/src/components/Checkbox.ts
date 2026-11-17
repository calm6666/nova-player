/**
 * ============================================
 * Checkbox 复选框（nano-ui: bui-checkbox → lui-checkbox）
 * ============================================
 */

import { h, defineComponent, signal, useTemplateRef } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass } from "../shared";
import { CheckboxDefaultIcon, CheckboxSelectedIcon } from "../icons";

export interface CheckboxProps {
  /** 是否选中（初始值） */
  value?: boolean;
  /** 文字 */
  name?: string;
  /** 红点 */
  redDot?: boolean;
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 变化回调 */
  onChange?: (value: boolean) => void;
}

export interface CheckboxApi {
  setValue: (value: boolean) => void;
  getValue: () => boolean;
}

export const Checkbox = defineComponent<CheckboxProps>(
  (props: CheckboxProps, lifecycle: ComponentLifecycle) => {
    const checked = signal<boolean>(Boolean(props.value));
    const inputRef = useTemplateRef<HTMLInputElement>(lifecycle, "inputRef");

    const setValue = (value: boolean): void => {
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
      lifecycle.emit?.("checkboxMounted", {
        setValue,
        getValue: () => checked.value,
      } satisfies CheckboxApi);
    };

    return h(
      "div",
      { class: rootClass("checkbox", props) },
      h(
        "div",
        { class: "lui-area" },
        h("input", {
          class: "lui-checkbox-input",
          type: "checkbox",
          ref: "inputRef",
          checked: checked.value,
          disabled: Boolean(props.disabled),
          "aria-label": props.name ?? "",
          onChange: handleChange,
        }),
        h(
          "label",
          { class: "lui-checkbox-label" },
          h("span", { class: "lui-checkbox-icon lui-checkbox-icon-default" }, CheckboxDefaultIcon()),
          h("span", { class: "lui-checkbox-icon lui-checkbox-icon-selected" }, CheckboxSelectedIcon()),
          h(
            "span",
            { class: "lui-checkbox-name" },
            props.name ?? "",
            props.redDot ? h("span", { class: "lui-checkbox-reddot" }) : null,
          ),
        ),
      ),
    );
  },
);

export default Checkbox;
