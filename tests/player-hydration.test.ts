// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { VideoPlayer } from '../packages/player/src/player/VideoPlayer';

// jsdom 不实现浏览器观察器；播放器挂载会注册它们
class TestObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] { return []; }
}
(globalThis as unknown as { ResizeObserver: typeof TestObserver }).ResizeObserver =
  TestObserver;
(globalThis as unknown as { IntersectionObserver: typeof TestObserver }).IntersectionObserver =
  TestObserver;

describe('player SSR hydration', () => {
  it('hydrates server-rendered player chrome without replacing it', () => {
    const config = {
      src: 'https://example.com/video.mp4',
      playback: { autoplay: false, muted: true },
    };

    const serverPlayer = new VideoPlayer(config);
    const html = serverPlayer.renderToString();
    expect(html).toContain('nova-player-container');
    expect(html).toContain('nova-player-control-bottom');

    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const originalRoot = host.querySelector('.nova-player-container');

    const clientPlayer = new VideoPlayer(config);
    clientPlayer.hydrate(host);

    expect(host.querySelector('.nova-player-container')).toBe(originalRoot);
    expect(host.querySelectorAll('.nova-player-container')).toHaveLength(1);
    expect(host.querySelector('video')).toBeInstanceOf(HTMLVideoElement);
  });
});
