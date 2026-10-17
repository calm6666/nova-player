/**
 * ============================================
 * DOM 挂载与渲染模块
 * ============================================
 * 提供将虚拟节点转换为真实 DOM 并挂载的功能
 * 包含属性应用、事件绑定、指令处理等
 * 支持服务端渲染(SSR)环境
 */

import type {
  VNode,
  VNodeAttrs,
  VNodeChild,
  Lifecycle,
  RefValue,
  DirectiveFn,
} from "@/types";
import { effect, untracked } from "./signalsCore";
import type { Signal } from "./signalsCore";
import { isBrowser } from "@/utils";
import { safeCall, ErrorSource, isDev, warn, WarnSource } from "./warning";
import { applyStyle, normalizeClass, normalizeStyle } from "./normalize";
import type { ClassInput, StyleInput } from "./normalize";
import { isRefObject, isSignalRef } from "./templateRef";
import { h } from "./h";
import { getDirective } from "./directives";

/**
 * 沿 __parent 链向上查找最近的组件生命周期注册表，解析字符串模板引用
 * 字符串 ref 归属「最近的组件」，不跨组件边界
 */
function findTemplateRef(
  vnode: VNode,
  key: string,
): Signal<unknown> | undefined {
  let cur: VNode | undefined = vnode;
  while (cur) {
    if (cur.lifecycle) {
      return cur.lifecycle._templateRefs?.get(key);
    }
    cur = cur.__parent;
  }
  return undefined;
}

/**
 * 统一的 ref 绑定：支持回调 / 字符串模板引用 / Signal / 旧 {current} 对象
 */
function bindRef(refValue: unknown, el: Element, vnode: VNode): void {
  if (refValue === undefined || refValue === null) return;
  if (typeof refValue === "function") {
    (refValue as RefValue)(el, vnode);
    return;
  }
  if (typeof refValue === "string") {
    const sig = findTemplateRef(vnode, refValue);
    if (sig) {
      sig.value = el;
    } else if (isDev()) {
      warn(
        WarnSource.MOUNT,
        `Template ref "${refValue}" not registered: call useTemplateRef(lc, "${refValue}") in setup`,
      );
    }
    return;
  }
  if (isSignalRef(refValue)) {
    refValue.value = el;
    return;
  }
  if (isRefObject(refValue)) {
    refValue.current = el;
  }
}

/**
 * 统一的 ref 清理：销毁时把已绑定的引用清空，避免悬挂 DOM 引用
 */
function clearRef(refValue: unknown, vnode: VNode): void {
  if (refValue === undefined || refValue === null) return;
  if (typeof refValue === "string") {
    const sig = findTemplateRef(vnode, refValue);
    if (sig) sig.value = null;
    return;
  }
  if (isSignalRef(refValue)) {
    refValue.value = null;
    return;
  }
  if (isRefObject(refValue)) {
    refValue.current = null;
  }
}

/**
 * 需要直接赋值到 DOM property 的属性白名单
 * 这些属性用 setAttribute 设置后行为异常或不生效：
 * - value：setAttribute 不会更新当前值，且不影响 form reset
 * - checked/selected：setAttribute 设置的是默认值而非当前值
 * - disabled/readOnly：setAttribute 会被视为 true（即使值为 false）
 * - textContent/innerHTML：setAttribute 无法设置这些 property
 */
const DOM_PROPERTIES = new Set<string>([
  "value",
  "checked",
  "selected",
  "disabled",
  "readOnly",
  "defaultValue",
  "defaultChecked",
  "defaultSelected",
  "indeterminate",
  "textContent",
  "innerHTML",
]);

/**
 * 将虚拟节点挂载到容器元素
 * 这是挂载流程的入口函数
 * 在服务端环境中跳过实际挂载，仅触发生命周期
 *
 * @param vnode - 要挂载的虚拟节点
 * @param container - 容器 DOM 元素
 *
 * @example
 * mount(h(App, {}), document.getElementById('root')!)
 */
export function mount(vnode: VNode | string, container: HTMLElement): void {
  /**
   * 服务端环境跳过实际挂载
   * 仅触发生命周期钩子（如果存在）
   */
  if (!isBrowser()) {
    invokeLifecycle(vnode, "onBeforeMount");
    invokeLifecycle(vnode, "onMounted");
    return;
  }

  /**
   * 开发环境检测重复挂载
   * 同一 VNode 被多次 mount 会导致状态污染和事件监听累积
   */
  if (typeof vnode === "object" && vnode._mounted && isDev()) {
    console.warn(
      "[Lumina/mount] Detected duplicate VNode mount, the same VNode object should not be mounted multiple times",
    );
  }

  /**
   * 将虚拟节点物化为真实 DOM
   * 递归创建所有子节点
   */
  const el = materialize(vnode);

  /**
   * 触发 onBeforeMount 生命周期钩子
   * 在 DOM 插入容器之前调用，此时组件可做最后的修改/拦截
   * 与 Vue3 的 onBeforeMount 语义一致：DOM 即将挂载但尚未插入文档
   */
  invokeLifecycle(vnode, "onBeforeMount");

  /**
   * 将生成的 DOM 插入容器
   */
  container.appendChild(el);

  /**
   * 标记 VNode 已挂载
   */
  if (typeof vnode === "object") {
    vnode._mounted = true;
  }

  /**
   * 触发 onMounted 生命周期钩子
   * DOM 已插入容器，组件可以安全地访问 DOM 元素
   */
  invokeLifecycle(vnode, "onMounted");
}

/**
 * 将虚拟节点物化为真实 DOM 节点
 * 递归处理子节点，构建完整的 DOM 树
 * 在服务端环境中返回一个模拟的节点对象
 *
 * @param vnode - 虚拟节点或字符串
 * @returns 真实 DOM 节点或模拟节点
 */
export function materialize(vnode: VNode | string): Node {
  /**
   * 服务端环境返回模拟节点
   * 避免访问 document 对象导致报错
   */
  if (!isBrowser()) {
    return createMockNode(vnode);
  }

  /**
   * 处理文本节点
   * 字符串直接创建为文本节点
   */
  if (typeof vnode === "string") {
    return document.createTextNode(vnode);
  }

  /**
   * 静态模板节点处理（编译期 DOM 化阶段 1）
   *
   * 整棵静态子树已在编译期生成 HTML 字符串（_tmpl），运行时仅从惰性 <template>
   * 克隆一份真实 DOM：一次 cloneNode 替代整棵子树的 createElement/applyAttrs/递归物化。
   * - 单根：克隆出的元素直接作为 vnode.el
   * - 多根（fragment）：克隆出 DocumentFragment，顶层节点存入 __tmplRoots
   *   （destroy 时逐个移除；appendChild 展开后数组引用仍然有效）
   */
  if (vnode.__tmpl !== undefined) {
    const cloned = vnode.__tmpl.clone();
    if (cloned instanceof Element) {
      vnode.el = cloned;
    } else if (cloned instanceof DocumentFragment && cloned.childNodes.length > 1) {
      vnode.__tmplRoots = Array.from(cloned.childNodes);
    }
    return cloned;
  }

  /**
   * 处理响应式文本节点
   * 编译期 _reactiveText(getter) 生成的 VNode 带有 __reactive 标记
   * 创建 Text 节点并注册 effect，getter 内读取的 signal 变化时自动更新 textContent
   * effect 的 dispose 推入 vnode._cleanups，destroy 时自动清理
   */
  if (vnode.__reactive !== undefined) {
    const textNode = document.createTextNode("");
    const dispose = effect(() => {
      const next = vnode.__reactive!.get();
      // 值比较（细腻更新）：依赖 signal 变化但文本值未变时不写 DOM，
      // 避免 textContent 被无谓重设（相同值重设仍会触发 DOM 变更记录）
      if (textNode.textContent !== next) {
        textNode.textContent = next;
      }
    });
    if (!vnode._cleanups) vnode._cleanups = [];
    vnode._cleanups.push(dispose);
    vnode.el = textNode;
    return textNode;
  }

  /**
   * 控制流节点处理（For/Show/Switch/Dynamic）
   *
   * 创建空 Text 锚点 + DocumentFragment 容器：
   * - anchor 标记 flow 子节点在 DOM 中的插入位置（空 Text 节点在页面中不可见）
   * - fragment 作为首次 effect 运行时的临时父节点
   *
   * effect 首次同步运行时，anchor.parentNode 是 fragment（DocumentFragment 支持 insertBefore）；
   * parent 将 fragment 插入真实 DOM 后，anchor.parentNode 变为真实 parent，
   * 后续 effect 重跑自动使用真实 parent（无缝衔接）。
   *
   * dispose 推入 vnode._cleanups，destroy 时自动清理：
   * 1. dispose effect（停止响应式更新）
   * 2. destroy 所有动态创建的子 VNode（移除 DOM + 清理 effects）
   * 3. removeChild(anchor) 由 destroy() 的通用逻辑处理
   */
  if (vnode.__flow !== undefined) {
    const anchor = document.createTextNode("");
    const container = document.createDocumentFragment();
    container.appendChild(anchor);
    vnode.el = anchor;

    let dispose: (() => void) | undefined;
    const flowType = vnode.__flow.type;
    if (flowType === "for") {
      dispose = initFor(vnode, anchor);
    } else if (flowType === "show") {
      dispose = initShow(vnode, anchor);
    } else if (flowType === "switch") {
      dispose = initSwitch(vnode, anchor);
    } else if (flowType === "dynamic") {
      dispose = initDynamic(vnode, anchor);
    }
    if (dispose) {
      if (!vnode._cleanups) vnode._cleanups = [];
      vnode._cleanups.push(dispose);
    }
    return container;
  }

  /**
   * Fragment 片段处理
   * fragment 标签不产生真实 DOM 元素，只创建 DocumentFragment 包裹子节点
   * 与 SSR 中的 renderElementToString 行为一致
   */
  if (String(vnode.tag).toLowerCase() === "fragment") {
    const fragment = document.createDocumentFragment();
    for (const child of vnode.children) {
      if (typeof child !== "string" && child.__parent === undefined) {
        child.__parent = vnode;
      }
      fragment.appendChild(materialize(child));
    }
    return fragment;
  }

  /**
   * 获取命名空间（用于 SVG 元素）
   * 如果存在命名空间，使用 createElementNS 创建元素
   */
  const ns = vnode.__ns;

  /**
   * 创建元素节点
   * 根据是否有命名空间选择创建方法
   */
  const el =
    ns !== undefined
      ? document.createElementNS(ns, String(vnode.tag))
      : document.createElement(String(vnode.tag));

  /**
   * 应用属性到元素
   * 包括 HTML 属性、事件监听、指令等
   * 注意：SVG 元素（如 <path>）是 SVGElement 而非 HTMLElement，
   * 必须用 el instanceof Element 判断，否则 SVG 元素的属性（如 d、viewBox）
   * 永远不会被设置，导致 SVG 渲染为空标签
   */
  const domEl = el instanceof Element ? el : undefined;
  if (domEl) {
    applyAttrs(domEl, vnode.attrs, vnode);
  }

  /**
   * 递归物化并挂载子节点
   * 使用 DocumentFragment 批量插入，减少重排次数
   *
   * __parent 由 h() 在创建 VNode 时设置，这里只在未设置时补充
   * 避免多次 mount 同一 VNode 树时覆盖已有的 __parent 链
   */
  if (vnode.children.length > 0) {
    const fragment = document.createDocumentFragment();
    for (const child of vnode.children) {
      if (typeof child !== "string" && child.__parent === undefined) {
        child.__parent = vnode;
      }
      fragment.appendChild(materialize(child));
    }
    el.appendChild(fragment);
  }

  /**
   * 保存真实 DOM 引用到虚拟节点
   * 便于后续直接操作
   * SVG 元素也保存引用（SVGElement 继承自 Element）
   */
  if (domEl) {
    vnode.el = domEl;
  }

  return el;
}

/**
 * 类型守卫：判断节点是否有 textContent 属性
 */
function hasTextContent(node: unknown): node is { textContent: string } {
  return (
    typeof node === "object" &&
    node !== null &&
    "textContent" in node &&
    typeof (node as { textContent?: unknown }).textContent === "string"
  );
}

/**
 * VNode → 字符串（用于 SSR flow 渲染）
 * 递归调用 createMockNode 获取 textContent
 */
function vnodeToString(vnode: VNode | string): string {
  if (typeof vnode === "string") return vnode;
  const mockNode = createMockNode(vnode);
  if (hasTextContent(mockNode)) return mockNode.textContent;
  return "";
}

/**
 * 创建模拟 DOM 节点（用于 SSR）
 * 在服务端环境中创建一个简单的对象来模拟 DOM 节点
 *
 * @param vnode - 虚拟节点或字符串
 * @returns 模拟的 DOM 节点
 */
function createMockNode(vnode: VNode | string): Node {
  /**
   * 文本节点直接返回空文本节点模拟
   */
  if (typeof vnode === "string") {
    return { nodeType: Node.TEXT_NODE, textContent: vnode } as Node;
  }

  /**
   * 静态模板节点：SSR 环境直接输出模板 HTML 字符串
   * （与 ssr.ts renderToString 的 __tmpl 分支语义一致，内容已转义安全）
   */
  if (vnode.__tmpl !== undefined) {
    return { nodeType: Node.TEXT_NODE, textContent: vnode.__tmpl.html } as Node;
  }

  /**
   * 响应式文本节点：SSR 环境直接调用 getter 获取当前值
   */
  if (vnode.__reactive !== undefined) {
    return { nodeType: Node.TEXT_NODE, textContent: vnode.__reactive.get() } as Node;
  }

  /**
   * 控制流节点：SSR 环境渲染初始状态（不注册 effect）
   *
   * 与 __reactive 一致：同步求值一次，输出初始 HTML
   * - For：遍历 each() 调用 render(item,i) 拼接
   * - Show：when() 为 true 渲染 children，否则渲染 fallback
   * - Switch：遍历 matches 渲染第一个 when() 为 true 的分支
   * - Dynamic：调用 component() 渲染该组件
   */
  if (vnode.__flow !== undefined) {
    const flow = vnode.__flow;
    const flowType = flow.type;
    if (flowType === "for") {
      // For：遍历 items 调用 render 拼接为模拟文本
      const eachGetter = flow.each;
      const items = eachGetter ? eachGetter() : [];
      const renderFn = flow.render;
      let html = "";
      for (let i = 0; i < items.length; i++) {
        if (renderFn) {
          const childVNode = renderFn(items[i], i);
          html += vnodeToString(childVNode);
        }
      }
      return { nodeType: Node.TEXT_NODE, textContent: html } as Node;
    }
    if (flowType === "show") {
      const visible = flow.when ? flow.when() : false;
      const target = visible
        ? flow.children ?? []
        : flow.fallback
          ? [flow.fallback]
          : [];
      let html = "";
      for (const child of target) {
        html += typeof child === "string" ? child : vnodeToString(child);
      }
      return { nodeType: Node.TEXT_NODE, textContent: html } as Node;
    }
    if (flowType === "switch") {
      const matches = flow.matches ?? [];
      const fallback = flow.children ?? [];
      let html = "";
      let found = false;
      for (const match of matches) {
        if (match.when()) {
          for (const child of match.children) {
            html += typeof child === "string" ? child : vnodeToString(child);
          }
          found = true;
          break;
        }
      }
      if (!found) {
        for (const child of fallback) {
          html += typeof child === "string" ? child : vnodeToString(child);
        }
      }
      return { nodeType: Node.TEXT_NODE, textContent: html } as Node;
    }
    // dynamic：SSR 不渲染（无法创建组件实例）
    return { nodeType: Node.TEXT_NODE, textContent: "" } as Node;
  }

  /**
   * 创建模拟元素节点
   * 包含基本的属性和方法，使组件能够正常初始化
   */
  const mockEl = {
    nodeType: Node.ELEMENT_NODE,
    tagName: String(vnode.tag).toUpperCase(),
    attributes: {},
    style: {},
    childNodes: [],
    appendChild: () => {},
    removeChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => false,
      contains: () => false,
    },
  } as unknown as Element | HTMLElement | SVGElement;

  /**
   * 保存模拟 DOM 引用到虚拟节点
   */
  vnode.el = mockEl;

  /**
   * 递归处理子节点
   */
  if (vnode.children.length > 0) {
    for (const child of vnode.children) {
      materialize(child);
    }
  }

  return mockEl;
}

// ============================================
// 控制流初始化函数（For/Show/Switch/Dynamic）
// ============================================

/**
 * 控制流锚点类型：
 * - Text：空文本节点锚点（现行协议，页面 DOM 与 SSR 输出中均不可见）
 * - Comment：仅为兼容旧版 SSR 输出的 <!--flow--> 注释占位而保留
 */
type FlowAnchor = Text | Comment;

/**
 * 计算最长递增子序列（LIS），返回参与 LIS 的原数组索引集合
 *
 * 用途：For 中间区间的「移动最小化」——oldIndexOfNew 中处于 LIS 的
 * 复用节点保持 DOM 原位不动，其余复用节点才需要 insertBefore 移动。
 *
 * 经典 O(n log n) 二分实现（patience sorting 变体）：
 * - tailsIdx[l]：长度为 l+1 的递增子序列中「结尾值最小」的元素索引
 *   （结尾值越小，后续元素越可能延长序列，贪心最优）
 * - prevIdx[i]：元素 i 在 LIS 构造链上的前驱索引（用于回溯还原完整序列）
 * - 值为 -1 的位置（新 mount 槽位）不参与计算，永远视为「需要处理」
 *
 * @param values - 值数组（-1 表示无值，其余应为互异的非负数）
 * @returns 参与 LIS 的索引集合（处于其中的位置无需移动）
 */
function computeLisIndices(values: number[]): Set<number> {
  /** 结果：LIS 命中的索引集合 */
  const result = new Set<number>();
  const len = values.length;
  if (len === 0) return result;

  /** tailsIdx[l] = 长度为 l+1 的递增子序列的结尾元素索引 */
  const tailsIdx: number[] = [];
  /** 前驱索引链（回溯用，-1 表示链头） */
  const prevIdx: number[] = new Array<number>(len).fill(-1);

  for (let i = 0; i < len; i++) {
    const v = values[i];
    // -1 = 新 mount 槽位，不参与「保持原位」序列
    if (v < 0) continue;

    // 二分查找第一个结尾值 >= v 的槽位（严格递增：等值替换不延长）
    let lo = 0;
    let hi = tailsIdx.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tailsIdx[mid]] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prevIdx[i] = tailsIdx[lo - 1];
    if (lo === tailsIdx.length) tailsIdx.push(i);
    else tailsIdx[lo] = i;
  }

  // 从 LIS 结尾元素回溯出整条命中链
  let cursor = tailsIdx.length > 0 ? tailsIdx[tailsIdx.length - 1] : -1;
  while (cursor !== -1) {
    result.add(cursor);
    cursor = prevIdx[cursor];
  }
  return result;
}

/**
 * For 组件初始化：key-based 列表区间精准更新
 *
 * 维护 Map<key, {vnode, el}> 映射 + 旧 key 顺序快照，effect 监听 each() 变化，
 * 按三步区间算法只处理真正变化的区间（头尾同步区零操作）：
 *
 * 1. 头部同步（公共前缀）：旧新列表头部 key 相同的原位跳过
 * 2. 尾部同步（公共后缀）：旧新列表尾部 key 相同的原位跳过
 * 3. 中间区间 diff：头尾夹逼后仅剩的变化区间——
 *    - 消失 key：destroy(vnode) → Map.delete
 *    - 新增 key：render → materialize → insertBefore → 生命周期
 *    - 复用 key：不重新 render（依赖内部 signal 细粒度更新），
 *      通过最长递增子序列（LIS）最小化移动——只有不在 LIS 中的
 *      复用节点才 insertBefore 重排（DOM 自动从原位置摘除，不重建 vnode）
 *
 * 对比旧的全量遍历：每次重跑对列表中所有 key 执行 Map 查找 + 无条件
 * insertBefore（O(n) 次 DOM 调用）；大列表（如几百集选集）在
 * 「追加/删除单集」「同 key 重新赋值」等场景下，头尾同步可跳过
 * 绝大部分元素，中间区间通常只有个位数节点需要处理。
 *
 * @param vnode - flow VNode（__flow.type === 'for'）
 * @param anchor - 控制流锚点（子 DOM 在其前方插入）
 * @returns dispose 函数（dispose effect + destroy 所有子 VNode）
 */
function initFor(vnode: VNode, anchor: FlowAnchor): () => void {
  const flow = vnode.__flow!;
  const keyFn = flow.key;
  const renderFn = flow.render;

  // key → { vnode, el } 映射（key 类型为 unknown：支持 string/number/object 引用）
  const entries = new Map<unknown, { vnode: VNode; el: Node }>();
  /**
   * 上一次列表的 key 顺序快照（每轮 effect 末尾更新）
   * 头尾同步扫描依赖「有序」数组——Map 只有哈希查找，没有顺序信息
   */
  let oldKeys: unknown[] = [];

  const effectDispose = effect((): void => {
    const parent = anchor.parentNode;
    if (!parent) return; // anchor 未在 DOM 中（理论不会到这，首次运行 parent 是 fragment）

    const eachGetter = flow.each;
    const items = eachGetter ? eachGetter() : [];
    const newLen = items.length;
    const oldLen = oldKeys.length;

    // 新列表的 key 数组（区间判断 / 复用查找 / 顺序快照共用）
    const newKeys: unknown[] = new Array<unknown>(newLen);
    for (let i = 0; i < newLen; i++) {
      const item = items[i];
      // 无 keyFn 时用 item 引用作为 key（Solid <For> 语义）
      newKeys[i] = keyFn ? keyFn(item, i) : item;
    }

    // ============================================
    // 第 1 步：头部同步（公共前缀，原位保留 → 零操作）
    // ============================================
    let start = 0;
    while (
      start < oldLen &&
      start < newLen &&
      oldKeys[start] === newKeys[start]
    ) {
      start++;
    }

    // ============================================
    // 第 2 步：尾部同步（公共后缀，原位保留 → 零操作）
    // ============================================
    let oldEnd = oldLen - 1;
    let newEnd = newLen - 1;
    while (
      oldEnd >= start &&
      newEnd >= start &&
      oldKeys[oldEnd] === newKeys[newEnd]
    ) {
      oldEnd--;
      newEnd--;
    }

    // ============================================
    // 第 3 步：中间区间（唯一可能产生 DOM 操作的区域）
    // oldKeys[start..oldEnd] 与 newKeys[start..newEnd]
    // ============================================
    const oldCount = oldEnd - start + 1;
    const newCount = newEnd - start + 1;

    if (newCount > 0 && oldCount === 0 && renderFn) {
      // ============================================
      // 3A. 纯新增（含首挂载 / 头尾同步后的中间追加）
      //
      // 中间区间没有可复用节点，全部是新 mount：
      // 正序遍历 + 固定参照（尾部同步区首节点或锚点），逐个插到参照
      // 之前自然形成正序——与旧实现的 mount 顺序（render / onMounted
      // 按列表正序触发）保持一致，组件侧观察不到顺序差异
      // ============================================
      const tailEntry =
        newEnd + 1 < newLen ? entries.get(newKeys[newEnd + 1]) : undefined;
      const tailRef: Node = tailEntry !== undefined ? tailEntry.el : anchor;

      for (let j = 0; j < newCount; j++) {
        const newIndex = start + j;
        const item = items[newIndex];
        // renderFn 是用户黑盒回调，必须 untracked 调用（与
        // invokeLifecycle 内的钩子隔离同理）：体内未被编译器下沉到
        // __reactiveAttrs getter 的裸 signal 读取（典型：children 位置的
        // 结构三元快照）若被收集成 flow effect 依赖，该信号每次变化都会
        // 触发整个列表 diff 重跑——与「renderFn 按 key 只调用一次、复用
        // 节点永不重跑」语义相悖，大列表（几百集选集）退化为全量 diff。
        // 掐断收集不改变快照语义：合法的响应式更新走 getter / onEffect，
        // effect 建立全新捕获作用域，不受 untracked 影响
        const childVNode = untracked(() => renderFn(item, newIndex));
        childVNode.__parent = vnode;
        const el = materialize(childVNode);
        // ★ 就地补发生命周期（同 mountFlowChild：列表项不在静态树 children 递归范围）
        invokeLifecycle(childVNode, "onBeforeMount");
        parent.insertBefore(el, tailRef);
        invokeLifecycle(childVNode, "onMounted");
        entries.set(newKeys[newIndex], { vnode: childVNode, el });
      }
    } else if (oldCount > 0) {
      /**
       * 新中间区间的 key → 相对索引映射（复用判定）
       * key 在列表内必须唯一；重复 key 属病态用法，
       * 此处保留首个出现位置，后续重复位置按新 mount 处理（不崩溃）
       */
      const newKeyToIndex = new Map<unknown, number>();
      for (let j = 0; j < newCount; j++) {
        const key = newKeys[start + j];
        if (!newKeyToIndex.has(key)) newKeyToIndex.set(key, j);
      }

      /**
       * oldIndexOfNew[j]：新中间相对位置 j 复用的旧中间相对索引
       * -1 表示该位置是新增（旧列表无此 key）
       */
      const oldIndexOfNew: number[] = new Array<number>(newCount).fill(-1);

      // 3B.1 遍历旧中间区间：key 已消失 → destroy；仍存在 → 记录复用位置
      for (let i = 0; i < oldCount; i++) {
        const key = oldKeys[start + i];
        const target = newKeyToIndex.get(key);
        if (target === undefined) {
          const entry = entries.get(key);
          if (entry !== undefined) {
            destroy(entry.vnode);
            entries.delete(key);
          }
        } else {
          oldIndexOfNew[target] = i;
        }
      }

      // 3B.2 移动最小化：双向都有剩余时计算 LIS——
      //      处于 LIS 的复用节点保持 DOM 原位，其余复用节点才需要移动
      const stableSet =
        newCount > 0 ? computeLisIndices(oldIndexOfNew) : null;

      // 3B.3 逆序遍历新中间区间：mount 新节点 / 移动非 LIS 的复用节点
      //      逆序的必要性：处理位置 j 时，j+1（新列表下一个位置）必然
      //      已就位——要么是原位保留的尾部同步区，要么是本轮刚
      //      mount / 移动的节点，因此总能拿到有效的 insertBefore 参照；
      //      正序无法保证（后续位置可能是尚未移动的复用节点）
      for (let j = newCount - 1; j >= 0; j--) {
        const newIndex = start + j;
        const key = newKeys[newIndex];

        // 参照元素：新列表下一个位置（newIndex+1）的 DOM；
        // 越界说明尾部同步区为空，退回控制流锚点（子 DOM 本就在 anchor 之前）
        const nextEntry =
          newIndex + 1 < newLen
            ? entries.get(newKeys[newIndex + 1])
            : undefined;
        const refEl: Node = nextEntry !== undefined ? nextEntry.el : anchor;

        if (oldIndexOfNew[j] === -1) {
          // 新 key：render → materialize → 生命周期 → 插入
          if (renderFn) {
            const item = items[newIndex];
            // ★ untracked 隔离同上方 3A：renderFn 黑盒回调，掐断体内
            // 裸 signal 读取挂成 flow effect 依赖导致整表 diff 重跑
            const childVNode = untracked(() => renderFn(item, newIndex));
            childVNode.__parent = vnode;
            const el = materialize(childVNode);
            // ★ 就地补发生命周期（同 mountFlowChild：列表项不在静态树 children 递归范围）
            invokeLifecycle(childVNode, "onBeforeMount");
            parent.insertBefore(el, refEl);
            invokeLifecycle(childVNode, "onMounted");
            entries.set(key, { vnode: childVNode, el });
          }
        } else if (stableSet === null || !stableSet.has(j)) {
          // 复用 key 但不在 LIS：移动到正确位置
          // （insertBefore 自动从原位置摘除，不重建 vnode）
          const entry = entries.get(key);
          if (entry !== undefined) {
            parent.insertBefore(entry.el, refEl);
          }
        }
        // 复用且在 LIS 中：原位不动，零操作
      }
    }

    // 本轮列表顺序成为下一轮 diff 的「旧」基准
    oldKeys = newKeys;
  });

  return () => {
    effectDispose();
    for (const [, entry] of entries) {
      destroy(entry.vnode);
    }
    entries.clear();
  };
}

/**
 * 通用 mount/unmount 辅助：处理 VNode 和字符串两种子节点
 *
 * @param child - VNode 或字符串
 * @param vnode - 父 flow VNode（设置 __parent）
 * @param anchor - 控制流锚点
 * @returns { vnode, textNode } 用于后续 unmount
 */
function mountFlowChild(
  child: VNodeChild,
  vnode: VNode,
  anchor: FlowAnchor,
): { vnode: VNode | null; textNode: Text | null } {
  const parent = anchor.parentNode;
  if (!parent) return { vnode: null, textNode: null };

  if (typeof child === "string") {
    // 字符串子节点：创建 Text 节点
    const textNode = document.createTextNode(child);
    parent.insertBefore(textNode, anchor);
    return { vnode: null, textNode };
  }

  // VNode 子节点
  child.__parent = vnode;
  const el = materialize(child);
  /**
   * ★ 就地补发生命周期（与 mount() 顺序一致）：
   * 控制流子节点不在静态 VNode 树的 children 里（存于 __flow.children /
   * __flow.fallback），mount/hydrate 顶层的 invokeLifecycle 递归遍历
   * vnode.children 到达不了这里，必须在动态挂载点就地触发，否则：
   * - onMounted 不执行（组件 mounted 事件链断裂，如 pbpControlsMounted）
   * - lc._effects 不启动（signal 驱动的 class/style/文本更新全部失效）
   * - lifecycle.el 不设置、组件 ref 不赋值
   */
  invokeLifecycle(child, "onBeforeMount");
  parent.insertBefore(el, anchor);
  invokeLifecycle(child, "onMounted");
  return { vnode: child, textNode: null };
}

/**
 * 通用 unmount 辅助：销毁 VNode 或移除 Text 节点
 */
function unmountFlowChild(state: {
  vnode: VNode | null;
  textNode: Text | null;
}): void {
  if (state.vnode) {
    destroy(state.vnode);
    state.vnode = null;
  }
  if (state.textNode) {
    state.textNode.parentNode?.removeChild(state.textNode);
    state.textNode = null;
  }
}

/**
 * Show 组件初始化：条件渲染
 *
 * effect 监听 when()：
 * - true → mount children, destroy fallback
 * - false → destroy children, mount fallback
 * - 不重渲染 children，仅 mount/destroy 切换
 *
 * 关键：切换 effect 的 dispose 挂在 Show VNode._cleanups（由 materialize 处理），
 * 不挂在被切换的子 VNode 上（否则子 VNode destroy 会把切换 effect 一起 dispose）
 */
function initShow(vnode: VNode, anchor: FlowAnchor): () => void {
  const flow = vnode.__flow!;
  const children = flow.children ?? [];
  const fallback = flow.fallback;
  let currentState: { vnode: VNode | null; textNode: Text | null } = {
    vnode: null,
    textNode: null,
  };
  /**
   * 上一次的显隐判定结果（undefined 表示尚未初始化，确保首跑必挂载）
   *
   * ★ 显隐未翻转时跳过重挂：when getter 内可能读取多个 signal，
   *   effect 的依赖集合大于实际翻转条件，「重跑」不等于「翻转」；
   *   无条件「先卸载再重挂」会把非翻转重跑升级为子树销毁重建——
   *   重复触发子组件 onMounted，极易与「挂载即回写」的组件 API
   *   形成回写型循环（Cycle detected 熔断的常见形态）
   */
  let lastVisible: boolean | undefined;

  const effectDispose = effect((): void => {
    const visible = flow.when ? flow.when() : false;
    if (visible === lastVisible) return;
    lastVisible = visible;

    // 先卸载当前内容
    unmountFlowChild(currentState);
    const target = visible ? children : fallback ? [fallback] : [];

    if (target.length > 0) {
      currentState = mountFlowChild(target[0], vnode, anchor);
    }
  });

  return () => {
    effectDispose();
    unmountFlowChild(currentState);
  };
}

/**
 * Switch 组件初始化：多分支条件渲染
 *
 * effect 监听所有 Match 的 when()，挂载第一个匹配分支。
 * 所有 Match 都不匹配时挂载 fallback children。
 * 分支切换：destroy 旧分支，mount 新分支。
 */
function initSwitch(vnode: VNode, anchor: FlowAnchor): () => void {
  const flow = vnode.__flow!;
  const matches = flow.matches ?? [];
  const fallback = flow.children ?? [];
  let currentState: { vnode: VNode | null; textNode: Text | null } = {
    vnode: null,
    textNode: null,
  };
  /**
   * 上一次命中的分支（undefined=未初始化，-1=fallback，-2=无匹配无 fallback）
   * 与 initShow 相同的翻转守卫：命中分支未变化时跳过卸载/重挂
   */
  let lastTarget: number | undefined;

  const effectDispose = effect((): void => {
    // 查找第一个匹配的分支
    let found = false;
    /** 命中的分支下标 */
    let matchIndex = -1;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].when()) {
        matchIndex = i;
        found = true;
        break;
      }
    }

    /** 本次目标：命中分支下标；无命中时 -1=fallback、-2=空 */
    const target = found ? matchIndex : fallback.length > 0 ? -1 : -2;
    if (target === lastTarget) return;
    lastTarget = target;

    // 先卸载当前分支
    unmountFlowChild(currentState);

    if (found && matches[matchIndex].children.length > 0) {
      currentState = mountFlowChild(matches[matchIndex].children[0], vnode, anchor);
    }

    // 无匹配分支时挂载 fallback
    if (!found && fallback.length > 0) {
      currentState = mountFlowChild(fallback[0], vnode, anchor);
    }
  });

  return () => {
    effectDispose();
    unmountFlowChild(currentState);
  };
}

/**
 * Dynamic 组件初始化：动态组件切换
 *
 * effect 监听 component()，切换时 destroy 旧组件 mount 新组件。
 * 使用 h() 创建组件 VNode（处理 ref/providers/lifecycle 等）。
 */
function initDynamic(vnode: VNode, anchor: FlowAnchor): () => void {
  const flow = vnode.__flow!;
  let currentVNode: VNode | null = null;

  const effectDispose = effect((): void => {
    // 先卸载当前组件
    if (currentVNode) {
      destroy(currentVNode);
      currentVNode = null;
    }

    const compGetter = flow.component;
    const comp = compGetter ? compGetter() : undefined;
    if (comp) {
      // 使用 h() 创建组件 VNode（处理 ref/providers/lifecycle 等）
      const childVNode = h(comp, flow.props ?? {});
      childVNode.__parent = vnode;
      const el = materialize(childVNode);
      // ★ 就地补发生命周期（同 mountFlowChild：动态组件不在静态树 children 递归范围）
      invokeLifecycle(childVNode, "onBeforeMount");
      const parent = anchor.parentNode;
      if (parent) {
        parent.insertBefore(el, anchor);
      }
      invokeLifecycle(childVNode, "onMounted");
      currentVNode = childVNode;
    }
  });

  return () => {
    effectDispose();
    if (currentVNode) {
      destroy(currentVNode);
    }
  };
}

// ============================================
// v-* 指令处理函数
// ============================================

/**
 * 类型守卫：判断元素是否有 style 属性（HTMLElement | SVGElement）
 */
function hasStyle(el: Element): el is HTMLElement | SVGElement {
  return el instanceof HTMLElement || el instanceof SVGElement;
}

/**
 * 类型守卫：判断值是否为 getter 函数 () => unknown
 */
function isGetterValue(value: unknown): value is () => unknown {
  return typeof value === "function";
}

/**
 * v-model 双向绑定
 *
 * 根据元素类型选择事件和属性：
 * - input[type=checkbox]：change 事件，读写 checked（boolean）
 * - input[type=radio]：change 事件，读 checked = (value === sig.value)，写 sig.value = input.value
 * - input[其他]/textarea：input 事件，读写 value
 * - select：change 事件，读写 value
 *
 * @param el - 目标元素
 * @param sig - Signal（双向绑定的响应式变量）
 * @returns 清理函数（dispose effect + 移除事件监听）
 */
function applyVModel(el: Element, sig: unknown): (() => void) | undefined {
  if (!isSignalRef(sig)) {
    if (isDev()) {
      warn(WarnSource.MOUNT, "v-model requires a Signal as value");
    }
    return undefined;
  }

  // HTMLInputElement
  if (el instanceof HTMLInputElement) {
    const input = el;
    const type = input.type;

    // checkbox：读写 checked（boolean）
    if (type === "checkbox") {
      const effectDispose = effect(() => {
        input.checked = Boolean(sig.value);
      });
      const handler = () => {
        sig.value = input.checked;
      };
      input.addEventListener("change", handler);
      return () => {
        effectDispose();
        input.removeEventListener("change", handler);
      };
    }

    // radio：读 checked = (value === sig.value)，写 sig.value = input.value
    if (type === "radio") {
      const effectDispose = effect(() => {
        input.checked = input.value === String(sig.value);
      });
      const handler = () => {
        sig.value = input.value;
      };
      input.addEventListener("change", handler);
      return () => {
        effectDispose();
        input.removeEventListener("change", handler);
      };
    }

    // range/text/其他：读写 value
    const effectDispose = effect(() => {
      input.value = String(sig.value);
    });
    const handler = () => {
      sig.value = input.value;
    };
    input.addEventListener("input", handler);
    return () => {
      effectDispose();
      input.removeEventListener("input", handler);
    };
  }

  // HTMLTextAreaElement
  if (el instanceof HTMLTextAreaElement) {
    const textarea = el;
    const effectDispose = effect(() => {
      textarea.value = String(sig.value);
    });
    const handler = () => {
      sig.value = textarea.value;
    };
    textarea.addEventListener("input", handler);
    return () => {
      effectDispose();
      textarea.removeEventListener("input", handler);
    };
  }

  // HTMLSelectElement
  if (el instanceof HTMLSelectElement) {
    const select = el;
    const effectDispose = effect(() => {
      select.value = String(sig.value);
    });
    const handler = () => {
      sig.value = select.value;
    };
    select.addEventListener("change", handler);
    return () => {
      effectDispose();
      select.removeEventListener("change", handler);
    };
  }

  return undefined;
}

/**
 * v-show 显隐控制
 *
 * effect: val → el.style.display（true → ''，false → 'none'）
 * 支持 Signal / getter 函数 / 普通值
 */
function applyVShow(el: Element, val: unknown): (() => void) | undefined {
  if (!hasStyle(el)) return undefined;

  if (isSignalRef(val)) {
    return effect(() => {
      el.style.display = val.value ? "" : "none";
    });
  }
  if (isGetterValue(val)) {
    return effect(() => {
      el.style.display = val() ? "" : "none";
    });
  }
  // 普通值：设置一次
  el.style.display = val ? "" : "none";
  return undefined;
}

/**
 * v-text 文本绑定
 *
 * effect: val → el.textContent
 * 支持 Signal / getter 函数 / 普通值
 */
function applyVText(el: Element, val: unknown): (() => void) | undefined {
  if (isSignalRef(val)) {
    return effect(() => {
      el.textContent = String(val.value);
    });
  }
  if (isGetterValue(val)) {
    return effect(() => {
      el.textContent = String(val());
    });
  }
  // 普通值：设置一次
  el.textContent = String(val);
  return undefined;
}

/**
 * v-html HTML 绑定
 *
 * effect: val → el.innerHTML
 * 支持 Signal / getter 函数 / 普通值
 */
function applyVHtml(el: Element, val: unknown): (() => void) | undefined {
  if (isSignalRef(val)) {
    return effect(() => {
      el.innerHTML = String(val.value);
    });
  }
  if (isGetterValue(val)) {
    return effect(() => {
      el.innerHTML = String(val());
    });
  }
  // 普通值：设置一次
  el.innerHTML = String(val);
  return undefined;
}

// 类型守卫：将 entry 收窄为 [DirectiveFn, unknown]
function isDirectiveEntry(value: unknown): value is [DirectiveFn, unknown] {
  return (
    Array.isArray(value) && value.length >= 2 && typeof value[0] === "function"
  );
}

/**
 * 处理响应式属性（编译期提取的动态表达式）
 * __reactiveAttrs: { key: getter } → 每个属性注册 effect，signal 变化时自动更新
 *
 * mount 与 hydrate 共用此函数：
 * - mount：materialize 创建 DOM 后首次应用
 * - hydrate：SSR HTML 已含初始值，水合时注册 effect 建立响应式依赖，
 *   否则水合页面上所有动态 class/style/checked 等 signal 变化后不再更新
 *
 * 支持的属性类型：
 * - class/className：字符串/数组/对象（normalizeClass 处理），覆盖式更新
 * - style：字符串/对象（normalizeStyle 处理），增量更新（清除不再存在的旧属性）
 * - 其他属性：setAttribute 覆盖式更新
 *
 * effect 的 dispose 推入 cleanups，销毁时自动清理
 *
 * @param el - 目标 DOM 元素
 * @param attrs - 属性对象（含编译期提取的 __reactiveAttrs）
 * @param cleanups - 清理函数收集数组（调用方负责在销毁时统一执行）
 */
function applyReactiveAttrs(
  el: Element,
  attrs: VNodeAttrs,
  cleanups: (() => void)[],
): void {
  const reactiveAttrs = attrs.__reactiveAttrs;
  if (reactiveAttrs !== undefined) {
    for (const rKey in reactiveAttrs) {
      if (!Object.prototype.hasOwnProperty.call(reactiveAttrs, rKey)) continue;
      const getter = reactiveAttrs[rKey];

      /**
       * style 增量更新需要记录上次应用的属性集合
       * 每次 effect 重跑时清除不再存在的旧属性，避免残留
       * 每个 rKey 独立维护一份，避免多个 style 属性互相干扰
       */
      let prevStyleProps: Set<string> | undefined;

      const rDispose = effect(() => {
        const val = getter();

        if (rKey === "class" || rKey === "className") {
          // class：normalizeClass 支持字符串/数组/对象，覆盖式更新（无残留问题）
          const cls = normalizeClass(val as ClassInput);
          if (cls) {
            el.setAttribute("class", cls);
          } else {
            el.removeAttribute("class");
          }
        } else if (rKey === "style") {
          // style：normalizeStyle 支持字符串/对象，增量更新
          // 清除上次的属性，再设置新属性，避免旧属性残留
          if (hasStyle(el)) {
            if (prevStyleProps) {
              for (const oldProp of prevStyleProps) {
                el.style.removeProperty(oldProp);
              }
            }
            prevStyleProps = new Set();
            const normalized = normalizeStyle(val as StyleInput);
            if (normalized) {
              for (const prop in normalized) {
                if (!Object.prototype.hasOwnProperty.call(normalized, prop)) continue;
                const value = normalized[prop];
                el.style.setProperty(prop, value);
                prevStyleProps.add(prop);
              }
            }
          }
        } else {
          // 其他属性：setAttribute 覆盖式更新
          // null/undefined/false → 移除属性（与 Vue 的 falsy 语义一致）
          if (val === null || val === undefined) {
            el.removeAttribute(rKey);
          } else if (typeof val === "boolean") {
            if (val) {
              el.setAttribute(rKey, "");
            } else {
              el.removeAttribute(rKey);
            }
          } else {
            el.setAttribute(rKey, String(val));
          }
        }
      });
      cleanups.push(rDispose);
    }
  }
}

/**
 * 应用属性到 DOM 元素
 * 处理各种类型的属性：普通属性、事件、样式、指令、ref 等
 * 支持 HTML 元素和 SVG 元素（SVGElement 继承自 Element）
 *
 * @param el - 目标 DOM 元素（HTMLElement 或 SVGElement）
 * @param attrs - 属性对象
 * @param vnode - 所属虚拟节点（用于存储清理函数）
 */
export function applyAttrs(
  el: Element | HTMLElement | SVGElement,
  attrs: VNodeAttrs,
  vnode: VNode,
): void {
  /**
   * 清理函数数组
   * 用于存储事件监听和指令的清理函数
   */
  const cleanups: (() => void)[] = [];

  /**
   * 第一步：优先处理编译期预分类的 __ref（如果存在）
   * 编译期：vite-plugin-lumina-compile 将 ref 重命名为 __ref
   * 运行时：优先读取 __ref，fallback 到 ref
   * 统一支持：回调 / 字符串模板引用 / Signal / 旧 {current} 对象
   */
  bindRef(attrs.__ref ?? attrs.ref, el, vnode);

  /**
   * 第二步：优先处理编译期预分类的 __events（如果存在）
   * 编译期：vite-plugin-lumina-compile 将 onXxx 事件提取为 __events 对象
   * 运行时：直接遍历 __events 绑定事件，跳过属性遍历中的 startsWith 判断
   */
  const eventsValue = attrs.__events;
  if (
    eventsValue !== undefined &&
    eventsValue !== null &&
    typeof eventsValue === "object"
  ) {
    const events = eventsValue as Record<string, EventListener>;
    for (const eventName in events) {
      if (Object.prototype.hasOwnProperty.call(events, eventName)) {
        const handler = events[eventName];
        if (typeof handler === "function") {
          el.addEventListener(eventName, handler);
          cleanups.push(() => el.removeEventListener(eventName, handler));
        }
      }
    }
  }

  /**
   * 第三步：处理响应式属性（编译期提取的动态表达式）
   * 与 hydrate 共用 applyReactiveAttrs（见上方函数注释）
   */
  applyReactiveAttrs(el, attrs, cleanups);

  /**
   * 第四步：处理 v-* 指令属性
   *
   * 内置指令：v-model / v-show / v-text / v-html
   * 自定义指令：通过 directive(name, fn) 注册，遇到 v-xxx 时查注册表
   * 每个指令可能返回清理函数，推入 cleanups
   */
  for (const key in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
    if (!key.startsWith("v-")) continue;

    const value = attrs[key];

    if (key === "v-model") {
      const cleanup = applyVModel(el, value);
      if (cleanup) cleanups.push(cleanup);
    } else if (key === "v-show") {
      const cleanup = applyVShow(el, value);
      if (cleanup) cleanups.push(cleanup);
    } else if (key === "v-text") {
      const cleanup = applyVText(el, value);
      if (cleanup) cleanups.push(cleanup);
    } else if (key === "v-html") {
      const cleanup = applyVHtml(el, value);
      if (cleanup) cleanups.push(cleanup);
    } else {
      // 自定义指令：v-xxx → 查注册表
      const dirName = key.slice(2);
      const dirFn = getDirective(dirName);
      if (dirFn) {
        const cleanup = dirFn(el, value);
        if (cleanup !== undefined && typeof cleanup === "function") {
          cleanups.push(cleanup);
        }
      }
    }
  }

  /**
   * 第五步：处理其他属性
   */
  for (const key in attrs) {
    if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;

    const value = attrs[key];

    /**
     * 跳过空值和内部属性
     */
    if (value === null || value === undefined) continue;

    /**
     * 跳过已处理的 ref / __ref / __events / __providers / v-* 指令
     * __providers 由 h()/内部函数在创建 VNode 时提取到 vnode.__providers，
     * 此处兜底跳过，防止任何路径残留的 __providers 被当作 DOM 属性设置
     */
    if (
      key === "ref" ||
      key === "__ref" ||
      key === "__events" ||
      key === "__providers" ||
      key === "__reactiveAttrs" ||
      key.startsWith("v-")
    ) continue;

    /**
     * 处理指令数组
     * 二维数组格式：[[directiveFn, value], ...]
     * 每个指令执行后可能返回清理函数
     */
    if (key === "directives" && Array.isArray(value)) {
      for (const entry of value) {
        if (!isDirectiveEntry(entry)) continue; // 类型收窄，过滤非法 entry
        const [dir, val] = entry; // 安全解构，不再有 any 报错
        const cleanup = dir(el, val); //,安全调用
        if (cleanup !== undefined) {
          cleanups.push(cleanup);
        }
      }
    } else if (key === "svgContent" && typeof value === "string") {
      /**
       * 处理 SVG 内容注入
       * 安全地解析并插入 SVG 字符串
       */
      const fragment = parseSafeSVG(value);
      el.appendChild(fragment);
    } else if (key === "style") {
      if ("style" in el) {
        const raw = attrs[key];
        if (typeof raw === "string" || (typeof raw === "object" && raw !== null && !Array.isArray(raw))) {
          applyStyle(el as HTMLElement | SVGElement, raw);
        }
      }
    } else if (key.startsWith("on") && typeof value === "function") {
      const event = key.slice(2).toLowerCase();
      const handler: EventListener = <EventListener>value;
      el.addEventListener(event, handler);
      cleanups.push(() => el.removeEventListener(event, handler));
    } else if (key === "className" || key === "class") {
      /**
       * 处理 class / className（统一入口，支持字符串/数组/对象）
       *
       * normalizeClass 处理：
       * - 'foo bar'              → 'foo bar'
       * - ['foo', { active: true }] → 'foo active'
       * - { active: true, hidden: false } → 'active'
       * - null / undefined       → ''（不设置属性）
       */
      const cls = normalizeClass(value as Parameters<typeof normalizeClass>[0]);
      if (cls) {
        el.setAttribute("class", cls);
      } else {
        el.removeAttribute("class");
      }
    } else if (DOM_PROPERTIES.has(key)) {
      /**
       * 处理需要直接赋值的 DOM property
       * value/checked/selected 等属性用 setAttribute 不生效或行为异常，
       * 必须直接赋值到 DOM 元素的对应 property 上
       * 参考 React 的实现：对这些属性使用 el[key] = value
       */
      try {
        (el as unknown as Record<string, unknown>)[key] = value;
      } catch {
        /** 某些只读 property 赋值会抛异常，fallback 到 setAttribute */
        el.setAttribute(key, String(value));
      }
    } else {
      /**
       * 处理普通属性
       * SVG 元素或 class 属性使用 setAttribute
       * 其他属性优先使用 DOM 属性，不存在则使用 setAttribute
       */
      el.setAttribute(key, String(value));
    }
  }

  /**
   * 保存清理函数到虚拟节点
   * 销毁时统一调用
   */
  vnode._cleanups = cleanups;
}

/**
 * 安全解析 SVG 字符串
 * 移除潜在的危险元素和属性，防止 XSS 攻击
 *
 * @param svgString - SVG 字符串
 * @returns 清理后的 DocumentFragment
 */
function parseSafeSVG(svgString: string): DocumentFragment {
  /**
   * 使用 DOMParser 解析 SVG 字符串
   */
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");
  const root = doc.documentElement;

  /**
   * 检查解析结果是否为有效的 SVG
   */
  if (root === null || root.nodeName.toLowerCase() !== "svg") {
    return document.createDocumentFragment();
  }

  /**
   * 递归清理不安全的节点和属性
   */
  removeUnsafeNodes(root);

  /**
   * 创建文档片段并导入清理后的 SVG
   */
  const fragment = document.createDocumentFragment();
  fragment.appendChild(document.importNode(root, true));
  return fragment;
}

/**
 * 递归移除 SVG 中的不安全节点和属性
 *
 * @param node - 要检查的节点
 */
function removeUnsafeNodes(node: Node): void {
  if (node.nodeType === Node.ELEMENT_NODE && node instanceof Element) {
    const el = node;
    const tagName = el.tagName.toLowerCase();

    /**
     * 移除危险标签
     * script: 可执行代码
     * use: 可能引用外部资源
     * foreignObject: 可嵌入 HTML
     */
    if (["script", "use", "foreignobject"].includes(tagName)) {
      el.parentNode?.removeChild(el);
      return;
    }

    /**
     * 移除危险属性
     * - 事件处理器（on*）
     * - javascript: 协议的 href/xlink:href（包括 image 标签的外部资源引用）
     */
    Array.from(el.attributes).forEach((attr) => {
      const attrName = attr.name.toLowerCase();
      const attrValue = attr.value.toLowerCase();

      if (
        attrName.startsWith("on") ||
        ((attrName === "href" || attrName === "xlink:href") &&
          attrValue.startsWith("javascript:"))
      ) {
        el.removeAttribute(attr.name);
      }
    });

    /**
     * 递归处理子节点
     */
    Array.from(el.childNodes).forEach(removeUnsafeNodes);
  }
}

/**
 * 销毁虚拟节点及其 DOM
 * 递归触发销毁生命周期并清理资源
 *
 * @param vnode - 要销毁的虚拟节点
 */
export function destroy(vnode: VNode | string): void {
  /**
   * 字符串节点无需处理
   */
  if (typeof vnode === "string") return;

  /**
   * 触发销毁前生命周期钩子
   * 只处理当前节点，不递归（递归由 destroy 自身的递归处理）
   * 避免与 destroy 的递归叠加导致子节点生命周期被重复调用
   */
  processLifecycleForNode(vnode, "onBeforeDestroy");

  /**
   * 执行所有清理函数
   * 包括事件监听移除和指令清理
   */
  vnode._cleanups?.forEach((fn) => fn());

  /**
   * 执行 useState 订阅的取消订阅函数
   * 避免组件销毁后状态变化仍触发 updater
   */
  vnode.lifecycle?._stateCleanups?.forEach((fn) => fn());

  /**
   * 执行响应式 effect 的 dispose 函数
   * （与 useState 退订分离收集，避免 onMounted 重启 effect 时误清订阅）
   */
  vnode.lifecycle?._effectDisposes?.forEach((fn) => fn());

  /**
   * 清空元素 ref（回调 / 字符串 / Signal / {current}）
   * 避免销毁后残留悬挂的 DOM 引用（安全稳定）
   */
  if (vnode.attrs) {
    clearRef(vnode.attrs.__ref ?? vnode.attrs.ref, vnode);
  }

  /**
   * 递归销毁子节点
   * 子节点的 onBeforeDestroy/onDestroyed 在各自的 destroy() 中调用
   * 销毁顺序：子先父后（子组件先从 DOM 移除，父组件后移除）
   */
  for (const child of vnode.children) {
    destroy(child);
  }

  /**
   * 移除多根静态模板的顶层节点（编译期 DOM 化阶段 1）
   * 多根模板没有单一 el 可依赖，__tmplRoots 记录了克隆/水合时收集的顶层节点，
   * destroy 时逐个从 DOM 移除（mount 与 hydrate 两条路径都会填充该数组）
   */
  if (vnode.__tmplRoots !== undefined) {
    for (const node of vnode.__tmplRoots) {
      if (node.parentNode !== null) {
        try {
          node.parentNode.removeChild(node);
        } catch {
          /** 节点已被手动移除，忽略错误 */
        }
      }
    }
  }

  /**
   * 从 DOM 中移除元素
   * 使用 try-catch 防止子节点已被手动移除时抛异常
   */
  if (vnode.el?.parentNode !== null && vnode.el?.parentNode !== undefined) {
    try {
      vnode.el.parentNode.removeChild(vnode.el);
    } catch {
      /** 节点已被手动移除，忽略错误 */
    }
  }

  /**
   * 触发销毁完成生命周期钩子
   * 只处理当前节点，不递归
   */
  processLifecycleForNode(vnode, "onDestroyed");
}

/**
 * 处理单个节点的生命周期钩子和 ref 设置
 * 不递归子节点，由调用方控制递归顺序
 *
 * @param vnode - 虚拟节点
 * @param method - 生命周期方法名
 */
function processLifecycleForNode(vnode: VNode, method: keyof Lifecycle): void {
  const lc = vnode.lifecycle;

  /**
   * onMounted 时先将组件根 DOM 元素设置到 lifecycle.el
   * 这样组件在 onMounted 钩子和响应式 effect 中可以通过 lifecycle.el
   * 访问自己的根元素，用于手动 DOM 更新
   */
  if (lc && method === "onMounted" && vnode.el && vnode.el instanceof Element) {
    lc.el = vnode.el;
  }

  /**
   * onMounted 时启动响应式 effect（signal/computed + onEffect）与 useState 订阅
   * - 在用户 onMounted 之前启动，完成初始渲染与状态同步
   * - 此时 ref.current / lifecycle.el 已就绪
   * - effect 的 dispose 与 useState 的退订分别收集到 _effectDisposes /
   *   _stateCleanups，destroy 时统一清理
   */
  if (
    lc &&
    method === "onMounted" &&
    (lc._effects || lc._stateSubscriptions)
  ) {
    /**
     * ★ 不清空 _effects / _stateSubscriptions：控制流（Show/Switch）卸载→重挂
     *   会复用同一 VNode（children 存于 __flow.children，组件 setup 在 h() 中
     *   只执行一次），重挂时需要再次启动。先执行旧 dispose/退订（幂等，且
     *   destroy 已跑过一遍）避免重复订阅，再启动新实例 ——
     *   任意时刻每个 effect / 订阅只有一份活跃实例。
     */
    if (lc._effects) {
      const effectDisposes = (lc._effectDisposes ??= []);
      for (const dispose of effectDisposes) dispose();
      effectDisposes.length = 0;
      for (const startEffect of lc._effects) {
        const dispose = startEffect();
        if (dispose) {
          effectDisposes.push(dispose);
        }
      }
    }
    /**
     * ★ useState 订阅重建：退订函数收集到 _stateCleanups（与 effect dispose
     *   分离 —— 此前共用一个数组导致首次挂载时 setup 期收集的订阅退订
     *   被 effect 重启逻辑误执行，组件状态订阅在挂载瞬间全部失效）。
     *   启动器内部会以当前值补一次同步，覆盖卸载窗口期内错过的状态变化。
     */
    if (lc._stateSubscriptions) {
      const cleanups = (lc._stateCleanups ??= []);
      for (const unsub of cleanups) unsub();
      cleanups.length = 0;
      for (const startSubscription of lc._stateSubscriptions) {
        cleanups.push(startSubscription());
      }
    }
  }

  if (lc?.[method]) {
    /**
     * ★ untracked 隔离用户钩子内的 signal 读取（防止依赖追踪泄漏）
     *
     * 生命周期钩子是副作用执行点而非渲染逻辑，钩子内读取 signal
     * 应只取快照、不建立依赖（与 Vue3 的 onMounted 语义一致）。
     *
     * 若不隔离：控制流（Show/Switch）effect 挂载组件的同步链会
     * 一直延伸到钩子执行，钩子内读取的 signal（如子组件内部的
     * 数据 signal）会被追踪为「挂载它的控制流 effect」的依赖；
     * 一旦钩子链回写该 signal（典型：onMounted → emit → 父层回调
     * → 子组件 rebuild API 回写内部 signal），控制流 effect 即被
     * 通知重跑 → 无条件重挂子树 → onMounted 再次触发 → 再次回写
     * → 同步死循环，直到 signals-core 的 set 嵌套计数（c>100）
     * 熔断抛出 "Cycle detected"。
     */
    untracked(() =>
      safeCall(
        () => lc[method]!(),
        ErrorSource.LIFECYCLE,
        `Lifecycle hook execution failed: ${method}`,
      ),
    );
  }

  /**
   * 组件实例 ref 处理
   * onMounted 后：将组件暴露的 API 或根 DOM 元素赋值给 ref.current
   * onDestroyed 后：清空 ref.current 防止悬挂引用
   *
   * 与 Vue3 行为一致：
   *   - 如果组件调用了 expose()，ref.current = 暴露的 API 对象
   *   - 如果组件没有 expose()，ref.current = 组件根 DOM 元素（lifecycle.el）
   *   - Vue3 中没有 expose 时 ref 指向组件实例
   *
   * ref 清空时机：onDestroyed（组件完全销毁后清空）
   * 与 Vue3 一致：onUnmounted 之后 ref 才被清空
   */
  if (vnode.lifecycle) {
    if (method === "onMounted" && vnode.lifecycle._ref) {
      const refValue = vnode.lifecycle._ref;
      /**
       * ref 赋值规则（与 Vue3 一致）：
       * 1. 组件调用了 expose() → ref = 暴露的 API 对象
       * 2. 组件未调用 expose() → ref = 组件根 DOM 元素（lifecycle.el ?? vnode.el）
       * 3. 普通 DOM 元素 → ref = DOM 元素（由 applyAttrs/hydrateNode 处理）
       */
      const exposed = vnode.lifecycle._exposed !== undefined
        ? vnode.lifecycle._exposed
        : (vnode.lifecycle.el ?? vnode.el ?? null);

      if (isSignalRef(refValue)) {
        refValue.value = exposed;
      } else if (isRefObject(refValue)) {
        refValue.current = exposed as unknown;
      }
    }
    if (method === "onDestroyed" && vnode.lifecycle._ref) {
      const refValue = vnode.lifecycle._ref;
      if (isSignalRef(refValue)) {
        refValue.value = null;
      } else if (isRefObject(refValue)) {
        refValue.current = null;
      }
    }
    // 组件销毁时清空所有模板引用 Signal，避免悬挂 DOM 引用
    if (method === "onDestroyed" && vnode.lifecycle._templateRefs) {
      for (const sig of vnode.lifecycle._templateRefs.values()) {
        sig.value = null;
      }
    }
  }
}

/**
 * 调用生命周期钩子
 * 递归遍历虚拟节点树，调用指定生命周期方法
 *
 * 递归顺序（与 Vue3 一致）：
 *   - onBeforeMount / onBeforeDestroy：父先子后（父组件先收到通知）
 *   - onMounted / onDestroyed：子先父后（子组件先完成挂载/销毁）
 *
 * 这确保了：
 *   - 父组件 onMounted 时，所有子组件已经挂载完成，ref 已设置
 *   - 父组件 onBeforeDestroy 时，子组件还未销毁，仍可访问
 *
 * @param vnode - 虚拟节点
 * @param method - 生命周期方法名
 */
export function invokeLifecycle(
  vnode: VNode | string,
  method: keyof Lifecycle,
): void {
  if (typeof vnode === "string") return;

  const isBeforePhase =
    method === "onBeforeMount" || method === "onBeforeDestroy";

  if (isBeforePhase) {
    /**
     * onBeforeMount / onBeforeDestroy：先处理当前节点，再递归子节点
     * 父组件先收到通知，子组件后收到通知
     */
    processLifecycleForNode(vnode, method);
    for (const child of vnode.children) {
      invokeLifecycle(child, method);
    }
  } else {
    /**
     * onMounted / onDestroyed：先递归子节点，再处理当前节点
     * 子组件先完成挂载/销毁，父组件后完成
     * 这确保父组件 onMounted 时可以访问子组件的 ref
     */
    for (const child of vnode.children) {
      invokeLifecycle(child, method);
    }
    processLifecycleForNode(vnode, method);
  }
}

/**
 * 客户端水合
 * 将服务端渲染的 DOM 与虚拟节点关联，绑定事件、ref、生命周期
 * 不重新创建 DOM，而是复用已有的 DOM 结构
 *
 * 水合流程（与 mount 等价，但复用已有 DOM）：
 *   1. 遍历 VNode 树，匹配已有 DOM 节点
 *   2. 将 el 存储到 vnode.el（后续 useState updater 等需要访问）
 *   3. 绑定 ref（回调 ref 和对象 ref）
 *   4. 绑定事件监听器（onClick → addEventListener）
 *   5. 收集清理函数（事件移除等，销毁时调用）
 *   6. 调用生命周期钩子（onBeforeMount → onMounted）
 *
 * @param vnode - 虚拟节点
 * @param container - 已有的 DOM 容器（包含服务端渲染的 HTML）
 */
export function hydrate(vnode: VNode | string, container: HTMLElement): void {
  if (!isBrowser()) return;

  if (typeof vnode === "string") return;

  /**
   * 从容器的第一个子节点开始顺序水合。
   *
   * 这里不能只找第一个 Element：
   * - Fragment 会直接输出多个兄弟节点
   * - 文本节点也可能是根节点或子节点
   *
   * hydrateNode() 会返回“下一个未消费的 DOM 节点”，
   * 这样才能按 SSR 输出顺序把整棵树完整对齐。
   *
   * firstChild 可能为 null（如根节点是控制流：SSR 不输出任何占位），
   * container 作为 parent 传入，控制流仍可在其中创建锚点并渲染子树。
   */
  hydrateNode(vnode, container.firstChild, container);

  /**
   * 触发生命周期钩子
   * 水合完成后，与 mount 一样触发 onBeforeMount 和 onMounted
   * 这样组件的 onMounted 钩子可以安全地访问 DOM 元素
   */
  invokeLifecycle(vnode, "onBeforeMount");
  invokeLifecycle(vnode, "onMounted");
}

/**
 * 类型守卫：判断节点是否为 Text 文本节点
 * nodeType === 3 时按 DOM 规范只可能是 Text，无需 instanceof（避免跨 realm 问题）
 */
function isTextNode(node: ChildNode): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

/**
 * 类型守卫：判断节点是否为 Comment 注释节点
 * nodeType === 8 时按 DOM 规范只可能是 Comment
 */
function isCommentNode(node: ChildNode): node is Comment {
  return node.nodeType === Node.COMMENT_NODE;
}

/**
 * 控制流节点水合（For/Show/Switch/Dynamic）
 *
 * SSR 端 __flow 输出空字符串（见 ssr.ts），不再输出任何占位注释，
 * 控制流内容全部由客户端渲染。水合时在当前位置插入不可见的空 Text 锚点，
 * 再以该锚点运行 initFor/initShow/initSwitch/initDynamic，
 * 动态子树渲染后插入锚点之前（与 mount 的 materialize 行为一致）。
 *
 * 兼容旧版 SSR 输出（游标不错位）：
 * - <!--flow--> 注释：直接复用为锚点
 * - <__flow> 空元素：替换为 Text 锚点后移除
 *
 * @param vnode - flow VNode
 * @param el - 当前游标节点；null 表示该位置无 DOM 输出（锚点追加到 parent 末尾）
 * @param parent - 锚点插入的父节点
 * @returns 下一个未消费的 DOM 节点（控制流自身不消费任何 SSR 节点）
 */
function hydrateFlowNode(
  vnode: VNode,
  el: ChildNode | null,
  parent: ParentNode,
): ChildNode | null {
  let anchor: FlowAnchor;
  if (el !== null && isCommentNode(el)) {
    // 旧版 SSR 输出的 <!--flow--> 注释：直接复用为锚点
    anchor = el;
  } else if (el instanceof Element && el.tagName.toLowerCase() === "__flow") {
    // 更早期 SSR 输出的 <__flow> 空元素：替换为不可见的 Text 锚点
    anchor = document.createTextNode("");
    parent.insertBefore(anchor, el);
    parent.removeChild(el);
  } else {
    // 现行协议：SSR 无输出，在 el 之前插入锚点（el 为 null 时追加到末尾）
    anchor = document.createTextNode("");
    parent.insertBefore(anchor, el);
  }
  vnode.el = anchor;

  let dispose: (() => void) | undefined;
  const flowType = vnode.__flow!.type;
  if (flowType === "for") {
    dispose = initFor(vnode, anchor);
  } else if (flowType === "show") {
    dispose = initShow(vnode, anchor);
  } else if (flowType === "switch") {
    dispose = initSwitch(vnode, anchor);
  } else if (flowType === "dynamic") {
    dispose = initDynamic(vnode, anchor);
  }
  if (dispose) {
    if (!vnode._cleanups) vnode._cleanups = [];
    vnode._cleanups.push(dispose);
  }
  return anchor.nextSibling;
}

/**
 * 递归水合单个节点
 * 将 VNode 与已有 DOM 元素关联：存储 el、绑定 ref/事件、收集清理函数
 *
 * 水合时不重新设置属性（属性已在 SSR 中设置），只绑定事件和 ref
 *
 * @param vnode - 虚拟节点
 * @param el - 对应的已有 DOM 节点；null 表示 SSR 在该位置无输出
 * @param parent - el 所在的父节点（el 为 null 时控制流依托它插入锚点）
 */
function hydrateNode(
  vnode: VNode,
  el: ChildNode | null,
  parent: ParentNode,
): ChildNode | null {
  /**
   * el 为 null：SSR 在该位置没有任何输出。
   * 仅控制流支持此情况（SSR 不渲染控制流初始内容、也不输出占位，
   * 子树全部由客户端渲染，依托 parent 创建锚点）；
   * 其它类型的 vnode 没有可对齐的 DOM，保守跳过。
   */
  if (el === null) {
    if (vnode.__flow !== undefined) {
      return hydrateFlowNode(vnode, null, parent);
    }
    return null;
  }
  /**
   * 静态模板节点水合（编译期 DOM 化阶段 1）
   *
   * SSR 端 __tmpl 直接输出了模板 HTML（见 ssr.ts），客户端水合时：
   * - 不克隆、不递归子节点（静态内容与 SSR 输出天然一致，跳过整段对齐）
   * - 单根：采用当前 DOM 节点为 vnode.el，游标前进一个（nextSibling）
   * - 多根：按 roots 数跳过并收集兄弟节点到 __tmplRoots（destroy 清理用），
   *   返回最后一个节点之后的节点（与 Fragment 水合的游标语义一致）
   * - roots === 0：SSR 未输出任何节点，游标不动（当前节点留给下一个兄弟）
   */
  if (vnode.__tmpl !== undefined) {
    const roots = vnode.__tmpl.roots;
    if (roots === 1) {
      if (el instanceof Element) {
        vnode.el = el;
      }
      return el.nextSibling;
    }
    if (roots === 0) {
      return el;
    }
    let current: ChildNode | null = el;
    const collected: Node[] = [];
    for (let i = 0; i < roots && current !== null; i++) {
      collected.push(current);
      current = current.nextSibling;
    }
    vnode.__tmplRoots = collected;
    return current;
  }

  /**
   * 组件类型 VNode：组件函数已经在 h() 中执行过
   * 组件返回的 VNode 存储在 vnode 的结构中
   * 需要找到组件返回的实际 VNode，然后递归水合其子树
   */
  if (typeof vnode.tag === "function") {
    /**
     * 存储组件 VNode 的 el 引用
     * 组件 VNode 的 el 指向其返回的根 DOM 元素
     */
    vnode.el = el instanceof Element ? el : undefined;

    /**
     * 组件 VNode 的 children 中包含组件返回的实际 VNode
     * 需要递归水合这些子 VNode
     * 注意：defineComponent 返回的 VNode 结构中，
     * 组件返回的 VNode 就是 vnode 本身（tag 已经被替换为实际标签）
     * 但函数组件的 vnode.tag 仍然是函数，需要跳过组件层直接水合子节点
     */
    const children = vnode.children || [];
    let domChild: ChildNode | null = el.firstChild;
    for (const child of children) {
      if (typeof child === "string") {
        domChild = domChild?.nextSibling ?? null;
        continue;
      }
      if (child && domChild) {
        // ★ 建立 __parent 链（与 materialize 一致），供 useTemplateRef 字符串 ref 沿链解析
        if (child.__parent === undefined) child.__parent = vnode;
        domChild = hydrateNode(child, domChild, domChild.parentNode ?? parent);
      }
    }
    return el.nextSibling;
  }

  /**
   * 响应式文本节点水合：
   * 期望 DOM 对应位置是 Text 节点（SSR 端 __reactive 求值输出纯文本）。
   * 注册 effect 建立响应式依赖，signal 变化时自动更新 textContent。
   */
  if (vnode.__reactive !== undefined) {
    if (isTextNode(el)) {
      vnode.el = el;
      const textNode = el;
      const dispose = effect(() => {
        textNode.textContent = vnode.__reactive!.get();
      });
      if (!vnode._cleanups) vnode._cleanups = [];
      vnode._cleanups.push(dispose);
    }
    // el 非 Text（SSR 版本错位）→ 保守跳过，不告警不错位扩散
    return el.nextSibling;
  }

  /**
   * 控制流节点水合：
   * SSR 端 __flow 输出 <!--flow--> 注释（见 ssr.ts），控制流内容在客户端渲染。
   * 以该注释为锚点运行 initFor/initShow/initSwitch/initDynamic，
   * 动态子树渲染后插入锚点之前（与 mount 的 materialize 行为一致）。
   * 若 el 是旧版 SSR 输出的 <__flow> 空元素，先替换为注释锚点再 init。
   */
  if (vnode.__flow !== undefined) {
    let anchor: Comment;
    if (isCommentNode(el)) {
      anchor = el;
    } else {
      anchor = document.createComment("flow");
      el.parentNode?.insertBefore(anchor, el);
      el.parentNode?.removeChild(el);
    }
    vnode.el = anchor;

    let dispose: (() => void) | undefined;
    const flowType = vnode.__flow.type;
    if (flowType === "for") {
      dispose = initFor(vnode, anchor);
    } else if (flowType === "show") {
      dispose = initShow(vnode, anchor);
    } else if (flowType === "switch") {
      dispose = initSwitch(vnode, anchor);
    } else if (flowType === "dynamic") {
      dispose = initDynamic(vnode, anchor);
    }
    if (dispose) {
      if (!vnode._cleanups) vnode._cleanups = [];
      vnode._cleanups.push(dispose);
    }
    return anchor.nextSibling;
  }

  /**
   * Fragment 不对应真实 DOM 节点，它直接消费一段连续的兄弟节点。
   * 这里必须顺序递归并返回最后一个子节点之后的节点，
   * 否则多根 SSR 输出只能绑定到第一个子节点。
   */
  if (String(vnode.tag).toLowerCase() === "fragment") {
    let current: ChildNode | null = el;
    // fragment 的全部子节点共享同一父节点，控制流锚点依托它插入
    const fragParent = el.parentNode ?? parent;
    for (const child of vnode.children || []) {
      if (typeof child === "string") {
        current = current?.nextSibling ?? null;
        continue;
      }
      // current 为 null 时仅控制流子节点继续水合（SSR 不输出占位，锚点依托父节点创建）
      if (child && (current !== null || child.__flow !== undefined)) {
        // ★ 建立 __parent 链（与 materialize 一致）
        if (child.__parent === undefined) child.__parent = vnode;
        current = hydrateNode(child, current, fragParent);
      }
    }
    return current;
  }

  /**
   * 原生元素：存储 el、绑定 ref、绑定事件、收集清理函数
   * 与 mount 中的 applyAttrs 逻辑等价，但不设置属性（属性已在 SSR 中设置）
   *
   * 使用 instanceof Element 判断，覆盖 HTMLElement 和 SVGElement
   * （SVGElement 继承自 Element，SVGAElement 只是 <a> 元素的类型）
   */
  if (el instanceof Element) {
    /**
     * Mismatch 检测：检查 VNode.tag 与 DOM tagName 是否匹配
     * SSR 和客户端渲染结果不一致时，开发环境输出警告
     * 不匹配时不中断水合，继续绑定事件和 ref
     */
    const vnodeTag = String(vnode.tag).toLowerCase();
    const domTag = el.tagName.toLowerCase();
    if (vnodeTag !== "fragment" && vnodeTag !== domTag) {
      if (isDev()) {
        console.warn(
          `[Lumina/hydrate] Tag mismatch: VNode tag "${vnodeTag}" does not match DOM tag "${domTag}"`,
        );
      }
    }

    /** 存储 DOM 引用到 vnode，后续 useState updater 等需要访问 */
    vnode.el = el;

    const attrs = vnode.attrs || {};

    /**
     * 清理函数数组
     * 收集事件监听的移除函数，销毁时统一调用
     */
    const cleanups: (() => void)[] = [];

    /**
     * 绑定 ref（统一支持回调 / 字符串模板引用 / Signal / 旧 {current} 对象）
     *
     * ★ 优先读取编译期预分类的 __ref（与 applyAttrs 一致）
     * 编译器将 ref → __ref，若只读 attrs.ref，编译产物水合时 ref 会全部失效
     */
    bindRef(attrs.__ref ?? attrs.ref, el, vnode);

    /**
     * 绑定事件监听器
     * SSR 输出的 HTML 中没有事件（onclick 等不序列化到 HTML）
     * 水合时必须重新绑定所有事件监听器
     *
     * ★ 优先使用编译期预分类的 __events（与 applyAttrs 一致）
     * 编译器将 onXxx → __events: { xxx: handler }，跳过 startsWith+typeof 检查
     */
    const preClassifiedEvents = attrs.__events as Record<string, EventListener> | undefined;
    if (preClassifiedEvents) {
      for (const eventName in preClassifiedEvents) {
        if (!Object.prototype.hasOwnProperty.call(preClassifiedEvents, eventName)) continue;
        const handler = preClassifiedEvents[eventName];
        if (typeof handler === "function") {
          el.addEventListener(eventName, handler);
          cleanups.push(() => el.removeEventListener(eventName, handler));
        }
      }
    } else {
      // fallback：未编译代码，遍历 attrs 按 onXxx 约定查找
      for (const key in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
        if (!key.startsWith("on") || typeof attrs[key] !== "function") continue;

        const eventType = key.slice(2).toLowerCase();
        const handler: EventListener = attrs[key] as EventListener;
        el.addEventListener(eventType, handler);
        cleanups.push(() => el.removeEventListener(eventType, handler));
      }
    }

    /**
     * 处理指令（与 mount 中的 applyAttrs 逻辑一致）
     * 水合时也需要执行指令，否则指令不生效
     */
    if (attrs.directives && Array.isArray(attrs.directives)) {
      for (const entry of attrs.directives) {
        if (!isDirectiveEntry(entry)) continue;
        const [dir, val] = entry;
        const cleanup = dir(el, val);
        if (cleanup !== undefined) {
          cleanups.push(cleanup);
        }
      }
    }

    /**
     * 处理响应式属性（与 mount 的 applyAttrs 逻辑一致）
     * SSR HTML 中已序列化初始值，水合时注册 effect 建立响应式依赖，
     * signal 变化后动态 class/style/checked 等才能自动更新；
     * 缺失此步骤会导致水合页面上所有响应式属性停留在 SSR 初值
     */
    applyReactiveAttrs(el, attrs, cleanups);

    /**
     * 保存清理函数到虚拟节点
     * 销毁时统一调用，移除所有事件监听和指令清理
     */
    vnode._cleanups = cleanups;

    /**
     * 处理组件实例 ref（lifecycle._ref）
     * 如果该元素是组件的根元素，且组件有 expose API，
     * 在 onMounted 后将 exposed API 赋值给 ref.current
     * 这部分在 invokeLifecycle 中处理
     */
  }

  /**
   * 递归水合子节点
   * VNode 子节点与 DOM 子节点一一对应；
   * 控制流子节点例外（SSR 不输出占位，domChild 为 null 时仍需水合，
   * 依托当前元素创建锚点渲染子树）
   */
  const children = vnode.children || [];
  // 子节点的父容器：el 为元素时即 el；游标错位（el 非元素）时回退到传入的 parent
  const childParent: ParentNode = el instanceof Element
    ? el
    : el.parentNode ?? parent;
  let domChild = el.firstChild;

  for (const child of children) {
    if (typeof child === "string") {
      domChild = domChild?.nextSibling ?? null;
      continue;
    }
    if (child && (domChild !== null || child.__flow !== undefined)) {
      // ★ 建立 __parent 链（与 materialize 一致），供 useTemplateRef 字符串 ref 沿链解析
      if (child.__parent === undefined) child.__parent = vnode;
      domChild = hydrateNode(child, domChild, childParent);
    }
  }
  return el.nextSibling;
}
