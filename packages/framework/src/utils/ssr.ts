/**
 * ============================================
 * 服务端渲染(SSR)兼容性工具模块
 * ============================================
 * 提供浏览器环境检测和 SSR 安全操作的封装
 * 确保代码在服务端(Node.js)和客户端(浏览器)都能正常运行
 */

/**
 * 检查当前是否在浏览器环境中
 * 通过检查全局对象 window 和 document 是否存在来判断
 *
 * @returns 是否在浏览器环境
 *
 * @example
 * if (isBrowser()) {
 *   // 执行浏览器特有的操作
 *   document.getElementById('app');
 * }
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * 检查当前是否在服务端渲染环境中
 * 通过检查全局对象 window 是否存在来判断
 *
 * @returns 是否在服务端环境
 *
 * @example
 * if (isServer()) {
 *   // 执行服务端特有的操作
 *   return null; // 服务端不渲染视频
 * }
 */
export function isServer(): boolean {
  return typeof window === 'undefined';
}

/**
 * 安全获取 window 对象
 * 在服务端返回 undefined，在客户端返回 window 对象
 *
 * @returns window 对象或 undefined
 *
 * @example
 * const win = getWindow();
 * if (win) {
 *   win.addEventListener('resize', handler);
 * }
 */
export function getWindow(): Window | undefined {
  return isBrowser() ? window : undefined;
}

/**
 * 安全获取 document 对象
 * 在服务端返回 undefined，在客户端返回 document 对象
 *
 * @returns document 对象或 undefined
 *
 * @example
 * const doc = getDocument();
 * if (doc) {
 *   doc.getElementById('app');
 * }
 */
export function getDocument(): Document | undefined {
  return isBrowser() ? document : undefined;
}

/**
 * 安全执行浏览器操作
 * 仅在浏览器环境中执行回调函数，服务端跳过
 *
 * @param callback - 要在浏览器中执行的回调函数
 * @returns 回调函数的返回值，服务端返回 undefined
 *
 * @example
 * const element = safeBrowserOperation(() => document.getElementById('app'));
 */
export function safeBrowserOperation<T>(callback: () => T): T | undefined {
  if (isBrowser()) {
    return callback();
  }
  return undefined;
}

/**
 * 安全设置定时器
 * 在服务端使用 setTimeout 的 polyfill，在客户端使用原生 setTimeout
 * 确保 SSR 时不会报错
 *
 * @param callback - 回调函数
 * @param delay - 延迟时间（毫秒）
 * @returns 定时器 ID
 *
 * @example
 * const timer = safeSetTimeout(() => {
 *   console.log('延迟执行');
 * }, 1000);
 */
export function safeSetTimeout(callback: () => void, delay: number): number {
  if (isBrowser()) {
    return window.setTimeout(callback, delay);
  }
  // 服务端使用 Node.js 的 setTimeout，返回 Timeout 对象，需要转换为 number
  return setTimeout(callback, delay) as unknown as number;
}

/**
 * 安全清除定时器
 * 兼容浏览器和服务端的定时器清除
 *
 * @param timerId - 定时器 ID
 *
 * @example
 * const timer = safeSetTimeout(() => {}, 1000);
 * safeClearTimeout(timer);
 */
export function safeClearTimeout(timerId: number): void {
  clearTimeout(timerId);
}

/**
 * 安全添加事件监听器
 * 仅在浏览器环境中添加事件监听
 *
 * @param target - 事件目标
 * @param event - 事件名称
 * @param handler - 事件处理函数
 * @param options - 事件监听选项
 * @returns 移除监听器的函数，服务端返回空函数
 *
 * @example
 * const remove = safeAddEventListener(window, 'resize', handler);
 * // 稍后移除
 * remove();
 */
export function safeAddEventListener(
  target: EventTarget | null | undefined,
  event: string,
  handler: EventListener,
  options?: boolean | AddEventListenerOptions
): () => void {
  if (isBrowser() && target) {
    target.addEventListener(event, handler, options);
    return () => {
      target.removeEventListener(event, handler, options);
    };
  }
  // 服务端返回空函数
  return () => {};
}

/**
 * 安全创建 DOM 元素
 * 仅在浏览器环境中创建元素
 *
 * @param tagName - 标签名
 * @returns 创建的 DOM 元素或 null
 *
 * @example
 * const div = safeCreateElement('div');
 * if (div) {
 *   div.className = 'container';
 * }
 */
export function safeCreateElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K
): HTMLElementTagNameMap[K] | null {
  if (isBrowser()) {
    return document.createElement(tagName);
  }
  return null;
}

/**
 * 安全创建带命名空间的 DOM 元素（用于 SVG）
 * 仅在浏览器环境中创建元素
 *
 * @param ns - 命名空间 URI
 * @param tagName - 标签名
 * @returns 创建的 DOM 元素或 null
 *
 * @example
 * const svg = safeCreateElementNS('http://www.w3.org/2000/svg', 'svg');
 */
export function safeCreateElementNS(
  ns: string,
  tagName: string
): Element | null {
  if (isBrowser()) {
    return document.createElementNS(ns, tagName);
  }
  return null;
}

/**
 * 安全创建文本节点
 * 仅在浏览器环境中创建文本节点
 *
 * @param text - 文本内容
 * @returns 创建的文本节点或 null
 *
 * @example
 * const text = safeCreateTextNode('Hello');
 */
export function safeCreateTextNode(text: string): Text | null {
  if (isBrowser()) {
    return document.createTextNode(text);
  }
  return null;
}

/**
 * 安全创建 DocumentFragment
 * 仅在浏览器环境中创建
 *
 * @returns 创建的 DocumentFragment 或 null
 *
 * @example
 * const fragment = safeCreateDocumentFragment();
 * if (fragment) {
 *   fragment.appendChild(element);
 * }
 */
export function safeCreateDocumentFragment(): DocumentFragment | null {
  if (isBrowser()) {
    return document.createDocumentFragment();
  }
  return null;
}

/**
 * 安全查询 DOM 元素
 * 仅在浏览器环境中查询
 *
 * @param selector - CSS 选择器
 * @returns 查询到的元素或 null
 *
 * @example
 * const element = safeQuerySelector('#app');
 */
export function safeQuerySelector(selector: string): Element | null {
  if (isBrowser()) {
    return document.querySelector(selector);
  }
  return null;
}

/**
 * 安全查询多个 DOM 元素
 * 仅在浏览器环境中查询
 *
 * @param selector - CSS 选择器
 * @returns 查询到的元素列表或空数组
 *
 * @example
 * const elements = safeQuerySelectorAll('.item');
 */
export function safeQuerySelectorAll(selector: string): NodeListOf<Element> | [] {
  if (isBrowser()) {
    return document.querySelectorAll(selector);
  }
  return [];
}

/**
 * 安全获取元素尺寸信息
 * 仅在浏览器环境中获取
 *
 * @param element - DOM 元素
 * @returns 元素的尺寸信息或 null
 *
 * @example
 * const rect = safeGetBoundingClientRect(element);
 * if (rect) {
 *   console.log(rect.width, rect.height);
 * }
 */
export function safeGetBoundingClientRect(
  element: Element | null | undefined
): DOMRect | null {
  if (isBrowser() && element) {
    return element.getBoundingClientRect();
  }
  return null;
}

/**
 * 安全获取视口尺寸
 * 仅在浏览器环境中获取
 *
 * @returns 视口尺寸或 null
 *
 * @example
 * const size = safeGetViewportSize();
 * if (size) {
 *   console.log(size.width, size.height);
 * }
 */
export function safeGetViewportSize(): { width: number; height: number } | null {
  if (isBrowser()) {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }
  return null;
}

/**
 * 安全使用 requestAnimationFrame
 * 在服务端使用 setTimeout 作为降级方案
 *
 * @param callback - 回调函数
 * @returns 动画帧 ID
 *
 * @example
 * const id = safeRequestAnimationFrame(() => {
 *   // 动画帧回调
 * });
 */
export function safeRequestAnimationFrame(callback: () => void): number {
  if (isBrowser() && window.requestAnimationFrame) {
    return window.requestAnimationFrame(callback);
  }
  // 服务端使用 setTimeout 作为降级
  return safeSetTimeout(callback, 16);
}

/**
 * 安全取消 requestAnimationFrame
 *
 * @param id - 动画帧 ID
 *
 * @example
 * safeCancelAnimationFrame(id);
 */
export function safeCancelAnimationFrame(id: number): void {
  if (isBrowser() && window.cancelAnimationFrame) {
    window.cancelAnimationFrame(id);
  } else {
    safeClearTimeout(id);
  }
}

/**
 * 安全使用 ResizeObserver
 * 在不支持的环境中返回 null
 *
 * @param callback - 尺寸变化回调
 * @returns ResizeObserver 实例或 null
 *
 * @example
 * const observer = safeResizeObserver((entries) => {
 *   for (const entry of entries) {
 *     console.log(entry.contentRect);
 *   }
 * });
 */
export function safeResizeObserver(
  callback: (entries: ResizeObserverEntry[]) => void
): ResizeObserver | null {
  if (isBrowser() && 'ResizeObserver' in window) {
    return new ResizeObserver(callback);
  }
  return null;
}

/**
 * 安全使用 IntersectionObserver
 * 在不支持的环境中返回 null
 *
 * @param callback - 交叉变化回调
 * @param options - 观察选项
 * @returns IntersectionObserver 实例或 null
 *
 * @example
 * const observer = safeIntersectionObserver((entries) => {
 *   for (const entry of entries) {
 *     console.log(entry.isIntersecting);
 *   }
 * });
 */
export function safeIntersectionObserver(
  callback: (entries: IntersectionObserverEntry[]) => void,
  options?: IntersectionObserverInit
): IntersectionObserver | null {
  if (isBrowser() && 'IntersectionObserver' in window) {
    return new IntersectionObserver(callback, options);
  }
  return null;
}

/**
 * 播放器 SSR 配置接口
 */
export interface SSRConfig {
  /**
   * 是否启用 SSR 模式
   * 启用后播放器在服务端会渲染占位符而不是视频元素
   */
  enabled: boolean;

  /**
   * 服务端渲染时的占位符 HTML
   * 可以是简单的 div 或包含海报图的占位符
   */
  placeholder?: string;

  /**
   * 是否延迟 hydration（客户端激活）
   * 用于性能优化，等待用户交互后再激活播放器
   */
  deferHydration?: boolean;
}

/**
 * 默认 SSR 配置
 */
export const defaultSSRConfig: SSRConfig = {
  enabled: false,
  placeholder: '<div class="nova-player-placeholder"></div>',
  deferHydration: false,
};

/**
 * 创建 SSR 安全的播放器配置
 * 合并用户配置和默认配置
 *
 * @param config - 用户提供的 SSR 配置
 * @returns 完整的 SSR 配置
 */
export function createSSRConfig(config?: Partial<SSRConfig>): SSRConfig {
  return {
    ...defaultSSRConfig,
    ...config,
  };
}
