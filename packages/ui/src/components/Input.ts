/**
 * ============================================
 * Input 输入框（nano-ui: bui-input → lui-input）
 * ============================================
 */

import { h, defineComponent, signal, useTemplateRef } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass } from "../shared";

export type InputType = "text" | "number" | "textarea";

export interface InputProps {
  /** 输入类型，默认 text */
  type?: InputType;
  /** 初始值 */
  value?: string | number;
  /** 占位符 */
  placeholder?: string;
  /** number 步长 */
  step?: number;
  /** number 最大值 */
  max?: number;
  /** number 最小值 */
  min?: number;
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 值变化回调 */
  onInput?: (value: string) => void;
}

export interface InputApi {
  setValue: (value: string) => void;
  getValue: () => string;
}

export const Input = defineComponent<InputProps>(
  (props: InputProps, lifecycle: ComponentLifecycle) => {
    const value = signal<string>(String(props.value ?? ""));
    const inputRef = useTemplateRef<HTMLInputElement | HTMLTextAreaElement>(lifecycle, "inputRef");

    const emitValue = (): void => {
      props.onInput?.(value.value);
    };

    const handleInput = (event: Event): void => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        value.value = target.value;
        emitValue();
      }
    };

    const step = (delta: number): void => {
      const num = Number(value.value || 0) + delta * (props.step ?? 1);
      const max = props.max ?? Infinity;
      const min = props.min ?? -Infinity;
      value.value = String(Math.min(max, Math.max(min, num)));
      if (inputRef.value) inputRef.value.value = value.value;
      emitValue();
    };

    const setValue = (next: string): void => {
      value.value = next;
      if (inputRef.value) inputRef.value.value = next;
      emitValue();
    };

    lifecycle.onMounted = (): void => {
      if (inputRef.value) inputRef.value.value = value.value;
      lifecycle.emit?.("inputMounted", {
        setValue,
        getValue: () => value.value,
      } satisfies InputApi);
    };

    const type = props.type ?? "text";
    const area = h(
      "div",
      { class: "lui-input-wrap" },
      type === "textarea"
        ? h("textarea", {
            class: "lui-input-input",
            placeholder: props.placeholder,
            disabled: Boolean(props.disabled),
            ref: "inputRef",
            onInput: handleInput,
          }, value.value)
        : h("input", {
            class: "lui-input-input",
            type: type === "number" ? "number" : "text",
            placeholder: props.placeholder,
            value: value.value,
            step: type === "number" ? props.step : undefined,
            max: type === "number" ? props.max : undefined,
            min: type === "number" ? props.min : undefined,
            disabled: Boolean(props.disabled),
            ref: "inputRef",
            onInput: handleInput,
          }),
      type === "number"
        ? h(
            "div",
            { class: "lui-input-stepper" },
            h(
              "div",
              { class: "lui-input-stepper-half lui-input-stepper-up", onClick: () => step(1) },
              h("span", { class: "lui-input-arrow lui-input-arrow-up" }),
            ),
            h(
              "div",
              { class: "lui-input-stepper-half lui-input-stepper-down", onClick: () => step(-1) },
              h("span", { class: "lui-input-arrow lui-input-arrow-down" }),
            ),
          )
        : null,
    );

    return h(
      "div",
      { class: rootClass("input", props) },
      h("div", { class: "lui-area" }, area),
    );
  },
);

export default Input;
