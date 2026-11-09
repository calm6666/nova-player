/**
 * ============================================
 * 持久化存储封装（localStorage）
 * ============================================
 * 对应配置 `storage: { enabled?: boolean; prefix?: string }`：
 *   - enabled 默认 true（与既有实现一致），false 时完全不读写；
 *   - key 自动加 `prefix`（默认 'nova-player:'）；
 *   - SSR 安全：isBrowser() 守卫，服务端直接返回默认值 / 静默跳过；
 *   - 隐私模式（localStorage 读写抛异常）下 try/catch 静默降级。
 *
 * 持久化内容（对按既有实现 player 的 storage 用法）：
 *   - 音量 / 静音 / 倍速：变化时写入，构造 / 挂载时读回并应用；
 *   - 播放进度（记忆上次看到）：timeupdate 节流写 `{ src, time, duration }`，
 *     播放完清除；再次加载同一 src 且进度有效时恢复并提示 Toast。
 */

import { isBrowser } from '@lumina/framework/utils';

/** 默认 key 前缀 */
export const DEFAULT_STORAGE_PREFIX = 'nova-player:';

/** 存储配置（与 PlayerConfig.storage 一致） */
export interface StorageOptions {
  /** 是否启用持久化（默认 true） */
  enabled?: boolean;
  /** key 前缀（默认 'nova-player:'） */
  prefix?: string;
}

/** 当前生效的启用状态（模块级，setConfig 可即时切换） */
let storageEnabled = true;

/** 当前生效的 key 前缀 */
let storagePrefix = DEFAULT_STORAGE_PREFIX;

/**
 * 应用存储配置（VideoPlayer 构造 / setConfig 时调用）
 * @param options - 存储配置；未提供 enabled 时默认开启
 */
export function configureStorage(options?: StorageOptions): void {
  storageEnabled = options?.enabled !== false;
  storagePrefix = options?.prefix ?? DEFAULT_STORAGE_PREFIX;
}

/**
 * 当前持久化是否启用
 */
export function isStorageEnabled(): boolean {
  return storageEnabled;
}

/**
 * 给 key 加前缀
 * @param key - 原始 key
 * @returns 带前缀的完整 key
 */
function prefixedKey(key: string): string {
  return `${storagePrefix}${key}`;
}

/**
 * 读取持久化数据
 * @param key - 原始 key（内部自动加前缀）
 * @param def - 读取失败 / 不存在时的默认值
 * @returns 存储值（JSON 反序列化）或默认值
 */
export function getStorage<T>(key: string, def: T): T {
  if (!storageEnabled || !isBrowser()) return def;
  try {
    const raw = window.localStorage.getItem(prefixedKey(key));
    if (raw === null) return def;
    return JSON.parse(raw) as T;
  } catch {
    // 隐私模式下 localStorage 读取可能抛异常，静默降级为默认值
    return def;
  }
}

/**
 * 写入持久化数据
 * @param key - 原始 key（内部自动加前缀）
 * @param value - 要存储的值（JSON 序列化）
 */
export function setStorage(key: string, value: unknown): void {
  if (!storageEnabled || !isBrowser()) return;
  try {
    window.localStorage.setItem(prefixedKey(key), JSON.stringify(value));
  } catch {
    // 隐私模式下 localStorage 写入可能抛异常（如配额已满），静默跳过
  }
}

/**
 * 移除持久化数据
 * @param key - 原始 key（内部自动加前缀）
 */
export function removeStorage(key: string): void {
  if (!storageEnabled || !isBrowser()) return;
  try {
    window.localStorage.removeItem(prefixedKey(key));
  } catch {
    // 隐私模式下 localStorage 移除可能抛异常，静默跳过
  }
}
