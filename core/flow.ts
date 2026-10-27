/**
 * 响应式控制流组件
 *
 * 设计要点：
 * - For/Show/Switch/Match/Dynamic 均为函数组件，返回带 __flow 标记的 VNode
 * - materialize() 识别 __flow 后创建注释锚点 + 注册 effect + 动态管理子 DOM
 * - destroy() 识别 __flow 后 dispose effect + 销毁动态子 VNode
 * - 与现有 __reactive 处理模式完全一致（mount.ts 的 __reactive 分支）
 *
 * 列表精准更新算法（For）：
 * - 维护 Map<key, { vnode, el, index }>
 * - 新 key：调用 render → materialize → insertBefore(anchor)
 * - 移除 key：destroy(vnode) → Map.delete
 * - 移动 key：insertBefore 重排（不重建 vnode）
 * - 现有 key：不重新 render，依赖内部 signal 更新（真正的细粒度响应式）
 *
 * 注意：render 函数走 props 不走 children，避免编译器把
 * ArrowFunctionExpression 子节点误包装为 _reactiveText。
 */

import type { VNode, VNodeChild, Component } from "@/types";
import { isSignalRef } from "./templateRef";

// ============================================
// 类型谓词（避免 as 断言）
// ============================================

/**
 * 类型谓词：判断值是否为 getter 函数 () => unknown
 *
 * 用于区分 each/when/component 的 Signal / getter / 值 三种形态
 */
function isGetterFn(value: unknown): value is () => unknown {
  return typeof value === "function";
}

/**
 * 类型谓词：判断值是否为 render 函数 (item, index) => VNode
 */
function isRenderFn(
  value: unknown,
): value is (item: unknown, index: number) => VNode {
  return typeof value === "function";
}

/**
 * 类型谓词：判断值是否为 key 提取函数
 */
function isKeyFn(
  value: unknown,
): value is (item: unknown, index: number) => string | number | object {
  return typeof value === "function";
}

/**
 * 类型谓词：判断值是否为 VNode
 *
 * VNode 必须是对象且有 tag/attrs/children 三个字段
 */
function isVNode(value: unknown): value is VNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "tag" in value &&
    "attrs" in value &&
    "children" in value
  );
}

/**
 * 类型谓词：判断值是否为 VNode 数组
 */
function isVNodeArray(value: unknown): value is VNodeChild[] {
  return Array.isArray(value);
}

/**
 * 类型谓词：判断值是否为组件（函数或类构造器）
 * 用于 Dynamic 组件的 component getter
 */
function isComponent(value: unknown): value is Component<unknown> {
  return typeof value === "function";
}

// ============================================
// 工具：Signal / getter / 值 → 统一 getter
// ============================================

/**
 * 将 Signal / getter 函数 / 值 转换为统一的 getter 函数
 *
 * - Signal（有 .value/.subscribe/.peek）→ () => signal.value
 * - getter 函数 → 直接返回
 * - 普通值 → () => value
 *
 * effect 内调用 getter 会自动追踪 signal 依赖
 */
function toGetter(value: unknown): () => unknown {
  // Signal 检测：isSignalRef 是已有类型谓词，返回 value is Signal<unknown>
  // 读取 .value 得到 unknown，正好是 getter 的返回类型
  if (isSignalRef(value)) {
    return () => value.value;
  }
  if (isGetterFn(value)) {
    return value;
  }
  return () => value;
}

// ============================================
// For 组件 — key-based 列表精准更新
// ============================================

/**
 * For 组件 — key-based 列表精准更新
 *
 * API（Solid 风格，render 走 props 不走 children）：
 *   h(For, {
 *     each: itemsSignal,                          // Signal<T[]> | (() => T[]) | T[]
 *     key: (item, index) => item.id,              // 可选，缺省按引用 diff
 *     render: (item, index) => h('li', {}, item)  // 每个 key 只调用一次
 *   })
 *
 * 精准更新：
 * - 新 key：render → materialize → insertBefore
 * - 移除 key：destroy(vnode)
 * - 移动 key：insertBefore 重排（不重建 vnode）
 * - 现有 key：不重渲染，依赖内部 signal 更新
 */
export function For(props: Record<string, unknown>): VNode {
  const eachGetter = toGetter(props.each);
  const keyFn = isKeyFn(props.key) ? props.key : undefined;
  const renderFn = isRenderFn(props.render) ? props.render : undefined;

  return {
    tag: "__flow",
    attrs: {},
    children: [],
    __flow: {
      type: "for",
      each: (): readonly unknown[] => {
        const arr = eachGetter();
        return Array.isArray(arr) ? arr : [];
      },
      key: keyFn,
      render: renderFn,
    },
  };
}

// ============================================
// Show 组件 — 条件渲染
// ============================================

/**
 * Show 组件 — 条件渲染
 *
 * API：
 *   h(Show, { when: condSignal, fallback: h('div', {}, 'empty') },
 *     h('div', {}, 'content')
 *   )
 *
 * 行为：
 * - when 为 true：mount children，destroy fallback
 * - when 为 false：destroy children，mount fallback
 * - 不重渲染 children，仅 mount/destroy 切换
 *
 * 注意：children 由 h() 的 _createComp 放入 props.children（数组形式）
 */
export function Show(props: Record<string, unknown>): VNode {
  const whenGetter = toGetter(props.when);
  const fallback = isVNode(props.fallback) ? props.fallback : undefined;
  const children = isVNodeArray(props.children) ? props.children : [];

  return {
    tag: "__flow",
    attrs: {},
    children: [],
    __flow: {
      type: "show",
      when: (): boolean => Boolean(whenGetter()),
      fallback,
      children,
    },
  };
}

// ============================================
// Match 组件 — Switch 的分支项
// ============================================

/**
 * Match 组件 — Switch 的分支项
 *
 * API：
 *   h(Match, { when: condSignal }, content)
 *
 * Match 本身不渲染，由父 Switch 解析其 __flow.when 和 __flow.children
 */
export function Match(props: Record<string, unknown>): VNode {
  const whenGetter = toGetter(props.when);
  const children = isVNodeArray(props.children) ? props.children : [];

  return {
    tag: "__flow_match",
    attrs: {},
    children,
    __flow: {
      type: "show",
      when: (): boolean => Boolean(whenGetter()),
      children,
    },
  };
}

// ============================================
// Switch 组件 — 多分支条件渲染
// ============================================

/**
 * Switch 组件 — 多分支条件渲染
 *
 * API：
 *   h(Switch, {},
 *     h(Match, { when: cond1 }, content1),
 *     h(Match, { when: cond2 }, content2),
 *     fallbackContent
 *   )
 *
 * 行为：
 * - effect 监听所有 Match 的 when()
 * - 挂载第一个 when() 为 true 的 Match 的 children
 * - 所有 Match 都不匹配时挂载 fallback（最后一个非 Match 子节点）
 * - 分支切换：destroy 旧分支，mount 新分支
 */
export function Switch(props: Record<string, unknown>): VNode {
  const children = isVNodeArray(props.children) ? props.children : [];

  // 分离 Match 子节点和 fallback
  // Match VNode 的 __flow.type === 'show'（Match 组件设置）
  const matches: Array<{ when: () => boolean; children: VNodeChild[] }> = [];
  const fallback: VNodeChild[] = [];
  for (const child of children) {
    if (
      typeof child !== "string" &&
      typeof child === "object" &&
      child !== null &&
      "__flow" in child &&
      typeof child.__flow?.when === "function"
    ) {
      // 这是一个 Match VNode，提取 when 和 children
      const matchFlow = child.__flow;
      if (matchFlow && typeof matchFlow.when === "function") {
        matches.push({
          when: matchFlow.when,
          children: matchFlow.children ?? [],
        });
      }
    } else {
      // 非 Match 节点作为 fallback 的一部分
      fallback.push(child);
    }
  }

  return {
    tag: "__flow",
    attrs: {},
    children: [],
    __flow: {
      type: "switch",
      matches,
      fallback: undefined, // Switch 不用 __flow.fallback（VNode 类型），fallback 存在 matches 之外的 children 中
      children: fallback, // fallback children 存这里
    },
  };
}

// ============================================
// Dynamic 组件 — 动态组件切换
// ============================================

/**
 * Dynamic 组件 — 动态组件切换
 *
 * API：
 *   h(Dynamic, { component: compSignal, ...props })
 *
 * 行为：
 * - effect 监听 component()
 * - 切换时 destroy 旧组件 mount 新组件
 */
export function Dynamic(props: Record<string, unknown>): VNode {
  const compGetter = toGetter(props.component);
  // 收集除 component 外的 props
  const restProps: Record<string, unknown> = {};
  for (const key in props) {
    if (key !== "component" && key !== "children") {
      restProps[key] = props[key];
    }
  }

  return {
    tag: "__flow",
    attrs: {},
    children: [],
    __flow: {
      type: "dynamic",
      component: (): Component<unknown> | undefined => {
        const comp = compGetter();
        return isComponent(comp) ? comp : undefined;
      },
      props: restProps,
    },
  };
}

// ============================================
// 控制流组件标记（props 保持原始形态）
// ============================================

/**
 * 控制流组件集合
 *
 * For/Show/Switch/Match/Dynamic 的 each/when/component 等 props 按
 * 「Signal / getter / 值」三形态由 toGetter 消费，需要拿到 Signal/getter
 * 本体而非解包值——因此 h()/_createComp/SSR 调用这些组件时必须跳过
 * props 响应式代理（core/reactiveProps.ts），编译插件也不对其 attrs
 * 做 _rp 包装（vite-plugin-lumina-compile 的 rewriteCompAttrs）。
 */
const FLOW_COMPONENTS: ReadonlySet<unknown> = new Set([
  For,
  Show,
  Match,
  Switch,
  Dynamic,
]);

/**
 * 判断标签是否为框架控制流组件（跳过 props 响应式代理）
 */
export function isFlowComponent(tag: unknown): boolean {
  return FLOW_COMPONENTS.has(tag);
}
