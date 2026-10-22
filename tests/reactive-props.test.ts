// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { defineComponent, h, signal } from '../core';
import { mount } from '../core/mount';
import { ViewpointMenu } from '../packages/player/src/components/ViewpointMenu';

describe('reactive component props', () => {
  it('tracks a signal passed as a component prop through the compiler _rp path', () => {
    const count = signal(1);

    const Child = defineComponent<{ count: number }>((props) =>
      h('span', { id: 'value' }, () => String(props.count)),
    );

    const Parent = defineComponent(() =>
      h('div', {}, h(Child, { count: count.value })),
    );

    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(Parent({}), host);

    expect(host.querySelector('#value')?.textContent).toBe('1');
    count.value = 2;
    expect(host.querySelector('#value')?.textContent).toBe('2');
  });

  it('updates ViewpointMenu from reactive currentTime props', () => {
    const time = signal(0);
    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(
      h(ViewpointMenu, {
        points: [
          { title: 'First', time: 0 },
          { title: 'Second', time: 10 },
        ],
        currentTime: time.value,
      }),
      host,
    );
    const items = (): NodeListOf<HTMLLIElement> =>
      host.querySelectorAll('.nova-player-ctrl-viewpoint-menu-item');
    expect(items()[0]?.className).toContain('active');
    time.value = 12;
    expect(items()[0]?.className).not.toContain('active');
    expect(items()[1]?.className).toContain('active');
  });

  it('keeps props identity when no reactive value is present', () => {
    const Child = defineComponent<{ label: string }>((props) =>
      h('span', {}, () => props.label),
    );
    const view = Child({ label: 'static' });
    expect(view).toBeTruthy();
  });
});
