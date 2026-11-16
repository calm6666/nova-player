/**
 * 编译期静态判定与静态 HTML 序列化（v2 编译插件内核共享）
 *
 * 以下常量表与序列化逻辑严格镜像 core/ssr.ts 的语义
 * （VOID_ELEMENTS / DOM_PROPERTY_TO_HTML_ATTR / BOOLEAN_HTML_ATTRS /
 *  SKIP_ATTRS / serializeAttrs / serializeStyle / normalizeClass / escapeHtml），
 * 保证：模板克隆出的 DOM ≡ SSR 输出的 HTML ≡ 水合时浏览器解析的 DOM。
 */
import * as t from "@babel/types";

/**
 * 判断 AST 节点是否为静态值（字面量）
 */
export function isStaticValue(node: t.Node): boolean {
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

// ============================================
// 编译期 DOM 化：静态子树 → HTML 字符串（阶段 1）
// ============================================
//
// 以下所有常量表与序列化逻辑严格镜像 core/ssr.ts 的语义
// （VOID_ELEMENTS / DOM_PROPERTY_TO_HTML_ATTR / BOOLEAN_HTML_ATTRS /
//  SKIP_ATTRS / serializeAttrs / serializeStyle / normalizeClass / escapeHtml），
// 保证：模板克隆出的 DOM ≡ SSR 输出的 HTML ≡ 水合时浏览器解析的 DOM。

/** 与 ssr.ts VOID_ELEMENTS 一致：自闭合标签（镜像 SSR 行为：不输出子节点） */
export const HTML_VOID_TAGS = new Set([
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
export const TEMPLATE_UNSAFE_ROOTS = new Set([
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
export function escapeHtmlText(str: string): string {
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
export function serializeStaticAttrs(attrs: t.ObjectExpression): string | null {
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
