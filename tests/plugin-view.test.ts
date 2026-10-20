import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destroy, h, mount } from "../core";
import { Top as TopView } from "../packages/plugins/src/top/TopView";
import { Ending as EndingView } from "../packages/plugins/src/ending/EndingView";
import type { EndingApi } from "../packages/plugins/src/ending/EndingView";

let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  vi.useRealTimers();
});

describe("插件内置视图", () => {
  it("TopView 挂到已有 top-wrap 根容器", () => {
    const host = document.createElement("div");
    host.className = "nova-player-top-wrap";
    container.appendChild(host);
    const vnode = h(TopView, { title: "剧集标题", host });
    mount(vnode, host);

    expect(host.querySelector(".nova-player-top-left-title")?.textContent).toBe(
      "剧集标题",
    );
    expect(host.querySelector(".nova-player-top-mask")).not.toBeNull();
    destroy(vnode);
  });

  it("EndingView 挂到已有 ending-wrap 并暴露 API", () => {
    const host = document.createElement("div");
    host.className = "nova-player-ending-wrap";
    container.appendChild(host);
    let api: EndingApi | null = null;
    const vnode = h(EndingView, {
      variant: "station",
      host,
      related: [
        { title: "第一集", pic: "https://example.test/1.jpg", duration: 100 },
      ],
      autoNext: true,
      onEndingMounted: (next: EndingApi) => {
        api = next;
      },
    });
    mount(vnode, host);

    expect(api).not.toBeNull();
    api!.showEndWrap();
    expect(host.getAttribute("data-select")).toBe("1");
    expect(api!.isCountdownActive()).toBe(true);
    expect(host.getAttribute("data-countdown")).toBe("true");
    destroy(vnode);
  });
});
