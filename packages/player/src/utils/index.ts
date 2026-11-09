/**
 * 工具函数模块
 * ============================================
 * 提供播放器所需的各种工具函数
 */

import { createLogger } from '@lumina/framework/utils';
const logger = createLogger('EventEmitter');

// ============================================
// 类型守卫
// ============================================

/**
 * 检查 HTMLElement 是否具有厂商前缀全屏 API
 */
function isFullscreenCapable(el: HTMLElement): el is HTMLElement & FullscreenElement {
  return 'webkitRequestFullscreen' in el || 'mozRequestFullScreen' in el || 'msRequestFullscreen' in el;
}

/**
 * 检查 Document 是否具有厂商前缀全屏 API
 */
function isFullscreenDocument(doc: Document): doc is Document & FullscreenDocument {
  return 'webkitExitFullscreen' in doc || 'mozCancelFullScreen' in doc ||
         'msExitFullscreen' in doc || 'webkitFullscreenElement' in doc ||
         'mozFullScreenElement' in doc || 'msFullscreenElement' in doc;
}

/**
 * 检查 Document 是否具有画中画 API
 */
function isPictureInPictureDocument(doc: Document): doc is Document & PictureInPictureDocument {
  return 'pictureInPictureElement' in doc;
}

/**
 * 检查值是否为纯对象（非数组、非 null）
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 事件发射器类
 * 实现发布-订阅模式，用于组件间通信
 */
export class EventEmitter<Events extends Record<string, (...args: unknown[]) => void>> {
  /**
   * 事件监听器存储映射
   * 键为事件名，值为监听器数组
   */
  private listeners: { [K in keyof Events]?: Events[K][] } = {};

  /**
   * 注册事件监听器
   *
   * @param event - 事件名称
   * @param callback - 回调函数
   *
   * @example
   * emitter.on('play', () => console.log('playing'))
   */
  on<K extends keyof Events>(event: K, callback: Events[K]): void {
    if (this.listeners[event] === undefined) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(callback);
  }

  /**
   * 移除事件监听器
   *
   * @param event - 事件名称
   * @param callback - 要移除的回调函数
   */
  off<K extends keyof Events>(event: K, callback: Events[K]): void {
    const callbacks = this.listeners[event];
    if (callbacks !== undefined) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   *
   * @param event - 事件名称
   * @param args - 传递给监听器的参数
   */
  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    const callbacks = this.listeners[event];
    if (callbacks !== undefined) {
      callbacks.forEach(callback => {
        try {
          callback(...args);
        } catch (error) {
          logger.error(`Error in event listener for ${String(event)}:`, error);
        }
      });
    }
  }

  /**
   * 注册一次性事件监听器
   * 触发后自动移除
   *
   * @param event - 事件名称
   * @param callback - 回调函数
   */
  once<K extends keyof Events>(event: K, callback: Events[K]): void {
    // 泛型函数类型 Events[K] 无法从箭头函数自动推断，需 as 辅助
    const handler = ((...args: Parameters<Events[K]>) => {
      this.off(event, handler);
      callback(...args);
    }) as Events[K];
    this.on(event, handler);
  }

  /**
   * 移除所有事件监听器
   */
  removeAllListeners(): void {
    this.listeners = {};
  }
}

/**
 * 格式化时间为 MM:SS 或 HH:MM:SS
 *
 * @param seconds - 时间（秒）
 * @returns 格式化后的时间字符串
 *
 * @example
 * formatTime(125) // "02:05"
 * formatTime(3665) // "1:01:05"
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const minsStr = mins.toString().padStart(2, '0');
  const secsStr = secs.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${hrs}:${minsStr}:${secsStr}`;
  }
  return `${minsStr}:${secsStr}`;
}

/**
 * 格式化文件大小
 *
 * @param bytes - 字节数
 * @returns 格式化后的文件大小字符串
 *
 * @example
 * formatFileSize(1024) // "1 KB"
 * formatFileSize(1024 * 1024) // "1 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
}

/**
 * 节流函数
 * 限制函数执行频率
 *
 * @param fn - 要节流的函数
 * @param delay - 节流间隔（毫秒）
 * @returns 节流后的函数
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastTime = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastTime >= delay) {
      lastTime = now;
      fn(...args);
    }
  };
}

/**
 * 防抖函数
 * 延迟执行，如果在延迟期间再次调用则重新计时
 *
 * @param fn - 要防抖的函数
 * @param delay - 防抖延迟（毫秒）
 * @returns 防抖后的函数
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: number | null = null;
  return (...args: Parameters<T>) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      fn(...args);
      timer = null;
    }, delay);
  };
}

/**
 * 将值限制在指定范围内
 *
 * @param value - 要限制的值
 * @param min - 最小值
 * @param max - 最大值
 * @returns 限制后的值
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 线性插值
 *
 * @param start - 起始值
 * @param end - 结束值
 * @param t - 插值因子 (0-1)
 * @returns 插值结果
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * clamp(t, 0, 1);
}

/**
 * 全屏 API 类型定义
 */
interface FullscreenElement {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void>;
  mozRequestFullScreen?: () => Promise<void>;
  msRequestFullscreen?: () => Promise<void>;
}

interface FullscreenDocument {
  webkitExitFullscreen?: () => Promise<void>;
  mozCancelFullScreen?: () => Promise<void>;
  msExitFullscreen?: () => Promise<void>;
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  msFullscreenElement?: Element | null;
}

/**
 * 全屏 API 封装
 * 处理不同浏览器的全屏 API 差异
 */
export const fullscreen = {
  /**
   * 请求全屏
   *
   * @param element - 要全屏显示的元素
   */
  async request(element: HTMLElement): Promise<void> {
    if (element.requestFullscreen !== undefined) {
      await element.requestFullscreen();
    } else if (isFullscreenCapable(element)) {
      if (element.webkitRequestFullscreen !== undefined) {
        await element.webkitRequestFullscreen();
      } else if (element.mozRequestFullScreen !== undefined) {
        await element.mozRequestFullScreen();
      } else if (element.msRequestFullscreen !== undefined) {
        await element.msRequestFullscreen();
      }
    }
  },

  /**
   * 退出全屏
   */
  async exit(): Promise<void> {
    if (document.exitFullscreen !== undefined) {
      await document.exitFullscreen();
    } else if (isFullscreenDocument(document)) {
      if (document.webkitExitFullscreen !== undefined) {
        await document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen !== undefined) {
        await document.mozCancelFullScreen();
      } else if (document.msExitFullscreen !== undefined) {
        await document.msExitFullscreen();
      }
    }
  },

  /**
   * 切换全屏状态
   *
   * @param element - 要全屏显示的元素
   */
  async toggle(element: HTMLElement): Promise<void> {
    if (this.isActive()) {
      await this.exit();
    } else {
      await this.request(element);
    }
  },

  /**
   * 检查是否处于全屏状态
   */
  isActive(): boolean {
    if (isFullscreenDocument(document)) {
      return !!(
        document.fullscreenElement ??
        document.webkitFullscreenElement ??
        document.mozFullScreenElement ??
        document.msFullscreenElement
      );
    }
    return !!document.fullscreenElement;
  },

  /**
   * 获取当前全屏元素
   */
  getElement(): Element | null {
    if (isFullscreenDocument(document)) {
      return (
        document.fullscreenElement ??
        document.webkitFullscreenElement ??
        document.mozFullScreenElement ??
        document.msFullscreenElement ??
        null
      );
    }
    return document.fullscreenElement ?? null;
  },
};

/**
 * 画中画 API 类型定义
 */
interface PictureInPictureDocument {
  pictureInPictureElement?: Element | null;
}

/**
 * 画中画 API 封装
 */
export const pip = {
  /**
   * 请求画中画
   *
   * @param video - 视频元素
   */
  async request(video: HTMLVideoElement): Promise<PictureInPictureWindow> {
    if (video.requestPictureInPicture !== undefined) {
      return await video.requestPictureInPicture();
    }
    throw new Error('Picture-in-Picture is not supported');
  },

  /**
   * 退出画中画
   */
  async exit(): Promise<void> {
    if (document.exitPictureInPicture !== undefined) {
      await document.exitPictureInPicture();
    }
  },

  /**
   * 切换画中画状态
   *
   * @param video - 视频元素
   */
  async toggle(video: HTMLVideoElement): Promise<void> {
    if (this.isActive()) {
      await this.exit();
    } else {
      await this.request(video);
    }
  },

  /**
   * 检查是否处于画中画状态
   */
  isActive(): boolean {
    if (isPictureInPictureDocument(document)) {
      return document.pictureInPictureElement !== undefined && document.pictureInPictureElement !== null;
    }
    return false;
  },

  /**
   * 检查是否支持画中画
   */
  isSupported(): boolean {
    return 'pictureInPictureEnabled' in document;
  },
};

/**
 * 检测浏览器对视频格式的支持
 *
 * @param mimeType - MIME 类型
 * @returns 是否支持
 */
export function canPlayType(mimeType: string): boolean {
  const video = document.createElement('video');
  const canPlay = video.canPlayType(mimeType);
  return canPlay === 'probably' || canPlay === 'maybe';
}

/**
 * 检测 HLS 支持
 */
export function isHlsSupported(): boolean {
  return canPlayType('application/vnd.apple.mpegurl');
}

/**
 * 检测是否支持 Media Source Extensions
 */
export function isMseSupported(): boolean {
  return 'MediaSource' in window;
}

/**
 * 预加载图片
 *
 * @param src - 图片 URL
 * @returns Promise，加载成功 resolve，失败 reject
 */
export function preloadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * 解析查询字符串
 *
 * @param query - 查询字符串
 * @returns 解析后的对象
 */
export function parseQuery(query: string): Record<string, string> {
  const params = new URLSearchParams(query);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/**
 * 构建查询字符串
 *
 * @param params - 参数对象
 * @returns 查询字符串
 */
export function buildQuery(params: Record<string, string | number | boolean>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    searchParams.append(key, String(value));
  });
  return searchParams.toString();
}

/**
 * 生成唯一 ID
 *
 * @param prefix - ID 前缀
 * @returns 唯一 ID 字符串
 */
export function generateId(prefix = 'nova'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 深度合并对象
 *
 * @param target - 目标对象
 * @param sources - 源对象数组
 * @returns 合并后的对象
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  ...sources: Array<Record<string, unknown> | null | undefined>
): T {
  const result: Record<string, unknown> = { ...target };

  for (const source of sources) {
    if (!source) continue;
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const value = source[key];
        const resultValue = result[key];
        if (isPlainObject(value) && isPlainObject(resultValue)) {
          result[key] = deepMerge(resultValue, value);
        } else if (value !== undefined) {
          result[key] = value;
        }
      }
    }
  }

  // 深度合并后 result 的结构与 T 一致，但 TypeScript 无法自动推断
  // 因为合并过程中 result 被放宽为 Record<string, unknown>
  return result as T;
}

/**
 * 创建 CSS 样式表
 *
 * @param styles - CSS 样式字符串
 * @returns 创建的 style 元素
 */
export function createStyle(styles: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.appendChild(style);
  return style;
}

/**
 * 移除 CSS 样式表
 *
 * @param style - style 元素
 */
export function removeStyle(style: HTMLStyleElement): void {
  if (style.parentNode !== null) {
    style.parentNode.removeChild(style);
  }
}

/**
 * 监听元素尺寸变化
 *
 * @param element - 要监听的元素
 * @param callback - 尺寸变化回调
 * @returns 清理函数
 */
export function observeResize(
  element: Element,
  callback: (entries: ResizeObserverEntry[]) => void
): () => void {
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(callback);
    observer.observe(element);
    return () => observer.disconnect();
  }

  /**
   * 降级方案：使用轮询
   */
  let lastWidth = element.clientWidth;
  let lastHeight = element.clientHeight;

  const checkSize = (): void => {
    const width = element.clientWidth;
    const height = element.clientHeight;
    if (width !== lastWidth || height !== lastHeight) {
      lastWidth = width;
      lastHeight = height;
      callback([]);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const interval = setInterval(checkSize, 200);
  return () => clearInterval(interval);
}

// ============================================
// Tooltip 事件管理器导出
// ============================================
// 通过事件总线驱动 tooltip 显示/隐藏

export {
  TooltipManager,
  bindTooltip,
  bindAllTooltips,
  TooltipEvents,
} from './tooltipManager';

export type {
  TooltipShowPayload,
  TooltipHidePayload,
} from './tooltipManager';

