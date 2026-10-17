/**
 * 播放器快捷键定义。
 *
 * 这份数据同时驱动「根元素的键盘行为」与「快捷键说明面板」，
 * 保证说明面板永远与真实行为一致（只读展示，不提供自定义注册）。
 */

import type { NovaHotkeyItem } from '@/live/types';

/** 全部快捷键（按展示顺序排列）。 */
export const NOVA_LIVE_HOTKEYS: readonly NovaHotkeyItem[] = [
  { keys: 'Space / K', descKey: 'livePlayer.hotkey.playPause' },
  { keys: 'M', descKey: 'livePlayer.hotkey.mute' },
  { keys: '↑ / ↓', descKey: 'livePlayer.hotkey.volume' },
  { keys: 'F', descKey: 'livePlayer.hotkey.fullscreen' },
  { keys: 'W', descKey: 'livePlayer.hotkey.webscreen' },
  { keys: 'D', descKey: 'livePlayer.hotkey.danmaku' },
  { keys: '?', descKey: 'livePlayer.hotkey.help' },
  { keys: 'Esc', descKey: 'livePlayer.hotkey.escape' },
];
