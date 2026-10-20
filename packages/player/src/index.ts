/**
 * ============================================
 * Nova 核心播放器（基于 Lumina 框架）
 * ============================================
 *
 * 使用方式：
 * import { VideoPlayer } from '@lumina/nova';
 *
 * const player = new VideoPlayer({
 *   src: 'video.mp4',
 *   container: '#player-container'
 * });
 */

// 导出播放器
export { VideoPlayer } from './player';

// 导出便捷入口（createPlayer / mountPlayer / 实例查询）
// 此前只定义在 src/player/index.ts，未从包入口导出，消费者无法使用
export { createPlayer, mountPlayer, getPlayerInstance } from './player';

// 导出类型
export type { PlayerConfig } from '@/types';
// 进度条扩展 API：预览图 / 高能进度条数据均由外部 Provider 提供
export type {
  ProgressPreviewFrame,
  ProgressPreviewProvider,
  EnergyProgressData,
  EnergyProgressProvider,
} from '@/types';
export type {
  StateManager,
  EventBus,
  HookSystem,
} from '@/core';

// 导出插件相关（从 plugins 包）
export type {
  Plugin,
  PluginContext,
} from '@/nova/core/plugin';
export { PlayerHooks } from '@/nova/core/plugin';

// 导出事件系统
export { createEventBus } from '@/events';
export type { EventHandler } from '@/events';

// 导出错误处理系统
export {
  ErrorHandler,
  createErrorHandler,
  ErrorLevel,
  ErrorType,
} from '@/error';

export type {
  ErrorInfo,
  ErrorHandlerConfig,
} from '@/error';

// 导出 SSR 相关功能
export {
  isServer,
  createSSRConfig,
} from '@/utils';
export type { SSRConfig } from '@/utils';

// 导出清单协议判定（唯一实现，供流媒体插件按内容判定协议）
export {
  detectManifestProtocol,
  isSegmentBaseManifest,
  isMediaManifestLike,
  resolveManifestProtocolProfile,
} from '@/nova/utils/media/manifestProtocol';
export type {
  ManifestProtocol,
  ManifestSegmentMode,
  ManifestProtocolProfile,
} from '@/nova/utils/media/manifestProtocol';

// 导出插槽类型（插件 / 配置共用）
export type { SlotContent, SlotMount, SlotContext } from './types/slots';

// 导出 Lumina 运行时（Top/Ending 插件视图使用，避免重复打包框架）
export {
  h,
  mount,
  destroy,
  defineComponent,
  useTemplateRef,
  signal,
  Fragment,
  t,
} from '@/core';
export { Plus, Issue } from '@/nova/components/icons';
export { rafTimeout, cancelRaf } from '@/utils/rafTimeout';
export type { AnimationFrameID } from '@/utils/rafTimeout';
export { LottieIcon } from '@/nova/components/LottieIcon';
export type { LottieIconApi } from '@/nova/components/LottieIcon';

// 导出插件视图公共类型
export type {
  VNode,
  ComponentLifecycle,
  EndingRelatedItem,
  EndingUpInfo,
  InteractiveBacktrackItem,
  PlayerScene,
} from '@/types';
