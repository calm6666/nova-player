/**
 * ============================================
 * 互动视频插件 — 分支选择倒计时（纯响应式 VNode 组件）
 * ============================================
 * 分支选择时间窗内贴底全宽的白色进度条（剩余时间 100% → 0）。
 *
 * 响应式写法（与 interaction 插件关闭环 remaining 信号同模式）：
 * 主类在 TIME_UPDATE 里按 (timeEnd - time) / (timeEnd - timeStart)
 * 写入 ratio 信号，本组件 width 表达式读信号原位更新；
 * CSS transition（width 0.5s linear）抹平 TIME_UPDATE 上报周期
 * 的阶梯感，呈现平滑倒计时；归零自动选择由主类在 TIME_UPDATE
 * 判定（time >= timeEnd → handleSelect 默认项）。
 *
 * 结构：
 * .nova-player-interaction-countdown（visible 信号驱动显隐）
 *   └─ .nova-player-interaction-countdown-bar（width 表达式随 ratio 更新）
 */

import { h } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";

/**
 * 渲染倒计时进度条
 *
 * @param ratio - 剩余比例信号（1 → 0，主类 TIME_UPDATE 驱动）
 * @param visible - 显隐信号（display 表达式驱动）
 * @returns 倒计时根 VNode
 */
export function renderCountdown(
  ratio: Signal<number>,
  visible: Signal<boolean>,
): VNode {
  return h(
    "div",
    {
      class: "nova-player-interaction-countdown",
      // display 表达式：visible 信号驱动显隐
      style: { display: visible.value ? "block" : "none" },
    },
    h("div", {
      class: "nova-player-interaction-countdown-bar",
      // width 表达式：ratio 信号驱动剩余宽度（CSS transition 平滑）
      style: { width: `${ratio.value * 100}%` },
    }),
  );
}
