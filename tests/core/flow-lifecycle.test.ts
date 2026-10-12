/**
 * 控制流（Show/For）生命周期回归测试
 *
 * 框架级 bug 修复的回归保障：
 * __flow VNode 的 children 为空数组（真实子节点存于 __flow.children），
 * mount/hydrate 顶层的 invokeLifecycle 只递归 vnode.children，永远到不了
 * 控制流的动态子节点 —— 控制流子组件必须在动态挂载点（mountFlowChild /
 * initFor / initDynamic）就地补发生命周期，否则：
 * - onMounted 不执行（组件 mounted 事件链断裂）
 * - lc._effects 不启动（signal 驱动的 DOM 更新全部失效）
 * - lifecycle.el 不设置、组件 ref 不赋值
 *
 * 同时覆盖 effects 重启语义：Show 卸载→重挂复用同一 VNode（组件 setup
 * 在 h() 中只执行一次），processLifecycleForNode 的 onMounted 分支不清空
 * _effects，重挂时先执行旧 dispose（幂等）再启动新实例 —— 保证重挂后
 * signal 变化仍能驱动 DOM 更新。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  h,
  defineComponent,
  mount,
  Show,
  For,
  signal,
  onEffect,
  useState,
  createTypedStateManager,
} from '@/core';

/**
 * 等待 signals 的异步调度队列 flush
 * preact signals 的 effect 重跑是异步调度的（signal 写入不立即同步通知），
 * 测试中修改 signal 后必须等待一个宏任务再断言 DOM 更新
 */
const flush = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe('控制流（Show）生命周期', () => {
  it('动态挂载的子组件 onMounted 触发，emit 回调可达父组件', () => {
    const container = document.createElement('div');
    /** 子组件 onMounted 执行标记 */
    const childMounted: string[] = [];
    /** 父组件收到的 emit 事件 */
    const received: string[] = [];

    const Child = defineComponent<{
      onChildMounted?: () => void;
    }>((props, lifecycle) => {
      lifecycle.onMounted = () => {
        childMounted.push('run');
        lifecycle.emit?.('childMounted');
      };
      return h('div', { class: 'flow-child' }, 'ok');
    });

    const root = h(
      Show,
      { when: (): boolean => true },
      h(Child, {
        onChildMounted: () => received.push('reached'),
      }),
    );
    mount(root, container);

    // onMounted 执行且 emit 沿 props 回调到达父组件（修复前两者均不触发）
    expect(childMounted).toEqual(['run']);
    expect(received).toEqual(['reached']);
    expect(container.querySelector('.flow-child')).not.toBeNull();
  });

  it('动态挂载的子组件 onEffect 启动：signal 变化异步驱动 DOM 更新', async () => {
    const container = document.createElement('div');
    const textSig = signal<string>('init');

    const Child = defineComponent((props, lifecycle) => {
      const span = h('span', {}, '');
      onEffect(lifecycle, () => {
        const el = span.el;
        if (el instanceof HTMLElement) {
          el.textContent = textSig.value;
        }
      });
      return span;
    });

    mount(h(Show, { when: (): boolean => true }, h(Child, {})), container);

    // onMounted 启动 effects，首跑同步完成初始渲染
    expect(container.querySelector('span')?.textContent).toBe('init');

    // signal 变化 → effect 异步重跑 → DOM 更新（修复前 effect 从未启动）
    textSig.value = 'updated';
    await flush();
    expect(container.querySelector('span')?.textContent).toBe('updated');
  });

  it('卸载→重挂：onMounted 与 onEffect 重启，signal 更新仍驱动 DOM', async () => {
    const container = document.createElement('div');
    const whenSig = signal<boolean>(true);
    const textSig = signal<string>('v1');
    /** 生命周期与 effect 执行顺序记录 */
    const order: string[] = [];

    const Child = defineComponent((props, lifecycle) => {
      const span = h('span', {}, '');
      onEffect(lifecycle, () => {
        order.push('effect');
        const el = span.el;
        if (el instanceof HTMLElement) {
          el.textContent = textSig.value;
        }
      });
      lifecycle.onMounted = () => order.push('mounted');
      lifecycle.onDestroyed = () => order.push('destroyed');
      return span;
    });

    mount(
      h(Show, { when: () => whenSig.value }, h(Child, {})),
      container,
    );

    // 首挂：processLifecycleForNode 先启动 _effects（首跑）再执行 onMounted 钩子
    expect(order).toEqual(['effect', 'mounted']);
    expect(container.querySelector('span')?.textContent).toBe('v1');

    // 卸载：when → false，initShow effect 重跑移除子树并触发 onDestroyed
    whenSig.value = false;
    await flush();
    expect(container.querySelector('span')).toBeNull();
    expect(order).toEqual(['effect', 'mounted', 'destroyed']);

    // 重挂：复用同一 VNode，onMounted 与 effects 必须重启（修复前 effects 永不重启）
    whenSig.value = true;
    await flush();
    expect(order).toEqual([
      'effect', 'mounted', 'destroyed', 'effect', 'mounted',
    ]);
    expect(container.querySelector('span')?.textContent).toBe('v1');

    // 重挂后 effect 存活：signal 变化仍驱动 DOM 更新
    textSig.value = 'v2';
    await flush();
    expect(container.querySelector('span')?.textContent).toBe('v2');
  });

  it('For 列表项动态挂载时同样补发生命周期', async () => {
    const container = document.createElement('div');
    /** 每个列表项的 onMounted 执行计数（key 对应） */
    const mountedKeys: string[] = [];
    const itemsSig = signal<Array<{ key: string }>>([{ key: 'a' }]);

    const Item = defineComponent<{ item: { key: string } }>((props) => {
      return h('li', { class: `item-${props.item.key}` }, props.item.key);
    });

    const ItemWithLifecycle = defineComponent<{ item: { key: string } }>(
      (props, lifecycle) => {
        lifecycle.onMounted = () => mountedKeys.push(props.item.key);
        return h(Item, { item: props.item });
      },
    );

    mount(
      h(For, {
        each: () => itemsSig.value,
        key: (item: { key: string }): string => item.key,
        // render 走 props 不走 children（flow.ts 约定：避免编译器误包装子节点）
        render: (item: { key: string }) => h(ItemWithLifecycle, { item }),
      }),
      container,
    );

    expect(mountedKeys).toEqual(['a']);
    expect(container.querySelector('.item-a')).not.toBeNull();

    // 新 key 进列表：走 initFor 的 new key 分支，onMounted 必须触发
    itemsSig.value = [{ key: 'a' }, { key: 'b' }];
    await flush();
    expect(mountedKeys).toEqual(['a', 'b']);
    expect(container.querySelector('.item-b')).not.toBeNull();
  });

  it('useState 与 onEffect 混用：挂载后订阅存活，Show 卸载→重挂后订阅重建', async () => {
    const container = document.createElement('div');
    const whenSig = signal<boolean>(true);
    /** 与播放器 RuntimeState 同构的类型安全管理器 */
    const state = createTypedStateManager<{ 'app.value': string }>({
      app: { value: 'init' },
    });

    const Child = defineComponent((props, lifecycle) => {
      const span = h('span', {}, '');
      useState(
        state,
        'app.value',
        (next) => {
          const el = span.el;
          if (el instanceof HTMLElement) el.textContent = next;
        },
        lifecycle,
      );
      // 仅为混入 _effects 启用（修复前：onEffect 的重启逻辑会连带清空
      // setup 期收集的 useState 退订，订阅在挂载瞬间即失效）
      onEffect(lifecycle, () => {
        const el = span.el;
        if (el instanceof HTMLElement) {
          el.textContent = state.get('app.value') ?? '';
        }
      });
      return span;
    });

    mount(h(Show, { when: () => whenSig.value }, h(Child, {})), container);
    expect(container.querySelector('span')?.textContent).toBe('init');

    // 挂载后订阅仍活跃（修复前：set 不再驱动 DOM，文本停留在 init）
    state.set('app.value', 'v2');
    await flush();
    expect(container.querySelector('span')?.textContent).toBe('v2');

    // 卸载 → 窗口期内状态变化 → 重挂：订阅重建并以当前值补同步
    whenSig.value = false;
    await flush();
    state.set('app.value', 'v3');
    await flush();
    whenSig.value = true;
    await flush();
    // 补同步捕获卸载窗口期错过的变化（不停留在 setup 旧快照）
    expect(container.querySelector('span')?.textContent).toBe('v3');

    // 重挂后订阅继续存活
    state.set('app.value', 'v4');
    await flush();
    expect(container.querySelector('span')?.textContent).toBe('v4');
  });
});

/**
 * For 区间 diff 回归测试
 *
 * 覆盖头尾同步扫描 + 中间区间 keyed diff + LIS 移动最小化算法：
 * - 同 key 新数组 / 尾部追加 / 中间删除：头尾同步区零操作（不重渲染、不移动 DOM）
 * - 重排：只有不在 LIS 中的复用节点才 insertBefore
 * - 混合变化 / 清空 / 无 keyFn：最终 DOM 顺序正确
 */
describe('控制流（For）区间 diff', () => {
  /**
   * 构建带 key 的字符串列表测试环境
   * @returns container（宿主容器）/ itemsSig（列表 signal）/
   *          renderedKeys（每次 mount 的 render 调用记录）/ order（当前 DOM 顺序）
   */
  const setupList = () => {
    const container = document.createElement('div');
    const itemsSig = signal<string[]>([]);
    /** render 调用过的 key（仅新 mount 追加，复用不调用） */
    const renderedKeys: string[] = [];

    mount(
      h(For, {
        each: () => itemsSig.value,
        key: (item: string): string => item,
        render: (item: string) => {
          renderedKeys.push(item);
          return h('li', { class: `item-${item}` }, item);
        },
      }),
      container,
    );

    /** 读取当前 DOM 顺序（li 文本拼接，如 "a,b,c"） */
    const order = (): string =>
      Array.from(container.querySelectorAll('li'))
        .map((li) => li.textContent)
        .join(',');

    return { container, itemsSig, renderedKeys, order };
  };

  it('首挂载：按顺序渲染全部列表项', async () => {
    const { itemsSig, renderedKeys, order } = setupList();
    itemsSig.value = ['a', 'b', 'c'];
    await flush();
    expect(order()).toBe('a,b,c');
    expect(renderedKeys).toEqual(['a', 'b', 'c']);
  });

  it('同 key 新数组重新赋值：头尾同步全命中，零重渲染零 DOM 移动', async () => {
    const { container, itemsSig, renderedKeys, order } = setupList();
    itemsSig.value = ['a', 'b', 'c', 'd', 'e'];
    await flush();
    expect(renderedKeys.length).toBe(5);

    const insertSpy = vi.spyOn(container, 'insertBefore');
    // 全新数组引用、相同 key 顺序（模拟列表整体重建，如重新拉取同页数据）
    itemsSig.value = ['a', 'b', 'c', 'd', 'e'];
    await flush();

    expect(order()).toBe('a,b,c,d,e');
    expect(renderedKeys.length).toBe(5); // 全部复用，不重新 render
    expect(insertSpy).not.toHaveBeenCalled(); // 头尾同步：零 DOM 移动
    insertSpy.mockRestore();
  });

  it('尾部追加：仅 mount 追加项，已有项零重渲染', async () => {
    const { itemsSig, renderedKeys, order } = setupList();
    itemsSig.value = ['a', 'b', 'c'];
    await flush();
    itemsSig.value = ['a', 'b', 'c', 'd', 'e'];
    await flush();
    expect(order()).toBe('a,b,c,d,e');
    // 只有 d / e 是新 mount，a / b / c 复用
    expect(renderedKeys).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('中间删除：不触发任何 mount，DOM 顺序保持正确', async () => {
    const { itemsSig, renderedKeys, order } = setupList();
    itemsSig.value = ['a', 'b', 'c', 'd', 'e'];
    await flush();
    // 删除中间的 b 和 d（头尾 a...e 同步跳过）
    itemsSig.value = ['a', 'c', 'e'];
    await flush();
    expect(order()).toBe('a,c,e');
    // 没有新 mount，只有 b / d 被 destroy
    expect(renderedKeys).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('重排（末尾移到开头）：非 LIS 节点移动，DOM 顺序正确', async () => {
    const { container, itemsSig, renderedKeys, order } = setupList();
    itemsSig.value = ['a', 'b', 'c', 'd'];
    await flush();
    const insertSpy = vi.spyOn(container, 'insertBefore');
    itemsSig.value = ['d', 'a', 'b', 'c'];
    await flush();
    expect(order()).toBe('d,a,b,c');
    // 全部复用，无重渲染
    expect(renderedKeys.length).toBe(4);
    // LIS = [a,b,c] 原位不动，仅 d 移动 1 次
    expect(insertSpy).toHaveBeenCalledTimes(1);
    insertSpy.mockRestore();
  });

  it('混合变化（删除 + 新增 + 重排）：最终 DOM 顺序与 key 一致', async () => {
    const { itemsSig, order } = setupList();
    itemsSig.value = ['a', 'b', 'c', 'd', 'e'];
    await flush();
    // 删 b / d，新增 x / y，e 移到 x 前面
    itemsSig.value = ['a', 'e', 'x', 'c', 'y'];
    await flush();
    expect(order()).toBe('a,e,x,c,y');
  });

  it('清空列表：全部销毁', async () => {
    const { itemsSig, order } = setupList();
    itemsSig.value = ['a', 'b'];
    await flush();
    itemsSig.value = [];
    await flush();
    expect(order()).toBe('');
  });

  it('无 keyFn（item 引用作 key）：追加时已有项复用', async () => {
    const container = document.createElement('div');
    const itemA = { id: 'a' };
    const itemB = { id: 'b' };
    const itemsSig = signal<Array<{ id: string }>>([itemA]);
    let renderCount = 0;

    mount(
      h(For, {
        each: () => itemsSig.value,
        render: (item: { id: string }) => {
          renderCount += 1;
          return h('li', {}, item.id);
        },
      }),
      container,
    );
    await flush();
    expect(renderCount).toBe(1);

    // itemA 引用未变 → 复用；itemB 新引用 → mount
    itemsSig.value = [itemA, itemB];
    await flush();
    expect(renderCount).toBe(2);
    const texts = Array.from(container.querySelectorAll('li')).map(
      (li) => li.textContent,
    );
    expect(texts).toEqual(['a', 'b']);
  });
});
