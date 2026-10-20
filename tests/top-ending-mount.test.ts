import { afterEach, describe, expect, it } from "vitest";
import { destroy, h, mount } from "../core";
import { Top } from "../packages/player/src/components/Top";
import { Ending } from "../packages/player/src/components/Ending";
import { TopPlugin } from "../packages/plugins/src/top";
import { EndingPlugin } from "../packages/plugins/src/ending";
import type { VNode } from "../types";

let container: HTMLElement;
let vnode: VNode | null = null;

afterEach(() => {
  if (vnode) destroy(vnode);
  container?.remove();
  vnode = null;
});

describe("Top / Ending 挂载插槽", () => {
  it("Top mount 只保留根容器并直接挂载", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    let cleaned = false;

    vnode = h(Top, {
      title: "默认标题",
      mount: (host: HTMLElement) => {
        const custom = document.createElement("div");
        custom.className = "custom-top-content";
        custom.textContent = "CUSTOM";
        host.appendChild(custom);
        return () => {
          cleaned = true;
        };
      },
    });
    mount(vnode, container);

    const root = container.querySelector(".nova-player-top-wrap");
    expect(root).not.toBeNull();
    expect(root?.querySelector(".custom-top-content")?.textContent).toBe(
      "CUSTOM",
    );
    expect(container.querySelector(".nova-player-top-left")).toBeNull();

    destroy(vnode);
    vnode = null;
    expect(cleaned).toBe(true);
  });

  it("Ending mount 只保留根容器并直接挂载", () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    vnode = h(Ending, {
      variant: "station",
      mount: (host: HTMLElement) => {
        const custom = document.createElement("div");
        custom.className = "custom-ending-content";
        custom.textContent = "CUSTOM";
        host.appendChild(custom);
      },
    });
    mount(vnode, container);

    const root = container.querySelector(".nova-player-ending-wrap");
    expect(root).not.toBeNull();
    expect(
      root?.querySelector(".custom-ending-content")?.textContent,
    ).toBe("CUSTOM");
    expect(container.querySelector(".nova-player-ending-panel")).toBeNull();
  });
});

describe("Top / Ending 插件注册", () => {
  it("TopPlugin install / uninstall 注册到 player 实例", () => {
    let registered: ((container: HTMLElement) => void | (() => void)) | null =
      null;
    const host = {
      registerTopPluginMount(mount: typeof registered) {
        registered = mount;
      },
      unregisterTopPluginMount(mount?: typeof registered) {
        if (!mount || registered === mount) registered = null;
      },
    };
    const plugin = TopPlugin({ id: "custom-top", mount: () => {} });
    expect(registered).toBeNull();
    plugin.install?.(host as never);
    expect(registered).not.toBeNull();
    plugin.uninstall?.();
    expect(registered).toBeNull();
  });

  it("EndingPlugin install / uninstall 注册到 player 实例", () => {
    let registered: ((container: HTMLElement) => void | (() => void)) | null =
      null;
    const host = {
      registerEndingPluginMount(mount: typeof registered) {
        registered = mount;
      },
      unregisterEndingPluginMount(mount?: typeof registered) {
        if (!mount || registered === mount) registered = null;
      },
    };
    const plugin = EndingPlugin({ id: "custom-ending", mount: () => {} });
    expect(registered).toBeNull();
    plugin.install?.(host as never);
    expect(registered).not.toBeNull();
    plugin.uninstall?.();
    expect(registered).toBeNull();
  });
});
