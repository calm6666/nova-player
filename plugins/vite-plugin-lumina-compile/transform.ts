/**
 * AST 转换核心模块
 *
 * 使用 Babel 解析源码为 AST，识别框架 h() 调用模式，
 * 将其替换为专用的内部函数，消除运行时类型判断。
 *
 * 转换策略：
 * 1. h('div', { class: 'x' }, 'text')  →  _createStaticEl(...)   （静态提升）
 * 2. h('div', { onClick: fn }, child)  →  _createEl(...)          （属性预分类）
 * 3. h('svg', {}, h('circle', {}))     →  _createSvgEl(...)       （SVG 预设命名空间）
 * 4. h('fragment', {}, ...)            →  _createFragment(...)    （Fragment 优化）
 * 5. h(MyComp, { prop: val })          →  _createComp(...)        （组件类型预计算）
 * 6. defineComponent(...)              →  注入 __lumina_type = 'fn'
 * 7. class extends Component           →  注入 __lumina_type = 'class'
 *
 * 安全设计（与 Vue/Solid 一致）：
 * - 所有转换都通过 babel scope 校验标识符来源：只有来自框架模块
 *   （@/core、@/nova 等）的 h/defineComponent/Fragment/Component
 *   才会被转换，绝不误伤其他库的同名导出（如 preact 的 h）
 * - 静态提升递归识别整棵静态子树（AST 级代码生成，无字符串拼接冲突），
 *   提升常量为共享对象，使用点通过 _cloneHoisted() 克隆复用
 */

import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";
import MagicString from "magic-string";
import { SVG_TAGS } from "./svgTags";
import type { TransformContext } from "./types";

// Babel traverse 的 CommonJS 导出兼容
//
// ★ 用最小结构类型代替 @babel/traverse@8 的 NodePath：
// babel 8 仍处于 beta，其手写的 NodePath 类型体量巨大（数千行条件类型），
// 在部分 TypeScript / typescript-eslint 版本下会被解析为 error 类型，
// 触发 no-unsafe-call（"Unsafe call of an `error` type typed value"）。
// 这里只声明插件实际用到的成员，与真实 NodePath 结构兼容。
type BabelPath = {
  node: t.Node;
  parentPath: BabelPath | null;
  scope: {
    getBinding(name: string): { path: BabelPath } | undefined;
  };
  isCallExpression(): boolean;
  isImportSpecifier(): boolean;
  isImportDeclaration(): boolean;
  isFunction(): boolean;
  isObjectProperty(): boolean;
  isArrayExpression(): boolean;
  isSpreadElement(): boolean;
  get(key: string | number): BabelPath | BabelPath[];
  findParent(predicate: (path: BabelPath) => boolean): BabelPath | null;
};

type TraverseVisitor = {
  CallExpression?: { exit?: (path: BabelPath) => void };
  ClassDeclaration?: (path: BabelPath) => void;
};

type TraverseFn = (ast: t.File, visitor: TraverseVisitor) => void;

const traverse: TraverseFn = ((_traverse as unknown as { default?: unknown })
  .default || _traverse) as unknown as TraverseFn;

/**
 * 框架模块来源检测
 *
 * 只有来自框架模块的具名导入才会被转换。匹配：
 * - @/core、@/core/xxx
 * - @/nova/xxx（播放器包）、@/lumina/plugins/xxx（插件包）
 * - @lumina/nova、@lumina/plugins（包名导入）
 * - 相对路径中的 core 目录（../../core）
 */
const FRAMEWORK_MODULE_RE = /(?:^|[\\/@])core(?:[\\/]|$)|lumina|nova/;

/**
 * 主转换函数
 *
 * @param code - 源码字符串
 * @param filename - 文件名（用于 sourcemap）
 * @param options - 转换选项
 * @returns 转换后的代码和 sourcemap，或 null（无需转换）
 */
export function transformCode(
  code: string,
  filename: string,
  options: {
    isProduction: boolean;
    hoistStatic: boolean;
    compileComponentType: boolean;
    compileAttrs: boolean;
    tmplStatic?: boolean;
    internalImportSource?: string;
  },
): { code: string; map: unknown } | null {
  // 解析源码为 AST
  let ast: t.File;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy"],
      // ★ 生产构建禁用 errorRecovery：语法错误时宁可跳过转换也不做错误输出
      // dev 模式保留 errorRecovery 以支持不完全代码片段的 HMR
      errorRecovery: !options.isProduction,
    });
  } catch {
    // 解析失败，返回原码
    return null;
  }

  // errorRecovery 可能产生 errors 数组 — 有语法错误时跳过转换
  if ((ast as { errors?: unknown[] }).errors?.length) {
    return null;
  }

  const s = new MagicString(code);
  const ctx: TransformContext = {
    isProduction: options.isProduction,
    hoistStatic: options.hoistStatic,
    tmplStatic: options.tmplStatic ?? false,
    compileComponentType: options.compileComponentType,
    compileAttrs: options.compileAttrs,
    hoistedCount: 0,
    hoistedAttrsCount: 0,
    defaultExportCount: 0,
    filename,
    internalImportSource: options.internalImportSource ?? "@/core/internal",
    usedInternalFns: [],
    hoistedDecls: [],
  };

  // ========== 预扫描 1：自底向上标记静态子树（仅静态提升需要） ==========
  const staticSubtreeMap = new WeakMap<t.CallExpression, boolean>();
  if (ctx.hoistStatic) {
    traverse(ast, {
      CallExpression: {
        exit(path) {
          const node = path.node as t.CallExpression;
          if (!t.isStringLiteral(node.arguments[0])) return;
          // attrs 区间内的调用一律不提升：祖先的属性重写会覆盖整个 attrs 区间，
          // 提升声明会被静默丢弃，只留下死代码与多余 import（见 hasAttrsAncestor）
          if (hasAttrsAncestor(path)) return;
          staticSubtreeMap.set(node, isStaticSubtree(path, staticSubtreeMap));
        },
      },
    });
  }

  // ========== 预扫描 2：标记提升目标（静态子树且无静态 h() 祖先） ==========
  // 只有顶层静态子树才会被整体提升，嵌套的静态调用内联进父级生成代码，
  // 避免同一子树被提升两次、产生死代码和 MagicString 编辑冲突
  const hoistTargets = new Set<t.CallExpression>();
  if (ctx.hoistStatic) {
    traverse(ast, {
      CallExpression: {
        exit(path) {
          const node = path.node as t.CallExpression;
          if (staticSubtreeMap.get(node) !== true) return;
          if (hasAttrsAncestor(path)) return;
          if (hasStaticHAncestor(path, staticSubtreeMap)) return;
          hoistTargets.add(node);
        },
      },
    });
  }

  let hasTransformed = false;

  traverse(ast, {
    CallExpression: {
      // exit 顺序（子先父后）：保证嵌套调用先被转换/提升，
      // 父级在生成代码/切片时能读到子级的编辑结果
      exit(path) {
        // 1. 标记 defineComponent 返回值为函数组件
        if (ctx.compileComponentType && markComponentType(path, s, ctx)) {
          hasTransformed = true;
        }

        // 2. 转换 h() 调用
        if (transformHCall(path, s, ctx, hoistTargets)) {
          hasTransformed = true;
        }
      },
    },

    // 3. 标记 class extends Component 为类组件
    ClassDeclaration(path) {
      if (!ctx.compileComponentType) return;
      if (markClassComponent(path, s)) {
        hasTransformed = true;
      }
    },
  });

  // 如果没有修改，返回 null
  if (!hasTransformed) return null;

  // 注入内部函数导入（按实际使用按需注入）
  if (ctx.usedInternalFns.length > 0) {
    const importNames = ctx.usedInternalFns.sort().join(", ");
    s.prepend(
      `import { ${importNames} } from '${ctx.internalImportSource}';\n`,
    );
  }

  // 注入静态提升声明（先 prepend 声明再 prepend import，import 保持在最前）
  if (ctx.hoistedDecls.length > 0) {
    s.prepend(ctx.hoistedDecls.join(""));
  }

  return {
    code: s.toString(),
    map: s.generateMap({ source: filename, hires: true }),
  };
}

/**
 * 记录已使用的内部函数名（去重）
 *
 * 用 string[] + indexOf 去重，避免 Set 迭代在低 target 环境下产生 error 类型
 */
function markUsed(ctx: TransformContext, name: string): void {
  if (ctx.usedInternalFns.indexOf(name) === -1) {
    ctx.usedInternalFns.push(name);
  }
}

/**
 * 判断标识符是否来自框架模块的具名导入
 *
 * 通过 babel scope 解析 binding，要求：
 * 1. 是 import 语句的具名导入（ImportSpecifier）
 * 2. 导入的原始名称匹配 importedName（支持 import { h as alias } 别名）
 * 3. 导入来源是框架模块（FRAMEWORK_MODULE_RE）
 *
 * binding 不存在（局部函数/全局变量/其他来源）时返回 false，绝不误伤
 */
function isFrameworkNamedImport(
  path: BabelPath,
  localName: string,
  importedName: string,
): boolean {
  const binding = path.scope.getBinding(localName);
  if (!binding) return false;
  const bindPath = binding.path;
  if (!bindPath.isImportSpecifier()) return false;

  const imported = (bindPath.node as t.ImportSpecifier).imported;
  const name = t.isIdentifier(imported) ? imported.name : imported.value;
  if (name !== importedName) return false;

  const importDecl = bindPath.findParent((p) => p.isImportDeclaration());
  if (!importDecl) return false;
  const source = (importDecl.node as t.ImportDeclaration).source.value;
  return FRAMEWORK_MODULE_RE.test(source);
}

/**
 * 判断 CallExpression 是否为框架的 h() 调用
 * （callee 为标识符且绑定到框架模块的 h 导出）
 */
function isFrameworkHCall(path: BabelPath): boolean {
  const callee = (path.node as t.CallExpression).callee;
  if (!t.isIdentifier(callee)) return false;
  return isFrameworkNamedImport(path, callee.name, "h");
}

/**
 * 判断 AST 节点是否为 i18n t() 调用
 *
 * t() 调用返回字符串，内部读取 localeSignal.value 建立响应式依赖。
 * 编译期识别后包装为 _reactiveText(() => t(...))，让 mount.ts 注册 effect，
 * setLocale 时自动更新文本节点（精准更新，不全量重渲染）。
 *
 * 与 h() 调用区分：h() 返回 VNode 不能包装为 _reactiveText，
 * 而 t() 返回字符串正好是 _reactiveText 的语义。
 *
 * @param path - h() 调用路径（用于 scope 解析 t 的 binding）
 * @param arg - h() 的子节点 AST（可能是 t() 调用）
 */
function isI18nTCall(path: BabelPath, arg: t.Node): boolean {
  if (!t.isCallExpression(arg)) return false;
  const callee = arg.callee;
  if (!t.isIdentifier(callee)) return false;
  return isFrameworkNamedImport(path, callee.name, "t");
}

/**
 * 判断当前 h() 调用是否位于另一个 h() 调用的 attrs 参数内（直接值位置）
 *
 * attrs 值中的 h() 调用不是子节点（运行时按属性值处理），不应转换：
 * - 语义上 h() 不会把 attrs 里的 VNode 当子节点，attrs 值只作为属性/组件 props 传递
 * - 更关键：父级 rewriteAttrs / rewriteCompAttrs 会用
 *   `s.overwrite(attrsArg.start, attrsArg.end, newStr)` 覆盖**整个 attrs 参数区间**。
 *   虽然 MagicString 允许「父区间包含子区间」的覆盖，但覆盖会**静默丢弃**子级已写入的编辑：
 *   子级的 _createEl 转换、静态提升声明与 _cloneHoisted 引用都会从产物中消失，
 *   只留下永远不被引用的 `const _hoisted_N = ...` 声明与多余的 import（死代码 + 体积膨胀）。
 *   因此这类位置必须跳过编辑。
 *
 * 但「位于 attrs 参数内」不等于「是 attrs 的值」——必须区分两种位置：
 * - **值位置**（不安全）：`h(C, { icon: h('span') })`、`h(C, { list: [h('i')] })`、
 *   `h(C, { ...h('div') })`；这些 h() 的求值结果就是属性值本身，必须跳过。
 * - **函数体内**（安全）：`h(For, { render: (item) => h('div', ...) })`。
 *   h() 位于**跨越了函数边界**的回调体内，其求值结果注入 DOM 的时机与位置
 *   由回调调用方决定，与父级 attrs 参数区间无关；这正是 For/Switch/Match/Dynamic
 *   的 render/key 回调与组件 render prop 的常见写法。
 *   收紧前这里被一并跳过，导致回调体内的代码**静默失去全部编译期优化**
 *   （没有 __reactiveAttrs / _reactiveText / 静态提升，信号属性不会自动更新）。
 *
 * 判定方式：沿祖先链自底向上，若遭遇「把当前表达式直接当作值的容器」
 * （ObjectProperty 的 value / ArrayExpression 的元素 / SpreadElement 的 argument）
 * 则标记为不安全；一旦**跨越函数边界**即清除该标记（函数体内的编辑不会被
 * 祖先的 attrs 区间覆盖丢弃）。命中「框架 h() 且当前节点是其 arguments[1]」
 * 时按标记决定是否跳过。
 */
function isInsideAttrsOfHCall(path: BabelPath): boolean {
  let child: t.Node = path.node;
  let parent: BabelPath | null = path.parentPath;
  // 当前是否处于「非函数的 attrs 值位置」
  let unsafeValuePosition = false;
  // 上一次跨越的边是否落进了函数体（函数体内的表达式不再属于外层 attrs 的值位置）
  let crossedFunction = false;

  while (parent) {
    // 跨越函数边界 → 该处编辑不会被祖先 attrs 覆盖丢弃，清除非安全标记
    if (
      parent.isFunction() ||
      t.isArrowFunctionExpression(parent.node) ||
      t.isFunctionExpression(parent.node) ||
      t.isFunctionDeclaration(parent.node)
    ) {
      unsafeValuePosition = false;
      crossedFunction = true;
    }

    // 容器判定只在「未落进函数体」时生效：
    //   h(For, { render: (i) => h('div') })  → 跨越箭头函数后是回调体，安全
    //   h(C,   { icon:   h('div') })         → 直接落在属性值位置，不安全
    //   h(C,   { list: [ h('div') ] })       → 落在数组元素位置，不安全
    // 同时忽略「容器里的值本身就是函数定义」的情形（那条边只是函数定义处，
    // 函数体内部要么已经单独跨越过函数边界，要么根本不在这里）
    const childIsFn =
      t.isArrowFunctionExpression(child) ||
      t.isFunctionExpression(child) ||
      t.isFunctionDeclaration(child);
    if (!crossedFunction && !childIsFn) {
      if (parent.isObjectProperty()) {
        if ((parent.node as t.ObjectProperty).value === child)
          unsafeValuePosition = true;
      } else if (parent.isArrayExpression()) {
        if (
          (parent.node as t.ArrayExpression).elements.indexOf(
            child as t.Expression,
          ) !== -1
        ) {
          unsafeValuePosition = true;
        }
      } else if (parent.isSpreadElement()) {
        if ((parent.node as t.SpreadElement).argument === child)
          unsafeValuePosition = true;
      }
    }

    if (
      parent.isCallExpression() &&
      isFrameworkHCall(parent) &&
      ((parent.node as t.CallExpression).arguments as t.Node[]).indexOf(
        child,
      ) === 1
    ) {
      return unsafeValuePosition;
    }

    child = parent.node;
    parent = parent.parentPath;
  }
  return false;
}

/**
 * 判断调用是否位于任意祖先 h() 调用的 attrs 参数区间内（含函数体内）
 *
 * 与 isInsideAttrsOfHCall 的区别：本判定**不区分**值位置与函数体位置，
 * 只要整段位于某个祖先的 attrs 参数内即为真。
 *
 * 用途是静态提升的准入判定：祖先级 rewriteAttrs / rewriteCompAttrs 会
 * `overwrite(attrsArg.start, attrsArg.end, ...)` 覆盖整个 attrs 区间，
 * 该区间内**任何**静态提升声明都会被静默丢弃，只留下永不引用的
 * `const _hoisted_N = ...` 与多余的 import（死代码 + 体积膨胀）。
 * 因此 attrs 区间内的调用一律不做静态提升，由祖先的属性重写按原样拼接其源码。
 */
function hasAttrsAncestor(path: BabelPath): boolean {
  let child: t.Node = path.node;
  let parent: BabelPath | null = path.parentPath;
  while (parent) {
    if (
      parent.isCallExpression() &&
      isFrameworkHCall(parent) &&
      ((parent.node as t.CallExpression).arguments as t.Node[]).indexOf(
        child,
      ) === 1
    ) {
      return true;
    }
    child = parent.node;
    parent = parent.parentPath;
  }
  return false;
}

/**
 * 判断 AST 节点是否为静态值（字面量）
 */
function isStaticValue(node: t.Node): boolean {
  if (t.isStringLiteral(node)) return true;
  if (t.isNumericLiteral(node)) return true;
  if (t.isBooleanLiteral(node)) return true;
  if (t.isNullLiteral(node)) return true;
  // 负数字面量：-1、-0.5 等
  if (
    t.isUnaryExpression(node) &&
    node.operator === "-" &&
    t.isNumericLiteral(node.argument)
  ) {
    return true;
  }
  // 无插值的模板字符串：`text`
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) return true;
  if (t.isObjectExpression(node)) {
    return node.properties.every((prop) => {
      if (t.isObjectProperty(prop) && !prop.computed) {
        return isStaticValue(prop.value);
      }
      return false;
    });
  }
  if (t.isArrayExpression(node)) {
    return node.elements.every((el) => el === null || isStaticValue(el));
  }
  return false;
}

/**
 * 获取（可能包装为响应式的）子节点代码字符串
 *
 * 用于 Fragment 等需要整体重写节点范围的场景：
 * 不修改 MagicString，直接返回包装后的代码字符串
 *
 * - 静态字面量 → 原样返回
 * - 框架 h() 调用 → 原样返回（产出 VNode，不是文本）
 * - i18n t() 调用 → 包装为 _reactiveText(() => t(...))（响应式追踪 localeSignal）
 * - 其他动态表达式 → 包装为 _reactiveText(() => expr)
 *
 * @param arg - h() 的子节点 AST
 * @param path - h() 调用路径（用于 scope 解析 t 的 binding）
 * @param s - MagicString 实例
 * @param ctx - 转换上下文
 */
function getReactiveChildCode(
  arg: t.Node,
  path: BabelPath,
  s: MagicString,
  ctx: TransformContext,
): string {
  // SpreadElement → 跳过（展开数组，不是单个子节点，无法包装为响应式文本）
  if (t.isSpreadElement(arg)) return s.slice(arg.start!, arg.end!);
  // 静态字面量 → 无需响应式
  if (isStaticValue(arg)) return s.slice(arg.start!, arg.end!);
  // ★ 显式响应式 getter 协议：零参箭头函数 () => expr → _reactiveText(fn)
  // 作者显式声明该子节点返回响应式文本（内部读取 signal，求值结果为 string/number）。
  // 与 Solid 的 {() => expr} 模式一致：编译器将原箭头函数直接作为 _reactiveText 的 getter，
  // mount 阶段创建 Text 节点并注册 effect，内部 signal 变化时自动更新文本。
  // 该协议让「返回字符串的函数调用」（如 formatTime(signal.value)）获得响应式能力，
  // 解决其与返回 VNode 的组件调用无法区分而被统一跳过的问题（见下方 CallExpression 分支）。
  if (t.isArrowFunctionExpression(arg) && arg.params.length === 0) {
    const code = s.slice(arg.start!, arg.end!);
    markUsed(ctx, "_reactiveText");
    return `_reactiveText(${code})`;
  }
  // ★ i18n t() 调用 → 包装为 _reactiveText（响应式追踪 localeSignal，
  //   setLocale 时自动更新文本节点）
  if (isI18nTCall(path, arg)) {
    const code = s.slice(arg.start!, arg.end!);
    markUsed(ctx, "_reactiveText");
    return `_reactiveText(() => ${code})`;
  }
  // 三元/逻辑表达式可能返回 VNode → 跳过包装，按普通子节点求值
  if (mayYieldVNode(arg, path)) return s.slice(arg.start!, arg.end!);
  // 其他 CallExpression → 跳过（h() 调用和组件调用都返回 VNode，不是文本）
  if (t.isCallExpression(arg)) return s.slice(arg.start!, arg.end!);
  // 其他动态表达式 → 包装为 _reactiveText（mount 时注册 effect 自动追踪 signal）
  const code = s.slice(arg.start!, arg.end!);
  markUsed(ctx, "_reactiveText");
  return `_reactiveText(() => ${code})`;
}

/**
 * 判断子节点位置的表达式是否可能返回 VNode
 *
 * _reactiveText 是「字符串文本协议」（mount 建 Text 节点、SSR 输出纯文本），
 * 只能包装确定返回字符串的表达式。三元/逻辑表达式可能返回 VNode，
 * 例如 `cond ? h(IconA) : h(IconB)`、`contents[tab]?.() ?? contents.home()`：
 * 若误包装，SSR 端 escapeHtml(VNode) 输出空字符串（图标丢失），
 * 客户端水合时 __reactive 分支仍消费一个 DOM 节点，游标前移导致后续标签错位。
 *
 * 判定规则（与顶层 CallExpression 不包装的既有行为保持一致）：
 * - 条件/逻辑表达式的「结果候选分支」递归检查（测试条件不参与，恒为布尔）
 * - 结果候选中出现调用表达式即视为可能返回 VNode（框架 t() 调用除外，其返回字符串）
 *
 * @param node - 子节点表达式 AST
 * @param path - h() 调用路径（用于 scope 解析 t 的 binding）
 */
function mayYieldVNode(node: t.Node, path: BabelPath): boolean {
  if (t.isConditionalExpression(node)) {
    return (
      mayYieldVNode(node.consequent, path) ||
      mayYieldVNode(node.alternate, path)
    );
  }
  if (t.isLogicalExpression(node)) {
    return mayYieldVNode(node.left, path) || mayYieldVNode(node.right, path);
  }
  if (t.isCallExpression(node) || t.isOptionalCallExpression(node)) {
    // 框架 i18n t() 返回字符串，可安全包装为响应式文本
    return !isI18nTCall(path, node);
  }
  return false;
}

/**
 * 转换响应式子节点（原地覆盖）
 *
 * 用于 _createEl/_createSvgEl 等只覆盖 callee、不覆盖子节点范围的场景：
 * 将动态表达式子节点原地覆盖为 _reactiveText(() => expr)
 *
 * @param node - h() 调用 AST 节点
 * @param path - h() 调用路径（用于 scope 解析 t 的 binding）
 * @param s - MagicString 实例
 * @param ctx - 转换上下文
 * @param childrenStart - 子节点在 args 中的起始索引（通常为 2，跳过 tag 和 attrs）
 */
function transformReactiveChildren(
  node: t.CallExpression,
  path: BabelPath,
  s: MagicString,
  ctx: TransformContext,
  childrenStart: number,
): void {
  const args = node.arguments;
  for (let i = childrenStart; i < args.length; i++) {
    const arg = args[i];
    if (arg === null) continue;

    // SpreadElement → 跳过（展开数组，不是单个子节点，无法包装为响应式文本）
    if (t.isSpreadElement(arg)) continue;

    // 静态字面量 → 无需响应式
    if (isStaticValue(arg)) continue;

    // ★ 显式响应式 getter 协议：零参箭头函数 () => expr → _reactiveText(fn)
    // 作者显式声明该子节点返回响应式文本（内部读取 signal，求值结果为 string/number）。
    // 与 Solid 的 {() => expr} 模式一致：编译器将原箭头函数直接作为 _reactiveText 的 getter，
    // mount 阶段创建 Text 节点并注册 effect，内部 signal 变化时自动更新文本。
    // 该协议让「返回字符串的函数调用」（如 formatTime(signal.value)）获得响应式能力，
    // 解决其与返回 VNode 的组件调用无法区分而被统一跳过的问题（见下方 CallExpression 分支）。
    if (t.isArrowFunctionExpression(arg) && arg.params.length === 0) {
      const code = s.slice(arg.start!, arg.end!);
      s.overwrite(arg.start!, arg.end!, `_reactiveText(${code})`);
      markUsed(ctx, "_reactiveText");
      continue;
    }

    // ★ i18n t() 调用 → 包装为 _reactiveText（响应式追踪 localeSignal，
    //   setLocale 时自动更新文本节点）
    if (isI18nTCall(path, arg)) {
      const code = s.slice(arg.start!, arg.end!);
      s.overwrite(arg.start!, arg.end!, `_reactiveText(() => ${code})`);
      markUsed(ctx, "_reactiveText");
      continue;
    }

    // 三元/逻辑表达式可能返回 VNode → 跳过包装，按普通子节点求值
    if (mayYieldVNode(arg, path)) continue;

    // 其他 CallExpression → 跳过（h() 调用和组件调用都返回 VNode，不是文本）
    if (t.isCallExpression(arg)) continue;

    // 其他动态表达式 → 包装为 _reactiveText
    const code = s.slice(arg.start!, arg.end!);
    s.overwrite(arg.start!, arg.end!, `_reactiveText(() => ${code})`);
    markUsed(ctx, "_reactiveText");
  }
}

/**
 * 递归判断 h() 调用是否整棵子树静态
 *
 * 静态 = tag 为字符串字面量，且所有参数为静态字面量或静态 h() 子树。
 * 与旧版 isAllStatic 的区别：嵌套的 h() 调用也参与判定，
 * 让真实代码中的静态子树（如菜单/面板结构）能整体提升。
 *
 * @param path - h() 调用路径
 * @param cache - 静态判定缓存（自底向上填充，避免重复计算）
 */
function isStaticSubtree(
  path: BabelPath,
  cache: WeakMap<t.CallExpression, boolean>,
): boolean {
  const node = path.node as t.CallExpression;
  const cached = cache.get(node);
  if (cached !== undefined) return cached;

  const args = node.arguments;
  if (args.length === 0 || !t.isStringLiteral(args[0])) {
    cache.set(node, false);
    return false;
  }

  let result = true;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (t.isCallExpression(arg)) {
      const argPath = (path.get("arguments") as BabelPath[])[i];
      // 嵌套调用必须是框架 h() 且自身为静态子树
      if (!isFrameworkHCall(argPath) || !isStaticSubtree(argPath, cache)) {
        result = false;
        break;
      }
    } else if (!isStaticValue(arg)) {
      result = false;
      break;
    }
  }
  cache.set(node, result);
  return result;
}

/**
 * 判断静态 h() 调用是否有静态 h() 祖先
 * 有则说明它会被祖先整体提升，不应单独提升
 */
function hasStaticHAncestor(
  path: BabelPath,
  cache: WeakMap<t.CallExpression, boolean>,
): boolean {
  let parent: BabelPath | null = path.parentPath;
  while (parent) {
    if (parent.isCallExpression() && isFrameworkHCall(parent)) {
      if (cache.get(parent.node as t.CallExpression) === true) return true;
    }
    parent = parent.parentPath;
  }
  return false;
}

/**
 * 判断 h() 调用是否位于已提升的静态子树内部
 * 提升目标会整段覆盖其范围，内部的调用必须跳过编辑
 */
function hasHoistedAncestor(
  path: BabelPath,
  hoistTargets: ReadonlySet<t.CallExpression>,
): boolean {
  let parent: BabelPath | null = path.parentPath;
  while (parent) {
    if (
      parent.isCallExpression() &&
      hoistTargets.has(parent.node as t.CallExpression)
    ) {
      return true;
    }
    parent = parent.parentPath;
  }
  return false;
}

/**
 * 由 AST 生成静态子树的运行时代码
 *
 * 直接在 AST 上生成代码（而非字符串替换），彻底避免：
 * - 嵌套编辑导致的 MagicString 冲突
 * - 提升代码中残留未转换的 h() 调用
 * 仅处理 isStaticSubtree/isStaticValue 认可的节点类型。
 */
function genStaticExpr(node: t.Node, ctx: TransformContext): string {
  if (t.isStringLiteral(node)) return JSON.stringify(node.value);
  if (t.isNumericLiteral(node)) return String(node.value);
  if (t.isBooleanLiteral(node)) return node.value ? "true" : "false";
  if (t.isNullLiteral(node)) return "null";
  if (
    t.isUnaryExpression(node) &&
    node.operator === "-" &&
    t.isNumericLiteral(node.argument)
  ) {
    return `-${node.argument.value}`;
  }
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return JSON.stringify(
      node.quasis[0].value.cooked ?? node.quasis[0].value.raw,
    );
  }
  if (t.isArrayExpression(node)) {
    return `[${node.elements
      .map((el) => (el === null ? "null" : genStaticExpr(el, ctx)))
      .join(", ")}]`;
  }
  if (t.isObjectExpression(node)) {
    const parts: string[] = [];
    for (const prop of node.properties) {
      if (!t.isObjectProperty(prop) || prop.computed) continue;
      let key: string;
      if (t.isIdentifier(prop.key)) key = prop.key.name;
      else if (t.isStringLiteral(prop.key))
        key = JSON.stringify(prop.key.value);
      else if (t.isNumericLiteral(prop.key)) key = String(prop.key.value);
      else continue;
      parts.push(`${key}: ${genStaticExpr(prop.value, ctx)}`);
    }
    return `{ ${parts.join(", ")} }`;
  }
  if (t.isCallExpression(node)) return genStaticHCall(node, ctx);
  // 理论上不可达：isStaticSubtree 已保证只含以上节点类型
  return "null";
}

/**
 * 生成静态 h() 调用的运行时代码（嵌套调用递归生成专用函数）
 */
function genStaticHCall(node: t.CallExpression, ctx: TransformContext): string {
  const args = node.arguments as t.Expression[];
  const tag = (args[0] as t.StringLiteral).value;
  const attrs = args.length >= 2 ? genStaticExpr(args[1], ctx) : "undefined";
  const children = args
    .slice(2)
    .map((a) => genStaticExpr(a, ctx))
    .join(", ");

  // Fragment → _createFragment(...children)，丢弃 attrs 参数
  if (tag === "fragment") {
    markUsed(ctx, "_createFragment");
    return `_createFragment(${children})`;
  }

  // SVG → _createSvgEl（预设命名空间）
  if (SVG_TAGS.has(tag)) {
    markUsed(ctx, "_createSvgEl");
    return `_createSvgEl(${JSON.stringify(tag)}, ${attrs}${
      children ? `, ${children}` : ""
    })`;
  }

  // 普通静态元素
  markUsed(ctx, "_createStaticEl");
  return `_createStaticEl(${JSON.stringify(tag)}, ${attrs}${
    children ? `, ${children}` : ""
  })`;
}

/**
 * 静态提升：整棵静态子树生成模块级常量，使用点替换为克隆调用
 *
 * 两条提升路径（编译期 DOM 化阶段 1 起）：
 * 1. tmplStatic 开启 → HTML 字符串常量 + _tmpl() 工厂：
 *    mount 一次 cloneNode 直达 DOM、SSR 直拼字符串、水合直接采用 SSR DOM
 * 2. 否则 → VNode 常量 + _cloneHoisted() 克隆（原路径，作为回退保留）
 *
 * 模板化的回退条件（genStaticTmpl 返回 null 时走 VNode 路径）：
 * - 裸 SVG 子标签（非 svg 根）：HTML 解析器无法为其建立 SVG 命名空间，
 *   必须保留 createElementNS 路径
 * - 含 ref / v-* / svgContent / innerHTML / textContent / directives：
 *   这些属性需要运行时处理（bindRef / 指令 / DOM property 注入）
 * - 表格上下文标签（tr/td 等）作为 <template> 根会被 HTML 解析器丢弃
 * - fragment 顶层含非元素子节点 / 嵌套 fragment：roots 计数无法对齐
 */
function hoistStaticCall(
  node: t.CallExpression,
  s: MagicString,
  ctx: TransformContext,
): boolean {
  const hoistedName = `_hoisted_${++ctx.hoistedCount}`;

  // ★ 模板路径：HTML 字符串 + 运行时 _tmpl 工厂
  if (ctx.tmplStatic) {
    const tmpl = genStaticTmpl(node, ctx);
    if (tmpl !== null) {
      ctx.hoistedDecls.push(
        `const ${hoistedName} = _tmpl(${JSON.stringify(tmpl.html)}, ${tmpl.roots});\n`,
      );
      markUsed(ctx, "_tmpl");
      s.overwrite(node.start!, node.end!, `${hoistedName}()`);
      return true;
    }
  }

  // VNode 回退路径：共享常量 + 使用点克隆（多次渲染会互相覆盖 el，必须克隆）
  ctx.hoistedDecls.push(
    `const ${hoistedName} = ${genStaticHCall(node, ctx)};\n`,
  );
  markUsed(ctx, "_cloneHoisted");
  s.overwrite(node.start!, node.end!, `_cloneHoisted(${hoistedName})`);
  return true;
}

// ============================================
// 编译期 DOM 化：静态子树 → HTML 字符串（阶段 1）
// ============================================
//
// 以下所有常量表与序列化逻辑严格镜像 core/ssr.ts 的语义
// （VOID_ELEMENTS / DOM_PROPERTY_TO_HTML_ATTR / BOOLEAN_HTML_ATTRS /
//  SKIP_ATTRS / serializeAttrs / serializeStyle / normalizeClass / escapeHtml），
// 保证：模板克隆出的 DOM ≡ SSR 输出的 HTML ≡ 水合时浏览器解析的 DOM。

/** 与 ssr.ts VOID_ELEMENTS 一致：自闭合标签（镜像 SSR 行为：不输出子节点） */
const HTML_VOID_TAGS = new Set([
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
 * 作为 <template> 根会被 HTML 解析器丢弃/错位的标签（表格上下文家族）
 * 这些标签必须出现在 table 上下文中，独立解析时被静默丢弃
 */
const TEMPLATE_UNSAFE_ROOTS = new Set([
  "tr",
  "td",
  "th",
  "tbody",
  "thead",
  "tfoot",
  "caption",
  "col",
  "colgroup",
]);

/** 与 ssr.ts DOM_PROPERTY_TO_HTML_ATTR 一致：DOM property → HTML 属性名 */
const DOM_PROP_TO_HTML_ATTR: Record<string, string> = {
  readOnly: "readonly",
  defaultChecked: "checked",
  defaultSelected: "selected",
  defaultMuted: "muted",
};

/** 与 ssr.ts BOOLEAN_HTML_ATTRS 一致：布尔属性（存在即为 true） */
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

/**
 * 需要运行时处理的属性名：出现即整棵子树回退 VNode 提升路径
 * - ref/__ref：需要 bindRef（字符串模板引用沿 __parent 链解析）
 * - svgContent/innerHTML/textContent：需要运行时 DOM property/解析注入
 * - directives：需要运行时执行指令函数
 */
const RUNTIME_ATTR_KEYS = new Set([
  "ref",
  "__ref",
  "svgContent",
  "innerHTML",
  "textContent",
  "directives",
]);

/**
 * 与 ssr.ts SKIP_ATTRS 的静默跳过子集（运行时属性已在 RUNTIME_ATTR_KEYS 回退）：
 * 这些内部字段不序列化到 HTML（静态子树中只可能以空字面量出现，跳过即无操作）
 */
const SSR_SKIP_ATTR_KEYS = new Set([
  "__events",
  "key",
  "children",
  "_cleanups",
  "__ns",
  "__providers",
  "__reactiveAttrs",
]);

/** 与 ssr.ts escapeHtml 一致的转义表（单次遍历查表） */
const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** 编译期 HTML 转义（镜像 ssr.ts escapeHtml） */
function escapeHtmlText(str: string): string {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    out += HTML_ESCAPE_MAP[char] ?? char;
  }
  return out;
}

/** 与 core/normalize.ts camelToKebab 一致（style 属性名转换） */
function camelToKebabCase(str: string): string {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}

/**
 * 提取对象属性的静态键名（identifier / string / numeric，computed 不可能出现在静态子树）
 * @returns 键名，无法识别时返回 null
 */
function staticPropKeyName(prop: t.ObjectProperty): string | null {
  if (t.isIdentifier(prop.key)) return prop.key.name;
  if (t.isStringLiteral(prop.key)) return prop.key.value;
  if (t.isNumericLiteral(prop.key)) return String(prop.key.value);
  return null;
}

/**
 * 静态字面量的 JS 真值判定（镜像运行时 truthiness，用于 class 对象项）
 * 字面量类型有限（isStaticValue 保证），非字面量分支不会出现，返回 true 保持保守
 */
function isTruthyStaticLiteral(node: t.Node): boolean {
  if (t.isBooleanLiteral(node)) return node.value;
  if (t.isNullLiteral(node)) return false;
  if (t.isStringLiteral(node)) return node.value.length > 0;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return (node.quasis[0].value.cooked ?? node.quasis[0].value.raw).length > 0;
  }
  if (t.isNumericLiteral(node)) return node.value !== 0;
  if (
    t.isUnaryExpression(node) &&
    node.operator === "-" &&
    t.isNumericLiteral(node.argument)
  ) {
    // -0 为 falsy（与 JS 一致）
    return node.argument.value !== 0;
  }
  // 对象/数组字面量恒为 truthy
  return true;
}

/**
 * 提取静态字面量的字符串值（string / 无插值模板 / 数字 / 负数 / 布尔）
 * @returns 字符串值，非标量字面量返回 null
 */
function staticScalarToString(node: t.Node): string | null {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }
  if (t.isNumericLiteral(node)) return String(node.value);
  if (t.isBooleanLiteral(node)) return node.value ? "true" : "false";
  if (
    t.isUnaryExpression(node) &&
    node.operator === "-" &&
    t.isNumericLiteral(node.argument)
  ) {
    // String(-0) === "0"，用数值取负保证与运行时一致
    return String(-node.argument.value);
  }
  if (t.isNullLiteral(node)) return "null";
  return null;
}

/**
 * 编译期 normalizeClass（镜像 core/normalize.ts）：
 * string → 原样；array → truthy 字符串项 + truthy 对象项键名拼接；object → truthy 键名拼接
 * @returns class 字符串（空串表示无 class 属性）
 */
function staticClassValue(node: t.Node): string {
  if (t.isStringLiteral(node)) return node.value;
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
  }

  if (t.isArrayExpression(node)) {
    const parts: string[] = [];
    for (const el of node.elements) {
      if (el === null) continue;
      if (t.isStringLiteral(el) || t.isTemplateLiteral(el)) {
        const s = staticClassValue(el);
        if (s) parts.push(s);
      } else if (t.isObjectExpression(el)) {
        appendTruthyObjectKeys(el, parts);
      }
      // 嵌套数组等：normalizeClass 跳过非 string/object 项，镜像跳过
    }
    return parts.join(" ");
  }

  if (t.isObjectExpression(node)) {
    const parts: string[] = [];
    appendTruthyObjectKeys(node, parts);
    return parts.join(" ");
  }

  // number/boolean/null 等标量：normalizeClass 返回空串
  return "";
}

/** class 对象项处理：truthy 值的键名收集（镜像 normalizeClass 对象分支） */
function appendTruthyObjectKeys(
  obj: t.ObjectExpression,
  parts: string[],
): void {
  for (const prop of obj.properties) {
    if (!t.isObjectProperty(prop) || prop.computed) continue;
    const key = staticPropKeyName(prop);
    if (key === null) continue;
    if (isTruthyStaticLiteral(prop.value)) {
      parts.push(key);
    }
  }
}

/**
 * 编译期 serializeStyle（镜像 core/normalize.ts normalizeStyle + serializeStyle）：
 * - string → 解析 'a: b; c: d' 后规范化（camelToKebab / -- 变量保留 / 空值剔除）
 * - object → 逐项 normalizeStyleValue 语义
 * - 输出格式与 ssr.ts 完全一致：'prop: value; prop2: value2;' → ` style="..."`
 * @returns ` style="..."` 片段；无有效声明返回 ""；含无法静态判定的值返回 null（整棵回退）
 */
function staticStyleAttr(node: t.Node): string | null {
  const entries: Array<{ prop: string; value: string }> = [];

  const pushEntry = (key: string, valueNode: t.Node): boolean => {
    // 镜像 normalizeStyleValue：null / false → 跳过（undefined 不可能出现在静态字面量）
    if (t.isNullLiteral(valueNode)) return true;
    if (t.isBooleanLiteral(valueNode)) {
      if (!valueNode.value) return true;
      entries.push({
        prop: key.startsWith("--") ? key : camelToKebabCase(key),
        value: "true",
      });
      return true;
    }
    const strVal = staticScalarToString(valueNode);
    if (strVal === null) return false; // 对象/数组值无法静态判定 → 整棵回退
    if (strVal === "") return true; // 镜像：空值剔除
    entries.push({
      prop: key.startsWith("--") ? key : camelToKebabCase(key),
      value: strVal,
    });
    return true;
  };

  if (
    t.isStringLiteral(node) ||
    (t.isTemplateLiteral(node) && node.expressions.length === 0)
  ) {
    // 解析字符串样式（镜像 parseStyleString + normalizeStyleValue）
    const raw = t.isStringLiteral(node)
      ? node.value
      : (node.quasis[0].value.cooked ?? node.quasis[0].value.raw);
    for (const decl of raw.split(";")) {
      const trimmed = decl.trim();
      if (!trimmed) continue;
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();
      if (!key || value === "") continue;
      const prop = key.startsWith("--") ? key : camelToKebabCase(key);
      entries.push({ prop, value });
    }
  } else if (t.isObjectExpression(node)) {
    for (const prop of node.properties) {
      if (!t.isObjectProperty(prop) || prop.computed) continue;
      const key = staticPropKeyName(prop);
      if (key === null) continue;
      if (!pushEntry(key, prop.value)) return null;
    }
  } else {
    // number/boolean/null：normalizeStyle 返回 null → 无 style 属性
    return "";
  }

  if (entries.length === 0) return "";
  const parts: string[] = [];
  for (const entry of entries) {
    parts.push(`${entry.prop}: ${entry.value};`);
  }
  return ` style="${escapeHtmlText(parts.join(" "))}"`;
}

/**
 * 编译期序列化静态属性对象（镜像 ssr.ts serializeAttrs 的静态子集）
 * @returns 属性字符串（含前导空格的拼接结果）；null 表示需要回退 VNode 路径
 */
function serializeStaticAttrs(attrs: t.ObjectExpression): string | null {
  const parts: string[] = [];

  for (const prop of attrs.properties) {
    // 理论不可达：isStaticValue 已保证只含非 computed 的 ObjectProperty
    if (!t.isObjectProperty(prop) || prop.computed) continue;
    const key = staticPropKeyName(prop);
    if (key === null) continue;

    // 运行时属性 / v-* 指令 → 整棵子树回退 VNode 提升路径
    if (RUNTIME_ATTR_KEYS.has(key) || key.startsWith("v-")) return null;
    // SSR 跳过的内部字段 → 镜像 SKIP_ATTRS 静默跳过
    if (SSR_SKIP_ATTR_KEYS.has(key)) continue;

    const value = prop.value;

    // style：编译期 serializeStyle
    if (key === "style") {
      const styleStr = staticStyleAttr(value);
      if (styleStr === null) return null;
      if (styleStr !== "") parts.push(styleStr);
      continue;
    }

    // class/className：编译期 normalizeClass
    if (key === "className" || key === "class") {
      const cls = staticClassValue(value);
      if (cls !== "") parts.push(` class="${escapeHtmlText(cls)}"`);
      continue;
    }

    const htmlAttr = DOM_PROP_TO_HTML_ATTR[key] ?? key;

    // 布尔值：镜像 ssr.ts 布尔属性语义（布尔属性存在即为 true，普通属性输出 "true"/"false"）
    if (t.isBooleanLiteral(value)) {
      if (isBooleanHtmlAttr(key)) {
        if (value.value) parts.push(` ${htmlAttr}`);
      } else {
        parts.push(` ${htmlAttr}="${value.value ? "true" : "false"}"`);
      }
      continue;
    }

    // 其他标量：镜像 escapeHtml(String(value))；非标量（对象/数组）→ 回退保持运行时 String() 行为
    const strVal = staticScalarToString(value);
    if (strVal === null) return null;
    parts.push(` ${htmlAttr}="${escapeHtmlText(strVal)}"`);
  }

  return parts.join("");
}

/** 镜像 ssr.ts isBooleanAttr */
function isBooleanHtmlAttr(key: string): boolean {
  const htmlAttr = DOM_PROP_TO_HTML_ATTR[key] ?? key;
  return (
    BOOLEAN_HTML_ATTRS.has(key.toLowerCase()) ||
    BOOLEAN_HTML_ATTRS.has(htmlAttr.toLowerCase())
  );
}

/**
 * 生成静态子节点片段的 HTML（文本/数字/数组/嵌套静态 h() 调用）
 * @returns HTML 片段；null 表示需要回退 VNode 路径
 */
function genStaticChildHtml(
  node: t.Node,
  ctx: TransformContext,
  inSvg: boolean,
): string | null {
  // 文本：转义后输出（镜像 renderToString 的 escapeHtml）
  if (t.isStringLiteral(node)) return escapeHtmlText(node.value);
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return escapeHtmlText(
      node.quasis[0].value.cooked ?? node.quasis[0].value.raw,
    );
  }
  // 数字：String(n) 输出
  if (t.isNumericLiteral(node)) return String(node.value);
  if (
    t.isUnaryExpression(node) &&
    node.operator === "-" &&
    t.isNumericLiteral(node.argument)
  ) {
    return String(-node.argument.value);
  }
  // 布尔 / null：跳过（null 镜像 flattenChildren 过滤；布尔为退化用法，与 SSR 端模板直拼自洽）
  if (t.isBooleanLiteral(node) || t.isNullLiteral(node)) return "";
  // 数组：镜像 flattenChildren 递归展开
  if (t.isArrayExpression(node)) {
    const parts: string[] = [];
    for (const el of node.elements) {
      if (el === null) continue;
      const part = genStaticChildHtml(el, ctx, inSvg);
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join("");
  }
  // 对象子节点：退化用法，跳过（当前 VNode 路径下同为无效渲染）
  if (t.isObjectExpression(node)) return "";
  // 嵌套静态 h() 调用：递归生成元素 HTML
  if (t.isCallExpression(node)) return genStaticHtml(node, ctx, inSvg);
  return null;
}

/**
 * 生成单个静态 h() 调用的 HTML（元素 / fragment）
 * @returns HTML 字符串；null 表示需要回退 VNode 路径
 */
function genStaticHtml(
  node: t.CallExpression,
  ctx: TransformContext,
  inSvg: boolean,
): string | null {
  const args = node.arguments;
  const tag = (args[0] as t.StringLiteral).value;

  // Fragment：子节点 HTML 直接拼接（fragment 不产生真实 DOM，与 SSR 行为一致）
  if (tag === "fragment") {
    const parts: string[] = [];
    for (let i = 2; i < args.length; i++) {
      const part = genStaticChildHtml(args[i], ctx, inSvg);
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join("");
  }

  // 裸 SVG 子标签（非 svg 根）：HTML 解析器无法建立 SVG 命名空间 → 回退 createElementNS 路径
  if (SVG_TAGS.has(tag) && tag !== "svg" && !inSvg) return null;
  // 受限标签作为 <template> 根会被解析器丢弃 → 回退
  if (!inSvg && TEMPLATE_UNSAFE_ROOTS.has(tag)) return null;

  // 属性序列化
  let attrStr = "";
  if (args.length >= 2) {
    const attrsArg = args[1];
    if (t.isObjectExpression(attrsArg)) {
      const serialized = serializeStaticAttrs(attrsArg);
      if (serialized === null) return null;
      attrStr = serialized;
    } else if (t.isNullLiteral(attrsArg) || t.isBooleanLiteral(attrsArg)) {
      // h('div', null, ...)：falsy attrs 镜像运行时按无属性处理
      attrStr = "";
    } else {
      // 属性槽误传子节点等退化用法 → 回退保持现行为
      return null;
    }
  }

  // 自闭合标签：镜像 SSR（不输出子节点与闭合标签）
  if (HTML_VOID_TAGS.has(tag)) {
    return `<${tag}${attrStr}>`;
  }

  // 子节点内容（svg 根内部切换为 SVG 上下文，允许嵌套 SVG 图形标签）
  const childInSvg = SVG_TAGS.has(tag);
  const parts: string[] = [];
  for (let i = 2; i < args.length; i++) {
    const part = genStaticChildHtml(args[i], ctx, childInSvg);
    if (part === null) return null;
    parts.push(part);
  }
  return `<${tag}${attrStr}>${parts.join("")}</${tag}>`;
}

/**
 * 生成提升目标的模板数据（顶层入口：校验根标签的可模板性）
 * @returns { html, roots }；null 表示该子树不适用模板化（回退 VNode 提升）
 */
function genStaticTmpl(
  node: t.CallExpression,
  ctx: TransformContext,
): { html: string; roots: number } | null {
  const tag = (node.arguments[0] as t.StringLiteral).value;

  // Fragment 提升目标：所有顶层子节点必须是静态元素 h() 调用
  // （裸文本/数组/嵌套 fragment 会使 roots 计数与水合游标无法对齐）
  if (tag === "fragment") {
    const args = node.arguments;
    const parts: string[] = [];
    for (let i = 2; i < args.length; i++) {
      const arg = args[i];
      if (!t.isCallExpression(arg)) return null;
      const childTag = t.isStringLiteral(arg.arguments[0])
        ? arg.arguments[0].value
        : null;
      if (childTag === null || childTag === "fragment") return null;
      // 裸 SVG 子标签 / 受限标签：模板解析不成立 → 整棵回退
      if (SVG_TAGS.has(childTag) && childTag !== "svg") return null;
      if (TEMPLATE_UNSAFE_ROOTS.has(childTag)) return null;
      const html = genStaticHtml(arg, ctx, false);
      if (html === null) return null;
      parts.push(html);
    }
    return { html: parts.join(""), roots: parts.length };
  }

  // 单根元素：可模板性校验后生成
  if (SVG_TAGS.has(tag) && tag !== "svg") return null;
  if (TEMPLATE_UNSAFE_ROOTS.has(tag)) return null;
  const html = genStaticHtml(node, ctx, false);
  if (html === null) return null;
  return { html, roots: 1 };
}

/**
 * 转换 h() 调用
 *
 * 根据第一个参数（tag）的类型，分流到不同的转换逻辑：
 * - 字符串字面量 → 静态提升 / _createSvgEl / _createFragment / _createEl
 * - 标识符/成员表达式 → _createComp（组件调用）
 */
function transformHCall(
  path: BabelPath,
  s: MagicString,
  ctx: TransformContext,
  hoistTargets: ReadonlySet<t.CallExpression>,
): boolean {
  const node = path.node as t.CallExpression;

  // 只有框架的 h() 才转换（binding 校验，避免误伤其他库）
  if (!isFrameworkHCall(path)) return false;
  // attrs 参数「值位置」内的 h() 调用不是子节点，跳过（函数体内照常转换）
  if (isInsideAttrsOfHCall(path)) return false;

  const args = node.arguments;
  if (args.length === 0) return false;

  // 位于已提升的静态子树内部 → 由祖先整体生成代码，这里不能单独编辑
  // （否则编辑会被祖先的整段覆盖静默丢弃，且污染按需注入的 import）
  if (ctx.hoistStatic && hasHoistedAncestor(path, hoistTargets)) return false;

  const tagArg = args[0];

  // 静态提升：整棵静态子树提升为模块级常量（仅限提升目标）
  if (ctx.hoistStatic && hoistTargets.has(node)) {
    return hoistStaticCall(node, s, ctx);
  }

  // 情况 1：标签为字符串字面量
  if (t.isStringLiteral(tagArg)) {
    const tag = tagArg.value;

    // Fragment → _createFragment(...children)
    // 丢弃 attrs 参数（_createFragment 签名是 rest children，
    // 旧实现保留 attrs 会把 {} 当作第一个子节点导致运行时报错）
    if (tag === "fragment") {
      // ★ 响应式子节点追踪：将动态表达式包装为 _reactiveText
      const childArgs = args.slice(2);
      const childrenCode = childArgs
        .map((a) => getReactiveChildCode(a, path, s, ctx))
        .join(", ");
      s.overwrite(node.start!, node.end!, `_createFragment(${childrenCode})`);
      markUsed(ctx, "_createFragment");
      return true;
    }

    // SVG 标签 → _createSvgEl（预设命名空间）
    if (SVG_TAGS.has(tag)) {
      s.overwrite(node.callee.start!, node.callee.end!, "_createSvgEl");
      markUsed(ctx, "_createSvgEl");
      // ★ L12：静态 attrs 单独提升（仅 hoistStatic；失败则回退属性预分类）
      if (!(
        ctx.hoistStatic && hoistStaticAttrs(node, s, ctx, hoistTargets, tag)
      )) {
        if (ctx.compileAttrs && args.length >= 2) {
          rewriteAttrs(node, s);
        }
      }
      // ★ 响应式子节点追踪：将动态表达式包装为 _reactiveText
      transformReactiveChildren(node, path, s, ctx, 2);
      return true;
    }

    // 普通元素 → _createEl + 属性预分类
    s.overwrite(node.callee.start!, node.callee.end!, "_createEl");
    markUsed(ctx, "_createEl");
    // ★ L12：静态 attrs 单独提升（仅 hoistStatic；失败则回退属性预分类）
    if (!(
      ctx.hoistStatic && hoistStaticAttrs(node, s, ctx, hoistTargets, tag)
    )) {
      if (ctx.compileAttrs && args.length >= 2) {
        rewriteAttrs(node, s);
      }
    }
    // ★ 响应式子节点追踪：将动态表达式包装为 _reactiveText
    transformReactiveChildren(node, path, s, ctx, 2);
    return true;
  }

  // 情况 2：标签为标识符或成员表达式（组件引用）
  if (t.isIdentifier(tagArg) || t.isMemberExpression(tagArg)) {
    // h(Fragment, {}, ...children) → _createFragment(...children)
    if (
      t.isIdentifier(tagArg) &&
      args.length >= 2 &&
      t.isObjectExpression(args[1]) &&
      args[1].properties.length === 0 &&
      isFrameworkNamedImport(path, tagArg.name, "Fragment")
    ) {
      // ★ 响应式子节点追踪：将动态表达式包装为 _reactiveText
      const childArgs = args.slice(2);
      const childrenCode = childArgs
        .map((a) => getReactiveChildCode(a, path, s, ctx))
        .join(", ");
      s.overwrite(node.start!, node.end!, `_createFragment(${childrenCode})`);
      markUsed(ctx, "_createFragment");
      return true;
    }

    // 组件调用 → _createComp（组件上的 onMounted/onReady 是生命周期回调，
    // 不是 DOM 事件，因此不做 DOM 式属性预分类）
    // ★ L15：编译期可静态证明 attrs 不含 ref/__providers 时走 _createCompPure
    //   （跳过运行时的 ref 与 __providers 提取；实测收益见 §10）
    if (canUseCompPure(args[1])) {
      s.overwrite(node.callee.start!, node.callee.end!, "_createCompPure");
      markUsed(ctx, "_createCompPure");
    } else {
      s.overwrite(node.callee.start!, node.callee.end!, "_createComp");
      markUsed(ctx, "_createComp");
    }
    // ★ 响应式 props：动态 prop 表达式包装为 _rp thunk
    // （运行时 _createComp 检测 _rp 标记后把 props 包装为惰性代理，
    //   组件内部在 effect / 响应式 getter 中读取 props.x 即建立信号依赖）
    // 控制流组件（For/Show/Switch/Match/Dynamic）豁免：each/when/component
    // 需要 Signal/getter 本体，包装会破坏 toGetter 三形态协议；
    // 成员表达式标签（h(Obj.Comp)）无法解析绑定来源，保守跳过
    if (
      ctx.compileAttrs &&
      t.isIdentifier(tagArg) &&
      !isFrameworkFlowImport(path, tagArg.name)
    ) {
      rewriteCompAttrs(node, s, ctx);
    }
    // ★ 响应式子节点追踪：将动态表达式包装为 _reactiveText
    transformReactiveChildren(node, path, s, ctx, 2);
    return true;
  }

  return false;
}

/**
 * 判断 h() 调用是否含动态子节点（第 2 个及之后的参数中存在非静态字面量）
 *
 * 全静态子树会走整棵提升（hoistStaticCall），不会进入单独提升 attrs 的路径；
 * 只有「attrs 静态 + children 动态」时，attrs 对象才值得单独提升。
 */
function hasDynamicChild(node: t.CallExpression): boolean {
  for (let i = 2; i < node.arguments.length; i++) {
    if (!isStaticValue(node.arguments[i])) return true;
  }
  return false;
}

/**
 * 判断静态值节点树内是否出现**任何标识符引用**
 *
 * 用途：静态 attrs 会被提升为模块级常量（模块初始化时求值一次）。
 * 若 attrs 值引用了导入的绑定或模块级变量，而该绑定在模块初始化之后被改写，
 * 提升就会把值冻结成早期快照，与「每次渲染重新求值」的原语义不一致。
 * 静态 attrs 本应只含字面量/纯对象/纯数组，出现任何标识符即保守放弃提升。
 *
 * 未知节点类型一律视为「可能含标识符」（保守：放弃提升而非误提升）。
 */
function containsIdentifier(node: t.Node): boolean {
  if (t.isIdentifier(node)) return true;
  if (t.isStringLiteral(node)) return false;
  if (t.isNumericLiteral(node)) return false;
  if (t.isBooleanLiteral(node)) return false;
  if (t.isNullLiteral(node)) return false;
  if (t.isObjectExpression(node)) {
    return node.properties.some((p) =>
      containsIdentifier(p as unknown as t.Node),
    );
  }
  if (t.isObjectProperty(node)) {
    return (
      (node.computed && containsIdentifier(node.key as t.Node)) ||
      containsIdentifier(node.value)
    );
  }
  if (t.isArrayExpression(node)) {
    return node.elements.some((el) => el !== null && containsIdentifier(el));
  }
  if (t.isUnaryExpression(node)) return containsIdentifier(node.argument);
  if (t.isTemplateLiteral(node)) {
    return node.expressions.some((e) => containsIdentifier(e));
  }
  // 未知/复合节点 → 保守视为含引用
  return true;
}

/**
 * L12：静态 attrs 单独提升
 *
 * 当「attrs 全静态 + children 动态」时，把 attrs 对象提升为模块级常量
 * `_hoisted_attrs_N`，使用点直接引用该常量，省掉每次渲染重新分配 attrs 对象。
 *
 * 准入条件（全部满足才提升）：
 * - 仅 ctx.hoistStatic（与整棵子树提升同一开关，dev 不提升）
 * - tag 为字符串字面量、非 fragment（fragment 丢弃 attrs）
 * - 该调用不是整棵静态提升目标（hoistTargets），否则已内联进 VNode 常量
 * - 至少有一个动态子节点（全静态时由整棵提升覆盖，单独提升 attrs 无收益）
 * - attrs 为非空 ObjectExpression，且每个属性都是「非 computed 且值静态」的 ObjectProperty
 *   （SpreadElement / computed key / 动态值一律不提升）
 * - 不含 onXxx 事件（必须逐次生成 __events）、不含 __reactiveAttrs / __events /
 *   __props / 手写内部协议字段 __ref / __providers
 * - 求值结果不依赖任何模块级可变绑定（containsIdentifier 检查），
 *   避免把「导入后被改写的绑定」冻结成模块初始化时的快照
 *
 * ★ 共享对象安全性（已验证运行时不会 mutate）：
 * - core/mount.ts applyAttrs / applyReactiveAttrs 只**读取** attrs（for-in + 读值），
 *   不写入、不删除任何键（已核对 applyAttrs 全部分支）
 * - core/internal.ts extractProviders 在含 __providers 时返回 `{ ...attrs }` 浅拷贝
 *   并 `delete rest.__providers`，**不修改入参对象**；不含 __providers 时原样返回
 * - 显式拒绝含事件 / 动态值 / SpreadElement 的 attrs，因此产物中不存在
 *   __events / __reactiveAttrs 等需要逐次生成的字段，共享容器恒为只读访问
 * 故多个使用点共享同一 attrs 常量不会互相污染。
 *
 * @returns 是否已提升
 */
function hoistStaticAttrs(
  node: t.CallExpression,
  s: MagicString,
  ctx: TransformContext,
  hoistTargets: ReadonlySet<t.CallExpression>,
  tag: string,
): boolean {
  // fragment 的 attrs 会被 _createFragment 丢弃，提升没有意义
  if (tag === "fragment") return false;
  // 整棵子树已提升 → attrs 内联进 VNode 常量，不单独提升（避免重复）
  if (hoistTargets.has(node)) return false;
  // 全静态子节点 → 整棵提升覆盖；只有 children 动态时 attrs 才值得单独提升
  if (!hasDynamicChild(node)) return false;

  const attrsArg = node.arguments[1];
  if (!t.isObjectExpression(attrsArg)) return false;
  // 空 attrs 对象不提升（收益微小）
  if (attrsArg.properties.length === 0) return false;

  const parts: string[] = [];
  for (const prop of attrsArg.properties) {
    // SpreadElement / computed key → 不提升
    if (!t.isObjectProperty(prop) || prop.computed) return false;
    // 属性值必须静态（字面量 / 纯对象 / 纯数组），且不引用任何标识符
    if (!isStaticValue(prop.value)) return false;
    if (containsIdentifier(prop.value)) return false;

    let keyName = "";
    let keyStr = "";
    if (t.isIdentifier(prop.key)) {
      keyName = prop.key.name;
      keyStr = prop.key.name;
    } else if (t.isStringLiteral(prop.key)) {
      keyName = prop.key.value;
      keyStr = `'${prop.key.value}'`;
    } else {
      // 数字键等其它形态 → 保守不提升
      return false;
    }

    // 运行时协议内部字段 → 必须逐次生成/处理，不提升
    if (
      keyName === "__reactiveAttrs" ||
      keyName === "__events" ||
      keyName === "__ref" ||
      keyName === "__providers"
    ) {
      return false;
    }

    // 事件属性必须每次生成 __events（不能冻结成模块级常量）
    const isEvent =
      keyName.startsWith("on") &&
      keyName.length > 2 &&
      keyName[2] === keyName[2].toUpperCase();
    if (isEvent) return false;

    // ref → __ref（与 rewriteAttrs 的预分类命名保持一致）
    const finalKey = keyName === "ref" ? "__ref" : keyStr;
    parts.push(`${finalKey}: ${genStaticExpr(prop.value, ctx)}`);
  }

  const name = `_hoisted_attrs_${++ctx.hoistedAttrsCount}`;
  ctx.hoistedDecls.push(`const ${name} = { ${parts.join(", ")} };\n`);
  // 用常量引用替换整个 attrs 对象区间（该区间内已无其它编辑）
  s.overwrite(attrsArg.start!, attrsArg.end!, name);
  return true;
}

/**
 * 属性预分类
 *
 * 将 onXxx 事件属性提取到 __events 对象中，
 * 将 ref 属性重命名为 __ref，
 * 让运行时 applyAttrs 跳过遍历判断。
 *
 * 实现方式：直接替换整个 attrs 对象字符串，避免逐个属性移除的复杂位置计算。
 *
 * ★ 单次编辑安全性（replaceAttrs 与 transformHCall 的调用顺序保证）：
 * transformHCall 的提前返回分支（attrs 值位置内的 h()、已提升子树内的 h()）
 * 都不会进入 rewriteAttrs；而 hasAttrsAncestor 已把 attrs 区间内的调用
 * 全部排除出提升目标，因此本函数覆盖 attrs 整段区间时，
 * 区间内不存在会被静默丢弃的子级编辑。
 *
 * 注意：属性值取自 s.original（源码原文），不做 s.slice 展开 ——
 * attrs 区间内不允许子级编辑是上述准入条件的一部分。
 */
function rewriteAttrs(node: t.CallExpression, s: MagicString): void {
  const args = node.arguments;
  if (args.length < 2) return;

  const attrsArg = args[1];
  if (!t.isObjectExpression(attrsArg)) return;

  const events: string[] = [];
  const remainingProps: string[] = [];
  // ★ 动态属性值提取到 __reactiveAttrs（mount 时注册 effect 自动更新）
  const reactiveAttrs: string[] = [];

  for (const prop of attrsArg.properties) {
    // 非 ObjectProperty（如 SpreadElement）直接保留
    if (!t.isObjectProperty(prop) || prop.computed) {
      const propCode = s.original.slice(prop.start!, prop.end!);
      remainingProps.push(propCode);
      continue;
    }

    // 获取属性名
    let keyName = "";
    let keyStr = "";
    if (t.isIdentifier(prop.key)) {
      keyName = prop.key.name;
      keyStr = prop.key.name;
    } else if (t.isStringLiteral(prop.key)) {
      keyName = prop.key.value;
      keyStr = `'${prop.key.value}'`;
    } else {
      const propCode = s.original.slice(prop.start!, prop.end!);
      remainingProps.push(propCode);
      continue;
    }

    const valueCode = s.original.slice(prop.value.start!, prop.value.end!);

    // 运行时协议内部字段（手写 __reactiveAttrs/__events/__ref/__providers）→ 原样保留。
    // 这些字段的值必然含 getter/对象/数组，isStaticValue 恒为 false；若落入下方
    // 「动态属性」分支被包装为 () => (value)，编译器生成的 __reactiveAttrs 集合中
    // 会出现键名本身的条目（rKey === "__reactiveAttrs"），运行时 applyReactiveAttrs
    // 走 else 分支把对象 String() 后 setAttribute 写入 DOM（表现为
    // __reactiveattrs="[object Object]"），且手写协议的响应式更新全部失效。
    // 原样保留后运行时各消费点（applyReactiveAttrs/bindRef/h() 提取）正常处理。
    if (
      keyName === "__reactiveAttrs" ||
      keyName === "__events" ||
      keyName === "__ref" ||
      keyName === "__providers"
    ) {
      remainingProps.push(`${keyStr}: ${valueCode}`);
      continue;
    }

    // 事件属性：onXxx → __events.xxx
    if (
      keyName.startsWith("on") &&
      keyName.length > 2 &&
      keyName[2] === keyName[2].toUpperCase()
    ) {
      const eventName = keyName.slice(2).toLowerCase();
      events.push(`${eventName}: ${valueCode}`);
    } else if (keyName === "ref") {
      // ref 属性 → __ref
      remainingProps.push(`__ref: ${valueCode}`);
    } else if (isStaticValue(prop.value)) {
      // 静态属性值 → 保留
      remainingProps.push(`${keyStr}: ${valueCode}`);
    } else {
      // 动态属性值 → 提取到 __reactiveAttrs
      // 用括号包裹避免对象字面量被误解析为箭头函数块体（() => {...} 歧义）
      reactiveAttrs.push(`${keyStr}: () => (${valueCode})`);
    }
  }

  // 构建 __events 字符串
  if (events.length > 0) {
    remainingProps.push(`__events: { ${events.join(", ")} }`);
  }

  // 构建 __reactiveAttrs 字符串（动态属性值，mount 时注册 effect 自动更新）
  if (reactiveAttrs.length > 0) {
    remainingProps.push(`__reactiveAttrs: { ${reactiveAttrs.join(", ")} }`);
  }

  // 用新的 attrs 对象替换原始的
  const newAttrsStr = `{ ${remainingProps.join(", ")} }`;
  s.overwrite(attrsArg.start!, attrsArg.end!, newAttrsStr);
}

/**
 * 判断标识符是否为框架控制流组件导入（For/Show/Switch/Match/Dynamic）
 *
 * 这些组件的 each/when/component props 按「Signal / getter / 值」三形态
 * 由运行时 toGetter 消费，需要拿到 Signal/getter 本体：
 * - 编译期：rewriteCompAttrs 跳过包装（thunk 会破坏 toGetter 协议）
 * - 运行时：_createComp/h() 跳过 props 代理（见 core/reactiveProps.ts）
 */
function isFrameworkFlowImport(path: BabelPath, localName: string): boolean {
  return (
    isFrameworkNamedImport(path, localName, "For") ||
    isFrameworkNamedImport(path, localName, "Show") ||
    isFrameworkNamedImport(path, localName, "Switch") ||
    isFrameworkNamedImport(path, localName, "Match") ||
    isFrameworkNamedImport(path, localName, "Dynamic")
  );
}

/**
 * L15：判断组件调用能否使用 _createCompPure
 *
 * `_createCompPure` 跳过 ref / __providers 提取，因此只有在**静态可证**
 * attrs 不可能携带这两个内部键时才允许选用：
 * - attrs 参数省略
 * - attrs 为 null / undefined 字面量
 * - attrs 为对象字面量，且每个属性都是「非 computed 的 ObjectProperty」，
 *   且键名不是 ref / __providers
 *
 * 以下情形一律返回 false（回退 _createComp，行为保守正确）：
 * - SpreadElement：`{ ...extra }` 可能展开出 ref / __providers
 * - computed key：`{ [k]: v }` 运行时才知道键名
 * - 动态 attrs 表达式/标识符：无法静态判定
 * - 键名直接是 ref / __providers
 *
 * 说明：`rewriteCompAttrs` 只会把动态值包装为 `_rp(() => ...)`，
 * 不会增删键名，因此本判定与后续属性重写不冲突。
 */
function canUseCompPure(attrsArg: t.Node | undefined): boolean {
  // 省略第二参数 → attrs 为 undefined，运行时 rawAttrs 为空对象
  if (attrsArg === undefined) return true;
  if (t.isNullLiteral(attrsArg)) return true;
  if (t.isIdentifier(attrsArg) && attrsArg.name === "undefined") return true;
  if (!t.isObjectExpression(attrsArg)) return false;

  for (const prop of attrsArg.properties) {
    if (!t.isObjectProperty(prop) || prop.computed) return false;
    if (t.isIdentifier(prop.key)) {
      if (prop.key.name === "ref" || prop.key.name === "__providers")
        return false;
    } else if (t.isStringLiteral(prop.key)) {
      if (prop.key.value === "ref" || prop.key.value === "__providers")
        return false;
    } else {
      // 数字键等其它形态：保守不启用
      return false;
    }
  }
  return true;
}

/**
 * 组件响应式 props 包装
 *
 * 将组件调用 attrs 中的动态 prop 表达式包装为 _rp(() => expr) thunk：
 * - 运行时（_createComp）检测 _rp 标记后把 props 包装为惰性代理，
 *   组件内部在 effect / 响应式 getter 中读取 props.x 即建立信号依赖
 * - thunk 对求值透明（纯表达式的 call-by-need），值为函数时同样原样返回
 *
 * 与 rewriteAttrs（DOM 属性预分类）的区别：
 * - DOM 的 __reactiveAttrs 是字符串语义（class/style/attribute）
 * - 组件 props 保留原始 JS 值形态，由子组件自行消费
 * - 以下属性一律原样透传、绝不包装：
 *   1. onXxx 事件回调（生命周期/组件事件）
 *   2. 函数值（render 回调 / For 的 keyFn / 手写 getter 协议）
 *   3. 静态值（字面量/纯对象/纯数组）
 *   4. 内部字段（ref / children / __providers / key）
 */
/**
 * 判断表达式是否为 useContext() 调用
 *
 * 响应式上下文在 setup 期返回惰性 Proxy，若再包一层 _rp thunk，
 * effect 阶段会脱离 Provider 组件作用域重新调用 useContext。
 * 因此作为组件 prop 时原样透传 Proxy，由子组件按需读取。
 */
function isUseContextCall(node: t.Node): boolean {
  if (!t.isCallExpression(node)) return false;
  const callee = node.callee;
  return t.isIdentifier(callee) && callee.name === "useContext";
}

function rewriteCompAttrs(
  node: t.CallExpression,
  s: MagicString,
  ctx: TransformContext,
): void {
  const args = node.arguments;
  if (args.length < 2) return;

  const attrsArg = args[1];
  if (!t.isObjectExpression(attrsArg)) return;

  const parts: string[] = [];
  let wrapped = false;

  for (const prop of attrsArg.properties) {
    // 非 ObjectProperty（如 SpreadElement）直接保留
    if (!t.isObjectProperty(prop) || prop.computed) {
      parts.push(s.original.slice(prop.start!, prop.end!));
      continue;
    }

    // 获取属性名
    let keyName = "";
    let keyStr = "";
    if (t.isIdentifier(prop.key)) {
      keyName = prop.key.name;
      keyStr = prop.key.name;
    } else if (t.isStringLiteral(prop.key)) {
      keyName = prop.key.value;
      keyStr = `'${prop.key.value}'`;
    } else {
      parts.push(s.original.slice(prop.start!, prop.end!));
      continue;
    }

    const valueCode = s.original.slice(prop.value.start!, prop.value.end!);

    // 事件回调 onXxx（与 rewriteAttrs 相同的大写判定，避免误伤 only 等普通属性）
    const isEvent =
      keyName.startsWith("on") &&
      keyName.length > 2 &&
      keyName[2] === keyName[2].toUpperCase();
    // 内部字段
    const isInternal =
      keyName === "ref" ||
      keyName === "children" ||
      keyName === "__providers" ||
      keyName === "key";
    // 函数值：回调 props（render/keyFn 等）与手写 getter 协议
    const isFnValue =
      t.isArrowFunctionExpression(prop.value) ||
      t.isFunctionExpression(prop.value);
    if (
      isEvent ||
      isInternal ||
      isFnValue ||
      isStaticValue(prop.value) ||
      isUseContextCall(prop.value)
    ) {
      parts.push(`${keyStr}: ${valueCode}`);
    } else {
      // 动态 prop 表达式 → _rp thunk
      //（括号包裹避免对象字面量被误解析为箭头函数块体，与 __reactiveAttrs 一致）
      parts.push(`${keyStr}: _rp(() => (${valueCode}))`);
      wrapped = true;
    }
  }

  // 无动态 props 时保持原样（零改写，避免无意义的编辑与 _rp 导入注入）
  if (!wrapped) return;

  markUsed(ctx, "_rp");
  s.overwrite(attrsArg.start!, attrsArg.end!, `{ ${parts.join(", ")} }`);
}

/**
 * 标记 defineComponent 返回值为函数组件
 *
 * 支持以下写法：
 * - const MyComp = defineComponent(...)
 * - export const MyComp = defineComponent(...)
 * - export default defineComponent(...)
 *   → 改写为 const _defaultComponent_N = ...; 标记; export default _defaultComponent_N;
 *     （export default 无法直接挂标记，必须经临时变量）
 */
function markComponentType(
  path: BabelPath,
  s: MagicString,
  ctx: TransformContext,
): boolean {
  const node = path.node;
  if (!t.isCallExpression(node)) return false;

  const callee = node.callee;
  if (!t.isIdentifier(callee)) return false;
  // binding 校验：只有框架的 defineComponent 才标记
  if (!isFrameworkNamedImport(path, callee.name, "defineComponent")) {
    return false;
  }

  // 找到赋值目标：const MyComp = defineComponent(...)
  const parentPath = path.parentPath;
  if (!parentPath) return false;
  const parent = parentPath.node;

  // 情况 1：const MyComp = defineComponent(...)
  if (t.isVariableDeclarator(parent) && t.isIdentifier(parent.id)) {
    const compName = parent.id.name;
    const insertPos = node.end!;
    s.appendRight(insertPos, `;\n${compName}.__lumina_type = 'fn'`);
    return true;
  }

  // 情况 2：export default defineComponent(...)
  if (t.isExportDefaultDeclaration(parent)) {
    // 只处理干净的 `export default defineComponent(...)` 前缀
    // 带括号/装饰等其他写法的保持原样（_createComp fallback 到 h() 仍正确）
    const prefix = s.original.slice(parent.start!, node.start!);
    if (!/^export\s+default\s*$/.test(prefix)) return false;

    const tmpName = `_defaultComponent_${++ctx.defaultExportCount}`;
    s.overwrite(parent.start!, node.start!, `const ${tmpName} = `);
    s.appendRight(
      node.end!,
      `;\n${tmpName}.__lumina_type = 'fn';\nexport default ${tmpName};`,
    );
    return true;
  }

  return false;
}

/**
 * 标记 class extends Component 为类组件
 *
 * 在 `class MyClass extends Component { ... }` 后注入：
 * MyClass.__lumina_type = 'class';
 *
 * 仅当父类 Component 来自框架模块时标记（binding 校验）
 */
function markClassComponent(path: BabelPath, s: MagicString): boolean {
  const node = path.node;
  if (!t.isClassDeclaration(node)) return false;

  // 检查是否 extends Component（必须来自框架模块）
  const superClass = node.superClass;
  if (!superClass) return false;
  const superName = t.isIdentifier(superClass) ? superClass.name : "";
  if (!superName) return false;
  if (!isFrameworkNamedImport(path, superName, "Component")) return false;

  const className = node.id?.name;
  if (!className) return false;

  // 在类声明后注入类型标记
  const insertPos = node.end!;
  s.appendRight(insertPos, `;\n${className}.__lumina_type = 'class'`);
  return true;
}
