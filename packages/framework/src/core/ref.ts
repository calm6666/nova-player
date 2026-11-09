/**
 * ============================================
 * Ref 引用工具模块
 * ============================================
 * 提供类型安全的 DOM 元素引用机制
 *
 * @deprecated 推荐使用 useTemplateRef（返回响应式 Signal，销毁自动清理）
 * 本 ref() 返回 { current } 对象，仅作向后兼容保留。
 */

import type { Ref } from '../types/index';

export type { Ref };

/**
 * 创建一个类型安全的元素引用（旧版对象 ref，向后兼容）
 *
 * @deprecated 请改用 useTemplateRef：`const el = useTemplateRef<HTMLDivElement>(lc, 'el')`
 * 并在 h() 中写 `ref: 'el'`。新版返回 Signal，销毁时自动清空，更安全。
 *
 * @typeParam T - 引用的元素类型，默认为 Element
 * @returns 包含 current 属性的引用对象
 */
export function ref<T = Element>(): Ref<T> {
  const result: Ref<T> = { current: null };
  return result;
}
