/**
 * ============================================
 * 组件 props 响应式（props 惰性代理）
 * ============================================
 * 让函数/类组件的 props 支持细粒度响应式（Solid 模型）：
 *
 * 背景：h() / _createComp 调用组件函数是一次性的（setup 只执行一次），
 * 传参表达式在调用时被立即求值为快照，子组件无法感知后续变化。
 *
 * 机制：调用组件前检测 props 值——
 *   1. 直接传入的 Signal：每次访问惰性读取 .value
 *   2. 编译插件包装的 _rp thunk（动态表达式的惰性求值体）：每次访问调用
 * 两类值存在时任一即把 props 包装为 Proxy；组件内部在 effect / 响应式
 * getter 中读取 props.x 时，读取动作穿透到 signal，自动建立依赖。
 *
 * 无响应式值时原样返回（零代理开销），完全向后兼容：
 * 普通值、事件回调（onXxx）、回调函数 props 均按原语义透传。
 *
 * 注意：控制流组件（For/Show/Switch/Match/Dynamic）不走此代理——
 * 它们的 each/when/component 按「Signal / getter / 值」三形态由 toGetter
 * 消费，需要拿到 Signal/getter 本体而非解包值（见 core/flow.ts）。
 */

import { isSignalRef } from "./templateRef";

/**
 * _rp thunk 标记表（WeakSet<object>，键为函数对象）
 *
 * 编译插件将组件动态 prop 表达式包装为 _rp(() => expr)，经 WeakSet 标记后
 * 与普通函数值（事件回调、render 回调、手写 getter 协议等）严格区分：
 * 代理只调用带标记的 thunk，绝不误调普通回调函数。
 * WeakSet 随闭包被 GC，无泄漏风险。
 * （键类型用 object：typeof 窄化产生的 Function 类型与具体函数签名不兼容）
 */
const REACTIVE_PROP_GETTERS = new WeakSet<object>();

/**
 * 标记响应式 prop getter（编译期转换专用入口）
 *
 * 编译期转换：h(Comp, { visible: showSignal.value })
 *   → _createComp(Comp, { visible: _rp(() => (showSignal.value)) })
 *
 * thunk 对求值透明：调用即返回表达式当前值（若结果为 Signal 则由
 * props 代理继续解包 .value，覆盖 h(Comp, { visible: showSignal })
 * 直接传 Signal 的编译形态）。
 *
 * @param getter - 动态 prop 表达式的惰性求值体（应为纯表达式）
 * @returns 原函数（已标记）
 */
export function _rp<T>(getter: () => T): () => T {
  REACTIVE_PROP_GETTERS.add(getter);
  return getter;
}

/**
 * 类型谓词：判断值是否为 _rp 标记的响应式 prop getter
 */
export function isReactivePropGetter(value: unknown): value is () => unknown {
  return typeof value === "function" && REACTIVE_PROP_GETTERS.has(value);
}

/**
 * props 惰性代理的 get trap
 *
 * 读取语义（每次访问都重新求值，保证 effect 内建立最新依赖）：
 * - _rp thunk → 调用求值，结果为 Signal 则继续解包 .value
 * - 直接传入的 Signal → 解包 .value
 * - 其余（普通值/事件回调/普通函数）→ 原样返回
 */
const reactivePropsHandler: ProxyHandler<Record<string, unknown>> = {
  get(target, key) {
    // Reflect.get 同时兼容 string / symbol 键（如展开时的内部协议访问）
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const value = Reflect.get(target, key);
    if (isReactivePropGetter(value)) {
      const resolved = value();
      return isSignalRef(resolved) ? resolved.value : resolved;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return isSignalRef(value) ? value.value : value;
  },
};

/**
 * 检测并包装响应式 props（组件调用前的统一入口）
 *
 * 单次遍历检测是否存在 Signal / _rp thunk：存在则返回惰性 Proxy，
 * 不存在则原样返回（绝大多数全静态 props 的组件零开销直通）。
 *
 * @param props - 已构建完成的组件 props（含 children）
 * @returns 原对象或惰性代理
 */
export function maybeReactiveProps<P extends Record<string, unknown>>(props: P): P {
  for (const key in props) {
    const value = props[key];
    if (isSignalRef(value) || isReactivePropGetter(value)) {
      // 显式指定 Proxy 泛型为 P（按 target 锁定；handler 的 get trap 以
      // Record<string, unknown> 宽形态书写，参数逆变兼容 P 的约束）
      return new Proxy<P>(props, reactivePropsHandler);
    }
  }
  return props;
}
