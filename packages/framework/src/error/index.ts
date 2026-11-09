/**
 * ============================================
 * 错误处理系统导出
 * ============================================
 */

export {
  ErrorHandler,
  createErrorHandler,
  globalErrorHandler,
  createSafeCall,
  ErrorLevel,
  ErrorType,
} from './ErrorHandler';

export type {
  ErrorInfo,
  ErrorHandlerConfig,
  SafeResult,
} from './ErrorHandler';
