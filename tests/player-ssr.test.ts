// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToString } from '../core';
import { VideoPlayer } from '../packages/player/src/player/VideoPlayer';
import { h } from '../core';

describe('player SSR', () => {
  it('serializes reactive style attrs as CSS, not [object Object]', () => {
    const html = renderToString(
      h('div', {
        class: 'static',
        __reactiveAttrs: {
          class: () => 'reactive',
          style: () => ({ display: 'none', color: 'red' }),
        },
      }),
    );
    expect(html).toContain('class="static reactive"');
    expect(html).toContain('style="display: none; color: red;"');
  });

  it('renders player chrome to HTML in Node', () => {
    const player = new VideoPlayer({
      src: 'https://example.com/video.mp4',
      autoplay: false,
    });
    const html = player.renderToString();
    expect(html).toContain('nova-player-container');
    expect(html).toContain('nova-player-control-bottom');
    expect(html).not.toMatch(/\sclass="[^"]*"[^>]*\sclass="/);
    expect(html).not.toMatch(/\sstyle="[^"]*"[^>]*\sstyle="/);
    expect(html).not.toContain('[object Object]');
  });
});
