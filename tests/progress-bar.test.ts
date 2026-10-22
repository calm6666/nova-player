// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { h, mount } from '../core';
import { ProgressBar, type ProgressBarApi } from '../packages/player/src/components/ProgressBar';

describe('ProgressBar API', () => {
  test('updates played and buffered fill after mount', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let api: ProgressBarApi | null = null;
    mount(
      h(ProgressBar, {
        duration: 10,
        onProgressBarMounted: (next: ProgressBarApi) => {
          api = next;
        },
      }),
      host,
    );
    expect(api).not.toBeNull();
    api!.setDuration(10);
    api!.updateBuffer(5);
    api!.updateProgress(5);
    const current = host.querySelector<HTMLElement>(
      '.nova-player-progress-schedule-current',
    );
    const buffer = host.querySelector<HTMLElement>(
      '.nova-player-progress-schedule-buffer',
    );
    expect(current?.style.transform).toBe('scaleX(0.5)');
    expect(buffer?.style.transform).toBe('scaleX(0.5)');
  });
});
