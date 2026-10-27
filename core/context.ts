/**
 * ============================================
 * Context 上下文系统
 * ============================================
 * 提供跨组件层级的数据传递机制，避免 props 逐层穿透
 *
 * 设计思路（类似 React Context 但更轻量）：
 *   1. createContext<T>() 创建一个 Context 对象，包含唯一标识符
 *   2. Provider 组件通过 h() 的 __providers 属性注入上下文值
 *   3. useContext(ctx) 从当前 VNode 向上查找最近的 Provider 值
 *
 * 与 React Context 的区别：
 *   - 没有 Consumer 组件，直接用 useContext() 函数获取
 *   - Provider 不是独立组件，而是 h() 的内置属性
 *   - 无响应式更新，Context 值变化不会自动触发子组件重渲染
 *     （本项目没有虚拟 DOM 和响应式系统，所有 DOM 操作手动完成）
 *
 * 工作原理：
 *   h() 创建组件 VNode 时：
 *     1. 将当前 __currentVNode 设为新 VNode 的 __parent
 *     2. 调用 setCurrentVNode(newVNode)
 *     3. 执行组件 setup 函数（此时 useContext 可沿 __parent 链查找 Provider）
 *     4. 恢复 setCurrentVNode 为之前的值
 */

import type { VNode } from "@/types";
import { isSignalRef } from "./templateRef";

/**
 * Context 对象
 * 泛型参数 T 为上下文值的类型
 */
export interface Context<T> {
  /** 唯一标识符，用于在 Provider 链中匹配 */
  readonly id: symbol;
  /** 默认值，当没有 Provider 时使用 */
  readonly defaultValue: T;
  /**
   * 是否响应式上下文
   *
   * 为 true 时 Provider 的 value 可以是「取值函数」（() => T），
   * useContext 返回惰性 Proxy：每次读取字段都重新求值并解包 Signal，
   * 在 effect / 响应式 getter 中读取即自动建立依赖（值变化精准更新 DOM）。
   */
  readonly reactive?: boolean;
  /** 响应式上下文的默认取值函数（无 Provider 时使用） */
  readonly resolve?: () => T;
}

/**
 * Provider 注入的上下文值
 * 存储在 VNode.__providers 中
 */
export interface ProviderEntry {
  /** Context 对象的唯一标识符 */
  contextId: symbol;
  /** Provider 提供的值 */
  value: unknown;
}

/**
 * 带类型的 Provider 注入条目
 * 与 ProviderEntry 的区别：value 具有泛型类型 T，而非 unknown
 * 用于 createContext<T>().provide() 等需要类型安全的场景
 * 内部使用时会通过 as T 将 unknown 转为具体类型（框架核心不可消除的 as）
 */
export interface TypedProviderEntry<T> {
  /** Context 对象的唯一标识符，与 Context.id 对应 */
  contextId: symbol;
  /** Provider 提供的值，类型由泛型 T 确定 */
  value: T;
}

/**
 * 创建一个 Context 对象
 *
 * @param defaultValue - 当没有 Provider 时 useContext 返回的默认值
 * @returns Context 对象
 *
 * @example
 * const StateContext = createContext<TypedStateManager<PlayerStateMap> | null>(null);
 *
 * // 在父组件中提供值
 * h('div', { __providers: [{ contextId: StateContext.id, value: state }] }, children)
 *
 * // 在子组件中使用
 * const state = useContext(StateContext);
 */
export function createContext<T>(defaultValue: T): Context<T> {
  return {
    id: Symbol("context"),
    defaultValue,
  };
}

/**
 * 创建响应式 Context
 *
 * 与 createContext 的区别：Provider 传入的值可以是取值函数
 * `() => T`（内部可读取 signal），useContext 返回惰性 Proxy，
 * 字段读取发生在 effect 中时自动追踪依赖，实现「上下文值变化 → 精准更新」。
 *
 * 约束：响应式上下文的 T 必须是对象（Proxy 无法代理原始值）；
 * 原始值场景请使用 createContext 或在对象中包一层字段。
 *
 * @param resolve - 默认取值函数（无 Provider 时使用）
 * @param defaultValue - 可选默认值（不传时用 resolve() 求值一次）
 * @returns 响应式 Context 对象
 *
 * @example
 * const ConfigContext = createReactiveContext<ControlsConfig>(() => defaultControlConfig);
 * provide([{ contextId: ConfigContext.id, value: () => store.config }], () => h(Child, {}));
 * // Child: const config = useContext(ConfigContext); h('span', {}, () => config.title)
 */
export function createReactiveContext<T extends object>(
  resolve: () => T,
  defaultValue?: T,
): Context<T> {
  return {
    id: Symbol("lumina.context"),
    reactive: true,
    resolve,
    defaultValue: defaultValue ?? resolve(),
  };
}

/** 响应式上下文 Proxy 的 get trap：每次读取都重新求值并解包 Signal */
function reactiveContextHandler<T extends object>(
  read: () => T,
): ProxyHandler<object> {
  const source = (): T => read();
  return {
    get(_target, key): unknown {
      const value = Reflect.get(source(), key);
      // 字段为 Signal 时自动解包，效果与 reactiveProps 一致
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return isSignalRef(value) ? value.value : value;
    },
    has(_target, key): boolean {
      return Reflect.has(source(), key);
    },
    ownKeys(): ArrayLike<string | symbol> {
      return Reflect.ownKeys(source());
    },
    getOwnPropertyDescriptor(_target, key): PropertyDescriptor | undefined {
      const descriptor = Reflect.getOwnPropertyDescriptor(source(), key);
      return descriptor === undefined
        ? undefined
        : { ...descriptor, configurable: true };
    },
  };
}

/**
 * 把响应式上下文值包装为惰性 Proxy
 *
 * @param raw - Provider 原始值（取值函数或对象）
 * @param fallback - 无 Provider 时的默认取值函数
 */
function wrapReactiveContext<T extends object>(
  raw: unknown,
  fallback: () => T,
): T {
  const read = (): T => {
    if (typeof raw === "function") return (raw as () => T)();
    if (raw !== undefined) return raw as T;
    return fallback();
  };
  return new Proxy({}, reactiveContextHandler(read)) as T;
}

/**
 * 从当前 VNode 向上查找最近的 Provider 值
 * 遍历 VNode 链上的 __providers，找到匹配 contextId 的值
 * 如果 __parent 链上未找到，则查找全局 Provider 栈（由 provide() 函数维护）
 *
 * @param context - 要查找的 Context 对象
 * @returns Provider 提供的值，如果没有 Provider 则返回默认值
 *
 * @example
 * const state = useContext(StateContext);
 * if (state) {
 *   useState(state, PlayerStateKeyEnum.VOLUME, (newVol) => { ... }, lifecycle);
 * }
 */
export function useContext<T>(context: Context<T>): T {
  const raw = findContextValue(context);
  if (context.reactive) {
    // 响应式上下文：惰性 Proxy（对象字段读取时求值 + 解包 Signal）
    const fallback = context.resolve ?? ((): T => context.defaultValue);
    return wrapReactiveContext<T & object>(
      raw,
      fallback as () => T & object,
    ) as T;
  }
  return raw ?? context.defaultValue;
}

/** 查找 Provider 原始值（沿 VNode 链 + 全局 Provider 栈） */
function findContextValue<T>(context: Context<T>): T | undefined {
  const currentVNode = __currentVNode;
  if (currentVNode) {
    let vnode: VNode | undefined = currentVNode;
    while (vnode) {
      if (vnode.__providers) {
        const entry = findProvider<T>(vnode.__providers, context.id);
        if (entry !== undefined) {
          return entry;
        }
      }
      vnode = vnode.__parent;
    }
  }

  /**
   * 查找全局 Provider 栈
   * Provider 栈由 provide() 函数维护，解决元素级 __providers 的时序问题：
   * h('div', { __providers: [...] }, h(Child, ...)) 中，
   * h(Child, ...) 在 h('div', ...) 之前求值，此时 div 的 __providers 还未设置。
   * provide() 函数在子组件求值前将 providers 推入栈，求值后弹出，
   * 这样 useContext 可以在 __parent 链查找失败后，从栈中找到 Provider。
   */ for (let i = __providerStack.length - 1; i >= 0; i--) {
    const providers = __providerStack[i];
    const entry = findProvider<T>(providers, context.id);
    if (entry !== undefined) {
      return entry;
    }
  }

  return undefined;
}

function findProvider<T>(
  providers: ProviderEntry[],
  contextId: symbol,
): T | undefined {
  const entry = providers.find((p) => p.contextId === contextId);
  if (entry) {
    return entry.value as T;
  }
  return undefined;
}

/**
 * 当前正在处理的 VNode（由 h() 和 defineComponent 维护）
 * useContext 通过此变量获取当前 VNode 位置
 */
let __currentVNode: VNode | undefined;

/**
 * 待注入的 Provider 列表
 * h() 在调用组件函数前设置，defineComponent 在创建 contextVNode 时消费
 * 解决 __providers 时序问题：h() 设置 __providers 在 defineComponent 返回之后，
 * 但 useContext 在 defineComponent 内部 setup 执行时就需要沿 __parent 链找到 Provider
 */
let __pendingProviders: ProviderEntry[] | undefined;

/**
 * 全局 Provider 栈
 * 解决元素级 __providers 的时序问题：
 * h('div', { __providers: [...] }, h(Child, ...)) 中，
 * h(Child, ...) 在 h('div', ...) 之前求值（JavaScript 函数参数求值顺序），
 * 此时 div 的 __providers 还未设置到 __currentVNode 链上。
 * provide() 函数在子组件求值前将 providers 推入栈，useContext 可以从栈中查找。
 */
const __providerStack: ProviderEntry[][] = [];

export function setCurrentVNode(vnode: VNode | undefined): void {
  __currentVNode = vnode;
}

export function getCurrentVNode(): VNode | undefined {
  return __currentVNode;
}

export function setPendingProviders(
  providers: ProviderEntry[] | undefined,
): void {
  __pendingProviders = providers;
}

export function getPendingProviders(): ProviderEntry[] | undefined {
  return __pendingProviders;
}

/**
 * Provider 栈最大深度限制
 * 防止无限递归导致栈溢出
 */
const MAX_PROVIDER_STACK_DEPTH = 100;

export function pushProviderStack(providers: ProviderEntry[]): void {
  if (__providerStack.length >= MAX_PROVIDER_STACK_DEPTH) {
    throw new Error(
      `[Lumina/context] Provider stack depth exceeded maximum limit ${MAX_PROVIDER_STACK_DEPTH}, possible infinite recursion`,
    );
  }
  __providerStack.push(providers);
}

export function popProviderStack(): void {
  __providerStack.pop();
}

/**
 * Provider 辅助函数
 * 在求值子组件前将 providers 推入全局 Provider 栈，求值后弹出
 * 解决 h('div', { __providers: [...] }, h(Child, ...)) 的时序问题：
 * JavaScript 函数参数求值顺序导致子组件在父元素创建前就已求值，
 * useContext 无法沿 __parent 链找到元素上的 __providers。
 * provide() 通过全局栈在子组件求值前注入 Provider，确保 useContext 可以找到。
 *
 * @param providers - 要注入的 Provider 列表
 * @param childFn - 返回子 VNode 的惰性函数（thunk）
 * @returns 子 VNode
 *
 * @example
 * // 替代 h('div', { __providers: [...] }, h(ThemedText, ...))
 * h('div', { class: 'wrapper' },
 *   provide(
 *     [{ contextId: ThemeContext.id, value: { color: 'blue' } }],
 *     () => h(ThemedText, { text: 'Hello' })
 *   )
 * )
 */
export function provide(
  providers: ProviderEntry[],
  childFn: () => VNode,
): VNode {
  __providerStack.push(providers);
  try {
    return childFn();
  } finally {
    __providerStack.pop();
  }
}

/**
 * 保存当前 Context 状态快照
 * 用于 SSR 批量处理多个请求时隔离上下文状态
 * JS 单线程不会真正并发，但 SSR 批量处理时全局状态可能残留
 *
 * @returns 当前全局状态的快照
 */
export function saveContext(): {
  currentVNode: VNode | undefined;
  pendingProviders: ProviderEntry[] | undefined;
  providerStack: ProviderEntry[][];
} {
  return {
    currentVNode: __currentVNode,
    pendingProviders: __pendingProviders,
    providerStack: [...__providerStack],
  };
}

/**
 * 恢复 Context 状态快照
 * 与 saveContext 配合使用，确保 SSR 批量处理时上下文隔离
 *
 * @param snapshot - saveContext 返回的快照
 */
export function restoreContext(snapshot: {
  currentVNode: VNode | undefined;
  pendingProviders: ProviderEntry[] | undefined;
  providerStack: ProviderEntry[][];
}): void {
  __currentVNode = snapshot.currentVNode;
  __pendingProviders = snapshot.pendingProviders;
  __providerStack.length = 0;
  __providerStack.push(...snapshot.providerStack);
}
