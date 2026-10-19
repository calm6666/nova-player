/**
 * ============================================
 * 模式 B：服务端字幕 Provider
 * ============================================
 * 旧配置 aiBackend（AiSubtitleBackendConfig）升级映射为单轨
 * RemoteSubtitleProvider（旧配置继续可用，映射为单轨 original）。
 * 多轨/增量协议由使用方按 RemoteSubtitleProvider 接口自行注入。
 *
 * @module packages/plugins/src/subtitle/remoteProvider
 */

import type {
  AiSubtitleEntry,
  RemoteSubtitleProvider,
  RemoteSubtitleTrack,
} from '@/types/subtitle';
import type { AiSubtitleBackendConfig } from './aiSubtitleConfig';
import { AiSubtitleFetcher } from './AiSubtitleFetcher';

/** 旧配置映射出的单轨轨道 id */
export const LEGACY_REMOTE_TRACK_ID = 'ai';

/** 拉取参数解析器（videoId/lang/duration 在拉取时刻动态读取） */
export type RemoteFetchParamsResolver = () => {
  videoId?: string;
  lang?: string;
  duration?: number;
};

/**
 * 把旧 aiBackend 配置包装为单轨 RemoteSubtitleProvider
 * - listTracks：返回单条 original 轨（label 沿用 'AI Subtitle'）
 * - activateTrack：单轨 no-op
 * - fetch：委托 AiSubtitleFetcher 整段拉取（不支持增量，range 被忽略）
 */
export function createLegacyRemoteProvider(
  config: AiSubtitleBackendConfig,
  resolveParams: RemoteFetchParamsResolver,
): RemoteSubtitleProvider {
  /** 获取器实例（懒构造，拉取时才创建） */
  let fetcher: AiSubtitleFetcher | null = null;

  return {
    type: 'remote',
    incremental: false,

    async fetch(): Promise<AiSubtitleEntry[]> {
      if (!fetcher) {
        fetcher = new AiSubtitleFetcher(config);
      }
      return fetcher.fetch(resolveParams());
    },

    async listTracks(): Promise<RemoteSubtitleTrack[]> {
      return [
        {
          trackId: LEGACY_REMOTE_TRACK_ID,
          lang: resolveParams().lang ?? 'ai',
          label: 'AI Subtitle',
          kind: 'original',
        },
      ];
    },

    async activateTrack(): Promise<void> {
      // 单轨 Provider：无需切换
    },
  };
}
