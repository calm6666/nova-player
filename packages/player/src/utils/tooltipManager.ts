/**
 * ============================================
 * 工具提示管理器 (TooltipManager)
 * ============================================
 * 通过事件总线驱动 tooltip 显示/隐藏
 * 任何组件/插件只需 emit 事件即可触发 tooltip
 *
 * 事件格式：
 * - tooltip:show → { element: HTMLElement, message: string, duration?: number }
 * - tooltip:hide → { element?: HTMLElement }（不传 element 则隐藏所有）
 *
 * 工作流程：
 * 1. 组件设置 DOM 的 data-tooltip 属性或直接 emit 事件
 * 2. TooltipManager 监听事件，创建/定位 tooltip DOM
 * 3. 鼠标移出或 duration 到期后自动隐藏
 *
 * 使用方式：
 * import { TooltipManager } from './tooltipManager';
 * const tooltip = new TooltipManager(player.events);
 *
 * // 组件中触发 tooltip：
 * player.events.emit('tooltip:show', { element: btnEl, message: '播放/暂停 (Space)' });
 * player.events.emit('tooltip:hide', { element: btnEl });
 */

import type { EventBus } from '@lumina/framework/core/eventBus';

// ============================================
// 类型守卫
// ============================================

function isTooltipShowPayload(value: unknown): value is TooltipShowPayload {
  return typeof value === 'object' && value !== null &&
    'element' in value && 'message' in value;
}

/**
 * tooltip:show 事件的载荷
 */
export interface TooltipShowPayload {
  /** 触发 tooltip 的 DOM 元素（tooltip 会定位在该元素附近） */
  element: HTMLElement;
  /** tooltip 显示的文本 */
  message: string;
  /** 显示时长（毫秒），0 表示持续显示直到手动隐藏，默认 0 */
  duration?: number;
  /** 位置偏好：top / bottom / left / right，默认自动判断 */
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** 水平偏移（px），默认 0 */
  offsetX?: number;
  /** 垂直偏移（px），默认 8 */
  offsetY?: number;
}

/**
 * tooltip:hide 事件的载荷
 */
export interface TooltipHidePayload {
  /** 要隐藏 tooltip 的元素（不传则隐藏当前激活的 tooltip） */
  element?: HTMLElement;
}

/**
 * Tooltip 管理器类
 * 通过事件总线接收 tooltip 显示/隐藏指令
 * 自动创建、定位、销毁 tooltip DOM 元素
 */
export class TooltipManager {
  /** 事件总线实例 */
  private eventBus: EventBus;

  /** 当前显示的 tooltip DOM 元素 */
  private tooltipEl: HTMLElement | null = null;

  /** 当前触发 tooltip 的目标元素 */
  private targetEl: HTMLElement | null = null;

  /** 自动隐藏定时器 */
  private hideTimer: number | null = null;

  /** 取消事件监听的函数列表 */
  private unsubscribers: Array<() => void> = [];

  /**
   * 构造函数
   * 创建 TooltipManager 实例并自动注册事件监听
   *
   * @param eventBus - 播放器的事件总线实例
   */
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.registerEvents();
  }

  /**
   * 注册事件总线监听
   * 监听 tooltip:show 和 tooltip:hide 事件
   */
  private registerEvents(): void {
    // 监听 tooltip 显示事件
    this.unsubscribers.push(
      this.eventBus.on<TooltipShowPayload>('TOOLTIP_SHOW', (payload) => {
        if (isTooltipShowPayload(payload)) {
          this.show(payload.element, payload.message, {
            duration: payload.duration,
            placement: payload.placement,
            offsetX: payload.offsetX,
            offsetY: payload.offsetY,
          });
        }
      })
    );

    // 监听 tooltip 隐藏事件
    this.unsubscribers.push(
      this.eventBus.on<TooltipHidePayload>('TOOLTIP_HIDE', (payload) => {
        if (typeof payload === 'object' && payload !== null && 'element' in payload &&
            payload.element instanceof HTMLElement && payload.element !== this.targetEl) {
          return; // 不是当前 tooltip 的目标元素，忽略
        }
        this.hide();
      })
    );
  }

  /**
   * 显示 tooltip
   * 创建 tooltip DOM 元素并定位到目标元素附近
   *
   * @param element - 触发 tooltip 的 DOM 元素
   * @param message - tooltip 显示文本
   * @param options - 可选配置
   */
  show(
    element: HTMLElement,
    message: string,
    options?: {
      duration?: number;
      placement?: 'top' | 'bottom' | 'left' | 'right';
      offsetX?: number;
      offsetY?: number;
    }
  ): void {
    const {
      duration = 0,
      placement,
      offsetX = 0,
      offsetY = 8,
    } = options || {};

    // 如果已有 tooltip 且目标元素相同，只更新文本
    if (this.tooltipEl && this.targetEl === element) {
      this.tooltipEl.textContent = message;
      return;
    }

    // 先隐藏旧的 tooltip
    this.hide();

    // 保存目标元素引用
    this.targetEl = element;

    // 创建 tooltip DOM 元素
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'nova-tooltip';
    this.tooltipEl.textContent = message;
    this.tooltipEl.setAttribute('role', 'tooltip');
    this.tooltipEl.style.cssText = `
      position: fixed;
      z-index: 10001;
      max-width: 260px;
      padding: 6px 12px;
      background: rgba(0, 0, 0, 0.85);
      color: #ffffff;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      border-radius: 6px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transform: translateY(2px);
      transition: opacity 0.15s ease, transform 0.15s ease;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    `;

    // 添加到 body
    document.body.appendChild(this.tooltipEl);

    // 计算位置（需要等 DOM 挂载后才能获取 tooltip 尺寸）
    requestAnimationFrame(() => {
      if (!this.tooltipEl || !this.targetEl) return;
      this.positionTooltip(this.targetEl, this.tooltipEl, {
        placement,
        offsetX,
        offsetY,
      });

      // 显示动画
      this.tooltipEl.style.opacity = '1';
      this.tooltipEl.style.transform = 'translateY(0)';
    });

    // 设置自动隐藏
    if (duration > 0) {
      this.hideTimer = window.setTimeout(() => {
        this.hide();
      }, duration);
    }
  }

  /**
   * 隐藏 tooltip
   * 移除 tooltip DOM 元素并清理状态
   */
  hide(): void {
    // 清除自动隐藏定时器
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    // 移除 tooltip DOM 元素
    if (this.tooltipEl) {
      // 添加消失动画
      this.tooltipEl.style.opacity = '0';
      this.tooltipEl.style.transform = 'translateY(2px)';
      const el = this.tooltipEl;
      setTimeout(() => {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      }, 150);
      this.tooltipEl = null;
    }

    this.targetEl = null;
  }

  /**
   * 定位 tooltip 到目标元素附近
   * 自动判断最优位置（上方优先，空间不足则下方）
   *
   * @param target - 目标 DOM 元素
   * @param tooltip - tooltip DOM 元素
   * @param options - 定位选项
   */
  private positionTooltip(
    target: HTMLElement,
    tooltip: HTMLElement,
    options: {
      placement?: 'top' | 'bottom' | 'left' | 'right';
      offsetX?: number;
      offsetY?: number;
    }
  ): void {
    const { placement, offsetX = 0, offsetY = 8 } = options;

    // 获取目标元素和 tooltip 的边界信息
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    // 视口尺寸
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 自动判断放置方向（未指定时）
    let finalPlacement = placement;
    if (!finalPlacement) {
      // 默认优先放在上方，空间不足则放在下方
      const spaceAbove = targetRect.top;
      const spaceBelow = viewportHeight - targetRect.bottom;

      if (spaceAbove >= tooltipRect.height + offsetY + 8) {
        finalPlacement = 'top';
      } else if (spaceBelow >= tooltipRect.height + offsetY + 8) {
        finalPlacement = 'bottom';
      } else {
        finalPlacement = 'top'; // 都不够时优先上方
      }
    }

    let left = 0;
    let top = 0;

    // 根据放置方向计算坐标
    switch (finalPlacement) {
      case 'top':
        // 上方：水平居中，垂直在上方
        left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2 + offsetX;
        top = targetRect.top - tooltipRect.height - offsetY;
        break;
      case 'bottom':
        // 下方：水平居中，垂直在下方
        left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2 + offsetX;
        top = targetRect.bottom + offsetY;
        break;
      case 'left':
        // 左侧：垂直居中，水平在左侧
        left = targetRect.left - tooltipRect.width - offsetY;
        top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2 + offsetX;
        break;
      case 'right':
        // 右侧：垂直居中，水平在右侧
        left = targetRect.right + offsetY;
        top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2 + offsetX;
        break;
    }

    // 边界约束：确保 tooltip 不超出视口
    const minLeft = 8;
    const maxLeft = viewportWidth - tooltipRect.width - 8;
    left = Math.max(minLeft, Math.min(maxLeft, left));

    const minTop = 8;
    const maxTop = viewportHeight - tooltipRect.height - 8;
    top = Math.max(minTop, Math.min(maxTop, top));

    // 应用计算的位置
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  /**
   * 销毁管理器
   * 移除所有事件监听和 DOM 元素
   */
  destroy(): void {
    this.hide();

    // 取消所有事件监听
    this.unsubscribers.forEach(unsub => unsub());
    this.unsubscribers = [];
  }
}

/**
 * Tooltip 事件常量
 * 用于事件总线的事件名称
 */
export const TooltipEvents = {
  /** 显示 tooltip：{ element: HTMLElement, message: string } */
  SHOW: 'TOOLTIP_SHOW',
  /** 隐藏 tooltip：{ element?: HTMLElement } */
  HIDE: 'TOOLTIP_HIDE',
} as const;

// ============================================
// 辅助：给 DOM 元素绑定 hover tooltip
// ============================================

/**
 * 给单个 DOM 元素绑定 tooltip 事件
 * 鼠标移入时自动 emit tooltip:show，移出时 emit tooltip:hide
 *
 * @param element - 要绑定 tooltip 的 DOM 元素
 * @param message - tooltip 提示文本
 * @param eventBus - 事件总线实例
 * @returns 清理函数（移除事件监听）
 *
 * @example
 * const cleanup = bindTooltip(playBtn, '播放/暂停 (Space)', player.events);
 * // 取消绑定时调用 cleanup()
 */
export function bindTooltip(
  element: HTMLElement,
  message: string,
  eventBus: EventBus
): () => void {
  const onMouseEnter = (): void => {
    eventBus.emit(TooltipEvents.SHOW, {
      element,
      message,
    });
  };

  const onMouseLeave = (): void => {
    eventBus.emit(TooltipEvents.HIDE, {
      element,
    });
  };

  element.addEventListener('mouseenter', onMouseEnter);
  element.addEventListener('mouseleave', onMouseLeave);

  // 返回清理函数
  return () => {
    element.removeEventListener('mouseenter', onMouseEnter);
    element.removeEventListener('mouseleave', onMouseLeave);
  };
}

/**
 * 批量给多个 DOM 元素绑定 tooltip
 * 通过 data-tooltip 属性读取提示文本
 *
 * @param container - 包含需要 tooltip 元素的容器
 * @param eventBus - 事件总线实例
 * @returns 清理函数（移除所有绑定的事件监听）
 *
 * @example
 * // HTML: <button data-tooltip="播放/暂停">▶</button>
 * const cleanup = bindAllTooltips(controlsEl, player.events);
 */
export function bindAllTooltips(
  container: HTMLElement,
  eventBus: EventBus
): () => void {
  const cleanups: Array<() => void> = [];

  // 查找所有带有 data-tooltip 属性的元素
  const elements = container.querySelectorAll<HTMLElement>('[data-tooltip]');

  elements.forEach((el) => {
    const message = el.getAttribute('data-tooltip');
    if (message) {
      cleanups.push(bindTooltip(el, message, eventBus));
    }
  });

  // 返回清理函数
  return () => {
    cleanups.forEach(cleanup => cleanup());
  };
}

export default TooltipManager;
