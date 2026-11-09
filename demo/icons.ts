/**
 * SVG 图标组件
 * 替代 Unicode emoji，提供清晰可缩放的矢量图标
 */

import { h, defineComponent } from '@lumina/framework/core';
import type { VNode } from "@lumina/framework/types";

type IconProps = { size?: number; color?: string };

/**
 * 创建 SVG 图标的工厂函数
 * @param paths - SVG path 元素数组
 * @param viewBox - SVG viewBox 属性
 */
function createIcon(
  paths: VNode[],
  viewBox = "0 0 24 24",
): ReturnType<typeof defineComponent<IconProps>> {
  return defineComponent<IconProps>((props) => {
    const size = props.size ?? 16;
    const color = props.color ?? "currentColor";
    return h(
      "svg",
      {
        width: String(size),
        height: String(size),
        viewBox,
        fill: "none",
        stroke: color,
        "stroke-width": "2",
        "stroke-linecap": "round" as const,
        "stroke-linejoin": "round" as const,
        class: "demo-icon",
      },
      ...paths,
    );
  });
}

/** 检查通过（圆形勾选） */
export const IconCheck = createIcon([
  h("path", { d: "M22 11.08V12a10 10 0 1 1-5.93-9.14" }),
  h("polyline", { points: "22 4 12 14.01 9 11.01" }),
]);

/** 错误/失败（圆形叉） */
export const IconX = createIcon([
  h("circle", { cx: "12", cy: "12", r: "10" }),
  h("line", { x1: "15", y1: "9", x2: "9", y2: "15" }),
  h("line", { x1: "9", y1: "9", x2: "15", y2: "15" }),
]);

/** 方框（未选中） */
export const IconSquare = createIcon([
  h("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" }),
]);

/** 太阳（亮色主题） */
export const IconSun = createIcon([
  h("circle", { cx: "12", cy: "12", r: "5" }),
  h("line", { x1: "12", y1: "1", x2: "12", y2: "3" }),
  h("line", { x1: "12", y1: "21", x2: "12", y2: "23" }),
  h("line", { x1: "4.22", y1: "4.22", x2: "5.64", y2: "5.64" }),
  h("line", { x1: "18.36", y1: "18.36", x2: "19.78", y2: "19.78" }),
  h("line", { x1: "1", y1: "12", x2: "3", y2: "12" }),
  h("line", { x1: "21", y1: "12", x2: "23", y2: "12" }),
  h("line", { x1: "4.22", y1: "19.78", x2: "5.64", y2: "18.36" }),
  h("line", { x1: "18.36", y1: "5.64", x2: "19.78", y2: "4.22" }),
]);

/** 月亮（暗色主题） */
export const IconMoon = createIcon([
  h("path", { d: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" }),
]);

/** 锁 */
export const IconLock = createIcon([
  h("rect", { x: "3", y: "11", width: "18", height: "11", rx: "2", ry: "2" }),
  h("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }),
]);

/** 用户 */
export const IconUser = createIcon([
  h("path", { d: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" }),
  h("circle", { cx: "12", cy: "7", r: "4" }),
]);

/** 首页 */
export const IconHome = createIcon([
  h("path", { d: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }),
  h("polyline", { points: "9 22 9 12 15 12 15 22" }),
]);

/** 设置（齿轮） */
export const IconSettings = createIcon([
  h("circle", { cx: "12", cy: "12", r: "3" }),
  h("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" }),
]);

/** 播放（右箭头） */
export const IconChevronRight = createIcon([
  h("polyline", { points: "9 18 15 12 9 6" }),
]);

/** 向下箭头（折叠展开） */
export const IconChevronDown = createIcon([
  h("polyline", { points: "6 9 12 15 18 9" }),
]);

/** 加号 */
export const IconPlus = createIcon([
  h("line", { x1: "12", y1: "5", x2: "12", y2: "19" }),
  h("line", { x1: "5", y1: "12", x2: "19", y2: "12" }),
]);

/** 减号 */
export const IconMinus = createIcon([
  h("line", { x1: "5", y1: "12", x2: "19", y2: "12" }),
]);

/** 重置（逆时针箭头） */
export const IconRefresh = createIcon([
  h("polyline", { points: "1 4 1 10 7 10" }),
  h("path", { d: "M3.51 15a9 9 0 1 0 2.13-9.36L1 10" }),
]);

/** 删除（垃圾桶） */
export const IconTrash = createIcon([
  h("polyline", { points: "3 6 5 6 21 6" }),
  h("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }),
]);

/** 搜索 */
export const IconSearch = createIcon([
  h("circle", { cx: "11", cy: "11", r: "8" }),
  h("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" }),
]);

/** 播放（三角形） */
export const IconPlay = createIcon([
  h("polygon", { points: "5 3 19 12 5 21 5 3" }),
]);

/** 终端/调试 */
export const IconTerminal = createIcon([
  h("polyline", { points: "4 17 10 11 4 5" }),
  h("line", { x1: "12", y1: "19", x2: "20", y2: "19" }),
]);

/** 闪电（水合） */
export const IconZap = createIcon([
  h("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" }),
]);

/** 服务器 */
export const IconServer = createIcon([
  h("rect", { x: "2", y: "2", width: "20", height: "8", rx: "2", ry: "2" }),
  h("rect", { x: "2", y: "14", width: "20", height: "8", rx: "2", ry: "2" }),
  h("line", { x1: "6", y1: "6", x2: "6.01", y2: "6" }),
  h("line", { x1: "6", y1: "18", x2: "6.01", y2: "18" }),
]);

/** 视频 */
export const IconVideo = createIcon([
  h("polygon", { points: "23 7 16 12 23 17 23 7" }),
  h("rect", { x: "1", y: "5", width: "15", height: "14", rx: "2", ry: "2" }),
]);
