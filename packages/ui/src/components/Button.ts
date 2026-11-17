/**
 * ============================================
 * Button 按钮（nano-ui: bui-button → lui-button）
 * ============================================
 */

import { h, defineComponent } from "@lumina/framework/core";
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";
import { rootClass } from "../shared";

/** 按钮类型（对应原 less 中的 bui-button-* 修饰类） */
export type ButtonType =
  | "default"
  | "white"
  | "blue"
  | "blue2"
  | "gray"
  | "gray2"
  | "gray3"
  | "yellow"
  | "transparent"
  | "border"
  | "text"
  | "large"
  | "small";

export interface ButtonProps {
  /** 按钮文字（也可作为默认插槽） */
  text?: string;
  /** 按钮类型，默认 white */
  type?: ButtonType;
  /** 禁用 */
  disabled?: boolean;
  /** 深色 */
  dark?: boolean;
  /** 点击回调（禁用时不触发） */
  onClick?: () => void;
}

export const Button = defineComponent<ButtonProps>(
  (props: ButtonProps, lifecycle: ComponentLifecycle) => {
    const handleClick = (): void => {
      if (props.disabled) return;
      props.onClick?.();
    };
    const type = props.type ?? "white";
    const areaClass = type === "default" ? "lui-area" : ["lui-area", `lui-button-${type}`];
    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("buttonMounted", {});
    };
    return h(
      "div",
      { class: rootClass("button", props), onClick: handleClick },
      h("div", { class: areaClass as string | Array<string> }, props.text ?? ""),
    );
  },
);

export default Button;
export type { VNode };
