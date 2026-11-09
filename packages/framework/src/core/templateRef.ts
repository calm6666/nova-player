/**
 * ============================================
 * 模板引用（useTemplateRef）
 * ============================================
 * 参考 Vue 3.5 的 useTemplateRef 设计：用字符串 key 绑定 DOM，
 * 返回一个响应式 Signal，挂载时自动赋值、销毁时自动清空。
 *
 * 与旧的 ref<T>()（返回 { current } 对象）相比更安全稳定：
 * - 返回 Signal：可与 effect / computed 联动，类型安全
 * - 字符串 key：模板里 h('div', { ref: 'key' })，setup 里 useTemplateRef(lc, 'key')
 * - 自动清理：组件销毁时 Signal 自动置 null，不留悬挂 DOM 引用
 *
 * 用法：
 *   const inputRef = useTemplateRef<HTMLInputElement>(lc, 'input');
 *   onEffect(lc, () => { inputRef.value?.focus(); });
 *   return h('input', { ref: 'input' });
 */

import { signal } from "./signalsCore";
import type { Signal } from "./signalsCore";

/** 判断是否为旧版对象 ref（{ current }） */
export function isRefObject(value: unknown): value is { current: unknown } {
  return typeof value === "object" && value !== null && "current" in value;
}

/** 判断是否为响应式 Signal（自研 signalsCore） */
export function isSignalRef(value: unknown): value is Signal<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof (value as { subscribe?: unknown }).subscribe === "function" &&
    "peek" in value
  );
}

/**
 * 创建一个模板引用 Signal（Vue 3.5 useTemplateRef 风格）
 *
 * - 在 setup 中调用，注册到 lifecycle._templateRefs（按字符串 key）
 * - 模板中对应元素写 `ref: 'key'`，挂载时框架自动把 DOM 赋值到 Signal.value
 * - 组件销毁时框架自动把 Signal.value 清空为 null
 *
 * T 不限制为 Element：DOM 元素 ref 用 `useTemplateRef<HTMLDivElement>(lc, 'x')`，
 * 组件 ref（拿子组件 expose 的 API）用 `useTemplateRef<LottieIconApi>(lc, 'x')`。
 *
 * @param lifecycle - defineComponent setup 的第二个参数（lc）
 *   （仅需 _templateRefs 字段，ComponentLifecycle / TypedComponentLifecycle 均兼容）
 * @param key - 模板引用的字符串 key（需与 h() 中的 ref 字符串一致）
 * @returns 类型安全的 Signal，挂载前/销毁后为 null
 */
export function useTemplateRef<T = Element>(
  lifecycle: { _templateRefs?: Map<string, Signal<unknown>> },
  key: string,
): Signal<T | null> {
  const registry = (lifecycle._templateRefs ??= new Map<
    string,
    Signal<unknown>
  >());
  let sig = registry.get(key);
  if (sig === undefined) {
    sig = signal<T | null>(null);
    registry.set(key, sig);
  }
  return sig as Signal<T | null>;
}
