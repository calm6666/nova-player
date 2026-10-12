/**
 * ============================================
 * AlignLines — 拖拽贴边对齐辅助线（响应式组件，仅编辑模式挂载）
 * ============================================
 * 编辑模式下拖动卡片贴边时显示的定位参考线（共四根线段）：
 * - 垂直容器（-vertical）的 before/after 伪元素 = 左竖线 / 右竖线
 * - 水平容器（-horizontal）的 before/after 伪元素 = 上横线 / 下横线
 * 由 CSS 变量驱动位置（--left/--right/--top/--bottom）与
 * 显隐（--left-show/--right-show/--top-show/--bottom-show，带 0.2s opacity 过渡）
 *
 * 响应式实现：全部状态收敛到单一 signal 对象，style 直接绑定动态表达式，
 * 编译器自动追踪 → applyStyle 增量写入 CSS 变量；
 * 取代旧 dragEditor 中 innerHTML 懒创建 + querySelector + setProperty 直写的命令式实现
 */

import { h, signal } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";
import { SAFE_MARGIN } from "./dragEditor";

// ============================================
// 类名常量（与 interaction.scss 的对齐辅助线样式契约一致）
// ============================================

const CLASS_NAMES = {
  LINE_WAP: "nova-danmaku-x-line-wrap",
  LINE: "nova-danmaku-x-line",
  VERTICAL: "nova-danmaku-x-line-vertical",
  HORIZONTAL: "nova-danmaku-x-line-horizontal",
} as const;

// ============================================
// 状态
// ============================================

/** 对齐辅助线的位置与显隐状态（四根线段） */
export interface AlignLinesState {
  /** 左竖线位置（百分比，拖拽左缘贴边时 = minLeft 边界值） */
  left: number;
  /** 右竖线位置（百分比，右缘贴边时 = maxLeft 边界值） */
  right: number;
  /** 上横线位置（百分比，顶缘贴边时 = minTop 边界值） */
  top: number;
  /** 下横线位置（百分比，底缘贴边时 = maxTop 边界值） */
  bottom: number;
  /** 左竖线是否显示 */
  leftShow: boolean;
  /** 右竖线是否显示 */
  rightShow: boolean;
  /** 上横线是否显示 */
  topShow: boolean;
  /** 下横线是否显示 */
  bottomShow: boolean;
}

/**
 * 创建对齐辅助线的初始状态
 *
 * 初始位置 = 视觉安全边界（与 dragEditor 的 SAFE_MARGIN 单一来源）：
 * 左 SAFE_MARGIN.left% / 右 100-SAFE_MARGIN.right% /
 * 上 SAFE_MARGIN.top% / 下 100-SAFE_MARGIN.bottom%（底部预留控制栏），
 * 即卡片边缘贴边时所能到达的极限位置，初始全部隐藏（show 均为 false）
 */
export function createAlignLinesState(): AlignLinesState {
  return {
    left: SAFE_MARGIN.left,
    right: 100 - SAFE_MARGIN.right,
    top: SAFE_MARGIN.top,
    bottom: 100 - SAFE_MARGIN.bottom,
    leftShow: false,
    rightShow: false,
    topShow: false,
    bottomShow: false,
  };
}

/** 创建对齐辅助线的初始 signal（编辑模式挂载时由插件调用一次） */
export function createAlignLinesSignal(): Signal<AlignLinesState> {
  return signal(createAlignLinesState());
}

// ============================================
// 渲染
// ============================================

/**
 * 渲染对齐辅助线（两个容器 div，各自携带 before/after 两条线段）
 *
 * @param lines - 辅助线状态 signal（贴边回调驱动更新）
 * @returns Fragment（垂直容器 + 水平容器）
 */
export function renderAlignLines(lines: Signal<AlignLinesState>): VNode {
  return h(
    "div",
    { class: CLASS_NAMES.LINE_WAP },
    // 垂直容器：before = 左竖线（--left/--left-show），after = 右竖线（--right/--right-show）
    h("div", {
      class: `${CLASS_NAMES.LINE} ${CLASS_NAMES.VERTICAL}`,
      style: {
        "--height": "100%",
        "--left": `${lines.value.left}%`,
        "--left-show": lines.value.leftShow ? "1" : "0",
        "--right": `${lines.value.right}%`,
        "--right-show": lines.value.rightShow ? "1" : "0",
      },
    }),
    // 水平容器：before = 上横线（--top/--top-show），after = 下横线（--bottom/--bottom-show）
    h("div", {
      class: `${CLASS_NAMES.LINE} ${CLASS_NAMES.HORIZONTAL}`,
      style: {
        "--width": "100%",
        "--top": `${lines.value.top}%`,
        "--top-show": lines.value.topShow ? "1" : "0",
        "--bottom": `${lines.value.bottom}%`,
        "--bottom-show": lines.value.bottomShow ? "1" : "0",
      },
    }),
  );
}
