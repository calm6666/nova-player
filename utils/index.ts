/**
 * ============================================
 * 工具函数模块
 * ============================================
 * 提供通用的工具函数
 */

export { formatTime } from "./formatTime";
export { rafTimeout, cancelRaf } from "./rafTimeout";
export { rafInterval, clearRafInterval } from "./rafInterval";
export { dom } from "./dom";
export {
  isServer,
  isBrowser,
  createSSRConfig,
  safeResizeObserver,
  safeIntersectionObserver,
} from "./ssr";
export type { SSRConfig } from "./ssr";
export { deepMerge, smartMerge } from "./smartMerge";
export { createLogger, Logger, LogLevel, loggerManager } from "./logger";
export type { LoggerConfig, LogEntry, LogHandler } from "./logger";
export { clearStyle } from "./style";
