import { describe, expect, it } from "vitest";
import { h } from "@lumina/framework";
import {
  mountControlSlots,
  mountReplacementSlots,
  type ControlSlotItem,
  type SlotContext,
} from "../packages/player/src/types/slots";

/** 构造一个只用于插槽解析的最小上下文 */
const ctx: SlotContext = { player: {} as never, state: {} as never };

describe("mountControlSlots 内容类型", () => {
  it("按顺序挂载 VNode / 原生节点 / HTML 字符串 / 自定义挂载", () => {
    const container = document.createElement("div");
    const native = document.createElement("span");
    native.textContent = "native";

    const slots: ControlSlotItem[] = [
      { id: "vnode", position: "stageLeft", vnode: h("i", {}, "vnode") },
      { id: "native", position: "stageLeft", vnode: native },
      { id: "html", position: "stageLeft", vnode: "<b>html</b>text" },
      {
        id: "custom",
        position: "stageLeft",
        vnode: {
          mount(target) {
            const el = document.createElement("u");
            el.textContent = "custom";
            target.appendChild(el);
            return () => el.remove();
          },
        },
      },
    ];

    const cleanup = mountControlSlots(slots, "stageLeft", container, ctx);

    expect(container.innerHTML).toBe(
      "<i>vnode</i><span>native</span><b>html</b>text<u>custom</u>",
    );

    cleanup();
    expect(container.childNodes.length).toBe(0);
    // 幂等：重复调用不应报错或影响其他容器内容
    cleanup();
  });

  it("函数内容在挂载期展开，ctx 为空时跳过", () => {
    const container = document.createElement("div");
    const slots: ControlSlotItem[] = [
      {
        id: "fn",
        position: "rightStart",
        vnode: () => '<em data-kind="fn">html</em>',
      },
    ];

    mountControlSlots(slots, "rightStart", container, null);
    expect(container.childNodes.length).toBe(0);

    const cleanup = mountControlSlots(slots, "rightStart", container, ctx);
    expect(container.querySelector("em")?.getAttribute("data-kind")).toBe("fn");
    cleanup();
    expect(container.childNodes.length).toBe(0);
  });

  it("自定义挂载未返回 cleanup 时仍会移除追加节点", () => {
    const container = document.createElement("div");
    const cleanup = mountControlSlots(
      [
        {
          id: "multi",
          position: "topRight",
          vnode: {
            mount(target) {
              target.appendChild(document.createElement("a"));
              target.appendChild(document.createElement("a"));
            },
          },
        },
      ],
      "topRight",
      container,
      ctx,
    );

    expect(container.querySelectorAll("a").length).toBe(2);
    cleanup();
    expect(container.childNodes.length).toBe(0);
  });

  it("指定锚点时插到锚点之前，且不影响锚点本身", () => {
    const container = document.createElement("div");
    const anchor = document.createElement("span");
    anchor.id = "anchor";
    container.appendChild(anchor);

    const cleanup = mountControlSlots(
      [
        { id: "a", position: "rightStart", vnode: "<b>A</b>" },
        { id: "b", position: "rightStart", vnode: "<i>B</i>" },
      ],
      "rightStart",
      container,
      ctx,
      anchor,
    );

    expect(container.innerHTML).toBe('<b>A</b><i>B</i><span id="anchor"></span>');
    cleanup();
    expect(container.innerHTML).toBe('<span id="anchor"></span>');
  });

  it("替换原生按钮：隐藏原生、原位置插入，清理后恢复", () => {
    const container = document.createElement("div");
    const native = document.createElement("button");
    native.className = "nova-player-ctrl-volume";
    native.textContent = "V";
    container.appendChild(native);

    const cleanup = mountReplacementSlots(
      [
        {
          id: "replace-volume",
          position: "rightEnd",
          replace: "volume",
          vnode: "<b>RV</b>",
        },
      ],
      container,
      ctx,
    );

    expect(native.style.display).toBe("none");
    expect(native.getAttribute("data-replaced")).toBe("true");
    expect(container.innerHTML).toContain("<b>RV</b><button");

    cleanup();
    expect(native.style.display).toBe("");
    expect(native.hasAttribute("data-replaced")).toBe(false);
    expect(container.innerHTML).toBe(
      '<button class="nova-player-ctrl-volume">V</button>',
    );
  });

  it("替换项不会进入普通位置挂载", () => {
    const container = document.createElement("div");
    const cleanup = mountControlSlots(
      [
        {
          id: "replace-only",
          position: "rightEnd",
          replace: "volume",
          vnode: "<b>X</b>",
        },
      ],
      "rightEnd",
      container,
      ctx,
    );
    expect(container.innerHTML).toBe("");
    cleanup();
  });
});
