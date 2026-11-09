/**
 * ============================================
 * 全局日志工具
 * ============================================
 * 统一管理播放器的日志输出，支持日志级别控制和模块标签
 */

/**
 * 日志级别枚举
 */
export enum LogLevel {
  /** 调试信息，仅开发环境输出 */
  DEBUG = 0,
  /** 常规信息 */
  INFO = 1,
  /** 警告信息 */
  WARN = 2,
  /** 错误信息 */
  ERROR = 3,
  /** 静默模式，不输出任何日志 */
  SILENT = 4,
}

/**
 * 日志配置接口
 */
export interface LoggerConfig {
  /** 最低日志级别，低于此级别的日志不会输出 */
  level: LogLevel;
  /** 是否启用日志 */
  enabled: boolean;
  /** 自定义日志输出处理器 */
  handler?: LogHandler;
}

/**
 * 日志条目接口
 */
export interface LogEntry {
  /** 日志级别 */
  level: LogLevel;
  /** 模块标签 */
  tag: string;
  /** 日志消息 */
  message: string;
  /** 附加数据 */
  data?: unknown[];
  /** 时间戳 */
  timestamp: number;
}

/**
 * 自定义日志处理器类型
 */
export type LogHandler = (entry: LogEntry) => void;

/**
 * 默认日志配置
 */
const defaultConfig: LoggerConfig = {
  level: LogLevel.WARN,
  enabled: true,
};

/**
 * 全局日志管理器
 */
class LoggerManager {
  private config: LoggerConfig;
  private readonly handlers: Set<LogHandler> = new Set();

  constructor(config?: Partial<LoggerConfig>) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * 启用/禁用日志
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * 添加自定义日志处理器
   */
  addHandler(handler: LogHandler): void {
    this.handlers.add(handler);
  }

  /**
   * 移除日志处理器
   */
  removeHandler(handler: LogHandler): void {
    this.handlers.delete(handler);
  }

  /**
   * 创建模块日志器
   */
  createLogger(tag: string): Logger {
    return new Logger(tag, this);
  }

  /**
   * 内部输出方法
   */
  log(level: LogLevel, tag: string, message: string, ...data: unknown[]): void {
    if (!this.config.enabled || level < this.config.level) return;

    const entry: LogEntry = {
      level,
      tag,
      message,
      data: data.length > 0 ? data : undefined,
      timestamp: Date.now(),
    };

    // 分发自定义处理器
    this.handlers.forEach(handler => {
      try {
        handler(entry);
      } catch {
        // 处理器异常不影响主流程
      }
    });

    // 默认控制台输出
    if (this.config.handler) {
      this.config.handler(entry);
      return;
    }

    const prefix = `[${tag}]`;

    switch (level) {
      case LogLevel.DEBUG:
        // eslint-disable-next-line no-console
        console.debug(prefix, message, ...data);
        break;
      case LogLevel.INFO:
        console.info(prefix, message, ...data);
        break;
      case LogLevel.WARN:
        console.warn(prefix, message, ...data);
        break;
      case LogLevel.ERROR:
        console.error(prefix, message, ...data);
        break;
    }
  }
}

/**
 * 模块日志器
 * 每个模块创建独立的 Logger 实例，带有模块标签
 */
export class Logger {
  constructor(
    private readonly tag: string,
    private readonly manager: LoggerManager,
  ) {}

  /** 调试日志 */
  debug(message: string, ...data: unknown[]): void {
    this.manager.log(LogLevel.DEBUG, this.tag, message, ...data);
  }

  /** 信息日志 */
  info(message: string, ...data: unknown[]): void {
    this.manager.log(LogLevel.INFO, this.tag, message, ...data);
  }

  /** 警告日志 */
  warn(message: string, ...data: unknown[]): void {
    this.manager.log(LogLevel.WARN, this.tag, message, ...data);
  }

  /** 错误日志 */
  error(message: string, ...data: unknown[]): void {
    this.manager.log(LogLevel.ERROR, this.tag, message, ...data);
  }
}

/**
 * 全局日志管理器实例
 */
export const loggerManager = new LoggerManager();

/**
 * 创建模块日志器的快捷方法
 */
export function createLogger(tag: string): Logger {
  return loggerManager.createLogger(tag);
}
