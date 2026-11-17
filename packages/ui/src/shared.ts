/**
 * ============================================
 * @lumina/ui 共享工具
 * ============================================
 */

import type { VNode } from "@lumina/framework/types";

/** 组件值类型 */
export type UiValue = string | number;

/**
 * 组件根类名：`lui lui-<name>`，附加 disabled 状态类
 *
 * 深色主题不通过组件 prop / 根类切换，而是由全局 `.lui-theme-dark`
 * 覆盖 `--nova-*` CSS 变量完成（见 styles/_variables.scss）。
 */
export const rootClass = (
  name: string,
  state?: { dark?: boolean; disabled?: boolean },
): Array<string | Record<string, boolean>> => [
  "lui",
  `lui-${name}`,
  {
    "lui-disabled": Boolean(state?.disabled),
  },
];

/** 单选组唯一 name 序号 */
let radioUid = 0;
export const nextRadioUid = (): number => ++radioUid;

/** 统一空节点 */
export const nothing = (): null => null;

/** 候选列表项 */
export interface UiOption<T = UiValue> {
  value: T;
  name: string;
  disabled?: boolean;
  className?: string;
  [key: string]: unknown;
}

/** 通用下拉/菜单项回调 */
export type SelectHandler<T = UiValue> = (value: T) => void;

/** 判断是否是 VNode（用于内容插槽） */
export const isVNode = (value: unknown): value is VNode =>
  typeof value === "object" && value !== null && "type" in (value as Record<string, unknown>);
