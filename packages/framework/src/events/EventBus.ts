/**
 * ============================================
 * 事件总线 (EventBus)
 * ============================================
 * 提供跨组件、跨插件的通信机制
 * 支持事件监听、发射、一次性监听和取消监听
 */

/**
 * 事件处理器类型
 */
type EventHandler<T = unknown> = (payload: T) => void;

/**
 * 事件总线类
 * 实现发布-订阅模式，用于组件间解耦通信
 */
export class EventBus {
  /** 事件处理器存储 */
  private handlers: Map<string, EventHandler[]> = new Map();

  /**
   * 监听事件
   * @param event - 事件名称
   * @param handler - 事件处理器
   * @returns 取消监听的函数
   *
   * @example
   * const unsubscribe = eventBus.on('danmaku:send', (data) => {
   *   console.log('发送弹幕:', data);
   * });
   * // 取消监听
   * unsubscribe();
   */
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }

    const handlers = this.handlers.get(event)!;
    handlers.push(handler as EventHandler);

    // 返回取消监听的函数
    return () => {
      this.off(event, handler);
    };
  }

  /**
   * 一次性监听事件
   * 事件触发后自动取消监听
   * @param event - 事件名称
   * @param handler - 事件处理器
   * @returns 取消监听的函数
   *
   * @example
   * eventBus.once('player:ready', () => {
   *   console.log('播放器准备就绪');
   * });
   */
  once<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    const onceHandler = (payload: T) => {
      handler(payload);
      this.off(event, onceHandler);
    };

    return this.on(event, onceHandler);
  }

  /**
   * 发射事件
   * @param event - 事件名称
   * @param payload - 事件数据
   *
   * @example
   * eventBus.emit('danmaku:send', { text: 'Hello', color: '#fff' });
   */
  emit<T = unknown>(event: string, payload?: T): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[EventBus] Event handler execution failed (${event}):`, error);
        }
      });
    }
  }

  /**
   * 取消监听事件
   * @param event - 事件名称
   * @param handler - 要取消的事件处理器
   *
   * @example
   * eventBus.off('danmaku:send', handler);
   */
  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler as EventHandler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * 取消监听所有事件
   * @param event - 可选，指定要清空的事件名称，不传则清空所有
   */
  offAll(event?: string): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * 获取事件监听器数量
   * @param event - 事件名称
   * @returns 监听器数量
   */
  listenerCount(event: string): number {
    const handlers = this.handlers.get(event);
    return handlers ? handlers.length : 0;
  }

  /**
   * 检查是否有监听器
   * @param event - 事件名称
   * @returns 是否有监听器
   */
  hasListeners(event: string): boolean {
    return this.listenerCount(event) > 0;
  }

  /**
   * 获取所有事件名称
   * @returns 事件名称数组
   */
  eventNames(): string[] {
    return Array.from(this.handlers.keys());
  }
}

/**
 * 创建事件总线实例
 * @returns EventBus 实例
 */
export function createEventBus(): EventBus {
  return new EventBus();
}

// 导出类型
export type { EventHandler };
