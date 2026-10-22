/**
 * ============================================
 * Hi-Res 无损音频解码器
 * ============================================
 * 浏览器原生 MSE/媒体元素可以直接解码 FLAC/ALAC 时，音频会经
 * MediaElementSource 进入音效链，无需二次解码；
 * 本解码器用于完整无损音频缓冲（File/Blob/ArrayBuffer）的 Web Audio 解码回退。
 */

/** 解码后的 Hi-Res 音频信息 */
export interface HiResDecodedAudio {
  /** 解码后的 PCM 缓冲 */
  buffer: AudioBuffer;
  /** 采样率（Hz） */
  sampleRate: number;
  /** 声道数 */
  channels: number;
  /** 时长（秒） */
  duration: number;
  /** 是否达到 Hi-Res 常见规格（>= 96kHz 或 >= 24bit 无法从 AudioBuffer 读取，仅按采样率判断） */
  isHiRes: boolean;
}

/** 浏览器 Hi-Res 解码能力 */
export interface HiResSupportInfo {
  supported: boolean;
  detail: string;
}

/** 检测浏览器是否支持无损音频解码 */
export function detectHiResSupport(): HiResSupportInfo {
  if (typeof document === 'undefined') {
    return { supported: false, detail: 'non-browser environment' };
  }
  const probes = [
    'audio/mp4; codecs="flac"',
    'audio/flac',
    'audio/x-flac',
    'audio/mp4; codecs="alac"',
  ];
  const audio = document.createElement('audio');
  const native = probes.filter((type) => audio.canPlayType(type) !== '');
  let mse: string[] = [];
  if (typeof MediaSource !== 'undefined') {
    mse = probes.filter((type) => MediaSource.isTypeSupported(type));
  }
  const supported = native.length > 0 || mse.length > 0;
  return {
    supported,
    detail: supported
      ? `native: ${native.join(', ') || 'none'}; mse: ${mse.join(', ') || 'none'}`
      : 'no FLAC/ALAC decoder',
  };
}

/** 音频缓冲解码器 */
export class HiResAudioDecoder {
  private readonly getContext: () => AudioContext | null;
  private fallbackContext: AudioContext | null = null;

  constructor(getContext: () => AudioContext | null) {
    this.getContext = getContext;
  }

  /** 获取或创建用于解码的 AudioContext */
  private resolveContext(): AudioContext | null {
    const existing = this.getContext();
    if (existing) return existing;
    if (this.fallbackContext) return this.fallbackContext;
    if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') {
      return null;
    }
    this.fallbackContext = new window.AudioContext();
    return this.fallbackContext;
  }

  /**
   * 解码完整无损音频缓冲
   * @param data - FLAC/ALAC/WAV 等完整音频字节
   */
  async decode(data: ArrayBuffer): Promise<HiResDecodedAudio> {
    const ctx = this.resolveContext();
    if (!ctx) throw new Error('AudioContext unavailable');
    const buffer = await ctx.decodeAudioData(data.slice(0));
    return {
      buffer,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      duration: buffer.duration,
      isHiRes: buffer.sampleRate >= 96000,
    };
  }

  /** 释放内部创建的 AudioContext；外部注入的 context 不关闭 */
  destroy(): void {
    if (this.fallbackContext) {
      void this.fallbackContext.close();
      this.fallbackContext = null;
    }
  }
}
