/**
 * i18n 国际化核心模块
 *
 * 设计要点：
 * 1. 响应式核心：localeSignal 是自研 signalsCore 的 signal，
 *    任何 effect 内读取 localeSignal.value 会自动建立依赖，
 *    setLocale 触发所有依赖 effect 重跑 → 精准更新 DOM（细粒度响应式）
 * 2. 零开销路径：未启用 i18n 时，t() 不读 signal，直接返回 en-US 查表结果或 key 字面量
 * 3. t() 在 effect 上下文中调用时自动追踪 locale 变化（编译期 _reactiveText 包装后生效）
 * 4. fallback 链：当前语言 → fallbackLocale → en-US → key 字面量
 *
 * 用法：
 *   import { t, setLocale, initI18n } from '@lumina/framework/core';
 *   initI18n({ enabled: true, locale: 'zh-CN' });
 *   const text = t('player.ui.controls.play'); // 在 effect 中自动响应 setLocale
 *   setLocale('en-US'); // 触发所有依赖 effect 重跑
 */

import { signal, effect } from './signalsCore';
import type { Signal } from './signalsCore';
import { warn, WarnSource } from './warning';

/** 语言代码类型 */
export type Locale = string;

/** i18n 配置接口 */
export interface I18nConfig {
  /** 是否启用 i18n（默认 false，未启用时 t() 走零开销路径） */
  enabled?: boolean;
  /** 初始语言（默认 'en-US'） */
  locale?: Locale;
  /** fallback 语言（默认 'en-US'） */
  fallbackLocale?: Locale;
  /** 初始语言包映射 */
  messages?: Record<Locale, Record<string, string>>;
}

// ===== 响应式核心：当前语言 signal =====
// 任何 effect 内读取 .value 自动建立依赖，setLocale 触发所有依赖 effect 重跑
export const localeSignal: Signal<Locale> = signal<Locale>('en-US');
const fallbackSignal: Signal<Locale> = signal<Locale>('en-US');

// 语言包注册表：locale → { key → text }
const messagesRegistry: Record<Locale, Record<string, string>> = {};

// i18n 是否启用（默认不启用，未启用时 t() 不读 signal，零开销）
let i18nEnabled = false;

// 占位符插值正则：{name} → params.name
const PLACEHOLDER_RE = /\{(\w+)\}/g;

/**
 * 类型谓词：判断值是否为 Record<string, string>
 * 替代 as 断言，用于校验 registerLocale 的输入
 */
function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

/**
 * 翻译函数
 *
 * 内部读取 localeSignal.value 建立响应式依赖：
 * - 在 effect 上下文中调用时，setLocale 会触发 effect 重跑
 * - 未启用 i18n 时走零开销路径：不读 signal，直接返回 en-US 查表结果或 key 字面量
 *
 * @param key - 翻译键（如 'player.ui.controls.play'）
 * @param params - 插值参数（如 { name: 'Lumina' } 替换 {name} 占位符）
 * @returns 翻译后的字符串，找不到时返回 key 字面量
 */
export function t(key: string, params?: Record<string, unknown>): string {
  if (!i18nEnabled) {
    // 零开销路径：不读 signal，直接返回 en-US 查表结果或 key
    const enMessages = messagesRegistry['en-US'];
    return interpolate(enMessages?.[key] ?? key, params);
  }
  // ★ 读取 localeSignal.value 建立响应式依赖
  const locale = localeSignal.value;
  let text = messagesRegistry[locale]?.[key];
  if (text === undefined) {
    const fallback = fallbackSignal.value;
    if (fallback !== locale) text = messagesRegistry[fallback]?.[key];
    if (text === undefined && locale !== 'en-US' && fallback !== 'en-US') {
      text = messagesRegistry['en-US']?.[key];
    }
    if (text === undefined) text = key;
  }
  return interpolate(text, params);
}

/**
 * 占位符插值：将 {name} 替换为 params.name 的字符串形式
 */
function interpolate(text: string, params?: Record<string, unknown>): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER_RE, (_, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

/**
 * 切换当前语言
 * 触发所有读取 localeSignal.value 的 effect 重跑（精准更新 DOM）
 */
export function setLocale(locale: Locale): void {
  localeSignal.value = locale;
}

/**
 * 获取当前语言
 */
export function getLocale(): Locale {
  return localeSignal.value;
}

/**
 * 注册语言包
 * @param locale - 语言代码（如 'zh-CN'）
 * @param messages - 翻译映射 { key: text }
 */
export function registerLocale(locale: Locale, messages: Record<string, string>): void {
  if (!isStringRecord(messages)) {
    warn(WarnSource.I18N, 'i18n registerLocale: messages must be Record<string, string>');
    return;
  }
  messagesRegistry[locale] = messages;
}

/**
 * 订阅语言变化
 * 基于 effect 实现，返回取消订阅函数
 */
export function subscribeLocale(listener: (locale: Locale) => void): () => void {
  return effect(() => listener(localeSignal.value));
}

/**
 * 查询 i18n 是否已启用
 */
export function isI18nEnabled(): boolean {
  return i18nEnabled;
}

/**
 * 初始化 i18n 配置
 * 在应用启动时调用一次
 */
export function initI18n(config: I18nConfig): void {
  if (config.enabled) i18nEnabled = true;
  if (config.locale) localeSignal.value = config.locale;
  if (config.fallbackLocale) fallbackSignal.value = config.fallbackLocale;
  if (config.messages) {
    for (const [loc, msgs] of Object.entries(config.messages)) {
      if (isStringRecord(msgs)) messagesRegistry[loc] = msgs;
    }
  }
}
