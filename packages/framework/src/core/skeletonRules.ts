/**
 * v2 骨架洞的共享判定规则
 *
 * SSR 直出与客户端水合必须使用同一套规则，避免两边各自维护后错位。
 */

import type { SkeletonHole } from "../types/index";

/** 是否为节点位置洞（child / text），参考树需要为它放占位 */
export function isNodePositionHole(hole: SkeletonHole): boolean {
  return hole.kind === "child" || hole.kind === "text";
}

/**
 * 该 child 洞是否参与 SSR 直出
 *
 * SSR 只直出挂在骨架根上的元素根 child 洞；root === -1 的顶层 fragment 洞
 * 不直出，交由客户端挂载。值的类型判断（null / 布尔 / 字符串 / 数字 /
 * 文本根）仍在调用侧完成。
 */
export function isSsrEmittedChildHole(hole: SkeletonHole): boolean {
  return hole.kind === "child" && hole.root !== -1;
}

/** 洞类型签名：参考树缓存据此校验洞结构未变化 */
export function skeletonHoleSignature(holes: readonly SkeletonHole[]): string {
  return holes.map((hole) => hole.kind).join("|");
}
