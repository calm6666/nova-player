// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { VideoPlayer } from '../packages/player/src/player/VideoPlayer';

class TestObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
(globalThis as unknown as { ResizeObserver: typeof TestObserver }).ResizeObserver =
  TestObserver;
(globalThis as unknown as { IntersectionObserver: typeof TestObserver }).IntersectionObserver =
  TestObserver;

describe('player progress integration', () => {
  test('player timeupdate fills the top progress bar', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const player = new VideoPlayer({ src: '/sample.mp4' });
    player.mount(host);

    const video = host.querySelector('video');
    expect(video).not.toBeNull();
    Object.defineProperty(video, 'duration', {
      configurable: true,
      value: 10,
    });
    video!.currentTime = 5;
    video!.dispatchEvent(new Event('loadedmetadata'));
    video!.dispatchEvent(new Event('timeupdate'));

    const current = host.querySelector<HTMLElement>(
      '.nova-player-progress-schedule-current',
    );
    expect(current?.style.transform).toBe('scaleX(0.5)');

    // 点击进度条 50% 位置应触发 seek
    const area = host.querySelector<HTMLElement>('.nova-player-progress-area');
    expect(area).not.toBeNull();
    area!.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 10, right: 100, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    host
      .querySelector<HTMLElement>('.nova-player-progress')
      ?.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 50,
          clientY: 5,
          button: 0,
        }),
      );
    expect(video!.currentTime).toBeCloseTo(5, 1);

    player.destroy();
  });
});
