/** Event names dispatched by the live player element. */
export const LIVE_PLAYER_EVENTS = {
  ready: 'nova-live-player:ready',
  play: 'nova-live-player:play',
  pause: 'nova-live-player:pause',
  timeupdate: 'nova-live-player:timeupdate',
  progress: 'nova-live-player:progress',
  volumechange: 'nova-live-player:volumechange',
  mutechange: 'nova-live-player:mutechange',
  qualitychange: 'nova-live-player:qualitychange',
  qualitycandidates: 'nova-live-player:qualitycandidates',
  linechange: 'nova-live-player:linechange',
  linecandidates: 'nova-live-player:linecandidates',
  codecchange: 'nova-live-player:codecchange',
  screenchange: 'nova-live-player:screenchange',
  danmakuvisible: 'nova-live-player:danmakuvisible',
  danmakusetting: 'nova-live-player:danmakusetting',
  danmakusent: 'nova-live-player:danmakusent',
  streamchange: 'nova-live-player:streamchange',
  reload: 'nova-live-player:reload',
  error: 'nova-live-player:error',
  destroy: 'nova-live-player:destroy',
} as const;

/** Any event name emitted by the live player. */
export type LivePlayerEventName = (typeof LIVE_PLAYER_EVENTS)[keyof typeof LIVE_PLAYER_EVENTS];

/** Payload of each event, keyed by name. */
export interface LivePlayerEventDetailMap {
  ready: { container: HTMLElement | null };
  play: undefined;
  pause: undefined;
  timeupdate: { currentTime: number; duration: number; liveDuration: number };
  progress: { buffered: number; percent: number };
  volumechange: { volume: number };
  mutechange: { muted: boolean };
  qualitychange: { quality: string; label: string };
  qualitycandidates: { candidates: ReadonlyArray<{ qn: string; label: string }>; current: string };
  linechange: { line: string; label: string };
  linecandidates: { candidates: ReadonlyArray<{ line: string; label: string }>; current: string };
  codecchange: { codec: string; label: string };
  screenchange: { mode: 'normal' | 'webscreen' | 'fullscreen' };
  danmakuvisible: { visible: boolean };
  danmakusetting: { setting: Record<string, unknown> };
  danmakusent: { text: string };
  streamchange: { url: string };
  reload: undefined;
  error: { code: string; message: string };
  destroy: undefined;
}

/** Dispatches one typed event from the element. */
export function dispatchPlayerEvent<K extends keyof LivePlayerEventDetailMap>(
  target: HTMLElement,
  name: K,
  detail: LivePlayerEventDetailMap[K],
): void {
  target.dispatchEvent(
    new CustomEvent(LIVE_PLAYER_EVENTS[name], {
      bubbles: true,
      composed: true,
      detail,
    }),
  );
}

/** Subscribes to one typed event. */
export function onPlayerEvent<K extends keyof LivePlayerEventDetailMap>(
  target: HTMLElement,
  name: K,
  handler: (detail: LivePlayerEventDetailMap[K]) => void,
): () => void {
  const listener = (event: Event): void => {
    handler((event as CustomEvent<LivePlayerEventDetailMap[K]>).detail);
  };
  target.addEventListener(LIVE_PLAYER_EVENTS[name], listener);
  return (): void => {
    target.removeEventListener(LIVE_PLAYER_EVENTS[name], listener);
  };
}
