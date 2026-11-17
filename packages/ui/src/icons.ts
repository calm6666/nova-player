/**
 * ============================================
 * @lumina/ui 图标集
 * ============================================
 * 与 nano-ui（bui-*）组件配套的最小内联 SVG 图标。
 * 全部返回 VNode，可在 SSR 与客户端编译器中安全使用。
 */

import { h } from "@lumina/framework/core";
import type { VNode } from "@lumina/framework/types";

const svg = (children: VNode[], viewBox = "0 0 24 24"): VNode =>
  h(
    "svg",
    { viewBox, version: "1.1", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true" },
    ...children,
  );

/** 复选框：未选中（圆角方框） */
export const CheckboxDefaultIcon = (): VNode =>
  svg([
    h("rect", {
      x: "3",
      y: "3",
      width: "18",
      height: "18",
      rx: "3",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
    }),
  ]);

/** 复选框：选中（圆角方框 + 对勾） */
export const CheckboxSelectedIcon = (): VNode =>
  svg([
    h("rect", { x: "3", y: "3", width: "18", height: "18", rx: "3", fill: "currentColor" }),
    h("path", {
      d: "M7.5 12.5l3 3 6-6.5",
      fill: "none",
      stroke: "#fff",
      "stroke-width": "2.2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  ]);

/** 单选：未选中 */
export const RadioDefaultIcon = (): VNode =>
  svg([
    h("circle", {
      cx: "12",
      cy: "12",
      r: "8",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
    }),
  ]);

/** 单选：选中 */
export const RadioSelectedIcon = (): VNode =>
  svg([
    h("circle", { cx: "12", cy: "12", r: "8", fill: "currentColor" }),
    h("circle", { cx: "12", cy: "12", r: "3", fill: "#fff" }),
  ]);

/** 下拉箭头 */
export const ChevronDownIcon = (): VNode =>
  svg([
    h("path", {
      d: "M5 9l7 7 7-7",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  ]);

/** 关闭 */
export const CloseIcon = (): VNode =>
  svg([
    h("path", {
      d: "M6 6l12 12M18 6L6 18",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
    }),
  ]);

/** 左/右箭头（swiper 两侧） */
export const EnterIcon = (): VNode =>
  svg([
    h("path", {
      d: "M9 5l7 7-7 7",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  ]);

/** 滑块默认 thumb 图标 */
export const ThumbIcon = (): VNode =>
  svg([
    h("circle", { cx: "12", cy: "12", r: "9", fill: "currentColor" }),
  ]);
