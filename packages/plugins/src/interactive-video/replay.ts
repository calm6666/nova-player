/**
 * ============================================
 * 互动视频插件 — 重播按钮（纯响应式 VNode 组件）
 * ============================================
 * 互动视频播完（当前节点无后续分支或路径走完）时显示的右上角
 * 「重播」按钮：环形箭头图标 + 文案，点击触发 onReplay
 * （主类重置路径并跳回起始节点）。
 *
 * 响应式写法：visible 信号驱动 display 表达式显隐，
 * 文案经 t() 本地化（主类传入已解析字符串，避免组件内重复调用）。
 *
 * 结构：
 * .nova-player-interaction-replay（visible 信号驱动显隐）
 *   ├─ .nova-player-interaction-replay-icon > svg
 *   └─ span（文案）
 */

import { h } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";
import { renderReplayIcon } from "./icons";

/**
 * 渲染重播按钮
 *
 * @param visible - 显隐信号（display 表达式驱动）
 * @param label - 按钮文案（已本地化，如「重播」/「Replay」）
 * @param onReplay - 点击回调（主类执行重置路径 + 跳回起始节点）
 * @returns 重播按钮根 VNode
 */
export function renderReplay(
  visible: Signal<boolean>,
  label: string,
  onReplay: () => void,
): VNode {
  return h(
    "div",
    {
      class: "nova-player-interaction-replay",
      // display 表达式：visible 信号驱动显隐
      style: { display: visible.value ? "inline-flex" : "none" },
      // 阻止冒泡：避免点击穿透到播放器触发播放/暂停
      onClick: (event: Event): void => {
        event.stopPropagation();
        onReplay();
      },
    },
    // 重播图标（环形箭头）
    h(
      "span",
      { class: "nova-player-interaction-replay-icon" },
      renderReplayIcon(),
    ),
    // 重播文案（主类传入本地化字符串）
    h("span", { class: "nova-player-interaction-replay-text" }, label),
  );
}
