import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destroy, h, mount } from "../core";
import { ProgressBar } from "../packages/player/src/components/ProgressBar";
import type { VNode } from "../types";

let container: HTMLElement;
let vnode: VNode;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (vnode) destroy(vnode);
  container.remove();
});

describe("进度条跳过片头 / 片尾断点", () => {
  it("按 duration 渲染两个 oped 标记", () => {
    vnode = h(ProgressBar, {
      duration: 100,
      skipPoints: { introEnd: 10, outroStart: 80 },
    });
    mount(vnode, container);

    const points = container.querySelectorAll<HTMLElement>(
      ".nova-player-progress-point.nova-player-progress-point-oped",
    );
    expect(points.length).toBe(2);
    expect(points[0].getAttribute("data-point")).toBe("intro");
    expect(points[0].style.left).toBe("10%");
    expect(points[1].getAttribute("data-point")).toBe("outro");
    expect(points[1].style.left).toBe("80%");
  });

  it("没有断点时不渲染标记", () => {
    vnode = h(ProgressBar, { duration: 100 });
    mount(vnode, container);
    expect(
      container.querySelectorAll(".nova-player-progress-point-oped").length,
    ).toBe(0);
  });

  it("点击标记向上抛出 seek 事件", () => {
    const onSeek = vi.fn();
    vnode = h(ProgressBar, {
      duration: 100,
      skipPoints: { introEnd: 12 },
      onSeek,
    });
    mount(vnode, container);
    container
      .querySelector<HTMLElement>('[data-point="intro"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSeek).toHaveBeenCalledWith(12);
  });
});
