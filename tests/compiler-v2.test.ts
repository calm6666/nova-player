import { describe, expect, it } from "vitest";
import { h } from "../packages/framework/src/core/h";
import { mount, destroy, hydrate } from "../packages/framework/src/core/mount";
import { renderToString } from "../packages/framework/src/core/ssr";
import { signal } from "../packages/framework/src/core/signalsCore";
import { _tmpl2 } from "../packages/framework/src/core/internal-dom";
import { transformV2 } from "../plugins/vite-plugin-lumina-compile-v2/transform";
import type { SkeletonHole } from "../packages/framework/src/types";

/** 收集子树里的全部注释节点（必须恒为空） */
function collectComments(root: Node): Comment[] {
  const out: Comment[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.COMMENT_NODE) out.push(node as Comment);
    let child = node.firstChild;
    while (child !== null) {
      walk(child);
      child = child.nextSibling;
    }
  };
  walk(root);
  return out;
}

/** 断言模板片段与产物里都没有注释标记 */
function expectNoCommentMarker(code: string): void {
  expect(code).not.toContain("<!--");
  expect(code).not.toContain("lum:");
  expect(code).not.toContain("start:");
}

describe("compiler v2", () => {
  it("编译 elementText / attr / event / ref / child 洞，产物不含任何注释锚点", () => {
    const code = [
      "import { h } from '@lumina/framework';",
      "export const v = h('div', { class: dyn, id: 'x' }, 'pre', h(Child, {}), 'post');",
      "export const e = h('button', { onClick: handler, class: cls }, 'x');",
      "export const r = h('input', { ref: elRef, value: val });",
      "export const t = h('span', {}, () => count.value);",
    ].join("\n");

    const result = transformV2(code, "fixture.ts", {
      internalImportSource: "@lumina/framework/core/internal-dom",
    });

    expect(result).not.toBeNull();
    const out = result!.code;
    expect(out).toContain("_tmpl2([");
    expect(out).toContain('kind: "attr"');
    expect(out).toContain('kind: "event"');
    expect(out).toContain('kind: "ref"');
    expect(out).toContain('kind: "elementText"');
    // 动态子节点也是静态骨架 + 锚点编码，不回退解释执行 h()
    expect(out).toContain('kind: "child"');
    expect(out).toContain("anchorChild");
    expect(out).toContain("anchorOffset");
    expect(out).not.toMatch(/\bh\('div'/);
    expectNoCommentMarker(out);
  });

  it("child 洞按静态锚点插入：无注释、无文本占位，顺序保持", () => {
    const parts = ['<div class="wrap">', "</div>"];
    const makeHoles = (): SkeletonHole[] => [
      {
        kind: "child",
        root: 0,
        parent: [],
        anchorChild: 0,
        anchorOffset: 0,
        get: () => h("i", {}, "child"),
      },
      {
        kind: "child",
        root: 0,
        parent: [],
        anchorChild: 0,
        anchorOffset: 0,
        get: () => h("b", {}, "second"),
      },
    ];

    const vnode = _tmpl2(parts, 1)(makeHoles());
    const host = document.createElement("div");
    mount(vnode, host);

    const root = host.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("DIV");
    expect(root.innerHTML).toBe("<i>child</i><b>second</b>");
    expect(collectComments(root)).toEqual([]);
    // 只有动态元素节点，没有任何文本占位
    expect(
      [...root.childNodes].every((node) => node.nodeType === Node.ELEMENT_NODE),
    ).toBe(true);

    // SSR 只输出静态骨架，不写占位节点
    const ssr = renderToString(_tmpl2(parts, 1)(makeHoles()));
    expect(ssr).toBe('<div class="wrap"></div>');
    expect(ssr).not.toContain("<!--");

    destroy(vnode);
  });

  it("SSR 静态骨架 → 水合后挂载动态子节点，DOM 中无注释", () => {
    const parts = ['<div class="wrap">', "</div>"];
    const makeHoles = (): SkeletonHole[] => [
      {
        kind: "child",
        root: 0,
        parent: [],
        anchorChild: 0,
        anchorOffset: 0,
        get: () => h("i", {}, "child"),
      },
    ];

    const host = document.createElement("div");
    host.innerHTML = renderToString(_tmpl2(parts, 1)(makeHoles()));
    expect(host.innerHTML).toBe('<div class="wrap"></div>');

    const vnode = _tmpl2(parts, 1)(makeHoles());
    hydrate(vnode, host);

    expect(host.querySelector("i")?.textContent).toBe("child");
    expect(collectComments(host)).toEqual([]);
    destroy(vnode);
  });

  it("静态文本 + 动态文本 + 元素混排：按偏移拆分文本，顺序正确", () => {
    const label = signal("X");
    // 子节点：'a' + 动态文本 + 'b' + <i> → 模板静态结构 "<span>ab<i></i></span>"
    const parts = ["<span>ab<i></i></span>"];
    const holes: SkeletonHole[] = [
      {
        kind: "text",
        root: 0,
        parent: [],
        anchorChild: 0,
        anchorOffset: 1,
        get: () => label.value,
      },
    ];

    const vnode = _tmpl2(parts, 1)(holes);
    const host = document.createElement("div");
    mount(vnode, host);

    const span = host.querySelector("span") as HTMLSpanElement;
    expect(span.textContent).toBe("aXb");
    expect(span.querySelector("i")).not.toBeNull();
    expect(collectComments(span)).toEqual([]);

    label.value = "Y";
    expect(span.textContent).toBe("aYb");
    destroy(vnode);
  });

  it("纯文本子节点合并为 elementText 洞，响应式更新", () => {
    const count = signal(1);
    const label = signal("L");
    const holes: SkeletonHole[] = [
      {
        kind: "elementText",
        root: 0,
        path: [0],
        get: () => `${label.value}${count.value}`,
      },
    ];
    const parts = ["<div><span>", 0, "</span></div>"];
    const vnode = _tmpl2(parts, 1)(holes);
    const host = document.createElement("div");
    mount(vnode, host);

    expect(host.querySelector("span")?.textContent).toBe("L1");
    count.value = 2;
    label.value = "M";
    expect(host.querySelector("span")?.textContent).toBe("M2");
    expect(collectComments(host)).toEqual([]);
    destroy(vnode);
  });

  it("非字面量 attrs / 内部协议键不骨架化，交由 v1 收尾编译", () => {
    const code = [
      "import { h } from '@lumina/framework';",
      "export const v = h('div', attrsVar);",
      "export const w = h('div', { __reactiveAttrs: { class: () => 'x' } });",
    ].join("\n");
    // 这些 attrs 携带运行时协议语义（__reactiveAttrs 等）或不是对象字面量，
    // v2 不骨架化，交给链式 v1 编译处理，避免丢失 SSR 序列化语义。
    expect(
      transformV2(code, "fixture-attrs.ts", {
        internalImportSource: "@lumina/framework/core/internal-dom",
      }),
    ).toBeNull();
  });

  it("事件洞绑定并在 handler 变化后替换监听", () => {
    const calls: string[] = [];
    const handler = signal({ fn: () => calls.push("a") });
    const holes: SkeletonHole[] = [
      {
        kind: "event",
        root: 0,
        path: [],
        name: "onClick",
        get: () => handler.value.fn,
      },
    ];
    const vnode = _tmpl2(["<button>ok</button>"], 1)(holes);
    const host = document.createElement("div");
    mount(vnode, host);

    const btn = host.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(calls).toEqual(["a"]);

    handler.value = { fn: () => calls.push("b") };
    btn.click();
    expect(calls).toEqual(["a", "b"]);

    destroy(vnode);
    btn.click();
    expect(calls).toEqual(["a", "b"]);
  });

  it("ref 洞绑定元素引用", () => {
    let captured: Element | null = null;
    const holes: SkeletonHole[] = [
      {
        kind: "ref",
        root: 0,
        path: [],
        get: () => (el: Element) => {
          captured = el;
        },
      },
    ];
    const vnode = _tmpl2(["<div></div>"], 1)(holes);
    const host = document.createElement("div");
    mount(vnode, host);
    expect(captured).toBe(host.firstElementChild);
    destroy(vnode);
  });

  it("fragment 静态多根骨架可挂载，且无注释节点", () => {
    const vnode = _tmpl2(["<div>a</div><span>b</span>"], 2)([]);
    const host = document.createElement("div");
    mount(vnode, host);
    expect(host.innerHTML).toBe("<div>a</div><span>b</span>");
    expect(collectComments(host)).toEqual([]);
    destroy(vnode);
  });

  it("fragment 顶层动态子节点：静态根 + 客户端挂载", () => {
    const parts = ["<div>a</div>"];
    const holes: SkeletonHole[] = [
      {
        kind: "child",
        root: -1,
        anchorChild: 1,
        anchorOffset: 0,
        get: () => h("i", {}, "tail"),
      },
    ];
    const ssr = renderToString(_tmpl2(parts, 1)(holes));
    expect(ssr).toBe("<div>a</div>");

    const vnode = _tmpl2(parts, 1)(holes);
    const host = document.createElement("div");
    mount(vnode, host);
    expect(host.innerHTML).toBe("<div>a</div><i>tail</i>");
    expect(collectComments(host)).toEqual([]);
    destroy(vnode);
  });

  it("attr 洞随信号变化响应式更新 class（插槽类名切换依赖此机制）", () => {
    const paused = signal(false);
    const holes: SkeletonHole[] = [
      {
        kind: "attr",
        root: 0,
        path: [],
        name: "class",
        get: () => (paused.value ? "btn paused" : "btn"),
      },
    ];
    const vnode = _tmpl2(["<div></div>"], 1)(holes);
    const host = document.createElement("div");
    mount(vnode, host);

    const root = host.firstElementChild as HTMLElement;
    expect(root.className).toBe("btn");
    paused.value = true;
    expect(root.className).toBe("btn paused");
    paused.value = false;
    expect(root.className).toBe("btn");
    expect(collectComments(host)).toEqual([]);
    destroy(vnode);
  });

});
