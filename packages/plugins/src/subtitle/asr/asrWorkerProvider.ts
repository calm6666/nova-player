/**
 * ASR Worker 主线程桥接 Provider（与 localAiProvider 同接口）
 *
 * 职责分工：
 * - 主线程（本文件）：创建 Worker、转发音频块（transfer 零拷贝）、
 *   按 SubtitleCueEvent 协议推送 partial / final（与 localAiProvider
 *   输出完全一致，SubtitlePlugin 无感知切换）
 * - Worker（asrWorker.ts）：VAD 分段 + 引擎推理（重计算不占主线程）
 *
 * 与主线程版 createLocalAiProvider 的差异：
 * - 引擎不传实例而是 engineKind 字符串（Worker 内工厂注册表创建）
 * - 置信度过滤仍在本文件（保持与主线程版一致的阈值语义）
 * - SubtitlePlugin 持有的采集链不变（audioStream 订阅 → 转发 worker）
 *
 * @module packages/plugins/src/subtitle/asr/asrWorkerProvider
 */

import type {
  LocalAiSubtitleProvider,
  SubtitleEngineContext,
  SubtitleItem,
} from '@/types/subtitle';
import { isBrowser } from '@/utils';
import { LOCAL_AI_TRACK_ID, PARTIAL_TAIL_SECONDS } from './localAiProvider';
import type { AsrWorkerRequest, AsrWorkerResponse } from './asrWorker';

/** Worker 版 Provider 组装参数 */
export interface LocalAiWorkerProviderOptions {
  /** 引擎类型（Worker 注册表 key，默认 'mock'；'sherpa' 为真实流式引擎） */
  engineKind?: string;
  /** 识别语言 */
  lang: string;
  /** 模型资源 base 路径（真实引擎懒加载模型用） */
  modelBasePath?: string;
  /** wasm 运行时 base 路径（sherpa-onnx 引擎的运行时资源目录） */
  wasmBasePath?: string;
  /** 置信度阈值（低于丢弃，默认 0.35，与主线程版一致） */
  confidenceThreshold?: number;
}

/**
 * 组装 Worker 版本地识别 Provider
 *
 * 重计算（VAD + 推理）全部在 Worker：视频播放与 UI 交互零卡顿；
 * 音频块经 transfer 移交所有权，无结构化克隆开销
 */
export function createLocalAiWorkerProvider(
  options: LocalAiWorkerProviderOptions,
): LocalAiSubtitleProvider {
  const { lang } = options;
  const engineKind = options.engineKind ?? 'mock';
  const threshold = options.confidenceThreshold ?? 0.35;

  /** 取消订阅函数集合（stop 时统一执行） */
  const unsubscribers: Array<() => void> = [];
  /** 是否已启动（stop 后 start 需重新组装，此实例不可复用） */
  let started = false;
  /** ASR Worker 实例（start 时创建，stop 时终止） */
  let worker: Worker | null = null;

  const provider: LocalAiSubtitleProvider = {
    type: 'local-ai',

    start(context: SubtitleEngineContext): void {
      if (started) return;
      started = true;

      // SSR 守卫：服务端无 Worker，静默不启动（与插件 SSR 约定一致）
      if (!isBrowser() || typeof Worker === 'undefined') return;

      worker = new Worker(
        new URL('./asrWorker.ts', import.meta.url),
        { type: 'module' },
      );

      // —— Worker 响应 → SubtitleCueEvent 推送 ——
      worker.onmessage = (event: MessageEvent<AsrWorkerResponse>): void => {
        const msg = event.data;
        switch (msg.type) {
          // 引擎就绪：转发给插件（更新 SUBTITLE_AI_STATUS 并激活字幕轨）
          case 'ready': {
            provider.onStatus?.('ready');
            break;
          }
          // 引擎初始化/运行失败：转发给插件（触发降级到模式 B）
          case 'error': {
            provider.onStatus?.('error', msg.message);
            break;
          }
          case 'segmentStart': {
            // 开段：清掉上一段遗留的 partial
            provider.onCue?.({
              trackId: LOCAL_AI_TRACK_ID,
              lang,
              finalCues: [],
              partialCue: null,
            });
            break;
          }
          case 'partial': {
            // 段内增量识别：灰显 partial 即时上屏
            const partialItem: SubtitleItem = {
              id: 0,
              startTime: msg.startTime,
              endTime: msg.endTime + PARTIAL_TAIL_SECONDS,
              text: msg.text,
            };
            provider.onCue?.({
              trackId: LOCAL_AI_TRACK_ID,
              lang,
              finalCues: [],
              partialCue: partialItem,
            });
            break;
          }
          case 'final': {
            // 段尾最终结果：置信度过滤后作为正式字幕推送
            if (msg.confidence >= threshold) {
              const finalItem: SubtitleItem = {
                id: 0,
                startTime: msg.startTime,
                endTime: msg.endTime,
                text: msg.text,
              };
              provider.onCue?.({
                trackId: LOCAL_AI_TRACK_ID,
                lang,
                finalCues: [finalItem],
                partialCue: null,
              });
            }
            break;
          }
          default:
            break;
        }
      };

      // 初始化 Worker（选引擎 + 语言 + 资源路径 + 默认 VAD 参数）
      const initMsg: AsrWorkerRequest = {
        type: 'init',
        engineKind,
        lang,
        modelBasePath: options.modelBasePath,
        wasmBasePath: options.wasmBasePath,
      };
      worker.postMessage(initMsg);

      // —— 订阅采集流：PCM 块转发 Worker（transfer 所有权零拷贝） ——
      unsubscribers.push(
        context.audioStream.onChunk((samples: Float32Array, mediaTime: number) => {
          worker?.postMessage(
            { type: 'audio', samples, mediaTime } satisfies AsrWorkerRequest,
            [samples.buffer],
          );
        }),
      );

      // —— 播放器事件联动（与主线程版 localAiProvider 同一语义） ——
      // seek 结束：通知 Worker 丢弃在途音频与 pending 段，清灰显 partial
      unsubscribers.push(
        context.events.on('seekEnd', (): void => {
          worker?.postMessage({ type: 'reset' } satisfies AsrWorkerRequest);
          provider.onCue?.({
            trackId: LOCAL_AI_TRACK_ID,
            lang,
            finalCues: [],
            partialCue: null,
          });
        }),
      );
      // 倍速变化：VAD 阈值联动（>1.5x 提高阈值缓解变速噪声，状态在 Worker 内）
      unsubscribers.push(
        context.events.on('rateChange', (rate: unknown): void => {
          if (typeof rate === 'number') {
            worker?.postMessage({
              type: 'setRate',
              rate,
            } satisfies AsrWorkerRequest);
          }
        }),
      );
    },

    stop(): void {
      // 统一释放：退订采集链 + 终止 Worker（模型推理资源随之回收）
      unsubscribers.forEach((unsub) => unsub());
      unsubscribers.length = 0;
      worker?.terminate();
      worker = null;
    },
  };

  return provider;
}
