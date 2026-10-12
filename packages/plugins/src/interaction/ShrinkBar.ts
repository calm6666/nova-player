/**
 * ============================================
 * ShrinkBar — 左下角缩小条目（纯响应式 VNode 组件）
 * ============================================
 * 展示模式下卡片被手动关闭（关闭环未归零时点击 ×）后，在互动区
 * 左下角生成的倒计时残留条目：
 *
 * DOM 结构（对齐参考 DOM）：
 * ```html
 * <div class="nova-danmaku-x-cmd-shrink" style="--scale:1">
 *   <div class="nova-danmaku-x-shrink-title">推荐</div>
 *   <div class="nova-danmaku-x-circle"
 *        style="--width:26px;--height:26px;--color:#ffffffb3">
 *     <div class="nova-danmaku-x-circle-left">…半环…</div>
 *     <div class="nova-danmaku-x-circle-right">…半环…</div>
 *     <img class="nova-danmaku-x-shrink-img" src="...">
 *   </div>
 * </div>
 * ```
 *
 * 视觉与交互：
 * - 位置 left:23px / bottom:71px（CSS 常量，缩放经 --scale CSS 变量）；
 *   全屏 / 网页全屏（容器 data-screen="full"/"web"）下 bottom 抬到 96px
 *   —— 全屏控制栏高 73px 会盖住 71px 档（scss 的媒体查询适配段）
 * - 深色胶囊（高 30px 圆角 20px），左侧 26px 进度环中心为卡片类型图标
 * - 进度环沿用卡片关闭时刻的剩余比例继续随播放倒数，归零后条目移除
 * - 点击条目任意区域重新打开原卡片（由插件清除关闭标记并重建显示）
 */

import { h } from "@/core";
import type { VNode } from "@/types";
import type { ShrinkCardEntry } from "./types";
import { renderShrinkRing } from "./closeCircle";

// ============================================
// 类名常量
// ============================================

const CLASS_NAMES = {
  HL_CMD_SHRINK: "nova-danmaku-x-cmd-shrink",
  HL_SHRINK_TITLE: "nova-danmaku-x-shrink-title",
  HL_SHOW: "nova-danmaku-x-show",
} as const;

// ============================================
// 渲染选项
// ============================================

/** 缩小条目渲染选项（点击回调必有：条目存在的意义就是点击重开） */
export interface ShrinkBarOptions {
  /** 条目点击回调（插件清除关闭标记并重新显示原卡片） */
  onClick: () => void;
}

// ============================================
// 渲染
// ============================================

/**
 * 渲染左下角缩小条目
 *
 * @param entry - 缩小条目（remaining 驱动进度环继续倒数，show 驱动淡入）
 * @param options - 渲染选项（onClick 必传）
 * @returns 条目根元素 VNode
 */
export function renderShrinkBar(
  entry: ShrinkCardEntry,
  options: ShrinkBarOptions,
): VNode {
  return h(
    "div",
    {
      // 缩放经 --scale CSS 变量（新元素统一缩放协议）；
      // 位置为 CSS 常量（left:23px / bottom:71px，全屏档 96px 见 scss），不随卡片定位
      style: { "--scale": "1" },
      // 条目显隐类直接表达式（默认 opacity:0，show 翻转播放 0.35s 淡入）
      class:
        entry.show.value === true
          ? `${CLASS_NAMES.HL_CMD_SHRINK} ${CLASS_NAMES.HL_SHOW}`
          : CLASS_NAMES.HL_CMD_SHRINK,
      // 点击整条重开原卡片
      onClick: (): void => {
        options.onClick();
      },
    },
    // 标题（推荐 / 投票，由卡片类型映射）
    h("div", { class: CLASS_NAMES.HL_SHRINK_TITLE }, entry.title),
    // 26px 进度环（中心为卡片类型图标，继续倒数至归零）
    renderShrinkRing(entry.remaining, entry.icon),
  );
}
