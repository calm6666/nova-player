/**
 * ============================================
 * 互动视频插件 — SVG 图标渲染函数（纯响应式 VNode 工厂）
 * ============================================
 * 剧情进度条节点圆点的双态图标（normal 常态 / hover 悬停态）与重播图标。
 * 每次调用产生新 VNode，避免多实例共享同一 VNode 对象（与
 * interaction 插件 GuideCard 的图标渲染函数同模式）。
 *
 * SVG 内容与既有 Nova 播放器互动视频的图标一致：
 * - 位置图标（正在观看的节点）：水滴定位图案
 * - 打勾图标（已看完的节点）：圆底对勾
 * - 重播图标：环形箭头
 * 悬停态仅将圆底填充色换为 #00A1D6。
 */

import { h } from "@/core";
import type { VNode } from "@/types";

/**
 * 渲染「正在观看节点」的位置图标（水滴定位图案）
 *
 * @param isHover - 是否悬停态（true = #00A1D6 蓝底 / false = 黑底 80%）
 * @returns 位置图标 VNode
 */
export function renderPositionIcon(isHover: boolean): VNode {
  return h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      "data-pointer": "none",
      viewBox: "0 0 36 36",
    },
    h("circle", {
      cx: "18",
      cy: "18",
      r: "14.5",
      fill: isHover ? "#00A1D6" : "#000",
      "fill-opacity": isHover ? "1" : ".8",
      stroke: "#FFF",
      "stroke-opacity": ".8",
    }),
    h("path", {
      fill: "#FFF",
      d: "M18 26c-4.667-3.794-7-7.032-7-9.714C11 12.262 14.134 9 18 9s7 3.262 7 7.286c0 2.682-2.333 5.92-7 9.714Zm0-6a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    }),
  );
}

/**
 * 渲染「已看完节点」的打勾图标（圆底对勾）
 *
 * @param isHover - 是否悬停态（true = #00A1D6 蓝底 / false = 黑底 80%）
 * @returns 打勾图标 VNode
 */
export function renderCheckIcon(isHover: boolean): VNode {
  return h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      "data-pointer": "none",
      viewBox: "0 0 36 36",
    },
    // fill="none" 必须保留：两条 path 均为纯描边（无 fill 属性），
    // 缺省时默认填充黑色会把对勾与外弧糊成黑块
    h("g", { fill: "none", "fill-rule": "evenodd", transform: "translate(7 6)" },
      h("circle", {
        cx: "10",
        cy: "12",
        r: "8",
        fill: isHover ? "#00A1D6" : "#000",
        "fill-opacity": isHover ? "1" : ".8",
      }),
      h("path", {
        stroke: "#FFF",
        "stroke-opacity": ".8",
        d: "M14.504 4.206A8.95 8.95 0 0 0 10 3a9 9 0 1 0 0 18 9 9 0 0 0 7.708-13.648",
      }),
      h("path", {
        stroke: "#FFF",
        "stroke-width": "2",
        d: "m5 9.807 5.641 5.642L20.881 5",
      }),
    ),
  );
}

/**
 * 渲染重播图标（环形箭头，白色）
 *
 * @returns 重播图标 VNode
 */
export function renderReplayIcon(): VNode {
  return h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      "xml:space": "preserve",
      "data-pointer": "none",
      viewBox: "0 0 28 28",
    },
    h("path", {
      fill: "#fff",
      d: "M14.158 6.212c-4.404 0-8.06 3.656-8.06 8.06s3.656 8.06 8.06 8.06c2.806 0 5.318-1.414 6.859-3.717.195-.392.708-.734 1.132-.734.765 0 1.413.594 1.413 1.413 0 .171-.033.307-.093.458a.605.605 0 0 0-.021.145l-.079.123c-1.981 3.096-5.382 5.026-9.096 5.026A10.728 10.728 0 0 1 3.5 14.273 10.73 10.73 0 0 1 14.273 3.5c2.591 0 5.021.919 6.921 2.532v-.549c0-.733.564-1.299 1.297-1.299a1.28 1.28 0 0 1 1.299 1.299v3.996a1.28 1.28 0 0 1-1.299 1.299h-3.996a1.278 1.278 0 0 1-1.297-1.299c0-.783.472-1.413 1.297-1.413h.787c-1.46-1.179-3.26-1.854-5.124-1.854z",
    }),
  );
}
