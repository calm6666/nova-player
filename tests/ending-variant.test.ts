import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { destroy, h, mount, t } from "../core";
import { Ending } from "../packages/plugins/src/ending/EndingView";
import type { EndingApi } from "../packages/plugins/src/ending/EndingView";
import type { VNode } from "../types";
import countdownAnimation from "../packages/plugins/src/ending/assets/ending-countdown-animation.json";
import zhCN from "../locales/zh-CN.json";
import enUS from "../locales/en-US.json";

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
  const host = document.createElement("div");
  host.className =
    props.variant === "ogv"
      ? "nova-player-ending-wrap nova-ogv-ending-wrap"
      : props.variant === "interactive"
        ? "nova-player-ending-wrap nova-interactive-ending-wrap"
        : props.variant === "embedded"
          ? "nova-player-ending-wrap nova-player-embeded-ending-wrap"
          : "nova-player-ending-wrap";
  container.appendChild(host);
  vnode = h(Ending, {
    ...props,
    host,
    onEndingMounted: (next: EndingApi) => {
      api = next;
    },
  });
  mount(vnode, host);
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
      container
        .querySelector(".nova-player-ending-related")
        ?.getAttribute("data-i18n-label"),
    ).toBe(t("player.ui.ending.related"));
  });

  it("使用 B 站标准片尾 SVG 图标（非占位图标）", () => {
    const api = mountEnding({ variant: "station", related: RELATED });
    api.showEndWrap();

    const icons = [
      ...container.querySelectorAll<SVGElement>(
        ".nova-player-ending-functions-btn .common-svg-icon svg",
      ),
    ];
    expect(icons.map((svg) => svg.getAttribute("viewBox"))).toEqual([
      "0 0 28 28",
      "0 0 24 24",
      "0 0 24 24",
      "0 0 24 24",
      "0 0 24 24",
    ]);
    // 关注按钮：B 站标准片尾无加号图标，只有文字
    expect(
      container.querySelector(
        ".nova-player-ending-functions-follow .common-svg-icon",
      ),
    ).toBeNull();
    // 充电：B 站 PNG 素材
    expect(
      container
        .querySelector(".nova-player-ending-functions-electric-icon")
        ?.getAttribute("src"),
    ).toMatch(/\.png$/);
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
      container.querySelector(".nova-player-embeded-ending-wrap"),
    ).not.toBeNull();
    expect(
      container.querySelector(".nova-player-embeded-ending-wrap-box"),
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

describe("Ending ogv 场景（电视剧 / 番剧）", () => {
  const OGV_RELATED = Array.from({ length: 6 }, (_, i) => ({
    title: `剧集推荐 ${i + 1}`,
    pic: `https://example.test/ogv-${i + 1}.jpg`,
    duration: 300 + i,
    url: `https://example.test/watch/${i + 1}`,
  }));

  it("渲染封面 / 标题 / 追剧 / 操作按钮 / 推荐卡", () => {
    const api = mountEnding({
      variant: "ogv",
      title: "西游记",
      cover: "https://example.test/cover.jpg",
      followed: false,
      related: OGV_RELATED,
    });
    api.showEndWrap();

    expect(container.querySelector(".endpage-wrap")).not.toBeNull();
    expect(
      container.querySelector(".endpage-header-title")?.textContent,
    ).toBe("西游记");
    expect(
      container
        .querySelector(".endpage-header-cover img")
        ?.getAttribute("src"),
    ).toBe("https://example.test/cover.jpg");
    expect(
      container.querySelector(".endpage-header-follow-btn")?.textContent,
    ).toContain(t("player.ui.ending.watch_series"));
    expect(
      container.querySelectorAll(".endpage-header-btn-group > div")
        .length,
    ).toBe(4);
    expect(
      container.querySelectorAll(".endpage-recommend-item").length,
    ).toBe(5);
  });

  it("OGV 片尾不展示取消连播与圆环", () => {
    const api = mountEnding({
      variant: "ogv",
      title: "西游记",
      related: OGV_RELATED,
      autoNext: true,
    });
    api.showEndWrap();

    const wrap = container.querySelector<HTMLElement>(
      ".endpage-wrap",
    );
    expect(wrap?.getAttribute("data-countdown")).toBeNull();
    expect(container.querySelector(".state-countdown-host")).toBeNull();
    expect(
      container.querySelector(".EndPageRecommendItem_cancel"),
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
      "player.ui.ending.watch_series",
      "player.ui.ending.watching_series",
      "player.ui.progress.skip_intro",
      "player.ui.progress.skip_outro",
      "player.ui.settings.skip_intro_outro",
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
