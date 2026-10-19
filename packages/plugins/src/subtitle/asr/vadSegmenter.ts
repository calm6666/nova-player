/**
 * ============================================
 * VAD 语音活动分段器（VadSegmenter）
 * ============================================
 * 轻量无模型 VAD：能量（RMS）判定语音帧，静音 ≥ 400ms 视为段尾，
 * 单段超上限（默认 15s）强制切段
 *
 * 状态机：
 *   PCM 块 → 按 10ms 帧计算 RMS → 语音帧/静音帧
 *     段外遇语音帧 → 开段（记录 startTime）
 *     段内遇语音帧 → 清空静音累计
 *     段内静音累计 ≥ silenceMs → 断段（回调 onSegmentEnd）
 *     段长 ≥ maxSegmentSeconds → 强制断段并立即续开新段（长句不断句尾延迟）
 *
 * 倍速联动：playbackRate > 1.5 时能量阈值加倍，
 * 缓解变速变调带来的噪声放大（已知精度折衷，不做音高校正）
 *
 * @module packages/plugins/src/subtitle/asr/vadSegmenter
 */

/** 分段回调集合 */
export interface VadCallbacks {
  /** 语音段开始（mediaTime 为段首语音帧的媒体时间） */
  onSegmentStart?: (mediaTime: number) => void;
  /** 段内音频转发（→ 引擎 acceptAudio；mediaTime 为块起始媒体时间） */
  onSegmentAudio?: (samples: Float32Array, mediaTime: number) => void;
  /** 语音段结束（→ 引擎 finalizeSegment；静音起点为段尾） */
  onSegmentEnd?: (startTime: number, endTime: number) => void;
}

/** 分段参数 */
export interface VadOptions {
  /** 静音判段尾时长（毫秒，默认 400） */
  silenceMs?: number;
  /** 单段最长秒数（默认 15，超限强制切段） */
  maxSegmentSeconds?: number;
  /** 最短有效段秒数（默认 0.3，短于此视为噪声丢弃） */
  minSegmentSeconds?: number;
  /** 基础能量阈值（RMS，默认 0.015） */
  energyThreshold?: number;
}

/** 帧长（样本数）：10ms @ 16kHz */
const FRAME_SAMPLES = 160;

/** 帧时长（毫秒） */
const FRAME_MS = 10;

export class VadSegmenter {
  /** 回调集合 */
  private readonly callbacks: VadCallbacks;
  /** 静音判段尾时长（毫秒） */
  private readonly silenceMs: number;
  /** 单段最长秒数 */
  private readonly maxSegmentSeconds: number;
  /** 最短有效段秒数（噪声过滤） */
  private readonly minSegmentSeconds: number;
  /** 基础能量阈值 */
  private readonly baseThreshold: number;

  /** 当前播放速率（>1.5 时阈值加倍） */
  private playbackRate = 1;
  /** 是否在段中 */
  private inSegment = false;
  /** 段首媒体时间 */
  private segmentStart = 0;
  /** 段内静音累计（毫秒） */
  private silenceAccumMs = 0;

  constructor(callbacks: VadCallbacks = {}, options: VadOptions = {}) {
    this.callbacks = callbacks;
    this.silenceMs = options.silenceMs ?? 400;
    this.maxSegmentSeconds = options.maxSegmentSeconds ?? 15;
    this.minSegmentSeconds = options.minSegmentSeconds ?? 0.3;
    this.baseThreshold = options.energyThreshold ?? 0.015;
  }

  /** 更新播放速率（倍速 > 1.5 时 VAD 阈值加倍缓解噪声） */
  setPlaybackRate(rate: number): void {
    this.playbackRate = rate > 0 ? rate : 1;
  }

  /** 当前有效能量阈值（倍速联动） */
  private get energyThreshold(): number {
    return this.playbackRate > 1.5 ? this.baseThreshold * 2 : this.baseThreshold;
  }

  /**
   * 喂入一个 PCM 块（16kHz mono；mediaTime 为块起始媒体时间）
   * 按 10ms 帧推进状态机；块内开段时整块转发给引擎（块粒度，
   * 段首最多带入一块的前导静音，流式引擎可自行消化）
   */
  feed(samples: Float32Array, mediaTime: number): void {
    const frameCount = Math.floor(samples.length / FRAME_SAMPLES);
    let becameActiveThisChunk = false;

    for (let frame = 0; frame < frameCount; frame++) {
      const frameOffset = frame * FRAME_SAMPLES;
      const frameTime = mediaTime + (frameOffset / 16000);
      let sumSquares = 0;
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const s = samples[frameOffset + i];
        sumSquares += s * s;
      }
      const rms = Math.sqrt(sumSquares / FRAME_SAMPLES);
      const voiced = rms > this.energyThreshold;

      if (!this.inSegment && voiced) {
        // 开段：段首时间 = 该语音帧起始媒体时间
        this.inSegment = true;
        this.segmentStart = frameTime;
        this.silenceAccumMs = 0;
        becameActiveThisChunk = true;
        this.callbacks.onSegmentStart?.(frameTime);
      } else if (this.inSegment) {
        if (voiced) {
          this.silenceAccumMs = 0;
        } else {
          this.silenceAccumMs += FRAME_MS;
          if (this.silenceAccumMs >= this.silenceMs) {
            // 断段：段尾 = 静音段起点（最后一个语音帧结束处）
            const endTime = frameTime - this.silenceAccumMs / 1000 + FRAME_MS / 1000;
            this.endSegment(endTime);
            continue;
          }
        }
        // 段长上限：强制断段并立即续开新段（同一语音流不断句尾延迟）
        if (frameTime - this.segmentStart >= this.maxSegmentSeconds) {
          this.endSegment(frameTime);
          this.inSegment = true;
          this.segmentStart = frameTime;
          this.silenceAccumMs = 0;
          becameActiveThisChunk = true;
          this.callbacks.onSegmentStart?.(frameTime);
        }
      }
    }

    // 块粒度转发：本块内段处于激活态（或在本块内开段）时整块喂引擎
    if (this.inSegment && this.callbacks.onSegmentAudio) {
      this.callbacks.onSegmentAudio(samples, mediaTime);
    } else if (becameActiveThisChunk && this.callbacks.onSegmentAudio) {
      // 开段发生在本块内：同样转发（引擎按时间戳自行对齐）
      this.callbacks.onSegmentAudio(samples, mediaTime);
    }
  }

  /** 结束当前段（短于最短有效段时视为噪声，直接丢弃不回调） */
  private endSegment(endTime: number): void {
    const wasInSegment = this.inSegment;
    const startTime = this.segmentStart;
    this.inSegment = false;
    this.silenceAccumMs = 0;
    if (
      wasInSegment &&
      endTime - startTime >= this.minSegmentSeconds
    ) {
      this.callbacks.onSegmentEnd?.(startTime, endTime);
    }
  }

  /** 丢弃当前段（seek 后调用：在途音频与 pending 段全部作废） */
  reset(): void {
    this.inSegment = false;
    this.silenceAccumMs = 0;
    this.segmentStart = 0;
  }
}
