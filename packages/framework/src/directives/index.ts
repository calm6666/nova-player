/**
 * ============================================
 * 指令系统模块
 * ============================================
 * 提供可复用的 DOM 行为扩展指令
 * 所有指令接收元素和值，可选返回清理函数
 */

import type { Directive } from '../types/index';

/**
 * 自动聚焦指令
 * 当值为 true 时，在下一帧自动聚焦元素
 *
 * @param el - 目标元素
 * @param value - 是否聚焦
 *
 * @example
 * h('input', { directives: [[focus, true]] })
 */
export const focus: Directive<boolean> = (el, value) => {
  if (value) {
    /**
     * 使用 setTimeout 确保 DOM 已渲染
     */
    setTimeout(() => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
      }
    }, 0);
  }
};

/**
 * 点击外部指令
 * 当点击元素外部时触发回调
 *
 * @param el - 目标元素
 * @param callback - 点击外部时的回调函数
 * @returns 清理函数，用于移除事件监听
 *
 * @example
 * h('div', { directives: [[clickOutside, () => console.log('outside')]] })
 */
export const clickOutside: Directive<() => void> = (el, callback): (() => void) | void => {
  /**
   * 点击事件处理器
   */
  const handler = (e: MouseEvent): void => {
    /**
     * 如果点击目标不在元素内，触发回调
     */
    if (!el.contains(e.target as Node)) {
      callback();
    }
  };

  /**
   * 在 document 上监听点击事件
   */
  document.addEventListener('click', handler);

  /**
   * 返回清理函数
   */
  return () => document.removeEventListener('click', handler);
};

/**
 * 显示/隐藏指令
 * 类似 v-show，通过 display 属性控制显隐
 *
 * @param el - 目标元素
 * @param value - 是否显示
 *
 * @example
 * h('div', { directives: [[show, isVisible]] })
 */
export const show: Directive<boolean> = (el, value) => {
  /**
   * 根据值设置 display 样式
   * true 时移除 display:none，false 时设置 display:none
   */
  el.style.display = value ? '' : 'none';
};

/**
 * 拖拽指令
 * 使元素可拖拽
 *
 * @param el - 目标元素
 * @param options - 拖拽配置
 * @returns 清理函数
 */
export const draggable: Directive<{
  /** 是否启用拖拽 */
  enabled: boolean;
  /** 拖拽开始回调 */
  onStart?: (e: MouseEvent) => void;
  /** 拖拽中回调 */
  onMove?: (e: MouseEvent, deltaX: number, deltaY: number) => void;
  /** 拖拽结束回调 */
  onEnd?: (e: MouseEvent) => void;
}> = (el, options): (() => void) | void => {
  if (!options.enabled) return;

  /**
   * 拖拽状态
   */
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  /**
   * 鼠标按下处理器
   */
  const onMouseDown = (e: MouseEvent): void => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    options.onStart?.(e);

    /**
     * 添加全局鼠标移动和释放监听
     */
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  /**
   * 鼠标移动处理器
   */
  const onMouseMove = (e: MouseEvent): void => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    options.onMove?.(e, deltaX, deltaY);
  };

  /**
   * 鼠标释放处理器
   */
  const onMouseUp = (e: MouseEvent): void => {
    isDragging = false;
    options.onEnd?.(e);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  /**
   * 添加鼠标按下监听
   */
  el.addEventListener('mousedown', onMouseDown);

  /**
   * 返回清理函数
   */
  return () => {
    el.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
};

/**
 * 长按指令
 * 长按元素时触发回调
 *
 * @param el - 目标元素
 * @param options - 长按配置
 * @returns 清理函数
 */
export const longPress: Directive<{
  /** 长按持续时间（毫秒） */
  duration?: number;
  /** 长按触发回调 */
  onLongPress: () => void;
  /** 点击回调 */
  onClick?: () => void;
}> = (el, options): (() => void) | void => {
  const { duration = 500, onLongPress, onClick } = options;

  /**
   * 长按定时器
   */
  let timer: number | null = null;
  let isLongPress = false;

  /**
   * 开始长按
   */
  const start = (): void => {
    isLongPress = false;
    timer = window.setTimeout(() => {
      isLongPress = true;
      onLongPress();
    }, duration);
  };

  /**
   * 取消长按
   */
  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /**
   * 点击处理器
   */
  const onClickHandler = (): void => {
    if (!isLongPress && onClick) {
      onClick();
    }
  };

  /**
   * 添加事件监听
   */
  el.addEventListener('mousedown', start);
  el.addEventListener('touchstart', start);
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);
  el.addEventListener('touchend', cancel);
  el.addEventListener('click', onClickHandler);

  /**
   * 返回清理函数
   */
  return () => {
    el.removeEventListener('mousedown', start);
    el.removeEventListener('touchstart', start);
    el.removeEventListener('mouseup', cancel);
    el.removeEventListener('mouseleave', cancel);
    el.removeEventListener('touchend', cancel);
    el.removeEventListener('click', onClickHandler);
  };
};

/**
 * 节流指令
 * 限制事件触发频率
 *
 * @param el - 目标元素
 * @param options - 节流配置
 * @returns 清理函数
 */
export const throttle: Directive<{
  /** 事件名 */
  event: string;
  /** 回调函数 */
  handler: (e: Event) => void;
  /** 节流间隔（毫秒） */
  delay?: number;
}> = (el, options): (() => void) | void => {
  const { event, handler, delay = 100 } = options;

  /**
   * 上次执行时间
   */
  let lastTime = 0;

  /**
   * 节流处理器
   */
  const throttledHandler = (e: Event): void => {
    const now = Date.now();
    if (now - lastTime >= delay) {
      lastTime = now;
      handler(e);
    }
  };

  /**
   * 添加事件监听
   */
  el.addEventListener(event, throttledHandler);

  /**
   * 返回清理函数
   */
  return () => el.removeEventListener(event, throttledHandler);
};

/**
 * 防抖指令
 * 延迟执行，如果在延迟期间再次触发则重新计时
 *
 * @param el - 目标元素
 * @param options - 防抖配置
 * @returns 清理函数
 */
export const debounce: Directive<{
  /** 事件名 */
  event: string;
  /** 回调函数 */
  handler: (e: Event) => void;
  /** 防抖延迟（毫秒） */
  delay?: number;
}> = (el, options): (() => void) | void => {
  const { event, handler, delay = 300 } = options;

  /**
   * 防抖定时器
   */
  let timer: number | null = null;

  /**
   * 防抖处理器
   */
  const debouncedHandler = (e: Event): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      handler(e);
      timer = null;
    }, delay);
  };

  /**
   * 添加事件监听
   */
  el.addEventListener(event, debouncedHandler);

  /**
   * 返回清理函数
   */
  return () => {
    el.removeEventListener(event, debouncedHandler);
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
};

/**
 * 工具提示指令
 * 鼠标悬停时显示提示
 *
 * @param el - 目标元素
 * @param text - 提示文本
 * @returns 清理函数
 */
export const tooltip: Directive<string> = (el, text): (() => void) | void => {
  /**
   * 创建提示元素
   */
  const tooltipEl = document.createElement('div');
  tooltipEl.textContent = text;
  tooltipEl.style.cssText = `
    position: absolute;
    padding: 6px 12px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    font-size: 12px;
    border-radius: 4px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 9999;
    white-space: nowrap;
  `;

  /**
   * 显示提示
   */
  const show = (): void => {
    document.body.appendChild(tooltipEl);
    const rect = el.getBoundingClientRect();
    tooltipEl.style.left = `${rect.left + rect.width / 2 - tooltipEl.offsetWidth / 2}px`;
    tooltipEl.style.top = `${rect.top - tooltipEl.offsetHeight - 8}px`;
    tooltipEl.style.opacity = '1';
  };

  /**
   * 隐藏提示
   */
  const hide = (): void => {
    tooltipEl.style.opacity = '0';
    setTimeout(() => {
      if (tooltipEl.parentNode) {
        document.body.removeChild(tooltipEl);
      }
    }, 200);
  };

  /**
   * 添加事件监听
   */
  el.addEventListener('mouseenter', show);
  el.addEventListener('mouseleave', hide);

  /**
   * 返回清理函数
   */
  return () => {
    el.removeEventListener('mouseenter', show);
    el.removeEventListener('mouseleave', hide);
    if (tooltipEl.parentNode) {
      document.body.removeChild(tooltipEl);
    }
  };
};
