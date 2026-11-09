/**
 * ============================================
 * Mock ASR 引擎（MockAsrEngine）
 * ============================================
 * 演示用流式识别引擎：不加载真实模型，按喂入音频时长节奏产出
 * partial / final 文本，完整走通「采集 → VAD → 引擎 → onCue」链路。
 * 真实引擎（sherpa-onnx wasm 等，P2 阶段）实现同一 AsrEngine 接口即可替换。
 *
 * 行为：
 * - init：模拟模型加载（~200ms），完成后状态 ready
 * - acceptAudio：每积累约 1.6s 音频产出一条 partial（模拟流式中间结果）
 * - finalizeSegment：产出 final 文本（置信度 0.9），并重置积累
 * - 句库按语言轮换，中文/英文各一组，缺省回落中文
 *
 * @module packages/plugins/src/subtitle/asr/mockAsrEngine
 */

import type { AsrEngine, AsrEngineInitOptions, AsrEngineStatus, AsrFinalResult, AsrPartialResult } from '@lumina/nova';

/** 中文演示句库（按段序号轮换） */
const ZH_SENTENCES: string[] = [
  '欢迎观看本视频',
  '这里演示本地实时识别字幕',
  '音频不会离开你的浏览器',
  '识别结果按语音段实时上屏',
  '切换语言可以更换识别引擎',
  '感谢使用 Nova 播放器',
];

/** 英文演示句库 */
const EN_SENTENCES: string[] = [
  'Welcome to this video',
  'This is a live on-device caption demo',
  'Audio never leaves your browser',
  'Cues appear in real time per segment',
  'Switch language to change engine',
  'Thanks for using Nova player',
];

/** 模拟模型加载耗时（毫秒） */
const INIT_DELAY_MS = 200;

/** 每积累多少秒音频产出一条 partial */
const PARTIAL_INTERVAL_SECONDS = 1.6;

export class MockAsrEngine implements AsrEngine {
  readonly name = 'mock-asr';

  /** 引擎状态（loading → ready） */
  private status: AsrEngineStatus = { state: 'loading' };
  /** 当前识别语言（决定句库） */
  private lang = 'zh';
  /** 已喂入音频总时长（秒，当前段内） */
  private fedSeconds = 0;
  /** 上次产出 partial 时的累计时长（秒） */
  private lastPartialAt = 0;
  /** 已产出的 final 段数（句库轮换用） */
  private segmentCount = 0;

  /** 初始化：模拟模型加载，完成后进入 ready */
  async init(options: AsrEngineInitOptions): Promise<void> {
    this.status = { state: 'loading' };
    this.lang = options.lang;
    await new Promise<void>((resolve): void => {
      setTimeout(resolve, INIT_DELAY_MS);
    });
    this.status = { state: 'ready' };
  }

  /** 喂入音频块：按积累时长节奏产出 partial */
  acceptAudio(chunk: Float32Array, _mediaTime: number): AsrPartialResult | null {
    this.fedSeconds += chunk.length / 16000;
    if (this.fedSeconds - this.lastPartialAt >= PARTIAL_INTERVAL_SECONDS) {
      this.lastPartialAt = this.fedSeconds;
      return {
        text: this.nextSentence(),
        confidence: 0.55,
      };
    }
    return null;
  }

  /** 段尾：产出 final 文本并重置段内积累 */
  finalizeSegment(): AsrFinalResult | null {
    this.segmentCount++;
    // 段内喂入过音频才产出（纯静音误触发时为空段）
    if (this.fedSeconds <= 0) {
      return null;
    }
    const text = this.nextSentence();
    this.fedSeconds = 0;
    this.lastPartialAt = 0;
    return {
      text,
      confidence: 0.9,
    };
  }

  /** 状态查询 */
  getStatus(): AsrEngineStatus {
    return this.status;
  }

  /** 丢弃当前段在途音频（seek 后调用） */
  reset(): void {
    this.fedSeconds = 0;
    this.lastPartialAt = 0;
  }

  /** 释放资源（mock 无资源，仅重置状态） */
  dispose(): void {
    this.status = { state: 'loading' };
    this.fedSeconds = 0;
    this.lastPartialAt = 0;
  }

  /** 从句库取下一句（按 final 段数轮换；partial 复用当前序号的句子） */
  private nextSentence(): string {
    const sentences = this.lang.startsWith('en') ? EN_SENTENCES : ZH_SENTENCES;
    return sentences[this.segmentCount % sentences.length];
  }
}
