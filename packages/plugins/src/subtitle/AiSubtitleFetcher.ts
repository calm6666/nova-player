/**
 * ============================================
 * AI 字幕获取器（AiSubtitleFetcher）
 * ============================================
 * 根据 videoId / lang / duration 向后端请求 AI 生成的字幕，
 * 返回标准 AiSubtitleEntry[]；再通过 toSubtitleItems 转成 SubtitleItem[]，
 * 直接喂给 SubtitlePlugin 的二分查找 + RAF 渲染管线。
 *
 * 设计要点：
 * - 超时用 AbortController + setTimeout 实现，不引入新依赖
 * - URL 模板支持 {videoId}/{lang}/{duration} 占位符
 * - 响应解析优先用 config.parseResponse，否则用 defaultAiSubtitleParser
 * - SSR 场景直接抛错（fetch 不可用），调用方 catch 后回退到普通字幕
 *
 * @module packages/plugins/src/subtitle/AiSubtitleFetcher
 */

import type { AiSubtitleBackendConfig, AiSubtitleEntry } from './aiSubtitleConfig';
import { defaultAiSubtitleParser, fillAiTemplate, aiSubtitleEntriesToItems } from './aiSubtitleConfig';
import type { SubtitleItem } from '@lumina/nova';
import { isBrowser } from '@lumina/framework/utils';

/** 默认请求超时（毫秒） */
const DEFAULT_TIMEOUT = 30000;

export class AiSubtitleFetcher {
  constructor(private config: AiSubtitleBackendConfig) {}

  /**
   * 请求 AI 字幕
   * 后端未对接 / 非浏览器环境时抛出明确错误，调用方 catch 后回退
   *
   * @param params - 视频信息：videoId / lang / duration，全部可选
   * @returns 后端解析后的 AiSubtitleEntry[]
   */
  async fetch(params: {
    videoId?: string;
    lang?: string;
    duration?: number;
  }): Promise<AiSubtitleEntry[]> {
    if (!isBrowser()) {
      throw new Error('[AiSubtitleFetcher] 非浏览器环境，无法发起 AI 字幕请求');
    }

    const endpoint = this.config.endpoint;
    if (!endpoint || typeof endpoint !== 'string') {
      throw new Error('[AiSubtitleFetcher] 未配置后端 endpoint');
    }

    const method = this.config.method ?? 'GET';
    const timeout = this.config.timeout ?? DEFAULT_TIMEOUT;
    const headers: Record<string, string> = { ...(this.config.headers ?? {}) };

    const url = fillAiTemplate(endpoint, params);

    const controller = new AbortController();
    const timer = setTimeout((): void => controller.abort(), timeout);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      // POST 时附带请求体，并补默认 Content-Type
      if (method === 'POST' && this.config.body) {
        const filledBody = this.fillBody(this.config.body, params);
        fetchOptions.body = JSON.stringify(filledBody);
        if (!headers['Content-Type']) {
          headers['Content-Type'] = 'application/json';
        }
      }

      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        throw new Error(`[AiSubtitleFetcher] HTTP ${response.status} ${response.statusText}`);
      }

      const raw: unknown = await response.json();
      const parser = this.config.parseResponse ?? defaultAiSubtitleParser;
      const entries = parser(raw);
      return entries;
    } catch (error) {
      // AbortError 转成更明确的超时错误，方便调用方区分
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`[AiSubtitleFetcher] 请求超时（${timeout}ms）`);
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`[AiSubtitleFetcher] 未知错误：${String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 把 AiSubtitleEntry[] 转成 SubtitleItem[]（@/types/subtitle 的格式）
   * 委托 aiSubtitleConfig 的公共转换器（与服务端轨/译文轨共用同一转换逻辑）：
   * - 多行文本（\n）转成 <br> 以兼容现有 RAF 渲染管线
   * - 若有 translation，拼成双语（原文 <br> 译文）
   * - id 从 1 开始自增，保证二分查找稳定
   */
  toSubtitleItems(entries: AiSubtitleEntry[]): SubtitleItem[] {
    return aiSubtitleEntriesToItems(entries, 1);
  }

  /**
   * 替换请求体里的占位符
   * 只处理字符串类型字段的占位符；其他类型原样返回
   */
  private fillBody(
    body: Record<string, unknown>,
    params: { videoId?: string; lang?: string; duration?: number }
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(body)) {
      const value = body[key];
      result[key] = typeof value === 'string' ? fillAiTemplate(value, params) : value;
    }
    return result;
  }
}
