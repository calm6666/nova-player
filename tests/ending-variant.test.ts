import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destroy, h, mount, t } from "../core";
import { Ending } from "../packages/player/src/components/Ending";
import type { EndingApi } from "../packages/player/src/components/Ending";
import type { VNode } from "../types";
import countdownAnimation from "../packages/player/src/assets/lottie-icon/ending-countdown-animation.json";
import zhCN from "../core/locales/zh-CN.json";
import enUS from "../core/locales/en-US.json";

const RELATED = [
  { title: "第一集：开始", pic: "https://example.test/1.jpg", duration: 125 },
  { title: "第二集：继续", pic: "https://example.test/2.jpg", duration: "03:20" },
  { title: "第三集：结束", pic: "https://example.test/3.jpg", duration: 90 },
];

let container: HTMLElement;
let vnode: VNode;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (vnode) destroy(vnode);
  container.remove();
  vi.useRealTimers();
  vi.clearAllTimers();
});

const mountEnding = (
  props: Record<string, unknown>,
): EndingApi => {
  let api: EndingApi | null = null;
  vnode = h(Ending, {
    ...props,
    onEndingMounted: (next: EndingApi) => {
      api = next;
    },
  });
  mount(vnode, container);
  expect(api).not.toBeNull();
  return api as unknown as EndingApi;
};

describe("Ending station 场景", () => {
  it("渲染推荐卡片并展示 station 面板", () => {
    const api = mountEnding({ variant: "station", related: RELATED });
    api.showEndWrap();

    const wrap = container.querySelector<HTMLElement>(
      ".nova-player-ending-wrap",
    );
    expect(wrap?.getAttribute("data-select")).toBe("1");
    expect(
      container.querySelectorAll(".nova-player-ending-related-item").length,
    ).toBe(3);
    expect(
      container.querySelector(".nova-player-ending-related-title")
        ?.textContent,
    ).toBe(t("player.ui.ending.related"));
  });

  it("自动连播开启时显示倒计时，取消后关闭", () => {
    const api = mountEnding({
      variant: "station",
      related: RELATED,
      autoNext: true,
    });
    api.showEndWrap();

    const wrap = container.querySelector<HTMLElement>(
      ".nova-player-ending-wrap",
    );
    expect(wrap?.getAttribute("data-countdown")).toBe("true");
    expect(
      container.querySelector(".nova-player-ending-related-item-countdown"),
    ).not.toBeNull();
    expect(
      container.querySelector(".nova-player-ending-related-item-cancel")
        ?.textContent,
    ).toBe(t("player.ui.ending.cancel_auto_next"));

    const cancel = container.querySelector<HTMLElement>(
      ".nova-player-ending-related-item-cancel",
    );
    cancel?.click();
    expect(wrap?.getAttribute("data-countdown")).toBeNull();
  });

  it("未开启自动连播时不启动倒计时", () => {
    const api = mountEnding({
      variant: "station",
      related: RELATED,
      autoNext: false,
    });
    api.showEndWrap();

    const wrap = container.querySelector<HTMLElement>(
      ".nova-player-ending-wrap",
    );
    expect(wrap?.getAttribute("data-countdown")).toBeNull();
  });

  it("倒计时结束后触发自动连播回调", () => {
    const onAutoNext = vi.fn();
    const api = mountEnding({
      variant: "station",
      related: RELATED,
      autoNext: true,
      countdownSeconds: 5,
      onAutoNext,
    });
    api.showEndWrap();

    vi.advanceTimersByTime(5000);
    expect(onAutoNext).toHaveBeenCalledTimes(1);
  });
});

describe("Ending embedded 场景", () => {
  it("渲染外链整页结构、5×2 卡片与底部按钮", () => {
    const api = mountEnding({
      variant: "embedded",
      title: "测试视频",
      upInfo: { name: "UP 主", face: "https://example.test/face.jpg" },
      related: Array.from({ length: 10 }, (_, i) => ({
        title: `推荐 ${i + 1}`,
        pic: `https://example.test/${i + 1}.jpg`,
        duration: 60 + i,
      })),
    });
    api.showEndWrap();

    expect(
      container.querySelector(".nova-player-embedded-ending-wrap"),
    ).not.toBeNull();
    expect(
      container.querySelector(".nova-player-embedded-ending-wrap-box"),
    ).not.toBeNull();
    expect(
      container.querySelector(".nova-player-top-left-title-text")
        ?.textContent,
    ).toBe("测试视频");
    expect(
      container.querySelectorAll(".nova-player-relation-context-item").length,
    ).toBe(10);
    expect(container.querySelector(".nova-player-downlowd")?.textContent).toBe(
      t("player.ui.ending.download_app"),
    );
    expect(container.querySelector(".nova-player-enter")?.textContent).toBe(
      t("player.ui.ending.enter_site"),
    );
    // 外链场景不承担自动连播倒计时
    expect(
      container.querySelector(".nova-player-ending-related-item-cancel"),
    ).toBeNull();
    expect(
      container.querySelector(".nova-player-ending-related-item-countdown"),
    ).toBeNull();
  });
});

describe("倒计时 lottie 资源与文案", () => {
  it("倒计时动画为 5 秒、4 层", () => {
    expect(countdownAnimation.op).toBe(301);
    expect(countdownAnimation.fr).toBe(60);
    expect(countdownAnimation.layers.length).toBe(4);
    expect(countdownAnimation.nm).toContain("倒计时");
  });

  it("两种语言的片尾 / 外链文案齐全", () => {
    const keys = [
      "player.ui.ending.follow",
      "player.ui.ending.following",
      "player.ui.ending.electric",
      "player.ui.ending.like",
      "player.ui.ending.coin",
      "player.ui.ending.collect",
      "player.ui.ending.share",
      "player.ui.ending.cancel_auto_next",
      "player.ui.ending.related",
      "player.ui.ending.download_app",
      "player.ui.ending.enter_site",
      "player.ui.embed.enter_quality",
    ];
    for (const [locale, messages] of [
      ["zh-CN", zhCN as Record<string, string>],
      ["en-US", enUS as Record<string, string>],
    ] as const) {
      for (const key of keys) {
        expect(messages[key], `${locale} 缺少 ${key}`).toBeTruthy();
      }
    }
  });
});
