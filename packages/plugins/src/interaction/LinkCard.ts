/**
 * ============================================
 * LinkCard — 外链卡片（纯响应式 VNode 组件）
 * ============================================
 * 渲染外链视频卡片到互动容器
 * 右上角带两半环倒计时关闭按钮（100% → 0 随播放推进消隐，点击即关闭）
 *
 * 响应式写法：class 直接绑定动态表达式（内部读取 signal.value），
 * 编译器（luminaCompile）自动追踪依赖并包装为响应式属性
 *
 * 模式无关设计：组件无「编辑/展示」概念——
 * - onClose 为 undefined 时关闭圆环不注册点击监听（编辑模式不传）
 * - 业务回调（onLinkClick 等）为 undefined 时对应区域不注册监听
 * - bindDrag 为 undefined 时不绑定拖拽（展示模式不传）
 */

import { h } from '@lumina/framework/core';
import type { VNode } from "@lumina/framework/types";
import type { ActiveCardEntry, InteractionLink } from "./types";
import { renderCloseCircle } from "./closeCircle";

// ============================================
// 图标（每次调用产生新 VNode，避免多实例共享同一 VNode 对象）
// ============================================

/** 稍后再看图标 */
function renderSeeLaterIcon(): VNode {
  return h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 20 20",
      width: "20",
      height: "20",
      fill: "currentColor",
      class: "bili-watch-later__icon",
    },
    h("path", {
      d: "M10 3.1248000000000005C6.20305 3.1248000000000005 3.1250083333333336 6.202841666666667 3.1250083333333336 9.999833333333335C3.1250083333333336 13.796750000000001 6.20305 16.874833333333335 10 16.874833333333335C11.898291666666667 16.874833333333335 13.615833333333333 16.106291666666667 14.860625 14.861916666666666C15.104708333333335 14.617916666666666 15.500416666666668 14.617958333333334 15.7445 14.862041666666668C15.9885 15.106166666666669 15.988416666666668 15.501916666666666 15.744333333333334 15.745958333333334C14.274750000000001 17.215041666666668 12.243041666666667 18.124833333333335 10 18.124833333333335C5.512691666666667 18.124833333333335 1.8750083333333334 14.487125 1.8750083333333334 9.999833333333335C1.8750083333333334 5.512483333333334 5.512691666666667 1.8748000000000002 10 1.8748000000000002C14.487291666666668 1.8748000000000002 18.125 5.512483333333334 18.125 9.999833333333335C18.125 10.304458333333333 18.108208333333334 10.605458333333333 18.075458333333337 10.901791666666668C18.0375 11.244916666666667 17.728625 11.492291666666667 17.385583333333333 11.454333333333334C17.0425 11.416416666666667 16.795083333333334 11.107541666666668 16.833000000000002 10.764458333333334C16.860750000000003 10.513625000000001 16.875 10.2585 16.875 9.999833333333335C16.875 6.202841666666667 13.796958333333333 3.1248000000000005 10 3.1248000000000005z",
      fill: "currentColor",
    }),
    h("path", {
      d: "M15.391416666666666 9.141166666666667C15.635458333333334 8.897083333333335 16.031208333333332 8.897083333333335 16.275291666666668 9.141166666666667L17.5 10.365875L18.72475 9.141166666666667C18.968791666666668 8.897083333333335 19.364541666666668 8.897083333333335 19.608625 9.141166666666667C19.852666666666668 9.385291666666667 19.852666666666668 9.780958333333334 19.608625 10.025083333333333L18.08925 11.544416666666669C17.763833333333334 11.869833333333334 17.236208333333334 11.869833333333334 16.91075 11.544416666666669L15.391416666666666 10.025083333333333C15.147333333333334 9.780958333333334 15.147333333333334 9.385291666666667 15.391416666666666 9.141166666666667z",
      fill: "currentColor",
    }),
    h("path", {
      d: "M12.499333333333334 9.278375C13.05475 9.599 13.05475 10.400666666666668 12.499333333333334 10.721291666666668L9.373916666666666 12.525791666666668C8.818541666666667 12.846416666666666 8.124274999999999 12.445583333333333 8.124274999999999 11.804291666666668L8.124274999999999 8.1954C8.124274999999999 7.554066666666667 8.818541666666667 7.153233333333334 9.373916666666666 7.473900000000001L12.499333333333334 9.278375z",
      fill: "currentColor",
    }),
  );
}

// ============================================
// 类名常量
// ============================================

const CLASS_NAMES = {
  HL_LINK: "nova-danmaku-x-link",
  HL_LINK_LEFT: "nova-danmaku-x-link-left",
  HL_LINK_ICON: "nova-danmaku-x-link-icon",
  HL_LINK_MSG: "nova-danmaku-x-link-msg",
  HL_LINK_LINE: "nova-danmaku-x-link-line",
  HL_LINK_RIGHT: "nova-danmaku-x-link-right",
  HL_LINK_WATCHLATER: "nova-danmaku-x-link-watchlater",
  HL_LINK_WATCHLATER_ICON: "nova-danmaku-x-link-watchlater-icon",
  HL_SHOW: "nova-danmaku-x-show",
} as const;

// ============================================
// 卡片渲染选项
// ============================================

/**
 * 外链卡片渲染选项
 *
 * 模式差异由「是否传回调」表达，组件内部无模式概念：
 * - 展示模式：业务回调 + onClose 全部传入
 * - 编辑模式：仅传 bindDrag（关闭圆环渲染但不响应点击）
 */
export interface LinkCardOptions {
  /** 链接主体点击回调（undefined 时不注册监听） */
  onLinkClick?: (link: InteractionLink) => void;
  /** 稍后再看点击回调 */
  onWatchLater?: () => void;
  /** 关闭按钮点击回调（触发卡片淡出并删除 DOM；undefined 时圆环不注册点击） */
  onClose?: () => void;
  /**
   * 拖拽绑定器（仅编辑模式提供）：接收卡片根元素，
   * 返回清理函数供条目移除时解绑（undefined 时不绑定拖拽）
   */
  bindDrag?: (el: HTMLDivElement) => (() => void) | void;
}

// ============================================
// 卡片渲染
// ============================================

/**
 * 渲染外链视频卡片
 *
 * @param entry - 活跃卡片条目（show 驱动显隐过渡，remaining 驱动关闭环倒计时）
 * @param options - 渲染选项（回调可选，未传则不注册对应监听）
 * @returns 卡片根元素 VNode
 */
export function renderLinkCard(
  entry: ActiveCardEntry<InteractionLink>,
  options: LinkCardOptions,
): VNode {
  const { item } = entry;
  const { onLinkClick, onWatchLater, onClose, bindDrag } = options;

  return h(
    "div",
    {
      // 定位变量为静态 style（编辑模式拖拽由 dragEditor 直接 setProperty 覆盖）
      style: { "--top": `${item.top}%`, "--left": `${item.left}%` },
      // 编辑模式：根元素挂载时交给绑定器，清理函数存入条目供移除时调用
      ref: bindDrag
        ? (el: Element): void => {
            if (!(el instanceof HTMLDivElement)) return;
            entry.dragCleanup?.();
            entry.dragCleanup = bindDrag(el) ?? null;
          }
        : undefined,
      // 根类名直接表达式：显隐过渡类（.nova-danmaku-x-show）
      class: entry.show.value
        ? `${CLASS_NAMES.HL_LINK} ${CLASS_NAMES.HL_SHOW}`
        : CLASS_NAMES.HL_LINK,
    },
    // 右上角两半环倒计时关闭按钮（onClose 缺省时仅渲染不注册点击）
    renderCloseCircle(
      entry.remaining,
      onClose
        ? (): void => {
            onClose();
          }
        : undefined,
    ),
    // 链接主体区（点击跳转外链）
    h(
      "div",
      {
        class: CLASS_NAMES.HL_LINK_LEFT,
        onClick: onLinkClick
          ? (e: Event): void => {
              e.stopPropagation();
              onLinkClick(item);
            }
          : undefined,
      },
      h("div", { class: CLASS_NAMES.HL_LINK_ICON }),
      // 响应式文案（显式 getter 协议）：读取 contentVersion 建立依赖，
      // updateCardContent 修改 linkContent 后版本号自增 → 文本节点精准更新
      h(
        "div",
        { class: CLASS_NAMES.HL_LINK_MSG },
        (): string => {
          void entry.contentVersion.value;
          return item.linkContent || "这是一个什么视频";
        },
      ),
    ),
    // 中间分隔线
    h("div", { class: CLASS_NAMES.HL_LINK_LINE }),
    // 右侧稍后再看区
    h(
      "div",
      { class: CLASS_NAMES.HL_LINK_RIGHT },
      h(
        "div",
        {
          class: CLASS_NAMES.HL_LINK_WATCHLATER,
          onClick: onWatchLater
            ? (e: Event): void => {
                e.stopPropagation();
                onWatchLater();
              }
            : undefined,
        },
        h(
          "span",
          { class: CLASS_NAMES.HL_LINK_WATCHLATER_ICON },
          renderSeeLaterIcon(),
        ),
        h("span", {}, "稍后再看"),
      ),
    ),
  );
}
