/**
 * ============================================
 * AudioEffect 音效插件入口
 * ============================================
 * 统一导出插件工厂、类型、预设表
 */

export { AudioEffectPlugin, createAudioEffectPlugin } from './AudioEffectPlugin';
export type { AudioEffectPluginConfig, AudioEffectPluginAPI } from './AudioEffectPlugin';
export { HiResAudioDecoder, detectHiResSupport } from './HiResAudioDecoder';
export type { HiResDecodedAudio, HiResSupportInfo } from './HiResAudioDecoder';

export type {
  EffectName,
  EQPresetName,
  EQBandCount,
  ReverbPresetName,
  ReverbIRType,
  CombinationPresetName,
  ReverbData,
  CompressorData,
  CombinationItem,
  CombinationPreset,
  EffectActiveMap,
  EQGainArray,
  EQPresetTable,
  ReverbPresetTable,
  CompressorPresetTable,
  CombinationPresetTable,
} from './types';

export {
  EQ_PRESETS,
  REVERB_PRESETS,
  COMPRESSOR_PRESETS,
  COMBINATION_PRESETS,
} from './presets';

export { db2gain, gain2db, getDryLevel, getWetLevel, isFiniteNumber } from './utils';

export { EffectBase } from './effects/EffectBase';
export { EQEffect } from './effects/EQEffect';
export { ReverbEffect } from './effects/ReverbEffect';
export { A3DEffect } from './effects/A3DEffect';
export { PhoneEffect } from './effects/PhoneEffect';
export { CompressorEffect } from './effects/CompressorEffect';
export { EffectChain } from './effects/EffectChain';
