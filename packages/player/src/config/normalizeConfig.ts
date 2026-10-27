/**
 * ============================================
 * 配置兼容层（旧扁平 → 命名空间）
 * ============================================
 * 把「旧扁平写法」或「新命名空间写法」统一归一化为命名空间形态，
 * 使 `new VideoPlayer({ volume: 0.5 })` 与
 * `new VideoPlayer({ playback: { volume: 0.5 } })` 都能生效。
 *
 * 规则：
 *   1. 新旧同时出现时，**以新写法为准**（旧键仅在目标路径为空时回填）；
 *   2. 纯函数，不修改入参；
 *   3. 开发环境下对每个被映射的旧键**只打印一次**迁移警告，避免刷屏。
 *
 * 映射规则以内联方式维护（MAJOR_VERSION_COMPAT_KEYS 等常量表）。
 */

import type {
  AdvancedConfig,
  ControlsConfig,
  EventListeners,
  I18nPlayerConfig,
  InteractionConfig,
  KeyboardStepConfig,
  LegacyPlayerConfig,
  MediaItem,
  PlaybackConfig,
  PlayerConfig,
  PlayerSource,
  PlayMode,
  PluginsConfig,
  ProgressConfig,
  ProgressSegment,
  QualityConfig,
  StorageConfig,
  SubtitleConfig,
  SubtitleConfigSpace,
  UiConfig,
} from '@/types';
import type { Plugin } from '@/nova/core/plugin';
import { isDev, WarnSource, warn } from '@/core/warning';

/**
 * 旧扁平 → 新路径 的迁移对照表
 *
 * 作为文档与测试的单一映射来源；`container` / `src` / `poster` 保持顶层，不在表内。
 */
export const LEGACY_KEY_MAP = {
  playerName: 'ui.title',
  controlBtns: 'ui.controls',
  controls: 'ui.controls',
  keyboard: 'interaction.keyboard',
  defaultQuality: 'quality.default',
  progressSegments: 'progress.segments',
  subtitles: 'subtitle.list',
  plugins: 'plugins.list',
  debug: 'advanced.debug',
  autoplay: 'playback.autoplay',
  muted: 'playback.muted',
  volume: 'playback.volume',
  playbackRate: 'playback.playbackRate',
  loop: 'playback.loop',
  playMode: 'playback.playMode',
  preload: 'playback.preload',
  playsinline: 'playback.playsinline',
} as const;

/** 迁移对照表的旧键联合类型 */
export type LegacyKey = keyof typeof LEGACY_KEY_MAP;

/** 已警告过的旧键（模块级，保证每个键只警告一次） */
const warnedLegacyKeys = new Set<LegacyKey>();

/**
 * 清空「旧键只警告一次」的去重缓存
 *
 * 仅供单元测试使用：测试间需要独立验证警告次数时调用。
 */
export function resetLegacyWarnings(): void {
  warnedLegacyKeys.clear();
}

/**
 * 输出一次旧键迁移警告（每个键仅一次）
 *
 * @param legacyKey - 旧扁平键
 * @param target - 新命名空间路径
 */
function warnMigrate(legacyKey: LegacyKey, target: string): void {
  if (!isDev()) return;
  if (warnedLegacyKeys.has(legacyKey)) return;
  warnedLegacyKeys.add(legacyKey);
  warn(
    WarnSource.STATE,
    `检测到已废弃的扁平配置键 "${legacyKey}"，请迁移到 "${target}"（下个大版本将移除）`,
  );
}

/**
 * 兼容层内部使用的「联合输入」视图
 *
 * 同时包含新命名空间键与旧扁平键，使 `normalizeConfig` 可以无强制类型转换地
 * 读取两种写法。`LegacyPlayerConfig` 与 `PlayerConfig` 均可赋值给它。
 */
type NormalizeInput = {
  // 顶层资源
  container?: HTMLElement | string;
  src?: PlayerSource | string[];
  poster?: string;

  // 新命名空间
  playback?: PlaybackConfig;
  playlist?: MediaItem[];
  playlistIndex?: number;
  ui?: UiConfig;
  interaction?: InteractionConfig;
  quality?: QualityConfig;
  progress?: ProgressConfig;
  subtitle?: SubtitleConfigSpace;
  plugins?: PluginsConfig | Plugin[];
  storage?: StorageConfig;
  advanced?: AdvancedConfig;
  callbacks?: EventListeners;
  i18n?: I18nPlayerConfig;

  // 旧扁平键
  autoplay?: boolean;
  muted?: boolean;
  volume?: number;
  playbackRate?: number;
  loop?: boolean;
  playMode?: PlayMode;
  preload?: 'none' | 'metadata' | 'auto';
  playsinline?: boolean;
  controls?: ControlsConfig;
  controlBtns?: ControlsConfig;
  defaultQuality?: string;
  keyboard?: boolean | KeyboardStepConfig;
  progressSegments?: ProgressSegment[];
  playerName?: string;
  subtitles?: SubtitleConfig[];
  debug?: boolean;
};

/**
 * 把「旧扁平写法」或「新命名空间写法」统一归一化为命名空间形态
 *
 * @param raw - 用户配置（新旧写法皆可，允许混写）
 * @returns 归一化后的命名空间配置（新对象，不改入参）
 *
 * @example
 * // 旧写法
 * normalizeConfig({ volume: 0.5, controlBtns: { pip: false } });
 * // → { playback: { volume: 0.5 }, ui: { controls: { pip: false } } }
 *
 * @example
 * // 新写法（原样通过）
 * normalizeConfig({ playback: { volume: 0.5 }, ui: { controls: { pip: false } } });
 */
export function normalizeConfig(
  raw: LegacyPlayerConfig | PlayerConfig,
): PlayerConfig {
  const input: NormalizeInput = raw;
  const out: PlayerConfig = {};

  // ── 顶层资源：新旧同名，保持顶层 ──
  if (input.container !== undefined) out.container = input.container;
  if (input.src !== undefined) out.src = input.src;
  if (input.poster !== undefined) out.poster = input.poster;

  // ── playback：autoplay/muted/volume/playbackRate/loop/playMode/preload/playsinline ──
  const playback: PlaybackConfig = { ...(input.playback ?? {}) };
  if (playback.autoplay === undefined && input.autoplay !== undefined) {
    warnMigrate('autoplay', LEGACY_KEY_MAP.autoplay);
    playback.autoplay = input.autoplay;
  }
  if (playback.muted === undefined && input.muted !== undefined) {
    warnMigrate('muted', LEGACY_KEY_MAP.muted);
    playback.muted = input.muted;
  }
  if (playback.volume === undefined && input.volume !== undefined) {
    warnMigrate('volume', LEGACY_KEY_MAP.volume);
    playback.volume = input.volume;
  }
  if (playback.playbackRate === undefined && input.playbackRate !== undefined) {
    warnMigrate('playbackRate', LEGACY_KEY_MAP.playbackRate);
    playback.playbackRate = input.playbackRate;
  }
  if (playback.loop === undefined && input.loop !== undefined) {
    warnMigrate('loop', LEGACY_KEY_MAP.loop);
    playback.loop = input.loop;
  }
  if (playback.playMode === undefined && input.playMode !== undefined) {
    warnMigrate('playMode', LEGACY_KEY_MAP.playMode);
    playback.playMode = input.playMode;
  }
  if (playback.preload === undefined && input.preload !== undefined) {
    warnMigrate('preload', LEGACY_KEY_MAP.preload);
    playback.preload = input.preload;
  }
  if (playback.playsinline === undefined && input.playsinline !== undefined) {
    warnMigrate('playsinline', LEGACY_KEY_MAP.playsinline);
    playback.playsinline = input.playsinline;
  }
  if (Object.keys(playback).length > 0) out.playback = playback;

  // ── playlist / playlistIndex：新键，直接透传 ──
  if (input.playlist !== undefined) out.playlist = input.playlist;
  if (input.playlistIndex !== undefined) {
    out.playlistIndex = input.playlistIndex;
  }

  // ── ui：playerName → title；controlBtns / controls → controls ──
  const ui: UiConfig = { ...(input.ui ?? {}) };
  if (ui.title === undefined && input.playerName !== undefined) {
    warnMigrate('playerName', LEGACY_KEY_MAP.playerName);
    ui.title = input.playerName;
  }
  if (ui.controls === undefined) {
    if (input.controlBtns !== undefined) {
      warnMigrate('controlBtns', LEGACY_KEY_MAP.controlBtns);
      ui.controls = input.controlBtns;
    } else if (input.controls !== undefined) {
      warnMigrate('controls', LEGACY_KEY_MAP.controls);
      ui.controls = input.controls;
    }
  }
  if (Object.keys(ui).length > 0) out.ui = ui;

  // ── interaction：keyboard ──
  const interaction: InteractionConfig = { ...(input.interaction ?? {}) };
  if (interaction.keyboard === undefined && input.keyboard !== undefined) {
    warnMigrate('keyboard', LEGACY_KEY_MAP.keyboard);
    interaction.keyboard = input.keyboard;
  }
  if (interaction.keyboard !== undefined) out.interaction = interaction;

  // ── quality：defaultQuality → default ──
  const quality: QualityConfig = { ...(input.quality ?? {}) };
  if (quality.default === undefined && input.defaultQuality !== undefined) {
    warnMigrate('defaultQuality', LEGACY_KEY_MAP.defaultQuality);
    quality.default = input.defaultQuality;
  }
  if (Object.keys(quality).length > 0) out.quality = quality;

  // ── progress：progressSegments → segments；previewProvider / energyProvider 直接透传 ──
  const progress: ProgressConfig = { ...(input.progress ?? {}) };
  if (progress.segments === undefined && input.progressSegments !== undefined) {
    warnMigrate('progressSegments', LEGACY_KEY_MAP.progressSegments);
    progress.segments = input.progressSegments;
  }
  // 分段 / 预览提供者 / 高能提供者任一存在即保留 progress 命名空间（白名单式拷贝）
  if (Object.keys(progress).length > 0) out.progress = progress;

  // ── subtitle：subtitles → list ──
  const subtitle: SubtitleConfigSpace = { ...(input.subtitle ?? {}) };
  if (subtitle.list === undefined && input.subtitles !== undefined) {
    warnMigrate('subtitles', LEGACY_KEY_MAP.subtitles);
    subtitle.list = input.subtitles;
  }
  if (Object.keys(subtitle).length > 0) out.subtitle = subtitle;

  // ── plugins：Plugin[] → list ──
  if (input.plugins !== undefined) {
    if (Array.isArray(input.plugins)) {
      warnMigrate('plugins', LEGACY_KEY_MAP.plugins);
      out.plugins = { list: input.plugins };
    } else {
      out.plugins = { ...input.plugins };
    }
  }

  // ── storage：新键，直接透传 ──
  if (input.storage !== undefined) out.storage = { ...input.storage };

  // ── advanced：debug → debug ──
  const advanced: AdvancedConfig = { ...(input.advanced ?? {}) };
  if (advanced.debug === undefined && input.debug !== undefined) {
    warnMigrate('debug', LEGACY_KEY_MAP.debug);
    advanced.debug = input.debug;
  }
  if (Object.keys(advanced).length > 0) out.advanced = advanced;

  // ── callbacks：同名，直接透传 ──
  if (input.callbacks !== undefined) out.callbacks = input.callbacks;

  // ── i18n：国际化配置，直接透传（浅拷贝一层，messages 映射保持原引用）──
  if (input.i18n !== undefined) out.i18n = { ...input.i18n };

  return out;
}

export default normalizeConfig;
