/**
 * ============================================
 * 格式化与提示工具
 * ============================================
 * 1. formatCount —— 数字格式化（万 / 亿）
 * 2. toast —— 从 @bilibili/vanilla-toast v1.1.4 提取的实现（样式与动画一致）
 * 3. copyText —— 剪贴板复制（Clipboard API 优先，降级 execCommand）
 */

/**
 * 数字格式化：千位以上转「万」，亿位以上转「亿」
 *
 * 与原实现一致：先按保留位数四舍五入，再除回倍数得到带小数的结果。
 *
 * @param value - 待格式化数字
 * @param decimals - 保留小数位数（仅对万 / 亿生效）
 * @returns 格式化后的字符串；非法入参返回 0
 *
 * @example formatCount(23456, 1) // '2.3万'
 * @example formatCount(123456789, 1) // '1.2亿'
 */
export function formatCount(value: number, decimals: number): string | number {
  if (typeof value !== "number") {
    return 0;
  }
  if (value >= 1e8) {
    const rounded = Math.round(value / Math.pow(10, 8 - decimals));
    return `${rounded / Math.pow(10, decimals)}亿`;
  }
  if (value >= 1e4) {
    const rounded = Math.round(value / Math.pow(10, 4 - decimals));
    return `${rounded / Math.pow(10, decimals)}万`;
  }
  return value;
}

/** toast 类型（与 @bilibili/vanilla-toast 保持一致） */
export type ToastType = "info" | "success" | "warn" | "error";

/** toast 配置项 */
export interface ToastOptions {
  /** 展示时长，默认 2000ms */
  duration?: number;
  /** 自定义样式（覆盖默认样式） */
  customStyle?: Partial<CSSStyleDeclaration>;
  /** 关闭回调 */
  onClose?: () => void;
}

/** 各类型 toast 的背景色（与原版一致） */
const TOAST_TYPE_STYLES: Record<ToastType, Partial<CSSStyleDeclaration>> = {
  info: { backgroundColor: "rgba(0, 0, 0, .8)" },
  success: { backgroundColor: "rgba(57, 175, 100, 1)" },
  error: { backgroundColor: "rgba(228, 12, 12, 1)" },
  warn: { backgroundColor: "rgba(255, 134, 39, 1)" },
};

/** 弹出动画名（与原版一致） */
const TOAST_SLIDE = "vanilla-toast-slide";

/** 动画样式是否已注入 */
let toastStyleInjected = false;

/** 注入 toast 弹出动画 keyframes（与原版一致，幂等） */
function injectToastStyle(): void {
  if (toastStyleInjected || document.querySelector(`.${TOAST_SLIDE}`)) {
    toastStyleInjected = true;
    return;
  }
  const frames = `{
    0% {
      transform: translate(-50%, 0);
      -webkit-transform: translate(-50%, 0);
      opacity: 0;
    }
    100% {
      transform: translate(-50%, -50%);
      -webkit-transform: translate(-50%, -50%);
      opacity: 1;
    }
  }`;
  const style = document.createElement("style");
  style.type = "text/css";
  style.className = TOAST_SLIDE;
  style.innerHTML = `@keyframes ${TOAST_SLIDE} ${frames}@-webkit-keyframes ${TOAST_SLIDE} ${frames}`;
  const head = document.querySelector("head");
  if (!head) {
    console.warn("head tag does not exist!");
    return;
  }
  head.appendChild(style);
  toastStyleInjected = true;
}

/** toast 基础样式（与原版 vanilla-toast 一致，含原版 "ease-int-out" 拼写） */
const TOAST_BASE_STYLE: Partial<CSSStyleDeclaration> = {
  position: "fixed",
  left: "50%",
  top: "50%",
  boxSizing: "border-box",
  width: "auto",
  padding: "6px 12px",
  borderRadius: "8px",
  maxWidth: "80%",
  background: "rgba(0, 0, 0, .7)",
  fontSize: "14px",
  color: "#fff",
  lineHeight: "1.4",
  wordWrap: "break-word",
  textAlign: "justify",
  zIndex: "99999",
  cursor: "default",
  userSelect: "none",
  animation: ".3s ease-int-out both",
  animationName: TOAST_SLIDE,
  webkitAnimation: ".3s ease-int-out both",
  webkitAnimationName: TOAST_SLIDE,
};

/** 展示 toast（内部实现） */
function showToast(message: string, options: ToastOptions = {}): void {
  injectToastStyle();
  const { duration = 2000, customStyle, onClose } = options;
  const el = document.createElement("div");
  Object.assign(el.style, TOAST_BASE_STYLE, customStyle);
  el.innerText = message;
  document.body.appendChild(el);
  setTimeout(() => {
    if (typeof onClose === "function") {
      onClose();
    }
    document.body.removeChild(el);
  }, duration);
}

/**
 * toast 提示（与原版 @bilibili/vanilla-toast 对外 API 一致）
 *
 * @example toast.info('提示文案')
 * @example toast.success('成功', { duration: 3000 })
 */
export const toast: Record<
  ToastType,
  (message: string, options?: ToastOptions) => void
> = {
  info: (message, options) =>
    showToast(message, {
      ...options,
      customStyle: {
        ...TOAST_TYPE_STYLES.info,
        ...(options?.customStyle || {}),
      },
    }),
  success: (message, options) =>
    showToast(message, {
      ...options,
      customStyle: {
        ...TOAST_TYPE_STYLES.success,
        ...(options?.customStyle || {}),
      },
    }),
  warn: (message, options) =>
    showToast(message, {
      ...options,
      customStyle: {
        ...TOAST_TYPE_STYLES.warn,
        ...(options?.customStyle || {}),
      },
    }),
  error: (message, options) =>
    showToast(message, {
      ...options,
      customStyle: {
        ...TOAST_TYPE_STYLES.error,
        ...(options?.customStyle || {}),
      },
    }),
};

/**
 * 复制文本到剪贴板（替代原版内部剪贴板工具）
 *
 * 优先使用 Clipboard API，失败时降级为 execCommand。
 *
 * @param text - 待复制文本
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
