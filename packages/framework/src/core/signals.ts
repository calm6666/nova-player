/**
 * 响应式信号（基于自研 signalsCore）
 *
 * 框架采用「挂载一次 + effect 手动更新 DOM」的模型，signals 是 useState
 * 订阅模型（path 字符串 + updater）的通用超集：
 * - signal / computed：响应式变量，读 `.value` 建立依赖
 * - effect：依赖变化时自动重跑（首次同步执行，返回 dispose 函数）
 * - onEffect：把 effect 绑定到组件生命周期（挂载/水合后启动、销毁时自动清理）
 *
 * 用法：
 *   const count = signal(0);
 *   onEffect(lc, () => { elRef.current!.textContent = String(count.value); });
 *
 * prop 传响应式变量：
 *   props 是引用传递、无解包（h() 不做 unwrap/proxy），
 *   父组件 h(Child, { count }) 直接把 signal 对象传给子组件，
 *   子组件在 effect 里读 props.count.value 自动追踪。
 */

import { effect } from "./signalsCore";

// 再导出核心原语
export {
  signal,
  computed,
  effect,
  batch,
  untracked,
} from "./signalsCore";

// 再导出类型（Signal 是类、ReadonlySignal 是接口，均仅作类型使用）
export type { Signal, ReadonlySignal } from "./signalsCore";

/**
 * 在组件生命周期内启动响应式 effect
 *
 * - 挂载/水合后（onMounted）启动：此时 ref.current / lifecycle.el 已就绪
 * - effect 首次同步执行，完成初始渲染
 * - 组件销毁时自动 dispose（收集到 lifecycle._effectDisposes）
 *
 * 注意：只在 effect 内部读取 `.value` 才会建立依赖；
 * setup 里直接读 `.value` 是快照，不会被追踪。
 *
 * @param lifecycle - defineComponent setup 的第二个参数（lc）
 *   （仅需 _effects 字段，ComponentLifecycle / TypedComponentLifecycle 均兼容）
 * @param fn - 响应式更新函数（内部读取 signal/computed 建立依赖）
 */
export function onEffect(
  lifecycle: { _effects?: Array<() => (() => void) | void> },
  fn: () => void,
): void {
  const effects = (lifecycle._effects ??= []);
  effects.push(() => effect(fn));
}
