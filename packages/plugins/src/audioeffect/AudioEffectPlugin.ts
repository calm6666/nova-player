/**
 * ============================================
 * AudioEffect 音效插件
 * ============================================
 * Web Audio 音效插件 —— 通过 MediaElementSource + 节点图实现 EQ / Reverb / A3D / Phone / Compressor
 * 安装时订阅 MOUNTED 事件，video 元素就绪后构建 AudioContext + EffectChain
 *
 * 使用方式：
 * import { AudioEffectPlugin } from '@lumina/plugins';
 *
 * const player = new VideoPlayer({
 *   src: 'video.mp4',
 *   plugins: {
 *     list: [
 *       AudioEffectPlugin({ volume: 0 }),
 *     ]
 *   }
 * });
 *
 * player.plugins.audioEffect?.setEffectActive('eq', true);
 * player.plugins.audioEffect?.setEQPreset('pop', '10');
 */

import type { Plugin, PluginOptions } from '@/types/plugin';
import type { VideoPlayer } from '../../../player/src/player/VideoPlayer';
import type { PlayerEventBus } from '../../../player/src/core/plugin';
import { PlayerEventEnum } from '@/core/events';
import { createLogger, isBrowser } from '@/utils';
import { EffectChain } from './effects/EffectChain';
import { HiResAudioDecoder, detectHiResSupport } from './HiResAudioDecoder';
import type { HiResDecodedAudio, HiResSupportInfo } from './HiResAudioDecoder';
import type {
  EffectName,
  EQPresetName,
  EQBandCount,
  ReverbPresetName,
  CombinationPresetName,
} from './types';

const logger = createLogger('AudioEffectPlugin');

// ============================================
// 类型定义
// ============================================

/** 音效插件配置 */
export interface AudioEffectPluginConfig {
  /** 插件选项 */
  options?: PluginOptions;
  /** 初始音量（dB），默认 0（即线性增益 1） */
  volume?: number;
}

/** 音效插件完整 API 接口（暴露给外部使用的完整类型） */
export interface AudioEffectPluginAPI extends Plugin {
  /** 设置某个效果的激活状态 */
  setEffectActive(name: EffectName, active: boolean): void;
  /** 设置 EQ 预设（可选段数切换） */
  setEQPreset(preset: EQPresetName, bandCount?: EQBandCount): void;
  /** 设置 Reverb 预设 */
  setReverbPreset(preset: ReverbPresetName): void;
  /** 直接设置 EQ 各段增益（自定义 EQ） */
  setEQGains(gains: readonly number[]): void;
  /** 设置音量（dB） */
  setVolume(db: number): void;
  /** 设置音量均衡模式（0 关闭 / 1 标准 / 2 高动态，设置面板「音量均衡」接线） */
  setLoudness(mode: number): void;
  /** 应用效果组合预设 */
  selectCombination(preset: CombinationPresetName): void;
  /** 获取效果名列表 */
  getEffectsList(): EffectName[];
  /** 获取内部 EffectChain 实例（只读访问） */
  getEffectChain(): EffectChain | null;
  /** 浏览器 Hi-Res 无损解码能力 */
  getHiResSupportInfo(): HiResSupportInfo;
  /** 是否支持 Hi-Res 无损音频 */
  isHiResSupported(): boolean;
  /** 解码完整无损音频缓冲（FLAC/ALAC 等） */
  decodeHiResAudio(data: ArrayBuffer): Promise<HiResDecodedAudio>;
  /** 播放已解码的 Hi-Res 音频缓冲 */
  playHiResAudio(decoded: HiResDecodedAudio, offset?: number): void;
  /** 停止 Hi-Res 解码音频播放 */
  stopHiResAudio(): void;
}

// ============================================
// 插件实现
// ============================================

/**
 * 音效插件实现类
 * 通过订阅 MOUNTED 事件延迟到 video 元素就绪后再构建 Web Audio 图
 */
class AudioEffectPluginClass implements AudioEffectPluginAPI {
  readonly name = 'audioEffect';
  readonly version = '1.0.0';
  readonly description = 'Web Audio 音效插件';
  readonly options?: PluginOptions;

  /** 播放器事件总线 */
  private eventBus: PlayerEventBus | null = null;
  /** 效果链管理器 */
  private effectChain: EffectChain | null = null;
  /** AudioContext 实例 */
  private audioCtx: AudioContext | null = null;
  /** MediaElementSource —— 桥接 HTMLVideoElement 与 Web Audio 图 */
  private mediaSource: MediaElementAudioSourceNode | null = null;
  /** 总控 GainNode */
  private gain: GainNode | null = null;
  /** 视频元素 */
  private video: HTMLVideoElement | null = null;
  /** 事件取消订阅函数列表 */
  private unsubscribers: Array<() => void> = [];
  /** 初始音量（dB），由配置传入 */
  private initialVolume: number;
  /** Hi-Res 无损音频解码器 */
  private readonly hiresDecoder: HiResAudioDecoder;
  /** 当前 Hi-Res 解码播放源 */
  private hiresSource: AudioBufferSourceNode | null = null;
  /** video 的 play 事件回调 —— 每次播放时确保 AudioContext 恢复 running */
  private readonly handlePlayResume = (): void => {
    this.tryResume();
  };

  constructor(config?: AudioEffectPluginConfig) {
    this.options = config?.options;
    this.initialVolume = config?.volume ?? 0;
    this.hiresDecoder = new HiResAudioDecoder(() => this.audioCtx);
  }

  /**
   * 安装插件：订阅 MOUNTED 事件拿 video 元素
   * SSR 环境下仅注册不初始化
   */
  install(player: VideoPlayer): void {
    if (!isBrowser()) {
      logger.warn('服务端环境，音效插件仅注册不初始化');
      return;
    }
    this.eventBus = player.events;
    const unsub = this.eventBus.on(PlayerEventEnum.MOUNTED, (data): void => {
      if (data.video instanceof HTMLVideoElement) {
        this.video = data.video;
        this.initAudio();
      }
    });
    this.unsubscribers.push(unsub);
    // 订阅音效设置变化：设置面板「音量均衡」经 VideoPlayer.setLoudness 广播
    // （{ effect: 'loudness', mode }），此处接入真实音频链路 —— 压缩器按模式
    // 激活/停用并应用对应参数。订阅在 install 期注册（早于 MOUNTED），
    // 面板操作与挂载期初始偏好恢复广播均不会漏接
    const unsubEffect = this.eventBus.on(
      PlayerEventEnum.AUDIO_EFFECT_CHANGE,
      (data): void => {
        if (data && data.effect === 'loudness') {
          this.setLoudness(data.mode);
        }
      },
    );
    this.unsubscribers.push(unsubEffect);
  }

  /**
   * 构建 Web Audio 图：AudioContext → MediaElementSource → EffectChain → destination
   * 现代浏览器均支持 unprefixed AudioContext；前缀兼容由 polyfill 处理，这里不引入 webkit 检测
   */
  private initAudio(): void {
    if (!this.video) return;
    // 幂等守卫：createMediaElementSource 对同一元素仅允许调用一次，
    // 同一 video 的重复 MOUNTED 不能二次接管（二次调用抛 InvalidStateError）
    if (this.mediaSource) {
      logger.warn('音效链已初始化，跳过重复接管');
      return;
    }
    // 检查 AudioContext 是否可用
    if (typeof window.AudioContext !== 'function') {
      logger.warn('当前环境不支持 AudioContext，音效插件不可用');
      return;
    }
    try {
      this.audioCtx = new window.AudioContext();
      this.mediaSource = this.audioCtx.createMediaElementSource(this.video);
      this.gain = this.audioCtx.createGain();
      this.effectChain = new EffectChain();
      this.effectChain.init(
        this.audioCtx,
        this.mediaSource,
        this.gain,
        this.audioCtx.destination,
      );
      // gain → destination 的连接由 EffectChain.init 负责，避免重复 connect
      this.effectChain.setVolume(this.initialVolume);
      // 接管后 video 的音频全部改道进 Web Audio 图。但浏览器 autoplay 策略下，
      // 无用户手势时 AudioContext 处于 suspended —— 表现为所有源（mp4/hls/dash）
      // 全部无声，且 Chrome 对 suspended 图中被接管的媒体元素会冻结帧推进
      // （暂停后再播放画面卡死）。修复：订阅 video 的 play 事件（用户点击播放时
      // 文档已有 sticky activation），每次播放都确保 ctx 处于 running
      this.video.addEventListener('play', this.handlePlayResume);
      this.tryResume();
      logger.info('音效链初始化成功');
    } catch (err) {
      logger.error('音效链初始化失败:', err);
    }
  }

  /**
   * 尝试恢复 AudioContext 至 running
   * suspended 才动作；resume 彻底失败（无法获得用户激活）时放弃接管并 close，
   * close 后 media element 恢复直接输出原生音频 —— 宁可音效失效也不能无声/卡帧
   */
  private tryResume(): void {
    const ctx = this.audioCtx;
    if (!ctx || ctx.state !== 'suspended') return;
    ctx.resume().catch((): void => {
      logger.warn('AudioContext 恢复失败，放弃音频接管（回退视频原生音频输出）');
      this.releaseAudioGraph();
    });
  }

  /**
   * 释放 Web Audio 图：移除 play 监听、销毁效果链、close AudioContext
   * close 后 createMediaElementSource 对 video 的接管解除，原生音频恢复
   */
  private releaseAudioGraph(): void {
    this.stopHiResAudio();
    if (this.video) {
      this.video.removeEventListener('play', this.handlePlayResume);
    }
    this.effectChain?.destroy();
    this.effectChain = null;
    const ctx = this.audioCtx;
    if (ctx) {
      ctx.close().catch((): void => {
        // 关闭失败忽略
      });
    }
    this.audioCtx = null;
    this.mediaSource = null;
    this.gain = null;
  }

  // ==================== 公共 API ====================

  /** 设置某个效果激活状态 */
  setEffectActive(name: EffectName, active: boolean): void {
    this.effectChain?.setEffectActive(name, active);
  }

  /** 设置 EQ 预设 */
  setEQPreset(preset: EQPresetName, bandCount?: EQBandCount): void {
    this.effectChain?.setEQPreset(preset, bandCount);
  }

  /** 直接设置 EQ 各段增益（自定义 EQ） */
  setEQGains(gains: readonly number[]): void {
    this.effectChain?.setEQGains(gains);
  }

  /** 设置 Reverb 预设 */
  setReverbPreset(preset: ReverbPresetName): void {
    this.effectChain?.setReverbPreset(preset);
  }

  /** 设置音量（dB） */
  setVolume(db: number): void {
    this.effectChain?.setVolume(db);
  }

  /** 设置音量均衡模式（0 关闭 / 1 标准 / 2 高动态），转发效果链处理 */
  setLoudness(mode: number): void {
    this.effectChain?.setLoudness(mode);
  }

  /** 应用效果组合预设 */
  selectCombination(preset: CombinationPresetName): void {
    this.effectChain?.selectCombination(preset);
  }

  /** 获取效果名列表 */
  getEffectsList(): EffectName[] {
    return this.effectChain?.getEffectsList() ?? [];
  }

  /** 获取内部 EffectChain 实例 */
  getEffectChain(): EffectChain | null {
    return this.effectChain;
  }

  /** 浏览器 Hi-Res 无损解码能力 */
  getHiResSupportInfo(): HiResSupportInfo {
    return detectHiResSupport();
  }

  /** 是否支持 Hi-Res 无损音频 */
  isHiResSupported(): boolean {
    return detectHiResSupport().supported;
  }

  /** 解码完整无损音频缓冲（Web Audio decodeAudioData 回退） */
  async decodeHiResAudio(data: ArrayBuffer): Promise<HiResDecodedAudio> {
    return this.hiresDecoder.decode(data);
  }

  /** 播放已解码的 Hi-Res 音频缓冲（接入当前音效总 gain） */
  playHiResAudio(decoded: HiResDecodedAudio, offset = 0): void {
    const ctx = this.audioCtx;
    if (!ctx) {
      logger.warn('AudioContext 未初始化，无法播放 Hi-Res 音频');
      return;
    }
    this.stopHiResAudio();
    const source = ctx.createBufferSource();
    source.buffer = decoded.buffer;
    source.connect(this.gain ?? ctx.destination);
    source.onended = (): void => {
      if (this.hiresSource === source) this.hiresSource = null;
    };
    this.hiresSource = source;
    void this.tryResume();
    source.start(0, Math.max(0, offset));
  }

  /** 停止 Hi-Res 解码音频播放 */
  stopHiResAudio(): void {
    if (!this.hiresSource) return;
    try {
      this.hiresSource.stop();
    } catch {
      // 已停止
    }
    this.hiresSource.disconnect();
    this.hiresSource = null;
  }

  /**
   * 卸载插件：取消订阅 + 释放音频图（销毁效果链 + 关闭 AudioContext）
   */
  uninstall(): void {
    // 取消所有事件订阅
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
    // 释放 Web Audio 图（含 play 监听移除与 AudioContext close）
    this.releaseAudioGraph();
    this.video = null;
    this.eventBus = null;
  }
}

/**
 * 音效插件工厂函数
 *
 * @param config - 插件配置
 * @returns AudioEffectPluginAPI 实例
 *
 * @example
 * const player = new VideoPlayer({
 *   plugins: {
 *     list: [
 *       AudioEffectPlugin({ volume: -3 }),
 *     ]
 *   }
 * });
 */
export function AudioEffectPlugin(config?: AudioEffectPluginConfig): AudioEffectPluginAPI {
  return new AudioEffectPluginClass(config);
}

/** 创建音效插件（别名） */
export const createAudioEffectPlugin = AudioEffectPlugin;
