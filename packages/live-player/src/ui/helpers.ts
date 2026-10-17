/**
 * 框架 VNode 渲染辅助。
 *
 * 元素内部统一使用声明式写法：静态结构用 `h`，运行期变化用
 * `__reactiveAttrs` / `_reactiveText` / `For`，不再手写 DOM 拼装。
 */

import { _reactiveText, h } from '@/core';
import type { VNode } from '@/types';

/** 响应式属性绑定（框架 mount 识别的 `__reactiveAttrs` 契约）。 */
export const reactive = (
  getters: Record<string, () => unknown>,
): { __reactiveAttrs: Record<string, () => unknown> } => ({
  __reactiveAttrs: getters,
});

/** 响应式文本节点。 */
export const text = (getter: () => string): VNode => _reactiveText(getter);

/** 内联图标节点。 */
export const icon = (markup: string, className = 'nova-live-player-icon'): VNode =>
  h('span', {
    class: className,
    ref: (el: unknown): void => {
      if (el instanceof HTMLElement) el.innerHTML = markup;
    },
  });
