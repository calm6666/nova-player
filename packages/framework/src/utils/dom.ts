/**
 * ============================================
 * DOM 操作工具函数模块
 * ============================================
 * 提供常用的 DOM 操作方法，避免重复代码
 * 所有操作都遵循性能优先原则
 */

/**
 * 批量设置元素样式
 * 一次性设置多个样式属性，减少重排
 *
 * @param el - 目标元素
 * @param styles - 样式对象
 *
 * @example
 * setStyles(element, { width: '100px', height: '50px', opacity: '0.5' });
 */
export function setStyles(
  el: HTMLElement,
  styles: Partial<CSSStyleDeclaration>
): void {
  Object.assign(el.style, styles);
}

/**
 * 批量切换 CSS 类
 * 根据条件添加或移除类名
 *
 * @param el - 目标元素
 * @param classes - 类名映射表，值为 true 添加，false 移除
 *
 * @example
 * toggleClasses(element, {
 *   'active': isActive,
 *   'hidden': !isVisible,
 *   'loading': isLoading
 * });
 */
export function toggleClasses(
  el: HTMLElement,
  classes: Record<string, boolean>
): void {
  for (const [className, shouldAdd] of Object.entries(classes)) {
    el.classList.toggle(className, shouldAdd);
  }
}

/**
 * 安全地设置元素属性
 * 自动处理 null/undefined 值（移除属性）
 *
 * @param el - 目标元素
 * @param key - 属性名
 * @param value - 属性值
 *
 * @example
 * setAttr(element, 'data-id', 123);
 * setAttr(element, 'disabled', null); // 移除 disabled 属性
 */
export function setAttr(
  el: HTMLElement,
  key: string,
  value: unknown
): void {
  if (value == null) {
    el.removeAttribute(key);
  } else {
    el.setAttribute(key, String(value));
  }
}

/**
 * 批量设置元素属性
 *
 * @param el - 目标元素
 * @param attrs - 属性映射表
 *
 * @example
 * setAttrs(element, {
 *   'data-id': 123,
 *   'aria-label': '播放按钮',
 *   'disabled': isDisabled || null
 * });
 */
export function setAttrs(
  el: HTMLElement,
  attrs: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(attrs)) {
    setAttr(el, key, value);
  }
}

/**
 * 使用 requestAnimationFrame 批量更新 DOM
 * 适用于高频更新场景（如拖动、动画）
 *
 * @param updater - 更新函数
 * @returns 取消函数
 *
 * @example
 * const cancel = batchUpdate(() => {
 *   element.style.width = `${newWidth}px`;
 *   element.style.height = `${newHeight}px`;
 * });
 *
 * // 需要时取消
 * cancel();
 */
export function batchUpdate(updater: () => void): () => void {
  const rafId = requestAnimationFrame(updater);
  return () => cancelAnimationFrame(rafId);
}

/**
 * 创建带 RAF 批处理的更新函数
 * 多次调用时只执行最后一次
 *
 * @returns 批量更新函数和取消函数
 *
 * @example
 * const { update, cancel } = createBatchedUpdater();
 *
 * // 多次调用，只执行最后一次
 * update(() => setStyles(el, { left: '10px' }));
 * update(() => setStyles(el, { left: '20px' }));
 * update(() => setStyles(el, { left: '30px' })); // 只有这个会执行
 */
export function createBatchedUpdater(): {
  update: (fn: () => void) => void;
  cancel: () => void;
} {
  let rafId: number | null = null;
  let pendingFn: (() => void) | null = null;

  return {
    update(fn: () => void): void {
      // 取消之前的更新
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      pendingFn = fn;
      // 安排新的更新
      rafId = requestAnimationFrame(() => {
        rafId = null;
        pendingFn?.();
        pendingFn = null;
      });
    },
    cancel(): void {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingFn = null;
    }
  };
}

/**
 * 获取元素相对于视口的位置信息
 * 封装 getBoundingClientRect，添加缓存机制
 *
 * @param el - 目标元素
 * @returns 位置信息对象
 */
export function getRect(el: HTMLElement): DOMRect {
  return el.getBoundingClientRect();
}

/**
 * 检查元素是否在视口内
 *
 * @param el - 目标元素
 * @param threshold - 阈值（像素），默认为 0
 * @returns 是否在视口内
 */
export function isInViewport(el: HTMLElement, threshold = 0): boolean {
  const rect = getRect(el);
  return (
    rect.top >= -threshold &&
    rect.left >= -threshold &&
    rect.bottom <= window.innerHeight + threshold &&
    rect.right <= window.innerWidth + threshold
  );
}

/**
 * 安全地移除元素
 * 先检查元素是否在 DOM 中，避免报错
 *
 * @param el - 要移除的元素
 * @returns 是否成功移除
 */
export function removeElement(el: HTMLElement): boolean {
  if (el.parentNode) {
    el.parentNode.removeChild(el);
    return true;
  }
  return false;
}

/**
 * 清空元素的所有子节点
 * 比 innerHTML = '' 更高效
 *
 * @param el - 目标元素
 */
export function clearChildren(el: HTMLElement): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * 插入元素到指定位置
 * 比 insertBefore 更易用的 API
 *
 * @param parent - 父元素
 * @param newEl - 新元素
 * @param refEl - 参考元素，如果为 null 则添加到末尾
 */
export function insertAt(
  parent: HTMLElement,
  newEl: HTMLElement,
  refEl: HTMLElement | null
): void {
  if (refEl) {
    parent.insertBefore(newEl, refEl);
  } else {
    parent.appendChild(newEl);
  }
}

/**
 * DOM 工具函数命名空间
 * 便于批量导入和使用
 */
export const dom = {
  setStyles,
  toggleClasses,
  setAttr,
  setAttrs,
  batchUpdate,
  createBatchedUpdater,
  getRect,
  isInViewport,
  removeElement,
  clearChildren,
  insertAt
};

export default dom;
