/**
 * 响应式指令系统
 *
 * 内置指令（由 mount.ts applyAttrs 识别）：
 * - v-model：双向绑定（input/textarea/select/checkbox/radio）
 * - v-show：显隐控制（display:none）
 * - v-text：文本绑定（textContent）
 * - v-html：HTML 绑定（innerHTML）
 *
 * 自定义指令：通过 directive(name, fn) 注册，mount.ts 遇到 v-xxx 时查注册表调用
 *
 * 指令函数签名：DirectiveFn = (el: Element, val: unknown) => void | (() => void)
 * 返回的清理函数会在 destroy 时自动调用
 */

import type { DirectiveFn } from "../types/index";

/**
 * 自定义指令注册表
 *
 * key 为指令名（不含 v- 前缀），value 为指令处理函数
 * mount.ts 遇到 v-xxx 属性时，先检查内置指令，再查此注册表
 */
const directiveRegistry = new Map<string, DirectiveFn>();

/**
 * 注册自定义指令
 *
 * @param name - 指令名（不含 v- 前缀，如 'focus' 对应 v-focus）
 * @param fn - 指令处理函数
 *
 * @example
 * directive('focus', (el, val) => {
 *   if (val) (el as HTMLElement).focus();
 * });
 * // 使用：h('input', { 'v-focus': true })
 */
export function directive(name: string, fn: DirectiveFn): void {
  directiveRegistry.set(name, fn);
}

/**
 * 查询已注册的自定义指令
 *
 * @param name - 指令名（不含 v- 前缀）
 * @returns 指令处理函数或 undefined
 */
export function getDirective(name: string): DirectiveFn | undefined {
  return directiveRegistry.get(name);
}
