/**
 * ============================================
 * 视频播放器核心类型定义模块
 * ============================================
 * 定义播放器所需的所有类型、接口和枚举
 */

import type { Signal } from "../core/signalsCore";

// ============================================
// 虚拟节点相关类型
// ============================================

/**
 * 生命周期钩子接口
 * 定义组件在挂载和销毁时的回调函数
 */
export interface Lifecycle {
  /** 挂载前钩子，在 DOM 插入之前调用 */
  onBeforeMount?: () => void;
  /** 挂载完成钩子，在 DOM 插入之后调用 */
  onMounted?: () => void;
  /** 销毁前钩子，在 DOM 移除之前调用 */
  onBeforeDestroy?: () => void;
  /** 销毁完成钩子，在 DOM 移除之后调用 */
  onDestroyed?: () => void;
}

/**
 * 回调函数类型
 */
export type CallbackFunction = (...args: unknown[]) => void;

/**
 * 组件内部回调接口
 * 允许组件内部触发函数回调通知外部
 */
export interface ComponentCallbacks {
  /** 回调函数映射表 */
  [key: string]: CallbackFunction;
}

/**
 * 类型安全的 emit 函数
 * 根据事件映射 E 约束事件名和 payload 类型
 * E 中值为 undefined 的事件不需要 payload，其他事件需要对应类型的 payload
 * 当 E 为默认 Record<string, unknown> 时，payload 可选（向后兼容）
 */
export type TypedEmit<
  E extends Record<string, unknown> = Record<string, unknown>,
> = <K extends string & keyof E>(
  event: K,
  ...args: E[K] extends undefined ? [] : [payload: E[K]]
) => void;

/**
 * 类型安全的 on 函数
 * 根据事件映射 E 约束事件名和回调参数类型
 */
export type TypedOn<
  E extends Record<string, unknown> = Record<string, unknown>,
> = <K extends string & keyof E>(
  event: K,
  callback: E[K] extends undefined ? () => void : (payload: E[K]) => void,
) => void;

/**
 * 无类型约束的 emit 函数（向后兼容）
 * 事件名为 string，payload 可选
 */
export type UntypedEmit = (event: string, ...args: unknown[]) => void;

/**
 * 无类型约束的 on 函数（向后兼容）
 */
export type UntypedOn = (event: string, callback: CallbackFunction) => void;

/**
 * 扩展的生命周期接口，包含内部回调支持和 API 暴露机制
 * VNode 上存储的无类型版本，组件内部通过 defineComponent 泛型获得类型安全版本
 *
 * el 属性说明：
 *   组件挂载/水合后，框架自动将组件根 DOM 元素赋值给 lifecycle.el
 *   这样组件在 onMounted 钩子中可以通过 lifecycle.el 访问自己的根元素
 *   用于手动 DOM 更新（框架没有响应式，状态变化后需要手动操作 DOM）
 *
 *   与 Vue3 的区别：
 *   - Vue3 有响应式系统，状态变化自动更新 DOM，不需要手动操作
 *   - 本框架没有响应式，状态变化后必须手动更新 DOM
 *   - lifecycle.el 提供了访问组件根元素的能力，使组件能自行处理 DOM 更新
 */
export interface ComponentLifecycle extends Lifecycle {
  /** 组件根 DOM 元素引用，挂载/水合后由框架自动设置 */
  el?: Element;
  /** 内部回调函数映射表 */
  _callbacks?: ComponentCallbacks;
  /** 父组件传入的 ref 引用，挂载后赋值为 _exposed（支持旧 {current} 对象或 Signal） */
  _ref?: Ref<unknown> | Signal<unknown>;
  /** 组件通过 expose() 暴露的 API 对象 */
  _exposed?: unknown;
  /** useState 订阅的取消订阅函数数组（onMounted 启动订阅时收集，销毁时统一调用） */
  _stateCleanups?: Array<() => void>;
  /** useState 订阅启动器列表（useState 收集）：组件 setup 只执行一次，订阅须可重放以支持控制流重挂 */
  _stateSubscriptions?: Array<() => () => void>;
  /** 响应式 effect 启动器列表（onEffect 收集），挂载时统一启动，返回的 dispose 收集到 _effectDisposes */
  _effects?: Array<() => (() => void) | void>;
  /** 响应式 effect 的 dispose 函数数组（挂载时启动收集；与 useState 退订分离，避免误清订阅） */
  _effectDisposes?: Array<() => void>;
  /** 模板引用注册表（useTemplateRef 收集）：字符串 key → 对应的 Signal，销毁时自动清空为 null */
  _templateRefs?: Map<string, Signal<unknown>>;
  /** 注册回调函数 */
  on?: UntypedOn;
  /** 触发回调函数 */
  emit?: UntypedEmit;
  /** 暴露组件 API，供父组件通过 ref.current 访问 */
  expose?: (api: unknown) => void;
}

/**
 * 类型安全的生命周期接口
 * 泛型参数 E 为组件事件映射，约束 emit/on 的事件名和 payload 类型
 * 仅在 defineComponent<P, E> 的 setup 函数参数中使用
 */
export interface TypedComponentLifecycle<
  E extends Record<string, unknown>,
> extends Lifecycle {
  /** 组件根 DOM 元素引用，挂载/水合后由框架自动设置 */
  el?: Element;
  _callbacks?: ComponentCallbacks;
  _ref?: Ref<unknown>;
  _exposed?: unknown;
  _stateCleanups?: Array<() => void>;
  _stateSubscriptions?: Array<() => () => void>;
  _effects?: Array<() => (() => void) | void>;
  _effectDisposes?: Array<() => void>;
  _templateRefs?: Map<string, Signal<unknown>>;
  on?: TypedOn<E>;
  emit?: TypedEmit<E>;
  expose?: (api: unknown) => void;
}

/**
 * 元素引用接口
 * 用于获取组件渲染后的 DOM 元素实例
 *
 * @typeParam T - 引用的元素类型，默认为 Element
 */
export interface Ref<T = Element> {
  /** 当前引用的 DOM 元素，挂载前为 null */
  current: T | null;
}

/**
 * 虚拟节点属性类型
 * 支持 ref 绑定、class、style 及其他 HTML 属性
 */
export interface VNodeAttrs extends Record<string, unknown> {
  /** 元素引用：旧 {current} 对象 / Signal / 字符串模板引用 / 回调，挂载后自动绑定 DOM */
  ref?: Ref<Element> | Signal<Element | null> | string | RefValue;
  /** CSS 类名 */
  class?: string;
  /** 内联样式 */
  style?: Record<string, string | number>;
  /** 响应式属性：key → getter，mount 时注册 effect 自动更新属性值（编译期提取的动态表达式） */
  __reactiveAttrs?: Record<string, () => string>;
}

/**
 * 响应式文本 getter（显式 getter 协议）
 *
 * 在 h() 子节点位置书写零参箭头函数，即声明该子节点为响应式文本：
 * - 编译期：vite-plugin-lumina-compile 将其包装为 _reactiveText(fn)
 * - 运行时（未编译路径）：h() 的 flattenChildren 将其规范化为 __reactive_text VNode
 * - mount 创建 Text 节点并注册 effect，内部读取的 signal 变化时自动更新 textContent
 *
 * 与 Solid 的 {() => expr} 模式一致；用于「返回字符串的函数调用」子节点
 * （如 formatTime(signal.value)）获得响应式能力。
 */
export type ReactiveTextGetter = () => string | number;

/**
 * 虚拟节点子元素类型
 *
 * 注意：函数类型的子节点（ReactiveTextGetter）只在 h() 入口（HChild）被接受，
 * 进入 VNode 树前已被规范化为 __reactive_text VNode，故 children 数组中不出现函数。
 */
export type VNodeChild = VNode | string;

/**
 * 控制流运行时数据
 *
 * 由 For/Show/Switch/Match/Dynamic 控制流组件设置，
 * materialize() 识别 __flow 后创建注释锚点并注册 effect，
 * 动态管理子 DOM 的 mount/destroy/move（key-based 精准更新）。
 *
 * 与 __reactive 处理模式一致：mount 时注册 effect，destroy 时 dispose。
 */
export interface FlowData {
  /** 控制流类型 */
  type: "for" | "show" | "switch" | "dynamic";

  // ===== For 专用字段 =====
  /** 列表数据 getter（返回当前数组） */
  each?: () => readonly unknown[];
  /** key 提取函数，缺省时按 item 引用作为 Map key（Solid <For> 语义） */
  key?: (item: unknown, index: number) => string | number | object;
  /** 渲染函数：(item, index) => VNode，每个 key 只调用一次 */
  render?: (item: unknown, index: number) => VNode;

  // ===== Show 专用字段 =====
  /** 条件 getter（返回 boolean） */
  when?: () => boolean;
  /** 条件为 false 时渲染的 fallback VNode */
  fallback?: VNode;

  // ===== Dynamic 专用字段 =====
  /** 动态组件 getter（返回当前组件，undefined 时无组件） */
  component?: () => Component<unknown> | undefined;
  /** 动态组件的 props */
  props?: Record<string, unknown>;

  // ===== Switch 专用字段 =====
  /** Switch 的分支列表：每项包含 when getter 和 children */
  matches?: Array<{ when: () => boolean; children: VNodeChild[] }>;

  // ===== 子内容（Show 的 content） =====
  /** 子 VNode 或子 VNode 数组（Show 的 content / Switch 的 Match 列表） */
  children?: VNodeChild[];

  // ===== 运行时内部状态（由 mount.ts 的 initFn 维护，destroy 时使用） =====
  /** 当前存活的子 VNode 列表（For 的 key→vnode 映射值，Show 的当前分支等） */
  _alive?: VNode[];
}

/**
 * 虚拟节点接口
 * 描述 DOM 结构的纯数据对象
 */
export interface VNode {
  /** 标签名或组件函数/类 */
  tag: string | Component<unknown>;
  /** 属性对象，包含 HTML 属性、事件、指令等 */
  attrs: VNodeAttrs;
  /** 子节点数组，可以是 VNode 或字符串 */
  children: VNodeChild[];
  /** 挂载后对应的真实 DOM 节点引用（HTMLElement / SVGElement / Text / Comment 锚点） */
  el?: Element | Text | Comment;
  /** 生命周期对象引用（扩展版本，支持内部回调） */
  lifecycle?: ComponentLifecycle;
  /** 清理函数数组，用于移除事件监听和指令 */
  _cleanups?: (() => void)[];
  /** 内部使用的命名空间标记（用于 SVG） */
  __ns?: string;
  /** Context Provider 注入的上下文值列表（由 h() 设置） */
  __providers?: Array<{ contextId: symbol; value: unknown }>;
  /** 父 VNode 引用（由 mount() 设置，用于 useContext 向上查找） */
  __parent?: VNode;
  /** 响应式文本标记：存在时表示这是一个响应式文本节点，mount 时注册 effect 自动更新 textContent */
  __reactive?: { get: () => string };
  /** 控制流标记：For/Show/Switch/Dynamic 的运行时数据，mount 时识别并注册 effect 动态管理子 DOM */
  __flow?: FlowData;
  /** 静态模板标记：编译期模板化的静态子树，mount 直接克隆 DOM，SSR 直拼 html，水合直接采用 SSR DOM */
  __tmpl?: TmplData;
  /**
   * 多根静态模板克隆出的顶层节点列表（仅 roots > 1 时存在，mount/水合两种路径都会填充）
   * destroy 时逐个从 DOM 移除（多根无单一 el 可依赖）
   */
  __tmplRoots?: Node[];
  /** 内部标记：是否已挂载（开发环境检测重复挂载） */
  _mounted?: boolean;
}

/**
 * 静态模板数据（编译期 DOM 化：静态子树 → HTML 字符串 + 运行时 cloneNode）
 *
 * 由 vite-plugin-lumina-compile 的 _tmpl(html, roots) 工厂生成：
 * - mount：调用 clone() 从惰性 <template> 克隆真实 DOM（跳过整棵 VNode 解释）
 * - SSR：renderToString 直接输出 html 字符串（跳过 VNode 序列化）
 * - 水合：不调用 clone，直接采用 SSR 已输出的 DOM 段（零克隆成本）
 */
export interface TmplData {
  /** 模板 HTML 字符串（与 SSR 序列化语义严格一致） */
  html: string;
  /** 顶层节点数（fragment 多根时 > 1，水合时按数跳过兄弟节点） */
  roots: number;
  /** 克隆函数：惰性创建 <template> 后 cloneNode，仅客户端 mount 路径调用 */
  clone: () => Node;
}

// ============================================
// 组件相关类型
// ============================================

/**
 * 函数组件类型
 * 接收 props 返回 VNode 的纯函数
 */
export type FnComponent<P = unknown> = (props: P) => VNode;

/**
 * 从事件映射 E 生成 props 回调类型
 * E 中每个事件 key 'xxx' 生成 'onXxx' 回调属性
 */
export type EventCallbacks<E> = {
  [K in string & keyof E as `on${Capitalize<K>}`]?: E[K] extends undefined
    ? () => void
    : (payload: E[K]) => void;
};

/**
 * 携带暴露 API 和事件类型信息的组件类型
 * P 为 props 类型，E 为事件映射类型
 * __exposed 为编译期类型标记，运行时不存在
 * __events 为编译期事件映射标记，运行时不存在
 */
export type VNodeInternalAttrs = {
  ref?: Ref<unknown> | Signal<unknown> | string;
  __providers?: Array<{ contextId: symbol; value: unknown }>;
};

/**
 * props 的响应式形态：直接值或 Signal
 *
 * h(Comp, { visible: showSignal }) 与 h(Comp, { visible: showSignal.value })
 * 两种写法均合法：前者由 props 代理解包 .value，后者由编译插件包装为
 * _rp thunk 后同样经代理解包。组件内部读取 props.visible 时始终得到当前值，
 * 在 effect / 响应式 getter 中访问即建立信号依赖（细粒度更新，不重渲染组件）。
 */
export type MaybeSignal<T> = T | Signal<T>;

/**
 * 调用侧 attrs 类型的响应式拓宽（仅用于 h() 的 attrs 参数类型）
 *
 * 将 props 类型 P 的每个字段拓宽为 MaybeSignal<P[K]>，组件内部仍接收 P
 * （运行时由 props 代理透明解包，源码中的组件逻辑无需感知 Signal）。
 * P 为非对象类型（unknown / 字符串等）时原样保留，避免 mapped 类型
 * 对原始类型 keyof string 产生方法映射的错误形态。
 */
export type Signalify<P> = P extends object
  ? { [K in keyof P]: MaybeSignal<P[K]> }
  : P;

export type ComponentAttrs<P, E> = E extends void
  ? Signalify<P> & VNodeInternalAttrs
  : Signalify<P> & EventCallbacks<E> & VNodeInternalAttrs;

export type ExposedComponent<P = unknown, E = void> = FnComponent<P> & {
  __exposed?: E;
  __events?: E;
};

/**
 * 从组件类型提取暴露的 API 类型
 * 用于父组件创建 ref 时获取正确的类型提示
 *
 * @example
 * const myRef = ref<ExposedApi<typeof LottieIcon>>();
 */
export type ExposedApi<C> =
  C extends ExposedComponent<unknown, infer E> ? E : never;

/**
 * 类组件构造函数类型
 */
export interface ClassComponent<P = unknown> {
  /** 构造函数签名 */
  new (props: P): ComponentInstance<P>;
}

/**
 * 组件实例接口
 * 类组件必须实现的接口
 */
export interface ComponentInstance<P = unknown> {
  /** 组件接收的属性 */
  props: P;
  /** 组件根元素引用 */
  el?: HTMLElement;
  /** 渲染方法，返回虚拟节点 */
  render(): VNode;
  /** 挂载前生命周期钩子 */
  onBeforeMount?(): void;
  /** 挂载完成生命周期钩子 */
  onMounted?(): void;
  /** 销毁前生命周期钩子 */
  onBeforeDestroy?(): void;
  /** 销毁完成生命周期钩子 */
  onDestroyed?(): void;
}

/**
 * 组件类型联合
 * 可以是函数组件或类组件
 */
export type Component<P = unknown> = FnComponent<P> | ClassComponent<P>;

/**
 * 通用组件类型
 * 用于 h 函数接收任意 props 的组件
 */
export type GenericComponent = FnComponent<unknown> | ClassComponent<unknown>;

// ============================================
// 指令相关类型
// ============================================

/**
 * 指令函数类型
 * 接收元素和值，可选返回清理函数
 */
export type Directive<T = unknown> = (
  el: HTMLElement,
  value: T,
) => (() => void) | void;

/**
 * 指令元组类型
 * 用于在 attrs.directives 中定义指令
 */
export type DirectiveTuple<T = unknown> = [Directive<T>, T];

export type RefValue = (el: Element, vnode?: VNode) => void;

// 定义指令函数的类型
export type DirectiveFn = (el: Element, val: unknown) => void | (() => void);
