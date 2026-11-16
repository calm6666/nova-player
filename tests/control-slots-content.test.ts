import { describe, expect, it, vi } from "vitest";
import { h, mount } from "@lumina/framework";
import {
  NATIVE_CONTROL_SELECTORS,
  NATIVE_REPLACE_TARGETS,
  createReplaceResolver,
  findReplaceSlot,
  mountRegionSlots,
  mountReplacementSlots,
  resolveReplaceVNode,
  type SlotEntry,
  type SlotContext,
} from "../packages/player/src/types/slots";
import type { PlayerUiHost } from "../packages/player/src/types/playerPort";

/** 构造一个只用于插槽解析的最小上下文 */
const ctx: SlotContext = { player: {} as never, state: {} as never };

describe("mountRegionSlots 内容类型", () => {
  it("按顺序挂载 VNode / 原生节点 / HTML 字符串 / 自定义挂载", () => {
    const container = document.createElement("div");
    const native = document.createElement("span");
    native.textContent = "native";

    const slots: SlotEntry[] = [
      { id: "vnode", slot: "video.overlay", content: h("i", {}, "vnode") },
      { id: "native", slot: "video.overlay", content: native },
      { id: "html", slot: "video.overlay", content: "<b>html</b>text" },
      {
        id: "custom",
        slot: "video.overlay",
        content: {
          mount(target) {
            const el = document.createElement("u");
            el.textContent = "custom";
            target.appendChild(el);
            return () => el.remove();
          },
        },
      },
    ];

    const cleanup = mountRegionSlots(slots, [], "video.overlay", container, ctx);

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
    const slots: SlotEntry[] = [
      {
        id: "fn",
        slot: "controls.right.start",
        content: () => '<em data-kind="fn">html</em>',
      },
    ];

    mountRegionSlots(slots, [], "controls.right.start", container, null);
    expect(container.childNodes.length).toBe(0);

    const cleanup = mountRegionSlots(
      slots,
      [],
      "controls.right.start",
      container,
      ctx,
    );
    expect(container.querySelector("em")?.getAttribute("data-kind")).toBe("fn");
    cleanup();
    expect(container.childNodes.length).toBe(0);
  });

  it("自定义挂载未返回 cleanup 时仍会移除追加节点", () => {
    const container = document.createElement("div");
    const cleanup = mountRegionSlots(
      [
        {
          id: "multi",
          slot: "top.end",
          content: {
            mount(target) {
              target.appendChild(document.createElement("a"));
              target.appendChild(document.createElement("a"));
            },
          },
        },
      ],
      [],
      "top.end",
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

    const cleanup = mountRegionSlots(
      [
        { id: "a", slot: "controls.right.start", content: "<b>A</b>" },
        { id: "b", slot: "controls.right.start", content: "<i>B</i>" },
      ],
      [],
      "controls.right.start",
      container,
      ctx,
      anchor,
    );

    expect(container.innerHTML).toBe('<b>A</b><i>B</i><span id="anchor"></span>');
    cleanup();
    expect(container.innerHTML).toBe('<span id="anchor"></span>');
  });

  it("替换原生按钮：移除原生、原位置插入，清理后恢复", () => {
    const container = document.createElement("div");
    const native = document.createElement("button");
    native.className = "nova-player-ctrl-volume";
    native.textContent = "V";
    container.appendChild(native);

    const cleanup = mountReplacementSlots(
      [
        {
          id: "replace-volume",
          slot: "controls.right.end",
          replace: "volume",
          content: "<b>RV</b>",
        },
      ],
      container,
      ctx,
    );

    // 原生按钮整体从 DOM 移除（不是 display:none），内容占据其原位置
    expect(native.parentElement).toBeNull();
    expect(container.innerHTML).toBe("<b>RV</b>");

    cleanup();
    expect(container.innerHTML).toBe(
      '<button class="nova-player-ctrl-volume">V</button>',
    );
  });

  it("替换项不会进入普通区域挂载", () => {
    const container = document.createElement("div");
    const cleanup = mountRegionSlots(
      [
        {
          id: "replace-only",
          slot: "controls.right.end",
          replace: "volume",
          content: "<b>X</b>",
        },
      ],
      [],
      "controls.right.end",
      container,
      ctx,
    );
    expect(container.innerHTML).toBe("");
    cleanup();
  });
});

describe("渲染期替换：replace 目标不渲染", () => {
  /** 构造替换解析用的最小 player（只读 props.ui.slots 与 state） */
  const makePlayer = (slots: SlotEntry[]): PlayerUiHost =>
    ({ props: { ui: { slots } }, state: {} }) as unknown as PlayerUiHost;

  it("NATIVE_REPLACE_TARGETS 覆盖全部原生控件，且图标/结果目标分类正确", () => {
    expect(NATIVE_REPLACE_TARGETS.volume).toEqual({
      kind: "btn-icon",
      selector: ".nova-player-ctrl-btn-icon",
    });
    expect(NATIVE_REPLACE_TARGETS.play.kind).toBe("btn-icon");
    expect(NATIVE_REPLACE_TARGETS.setting.selector).toBe(
      ".nova-player-ctrl-btn-icon",
    );
    expect(NATIVE_REPLACE_TARGETS.subtitle).toEqual({
      kind: "result",
      selector: ".nova-player-ctrl-subtitle-result-wrap",
    });
    expect(NATIVE_REPLACE_TARGETS.playbackrate.selector).toBe(
      ".nova-player-ctrl-playbackrate-result",
    );
    expect(NATIVE_REPLACE_TARGETS.eplist.selector).toBe(
      ".nova-player-ctrl-eplist-result",
    );
    expect(NATIVE_REPLACE_TARGETS.quality.selector).toBe(
      ".nova-player-ctrl-quality-result",
    );
    // 键集合与原生控件选择器表一致，避免遗漏控件
    expect(Object.keys(NATIVE_REPLACE_TARGETS).sort()).toEqual(
      Object.keys(NATIVE_CONTROL_SELECTORS).sort(),
    );
  });

  it("findReplaceSlot 按 key 命中第一个替换项，未提供返回 undefined", () => {
    const slots: SlotEntry[] = [
      { id: "a", slot: "controls.right.start", replace: "volume", content: "A" },
      { id: "b", slot: "controls.right.start", replace: "volume", content: "B" },
      { id: "c", slot: "controls.right.start", content: "C" },
    ];
    expect(findReplaceSlot(slots, "volume")?.id).toBe("a");
    expect(findReplaceSlot(slots, "subtitle")).toBeUndefined();
    expect(findReplaceSlot(undefined, "volume")).toBeUndefined();
  });

  it("VNode 内容直接插入目标位置，不创建任何包装元素 / 自造 class", () => {
    const slots: SlotEntry[] = [
      {
        id: "custom-volume",
        slot: "controls.right.start",
        replace: "volume",
        content: h("span", { class: "custom-volume" }, "vol"),
      },
    ];
    const resolver = createReplaceResolver(makePlayer(slots));
    const hit = resolver.take("volume");
    expect(hit.replaced).toBe(true);
    if (!hit.node) throw new Error("replace 内容不应为空");

    const container = document.createElement("div");
    mount(h("button", { class: "nova-player-ctrl-btn" }, hit.node), container);
    const button = container.querySelector(".nova-player-ctrl-btn");
    expect(button?.children.length).toBe(1);
    expect(button?.firstElementChild?.className).toBe("custom-volume");
    expect(button?.firstElementChild?.textContent).toBe("vol");
    // 原生图标容器与任何自造 host 都不存在
    expect(container.querySelector(".nova-player-ctrl-btn-icon")).toBeNull();
    expect(container.innerHTML).not.toContain("replace-host");
  });

  it("非 VNode 内容（Node / HTML / SlotMount）不渲染且给出警告，不创建包装元素", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const literal = document.createElement("em");
    literal.textContent = "node";
    const slots: SlotEntry[] = [
      { id: "node", slot: "controls.right.start", replace: "pip", content: literal },
      { id: "html", slot: "controls.right.start", replace: "wide", content: "<u>html</u>" },
      {
        id: "mount",
        slot: "controls.right.start",
        replace: "full",
        content: {
          mount(target) {
            target.appendChild(document.createElement("i"));
          },
        },
      },
    ];
    const resolver = createReplaceResolver(makePlayer(slots));
    for (const key of ["pip", "wide", "full"] as const) {
      const hit = resolver.take(key);
      // 仍然判定为「已替换」：原生目标不渲染；但没有可插入的 VNode
      expect(hit.replaced).toBe(true);
      expect(hit.node).toBeNull();
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("未命中 replace 时 replaced=false（走原生渲染）", () => {
    const resolver = createReplaceResolver(makePlayer([]));
    const hit = resolver.take("volume");
    expect(hit.replaced).toBe(false);
    expect(hit.node).toBeNull();
    // 只有 native 目标以外的插槽项不参与替换
    const other: SlotEntry[] = [
      { id: "x", slot: "controls.right.start", content: h("b", {}, "x") },
    ];
    expect(createReplaceResolver(makePlayer(other)).take("volume").replaced).toBe(false);
  });

  it("resolveReplaceVNode 对空内容返回 null（目标同样不渲染）", () => {
    const entry: SlotEntry = {
      id: "empty",
      slot: "controls.right.start",
      replace: "volume",
      content: () => null,
    };
    expect(resolveReplaceVNode(entry, ctx)).toBeNull();
  });
});
