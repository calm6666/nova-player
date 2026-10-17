/**
 * 自定义元素注册表。
 *
 * 只注册「大组件」：
 * - `<nova-live-player>`：播放器根元素；
 * - `<nova-live-player-danmaku>`：弹幕层（plugins DanmakuManager）；
 * - `<nova-live-player-control-bar>`：控制层。
 *
 * 其余面板全部是根元素内部 DOM。
 */

import { CONTROL_BAR_TAG, NovaLivePlayerControlBarElement } from './ControlBarElement';
import { DANMAKU_TAG, NovaLivePlayerDanmakuElement } from './DanmakuElement';
import { LIVE_PLAYER_TAG, LivePlayerElement } from './LivePlayerElement';

/** 标签名 → 构造器。 */
export const LIVE_PLAYER_ELEMENT_REGISTRY: ReadonlyArray<
  readonly [string, CustomElementConstructor]
> = [
  [LIVE_PLAYER_TAG, LivePlayerElement],
  [DANMAKU_TAG, NovaLivePlayerDanmakuElement],
  [CONTROL_BAR_TAG, NovaLivePlayerControlBarElement],
];

/** 注册全部自定义元素（幂等）。 */
export function registerLivePlayerElements(): void {
  if (typeof window === 'undefined') return;
  if (typeof customElements === 'undefined') return;
  for (const [tagName, constructor] of LIVE_PLAYER_ELEMENT_REGISTRY) {
    if (customElements.get(tagName)) continue;
    customElements.define(tagName, constructor);
  }
}

/** 别名。 */
export function defineLivePlayerElements(): void {
  registerLivePlayerElements();
}

export {
  CONTROL_BAR_TAG,
  DANMAKU_TAG,
  LIVE_PLAYER_TAG,
  LivePlayerElement,
  NovaLivePlayerControlBarElement,
  NovaLivePlayerDanmakuElement,
};
