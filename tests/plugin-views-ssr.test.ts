// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { h, renderToString } from '../core';
import { Top } from '../packages/plugins/src/top/TopView';
import { Ending } from '../packages/plugins/src/ending/EndingView';

describe('plugin view SSR guards', () => {
  it('renders Top on the server', () => {
    const html = renderToString(
      h(Top, {
        title: 'Server rendered title',
        upName: 'Uploader',
        views: 100,
        danmakuCount: 20,
      }),
    );
    expect(html).toContain('nova-player-top');
  });

  it('renders Ending on the server', () => {
    const html = renderToString(
      h(Ending, {
        title: 'Server rendered ending',
        related: [],
      }),
    );
    expect(html.length).toBeGreaterThan(0);
  });
});
