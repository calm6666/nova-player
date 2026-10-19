/** 元素选择器：支持单个元素或元素数组（null/undefined 安全跳过） */
type StyleTarget = HTMLElement | HTMLElement[] | null | undefined;

/** 驼峰转 kebab；自定义属性（--x）原样返回 */
const toKebab = (name: string): string =>
  name.startsWith("--")
    ? name
    : name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** style 中是否已无任何声明（含自定义属性） */
const isStyleEmpty = (el: HTMLElement): boolean =>
  el.style.cssText.trim() === "";

/**
 * 清除元素内联样式
 *
 * - 不传 props：直接移除整个 style 属性
 * - 传 props（单个或数组）：精准删除指定属性；
 *   删完后若 style 已无任何声明，则整体移除 style 属性（避免留下空 style="")
 *
 * @example
 * clearStyle(el);                          // 清全部
 * clearStyle(el, 'width');                 // 清单个
 * clearStyle(el, ['width', 'height']);     // 清多个
 * clearStyle([a, b], 'width');             // 批量
 * clearStyle(el, 'backgroundColor');       // 自动兼容驼峰
 */
export function clearStyle(
  target: StyleTarget,
  props?: string | string[],
): void {
  if (!target) return;

  if (Array.isArray(target)) {
    target.forEach((el) => clearStyle(el, props));
    return;
  }

  // 清整个 style 属性
  if (props === undefined) {
    target.removeAttribute("style");
    return;
  }

  // 精准删除指定属性
  const list = Array.isArray(props) ? props : [props];
  list.forEach((p) => target.style.removeProperty(toKebab(p)));

  // 删完后若已无任何声明，整体移除 style 属性
  if (isStyleEmpty(target)) {
    target.removeAttribute("style");
  }
}
