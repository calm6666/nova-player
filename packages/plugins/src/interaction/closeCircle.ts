/**
 * ============================================
 * 关闭按钮 — B 站式两半环倒计时圆环（纯展示组件）
 * ============================================
 * - 双半环（左右各 180°）经 CSS 变量 --leftDeg/--rightDeg 驱动旋转，
 *   由全局样式（interaction.scss 底部）消费
 * - remaining 语义：卡片剩余显示进度，显示瞬间为 1（满环），
 *   随播放推进消隐至 0（空环）——即圆环从 100% → 0 倒数
 * - 响应式写法：style 直接绑定动态表达式（编译器自动追踪 remaining 的
 *   signal 依赖并包装为响应式属性，运行时 applyStyle 增量更新 CSS 变量）
 * - onClick 可选：编辑模式不传时圆环仅渲染、不注册点击监听
 */

import { h } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";

/** 卡片淡出过渡时长（毫秒），与 interaction.scss 的 transition 时长一致 */
export const CARD_FADE_MS = 350;

/**
 * 左半环旋转角（deg）
 *
 * 两段式推进（B 站原版语义）：
 * - 剩余 >= 50%：右半环静止满环，左半环从 -45deg（满环）转到 -225deg（消隐）
 * - 剩余 < 50%：左半环停在消隐角，右半环从 -45deg 转到 -225deg
 */
export function getLeftDeg(remaining: number): number {
  return remaining >= 0.5 ? -45 - (1 - remaining) * 360 : -225;
}

/**
 * 右半环旋转角（deg）
 */
export function getRightDeg(remaining: number): number {
  return remaining >= 0.5 ? -45 : -45 - (0.5 - remaining) * 360;
}

/**
 * 渲染关闭圆环
 *
 * @param remaining - 剩余进度 signal（1 → 0）
 * @param onClick - 点击回调；编辑模式不传（undefined）时仅渲染不注册监听
 */
export function renderCloseCircle(
  remaining: Signal<number>,
  onClick?: () => void,
): VNode {
  return h(
    "span",
    {
      class: "nova-danmaku-x-circle",
      // 动态 style 表达式：remaining 变化 → 编译器包装的响应式 getter 重跑 →
      // applyStyle 增量写入 --leftDeg/--rightDeg → 半环 bar 过渡旋转
      style: {
        "--leftDeg": `${getLeftDeg(remaining.value)}deg`,
        "--rightDeg": `${getRightDeg(remaining.value)}deg`,
      },
      // undefined 时经编译器 __events 预分类后，applyAttrs 的函数守卫自动跳过
      onClick: onClick
        ? (): void => {
            onClick();
          }
        : undefined,
    },
    h("span", { class: "nova-danmaku-x-circle-left" }, h("span", { class: "nova-danmaku-x-circle-left-bar" })),
    h("span", { class: "nova-danmaku-x-circle-right" }, h("span", { class: "nova-danmaku-x-circle-right-bar" })),
    // 中央 × 图标（16 viewBox，与全局 .nova-danmaku-x-circle svg 尺寸契约一致）
    h(
      "svg",
      { viewBox: "0 0 16 16", fill: "none", width: "16", height: "16" },
      h("path", {
        d: "M1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8",
        fill: "#000000",
        "fill-opacity": ".3",
        "fill-rule": "evenodd",
        "clip-rule": "evenodd",
      }),
      h("path", {
        d: "M5.168 5.977a.572.572 0 0 1 .809-.81L8 7.192l2.023-2.023a.572.572 0 0 1 .81.809L8.808 8l2.023 2.023a.572.572 0 1 1-.809.81L8 8.808l-2.023 2.023a.572.572 0 1 1-.81-.809L7.192 8z",
        fill: "#fff",
        "fill-rule": "evenodd",
        "clip-rule": "evenodd",
        opacity: "1",
      }),
    ),
  );
}

/**
 * 渲染缩小条目的进度环（左下角缩小条目专用变体）
 *
 * 与关闭圆环同一套两半环倒计时结构，差异：
 * - 直径 26px（--width/--height），环色 #ffffffb3
 * - 环中心不是 × 图标而是卡片类型图标 img（16x16 圆形，由 CSS 居中）
 * - 环本身不注册点击（点击交互由缩小条目根元素整体承接）
 *
 * @param remaining - 剩余进度 signal（1 → 0，随播放继续倒数至归零）
 * @param icon - 环中心的图标 URL（由卡片类型映射）
 */
export function renderShrinkRing(
  remaining: Signal<number>,
  icon: string,
): VNode {
  return h(
    "span",
    {
      class: "nova-danmaku-x-circle",
      // 26px 环 + 半环旋转角全部经 CSS 变量驱动（与关闭圆环同一机制）
      style: {
        "--width": "26px",
        "--height": "26px",
        "--color": "#ffffffb3",
        "--leftDeg": `${getLeftDeg(remaining.value)}deg`,
        "--rightDeg": `${getRightDeg(remaining.value)}deg`,
      },
    },
    h("span", { class: "nova-danmaku-x-circle-left" }, h("span", { class: "nova-danmaku-x-circle-left-bar" })),
    h("span", { class: "nova-danmaku-x-circle-right" }, h("span", { class: "nova-danmaku-x-circle-right-bar" })),
    // 环中心图标：16x16 + 5px 内边距恰好填满 26px 环（CSS .nova-danmaku-x-shrink-img）
    h("img", { class: "nova-danmaku-x-shrink-img", src: icon, alt: "" }),
  );
}
