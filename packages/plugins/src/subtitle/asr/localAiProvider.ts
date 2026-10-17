/**
 * ============================================
 * 本地识别默认 Provider（localAiProvider）
 * ============================================
 * 由插件在 startLocalAi 时组装：订阅采集流 → VAD 分段 → 引擎识别 →
 * onCue 推送（partial 灰显 / final 落定），实现 LocalAiSubtitleProvider 接口。
 *
 * 职责边界（docs/subtitle-dual-mode-design.md 3.2/4.3/4.7）：
 * - 引擎 init 由插件在 start 前完成（模型下载/加载状态由插件广播）
 * - Provider 只负责「音频 → 文本」的实时管线与播放器事件联动：
 *   rateChange → VAD 阈值联动；seekEnd → 丢弃在途段与 pending 音频
 * - 低置信 final 直接丢弃（文档 4.3 的「丢弃」选项）；
 *   「历史命中避免重复识别」（4.6）属 P2 优化，暂不实现
 * - cue 的 id 由插件统一重排（本地轨负数自增），此处填占位 0
 *
 * @module packages/plugins/src/subtitle/asr/localAiProvider
 */

import type {
  AsrEngine,
  LocalAiSubtitleProvider,
  SubtitleEngineContext,
  SubtitleItem,
} from '@/types/subtitle';
import { VadSegmenter } from './vadSegmenter';
import { isBrowser } from '@/utils';

/** 本地识别轨 id（插件轨道注册表与 SubtitleCueEvent.trackId 共用） */
export const LOCAL_AI_TRACK_ID = 'local-ai';

/** partial 的展示余量（秒）：partial 覆盖到当前时间之后一小段，避免闪烁（worker 版 provider 共用） */
export const PARTIAL_TAIL_SECONDS = 2;

/** Provider 组装参数 */
export interface LocalAiProviderOptions {
  /** 已完成 init 的识别引擎实例 */
  engine: AsrEngine;
  /** 识别语言 */
  lang: string;
  /** 置信度阈值（低于丢弃，默认 0.35） */
  confidenceThreshold?: number;
  /** 单段最长秒数（默认 15） */
  maxSegmentSeconds?: number;
}

/**
 * 组装默认的本地识别 Provider
 * 采集链由插件持有（SubtitleEngineContext.audioStream 注入），此处只消费
 */
export function createLocalAiProvider(
  options: LocalAiProviderOptions,
): LocalAiSubtitleProvider {
  const { engine, lang } = options;
  const threshold = options.confidenceThreshold ?? 0.35;

  /** 取消订阅函数集合（stop 时统一执行） */
  const unsubscribers: Array<() => void> = [];
  /** 是否已启动（stop 后 start 需重新组装，此实例不可复用） */
  let started = false;
  /** 当前语音段起始媒体时间（partial 的时间轴用） */
  let segmentStart = 0;

  const provider: LocalAiSubtitleProvider = {
    type: 'local-ai',

    start(context: SubtitleEngineContext): void {
      if (started) return;
      started = true;

      // —— VAD 分段器：状态机回调映射到引擎调用与 cue 推送 ——
      const vad = new VadSegmenter(
        {
          /** 开段：记录段首时间，并清掉上一段遗留的 partial */
          onSegmentStart: (mediaTime): void => {
            segmentStart = mediaTime;
            provider.onCue?.({
              trackId: LOCAL_AI_TRACK_ID,
              lang,
              finalCues: [],
              partialCue: null,
            });
          },
          /** 段内音频：喂引擎，partial 即时上屏（灰显） */
          onSegmentAudio: (samples, mediaTime): void => {
            const partial = engine.acceptAudio(samples, mediaTime);
            if (partial && partial.text) {
              const partialItem: SubtitleItem = {
                id: 0,
                startTime: segmentStart,
                endTime: mediaTime + PARTIAL_TAIL_SECONDS,
                text: partial.text,
              };
              provider.onCue?.({
                trackId: LOCAL_AI_TRACK_ID,
                lang,
                finalCues: [],
                partialCue: partialItem,
              });
            }
          },
          /** 段尾：产出 final（低于置信度阈值丢弃），清除 partial */
          onSegmentEnd: (startTime, endTime): void => {
            const final = engine.finalizeSegment();
            if (
              final &&
              final.text &&
              final.confidence >= threshold
            ) {
              const finalItem: SubtitleItem = {
                id: 0,
                startTime,
                endTime,
                text: final.text,
              };
              provider.onCue?.({
                trackId: LOCAL_AI_TRACK_ID,
                lang,
                finalCues: [finalItem],
                partialCue: null,
              });
            } else {
              // 丢弃也要清 partial，避免灰显文本滞留
              provider.onCue?.({
                trackId: LOCAL_AI_TRACK_ID,
                lang,
                finalCues: [],
                partialCue: null,
              });
            }
          },
        },
        { maxSegmentSeconds: options.maxSegmentSeconds },
      );

      // —— 订阅采集流：PCM 块喂 VAD ——
      unsubscribers.push(
        context.audioStream.onChunk((samples, mediaTime): void => {
          vad.feed(samples, mediaTime);
        }),
      );

      // —— 播放器事件联动（4.7）——
      // seek 结束：丢弃在途音频与 pending 段（引擎 reset），清除灰显 partial
      unsubscribers.push(
        context.events.on('seekEnd', (): void => {
          vad.reset();
          engine.reset?.();
          segmentStart = 0;
          provider.onCue?.({
            trackId: LOCAL_AI_TRACK_ID,
            lang,
            finalCues: [],
            partialCue: null,
          });
        }),
      );
      // 倍速变化：VAD 阈值联动（>1.5x 提高 thresholds 缓解变速噪声）
      unsubscribers.push(
        context.events.on('rateChange', (rate): void => {
          if (typeof rate === 'number') {
            vad.setPlaybackRate(rate);
          }
        }),
      );
    },

    stop(): void {
      if (!started) return;
      started = false;
      // 统一退订 + 释放引擎资源（字幕条目由插件保留）
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      unsubscribers.length = 0;
      if (isBrowser()) {
        engine.dispose();
      }
    },

    onCue: undefined,
  };

  return provider;
}
