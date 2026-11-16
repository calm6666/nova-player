/**
 * Lumina 编译插件 v2 转换核心
 *
 * 把框架 h() 调用切分为静态骨架与动态洞：静态结构序列化为模板字符串，
 * 文本/属性/事件/ref/内容/指令/子节点洞在克隆后按位置绑定。
 *
 */
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
import MagicString from "magic-string";
import { SVG_TAGS } from "../compiler-shared/svgTags";
import {
  HTML_VOID_TAGS,
  TEMPLATE_UNSAFE_ROOTS,
  escapeHtmlText,
  isStaticValue,
  serializeStaticAttrs,
} from "../compiler-shared/static";
import type { LuminaCompileV2Options } from "./types";

type Binding = { path: BabelPath };

type BabelPath = {
  node: t.Node;
  parentPath: BabelPath | null;
  scope: { getBinding(name: string): Binding | undefined };
  isCallExpression(): boolean;
  isImportSpecifier(): boolean;
  isImportDeclaration(): boolean;
  findParent(predicate: (path: BabelPath) => boolean): BabelPath | null;
};

type TraverseFn = (
  ast: t.File,
  visitor: { CallExpression?: { exit?: (path: BabelPath) => void } },
) => void;

const traverse: TraverseFn = ((_traverse as unknown as { default?: unknown })
  .default || _traverse) as unknown as TraverseFn;

interface HoleCode {
  kind:
    | "elementText"
    | "text"
    | "attr"
    | "child"
    | "event"
    | "ref"
    | "content"
    | "directive"
    | "attrs";
  root?: number;
  path?: number[];
  parent?: number[];
  anchorChild?: number;
  anchorOffset?: number;
  name?: string;
  getter: string;
}

interface SkeletonCode {
  html: string;
  parts: Array<string | number>;
  holes: HoleCode[];
  roots: number;
}

export interface V2TransformResult {
  code: string;
  map: unknown;
}

/** 判断标识符是否为框架模块的具名导入（支持 import { x as y }） */
function isFrameworkNamedImport(
  path: BabelPath,
  localName: string,
  importedName: string,
): boolean {
  const binding = path.scope.getBinding(localName);
  if (!binding) return false;
  const specPath = binding.path;
  if (!specPath.isImportSpecifier()) return false;
  const spec = specPath.node;
  if (!t.isImportSpecifier(spec)) return false;
  const imported = t.isIdentifier(spec.imported)
    ? spec.imported.name
    : spec.imported.value;
  if (imported !== importedName) return false;
  const declPath = specPath.parentPath;
  if (!declPath || !declPath.isImportDeclaration()) return false;
  const decl = declPath.node;
  if (!t.isImportDeclaration(decl)) return false;
  return /core|lumina|nova/.test(decl.source.value);
}

/** 是否为来自框架模块的 h() 调用 */
function isFrameworkHCall(path: BabelPath): boolean {
  const node = path.node;
  if (!t.isCallExpression(node) || !t.isIdentifier(node.callee)) return false;
  return isFrameworkNamedImport(path, node.callee.name, "h");
}

/** 是否为框架 i18n t() 调用（求值为字符串） */
function isFrameworkTCall(path: BabelPath): boolean {
  const node = path.node;
  if (!t.isCallExpression(node) || !t.isIdentifier(node.callee)) return false;
  return isFrameworkNamedImport(path, node.callee.name, "t");
}

/** 静态文本值；返回 null 表示不是静态文本 */
function staticTextOf(node: t.Node): string | null {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? "";
  }
  if (t.isNumericLiteral(node)) return String(node.value);
  if (
    t.isUnaryExpression(node) &&
    node.operator === "-" &&
    t.isNumericLiteral(node.argument)
  ) {
    return String(-node.argument.value);
  }
  if (t.isBooleanLiteral(node) || t.isNullLiteral(node)) return "";
  return null;
}

/** 追加静态片段，合并相邻字符串减少 parts 数量 */
function appendStatic(out: SkeletonCode, chunk: string): void {
  if (chunk === "") return;
  out.html += chunk;
  const last = out.parts[out.parts.length - 1];
  if (typeof last === "string") {
    out.parts[out.parts.length - 1] = last + chunk;
  } else {
    out.parts.push(chunk);
  }
}

/** 生成「取一次值」的文本表达式：零参箭头需要显式调用 */
function textValueExpr(node: t.Node, code: string): string {
  const source = code.slice(node.start!, node.end!);
  if (t.isArrowFunctionExpression(node) && node.params.length === 0) {
    return `(${source})()`;
  }
  return `(${source})`;
}

/** 是否为可用于文本合并的动态文本子节点 */
function isDynamicTextChild(
  node: t.Node,
  validH: Set<t.Node>,
  validT: Set<t.Node>,
): boolean {
  if (staticTextOf(node) !== null) return false;
  if (validH.has(node)) return false;
  // 显式响应式文本协议：零参箭头函数
  if (t.isArrowFunctionExpression(node) && node.params.length === 0) {
    return true;
  }
  // 框架 i18n t() 求值为字符串
  if (validT.has(node)) return true;
  // 其它 CallExpression 可能返回 VNode（组件、render()），走 child 洞
  if (t.isCallExpression(node)) return false;
  // 三元 / 逻辑表达式可能返回 VNode，保守走 child 洞
  if (t.isConditionalExpression(node) || t.isLogicalExpression(node)) {
    return false;
  }
  if (
    t.isObjectExpression(node) ||
    t.isArrayExpression(node) ||
    t.isSpreadElement(node) ||
    t.isJSXElement(node) ||
    t.isJSXFragment(node)
  ) {
    return false;
  }
  // 普通标识符可能是 VNode 变量（例如替换插槽解析出的节点），保守走 child 洞：
  // child 洞对 string / number 同样按文本插入，行为与 text 洞一致，但也能挂载 VNode。
  if (t.isIdentifier(node)) return false;
  // 成员访问只有「响应式访问」才继续走 text 洞（signal.value / props.x / this.x），
  // 其它成员访问（如 hit.node、row.dateKey）可能是 VNode，走 child 洞。
  if (t.isMemberExpression(node)) return isReactiveMemberAccess(node);
  // TemplateLiteral / BinaryExpression 等与 v1 动态文本规则一致
  return true;
}

/** 判断成员访问是否为响应式读取（signal.value / props.xxx / this.xxx 链路） */
function isReactiveMemberAccess(node: t.MemberExpression): boolean {
  if (isReactiveKey(node.property)) return true;
  let current: t.Node = node;
  while (t.isMemberExpression(current)) {
    if (isReactiveKey(current.property)) return true;
    if (t.isIdentifier(current.object) && current.object.name === "props") {
      return true;
    }
    current = current.object;
  }
  return t.isThisExpression(current);
}

/** 响应式键：signal 的 value 读取 */
function isReactiveKey(key: t.Node): boolean {
  return (
    (t.isIdentifier(key) && key.name === "value") ||
    (t.isStringLiteral(key) && key.value === "value")
  );
}

/** 不能进入骨架模板的运行时属性 */
const RESERVED_ATTR_KEYS = new Set([
  "__events",
  "__providers",
  "__reactiveAttrs",
  "key",
]);

const CONTENT_ATTRS = new Set(["innerHTML", "textContent", "svgContent"]);

interface SplitAttrs {
  staticAttrs: string;
  dynamic: Array<{ name: string; getter: string }>;
  events: Array<{ name: string; getter: string }>;
  refs: Array<{ name: string; getter: string }>;
  contents: Array<{
    mode: "innerHTML" | "textContent" | "svgContent";
    getter: string;
  }>;
  directives: Array<{ name: string; getter: string }>;
}

/**
 * 拆分静态属性、动态属性洞与事件洞
 *
 * attrs 不是对象字面量（变量 / 调用结果），或对象里含展开 / 计算属性 /
 * 内部保留键（__reactiveAttrs / __events / __providers / ref 由编译期预分类）
 * 时返回 null：该 h() 调用不骨架化，交给 v1 编译器静态处理
 * （v1 认识 __reactiveAttrs / __events / __ref 等运行时协议），
 * 避免把内部协议键当成普通属性而丢失 SSR 序列化语义。
 */
function splitAttrs(
  attrsArg: t.Node | undefined,
  code: string,
): SplitAttrs | null {
  const result: SplitAttrs = {
    staticAttrs: "",
    dynamic: [],
    events: [],
    refs: [],
    contents: [],
    directives: [],
  };
  if (attrsArg === undefined) return result;
  if (t.isNullLiteral(attrsArg) || t.isBooleanLiteral(attrsArg)) {
    return result;
  }
  if (!t.isObjectExpression(attrsArg)) return null;

  const staticProps: t.ObjectProperty[] = [];
  const seen = new Set<string>();

  for (const prop of attrsArg.properties) {
    if (!t.isObjectProperty(prop) || prop.computed) return null;
    const keyNode = prop.key;
    const name = t.isIdentifier(keyNode)
      ? keyNode.name
      : t.isStringLiteral(keyNode)
        ? keyNode.value
        : null;
    if (name === null) return null;
    if (RESERVED_ATTR_KEYS.has(name)) return null;
    if (seen.has(name)) return null;
    seen.add(name);

    const value = prop.value;
    const source = code.slice(value.start ?? 0, value.end ?? 0);
    if (CONTENT_ATTRS.has(name)) {
      result.contents.push({
        mode: name as "innerHTML" | "textContent" | "svgContent",
        getter: `() => (${source})`,
      });
      continue;
    }
    if (name.startsWith("v-")) {
      result.directives.push({ name, getter: `() => (${source})` });
      continue;
    }
    if (name === "ref" || name === "__ref") {
      result.refs.push({ name, getter: `() => (${source})` });
      continue;
    }
    if (name.startsWith("on")) {
      result.events.push({ name, getter: `() => (${source})` });
      continue;
    }
    if (isStaticValue(value)) {
      staticProps.push(prop);
      continue;
    }
    result.dynamic.push({
      name,
      getter: `() => (${source})`,
    });
  }

  if (staticProps.length > 0) {
    const serialized = serializeStaticAttrs(t.objectExpression(staticProps));
    if (serialized === null) return null;
    result.staticAttrs = serialized;
  }
  return result;
}

/** 子节点计划：静态文本 / 静态元素 / 动态文本 / 动态子节点 / fragment 子节点 */
type ChildPlan =
  | { kind: "text"; value: string }
  | { kind: "element"; node: t.CallExpression }
  | { kind: "dynamicText"; node: t.Node }
  | { kind: "dynamicChild"; node: t.Node }
  | { kind: "fragChild"; node: t.CallExpression };

/** 动态子节点的 getter：数组 / 展开元素统一包装成 fragment VNode */
function childHoleGetter(node: t.Node, code: string): string {
  if (t.isSpreadElement(node)) {
    const arg = node.argument;
    return `() => _frag(${code.slice(arg.start ?? 0, arg.end ?? 0)})`;
  }
  const source = code.slice(node.start ?? 0, node.end ?? 0);
  if (t.isArrayExpression(node)) return `() => _frag(${source})`;
  return `() => (${source})`;
}

/** 归类一个 h() 调用的子节点 */
function planChildren(
  children: t.Node[],
  validH: Set<t.Node>,
  validT: Set<t.Node>,
): ChildPlan[] {
  const plans: ChildPlan[] = [];
  for (const child of children) {
    const text = staticTextOf(child);
    if (text !== null) {
      plans.push({ kind: "text", value: text });
      continue;
    }

    if (validH.has(child) && t.isCallExpression(child)) {
      const tag = child.arguments[0];
      if (t.isStringLiteral(tag) && tag.value !== "fragment") {
        plans.push({ kind: "element", node: child });
      } else if (t.isStringLiteral(tag) && tag.value === "fragment") {
        plans.push({ kind: "fragChild", node: child });
      } else {
        // 动态组件子节点
        plans.push({ kind: "dynamicChild", node: child });
      }
      continue;
    }

    if (isDynamicTextChild(child, validH, validT)) {
      plans.push({ kind: "dynamicText", node: child });
      continue;
    }

    plans.push({ kind: "dynamicChild", node: child });
  }
  return plans;
}

/**
 * 子节点布局：把计划映射成「模板静态子节点序列 + 每个动态洞的插入编码」
 *
 * 静态子节点按下标计数（相邻静态文本合并为一个文本段，与 HTML 解析一致）；
 * 动态洞记录 anchorChild（静态子节点下标）+ anchorOffset（文本段内字符偏移）。
 * 运行时按该编码插到静态锚点之前，插入前用 splitText 拆开静态文本 ——
 * 全程不需要任何注释 / 文本占位节点。
 */
interface ChildLayout {
  /** 静态子节点序列：text 表示一个文本段，element 表示一个静态元素 */
  staticNodes: Array<"text" | "element">;
  /** 动态 plan 下标 → 插入编码 */
  slots: Map<number, { anchorChild: number; anchorOffset: number }>;
}

function layoutChildren(plans: ChildPlan[]): ChildLayout {
  const staticNodes: Array<"text" | "element"> = [];
  const slots = new Map<
    number,
    { anchorChild: number; anchorOffset: number }
  >();
  let runText = "";
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (plan.kind === "text") {
      const last = staticNodes[staticNodes.length - 1];
      if (last === "text") {
        runText += plan.value;
      } else {
        staticNodes.push("text");
        runText = plan.value;
      }
      continue;
    }
    if (plan.kind === "element") {
      staticNodes.push("element");
      runText = "";
      continue;
    }
    const last = staticNodes[staticNodes.length - 1];
    if (last === "text") {
      slots.set(i, {
        anchorChild: staticNodes.length - 1,
        anchorOffset: runText.length,
      });
    } else {
      slots.set(i, { anchorChild: staticNodes.length, anchorOffset: 0 });
    }
  }
  return { staticNodes, slots };
}

/**
 * 递归生成元素骨架
 *
 * path 只计入元素子节点；child / text 洞不写任何占位节点。
 */
function emitElement(
  node: t.CallExpression,
  path: number[],
  rootIndex: number,
  out: SkeletonCode,
  inSvg: boolean,
  code: string,
  validH: Set<t.Node>,
  validT: Set<t.Node>,
): boolean {
  const tagNode = node.arguments[0];
  if (!t.isStringLiteral(tagNode)) return false;
  const tag = tagNode.value;
  if (tag === "fragment") return false;
  if (SVG_TAGS.has(tag) && tag !== "svg" && !inSvg) return false;
  if (!inSvg && TEMPLATE_UNSAFE_ROOTS.has(tag)) return false;

  const split = splitAttrs(node.arguments[1], code);
  if (split === null) return false;
  const openStart = `<${tag}${split.staticAttrs}`;
  const appendOpen = (): void => {
    appendStatic(out, openStart);
    for (const attr of split.dynamic) {
      const holeIndex = out.holes.length;
      out.holes.push({
        kind: "attr",
        root: rootIndex,
        path: [...path],
        name: attr.name,
        getter: attr.getter,
      });
      out.parts.push(holeIndex);
    }
    for (const event of split.events) {
      const holeIndex = out.holes.length;
      out.holes.push({
        kind: "event",
        root: rootIndex,
        path: [...path],
        name: event.name,
        getter: event.getter,
      });
      out.parts.push(holeIndex);
    }
    for (const ref of split.refs) {
      const holeIndex = out.holes.length;
      out.holes.push({
        kind: "ref",
        root: rootIndex,
        path: [...path],
        getter: ref.getter,
      });
      out.parts.push(holeIndex);
    }
    for (const directive of split.directives) {
      const holeIndex = out.holes.length;
      out.holes.push({
        kind: "directive",
        root: rootIndex,
        path: [...path],
        name: directive.name,
        getter: directive.getter,
      });
      out.parts.push(holeIndex);
    }
    appendStatic(out, ">");
  };

  // 内容洞：innerHTML / textContent / svgContent 替代全部子节点
  if (split.contents.length > 0) {
    if (split.contents.length > 1 || node.arguments.length > 2) return false;
    if (HTML_VOID_TAGS.has(tag)) return false;
    appendOpen();
    const content = split.contents[0];
    const holeIndex = out.holes.length;
    out.holes.push({
      kind: "content",
      root: rootIndex,
      path: [...path],
      name: content.mode,
      getter: content.getter,
    });
    out.parts.push(holeIndex);
    appendStatic(out, `</${tag}>`);
    return true;
  }

  // 自闭合标签不允许子节点
  if (HTML_VOID_TAGS.has(tag)) {
    if (node.arguments.length > 2) return false;
    appendOpen();
    return true;
  }

  const childInSvg = inSvg || tag === "svg";
  const plans = planChildren(node.arguments.slice(2), validH, validT);

  const hasElement = plans.some((plan) => plan.kind === "element");
  const hasDynamicText = plans.some((plan) => plan.kind === "dynamicText");
  const hasDynamicChild = plans.some(
    (plan) => plan.kind === "dynamicChild" || plan.kind === "fragChild",
  );

  // 纯文本子节点（静态 + 动态混合）：全部合并进 elementText 洞。
  // 模板留空元素，SSR 输出合并后的文本，客户端写 textContent，
  // 不需要任何文本占位节点，也省掉文本拆分。
  if (!hasElement && !hasDynamicChild && hasDynamicText) {
    const terms: string[] = [];
    for (const plan of plans) {
      if (plan.kind === "text") {
        terms.push(JSON.stringify(plan.value));
      } else if (plan.kind === "dynamicText") {
        terms.push(`String(${textValueExpr(plan.node, code)})`);
      }
    }
    appendOpen();
    const holeIndex = out.holes.length;
    out.holes.push({
      kind: "elementText",
      root: rootIndex,
      path: [...path],
      getter: `() => ${terms.join(" + ")}`,
    });
    out.parts.push(holeIndex);
    appendStatic(out, `</${tag}>`);
    return true;
  }

  const layout = layoutChildren(plans);
  appendOpen();
  let elementIndex = 0;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (plan.kind === "text") {
      appendStatic(out, escapeHtmlText(plan.value));
      continue;
    }
    if (plan.kind === "element") {
      if (
        !emitElement(
          plan.node,
          [...path, elementIndex],
          rootIndex,
          out,
          childInSvg,
          code,
          validH,
          validT,
        )
      ) {
        return false;
      }
      elementIndex += 1;
      continue;
    }
    const slot = layout.slots.get(i);
    if (slot === undefined) continue;
    if (plan.kind === "dynamicText") {
      const holeIndex = out.holes.length;
      out.holes.push({
        kind: "text",
        root: rootIndex,
        parent: [...path],
        anchorChild: slot.anchorChild,
        anchorOffset: slot.anchorOffset,
        getter: `() => String(${textValueExpr(plan.node, code)})`,
      });
      out.parts.push(holeIndex);
      continue;
    }
    const getter =
      plan.kind === "dynamicChild"
        ? childHoleGetter(plan.node, code)
        : `() => (${code.slice(plan.node.start ?? 0, plan.node.end ?? 0)})`;
    const holeIndex = out.holes.length;
    out.holes.push({
      kind: "child",
      root: rootIndex,
      parent: [...path],
      anchorChild: slot.anchorChild,
      anchorOffset: slot.anchorOffset,
      getter,
    });
    out.parts.push(holeIndex);
  }
  appendStatic(out, `</${tag}>`);
  return true;
}

/**
 * 生成 fragment 多根骨架
 *
 * 顶层静态子节点同样按「文本段 / 元素」计数，roots 即静态子节点数量；
 * 顶层动态洞不写入 SSR，因此水合时按 roots 恒能对齐静态骨架。
 */
function buildFragment(
  node: t.CallExpression,
  out: SkeletonCode,
  code: string,
  validH: Set<t.Node>,
  validT: Set<t.Node>,
): boolean {
  const plans = planChildren(node.arguments.slice(2), validH, validT);
  const layout = layoutChildren(plans);
  out.roots = layout.staticNodes.length;

  let rootIndex = 0;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    if (plan.kind === "text") {
      appendStatic(out, escapeHtmlText(plan.value));
      continue;
    }
    if (plan.kind === "element") {
      if (
        !emitElement(
          plan.node,
          [],
          rootIndex,
          out,
          false,
          code,
          validH,
          validT,
        )
      ) {
        return false;
      }
      rootIndex += 1;
      continue;
    }
    const slot = layout.slots.get(i);
    if (slot === undefined) continue;
    if (plan.kind === "dynamicText") {
      const holeIndex = out.holes.length;
      out.holes.push({
        kind: "text",
        root: -1,
        anchorChild: slot.anchorChild,
        anchorOffset: slot.anchorOffset,
        getter: `() => String(${textValueExpr(plan.node, code)})`,
      });
      out.parts.push(holeIndex);
      continue;
    }
    const getter =
      plan.kind === "dynamicChild"
        ? childHoleGetter(plan.node, code)
        : `() => (${code.slice(plan.node.start ?? 0, plan.node.end ?? 0)})`;
    const holeIndex = out.holes.length;
    out.holes.push({
      kind: "child",
      root: -1,
      anchorChild: slot.anchorChild,
      anchorOffset: slot.anchorOffset,
      getter,
    });
    out.parts.push(holeIndex);
  }
  return true;
}

/** 为单个 h() 调用生成骨架；元素标签不是字符串字面量时返回 null */
function buildSkeleton(
  node: t.CallExpression,
  code: string,
  validH: Set<t.Node>,
  validT: Set<t.Node>,
): SkeletonCode | null {
  const tagNode = node.arguments[0];
  if (!t.isStringLiteral(tagNode)) return null;
  const out: SkeletonCode = { html: "", parts: [], holes: [], roots: 1 };

  if (tagNode.value === "fragment") {
    if (!buildFragment(node, out, code, validH, validT)) return null;
    return out;
  }

  if (!emitElement(node, [], 0, out, false, code, validH, validT)) {
    return null;
  }
  return out;
}

/**
 * 产物校验：任何片段里都不允许出现注释标记
 *
 * 硬不变量：只要发现 `<!--`，该候选直接放弃，绝不允许把注释锚点写进
 * 模板 / SSR / DOM。
 */
function hasCommentMarker(out: SkeletonCode): boolean {
  if (out.html.includes("<!--")) return true;
  return out.parts.some(
    (part) => typeof part === "string" && part.includes("<!--"),
  );
}

/** 生成使用点洞数组代码 */
function holesCode(skeleton: SkeletonCode): string {
  const items = skeleton.holes.map((hole) => {
    if (hole.kind === "attr") {
      return `{ kind: "attr", root: ${hole.root ?? 0}, path: ${JSON.stringify(hole.path)}, name: ${JSON.stringify(hole.name)}, get: ${hole.getter} }`;
    }
    if (hole.kind === "attrs") {
      return `{ kind: "attrs", root: ${hole.root ?? 0}, path: ${JSON.stringify(hole.path)}, get: ${hole.getter} }`;
    }
    if (hole.kind === "event") {
      return `{ kind: "event", root: ${hole.root ?? 0}, path: ${JSON.stringify(hole.path)}, name: ${JSON.stringify(hole.name)}, get: ${hole.getter} }`;
    }
    if (hole.kind === "ref") {
      return `{ kind: "ref", root: ${hole.root ?? 0}, path: ${JSON.stringify(hole.path)}, get: ${hole.getter} }`;
    }
    if (hole.kind === "directive") {
      return `{ kind: "directive", root: ${hole.root ?? 0}, path: ${JSON.stringify(hole.path)}, name: ${JSON.stringify(hole.name)}, get: ${hole.getter} }`;
    }
    if (hole.kind === "content") {
      return `{ kind: "content", root: ${hole.root ?? 0}, path: ${JSON.stringify(hole.path)}, mode: ${JSON.stringify(hole.name)}, get: ${hole.getter} }`;
    }
    if (hole.kind === "child") {
      return `{ kind: "child", root: ${hole.root ?? 0}, parent: ${JSON.stringify(hole.parent)}, anchorChild: ${hole.anchorChild}, anchorOffset: ${hole.anchorOffset}, get: ${hole.getter} }`;
    }
    if (hole.kind === "text") {
      return `{ kind: "text", root: ${hole.root ?? 0}, parent: ${JSON.stringify(hole.parent)}, anchorChild: ${hole.anchorChild}, anchorOffset: ${hole.anchorOffset}, get: ${hole.getter} }`;
    }
    return `{ kind: "elementText", root: ${hole.root ?? 0}, path: ${JSON.stringify(hole.path)}, get: ${hole.getter} }`;
  });
  return `[${items.join(",")}]`;
}

/** 框架控制流组件名：它们的 props 是 toGetter 协议，禁止 _rp 包装 */
const FLOW_COMPONENT_NAMES = new Set([
  "For",
  "Show",
  "Switch",
  "Match",
  "Dynamic",
]);

/** 判断标识符是否为框架模块导入的控制流组件（For / Show / ...） */
function isFrameworkFlowTag(path: BabelPath, localName: string): boolean {
  const binding = path.scope.getBinding(localName);
  if (!binding) return false;
  const specPath = binding.path;
  if (!specPath.isImportSpecifier()) return false;
  const spec = specPath.node;
  if (!t.isImportSpecifier(spec)) return false;
  const imported = t.isIdentifier(spec.imported)
    ? spec.imported.name
    : spec.imported.value;
  if (!FLOW_COMPONENT_NAMES.has(imported)) return false;
  const declPath = specPath.parentPath;
  if (!declPath || !declPath.isImportDeclaration()) return false;
  const decl = declPath.node;
  if (!t.isImportDeclaration(decl)) return false;
  return /core|lumina|nova/.test(decl.source.value);
}

/**
 * 组件调用的响应式 props 改写（与 v1 rewriteCompAttrs 对齐）
 *
 * h(Comp, { prop: expr }) → h(Comp, { prop: _rp(() => (expr)) })
 *
 * 运行时 _createComp 检测 `_rp` 标记后把 props 包装成惰性代理，组件内部在
 * effect / 响应式 getter 中读取 props.x 才会建立信号依赖。v2 只编译字符串标签
 * 的元素骨架，组件调用不会被替换，因此必须单独做这层改写，否则组件收不到
 * 响应式 props（播放器配置开关、进度同步等都会失效）。
 *
 * 以下属性一律原样透传：onXxx 事件、函数值（render / keyFn / 手写 getter）、
 * 静态值、内部字段（ref / children / __providers / key）、useContext() 结果；
 * 控制流组件（For / Show / Switch / Match / Dynamic）整体跳过，保持 toGetter 协议。
 */
export function rewriteReactiveCompProps(code: string): {
  code: string;
  used: boolean;
} {
  let ast: t.File;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy"],
    });
  } catch {
    return { code, used: false };
  }

  const hCalls: BabelPath[] = [];
  traverse(ast, {
    CallExpression: {
      exit(path) {
        if (isFrameworkHCall(path)) hCalls.push(path);
      },
    },
  });
  if (hCalls.length === 0) return { code, used: false };

  const s = new MagicString(code);
  let used = false;

  for (const callPath of hCalls) {
    const node = callPath.node;
    if (!t.isCallExpression(node)) continue;
    const tag = node.arguments[0];
    if (tag === undefined || t.isStringLiteral(tag)) continue; // 元素调用交给骨架
    // 控制流组件：props 走 toGetter 协议，_rp thunk 会破坏协议
    if (t.isIdentifier(tag) && isFrameworkFlowTag(callPath, tag.name)) continue;
    const attrs = node.arguments[1];
    if (attrs === undefined || !t.isObjectExpression(attrs)) continue;
    for (const prop of attrs.properties) {
      if (!t.isObjectProperty(prop) || prop.computed) continue;
      const keyName = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
          ? prop.key.value
          : null;
      if (keyName === null) continue;
      const isEvent =
        keyName.startsWith("on") &&
        keyName.length > 2 &&
        keyName[2] === keyName[2].toUpperCase();
      const isInternal =
        keyName === "ref" ||
        keyName === "children" ||
        keyName === "__providers" ||
        keyName === "key";
      const value = prop.value;
      const isFnValue =
        t.isArrowFunctionExpression(value) || t.isFunctionExpression(value);
      const isUseContext =
        t.isCallExpression(value) &&
        t.isIdentifier(value.callee) &&
        value.callee.name === "useContext";
      if (
        isEvent ||
        isInternal ||
        isFnValue ||
        isUseContext ||
        isStaticValue(value)
      ) {
        continue;
      }
      const valueStart = value.start;
      const valueEnd = value.end;
      if (
        valueStart === undefined ||
        valueStart === null ||
        valueEnd === undefined ||
        valueEnd === null
      ) {
        continue;
      }
      s.appendLeft(valueStart, "_rp(() => (");
      s.appendRight(valueEnd, "))");
      used = true;
    }
  }

  return { code: used ? s.toString() : code, used };
}

/**
 * 转换源码；没有可编译的骨架时返回 null
 */
export function transformV2(
  code: string,
  filename: string,
  options: LuminaCompileV2Options & { internalImportSource: string },
): V2TransformResult | null {
  let ast: t.File;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy"],
    });
  } catch {
    return null;
  }

  const candidates: Array<{
    node: t.CallExpression;
    skeleton: SkeletonCode;
  }> = [];

  // 第一遍：按作用域收集真正来自框架的 h() / t()，支持别名
  const validH = new Set<t.Node>();
  const validT = new Set<t.Node>();
  traverse(ast, {
    CallExpression: {
      exit(path) {
        if (isFrameworkHCall(path)) validH.add(path.node);
        else if (isFrameworkTCall(path)) validT.add(path.node);
      },
    },
  });

  if (validH.size === 0) return null;

  // 第二遍：为每个 h() 生成骨架候选
  traverse(ast, {
    CallExpression: {
      exit(path) {
        const node = path.node;
        if (!validH.has(node)) return;
        if (!t.isCallExpression(node)) return;
        const skeleton = buildSkeleton(node, code, validH, validT);
        if (skeleton !== null && !hasCommentMarker(skeleton)) {
          candidates.push({ node, skeleton });
        }
      },
    },
  });

  if (candidates.length === 0) return null;

  // 只保留最外层可编译调用，避免父子节点编辑区间重叠
  const selected: typeof candidates = [];
  for (const item of candidates.sort(
    (a, b) => (a.node.start ?? 0) - (b.node.start ?? 0),
  )) {
    const nested = selected.some((parent) => {
      const parentStart = parent.node.start ?? 0;
      const parentEnd = parent.node.end ?? 0;
      const itemStart = item.node.start ?? 0;
      const itemEnd = item.node.end ?? 0;
      return parentStart <= itemStart && itemEnd <= parentEnd;
    });
    if (!nested) selected.push(item);
  }

  const s = new MagicString(code);
  const declarations: string[] = [];
  selected.forEach((item, index) => {
    const name = `_skel_v2_${index + 1}`;
    const start = item.node.start;
    const end = item.node.end;
    if (typeof start !== "number" || typeof end !== "number") return;
    declarations.push(
      `const ${name} = _tmpl2(${JSON.stringify(item.skeleton.parts)}, ${item.skeleton.roots});\n`,
    );
    s.overwrite(start, end, `${name}(${holesCode(item.skeleton)})`);
  });

  s.prepend(
    `import { _tmpl2, _frag } from ${JSON.stringify(options.internalImportSource)};\n` +
      declarations.join("") +
      "/* @lumina-compiled:v2 */\n",
  );

  return {
    code: s.toString(),
    map: s.generateMap({ hires: true, source: filename }),
  };
}
