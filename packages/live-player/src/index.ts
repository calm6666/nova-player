/**
 * `@lumina/live-player` 公开入口。
 *
 * 对外只有 Web Component：根元素 + 弹幕层 + 控制层；
 * 清晰度、速度、弹幕设置等面板均为根元素内部 DOM。
 */

import './styles/style.scss';

export {
  CONTROL_BAR_TAG,
  DANMAKU_TAG,
  LIVE_PLAYER_ELEMENT_REGISTRY,
  LIVE_PLAYER_TAG,
  LivePlayerElement,
  NovaLivePlayerControlBarElement,
  NovaLivePlayerDanmakuElement,
  defineLivePlayerElements,
  registerLivePlayerElements,
} from './elements';

export { LIVE_PLAYER_EVENTS, dispatchPlayerEvent, onPlayerEvent } from './core/events';
export type { LivePlayerEventDetailMap, LivePlayerEventName } from './core/events';

export { clearSettings as clearPersistedSettings, loadSettings } from './core/persistence';
export type { PersistedSettings } from './core/persistence';

export { LIVE_PLAYER_MESSAGES, getLivePlayerMessages, mergeLivePlayerMessages } from './i18n/locales';
export { NOVA_LIVE_HOTKEYS } from './core/hotkeys';
export { detectStreamKind } from './core/stream';
export type { StreamKind } from './core/stream';

export type {
  NovaContextMenuAction,
  NovaContextMenuTarget,
  NovaControlAction,
  NovaDanmakuArea,
  NovaDanmakuItem,
  NovaDanmakuSetting,
  NovaDanmakuStroke,
  NovaErrorContent,
  NovaLivePlayerOptions,
  NovaLineCandidate,
  NovaPanelName,
  NovaQualityCandidate,
  NovaScreenMode,
  NovaVideoInfo,
} from './types';
export { DEFAULT_DANMAKU_SETTING } from './types';
