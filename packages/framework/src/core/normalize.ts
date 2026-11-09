/**
 * ============================================
 * 属性标准化模块
 * ============================================
 * 提供 style 和 class 属性的统一标准化逻辑
 * SSR 和客户端共用，确保输出一致性
 *
 * 设计参考：Vue 3 normalizeStyle / Solid.js ssrStyle / Svelte 编译期处理
 * - 每个 CSS 属性自闭合（自带 ;），增量构建，不依赖 Array.join
 * - 空结果不输出属性，不产生 style=";" 或 class=""
 * - 字符串/对象/数组统一转换为规范化格式
 */

// ============================================
// 类型定义
// ============================================

export type NormalizedStyle = Record<string, string>;

export type ClassInput =
  | string
  | Array<string | Record<string, boolean | null | undefined>>
  | Record<string, boolean | null | undefined>
  | null
  | undefined;

export type StyleInput =
  | string
  | Record<string, unknown>
  | null
  | undefined;

// ============================================
// 驼峰 → 短横线
// ============================================

export function camelToKebab(str: string): string {
  return str.replace(/([A-Z])/g, "-$1").toLowerCase();
}

// ============================================
// Style
// ============================================

export function normalizeStyleValue(
  key: string,
  value: unknown,
): { prop: string; value: string } | null {
  if (value === null || value === undefined || value === false) {
    return null;
  }
  const strVal = String(value);
  const prop = key.startsWith("--") ? key : camelToKebab(key);
  return { prop, value: strVal };
}

function parseStyleString(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const declarations = raw.split(";");
  for (const decl of declarations) {
    const trimmed = decl.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    if (!key || value === "") continue;
    result[key] = value;
  }
  return result;
}

export function normalizeStyle(raw: StyleInput): NormalizedStyle | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "string") {
    const parsed = parseStyleString(raw);
    const keys = Object.keys(parsed);
    if (keys.length === 0) return null;
    const result: NormalizedStyle = {};
    for (const key of keys) {
      const entry = normalizeStyleValue(key, parsed[key]);
      if (entry !== null) {
        result[entry.prop] = entry.value;
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  if (typeof raw === "object" && !Array.isArray(raw)) {
    const result: NormalizedStyle = {};
    let hasValid = false;
    for (const key in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
      const entry = normalizeStyleValue(key, (raw as Record<string, unknown>)[key]);
      if (entry !== null) {
        result[entry.prop] = entry.value;
        hasValid = true;
      }
    }
    return hasValid ? result : null;
  }

  return null;
}

// ============================================
// Class
// ============================================

export function normalizeClass(raw: ClassInput): string {
  if (raw === null || raw === undefined) return "";

  if (typeof raw === "string") return raw;

  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const item of raw) {
      if (typeof item === "string") {
        if (item) parts.push(item);
      } else if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        for (const key in item) {
          if (Object.prototype.hasOwnProperty.call(item, key) && item[key]) {
            parts.push(key);
          }
        }
      }
    }
    return parts.join(" ");
  }

  if (typeof raw === "object") {
    const parts: string[] = [];
    for (const key in raw) {
      if (
        Object.prototype.hasOwnProperty.call(raw, key) &&
        (raw as Record<string, unknown>)[key]
      ) {
        parts.push(key);
      }
    }
    return parts.join(" ");
  }

  return "";
}

// ============================================
// SSR Style 序列化
// ============================================

export function serializeStyle(
  raw: StyleInput,
  escapeFn: (str: string) => string,
): string {
  const normalized = normalizeStyle(raw);
  if (!normalized) return "";

  const parts: string[] = [];
  for (const prop in normalized) {
    if (!Object.prototype.hasOwnProperty.call(normalized, prop)) continue;
    const value = normalized[prop];
    if (value === "") continue;
    parts.push(`${prop}: ${value};`);
  }

  if (parts.length === 0) return "";
  return ` style="${escapeFn(parts.join(" "))}"`;
}

// ============================================
// 客户端 Style 应用
// ============================================

export function applyStyle(
  el: HTMLElement | SVGElement,
  raw: StyleInput,
): void {
  const normalized = normalizeStyle(raw);
  if (!normalized) return;

  for (const prop in normalized) {
    if (!Object.prototype.hasOwnProperty.call(normalized, prop)) continue;
    const value = normalized[prop];
    el.style.setProperty(prop, value);
  }
}
