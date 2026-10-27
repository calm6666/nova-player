/**
 * DanmakuList 内联 SVG 图标集合（单文件集中管理）
 *
 * 路径全部来自源组件的 icons.tsx 与面板内联 SVG：
 * - 折叠箭头 / 下拉三点 / 排序箭头 / 同步 / 复选框 / 日期翻页 / 删除
 * - 高级弹幕确认框关闭按钮（源组件 JSX 内联，移植时统一收口到本文件）
 *
 * 颜色由父级 CSS 控制（fill 继承 currentColor），除排序箭头为固定 #999。
 */

import { h } from "@/core";
import type { VNode } from "@/types";

// ============================================
// 面板骨架图标
// ============================================

/** 折叠箭头（.ui-collapse-arrow svg，由 CSS 控制 fill 与旋转） */
export function CollapseArrowIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 16 16" },
    h("path", {
      d: "m9.188 7.999-3.359 3.359a.75.75 0 1 0 1.061 1.061l3.889-3.889a.75.75 0 0 0 0-1.061L6.89 3.58a.75.75 0 1 0-1.061 1.061l3.359 3.358z",
    }),
  );
}

/** 下拉菜单三点图标（.ui-dropdown-icon svg，viewBox 0 0 4 14） */
export function DropdownIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 4 14" },
    h("path", {
      "fill-rule": "evenodd",
      d: "M.5 2C.5 1.15 1.15.5 2 .5s1.5.65 1.5 1.5S2.85 3.5 2 3.5.5 2.85.5 2Zm0 5c0-.85.65-1.5 1.5-1.5s1.5.65 1.5 1.5S2.85 8.5 2 8.5.5 7.85.5 7Zm0 5c0-.85.65-1.5 1.5-1.5s1.5.65 1.5 1.5-.65 1.5-1.5 1.5S.5 12.85.5 12Z",
    }),
  );
}

/** 排序箭头（.nova-player-dm-btn-icon svg，viewBox 0 0 10 6，fill 固定 #999） */
export function SortArrowIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 10 6" },
    h("path", {
      fill: "#999",
      "fill-rule": "nonzero",
      d: "M4.978 4.79.83.68a.486.486 0 0 0-.69.015.506.506 0 0 0 .01.707l4.515 4.472c.193.191.474.153.666-.037l4.52-4.478A.506.506 0 0 0 9.86.65a.486.486 0 0 0-.689-.015L4.978 4.79Z",
    }),
  );
}

/** 同步屏蔽列表图标（.nova-player-sync-icon svg） */
export function SyncIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 16 16" },
    h("path", {
      "fill-rule": "evenodd",
      d: "M14.25 2c.3 0 .5.2.5.5s-.2.5-.5.5h-1.368A7 7 0 0 1 15 8a7.008 7.008 0 0 1-9.08 6.685.5.5 0 1 1 .297-.955A6.003 6.003 0 0 0 14 8c0-1.715-.737-3.34-2-4.471V5.25c0 .3-.2.5-.5.5s-.5-.2-.5-.5v-2.5c0-.2 0-.4.15-.55.2-.2.4-.2.6-.2ZM8 1c.996 0 1.64.1 2.088.324a.5.5 0 0 1-.448.895C9.347 2.072 8.81 2 8 2 4.691 2 2 4.691 2 8c0 1.713.739 3.337 2 4.469V10.75c0-.3.2-.5.5-.5s.5.2.5.5v2.5c0 .15 0 .35-.2.55-.15.2-.35.2-.5.2H1.75c-.3 0-.5-.2-.5-.5s.2-.5.5-.5h1.366A7.01 7.01 0 0 1 1 8c0-3.86 3.14-7 7-7Z",
    }),
  );
}

// ============================================
// 表单控件图标
// ============================================

/** 复选框未选中（.ui-checkbox-icon-default svg） */
export function CheckboxIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 32 32" },
    h("path", {
      d: "M8 6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H8zm0-2h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z",
    }),
  );
}

/** 复选框选中（.ui-checkbox-icon-selected svg） */
export function CheckboxSelectedIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 32 32" },
    h("path", {
      d: "m13 18.25-1.8-1.8c-.6-.6-1.65-.6-2.25 0s-.6 1.5 0 2.25l2.85 2.85c.318.318.762.468 1.2.448.438.02.882-.13 1.2-.448l8.85-8.85c.6-.6.6-1.65 0-2.25s-1.65-.6-2.25 0l-7.8 7.8zM8 4h16c2.21 0 4 1.79 4 4v16c0 2.21-1.79 4-4 4H8c-2.21 0-4-1.79-4-4V8c0-2.21 1.79-4 4-4z",
    }),
  );
}

// ============================================
// 日期选择器图标
// ============================================

/** 日期选择器上一月（.nova-player-date-picker-btn.btn-prev） */
export function DatePrevIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 16 16" },
    h("path", {
      d: "m6.811 8.001 3.359-3.359a.75.75 0 1 0-1.061-1.061L5.22 7.471a.75.75 0 0 0 0 1.061l3.889 3.888a.75.75 0 1 0 1.061-1.061L6.811 8.001z",
    }),
  );
}

/** 日期选择器下一月（.nova-player-date-picker-btn.btn-next） */
export function DateNextIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 16 16" },
    h("path", {
      d: "m9.188 7.999-3.359 3.359a.75.75 0 1 0 1.061 1.061l3.889-3.889a.75.75 0 0 0 0-1.061L6.89 3.58a.75.75 0 1 0-1.061 1.061l3.359 3.358z",
    }),
  );
}

// ============================================
// 屏蔽列表 / 对话框图标
// ============================================

/** 屏蔽列表删除操作（.nova-player-block-list-delete 的 fill 图标） */
export function TrashIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 16 16" },
    h("path", {
      d: "M5.5 2h5a.5.5 0 0 1 .5.5V3h2.5a.5.5 0 0 1 0 1H14l-.7 9.1a1 1 0 0 1-1 .9H3.7a1 1 0 0 1-1-.9L2 4h-.5a.5.5 0 0 1 0-1H4v-.5a.5.5 0 0 1 .5-.5h1Zm.5 1h4V3H6v0ZM3.1 4l.69 9h8.42l.69-9H3.1Zm3.4 2a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5Zm2.5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5Z",
    }),
  );
}

/** 屏蔽列表同步（.nova-player-block-list-sync 的 fill 图标，复用同步图标） */
export function ListSyncIcon(): VNode {
  return SyncIcon();
}

/** 高级弹幕确认对话框关闭按钮（源组件 JSX 内联 SVG） */
export function CloseIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 16 16" },
    h("path", {
      d: "M8.53 7.47 11.56 4.44a.75.75 0 0 0-1.06-1.06L7.47 6.41 4.44 3.38a.75.75 0 0 0-1.06 1.06L6.41 7.47 3.38 10.5a.75.75 0 0 0 1.06 1.06L7.47 8.53l3.03 3.03a.75.75 0 0 0 1.06-1.06L8.53 7.47z",
    }),
  );
}
