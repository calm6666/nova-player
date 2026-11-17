/**
 * ============================================
 * CloseButton 圆环关闭按钮（nano-ui: bui-circle）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";
import { CloseIcon } from "../icons";

export interface CloseButtonProps {
  /** 外环直径 */
  width?: number;
  /** 外环高度 */
  height?: number;
  /** 环颜色 */
  color?: string;
  /** 环内图标 */
  icon?: VNode | string;
  /** 进度 0-100（驱动左右环角度） */
  value?: number;
  /** 点击回调 */
  onClick?: () => void;
}

export interface CloseButtonApi {
  setValue: (value: number) => void;
  getValue: () => number;
}

export const CloseButton = defineComponent<CloseButtonProps>(
  (props: CloseButtonProps, lifecycle: ComponentLifecycle) => {
    const current = signal<number>(Math.max(0, Math.min(100, props.value ?? 0)));

    const setValue = (value: number): void => {
      current.value = Math.max(0, Math.min(100, value));
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("closeButtonMounted", {
        setValue,
        getValue: () => current.value,
      } satisfies CloseButtonApi);
    };

    const leftDeg = (): number => -45 - 3.6 * Math.min(50, current.value);
    const rightDeg = (): number => {
      const rest = current.value - 50;
      return rest <= 0 ? -45 : -45 - 3.6 * rest;
    };

    const width = props.width ?? 16;
    const height = props.height ?? 16;
    const color = props.color ?? "#ffffffb3";

    return h(
      "div",
      {
        class: "lui-circle",
        style: {
          "--width": `${width}px`,
          "--height": `${height}px`,
          "--color": color,
        } as Record<string, string>,
        onClick: props.onClick,
      },
      h(
        "div",
        { class: "lui-circle-left" },
        h("div", { class: "lui-circle-left-bar", style: { "--leftDeg": `${leftDeg()}deg` } as Record<string, string> }),
      ),
      h(
        "div",
        { class: "lui-circle-right" },
        h("div", { class: "lui-circle-right-bar", style: { "--rightDeg": `${rightDeg()}deg` } as Record<string, string> }),
      ),
      props.icon ?? CloseIcon(),
    );
  },
);

export default CloseButton;
