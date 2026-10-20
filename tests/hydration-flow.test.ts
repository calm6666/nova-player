// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Show, defineComponent, h } from '../core';
import { hydrate } from '../core/mount';
import { renderToString } from '../core/ssr';

describe('hydration flow', () => {
  it('keeps following DOM and binds events when SSR flow output is empty', () => {
    let inside = 0;
    let after = 0;
    const Comp = defineComponent(() =>
      h(
        'div',
        {},
        h(
          Show,
          { when: true },
          h(
            'button',
            {
              id: 'inside',
              onClick: () => {
                inside += 1;
              },
            },
            'inside',
          ),
        ),
        h(
          'button',
          {
            id: 'after',
            onClick: () => {
              after += 1;
            },
          },
          'after',
        ),
      ),
    );

    document.body.innerHTML = renderToString(Comp({}));
    hydrate(Comp({}), document.body);

    (document.getElementById('after') as HTMLButtonElement).click();
    (document.getElementById('inside') as HTMLButtonElement).click();

    expect(after).toBe(1);
    expect(inside).toBe(1);
  });
});
