/**
 * ============================================
 * 子组件统一卸载入口
 * ============================================
 *
 * 框架契约（types/index.ts 的 ComponentLifecycle）只有
 * onBeforeMount / onMounted / onBeforeDestroy / onDestroyed 四个时机钩子，
 * 子组件自行申请的 DOM 监听、定时器、ResizeObserver / IntersectionObserver、
 * 模板 ref 等资源没有统一的提前释放入口 —— 只能挂在 onBeforeDestroy 上，
 * 而 onBeforeDestroy 由 core/mount.ts 的 destroy(vnode) 在「移除 DOM 的同一次遍历」
 * 中触发，播放器无法在「组件卸载完毕且 DOM 仍在」与「插件销毁 / DOM 移除」之间插桩。
 *
 * 本模块在不改动 ComponentLifecycle 字段契约的前提下补上这一入口：
 * - useComponentUnmount(lifecycle, fn)：组件注册自己的卸载函数（可多次调用，按注册顺序执行）；
 * - teardownComponentTree(vnode)：从最深子组件逐层向上到根，依次执行并清空注册表，
 *   同一 lifecycle 只会执行一次（幂等）。
 *
 * 组件的 onBeforeDestroy 契约保持不变；但卸载函数必须幂等 —— 播放器 destroy 会先走
 * 本入口，随后 core 的 destroy(vnode) 会再触发一次 onBeforeDestroy。
 */

import type { VNode } from '@lumina/framework/types';

/**
 * lifecycle 参数沿用 useTemplateRef 的结构化最小类型写法：
 * ComponentLifecycle 与 TypedComponentLifecycle 都能直接传入，不引入函数参数逆变问题。
 */
const unmountRegistry = new WeakMap<object, Array<() => void>>();

/**
 * 注册组件的统一卸载函数
 *
 * @param lifecycle - 组件生命周期对象（defineComponent setup 的第二个参数）
 * @param fn - 卸载函数（必须幂等）
 */
export function useComponentUnmount(lifecycle: object, fn: () => void): void {
  const list = unmountRegistry.get(lifecycle);
  if (list) {
    list.push(fn);
    return;
  }
  unmountRegistry.set(lifecycle, [fn]);
}

/**
 * 从最深子组件逐层向上到根执行卸载函数
 *
 * 遍历顺序为「先递归全部子节点，再处理当前节点」，与 Vue 的 unmount 一致，
 * 保证父组件卸载时子组件已经释放完毕。DOM 不在此处移除（由 core/mount.ts 的
 * destroy(vnode) 在插件与流中间件销毁之后统一移除）。
 *
 * @param vnode - 组件树根虚拟节点
 */
export function teardownComponentTree(vnode: VNode | string): void {
  if (typeof vnode === 'string') return;

  for (const child of vnode.children) {
    teardownComponentTree(child);
  }

  const lifecycle = vnode.lifecycle;
  if (!lifecycle) return;

  const list = unmountRegistry.get(lifecycle);
  if (!list) return;

  unmountRegistry.delete(lifecycle);
  for (const fn of list) {
    fn();
  }
}
