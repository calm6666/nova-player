/**
 * ============================================
 * 服务端渲染(SSR)核心模块
 * ============================================
 * 提供将虚拟节点树序列化为 HTML 字符串的功能
 * 以及客户端水合(hydration)功能
 */

import type {
  VNode,
  VNodeAttrs,
  Component,
  FnComponent,
  ClassComponent,
} from "@/types";
import {
  setCurrentVNode,
  getCurrentVNode,
  setPendingProviders,
  pushProviderStack,
  popProviderStack,
} from "./context";
import { reportError, ErrorSource } from "./warning";
import {
  serializeStyle,
  normalizeClass,
  StyleInput,
} from "./normalize";
import { maybeReactiveProps } from "./reactiveProps";
import { isFlowComponent } from "./flow";

/**
 * 自闭合 HTML 标签集合
 * 这些标签不需要闭合标签
 */
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * 需要跳过的属性名集合
 * 这些是内部属性，不应渲染到 HTML 中
 *
 * innerHTML / textContent：这些是 DOM property，
 * 通过 setAttribute 设置无效，SSR 中作为属性输出也是错误的。
 * 正确做法是将内容作为 children 传入 h() 函数。
 */
const SKIP_ATTRS = new Set([
  "ref",
  "__ref",
  // 编译期预分类的事件对象（vite-plugin-lumina-compile 将 onXxx 提取为 __events）
  // 与 __ref/__providers 一样是内部字段，绝不能序列化到 HTML 中
  "__events",
  "key",
  "children",
  "_cleanups",
  "__ns",
  "__providers",
  "directives",
  "svgContent",
  "innerHTML",
  "textContent",
  "__reactiveAttrs",
]);

/**
 * DOM property 名 → HTML 属性名的映射
 * 某些 JS DOM property 是 camelCase，但对应 HTML 属性是 lowercase
 * 例如 el.readOnly → HTML: readonly
 *     el.defaultValue → HTML: value（但 default-value 不是标准属性）
 *
 * 此映射表用于 SSR 输出正确的 HTML 属性名。
 */
const DOM_PROPERTY_TO_HTML_ATTR: Record<string, string> = {
  readOnly: "readonly",
  defaultChecked: "checked",
  defaultSelected: "selected",
  defaultMuted: "muted",
};

/**
 * HTML 布尔属性集合
 * 只有这些属性在 SSR 中才应该使用“属性名存在即为 true”的输出方式。
 *
 * 注意：
 * - 这些属性的 false 值应直接省略
 * - 其他普通属性即使值是 boolean，也应按字符串输出
 *   例如 data-* / aria-* / draggable / contenteditable 等
 */
const BOOLEAN_HTML_ATTRS = new Set([
  "allowfullscreen",
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
]);

function isBooleanAttr(key: string): boolean {
  const htmlAttr = DOM_PROPERTY_TO_HTML_ATTR[key] ?? key;
  return BOOLEAN_HTML_ATTRS.has(key.toLowerCase()) || BOOLEAN_HTML_ATTRS.has(htmlAttr.toLowerCase());
}

/**
 * 将 VNode 树序列化为 HTML 字符串
 * 用于服务端渲染，将虚拟 DOM 转换为可发送给客户端的 HTML
 *
 * @param vnode - 虚拟节点或字符串
 * @returns HTML 字符串
 *
 * @example
 * ```typescript
 * const vnode = h('div', { class: 'container' }, h('span', {}, 'Hello'));
 * const html = renderToString(vnode);
 * // => '<div class="container"><span>Hello</span></div>'
 * ```
 */
export function renderToString(
  vnode: VNode | string | null | undefined,
): string {
  /** 空值直接返回空字符串 */
  if (vnode === null || vnode === undefined) {
    return "";
  }

  /** 纯文本节点直接返回文本内容 */
  if (typeof vnode === "string") {
    return escapeHtml(vnode);
  }

  /**
   * 静态模板节点（编译期 DOM 化阶段 1）：
   * 直接输出编译期生成的 HTML 字符串，跳过整棵 VNode 序列化。
   * html 由编译端按 serializeAttrs 相同语义生成（内容已转义），
   * 与客户端 <template> 克隆出的 DOM 严格一致，水合时可整段采用。
   */
  if (vnode.__tmpl !== undefined) {
    return vnode.__tmpl.html;
  }

  /** 响应式文本节点：SSR 直接调用 getter 获取当前值（无 effect 追踪） */
  if (vnode.__reactive !== undefined) {
    return escapeHtml(vnode.__reactive.get());
  }

  /**
   * 控制流节点：SSR 不输出任何占位（控制流内容在客户端渲染），
   * 客户端 hydrateNode 遇到 __flow 时在当前位置插入不可见的空 Text 锚点，
   * 再以该锚点调用 initFor/initShow 等动态渲染子树
   * （水合端保留对旧版 <!--flow--> 注释占位的兼容）
   */
  if (vnode.__flow !== undefined) {
    return "";
  }

  /** 处理组件类型的 VNode */
  if (typeof vnode.tag === "function") {
    return renderComponentToString(vnode);
  }

  /** 处理原生 HTML 标签 */
  return renderElementToString(vnode);
}

/**
 * 渲染原生 HTML 元素为字符串
 *
 * @param vnode - 元素虚拟节点
 * @returns HTML 字符串
 */
function renderElementToString(vnode: VNode): string {
  const tag = String(vnode.tag);

  /**
   * Fragment 片段处理
   * fragment 标签不产生真实 DOM，只输出子元素
   * 与客户端行为一致：Fragment 不创建 DOM 节点
   */
  if (tag === "fragment") {
    const children = vnode.children || [];
    return children.map((child) => renderToString(child)).join("");
  }

  const attrs = vnode.attrs || {};
  const children = vnode.children || [];

  /** 序列化属性 */
  const attrStr = serializeAttrs(attrs);

  /** 自闭合标签 */
  if (VOID_ELEMENTS.has(tag)) {
    return `<${tag}${attrStr}>`;
  }

  /**
   * Context 上下文支持
   * 如果元素有 __providers，在渲染子元素前设置 __currentVNode
   * 这样子组件的 useContext 可以沿 __parent 链找到 Provider
   * 同时推入全局 Provider 栈，处理手动构建 VNode 树的场景
   */
  const prevVNode = getCurrentVNode();
  const providers = vnode.__providers;
  const hasProviders = providers !== undefined && providers.length > 0;
  if (hasProviders) {
    vnode.__parent = prevVNode;
    setCurrentVNode(vnode);
    pushProviderStack(providers);
  }

  try {
    /** 递归序列化子节点 */
    const childrenStr = children.map((child) => renderToString(child)).join("");
    return `<${tag}${attrStr}>${childrenStr}</${tag}>`;
  } finally {
    /** 恢复上下文，避免子节点渲染失败时污染后续 SSR */
    if (hasProviders) {
      popProviderStack();
      setCurrentVNode(prevVNode);
    }
  }
}

/**
 * 渲染组件为字符串
 * 调用组件函数获取其返回的 VNode，然后递归序列化
 *
 * 与 h.ts 的 getComponentType 不同，这里也优先读取编译期 __lumina_type 标记，
 * 避免每次 SSR 都执行完整的 Object.getOwnPropertyDescriptor 反射判断
 *
 * @param vnode - 组件虚拟节点
 * @returns HTML 字符串
 */
function renderComponentToString(vnode: VNode): string {
  const tag = vnode.tag;
  const attrs = vnode.attrs || {};

  /**
   * ★ 响应式 props：手工构建的组件 VNode 直连此路径（编译路径已在
   * _createComp 内完成包装）。Signal / _rp thunk 存在时包装为惰性代理，
   * SSR 同步渲染期间读取即得到当前值；控制流组件豁免（toGetter
   * 需要 Signal/getter 本体）
   */
  const compProps = isFlowComponent(tag)
    ? attrs
    : maybeReactiveProps(attrs);

  /**
   * 设置待注入的 Provider
   * h() 在客户端会调用 setPendingProviders，但 SSR 中直接调用 tag(attrs)
   * 需要手动设置，这样 defineComponent 内部可以通过 getPendingProviders 获取
   * 同时推入全局 Provider 栈，确保 useContext 可以从栈中查找
   */
  setPendingProviders(vnode.__providers);
  if (vnode.__providers) {
    pushProviderStack(vnode.__providers);
  }

  // try/finally 确保 provider 清理始终执行，消除之前 5 处重复的清理代码
  try {
    if (typeof tag === "function") {
      // ★ 优先读取编译期 __lumina_type 标记（与 h.ts getComponentType 保持一致）
      // 编译期：vite-plugin-lumina-compile 在 defineComponent 和 class 组件后注入
      // O(1) 属性读取，跳过完整的反射判断
      const compType = (
        tag as unknown as { __lumina_type?: "fn" | "class" }
      ).__lumina_type;

      if (compType === "fn" || (compType === undefined && isFnComponent(tag))) {
        /**
         * 函数组件渲染：调用组件函数获取 VNode
         * 错误报告后重抛，不吞掉错误 — 与客户端 h.ts 保持一致
         */
        const fn = tag as unknown as (props: Record<string, unknown>) => VNode;
        let result: VNode;
        try {
          result = fn(compProps);
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          reportError(
            ErrorSource.SSR,
            `SSR function component render failed: ${tag.name || "Anonymous"}`,
            error,
          );
          throw e;
        }
        return renderToString(result);
      }

      if (compType === "class" || (compType === undefined && isClassComponent(tag))) {
        const instance = new (tag as ClassComponent)(compProps);
        let result: VNode;
        try {
          result = instance.render();
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e));
          reportError(
            ErrorSource.SSR,
            `SSR class component render failed: ${tag.name || "Anonymous"}`,
            error,
          );
          throw e;
        }
        return renderToString(result);
      }
    }
    return "";
  } finally {
    // ★ 统一清理：无论成功、失败、还是未知组件类型
    setPendingProviders(undefined);
    if (vnode.__providers) {
      popProviderStack();
    }
  }
}

/**
 * 序列化属性对象为 HTML 属性字符串
 *
 * 设计参考 Vue 3 ssrRenderAttrs / Solid.js ssrSpread：
 * - style：由 serializeStyle() 统一处理（增量构建，空值自动过滤）
 * - class/className：由 normalizeClass() 统一处理（支持字符串/数组/对象）
 * - 每个 CSS 属性自闭合（自带 ;），不依赖 Array.join
 *
 * @param attrs - 属性对象
 * @returns 属性字符串（含前导空格）
 */
function serializeAttrs(attrs: VNodeAttrs): string {
  const parts: string[] = [];

  for (const key in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
    if (SKIP_ATTRS.has(key)) continue;

    const value = attrs[key];

    /**
     * 风格序列化（统一入口，支持对象和字符串）
     * 放在事件处理器之前检查，避免 TypeScript 类型窄化导致赋值错误
     */
    if (key === "style") {
      const attrStr = serializeStyle(value as StyleInput, escapeHtml);
      if (attrStr) parts.push(attrStr);
      continue;
    }

    /**
     * 显式跳过事件处理器（以 on 开头的函数属性）
     * 之前通过 typeof value === "function" 隐式过滤，
     * 现在显式判断，逻辑更清晰
     */
    if (key.startsWith("on") && typeof value === "function") continue;

    /** 跳过 undefined */
    if (value === undefined) continue;

    /**
     * className / class 统一处理
     *
     * 支持字符串 / 数组 / 对象格式：
     * - 'foo bar'                → class="foo bar"
     * - ['foo', { active: true }] → class="foo active"
     * - { active: true }         → class="active"
     * 空值不输出 class 属性
     */
    if (key === "className" || key === "class") {
      const cls = normalizeClass(value as Parameters<typeof normalizeClass>[0]);
      if (cls) parts.push(` class="${escapeHtml(cls)}"`);
      continue;
    }

    /**
     * 布尔属性只对 HTML 布尔属性生效。
     * 普通属性即使值是 boolean，也要按字符串序列化，避免和客户端属性行为不一致。
     */
    if (typeof value === "boolean") {
      const htmlAttr = DOM_PROPERTY_TO_HTML_ATTR[key] ?? key;
      if (isBooleanAttr(key)) {
        if (value) {
          parts.push(` ${htmlAttr}`);
        }
        continue;
      }

      parts.push(` ${htmlAttr}="${value ? "true" : "false"}"`);
      continue;
    }

    /** 普通属性 */
    const htmlAttr = DOM_PROPERTY_TO_HTML_ATTR[key] ?? key;
    parts.push(` ${htmlAttr}="${escapeHtml(String(value))}"`);
  }

  /** 处理响应式属性：SSR 直接调用 getter 获取当前值（无 effect 追踪） */
  const reactiveAttrs = attrs.__reactiveAttrs;
  if (reactiveAttrs !== undefined) {
    for (const rKey in reactiveAttrs) {
      if (!Object.prototype.hasOwnProperty.call(reactiveAttrs, rKey)) continue;
      const val = reactiveAttrs[rKey]();
      if (val === undefined || val === null) continue;
      if (rKey === "class" || rKey === "className") {
        if (val) parts.push(` class="${escapeHtml(val)}"`);
      } else {
        parts.push(` ${rKey}="${escapeHtml(val)}"`);
      }
    }
  }

  return parts.join("");
}

/**
 * HTML 特殊字符转义映射表
 * 使用单次遍历查表替换，避免多次正则替换
 */
const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * HTML 特殊字符转义
 * 单次遍历查表替换，性能优于多次正则替换
 *
 * @param str - 原始字符串
 * @returns 转义后的字符串
 */
function escapeHtml(str: string): string {
  // 用数组收集 + join 替代循环内 += 拼接，避免 V8 的字符串 deopt
  const parts: string[] = [];
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    parts.push(HTML_ESCAPE_MAP[char] ?? char);
  }
  return parts.join("");
}

/**
 * 判断是否为类组件
 * 通过 class 的特征（prototype 不可写）和原型上的 render 方法精确识别
 */
function isClassComponent(tag: Component): tag is ClassComponent {
  if (typeof tag !== "function") return false;

  const desc = Object.getOwnPropertyDescriptor(tag, "prototype");
  // 没有 prototype 或 prototype 可写 → 不是 class
  if (!desc || desc.writable !== false) return false;

  // 安全获取原型对象，避免直接访问 tag.prototype
  const proto: unknown = desc.value;
  if (typeof proto !== "object" || proto === null) return false;

  // 检查 render 方法
  return typeof (proto as Record<string, unknown>).render === "function";
}

/**
 * 判断是否为函数组件
 * 是函数但不是类组件，即为函数组件
 */
function isFnComponent(tag: Component): tag is FnComponent {
  return typeof tag === "function" && !isClassComponent(tag);
}
