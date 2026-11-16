import { h } from "./h";
import { _tmpl } from "./internal";
import type {
  SkeletonHole,
  SkeletonPart,
  TmplData,
  VNode,
} from "../types/index";

/** 组件响应式 props thunk（编译插件 v2 的组件调用改写会用到） */
export { _rp } from "./reactiveProps";

/**
 * 把数组或单值包装成 fragment VNode
 *
 * 用于数组子节点的 child 洞：运行时仍交给 h() 展开。
 */
export function _frag(children: unknown): VNode {
  const list = Array.isArray(children) ? children : [children];
  return h("fragment", {}, ...(list as Parameters<typeof h>[2][]));
}

/**
 * 创建带洞的骨架工厂
 *
 * 只接收 parts，客户端模板 HTML 由 parts 派生，避免静态字符串在产物里存两份。
 * 模块级调用只缓存模板；洞在每次使用点创建，确保能捕获组件作用域变量。
 *
 * @param parts - SSR 有序片段，数字为洞下标；洞位置派生 HTML 时替换为空字符串
 * @param roots - 顶层静态节点数（fragment 多根时为静态根数）
 * @returns 使用点工厂：传入洞数组后返回 __tmpl VNode
 */
export function _tmpl2(
  parts: SkeletonPart[],
  roots: number,
): (holes?: SkeletonHole[]) => VNode {
  const html = parts
    .map((part) => (typeof part === "number" ? "" : part))
    .join("");
  const create = _tmpl(html, roots);

  return (holes: SkeletonHole[] = []): VNode => {
    // 子节点洞必须在「渲染期」求值，而不是等挂载期再调用 getter：
    // - 组件 VNode 要在渲染期创建，才能继承 provide / 当前 VNode / pendingProviders
    //   等渲染上下文（否则 useContext 拿不到 Provider、响应式 props 也失去依赖）；
    // - 与 v1 编译产物里嵌套 h() 的求值时机保持一致。
    // 求值结果直接回填 getter，挂载 / SSR / 水合复用同一份值，避免二次创建组件。
    for (const hole of holes) {
      if (hole.kind !== "child") continue;
      const value = hole.get();
      hole.get = (): unknown => value;
    }
    const vnode = create();
    if (vnode.__tmpl) {
      (vnode.__tmpl as TmplData).parts = parts;
    }
    vnode.__holes = holes;
    return vnode;
  };
}
