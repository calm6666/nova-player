/**
 * 字幕本地 ASR 专用 Web Worker（独立 ts 文件，Vite 自动打包为独立 chunk）
 *
 * 职责：承接音频 PCM 块 → VAD 分段 → 识别引擎推理 全流程，
 * 使重计算完全不占主线程——视频播放与 UI 渲染零卡顿。
 *
 * 上下文边界：
 * - 主线程（asrWorkerProvider.ts）：audioCapture 采集 PCM（AudioWorklet
 *   只能在主线程创建 MediaElementSource），按块 postMessage（transfer
 *   Float32Array，零拷贝）送入本 Worker
 * - Worker（本文件）：VadSegmenter 状态机 + AsrEngine 推理，
 *   产出 partial / final 文本事件回传
 *
 * 引擎注册表：
 * - Worker 内不能接收主线程的引擎实例（不可克隆），
 *   故采用「工厂注册表」：主线程经 engineKind 字符串选择引擎，
 *   工厂在本文件静态注册
 * - 已注册：mock（演示）/ sherpa（sherpa-onnx wasm 真实流式识别），
 *   wasm/模型等重资源在引擎 init 时按需 fetch，主线程零改动
 *
 * 时钟同步：
 * - 音频块携带 mediaTime（视频当前时间），VAD 分段基于媒体时间轴，
 *   seek 时主线程发 reset，worker 丢弃在途音频与 pending 段，
 *   保证字幕时间轴与视频时钟始终对齐
 *
 * @module packages/plugins/src/subtitle/asr/asrWorker
 */

import type { AsrEngine } from '@/types/subtitle';
import { VadSegmenter, type VadOptions } from './vadSegmenter';
import { MockAsrEngine } from './mockAsrEngine';
// 真实流式识别引擎（静态 import：Worker 以 IIFE 单 chunk 构建，不支持
// 代码分割；引擎类本身很小，wasm/模型等重资源均在 init 时按需 fetch，
// 未启用本地识别则零下载）
import { SherpaAsrEngine } from './sherpaAsrEngine';

// ============================================================
// Worker 消息协议（与 asrWorkerProvider.ts 共享的形状定义）
// ============================================================

/** 主线程 → Worker 请求 */
export type AsrWorkerRequest =
  /** 初始化：选引擎 + 语言 + 资源路径 + VAD 参数（必须在 audio 之前，只允许一次） */
  | {
      type: 'init';
      engineKind: string;
      lang: string;
      modelBasePath?: string;
      wasmBasePath?: string;
      vadOptions?: VadOptions;
    }
  /** 音频块：samples 所有权转移（transfer），mediaTime 为块起始媒体时间 */
  | { type: 'audio'; samples: Float32Array; mediaTime: number }
  /** seek/切集：丢弃在途音频与 pending 段（引擎 reset） */
  | { type: 'reset' }
  /** 倍速变化：VAD 阈值联动（>1.5x 提高阈值缓解变速噪声） */
  | { type: 'setRate'; rate: number };

/** Worker → 主线程响应 */
export type AsrWorkerResponse =
  /** init 完成（引擎就绪） */
  | { type: 'ready' }
  /** init 失败（引擎工厂不存在 / 引擎初始化异常） */
  | { type: 'error'; message: string }
  /** 语音段开始（主线程清除上一段遗留 partial） */
  | { type: 'segmentStart'; mediaTime: number }
  /** 段内增量识别（灰显 partial 即时上屏） */
  | {
      type: 'partial';
      text: string;
      startTime: number;
      endTime: number;
    }
  /** 段结束的最终识别结果（含置信度，主线程按阈值过滤） */
  | {
      type: 'final';
      text: string;
      confidence: number;
      startTime: number;
      endTime: number;
    };

// ============================================================
// 引擎工厂注册表（真实引擎在此追加）
// ============================================================

/**
 * 引擎工厂表：engineKind → 异步工厂
 *
 * mock 为内置演示引擎；sherpa 为真实流式识别引擎（sherpa-onnx wasm，
 * 流式 zipformer transducer），wasm/模型资源在引擎 init 时按需 fetch，
 * 不开启本地识别则零下载
 */
const engineFactories: Record<string, () => Promise<AsrEngine>> = {
  mock: async () => new MockAsrEngine(),
  sherpa: async (): Promise<AsrEngine> => new SherpaAsrEngine(),
};

// ============================================================
// Worker 主流程
// ============================================================

/** 是否已 init（重复 init 直接忽略，幂等） */
let initialized = false;
/** 识别引擎实例（init 时创建） */
let engine: AsrEngine | null = null;
/** VAD 分段器（init 时创建，回调映射引擎调用与事件回传） */
let vad: VadSegmenter | null = null;
/** 当前语音段起始媒体时间（partial 时间轴用） */
let segmentStart = 0;

/**
 * postMessage 快捷方式（类型收窄：Worker 全局作用域内的 post）
 */
const post = (msg: AsrWorkerResponse): void => {
  self.postMessage(msg);
};

/**
 * 组装 VAD 回调：状态机事件 → 引擎调用 + 响应消息
 */
function createVadCallbacks(): {
  onSegmentStart: (mediaTime: number) => void;
  onSegmentAudio: (samples: Float32Array, mediaTime: number) => void;
  onSegmentEnd: (startTime: number, endTime: number) => void;
} {
  return {
    /** 开段：记录段首时间，通知主线程清上一段 partial */
    onSegmentStart(mediaTime: number): void {
      segmentStart = mediaTime;
      post({ type: 'segmentStart', mediaTime });
    },
    /** 段内音频：喂引擎，partial 即时回传（灰显） */
    onSegmentAudio(samples: Float32Array, mediaTime: number): void {
      const partial = engine?.acceptAudio(samples, mediaTime);
      if (partial && partial.text) {
        post({
          type: 'partial',
          text: partial.text,
          startTime: segmentStart,
          endTime: mediaTime,
        });
      }
    },
    /** 段尾：finalize 出最终文本与置信度（主线程按阈值过滤组装 finalCues） */
    onSegmentEnd(startTime: number, endTime: number): void {
      const final = engine?.finalizeSegment();
      if (final && final.text) {
        post({
          type: 'final',
          text: final.text,
          confidence: final.confidence ?? 1,
          startTime,
          endTime,
        });
      }
    },
  };
}

/**
 * 消息入口：按协议分发
 */
self.onmessage = (event: MessageEvent<AsrWorkerRequest>): void => {
  const msg = event.data;

  switch (msg.type) {
    case 'init': {
      if (initialized) return; // 幂等
      const factory = engineFactories[msg.engineKind];
      if (!factory) {
        post({
          type: 'error',
          message: `Unknown ASR engine kind: ${msg.engineKind}`,
        });
        return;
      }
      // 引擎创建 + 模型加载为异步（真实引擎需 fetch wasm/模型并初始化），
      // 就绪前到达的音频块直接丢弃（vad 尚未创建，字幕从就绪后开始）
      void (async (): Promise<void> => {
        try {
          const instance = await factory();
          await instance.init({
            lang: msg.lang,
            modelBasePath: msg.modelBasePath,
            wasmBasePath: msg.wasmBasePath,
          });
          engine = instance;
          vad = new VadSegmenter(createVadCallbacks(), msg.vadOptions ?? {});
          initialized = true;
          post({ type: 'ready' });
        } catch (error) {
          post({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
      break;
    }
    case 'audio': {
      // 未 init / init 失败时的音频直接丢弃（不喂 VAD）
      if (!vad) return;
      vad.feed(msg.samples, msg.mediaTime);
      break;
    }
    case 'reset': {
      // seek/切集：清 VAD 在途状态 + 引擎待定段
      vad?.reset();
      engine?.reset?.();
      break;
    }
    case 'setRate': {
      // 倍速变化：VAD 阈值联动（状态机在 Worker 内）
      vad?.setPlaybackRate(msg.rate);
      break;
    }
  }
};
