/**
 * ============================================
 * 本地识别音频采集链（AudioCapture）
 * ============================================
 * <video> → MediaElementAudioSourceNode → AudioWorkletNode（16kHz 线性插值重采样）
 *   → 16kHz mono Float32 PCM 分块（0.5s/块，携带 AudioContext.currentTime）
 *   → 主线程按「上下文时钟 ↔ 媒体时间」锚点换算块起始媒体时间
 *   → 经 SubtitleAudioStream 分发给消费者（VAD/引擎）
 *
 * 设计要点：
 * 1. createMediaElementSource 会把音频输出切到 Web Audio 图，
 *    因此采集 Worklet 的输出直通连接 destination，保证回放不中断
 * 2. 跨域视频源未设置 CORS 时 Worklet 收到全零数据；采集层检测到
 *    「播放中持续静音」时经 onSilenceError 上报，由上层降级到模式 B
 * 3. 时间戳：Worklet 每块携带 AudioWorkletGlobalScope.currentTime，
 *    主线程维护锚点（mediaStart ↔ ctxStart），seek/倍速/暂停恢复后重锚点
 * 4. AudioContext 与 MediaElementSource 全插件实例仅创建一次并复用
 *    （同一 media 元素不允许重复建 source），stop 只断开采集 Worklet
 *
 * @module packages/plugins/src/subtitle/asr/audioCapture
 */

import type { SubtitleAudioStream } from '@/types/subtitle';

/** 目标采样率（ASR 模型统一 16kHz） */
const TARGET_SAMPLE_RATE = 16000;

/** 每块样本数（0.5s @ 16kHz） */
const CHUNK_SAMPLES = 8000;

/** 静音检测窗口：连续静音块数达到该值且播放中，判定采集数据不可用 */
const SILENT_CHUNK_LIMIT = 6;

/**
 * 采集 Worklet 源码（字符串 → Blob URL 注入，避免独立静态资源）
 * 注意：Worklet 全局作用域无法使用 TS，此处保持纯 JS；
 * sampleRate / currentTime 为 AudioWorkletGlobalScope 内置变量
 */
const WORKLET_SOURCE = `
/**
 * 字幕采集重采样处理器：输入直通回放 + 16kHz 线性插值降采样分块上报
 */
class SubtitleResamplerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 16kHz 单声道输出缓冲（0.5s/块）
    this.buffer = new Float32Array(${CHUNK_SAMPLES});
    this.filled = 0;
    // 输入侧浮点游标（相邻输入样本间的插值位置）
    this.pos = 0;
    // 上一个输入样本（插值左端点；首块取第一个样本）
    this.prev = null;
  }
  process(inputs, outputs) {
    // 1) 输入直通输出（保持原采样率/声道回放，音频不被采集劫持）
    const output = outputs[0];
    const input = inputs[0];
    for (let ch = 0; ch < output.length; ch++) {
      const out = output[ch];
      const inCh = input && input[ch] ? input[ch] : (input && input[0]) || null;
      if (inCh) {
        for (let i = 0; i < out.length; i++) out[i] = inCh[i] || 0;
      } else {
        for (let i = 0; i < out.length; i++) out[i] = 0;
      }
    }
    if (!input || input.length === 0) return true;
    // 2) 取左声道做单声道降采样
    const inCh = input[0];
    if (!inCh || inCh.length === 0) return true;
    const step = sampleRate / ${TARGET_SAMPLE_RATE};
    if (this.prev === null) this.prev = inCh[0];
    for (let i = 0; i < inCh.length; i++) {
      const x = inCh[i];
      // 在 prev→x 区间按 step 步进取插值样本，直到越过本区间
      while (this.pos < 1) {
        this.buffer[this.filled++] = this.prev + (x - this.prev) * this.pos;
        this.pos += step;
        if (this.filled === this.buffer.length) {
          // 块满：拷贝上报（transferable 零拷贝转移所有权）
          const out = this.buffer.slice(0);
          this.port.postMessage(
            { samples: out, contextTime: currentTime },
            { transfer: [out.buffer] }
          );
          this.filled = 0;
        }
      }
      this.pos -= 1;
      this.prev = x;
    }
    return true;
  }
}
registerProcessor('subtitle-resampler', SubtitleResamplerProcessor);
`;

/** Worklet 上报的消息结构（类型谓词校验，禁止 as 断言） */
interface WorkletChunkMessage {
  samples: Float32Array;
  contextTime: number;
}

/** 判定 Worklet 消息是否为合法的音频块上报 */
function isWorkletChunkMessage(data: unknown): data is WorkletChunkMessage {
  if (typeof data !== 'object' || data === null) return false;
  if (!('samples' in data) || !('contextTime' in data)) return false;
  // in 收窄后可直接访问属性（unknown → object & Record<'samples'|'contextTime', unknown>）
  return (
    data.samples instanceof Float32Array &&
    typeof data.contextTime === 'number'
  );
}

/** 采集配置 */
export interface AudioCaptureOptions {
  /** 采集数据持续静音（疑似 CORS 拦截/无音轨）时的上报回调，参数为英文错误信息 */
  onSilenceError?: (message: string) => void;
}

/**
 * 音频采集会话
 * 一个插件实例复用一个会话：AudioContext/SourceNode 只建一次，
 * start/stop 只切换采集 Worklet 的连接状态
 */
export class AudioCapture {
  /** 目标 video 元素 */
  private readonly video: HTMLVideoElement;
  /** 静音检测回调 */
  private readonly onSilenceError: ((message: string) => void) | null;

  /** Web Audio 上下文（懒创建，全实例复用） */
  private ctx: AudioContext | null = null;
  /** 媒体元素音频源（同一元素仅允许创建一次） */
  private source: MediaElementAudioSourceNode | null = null;
  /** 采集 Worklet 节点（stop 时断开，start 时重建连接） */
  private workletNode: AudioWorkletNode | null = null;
  /** Worklet 模块 URL（addModule 后可 revoke） */
  private workletUrl: string | null = null;

  /** 音频块消费者列表 */
  private readonly consumers: Array<
    (chunk: Float32Array, mediaTime: number) => void
  > = [];

  /** 时间锚点：块起始媒体时间 ↔ 块起始上下文时间（null 表示待锚定） */
  private anchorMediaStart: number | null = null;
  private anchorCtxStart: number | null = null;
  /** 是否需要重锚点（seek/倍速/暂停恢复后置位） */
  private reanchorPending = true;
  /** 连续静音块计数（静音检测用） */
  private silentChunkCount = 0;
  /** 静音错误是否已上报（只报一次，重锚点后复位） */
  private silenceReported = false;
  /** 是否正在采集 */
  private capturing = false;

  constructor(video: HTMLVideoElement, options: AudioCaptureOptions = {}) {
    this.video = video;
    this.onSilenceError = options.onSilenceError ?? null;
  }

  /**
   * 启动采集（懒建 AudioContext/Source/Worklet；重复调用幂等）
   * @returns 音频流（消费者经 onChunk 注册，mediaTime 为块起始媒体时间）
   */
  async start(): Promise<SubtitleAudioStream> {
    if (this.capturing) {
      return this.buildAudioStream();
    }

    if (typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
      throw new Error('AudioWorklet is not supported in this environment');
    }

    // 懒建上下文与媒体源（全实例复用；createMediaElementSource 只允许调用一次）
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    if (!this.source) {
      this.source = this.ctx.createMediaElementSource(this.video);
      // 音频输出改道 Web Audio 图：直连 destination 保证回放不中断
      this.source.connect(this.ctx.destination);
    }

    // Worklet 模块按需注入（Blob URL 可复用，addModule 重复调用幂等）
    if (!this.workletUrl) {
      const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
      this.workletUrl = URL.createObjectURL(blob);
      await this.ctx.audioWorklet.addModule(this.workletUrl);
    }

    const node = new AudioWorkletNode(this.ctx, 'subtitle-resampler');
    node.port.onmessage = (event: MessageEvent): void => {
      this.handleChunkMessage(event.data);
    };
    // 采集链：source → worklet（输出直通已在 Worklet 内回连 destination）
    this.source.connect(node);
    this.workletNode = node;

    this.reanchorPending = true;
    this.silentChunkCount = 0;
    this.silenceReported = false;
    this.capturing = true;
    return this.buildAudioStream();
  }

  /**
   * 停止采集（断开 Worklet；保留 AudioContext 与 Source 供下次复用）
   */
  stop(): void {
    if (!this.capturing) return;
    if (this.workletNode && this.source && this.ctx) {
      try {
        this.source.disconnect(this.workletNode);
      } catch {
        // 节点已断开时忽略
      }
    }
    this.workletNode = null;
    this.capturing = false;
    this.reanchorPending = true;
  }

  /**
   * 通知采集层播放位置变化（seek/倍速/暂停恢复后调用）
   * 下一块到达时按当前播放位置重新锚定时间轴
   */
  reanchor(): void {
    this.reanchorPending = true;
    this.silentChunkCount = 0;
    this.silenceReported = false;
  }

  /**
   * 彻底释放资源（播放器卸载时调用）
   * 关闭 AudioContext；注意 close 后浏览器会恢复 video 元素的常规音频输出
   */
  dispose(): void {
    this.stop();
    this.consumers.length = 0;
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.source = null;
  }

  /** 构建音频流视图（注册消费者/取消注册） */
  private buildAudioStream(): SubtitleAudioStream {
    return {
      onChunk: (
        consumer: (chunk: Float32Array, mediaTime: number) => void,
      ): (() => void) => {
        this.consumers.push(consumer);
        return (): void => {
          const index = this.consumers.indexOf(consumer);
          if (index >= 0) {
            this.consumers.splice(index, 1);
          }
        };
      },
    };
  }

  /** 处理 Worklet 上报的音频块：时间戳换算 + 静音检测 + 分发 */
  private handleChunkMessage(data: unknown): void {
    if (!isWorkletChunkMessage(data)) return;
    if (!this.capturing || !this.ctx) return;

    const chunk = data.samples;
    const rate = this.video.playbackRate > 0 ? this.video.playbackRate : 1;
    const chunkCtxSeconds = chunk.length / TARGET_SAMPLE_RATE;

    // —— 时间锚点：首块/重锚点时按「块尾对齐当前媒体时间」建立映射 ——
    // 块尾（contextTime）≈ 当前时刻，块尾媒体时间 ≈ video.currentTime，
    // 块起始媒体时间 = video.currentTime - 块跨度的媒体秒数（ctx 秒 × rate）
    if (this.reanchorPending || this.anchorMediaStart === null || this.anchorCtxStart === null) {
      this.anchorMediaStart = Math.max(
        0,
        this.video.currentTime - chunkCtxSeconds * rate,
      );
      this.anchorCtxStart = data.contextTime - chunkCtxSeconds;
      this.reanchorPending = false;
    }

    // 块起始媒体时间 = 锚点 + 上下文时钟增量 × 倍速（倍速下音频内容按 rate 倍推进）
    const mediaTime =
      this.anchorMediaStart +
      (data.contextTime - chunkCtxSeconds - this.anchorCtxStart) * rate;

    // —— 静音检测：播放中连续多块全零视为采集数据不可用（CORS 未开/无音轨） ——
    if (!this.video.paused && isAllSilent(chunk)) {
      this.silentChunkCount++;
      if (
        this.silentChunkCount >= SILENT_CHUNK_LIMIT &&
        !this.silenceReported
      ) {
        this.silenceReported = true;
        this.onSilenceError?.(
          'Captured audio is silent while playing (cross-origin source without CORS, or no audio track)',
        );
      }
    } else if (!this.video.paused) {
      this.silentChunkCount = 0;
    }

    // 分发给消费者（VAD → 引擎）
    for (const consumer of this.consumers) {
      consumer(chunk, mediaTime);
    }
  }
}

/** 判定一个 PCM 块是否全静音（幅值接近 0） */
function isAllSilent(chunk: Float32Array): boolean {
  for (let i = 0; i < chunk.length; i++) {
    if (Math.abs(chunk[i]) > 1e-6) return false;
  }
  return true;
}
