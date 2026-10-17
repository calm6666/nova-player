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
  type: 'for' | 'show' | 'switch' | 'dynamic';

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

// ============================================
// 播放器状态枚举
// ============================================

/**
 * 播放器状态枚举
 * 表示视频播放的各种状态
 */
export enum PlayerState {
  /** 初始状态，尚未加载 */
  IDLE = "idle",
  /** 正在加载视频 */
  LOADING = "loading",
  /** 已加载，准备播放 */
  READY = "ready",
  /** 正在播放 */
  PLAYING = "playing",
  /** 暂停状态 */
  PAUSED = "paused",
  /** 播放结束 */
  ENDED = "ended",
  /** 发生错误 */
  ERROR = "error",
  /** 正在缓冲 */
  BUFFERING = "buffering",
}

/**
 * 播放模式枚举
 *
 * 说明：单曲循环语义由顶层 `loop: true` 承担，此处不再提供 SINGLE_LOOP。
 */
export enum PlayMode {
  /** 顺序播放 */
  ORDER = "order",
  /** 列表循环 */
  REPEAT_ALL = "repeatAll",
  /** 随机播放 */
  SHUFFLE = "shuffle",
}

import type { Plugin } from "@/nova/core/plugin";
import type { LogLevel } from "@/utils";
import type { MediaManifestSource, QualityLevel } from "@/types/streamPlugin";
// 弹幕 Provider 契约（纯类型，零运行时依赖）
import type {
  DanmakuListProvider,
  DanmakuSendProvider,
  MaskLoader,
} from "@/types/danmaku";
// 阶段 C.1：插槽类型（ControlSlotItem / EndingSlot / SlotContext / ControlSlotPosition）
import type {
  ControlSlotItem,
  EndingSlot,
} from "@/nova/types/slots";
// 沿用 slots.ts 中已定义的同名类型，避免在此重复声明导致类型漂移
export type { ControlSlotItem, EndingSlot } from "@/nova/types/slots";

// ============================================
// 播放器配置接口（命名空间化）
// ============================================
// 依据 docs/player-api-design.md §3.1：
//   - 顶层只保留资源类三项（container / src / poster）
//   - 其余按功能分组为命名空间，便于深度合并与运行时动态更新
// ============================================

/**
 * 深层可选：把某个值的可空联合展开为「可选」
 * - 数组整体替换（保留元素原类型，不逐元素深可选）
 * - 函数原样保留（避免把回调映射成空对象）
 * - 非纯对象的联合（如 `HTMLElement | string`）原样保留
 */
type OptionalOf<V> = undefined extends V ? undefined : never;

type DeepPartialValue<V> = NonNullable<V> extends (...args: never[]) => unknown
  ? V
  : NonNullable<V> extends readonly (infer U)[]
    ? OptionalOf<V> | U[]
    : string extends keyof NonNullable<V>
      ? V
      : NonNullable<V> extends object
        ? | OptionalOf<V>
          | {
              [K in keyof NonNullable<V>]?: DeepPartialValue<NonNullable<V>[K]>;
            }
        : V;

/**
 * 深层可选类型
 *
 * 用于「用户输入配置」：嵌套命名空间可部分传参。
 */
export type DeepPartial<T> = {
  [K in keyof T]?: DeepPartialValue<T[K]>;
};

/**
 * 视频源
 * - `string`：单个 URL
 * - `ProgressiveVariant[]`：渐进式（MP4）多清晰度变体，**仅 MP4 使用**
 * - `MediaManifestSource`：HLS/DASH 的清单对象（对象注入模式）
 */
export type PlayerSource = string | ProgressiveVariant[] | MediaManifestSource;

/**
 * 清晰度选择模式
 * - `auto`：自适应（HLS/DASH 走 ABR；MP4 取默认档）
 * - `manual`：用户显式指定档位
 */
export type QualityMode = 'auto' | 'manual';

/**
 * 画面显示模式
 * - `normal`：普通
 * - `web`：网页全屏
 * - `wide`：宽屏
 * - `mini`：迷你播放器
 */
export type DisplayMode = 'normal' | 'web' | 'wide' | 'mini';

/**
 * 播放列表条目
 * 复用同一 video 元素与整棵 DOM 换源时使用
 */
export interface MediaItem {
  /** 条目唯一标识 */
  id?: string;
  /** 视频源 */
  src: PlayerSource;
  /** 条目标题 */
  title?: string;
  /** 条目封面图 */
  poster?: string;
  /** 起播时间（秒） */
  startTime?: number;
  /** 该条目的弹幕地址 */
  danmakuUrl?: string;
  /** 该条目的字幕轨道列表 */
  subtitleList?: SubtitleConfig[];
}

/**
 * 播放行为配置
 * 键名沿用 HTMLMediaElement 惯例
 */
export interface PlaybackConfig {
  /** 自动播放 */
  autoplay?: boolean;
  /** 初始静音 */
  muted?: boolean;
  /** 初始音量 (0-1) */
  volume?: number;
  /** 初始倍速 */
  playbackRate?: number;
  /** 是否循环播放（单曲循环语义由此承担） */
  loop?: boolean;
  /** 播放模式（列表连播策略） */
  playMode?: PlayMode;
  /** 镜像画面（水平翻转） */
  mirror?: boolean;
  /** 音量均衡模式（0 关闭 / 1 标准 / 2 高动态） */
  loudness?: number;
  /** 播完暂停（不自动切集，对应 handoff=2） */
  pauseAfterEnd?: boolean;
  /** 预加载策略 */
  preload?: 'none' | 'metadata' | 'auto';
  /** 移动端内联播放 */
  playsinline?: boolean;
  /** 起播时间（秒），续播场景 */
  startTime?: number;
}

/**
 * 快捷键步长配置
 * 支持把 `keyboard` 从布尔升级为对象形式
 */
export interface KeyboardStepConfig {
  /** 方向键快进/快退步长（秒） */
  seekStep?: number;
  /** 方向键音量步长 (0-1) */
  volumeStep?: number;
  /** 长按加速倍率 */
  holdRate?: number;
}

/**
 * UI 外观与控件配置
 */
export interface UiConfig {
  /** 播放器名称（原 playerName），用于 aria-label / 日志 */
  title?: string;
  /** 控制条开关（单一来源） */
  controls?: ControlsConfig;
  /**
   * 控制栏插槽列表
   *
   * 阶段 C.2：每项按 position 注入对应位置，按 order 升序排列。
   * 框架无响应式：列表在挂载期读取一次，运行时变更需通过 setConfig 重渲染。
   */
  slots?: ControlSlotItem[];
}

/**
 * 交互配置
 */
export interface InteractionConfig {
  /** 快捷键：布尔开关，或对象形式配置步长 */
  keyboard?: boolean | KeyboardStepConfig;
}

/**
 * 清晰度配置
 */
export interface QualityConfig {
  /** 默认画质（档位 id，或 'auto'） */
  default?: string;
  /** 选择模式 */
  mode?: QualityMode;
  /** 清晰度上限（像素高度） */
  max?: number;
  /** 清晰度下限（像素高度） */
  min?: number;
  /** 自定义菜单文案，按档位 id 索引 */
  labels?: Record<string, string>;
}

/**
 * 进度条预览帧（预览图 Provider 的返回值）
 *
 * 由外部开发者实现获取逻辑（雪碧图裁切 / 逐帧 URL / 服务端接口皆可），
 * 播放器只消费 url 与可选样式字段，不做任何数据获取。
 */
export interface ProgressPreviewFrame {
  /** 图片地址（普通 URL 或 data URL） */
  url: string;
  /** 雪碧图模式：裁切窗口宽（如 '160px'）；逐帧模式缺省 */
  width?: string;
  /** 雪碧图模式：裁切窗口高（如 '90px'）；逐帧模式缺省 */
  height?: string;
  /** 雪碧图模式：img 的 object-fit 样式（'none'）；逐帧模式缺省 */
  objectFit?: string;
  /** 雪碧图模式：img 的 object-position 样式（如 '-320px -90px'）；逐帧模式缺省 */
  objectPosition?: string;
}

/**
 * 预览图提供者
 *
 * 进度条悬停时按「悬停时间 + 总时长」询问外部预览帧，
 * 支持同步或异步（Promise）返回；null 表示该时间点无预览。
 */
export type ProgressPreviewProvider = (
  time: number,
  duration: number,
) => ProgressPreviewFrame | null | Promise<ProgressPreviewFrame | null>;

/**
 * 高能进度条数据（外部 energyProvider 的返回值）
 *
 * 纯数据结构：播放器内部只做「采样点 → SVG 曲线」的纯换算，
 * 数据获取（接口请求 / 归一化）由外部完成。
 */
export interface EnergyProgressData {
  /** 采样间隔（秒） */
  stepSec: number;
  /** 采样点（0-1，首点对应 0 秒） */
  data: number[];
  /** 总时长（秒），用于把播放进度换算成采样点下标 */
  duration?: number;
}

/**
 * 高能进度条数据提供者
 *
 * 支持同步或异步（Promise）返回；null 表示无高能数据（不绘制曲线）。
 */
export type EnergyProgressProvider =
  | (() => EnergyProgressData | null)
  | (() => Promise<EnergyProgressData | null>);

/**
 * 进度条配置
 */
export interface ProgressConfig {
  /** 进度条分段数据 */
  segments?: ProgressSegment[];
  /**
   * 预览图提供者（进度条悬停时按时间获取预览帧）
   *
   * 数据获取逻辑由外部实现（如雪碧图下标裁切、逐帧 URL、服务端接口），
   * 播放器不内置任何预览数据获取。
   */
  previewProvider?: ProgressPreviewProvider;
  /** 高能进度条数据提供者（外部获取，播放器只负责绘制曲线） */
  energyProvider?: EnergyProgressProvider;
}

/**
 * 弹幕配置（命名空间形态）
 */
export interface DanmakuConfigSpace {
  /** 是否启用弹幕能力 */
  enabled?: boolean;
  /**
   * 弹幕数据提供者（推荐，与 progress.previewProvider 同一模式）
   *
   * 数据获取逻辑（接口请求 / 本地过滤 / 分片缓存）由外部实现，
   * 播放器按 30 秒时间窗分段调用；配置了 provider 时优先于 url。
   */
  provider?: DanmakuListProvider;
  /**
   * 弹幕数据源 URL（便捷通道）
   *
   * 指向 JSON 数组（DanmakuItem[]）；播放器内部将其包装为一次性拉取的 provider，
   * 与 provider 同时配置时以 provider 为准。
   */
  url?: string;
  /**
   * 弹幕发送确认提供者（服务端确认模式）
   *
   * 配置后：面板提交 → 外部确认（服务器校验/落库）→ 返回确认弹幕才上屏；
   * 缺省：本地直接上屏。等价于 DanmakuPlugin({ callbacks: { onSend } })。
   */
  onSend?: DanmakuSendProvider;
  /** 是否显示弹幕 */
  visible?: boolean;
  /** 弹幕透明度 (0-1) */
  opacity?: number;
  /** 弹幕速度倍率 */
  speed?: number;
  /** 字号（px） */
  fontSize?: number;
  /** 显示区域占比 (0-1) */
  area?: number;
  /**
   * 弹幕智能防挡配置（开发者可选外部遮罩或本地语义分割）
   *
   * 开关由用户在弹幕设置面板控制（持久化 danmakuSettings.maskEnabled）；
   * 开启时优先使用 provider（外部传入遮罩），未配置 provider 则懒加载
   * 本地 MediaPipe 语义分割（动态 import 独立 chunk + Web Worker 推理，
   * 用户未开启不下载模型，不阻塞主线程）
   */
  mask?: DanmakuMaskOptions;
}

/**
 * 弹幕智能防挡选项
 */
export interface DanmakuMaskOptions {
  /**
   * 外部遮罩提供者（与字幕 provider 同一模式，优先于本地分割）
   *
   * 播放器按遮罩更新间隔调用，外部返回当前时间的遮罩图
   * （SVG/PNG data URL 或图片 URL）或 clearMask 清除
   */
  provider?: MaskLoader;
  /**
   * 本地语义分割模型配置（未配置 provider 时启用）
   *
   * modelUrl 指向 tflite 模型（默认本地
   * /mediapipe/models/selfie_multiclass_256x256.tflite，
   * 可替换为 CDN：https://storage.googleapis.com/mediapipe-models/
   * image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite）
   */
  localModel?: {
    /** 分割模型 tflite 地址 */
    modelUrl?: string;
    /** 置信度阈值（默认 0.25） */
    threshold?: number;
  };
}

/**
 * 字幕配置（命名空间形态）
 */
export interface SubtitleConfigSpace {
  /** 是否启用字幕 */
  enabled?: boolean;
  /** 字幕轨道列表（原 subtitles） */
  list?: SubtitleConfig[];
  /** 字幕样式增量 patch（字幕菜单初值快照，与字幕插件共享同一来源） */
  style?: Record<string, unknown>;
}

/**
 * 插件配置
 */
export interface PluginsConfig {
  /** 插件实例列表 */
  list?: Plugin[];
  /** 按插件名索引的插件选项 */
  options?: Record<string, unknown>;
}

/**
 * 持久化配置
 */
export interface StorageConfig {
  /** 是否启用持久化 */
  enabled?: boolean;
  /** localStorage 键前缀 */
  prefix?: string;
}

/**
 * SSR 配置（命名空间形态）
 */
export interface SsrConfig {
  /** 是否启用 SSR 模式 */
  enabled?: boolean;
  /** SSR 占位符 HTML */
  placeholder?: string;
  /** 是否延迟 hydration */
  deferHydration?: boolean;
}

/**
 * 高级配置
 */
export interface AdvancedConfig {
  /** 日志级别 */
  logLevel?: LogLevel;
  /** 调试模式（等价 logLevel: 'debug'） */
  debug?: boolean;
}

/**
 * i18n 国际化配置
 *
 * 独立定义以避免公共类型文件导入业务逻辑（core/i18n.ts）。
 * 结构与 core/i18n.ts 的 I18nConfig 保持一致。
 */
export interface I18nPlayerConfig {
  /** 是否启用 i18n（默认 false，未启用时 t() 走零开销路径） */
  enabled?: boolean;
  /** 初始语言（默认 'en-US'） */
  locale?: string;
  /** fallback 语言（默认 'en-US'） */
  fallbackLocale?: string;
  /** 初始语言包映射（locale → { key → text }，结构与 core/i18n.ts 的 I18nConfig.messages 一致） */
  messages?: Record<string, Record<string, string>>;
}

/**
 * 播放器配置（命名空间形态）
 *
 * 顶层只保留资源类三项，其余按功能分组。
 * 这是「配置可动态更新」的对外类型，`mergePlayerConfig` 会与默认值深度合并。
 */
export type PlayerConfig = {
  // ── 资源（顶层）──
  /** 容器元素或选择器 */
  container?: HTMLElement | string;
  /** 视频源 */
  src?: PlayerSource;
  /** 封面图 URL */
  poster?: string;

  // ── 分组 ──
  /** 播放行为 */
  playback?: PlaybackConfig;
  /** 播放列表（复用 DOM 换视频用） */
  playlist?: MediaItem[];
  /** 初始播放第几个 */
  playlistIndex?: number;
  /** 外观与控件 */
  ui?: UiConfig;
  /** 交互与快捷键 */
  interaction?: InteractionConfig;
  /** 清晰度 */
  quality?: QualityConfig;
  /** 进度条 */
  progress?: ProgressConfig;
  /**
   * 弹幕 / 字幕配置（命名空间形态）
   *
   * 阶段 B.2：弹幕与字幕的运行时能力由 DanmakuPlugin / SubtitlePlugin 提供，
   * 默认配置不再包含 danmaku / subtitle 顶层字段。下列可选字段保留是为兼容
   * 旧调用方在配置层传递弹幕 URL / 字幕轨道列表（normalizePlaylist 会读取），
   * 以及 setSubtitleList / setDanmakuSource 等运行时 API 写回props 之用。
   */
  danmaku?: DanmakuConfigSpace;
  /** 字幕配置（命名空间形态，与 danmaku 同理保留） */
  subtitle?: SubtitleConfigSpace;
  /** 插件 */
  plugins?: PluginsConfig;
  /** 持久化 */
  storage?: StorageConfig;
  /** SSR */
  ssr?: SsrConfig;
  /** 高级 */
  advanced?: AdvancedConfig;
  /**
   * 片尾页面插槽
   *
   * 阶段 C.2：传入 ending.content 即整页替换默认 Ending 组件渲染。
   */
  ending?: EndingSlot;
  /** 配置式事件回调 */
  callbacks?: EventListeners;
  /** i18n 国际化配置（未配置时 t() 走零开销英文字面量路径） */
  i18n?: I18nPlayerConfig;
};

/**
 * 旧「扁平」配置形态
 *
 * 仅用于兼容层 `normalizeConfig()` 的输入类型描述，
 * 表示历史版本直接写在顶层的配置键。新代码请使用 `PlayerConfig`。
 */
export interface LegacyPlayerConfig {
  /** 容器元素或选择器 */
  container?: HTMLElement | string;
  /** 视频源（含旧的 string[] 备用源写法） */
  src?: string | string[] | ProgressiveVariant[];
  /** 封面图 URL */
  poster?: string;
  /** 自动播放 */
  autoplay?: boolean;
  /** 默认静音 */
  muted?: boolean;
  /** 默认音量 (0-1) */
  volume?: number;
  /** 默认播放速度 */
  playbackRate?: number;
  /** 是否循环播放 */
  loop?: boolean;
  /** 播放模式 */
  playMode?: PlayMode;
  /** 预加载策略 */
  preload?: 'none' | 'metadata' | 'auto';
  /** 移动端内联播放 */
  playsinline?: boolean;
  /** 控制条配置（旧键名之一） */
  controls?: ControlsConfig;
  /** 控制条配置（更早的旧键名） */
  controlBtns?: ControlsConfig;
  /** 默认画质（档位 id） */
  defaultQuality?: string;
  /** 是否启用键盘快捷键 */
  keyboard?: boolean | KeyboardStepConfig;
  /** 视频进度条分段 */
  progressSegments?: ProgressSegment[];
  /** 播放器名称 */
  playerName?: string;
  /** 字幕轨道列表 */
  subtitles?: SubtitleConfig[];
  /** 弹幕配置（兼容旧的 `source` 字段） */
  danmaku?: DanmakuConfigSpace & { source?: string };
  /** SSR 配置 */
  ssr?: SSRConfig;
  /** 插件列表 */
  plugins?: Plugin[];
  /** 是否开启调试模式 */
  debug?: boolean;
  /** 事件回调函数 */
  callbacks?: EventListeners;
}

/**
 * 控制条配置
 *
 * 由原 `ControlBtnConfig`（对外配置）与运行时 `ControlConfig` 合并而来，
 * 是控件开关的唯一类型来源。控件键与状态/事件名对齐（`wideScreen` / `webFullscreen`）。
 */
export interface ControlsConfig {
  /** 上一个分 P 按钮 */
  prev?: boolean;
  /** 下一个分 P 按钮 */
  next?: boolean;
  /** 看点按钮 */
  viewpoint?: boolean;
  /** 清晰度菜单 */
  quality?: boolean;
  /** 选集菜单 */
  episodes?: boolean;
  /** 设置菜单 */
  setting?: boolean;
  /** 画中画按钮 */
  pip?: boolean;
  /** 宽屏按钮 */
  wideScreen?: boolean;
  /** 网页全屏按钮 */
  webFullscreen?: boolean;
  /** 进度条分段（运行时从配置透传给控制条） */
  progressSegments?: ProgressSegment[];
}

/**
 * 进度条分段数据
 */
export interface ProgressSegment {
  /** 分段起始时间（秒） */
  startTime: number;
  /** 分段结束时间（秒） */
  endTime: number;
  /**分段DOM元素 */
  element?: HTMLDivElement;
  /** 缓冲进度条DOM元素*/
  bufferElement?: HTMLDivElement;
  /** 视频播放进度条DOM元素 */
  currentElement?: HTMLDivElement;
  /** 分段阴影元素（用于显示预览图等） */
  shadowElement?: HTMLDivElement;
  /** 阴影缓冲进度条DOM元素 */
  shadowBufferElement?: HTMLDivElement;
  /** 阴影视频播放进度条DOM元素 */
  shadowCurrentElement?: HTMLDivElement;
  /** 阴影文本元素（用于显示时间预览等） */
  shadowTextElement?: HTMLDivElement;
  /** 分段文本描述 */
  label: string;
}

/**
 * SSR 配置接口
 * 用于服务端渲染时的配置选项
 */
export interface SSRConfig {
  /** 是否启用 SSR 模式 */
  enabled: boolean;
  /** SSR 占位符 HTML */
  placeholder?: string;
  /** 是否延迟 hydration */
  deferHydration?: boolean;
}

/**
 * 渐进式（MP4）清晰度变体
 *
 * ⚠️ 仅 MP4 多文件场景需要手填；HLS/DASH 的清晰度由 manifest 在运行时发现，不要传。
 * `height` 与 `label` 至少提供其一（都缺时开发环境会打印警告）。
 */
export interface ProgressiveVariant {
  /** 视频 URL */
  url: string;
  /** 显示名称（不传则由 height 推导） */
  label?: string;
  /** 视频宽度（像素） */
  width?: number;
  /** 视频高度（像素），既是标识也是排序依据 */
  height?: number;
  /** 视频码率（bps） */
  bitrate?: number;
  /** 档位标识（可选，默认用数组索引） */
  quality?: string;
}

/**
 * 字幕配置
 */
export interface SubtitleConfig {
  /** 字幕语言代码 */
  lang: string;
  /** 显示名称 */
  label: string;
  /** 字幕文件 URL (WebVTT 格式) */
  url: string;
  /** 是否默认启用 */
  isDefault?: boolean;
}

/**
 * 弹幕配置
 */
export interface DanmakuConfig {
  /** 是否启用弹幕 */
  enabled: boolean;
  /** 弹幕数据源 URL 或 WebSocket 地址 */
  url: string;
  /** 弹幕透明度 (0-1) */
  opacity?: number;
  /** 弹幕速度倍率 */
  speed?: number;
  /** 是否显示弹幕 */
  visible?: boolean;
}

// ============================================
// 播放器事件接口
// ============================================

/**
 * 播放器事件映射
 * 定义所有可监听的事件及其回调参数
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PlayerEvents extends Record<string, (...args: any[]) => void> {
  /** 播放器初始化完成 */
  ready: () => void;
  /** 播放开始 */
  play: () => void;
  /** 播放暂停 */
  pause: () => void;
  /** 播放结束 */
  ended: () => void;
  /** 播放进度更新 */
  timeupdate: (currentTime: number, duration: number) => void;
  /** 音量变化 */
  volumechange: (volume: number, muted: boolean) => void;
  /** 播放速度变化 */
  ratechange: (rate: number) => void;
  /** 画质切换 */
  qualitychange: (quality: string) => void;
  /** 进入全屏 */
  fullscreenchange: (isFullscreen: boolean) => void;
  /** 进入画中画 */
  pipchange: (isPip: boolean) => void;
  /** 缓冲状态变化 */
  waiting: () => void;
  /** 缓冲完成，可以继续播放 */
  canplay: () => void;
  /**
   * 已可播放至结尾（契约事件 `canPlayThrough`，直连内部总线）
   *
   * 注意与上面的 `canplay` 不是同一事件：`canplay` 由契约 `canPlay` 桥接而来，
   * 本条对应契约的 `canPlayThrough`，语义为「整个媒体可以播完而不中断」。
   */
  canPlayThrough: () => void;
  /** 加载进度更新 */
  progress: (buffered: TimeRanges) => void;
  /** 发生错误 */
  error: (error: MediaError) => void;
  /** 状态变化 */
  statechange: (state: PlayerState) => void;
  /** 点击播放器 */
  click: (event: MouseEvent) => void;
  /** 双击播放器 */
  dblclick: (event: MouseEvent) => void;

  // ===== HTML5 媒体元素标准事件（与 video 元素一一对应） =====
  /** 加载被中止（用户主动中断 / 切换源） */
  abort: () => void;
  /** 媒体时长变化 */
  durationchange: (duration: number) => void;
  /** 媒体被清空（重新加载前触发） */
  emptied: () => void;
  /** 首帧数据加载完成（readyState 达到 HAVE_CURRENT_DATA） */
  loadeddata: () => void;
  /** 媒体元数据加载完成（duration 可用） */
  loadedmetadata: (duration: number) => void;
  /** 开始加载媒体 */
  loadstart: () => void;
  /** 实际开始播放（缓冲结束后，与 play 区分） */
  playing: () => void;
  /** 跳转完成 */
  seeked: (currentTime: number) => void;
  /** 跳转开始 */
  seeking: (currentTime: number) => void;
  /** 数据停滞（网络/磁盘长时间无数据） */
  stalled: () => void;
  /** 浏览器主动暂停加载（非错误） */
  suspend: () => void;

  // ===== 以下为「总线直连」事件 =====
  // 这些事件在内部 TypedEventBus 上以 camelCase 键发射，未经桥接适配，
  // player.on('qualityListChange', cb) 会直接订阅总线，payload 即下列对象。
  // 命名与 core/events.ts 的 PlayerEventMap 保持一致，改动时需同步两处。

  /** 播放器被销毁 */
  destroy: () => void;
  /** 播放器尺寸变化 */
  resize: (width: number, height: number) => void;
  /** 用户提交了弹幕（发送栏触发；弹幕内容经 danmakuSend 传递） */
  sendDanmaku: () => void;

  // 生命周期
  /** 播放器挂载完成 */
  mounted: (payload: {
    container?: HTMLElement;
    video?: HTMLVideoElement;
    sendingArea?: HTMLElement;
  }) => void;
  /** 已从持久化存储恢复上次观看位置 */
  restoreProgress: (payload: { time: number }) => void;

  // 媒体属性
  /** 静音状态变化 */
  mutedChange: (muted: boolean) => void;
  /** 跳转开始 */
  seekStart: (payload: { time: number; previousTime: number }) => void;
  /** 跳转结束 */
  seekEnd: (payload: { time: number; previousTime: number }) => void;

  // 清晰度
  /** 清晰度列表就绪 / 变化 */
  qualityListChange: (payload: {
    qualities: QualityLevel[];
    mode: 'none' | 'static' | 'adaptive';
  }) => void;
  /** 清晰度切换已请求（切换中） */
  qualityChangeRequested: (payload: { from: string; to: string; label?: string }) => void;
  /** 清晰度切换成功 */
  qualityChangeRendered: (payload: {
    from: string;
    to: string;
    quality?: QualityLevel;
    elapsed: number;
  }) => void;
  /** 清晰度切换失败 */
  qualityChangeFailed: (payload: { from: string; to: string; reason: string }) => void;
  /** 清晰度模式变化 */
  qualityModeChange: (payload: { mode: 'auto' | 'manual' }) => void;

  // 画面模式
  /** 网页全屏状态变化 */
  webFullscreenChange: (payload: { isWebFullscreen: boolean }) => void;
  /** 宽屏状态变化 */
  wideScreenChange: (payload: { isWideScreen: boolean }) => void;
  /**
   * 显示模式变化
   *
   * 阶段 D.1：normal / web / wide / mini 之间的切换会触发，
   * 与 webFullscreenChange / wideScreenChange 同时发出（互不替代）。
   */
  displayModeChange: (payload: { mode: DisplayMode }) => void;

  // 错误
  /** 错误恢复 */
  errorRecovery: () => void;

  // 弹幕
  /** 弹幕显隐变化 */
  danmakuToggle: (payload: { visible: boolean }) => void;
  /** 弹幕数据加载完成 */
  danmakuLoaded: (payload: { count: number; url?: string }) => void;
  /** 弹幕透明度变化 */
  danmakuOpacityChange: (opacity: number) => void;
  /** 弹幕速度变化 */
  danmakuSpeedChange: (speed: number) => void;
  /** 请求发送弹幕 */
  danmakuSend: (payload: { text: string; options?: Record<string, unknown> }) => void;
  /** 弹幕发送成功 */
  danmakuSent: (payload: Record<string, unknown>) => void;
  /** 弹幕清空 */
  danmakuClear: () => void;

  // 字幕
  /** 字幕显隐变化 */
  subtitleToggle: (payload: { visible: boolean }) => void;
  /** 字幕语言变化 */
  subtitleLangChange: (lang: string) => void;
  /** 字幕切换 */
  subtitleSwitch: (payload: { lang: string }) => void;
  /**
   * 字幕列表变化
   * - count：字幕条数（loading / error 时为 0）
   * - status：AI 字幕加载状态（可选，未提供则表示普通列表更新）
   *   - 'loading'：AI 字幕请求中
   *   - 'ready'：AI 字幕已就绪
   *   - 'error'：AI 字幕加载失败
   */
  subtitleListChange: (payload: { count: number; status?: 'loading' | 'ready' | 'error' }) => void;

  // 播放列表 / 多 P
  /** 当前播放条目变化 */
  episodeChange: (payload: {
    index: number;
    total: number;
    id?: string;
    title?: string;
  }) => void;
  /** 播放列表本身变化 */
  playlistChange: (payload: { index: number; total: number }) => void;
  /** 请求播放上一个 */
  prevRequest: () => void;
  /** 请求播放下一个 */
  nextRequest: () => void;

  // 互动
  /** 互动：点赞 */
  interactionLike: () => void;
  /** 互动：投币 */
  interactionCoin: () => void;
  /** 互动：收藏 */
  interactionCollect: () => void;
  /** 互动：关注 */
  interactionFollow: () => void;
  /** 互动：外链点击 */
  interactionLinkClick: () => void;
  /** 互动：投票选择 */
  interactionVoteSelect: (payload: { voteIndex: number; optionIndex: number }) => void;
  /** 互动：评分选择 */
  interactionScoreSelect: (payload: { scoreIndex: number; value: number }) => void;
  /** 互动：卡片关闭 */
  interactionCardClose: (payload: { type: string; index: number }) => void;
  /** 互动：卡片位置变化 */
  interactionPositionChange: (payload: {
    type: string;
    index: number;
    top: number;
    left: number;
  }) => void;

  // 流媒体
  /** 流媒体错误 */
  streamError: (payload: { message?: string; error?: unknown }) => void;
  /** 流媒体清晰度变化（自动或手动切换） */
  streamQualityChange: (payload: {
    width: number;
    height: number;
    bitrate?: number;
    isAuto?: boolean;
    qualityId?: string;
    label?: string;
  }) => void;
}

/**
 * 播放器状态数据
 * 当前播放器的完整状态快照
 */
export interface PlayerStateData {
  /** 当前播放状态 */
  state: PlayerState;
  /** 当前播放时间（秒） */
  currentTime: number;
  /** 视频总时长（秒） */
  duration: number;
  /** 当前音量 (0-1) */
  volume: number;
  /** 是否静音 */
  muted: boolean;
  /** 当前播放速度 */
  playbackRate: number;
  /** 当前画质（档位 id） */
  quality: string;
  /** 是否全屏 */
  isFullscreen: boolean;
  /** 是否画中画 */
  isPip: boolean;
  /** 缓冲范围 */
  buffered: TimeRanges | null;
  /** 视频宽高比 */
  aspectRatio: number;
}

// ============================================
// UI 组件属性接口
// ============================================

/**
 * 进度条组件属性
 */
export interface ProgressBarProps {
  /** 当前时间 */
  currentTime: number;
  /** 总时长（用于显示） */
  duration: number;
  /** 获取最新总时长的回调（用于计算，解决响应式问题） */
  getDuration?: () => number;
  /** 缓冲范围 */
  buffered: TimeRanges | null;
  /** 是否正在拖拽 */
  isDragging?: boolean;
  /** 进度变化回调 */
  onChange: (time: number) => void;
  /** 开始拖拽回调 */
  onDragStart?: () => void;
  /** 结束拖拽回调 */
  onDragEnd?: () => void;
}

/**
 * 音量控制组件属性
 */
export interface VolumeProps {
  /** 当前音量 (0-1) */
  volume: number;
  /** 是否静音 */
  muted: boolean;
  /** 音量变化回调 */
  onChange: (volume: number, muted: boolean) => void;
  /** 静音切换回调 */
  onMuteToggle?: () => void;
  /** 音量条显示回调 */
  onShow?: () => void;
  /** 音量条隐藏回调 */
  onHide?: () => void;
}

/**
 * 播放按钮组件属性
 */
export interface PlayButtonProps {
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 当前播放状态 */
  state: PlayerState;
  /** 点击回调 */
  onClick: () => void;
  /** 鼠标进入回调 */
  onMouseEnter?: () => void;
  /** 鼠标离开回调 */
  onMouseLeave?: () => void;
  /** 获得焦点回调 */
  onFocus?: () => void;
  /** 失去焦点回调 */
  onBlur?: () => void;
}

/**
 * 时间显示组件属性
 */
export interface TimeDisplayProps {
  /** 当前时间（秒） */
  currentTime: number;
  /** 总时长（秒） */
  duration: number;
  /** 点击回调（可用于切换剩余时间显示） */
  onClick?: () => void;
  /** 鼠标进入回调 */
  onMouseEnter?: () => void;
  /** 鼠标离开回调 */
  onMouseLeave?: () => void;
}

/**
 * 加载动画组件属性
 */
export interface LoadingProps {
  /** 是否显示 */
  visible: boolean;
  /** 加载提示文字 */
  text?: string;
  /** 显示回调 */
  onShow?: () => void;
  /** 隐藏回调 */
  onHide?: () => void;
}

/**
 * 错误提示组件属性
 */
export interface ErrorProps {
  /** 错误代码 */
  code: number;
  /** 错误信息 */
  message: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 显示回调 */
  onShow?: () => void;
  /** 关闭回调 */
  onClose?: () => void;
}

/**
 * 画质选择组件属性
 */
export interface QualitySelectorProps {
  /** 当前画质（档位 id） */
  current: string;
  /** 可用画质列表 */
  qualities: ProgressiveVariant[];
  /** 画质切换回调 */
  onChange: (quality: string) => void;
  /** 下拉菜单打开回调 */
  onOpen?: () => void;
  /** 下拉菜单关闭回调 */
  onClose?: () => void;
}

/**
 * 控制条组件属性
 */
export interface ControlBarProps {
  /** 是否显示 */
  visible: boolean;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 当前时间 */
  currentTime: number;
  /** 总时长 */
  duration: number;
  /** 缓冲范围 */
  buffered: TimeRanges | null;
  /** 当前音量 */
  volume: number;
  /** 是否静音 */
  muted: boolean;
  /** 播放速度 */
  playbackRate: number;
  /** 当前画质（档位 id） */
  quality: string;
  /** 可用画质列表 */
  qualities: ProgressiveVariant[];
  /** 播放模式 */
  playMode: PlayMode;
  /** 是否全屏 */
  isFullscreen: boolean;
  /** 播放/暂停回调 */
  onPlayPause: () => void;
  /** 进度跳转回调 */
  onSeek: (time: number) => void;
  /** 开始拖拽进度条回调 */
  onSeekStart?: () => void;
  /** 结束拖拽进度条回调 */
  onSeekEnd?: () => void;
  /** 获取最新总时长（用于解决响应式问题） */
  getDuration?: () => number;
  /** 音量变化回调 */
  onVolumeChange: (volume: number, muted: boolean) => void;
  /** 速度变化回调 */
  onRateChange: (rate: number) => void;
  /** 画质切换回调 */
  onQualityChange: (quality: string) => void;
  /** 播放模式切换回调 */
  onPlayModeChange: (mode: PlayMode) => void;
  /** 全屏切换回调 */
  onFullscreenToggle: () => void;
  /** 画中画切换回调 */
  onPipToggle: () => void;
  /** 鼠标进入控制条回调 */
  onMouseEnter?: () => void;
  /** 鼠标离开控制条回调 */
  onMouseLeave?: () => void;
  /** 设置按钮点击回调 */
  onSettingsClick?: () => void;
  /** 字幕按钮点击回调 */
  onSubtitleClick?: () => void;
  /** 弹幕按钮点击回调 */
  onDanmakuClick?: () => void;
}

// ============================================
// 工具类型
// ============================================

/**
 * 事件监听器映射类型
 */
export type EventListeners = {
  [K in keyof PlayerEvents]?: PlayerEvents[K];
};

/**
 * 播放器方法接口
 * 播放器实例暴露的所有方法
 */
export interface PlayerMethods {
  // ===== 播放控制 =====
  /** 播放视频 */
  play(): Promise<void>;
  /** 暂停视频 */
  pause(): void;
  /** 切换播放/暂停 */
  toggle(): void;
  /** 跳转到指定时间 */
  seek(time: number): void;
  /** 相对当前位置跳转 */
  seekBy(delta: number): void;
  /** 重新加载当前源 */
  reload(): void;

  // ===== 音量 / 倍速 / 播放模式 =====
  /** 设置音量 */
  setVolume(volume: number): void;
  /** 获取音量 */
  getVolume(): number;
  /** 切换静音 */
  toggleMute(): void;
  /** 设置静音 */
  setMuted(muted: boolean): void;
  /** 是否静音 */
  isMuted(): boolean;
  /** 设置播放速度 */
  setPlaybackRate(rate: number): void;
  /** 获取播放速度 */
  getPlaybackRate(): number;
  /** 设置单曲循环 */
  setLoop(loop: boolean): void;
  /** 设置播放模式 */
  setPlayMode(mode: PlayMode): void;

  // ===== 显示模式 =====
  /** 切换全屏 */
  toggleFullscreen(): Promise<void>;
  /** 进入全屏 */
  enterFullscreen(): Promise<void>;
  /** 退出全屏 */
  exitFullscreen(): Promise<void>;
  /** 是否全屏 */
  isFullscreen(): boolean;
  /** 切换画中画 */
  togglePip(): Promise<void>;
  /** 进入画中画 */
  enterPip(): Promise<void>;
  /** 退出画中画 */
  exitPip(): Promise<void>;
  /** 切换网页全屏 */
  toggleWebFullscreen(): void;
  /** 是否网页全屏 */
  isWebFullscreen(): boolean;
  /** 切换宽屏 */
  toggleWideScreen(): void;
  /** 设置显示模式 */
  setDisplayMode(mode: DisplayMode): void;
  /** 重新计算尺寸 */
  resize(): void;

  // ===== 清晰度 =====
  /** 切换画质（档位 id，'auto' 表示自动档） */
  setQuality(quality: string): void;
  /** 获取当前档位 id */
  getCurrentQuality(): string;
  /** 获取可用档位列表 */
  getQualities(): QualityLevel[];
  /** 获取清晰度能力类型 */
  getQualityMode(): 'none' | 'static' | 'adaptive';
  /** 设置清晰度模式（自动 / 手动） */
  setQualityMode(mode: QualityMode): void;
  /** 应用清晰度上下限 */
  applyQualityLimits(limits: { max?: number; min?: number }): void;

  // ===== 媒体加载与播放列表 =====
  /** 换源加载（复用同一 video 元素与 DOM） */
  load(
    source: PlayerSource,
    options?: { startTime?: number; autoplay?: boolean },
  ): Promise<void>;
  /** 播放列表内跳转到指定索引 */
  switchTo(index: number): Promise<void>;
  /** 播放下一个 */
  next(): Promise<void>;
  /** 播放上一个 */
  prev(): Promise<void>;
  /** 获取播放列表 */
  getPlaylist(): readonly MediaItem[];
  /** 获取当前条目索引 */
  getCurrentIndex(): number;
  /** 设置封面 */
  setPoster(url: string): void;

  // ===== 弹幕 =====
  /** 设置弹幕可见性 */
  setDanmakuVisible(visible: boolean): void;
  /** 切换弹幕可见性，返回切换后的状态 */
  toggleDanmaku(): boolean;
  /** 弹幕是否可见 */
  isDanmakuVisible(): boolean;
  /** 设置弹幕不透明度 */
  setDanmakuOpacity(opacity: number): void;
  /** 设置弹幕速度倍率 */
  setDanmakuSpeed(speed: number): void;
  /** 设置弹幕数据源 */
  setDanmakuSource(url: string): void;
  /** 清空弹幕 */
  clearDanmaku(): void;
  /** 发送弹幕 */
  sendDanmaku(text: string, options?: Record<string, unknown>): void;

  // ===== 字幕 =====
  /** 设置字幕可见性 */
  setSubtitleVisible(visible: boolean): void;
  /** 切换字幕可见性，返回切换后的状态 */
  toggleSubtitle(): boolean;
  /** 设置字幕语言 */
  setSubtitleLang(lang: string): void;
  /** 设置字幕轨道列表 */
  setSubtitleList(list: SubtitleConfig[]): void;

  // ===== 状态查询 =====
  /** 获取播放器状态快照 */
  getState(): PlayerStateData;
  /** 获取当前时间（秒） */
  getCurrentTime(): number;
  /** 获取总时长（秒） */
  getDuration(): number;
  /** 获取缓冲进度（秒） */
  getBuffered(): number;
  /** 是否暂停中 */
  isPaused(): boolean;
  /** 是否正在播放 */
  isPlaying(): boolean;

  // ===== 配置 =====
  /** 读取当前生效配置 */
  getConfig(): Readonly<PlayerConfig>;
  /** 动态更新配置（深合并并立即生效） */
  setConfig(partial: DeepPartial<PlayerConfig>): void;

  // ===== 生命周期与插件 =====
  /** 挂载到容器 */
  mount(container: HTMLElement): void;
  /** 取渲染用 VNode（SSR / 内嵌） */
  render(): VNode;
  /** 客户端激活（复用服务端结构） */
  hydrate(container: HTMLElement): void;
  /** 安装插件（可链式） */
  use(plugin: Plugin): PlayerMethods;
  /** 卸载插件 */
  uninstallPlugin(name: string): void;
  /** 按名字取插件实例 */
  getPlugin<T extends Plugin>(name: string): T | undefined;
  /** 按名字取插件向播放器暴露的 API */
  getPluginAPI<T extends Plugin>(name: string): T | undefined;
  /** 销毁播放器 */
  destroy(): void;

  // ===== 事件订阅 =====
  /** 注册事件监听，返回取消订阅函数 */
  on<K extends keyof PlayerEvents>(event: K, callback: PlayerEvents[K]): () => void;
  /** 注册只触发一次的监听，返回取消订阅函数 */
  once<K extends keyof PlayerEvents>(event: K, callback: PlayerEvents[K]): () => void;
  /** 移除事件监听 */
  off<K extends keyof PlayerEvents>(event: K, callback: PlayerEvents[K]): void;
}

export type RefValue = (el: Element, vnode?: VNode) => void;

// 定义指令函数的类型
export type DirectiveFn = (el: Element, val: unknown) => void | (() => void);
