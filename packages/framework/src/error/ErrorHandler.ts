/**
 * ============================================
 * 错误处理系统 (ErrorHandler)
 * ============================================
 * 统一的错误收集、处理和报告机制
 * 支持错误分类、错误日志、错误恢复、安全调用
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('ErrorHandler');

/**
 * 错误级别
 */
export enum ErrorLevel {
  /** 警告级别，不影响功能 */
  WARN = 'warn',
  /** 错误级别，影响部分功能 */
  ERROR = 'error',
  /** 严重错误，导致功能不可用 */
  FATAL = 'fatal',
}

/**
 * 错误类型
 */
export enum ErrorType {
  /** 播放器错误 */
  PLAYER = 'player',
  /** 插件错误 */
  PLUGIN = 'plugin',
  /** 网络错误 */
  NETWORK = 'network',
  /** 媒体错误 */
  MEDIA = 'media',
  /** 存储错误 */
  STORAGE = 'storage',
  /** 配置错误 */
  CONFIG = 'config',
  /** 运行时错误 */
  RUNTIME = 'runtime',
  /** 未知错误 */
  UNKNOWN = 'unknown',
  /** 通用错误 */
  GENERAL = 'GENERAL',
}

/**
 * 错误信息接口
 */
export interface ErrorInfo {
  /** 错误类型 */
  type: ErrorType;
  /** 错误级别 */
  level: ErrorLevel;
  /** 错误消息 */
  message: string;
  /** 错误对象 */
  error?: Error;
  /** 附加数据 */
  data?: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
  /** 来源 */
  source?: string;
}

/**
 * 错误处理器配置
 */
export interface ErrorHandlerConfig {
  /** 是否启用控制台日志 */
  enableConsole?: boolean;
  /** 是否启用错误上报 */
  enableReport?: boolean;
  /** 错误上报地址 */
  reportUrl?: string;
  /** 最大错误缓存数量 */
  maxCacheSize?: number;
  /** 自定义错误处理器 */
  customHandler?: (error: ErrorInfo) => void;
}

/**
 * 安全执行函数的返回类型
 */
export type SafeResult<T> =
  | { success: true; value: T }
  | { success: false; error: ErrorInfo };

/**
 * 错误处理器类
 */
export class ErrorHandler {
  private config: Required<ErrorHandlerConfig>;
  private errorCache: ErrorInfo[] = [];
  private errorHandlers: Map<ErrorType, Array<(error: ErrorInfo) => void>> = new Map();

  constructor(config: ErrorHandlerConfig = {}) {
    this.config = {
      enableConsole: true,
      enableReport: false,
      reportUrl: '',
      maxCacheSize: 100,
      customHandler: (): void => {},
      ...config,
    };

    // 绑定全局错误处理
    this.bindGlobalErrors();
  }

  /**
   * 绑定全局错误事件
   */
  private bindGlobalErrors(): void {
    if (typeof window === 'undefined') return;

    // 监听未捕获的 Promise 错误
    window.addEventListener('unhandledrejection', (event) => {
      this.handle({
        type: ErrorType.RUNTIME,
        level: ErrorLevel.ERROR,
        message: `Unhandled promise rejection: ${String(event.reason)}`,
        error: event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
        timestamp: Date.now(),
        source: 'global',
      });
    });

    // 监听全局错误
    window.addEventListener('error', (event) => {
      this.handle({
        type: ErrorType.RUNTIME,
        level: ErrorLevel.ERROR,
        message: `Global error: ${event.message}`,
        error: event.error as Error | undefined,
        data: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
        timestamp: Date.now(),
        source: 'global',
      });
    });
  }

  /**
   * 处理错误
   */
  handle(error: ErrorInfo): void {
    // 添加到缓存
    this.addToCache(error);

    // 控制台输出
    if (this.config.enableConsole) {
      this.logToConsole(error);
    }

    // 执行类型特定的处理器
    this.executeTypeHandlers(error);

    // 自定义处理器
    if (this.config.customHandler) {
      this.config.customHandler(error);
    }

    // 上报错误
    if (this.config.enableReport && this.config.reportUrl) {
      this.reportError(error);
    }
  }

  /**
   * 快捷处理错误方法
   */
  report(
    type: ErrorType,
    level: ErrorLevel,
    message: string,
    error?: Error,
    data?: Record<string, unknown>,
    source?: string
  ): void {
    this.handle({
      type,
      level,
      message,
      error,
      data,
      timestamp: Date.now(),
      source,
    });
  }

  /**
   * 安全执行函数，捕获异常并处理
   * 适用于 localStorage、DOM 操作等可能抛异常的场景
   */
  safeCall<T>(
    fn: () => T,
    type: ErrorType,
    code: string,
    message: string,
    source?: string,
  ): SafeResult<T> {
    try {
      const value = fn();
      return { success: true, value };
    } catch (e) {
      const cause = e instanceof Error ? e : new Error(String(e));
      const errorInfo: ErrorInfo = {
        type,
        level: ErrorLevel.ERROR,
        message: `${code}: ${message}`,
        error: cause,
        timestamp: Date.now(),
        source,
      };
      this.handle(errorInfo);
      return { success: false, error: errorInfo };
    }
  }

  /**
   * 添加错误到缓存
   */
  private addToCache(error: ErrorInfo): void {
    this.errorCache.push(error);
    if (this.errorCache.length > this.config.maxCacheSize) {
      this.errorCache.shift();
    }
  }

  /**
   * 输出到控制台（通过 logger）
   */
  private logToConsole(error: ErrorInfo): void {
    const message = `[${error.type.toUpperCase()}][${error.level.toUpperCase()}] ${error.message}`;

    switch (error.level) {
      case ErrorLevel.WARN:
        logger.warn(message, error.error, error.data);
        break;
      case ErrorLevel.ERROR:
        logger.error(message, error.error, error.data);
        break;
      case ErrorLevel.FATAL:
        logger.error(message, error.error, error.data);
        break;
    }
  }

  /**
   * 执行类型特定的处理器
   */
  private executeTypeHandlers(error: ErrorInfo): void {
    const handlers = this.errorHandlers.get(error.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(error);
        } catch (e) {
          logger.error('Error handler execution failed:', e);
        }
      });
    }
  }

  /**
   * 上报错误到服务器
   */
  private reportError(error: ErrorInfo): void {
    const result = this.safeCall(
      () => fetch(this.config.reportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...error,
          userAgent: navigator.userAgent,
          url: window.location.href,
        }),
      }),
      ErrorType.NETWORK,
      'REPORT_FAILED',
      'Error report failed',
      'ErrorHandler',
    );
    if (!result.success) {
      logger.error('Error report failed');
    }
  }

  /**
   * 注册错误类型处理器
   */
  onError(type: ErrorType, handler: (error: ErrorInfo) => void): () => void {
    if (!this.errorHandlers.has(type)) {
      this.errorHandlers.set(type, []);
    }

    const handlers = this.errorHandlers.get(type)!;
    handlers.push(handler);

    return () => {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    };
  }

  /**
   * 获取错误缓存
   */
  getErrorCache(): ErrorInfo[] {
    return [...this.errorCache];
  }

  /**
   * 清空错误缓存
   */
  clearCache(): void {
    this.errorCache = [];
  }

  /**
   * 获取错误统计
   */
  getErrorStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const error of this.errorCache) {
      stats[error.type] = (stats[error.type] || 0) + 1;
    }
    return stats;
  }

  /**
   * 销毁错误处理器
   */
  destroy(): void {
    this.errorCache = [];
    this.errorHandlers.clear();
  }
}

/**
 * 全局错误处理器实例
 */
export const globalErrorHandler = new ErrorHandler();

/**
 * 创建错误处理器实例
 */
export function createErrorHandler(config?: ErrorHandlerConfig): ErrorHandler {
  return new ErrorHandler(config);
}

/**
 * 安全调用工具接口
 */
export interface SafeCallUtils {
  /** 安全执行存储操作 */
  storage<T>(fn: () => T, code: string, message: string): SafeResult<T>;
  /** 安全执行网络操作 */
  network<T>(fn: () => T, code: string, message: string): SafeResult<T>;
  /** 安全执行媒体操作 */
  media<T>(fn: () => T, code: string, message: string): SafeResult<T>;
  /** 安全执行插件操作 */
  plugin<T>(fn: () => T, code: string, message: string): SafeResult<T>;
  /** 安全执行通用操作 */
  general<T>(fn: () => T, code: string, message: string): SafeResult<T>;
}

/**
 * 创建模块专用的安全调用工具
 */
export function createSafeCall(source: string): SafeCallUtils {
  return {
    /** 安全执行存储操作 */
    storage<T>(fn: () => T, code: string, message: string): SafeResult<T> {
      return globalErrorHandler.safeCall(fn, ErrorType.STORAGE, code, message, source);
    },
    /** 安全执行网络操作 */
    network<T>(fn: () => T, code: string, message: string): SafeResult<T> {
      return globalErrorHandler.safeCall(fn, ErrorType.NETWORK, code, message, source);
    },
    /** 安全执行媒体操作 */
    media<T>(fn: () => T, code: string, message: string): SafeResult<T> {
      return globalErrorHandler.safeCall(fn, ErrorType.MEDIA, code, message, source);
    },
    /** 安全执行插件操作 */
    plugin<T>(fn: () => T, code: string, message: string): SafeResult<T> {
      return globalErrorHandler.safeCall(fn, ErrorType.PLUGIN, code, message, source);
    },
    /** 安全执行通用操作 */
    general<T>(fn: () => T, code: string, message: string): SafeResult<T> {
      return globalErrorHandler.safeCall(fn, ErrorType.GENERAL, code, message, source);
    },
  };
}
