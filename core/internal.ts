/**
 * 编译期生成的专用内部函数
 *
 * 这些函数由 vite-plugin-lumina-compile 在编译期将 h() 调用替换后引用。
 * 每个函数只做一件事，跳过所有运行时类型判断。
 *
 * 未编译的代码（开发模式）仍走 h() 通用路径。
 * 编译后的代码（生产模式）使用这些专用函数。
 */

import type { VNode, VNodeAttrs, Component, Ref, TmplData } from "@/types";
import type { Signal } from "./signalsCore";
import type { HChild } from "./h";
import { h, flattenChildren, reactiveTextVNode } from "./h";
import { getCurrentVNode, setPendingProviders } from "./context";
import { reportError, ErrorSource } from "./warning";
import { isRefObject, isSignalRef } from "./templateRef";
import { maybeReactiveProps } from "./reactiveProps";
import { isFlowComponent } from "./flow";

// ★ 响应式 prop getter 工厂：编译插件对组件动态 props 的包装入口
// （rewriteCompAttrs 生成 _rp(() => expr)，经 @/core/internal 导入）
export { _rp, isReactivePropGetter } from "./reactiveProps";

/**
 * 元素属性中的 Context Provider 条目
 * 与 h() 元素分支中的提取逻辑保持一致
 */
type ProviderEntry = { contextId: symbol; value: unknown };

/**
 * 从元素属性中提取 __providers（与 h() 元素分支行为一致）
 *
 * 编译路径下 _create* 系列函数必须做与 h() 相同的提取：
 * 否则 __providers 会残留在 attrs 中，被 applyAttrs 当作 DOM 属性设置，
 * 且 useContext 沿 __parent 链无法找到 Provider。
 *
 * @param attrs - 原始属性对象
 * @returns 清理后的 attrs（不含 __providers）与提取出的 providers
 */
function extractProviders(attrs: VNodeAttrs | undefined): {
  attrs: VNodeAttrs;
  providers?: ProviderEntry[];
} {
  if (attrs && "__providers" in attrs && Array.isArray(attrs.__providers)) {
    const providers = attrs.__providers as ProviderEntry[];
    const rest: VNodeAttrs = { ...attrs };
    delete rest.__providers;
    return { attrs: rest, providers };
  }
  return { attrs: attrs ?? {} };
}

/**
 * 创建纯静态元素（无动态属性、无事件、无 ref）
 *
 * 编译期转换：h('div', { class: 'x' }, 'text') → _createStaticEl('div', { class: 'x' }, 'text')
 *
 * 与 h() 相比跳过：
 * - 组件类型判断（isClassComponent/isFnComponent）
 * - SVG 标签查找（SVG_TAGS.has）
 * - Fragment 判断
 *
 * 注意：children 仍然以 rest args 传入，内部做扁平化
 */
export function _createStaticEl(
  tag: string,
  attrs?: VNodeAttrs,
  ...children: HChild[]
): VNode {
  const { attrs: cleanAttrs, providers } = extractProviders(attrs);
  const vnode: VNode = {
    tag,
    attrs: cleanAttrs,
    children: flattenChildren(children),
  };
  if (providers) {
    vnode.__providers = providers;
  }
  return vnode;
}

/**
 * 创建动态元素（可能有事件、ref、动态属性）
 *
 * 编译期转换：h('div', { onClick: fn, class: cls }, child) → _createEl('div', { __events: { click: fn }, class: cls }, child)
 *
 * 与 h() 相比跳过：
 * - 组件类型判断
 * - SVG 标签查找
 * - Fragment 判断
 * 属性中的事件已预分类为 __events，ref 已重命名为 __ref
 */
export function _createEl(
  tag: string,
  attrs?: VNodeAttrs,
  ...children: HChild[]
): VNode {
  const { attrs: cleanAttrs, providers } = extractProviders(attrs);
  const vnode: VNode = {
    tag,
    attrs: cleanAttrs,
    children: flattenChildren(children),
  };
  if (providers) {
    vnode.__providers = providers;
  }
  return vnode;
}

/**
 * 创建 SVG 元素（预设命名空间）
 *
 * 编译期转换：h('svg', {}, h('circle', {})) → _createSvgEl('svg', {}, _createSvgEl('circle', {}))
 *
 * 与 h() 相比跳过：
 * - SVG_TAGS.has() 运行时查找
 */
export function _createSvgEl(
  tag: string,
  attrs?: VNodeAttrs,
  ...children: HChild[]
): VNode {
  const { attrs: cleanAttrs, providers } = extractProviders(attrs);
  const vnode: VNode = {
    tag,
    attrs: cleanAttrs,
    children: flattenChildren(children),
    __ns: "http://www.w3.org/2000/svg",
  };
  if (providers) {
    vnode.__providers = providers;
  }
  return vnode;
}

/**
 * 创建 Fragment（不产生真实 DOM）
 *
 * 编译期转换：h('fragment', {}, ...) → _createFragment(...)
 */
export function _createFragment(...children: HChild[]): VNode {
  return {
    tag: "fragment",
    attrs: {},
    children: flattenChildren(children),
  };
}

/**
 * 创建组件 VNode（跳过运行时组件类型判断）
 *
 * 编译期转换：h(MyComp, { prop: val }) → _createComp(MyComp, { prop: val })
 *
 * 与 h() 相比跳过：
 * - isClassComponent 反射判断（Object.getOwnPropertyDescriptor）
 * - isFnComponent 判断
 *
 * 仍然处理（这些是运行时必须的）：
 * - ref 提取（存储到 lifecycle._ref）
 * - __providers 提取（Context 依赖注入）
 * - children 扁平化（添加到 props.children）
 * - __parent 设置（useContext 遍历父链）
 * - 错误处理（reportError + rethrow）
 */
export function _createComp(
  component: Component<Record<string, unknown>>,
  attrs?: Record<string, unknown>,
  ...children: HChild[]
): VNode {
  const type = (
    component as unknown as { __lumina_type?: "fn" | "class" }
  ).__lumina_type;

  // 扁平化子节点
  const flatChildren = flattenChildren(children);

  // 提取 ref（不作为 props 传递；支持字符串 / Signal / 旧 {current} 对象）
  const rawAttrs = attrs ?? {};
  const rawRef = "ref" in rawAttrs ? rawAttrs.ref : undefined;
  let componentRef: Ref<unknown> | Signal<unknown> | undefined;
  if (typeof rawRef === "string") {
    componentRef = getCurrentVNode()?.lifecycle?._templateRefs?.get(rawRef);
  } else if (isSignalRef(rawRef)) {
    componentRef = rawRef;
  } else if (isRefObject(rawRef)) {
    componentRef = rawRef as Ref<unknown>;
  }

  // 提取 __providers（Context 依赖注入）
  const providers: Array<{ contextId: symbol; value: unknown }> | undefined =
    "__providers" in rawAttrs && Array.isArray(rawAttrs.__providers)
      ? rawAttrs.__providers
      : undefined;

  // 构建 props（排除 ref 和 __providers），单次遍历避免两次对象展开
  const props: Record<string, unknown> = {};
  for (const key in rawAttrs) {
    if (key === "ref" || key === "__providers") continue;
    props[key] = rawAttrs[key];
  }
  props.children = flatChildren;

  // ★ 响应式 props：检测 Signal / _rp thunk 后包装为惰性代理
  //（控制流组件豁免：each/when/component 需要 Signal/getter 本体，见 reactiveProps.ts）
  const compProps = isFlowComponent(component)
    ? props
    : maybeReactiveProps(props);

  // 函数组件
  if (type === "fn") {
    setPendingProviders(providers);
    const fn = component as unknown as (
      props: Record<string, unknown>,
    ) => VNode;

    let vnode: VNode;
    try {
      vnode = fn(compProps);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      reportError(
        ErrorSource.RENDER,
        `Function component render failed: ${component.name || "Anonymous"}`,
        error,
      );
      throw e;
    }

    if (componentRef && vnode.lifecycle) {
      vnode.lifecycle._ref = componentRef;
    }
    if (providers) {
      vnode.__providers = providers;
    }
    vnode.__parent = getCurrentVNode();
    return vnode;
  }

  // 类组件
  if (type === "class") {
    const cls = component as unknown as new (
      props: Record<string, unknown>,
    ) => { render: () => VNode; _ref?: Ref<unknown> };
    const instance = new cls(compProps);

    let vnode: VNode;
    try {
      vnode = instance.render();
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      reportError(
        ErrorSource.RENDER,
        `Class component render failed: ${component.name || "Anonymous"}`,
        error,
      );
      throw e;
    }

    vnode.lifecycle = instance as unknown as VNode["lifecycle"];
    if (componentRef && vnode.lifecycle) {
      vnode.lifecycle._ref = componentRef;
    }
    if (providers) {
      vnode.__providers = providers;
    }
    vnode.__parent = getCurrentVNode();
    return vnode;
  }

  // fallback：未编译的代码走通用 h() 路径
  return h(component as Component<unknown>, attrs, ...children);
}

/**
 * 创建组件 VNode（编译期已确认 attrs 不含 ref / __providers 的快速路径）
 *
 * 编译期转换：h(MyComp, { prop: val }) → _createCompPure(MyComp, { prop: val })
 * 仅当编译期能**静态证明** attrs 不可能携带 `ref` / `__providers` 时才选用：
 * - attrs 省略 / null / undefined 字面量
 * - attrs 为对象字面量，且不含 SpreadElement / computed key
 *   （动态 attrs 变量、`{...rest}`、`{ [k]: v }` 一律回退 _createComp）
 * 详见 vite-plugin-lumina-compile/transform.ts 的 canUseCompPure。
 *
 * 与 _createComp 相比跳过（实测约 10%）：
 * - `'ref' in attrs` 判定 + isSignalRef/isRefObject 三形态提取
 * - `'__providers' in attrs` 判定 + Array.isArray 判定
 * - 上述两个内部键的 props 过滤（键不存在，无需 continue 分支）
 *
 * 仍然完整保留（运行时必需，与 _createComp 逐行等价）：
 * - children 扁平化 → props.children
 * - 响应式 props 代理（maybeReactiveProps，控制流组件豁免）
 * - 函数/类组件渲染 + reportError 上报后 rethrow
 * - vnode.__parent 设置（useContext 遍历父链）
 * - 未标记组件类型的 fallback（走通用 h()）
 *
 * 注意：本函数**不设置 vnode.__providers**。若调用点实际传入了 __providers，
 * Context 依赖注入会失效——这正是编译期准入条件必须严格的原因。
 */
export function _createCompPure(
  component: Component<Record<string, unknown>>,
  attrs?: Record<string, unknown>,
  ...children: HChild[]
): VNode {
  // 扁平化子节点
  const flatChildren = flattenChildren(children);

  const type = (
    component as unknown as { __lumina_type?: "fn" | "class" }
  ).__lumina_type;

  // 构建 props（attrs 已由编译期保证不含 ref / __providers）
  const rawAttrs = attrs ?? {};
  const props: Record<string, unknown> = {};
  for (const key in rawAttrs) {
    props[key] = rawAttrs[key];
  }
  props.children = flatChildren;

  // ★ 响应式 props：检测 Signal / _rp thunk 后包装为惰性代理
  //（控制流组件豁免，与 _createComp 一致）
  const compProps = isFlowComponent(component)
    ? props
    : maybeReactiveProps(props);

  // 函数组件
  if (type === "fn") {
    const fn = component as unknown as (
      props: Record<string, unknown>,
    ) => VNode;

    let vnode: VNode;
    try {
      vnode = fn(compProps);
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      reportError(
        ErrorSource.RENDER,
        `Function component render failed: ${component.name || "Anonymous"}`,
        error,
      );
      throw e;
    }

    vnode.__parent = getCurrentVNode();
    return vnode;
  }

  // 类组件
  if (type === "class") {
    const cls = component as unknown as new (
      props: Record<string, unknown>,
    ) => { render: () => VNode; _ref?: Ref<unknown> };
    const instance = new cls(compProps);

    let vnode: VNode;
    try {
      vnode = instance.render();
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      reportError(
        ErrorSource.RENDER,
        `Class component render failed: ${component.name || "Anonymous"}`,
        error,
      );
      throw e;
    }

    vnode.lifecycle = instance as unknown as VNode["lifecycle"];
    vnode.__parent = getCurrentVNode();
    return vnode;
  }

  // fallback：未编译的代码走通用 h() 路径
  return h(component as Component<unknown>, attrs, ...children);
}

/**
 * 克隆编译期提升的静态 VNode（_hoisted_N）
 *
 * 静态提升把整棵静态子树提升为模块级共享常量，
 * 同一常量可能被多次渲染/多处使用：
 * - materialize 会写入 vnode.el，共享对象会被后挂载的节点覆盖
 * - destroy 沿共享对象取 el 时可能移除错误的 DOM
 * 因此每个使用点必须克隆一份独立树，Vue 的 cloneVNode 同理。
 *
 * 编译期转换：_hoisted_1 → _cloneHoisted(_hoisted_1)
 */
export function _cloneHoisted<T extends VNode>(vnode: T): T {
  const clone: VNode = {
    tag: vnode.tag,
    attrs: { ...vnode.attrs },
    children: vnode.children.map((child) =>
      typeof child === "string" ? child : _cloneHoisted(child),
    ),
  };
  if (vnode.__ns !== undefined) {
    clone.__ns = vnode.__ns;
  }
  if (vnode.__providers !== undefined) {
    clone.__providers = vnode.__providers;
  }
  if (vnode.__reactive !== undefined) {
    clone.__reactive = vnode.__reactive;
  }
  return clone as T;
}

/**
 * 静态子树模板工厂（编译期 DOM 化阶段 1）
 *
 * 编译期转换：
 *   h('div', { class: 'a' }, 'text')  →  const _hoisted_N = _tmpl('<div class="a">text</div>', 1)
 *   使用点：_hoisted_N() → 带 __tmpl 标记的 VNode
 *
 * 三条路径共用同一份数据（__tmpl.html）：
 * - 客户端 mount：materialize 识别 __tmpl → 调用 clone() 从惰性 <template> 克隆真实 DOM，
 *   跳过整棵 VNode 解释（createElement/applyAttrs/递归 materialize 全部省略）
 * - SSR：renderToString 识别 __tmpl → 直接返回 html 字符串，跳过 VNode 序列化
 * - 水合：hydrateNode 识别 __tmpl → 不克隆，直接采用 SSR 已输出的 DOM 段
 *   （clone 内的 <template> 创建是惰性的，水合模式永不触发 → 零成本）
 *
 * roots 为顶层节点数：
 * - roots === 1：克隆单个元素（cloneNode(true)），vnode.el 指向该元素
 * - roots > 1：fragment 多根，克隆整个 template.content（DocumentFragment），
 *   顶层节点存入 vnode.__tmplRoots，destroy 时逐个移除
 *
 * 与 Solid 的 template() + Svelte 的 create_element 等价：
 * 模板解析一次，每个使用点仅付一次 cloneNode(true) 成本（远低于逐节点解释）
 *
 * @param html - 静态子树的 HTML 字符串（编译期生成，语义与 SSR serializeAttrs 严格一致）
 * @param roots - 顶层节点数（单根为 1，fragment 多根为子元素数）
 * @returns 工厂函数，每次调用返回一个独立的 __tmpl VNode（多使用点互不共享 DOM）
 */
export function _tmpl(html: string, roots: number): () => VNode {
  // 惰性创建的 <template> 元素（首次 clone 时才解析 HTML，SSR/水合路径永不创建）
  let tpl: HTMLTemplateElement | undefined;

  const clone = (): Node => {
    if (tpl === undefined) {
      tpl = document.createElement("template");
      tpl.innerHTML = html;
    }
    if (roots === 1) {
      const first = tpl.content.firstElementChild;
      if (first !== null) {
        return first.cloneNode(true);
      }
      // 防御：单根模板解析异常时退化为整段克隆（正常由编译端保证不会走到）
      return tpl.content.cloneNode(true);
    }
    // 多根：克隆整个 content 为 DocumentFragment（appendChild 时子节点自动展开插入）
    return tpl.content.cloneNode(true);
  };

  return (): VNode => {
    const data: TmplData = { html, roots, clone };
    const vnode: VNode = {
      tag: "__tmpl__",
      attrs: {},
      children: [],
      __tmpl: data,
    };
    return vnode;
  };
}

/**
 * 创建响应式文本节点
 *
 * 编译期转换：h('div', {}, signal.value) 中的动态表达式 → _reactiveText(() => String(signal.value))
 * mount 时创建 Text 节点并注册 effect，signal 变化时自动更新 textContent（细粒度响应式）
 *
 * effect 的 dispose 函数自动推入 vnode._cleanups，destroy 时自动清理
 *
 * 结构复用 h.ts 的 reactiveTextVNode（单一来源）：
 * 未编译路径中 h() 收到的零参箭头函数子节点由 flattenInto 以同一工厂规范化
 *
 * @param getter - 返回当前文本值的函数（在 effect 中调用，自动追踪依赖的 signal）
 * @returns 带有 __reactive 标记的 VNode，materialize 时识别并创建响应式 Text 节点
 */
export function _reactiveText(getter: () => string): VNode {
  return reactiveTextVNode(getter);
}

/**
 * 创建响应式模板（混合静态文本与动态表达式）
 *
 * 编译期转换：`Hello ${name.value}!` → _reactiveTemplate('Hello ', () => name.value, '!')
 * 内部委托给 _reactiveText，通过闭包组合 parts，effect 运行时拼接最终文本
 *
 * @param parts - 模板片段数组（字符串为静态部分，函数为动态部分）
 * @returns 带有 __reactive 标记的 VNode
 */
export function _reactiveTemplate(...parts: (string | (() => string))[]): VNode {
  return _reactiveText(() => {
    let result = "";
    for (const part of parts) {
      result += typeof part === "function" ? part() : part;
    }
    return result;
  });
}
