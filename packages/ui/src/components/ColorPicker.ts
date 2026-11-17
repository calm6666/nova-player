/**
 * ============================================
 * ColorPicker 颜色选择器（nano-ui: bui-color-picker）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass } from "../shared";

export interface ColorPickerProps {
  /** 初始颜色 */
  value?: string;
  /** 可选颜色列表 */
  options?: string[];
  /** 宽度 */
  width?: number;
  /** 间距 */
  gap?: number;
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 变化回调 */
  onChange?: (color: string) => void;
}

export interface ColorPickerApi {
  setValue: (color: string) => void;
  getValue: () => string;
}

const DEFAULT_OPTIONS = [
  "#FE0302", "#FF7204", "#FFAA02", "#FFD302", "#FFFF00", "#A0EE00",
  "#00CD00", "#019899", "#4266BE", "#89D5FF", "#CC0273", "#222222",
  "#9B9B9B", "#FFFFFF",
];

export const ColorPicker = defineComponent<ColorPickerProps>(
  (props: ColorPickerProps, lifecycle: ComponentLifecycle) => {
    const current = signal<string>(props.value ?? "#FFFFFF");
    const colors = props.options ?? DEFAULT_OPTIONS;

    const setValue = (color: string): void => {
      if (props.disabled) return;
      current.value = color;
      props.onChange?.(color);
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("colorPickerMounted", {
        setValue,
        getValue: () => current.value,
      } satisfies ColorPickerApi);
    };

    return h(
      "div",
      { class: rootClass("color-picker", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          { class: "lui-color-picker-wrap" },
          h(
            "div",
            { class: "lui-color-picker-result" },
            h("span", { class: "lui-color-picker-input", style: { color: current.value } }, () => current.value),
            h("span", { class: "lui-color-picker-display", style: { background: current.value } }),
          ),
          h(
            "ul",
            { class: "lui-color-picker-options" },
            ...colors.map((color) =>
              h("li", {
                class: [
                  "lui-color-picker-option",
                  { "lui-color-picker-option-active": current.value === color },
                ],
                style: { background: color },
                "data-value": color,
                onClick: () => setValue(color),
              }),
            ),
          ),
        ),
      ),
    );
  },
);

export default ColorPicker;
