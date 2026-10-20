/**
 * ============================================
 * Lumina 插件系统（Nova 播放器官方插件）
 * ============================================
 *
 * 使用方式（插件列表走 config.plugins.list，也可构造后逐个 player.use()）：
 *
 * import {
 *   DanmakuPlugin,
 *   SubtitlePlugin,
 *   DashPlugin,
 *   HlsPlugin,
 *   FlvPlugin,
 *   InteractionPlugin
 * } from '@lumina/plugins';
 *
 * const player = new VideoPlayer({
 *   src: 'video.mp4',
 *   plugins: {
 *     list: [
 *       DanmakuPlugin({ options: { debug: false } }),
 *       SubtitlePlugin({
 *         sources: [
 *           { src: 'subtitles/cn.srt', lang: 'zh', label: '中文' }
 *         ]
 *       }),
 *       DashPlugin({ autoplay: true }),
 *       InteractionPlugin({ mode: 'interactive' })
 *     ]
 *   }
 * });
 *
 * // 等价写法：player.use(DanmakuPlugin())
 */

// 导出流媒体相关
export type { StreamPlugin, StreamConfig, BufferInfo, StreamStats, MediaManifestSource } from './stream/types';
// StreamPluginTypeEnum / StreamFormatEnum 以运行时真正使用的那份为准
// （@/types/streamPlugin，取值为小写 'hls' / 'dash' / 'flv'）；
// ./stream/enums 下的同名枚举是大写旧版（'HLS' …），与运行时值不相等，故不再从那里导出
export { StreamPluginTypeEnum, StreamFormatEnum } from '@/types/streamPlugin';
export { StreamingProtocolEnum, BufferStatusEnum } from './stream/enums';

// 流媒体插件私有事件总线：StreamPluginEventEnum 的上报不再经播放器总线，
// 消费方通过插件实例的 getStreamEventBus() 订阅
export { createStreamPluginEventBus } from './stream/streamEventBus';
export type {
  StreamPluginEventBus,
  StreamPluginEventMap,
  EmptyStreamPayload,
} from './stream/streamEventBus';

// 导出流媒体插件事件枚举
// 三个流媒体插件实际 emit 的值来自 @/types/streamPlugin（大写前缀形式，如 STREAM_STATS_UPDATE），
// 与私有总线 StreamPluginEventMap 的键完全一致；
// 此前这里导出的是 ./stream/enums 下的同名枚举（值不带 STREAM_ 前缀，如 STATS_UPDATE），
// 拿它订阅私有总线永远匹配不上，故统一导出插件真正使用的那一份
export { StreamPluginEventEnum } from '@/types/streamPlugin';

// 导出 FLV 插件 - 使用工厂函数
export { FlvPlugin, createFlvPlugin } from './flv';

// 导出 HLS 插件 - 使用工厂函数
export { HlsPlugin, createHlsPlugin } from './hls';

// 导出 DASH 插件 - 使用工厂函数
export { DashPlugin, createDashPlugin } from './dash';

// 导出三个流媒体插件的配置类型（此前未导出，消费者无法为配置标注类型）
export type { FlvPluginConfig } from './flv';
export type { HlsPluginConfig } from './hls';
export type { DashPluginConfig } from './dash';

// 导出弹幕插件 - 使用工厂函数
export { DanmakuPlugin, createDanmakuPlugin } from './danmaku';
export type { DanmakuPluginConfig, DanmakuPluginAPI } from './danmaku';
export type { DanmakuItem } from './danmaku/types';

// 导出字幕插件 - 使用工厂函数
export { SubtitlePlugin, createSubtitlePlugin } from './subtitle';
export type { SubtitlePluginConfig, SubtitlePluginAPI } from './subtitle';

// 导出 AI 字幕扩展能力（后端可配置、后续对接）
export type { AiSubtitleBackendConfig, AiSubtitleEntry } from './subtitle';
export { AiSubtitleFetcher, defaultAiSubtitleParser, fillAiTemplate } from './subtitle';

// 导出交互插件 - 使用工厂函数
export { InteractionPlugin } from './interaction';
export type {
  InteractionPluginConfig,
  InteractionPluginMode,
  InteractionPluginAPI,
} from './interaction';

// 导出互动视频插件（分支剧情视频）- 使用工厂函数
export { InteractiveVideoPlugin } from './interactive-video';
export type {
  InteractiveVideoPluginConfig,
  InteractiveVideoPluginAPI,
  InteractiveNode,
  InteractiveQuestion,
  InteractiveOption,
  VisitedNode,
} from './interactive-video';

// 导出音效插件 - 使用工厂函数
export { AudioEffectPlugin, createAudioEffectPlugin } from './audioeffect';
export type { AudioEffectPluginConfig, AudioEffectPluginAPI } from './audioeffect';

// 导出 Top / Ending 插件
export { TopPlugin } from './top';
export type { TopPluginConfig } from './top';
export { EndingPlugin } from './ending';
export type { EndingPluginConfig } from './ending';
