/**
 * 播放器内置语言包（应用层 packages/player 持有）
 *
 * 语言包属于播放器实现，不属于 framework：
 * - framework 只提供 core/i18n.ts 引擎（initI18n / registerLocale / t / setLocale）
 * - 播放器入口 import 本模块，自动注册内置 en-US / zh-CN
 * - 外部如果需要原始 JSON，可从 @lumina/nova 使用 bundledEnUS / bundledZhCN
 */
import enUS from './en-US.json';
import zhCN from './zh-CN.json';
import { registerLocale } from '@lumina/framework/i18n';

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

// 自动注册内置语言包
if (isStringRecord(enUS)) registerLocale('en-US', enUS);
if (isStringRecord(zhCN)) registerLocale('zh-CN', zhCN);

/** 内置 en-US 语言包（供调用方按需引用/覆盖） */
export const bundledEnUS: Record<string, string> = isStringRecord(enUS) ? enUS : {};
/** 内置 zh-CN 语言包（供调用方按需引用/覆盖） */
export const bundledZhCN: Record<string, string> = isStringRecord(zhCN) ? zhCN : {};
