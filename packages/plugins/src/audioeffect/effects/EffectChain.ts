/**
 * ============================================
 * EffectChain 效果链管理器
 * ============================================
 * 管理 EQ / Reverb / A3D / Phone / Compressor 五种效果的激活状态与节点连接
 *
 * 采用并联结构：每个效果独立从 mediaSource 接入，输出统一汇入 gain 节点
 *   mediaSource ──► effect_i (active=true) ──► gain ──► destination
 *                └─► (inactive 不连接)
 * 另含干声直连（bypass）路径：无任何激活效果时 mediaSource 直通 gain
 *   mediaSource ──► gain ──► destination（0 个效果激活 = 原声直放）
 * 优点：激活/切换互不干扰，单效果出问题不影响其它
 *
 * 直连路径为链路兜底：MediaElementSource 接管后视频音频全部改道进
 * Web Audio 图，若 source 无任何下游（全 inactive 又无 bypass）音频会被
 * 吞掉（无声），且 Chrome 下被接管元素的音频不被消费会导致 A/V 时钟
 * 停摆（暂停后恢复播放画面冻结）—— 直连保证音频链路任何状态恒通
 */

import type {
  EffectName,
  EQPresetName,
  EQBandCount,
  ReverbPresetName,
  CombinationPresetName,
} from '../types';
import {
  COMBINATION_PRESETS,
  COMPRESSOR_PRESETS,
  EQ_PRESETS,
  REVERB_PRESETS,
} from '../presets';
import { db2gain } from '../utils';
import { EffectBase } from './EffectBase';
import { EQEffect } from './EQEffect';
import { ReverbEffect } from './ReverbEffect';
import { A3DEffect } from './A3DEffect';
import { PhoneEffect } from './PhoneEffect';
import { CompressorEffect } from './CompressorEffect';

/** 单个效果的运行时状态 */
interface EffectState {
  /** 是否激活（参与连接） */
  active: boolean;
  /** 效果节点实例 */
  node: EffectBase;
}

/** 效果列表的固定顺序（用于稳定遍历） */
const EFFECT_ORDER: readonly EffectName[] = ['eq', 'reverb', 'a3d', 'phone', 'compressor'] as const;

/**
 * 效果链 —— 管理 mediaSource → active 效果节点 → gain → destination 的并联连接
 */
export class EffectChain {
  /** AudioContext，由外部插件注入 */
  private audioCtx: AudioContext | null = null;
  /** 上游音频源（MediaElementAudioSourceNode） */
  private source: MediaElementAudioSourceNode | null = null;
  /** 输出总控 GainNode（音量调节） */
  private gain: GainNode | null = null;
  /** 5 个效果的运行时状态映射 */
  private effectsObj: Record<EffectName, EffectState> = {
    eq: { active: false, node: new EQEffect() },
    reverb: { active: false, node: new ReverbEffect() },
    a3d: { active: false, node: new A3DEffect() },
    phone: { active: false, node: new PhoneEffect() },
    compressor: { active: false, node: new CompressorEffect() },
  };
  /** 效果名固定顺序数组 */
  private effectsList: readonly EffectName[] = EFFECT_ORDER;

  /**
   * 初始化：注入 audioCtx / source / gain / destination 引用，
   * 并对每个效果调用 init（让它们各自构建内部节点图）
   * @param audioCtx - AudioContext 实例
   * @param source - 上游 MediaElementAudioSourceNode
   * @param gain - 总控 GainNode
   * @param destination - 最终目标节点（audioCtx.destination）
   */
  init(
    audioCtx: AudioContext,
    source: MediaElementAudioSourceNode,
    gain: GainNode,
    destination: AudioNode,
  ): void {
    this.audioCtx = audioCtx;
    this.source = source;
    this.gain = gain;
    // 总控 gain 必须连到 destination，否则听不到声音
    gain.connect(destination);
    // 每个效果独立 init：上游=source，下游=gain（让效果内部不直接连接 destination，
    // 由 connectAll 统一接管 effect.source() → gain 的最终汇入）
    this.effectsList.forEach((name) => {
      this.effectsObj[name].node.init(audioCtx, source, gain);
    });
    // 初始全部效果 inactive，connectAll 在此状态下建立干声直连，
    // 从第一帧起 source → gain → destination 链路即恒通（见 connectAll）
    this.connectAll();
  }

  /**
   * 重建音频连接（干声直连 / active 效果支路二选一）
   * - 无任何激活效果：source 直通 gain（干声 bypass，原声直放）
   * - 有激活效果：每个效果 effect.connect() 将 source 接入输入；
   *   effect.source().connect(gain) 将输出汇入 gain
   * 两条路径互斥，保证任何状态下 source 必有下游（链路恒通兜底）
   */
  private connectAll(): void {
    if (!this.gain || !this.source) return;
    const gain = this.gain;
    // 干声直连分支：全部效果 inactive 时 source 直通 gain。
    // 根因修复：此前全 inactive 时 source 无任何下游 —— 接管后音频
    // 直接蒸发（无声），且 Chrome 下被接管元素的音频不被消费会冻结
    // A/V 时钟（暂停后恢复播放画面卡死）
    const hasActive = this.effectsList.some(
      (name) => this.effectsObj[name].active,
    );
    if (!hasActive) {
      this.source.connect(gain);
      return;
    }
    this.effectsList.forEach((name) => {
      const state = this.effectsObj[name];
      if (!state.active) return;
      state.node.connect();
      state.node.source().connect(gain);
    });
  }

  /**
   * 断开所有连接（干声直连 + active 效果支路）
   * 与 connectAll 对称：先断 source→gain 直连，再逐效果断输出→gain、
   * source→输入；容错 try/catch：节点可能尚未连接，避免抛出影响后续断开
   */
  private disconnectAll(): void {
    if (!this.gain) return;
    const gain = this.gain;
    // 断开干声直连（connectAll 的互斥另一半；未连接时为 no-op）
    try {
      this.source?.disconnect(gain);
    } catch {
      // 直连可能尚未建立，忽略
    }
    this.effectsList.forEach((name) => {
      const state = this.effectsObj[name];
      if (!state.active) return;
      try {
        state.node.source().disconnect(gain);
      } catch {
        // 节点可能尚未连接到 gain，忽略
      }
      try {
        state.node.disconnect();
      } catch {
        // 同上
      }
    });
  }

  /**
   * 设置某个效果的激活状态
   * 改变后通过 disconnectAll + connectAll 重建连接，确保状态一致
   * @param name - 效果名
   * @param active - 是否激活
   */
  setEffectActive(name: EffectName, active: boolean): void {
    const state = this.effectsObj[name];
    if (!state) return;
    if (state.active === active) return;
    this.disconnectAll();
    state.active = active;
    this.connectAll();
  }

  /**
   * 设置总音量（dB）
   * 用 setTargetAtTime 平滑过渡，避免爆音
   * @param db - 分贝值
   */
  setVolume(db: number): void {
    if (!this.gain || !this.audioCtx) return;
    this.gain.gain.setTargetAtTime(db2gain(db), this.audioCtx.currentTime, 0.015);
  }

  /**
   * 设置音量均衡模式（设置面板「音量均衡」的真实接线入口）
   *
   * 0 关闭 → 停用压缩器（干声直连恢复原声直放）；
   * 1 标准 → 应用 loudnessStandard 参数（强压缩拉平响度）并激活压缩器；
   * 2 高动态 → 应用 loudnessDynamic 参数（温和压缩保留动态）并激活压缩器。
   * 参数应用先于激活：先 setData 再 setEffectActive，避免激活瞬间以
   * default 参数短暂生效造成听感跳变
   * @param mode - 0 关闭 / 1 标准 / 2 高动态
   */
  setLoudness(mode: number): void {
    const state = this.effectsObj.compressor;
    if (!(state.node instanceof CompressorEffect)) return;
    if (mode === 0) {
      this.setEffectActive('compressor', false);
      return;
    }
    // 先应用对应模式的压缩参数（未激活时节点已存在，setData 安全）
    state.node.setData(
      mode === 2
        ? COMPRESSOR_PRESETS.loudnessDynamic
        : COMPRESSOR_PRESETS.loudnessStandard,
    );
    // 再激活压缩器（内部幂等守卫：已激活时不重复连接）
    this.setEffectActive('compressor', true);
  }

  /**
   * 设置 EQ 预设
   * 用 instanceof 守卫收窄类型，避免类型断言
   * @param preset - 预设名
   * @param bandCount - 段数（可选，'5' / '10'）
   */
  setEQPreset(preset: EQPresetName, bandCount?: EQBandCount): void {
    const eq = this.effectsObj.eq.node;
    if (eq instanceof EQEffect) {
      if (bandCount) eq.selectType(bandCount);
      eq.selectPreset(preset);
    }
  }

  /**
   * 直接设置 EQ 各段增益（音效调节面板自定义页）
   * 自动激活 EQ 效果，保证滑块调整立即生效。
   * @param gains - 各段增益（dB）
   */
  setEQGains(gains: readonly number[]): void {
    const eq = this.effectsObj.eq.node;
    if (!(eq instanceof EQEffect)) return;
    this.setEffectActive('eq', true);
    eq.setData(gains);
  }

  /**
   * 设置 Reverb 预设
   * 用 instanceof 守卫收窄类型
   * @param preset - 预设名
   */
  setReverbPreset(preset: ReverbPresetName): void {
    const reverb = this.effectsObj.reverb.node;
    if (reverb instanceof ReverbEffect) reverb.selectPreset(preset);
  }

  /**
   * 选择效果组合预设
   * 先将所有效果置为 inactive，再按 preset.items 逐项激活并选择对应预设
   * @param presetName - 组合预设名
   */
  selectCombination(presetName: CombinationPresetName): void {
    const preset = COMBINATION_PRESETS[presetName];
    if (!preset) return;
    this.disconnectAll();
    // 全部置为 inactive
    this.effectsList.forEach((name) => {
      this.effectsObj[name].active = false;
    });
    // 按 items 激活对应效果
    preset.items.forEach((item) => {
      const state = this.effectsObj[item.name];
      if (!state) return;
      state.active = true;
      // 对应预设处理：EQ / Reverb 通过各自的方法应用
      if (item.preset === undefined) return;
      if (item.name === 'eq') {
        const eq = state.node;
        if (eq instanceof EQEffect && this.isEQPresetName(item.preset)) {
          eq.selectPreset(item.preset);
        }
      } else if (item.name === 'reverb') {
        const reverb = state.node;
        if (reverb instanceof ReverbEffect && this.isReverbPresetName(item.preset)) {
          reverb.selectPreset(item.preset);
        }
      }
    });
    this.connectAll();
  }

  /**
   * 类型谓词：判断字符串是否为合法的 EQPresetName
   * 通过查询 EQ_PRESETS 表（5/10 段任一存在即合法）来运行时验证
   * @param value - 待验证字符串
   */
  private isEQPresetName(value: string): value is EQPresetName {
    // EQ_PRESETS 的键为段数 '5'/'10'，每段下表键为预设名
    return value in EQ_PRESETS['5'] || value in EQ_PRESETS['10'];
  }

  /**
   * 类型谓词：判断字符串是否为合法的 ReverbPresetName
   * 通过查询 REVERB_PRESETS 表来运行时验证
   * @param value - 待验证字符串
   */
  private isReverbPresetName(value: string): value is ReverbPresetName {
    return value in REVERB_PRESETS;
  }

  /**
   * 获取效果名固定顺序列表
   * @returns 效果名数组副本
   */
  getEffectsList(): EffectName[] {
    return [...this.effectsList];
  }

  /**
   * 销毁：断开所有连接 + 销毁每个效果 + 断开 source / gain
   */
  destroy(): void {
    this.disconnectAll();
    this.effectsList.forEach((name) => {
      this.effectsObj[name].node.destroy();
    });
    try {
      this.source?.disconnect();
    } catch {
      // source 可能未连接，忽略
    }
    try {
      this.gain?.disconnect();
    } catch {
      // gain 可能未连接，忽略
    }
    this.source = null;
    this.gain = null;
    this.audioCtx = null;
  }
}
