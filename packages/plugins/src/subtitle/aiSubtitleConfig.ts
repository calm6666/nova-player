/**
 * ============================================
 * AI 字幕 - 后端接口配置
 * ============================================
 * 工业级通用方案：后端接口可配置、后续对接。
 * - 用户可配置 AI 字幕后端 API 端点（URL 模板、请求头、请求参数、响应解析器）
 * - 后端调用后续对接，但接口和管道现在就打通
 * - 默认响应解析器兼容两种常见形态：
 *   1) 直接的 [{ start, end, text }, ...] 数组
 *   2) { subtitles: [...] } / { data: [...] } 包裹
 *
 * 全部使用类型谓词函数替代 as 断言校验结构。
 *
 * @module packages/plugins/src/subtitle/aiSubtitleConfig
 */

// AiSubtitleEntry 已迁移至 @/types/subtitle 统一维护（模式 B Provider 也引用），
// 此处 re-export 保持既有导入路径兼容
export type { AiSubtitleEntry } from '@lumina/nova';
import type { AiSubtitleEntry } from '@lumina/nova';
import type { SubtitleItem } from '@lumina/nova';

/** AI 字幕后端接口配置 */
export interface AiSubtitleBackendConfig {
  /** 后端接口 URL 模板，支持 {videoId}/{lang}/{duration} 占位符 */
  endpoint: string;
  /** 请求方法（默认 GET） */
  method?: 'GET' | 'POST';
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求体（POST 时使用，支持 {videoId}/{lang}/{duration} 占位符） */
  body?: Record<string, unknown>;
  /** 超时（毫秒，默认 30000） */
  timeout?: number;
  /** 响应解析器：把后端返回体转成 AiSubtitleEntry[]；不提供则用默认解析器 */
  parseResponse?: (raw: unknown) => AiSubtitleEntry[];
}

// ============================================
// 内部类型谓词：用 typeof / in 校验结构，禁止 as 断言
// ============================================

/** 已校验的原始条目结构（含可选字段，便于后续读取 translation/confidence） */
type RawEntry = {
  start: number;
  end: number;
  text: string;
  translation?: string;
  confidence?: number;
};

/**
 * 判定一个 unknown 值是否为合法的 AI 字幕原始条目
 * 使用 typeof + in 进行结构窄化，禁止 as 断言
 */
function isRawEntry(value: unknown): value is RawEntry {
  if (typeof value !== 'object' || value === null) return false;
  if (!('start' in value) || !('end' in value) || !('text' in value)) return false;
  return (
    typeof value.start === 'number' &&
    typeof value.end === 'number' &&
    typeof value.text === 'string'
  );
}

/**
 * 从原始响应中提取字幕条目数组
 * 兼容三种形态：
 *   1) 直接的数组
 *   2) { subtitles: [...] } 包裹
 *   3) { data: [...] } 包裹
 */
function extractEntryArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object' && raw !== null && 'subtitles' in raw) {
    const wrapped = raw;
    if (Array.isArray(wrapped.subtitles)) {
      return wrapped.subtitles;
    }
  }
  if (typeof raw === 'object' && raw !== null && 'data' in raw) {
    const wrapped = raw;
    if (Array.isArray(wrapped.data)) {
      return wrapped.data;
    }
  }
  return [];
}

/** 把已校验的原始条目转成对外暴露的 AiSubtitleEntry */
function toAiSubtitleEntry(item: RawEntry): AiSubtitleEntry {
  const entry: AiSubtitleEntry = {
    start: item.start,
    end: item.end,
    text: item.text,
  };
  if (typeof item.translation === 'string') {
    entry.translation = item.translation;
  }
  if (typeof item.confidence === 'number') {
    entry.confidence = item.confidence;
  }
  return entry;
}

/**
 * 默认响应解析器：兼容直接数组与 { subtitles: [...] } / { data: [...] } 两种形态
 * 非法条目会被静默过滤，确保下游管道拿到的是干净数据
 */
export const defaultAiSubtitleParser = (raw: unknown): AiSubtitleEntry[] => {
  const arr = extractEntryArray(raw);
  return arr.filter(isRawEntry).map(toAiSubtitleEntry);
};

/**
 * 占位符替换：把 URL 模板里的 {videoId}/{lang}/{duration} 替换成实际值
 * 任意缺失的占位符替换为空字符串
 */
export function fillAiTemplate(
  template: string,
  params: { videoId?: string; lang?: string; duration?: number }
): string {
  const videoId = params.videoId ?? '';
  const lang = params.lang ?? '';
  const duration = params.duration !== undefined ? String(params.duration) : '';
  return template
    .replace(/\{videoId\}/g, videoId)
    .replace(/\{lang\}/g, lang)
    .replace(/\{duration\}/g, duration);
}

/**
 * 把 AiSubtitleEntry[] 转成 SubtitleItem[]（渲染管线格式）
 * 模式 B（服务端轨/译文轨）与 AiSubtitleFetcher.toSubtitleItems 共用的独立转换器：
 * - 多行文本（\n）转成 <br> 以兼容现有 RAF 渲染管线
 * - 若有 translation，拼成双语（原文 <br> 译文）
 * - id 从 startId 起自增，保证二分查找稳定（本地轨负数 / 服务端轨正数由调用方决定）
 */
export function aiSubtitleEntriesToItems(
  entries: AiSubtitleEntry[],
  startId = 1
): SubtitleItem[] {
  return entries.map((entry, index): SubtitleItem => {
    const primaryText = entry.text.replace(/\n/g, '<br>');
    const translationText =
      typeof entry.translation === 'string'
        ? entry.translation.replace(/\n/g, '<br>')
        : '';
    const text = translationText
      ? `${primaryText}<br>${translationText}`
      : primaryText;
    return {
      id: startId + index,
      startTime: entry.start,
      endTime: entry.end,
      text,
    };
  });
}
