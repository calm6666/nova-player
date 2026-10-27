/**
 * 音乐插件测试：挂载 / 卸载 / 双模式 / 外部挂载点 / Top 音乐模式依赖
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { h, mount } from "../core";
import { MusicPlugin } from "../packages/plugins/src/music/MusicPlugin";
import { mockMusicDetail, mockVideoList, mockRecommendList } from "../packages/plugins/src/music/mock";
import { TopPlugin } from "../packages/plugins/src/top";
import type { VideoPlayer } from "../packages/player/src/player/VideoPlayer";

/** 简化版状态管理器（仅实现插件用到的 subscribe） */
interface FakeState {
  subscribe(
    path: string,
    listener: (value: unknown) => void,
  ): () => void;
  emit(path: string, value: unknown): void;
}

/** 简化版播放器宿主（供插件 install 使用） */
interface FakePlayer {
  el: HTMLElement;
  state: FakeState;
  on(event: string, callback: () => void): () => void;
  emit(event: string): void;
  isFullscreen(): boolean;
  isWebFullscreen(): boolean;
  refreshTop(): void;
  refreshCount: number;
  fullscreen: boolean;
  webFullscreen: boolean;
}

/** 构造简化版播放器宿主：DOM 结构与真实 PlayerDocker 对齐 */
function createFakePlayer(): FakePlayer {
  const root = document.createElement("div");
  root.className = "nova-player-docker";
  const container = document.createElement("div");
  container.className = "nova-player-container";
  const area = document.createElement("div");
  area.className = "nova-player-video-area";
  const dialog = document.createElement("div");
  dialog.className = "nova-player-dialog-wrap";
  area.appendChild(dialog);
  container.appendChild(area);
  root.appendChild(container);
  document.body.appendChild(root);

  const listeners = new Map<string, Array<(value: unknown) => void>>();
  const mountedListeners: Array<() => void> = [];

  const state: FakeState = {
    subscribe(path, listener) {
      const list = listeners.get(path) ?? [];
      list.push(listener);
      listeners.set(path, list);
      return () => {
        const next = (listeners.get(path) ?? []).filter(
          (item) => item !== listener,
        );
        listeners.set(path, next);
      };
    },
    emit(path, value) {
      (listeners.get(path) ?? []).forEach((listener) => listener(value));
    },
  };

  const fake: FakePlayer = {
    el: root,
    state,
    fullscreen: false,
    webFullscreen: false,
    refreshCount: 0,
    on(_event, callback) {
      mountedListeners.push(callback);
      return () => {
        const index = mountedListeners.indexOf(callback);
        if (index >= 0) mountedListeners.splice(index, 1);
      };
    },
    emit() {
      mountedListeners.slice().forEach((callback) => callback());
    },
    isFullscreen() {
      return this.fullscreen;
    },
    isWebFullscreen() {
      return this.webFullscreen;
    },
    refreshTop() {
      this.refreshCount += 1;
    },
  };
  return fake;
}

/** 断言辅助：从 fake 宿主取播放器类型 */
function asPlayer(fake: FakePlayer): VideoPlayer {
  return fake as unknown as VideoPlayer;
}

/** 等待微任务（插件内 Top 刷新调度） */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

let externalTarget: HTMLElement;
let fake: FakePlayer;

beforeEach(() => {
  externalTarget = document.createElement("div");
  externalTarget.id = "music-mount";
  externalTarget.className = "nova-player-music-wrap";
  document.body.appendChild(externalTarget);
  fake = createFakePlayer();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MusicPlugin 挂载 / 卸载", () => {
  it("非全屏：挂载到外部 target，卸载后清空", async () => {
    const plugin = MusicPlugin({
      musicId: mockMusicDetail.music_id,
      data: {
        detail: mockMusicDetail,
        videoList: mockVideoList,
        recommendList: mockRecommendList,
      },
      target: "#music-mount",
    });
    plugin.install?.(asPlayer(fake));

    const app = externalTarget.querySelector<HTMLElement>("#musicApp");
    expect(app).not.toBeNull();
    expect(app?.className).toContain("nova-music-app");
    expect(app?.className).toContain("nova-music-normal");
    expect(app?.className).not.toContain("nova-music-in-player");
    // 头部固定文案 + 详情标题
    expect(
      externalTarget.querySelector(".nova-music-header .nova-music-title")
        ?.textContent,
    ).toBe("音乐详情");
    expect(
      externalTarget.querySelector(".nova-music-detail-info .nova-music-title")
        ?.textContent,
    ).toContain(mockMusicDetail.music_title);
    // 音乐视频区标题
    expect(
      externalTarget.querySelector(".nova-music-video-container .nova-music-title")
        ?.textContent,
    ).toBe("音乐视频");
    await flushMicrotasks();
    // Top 刷新调度（音乐模式 gating）
    expect(fake.refreshCount).toBeGreaterThan(0);

    plugin.uninstall?.();
    expect(externalTarget.querySelector("#musicApp")).toBeNull();
    await flushMicrotasks();
    expect(fake.refreshCount).toBeGreaterThan(1);
  });

  it("全屏：挂载到播放器 dialog-wrap 后一个位置，使用深色窄栏形态", async () => {
    fake.fullscreen = true;
    const plugin = MusicPlugin({
      musicId: mockMusicDetail.music_id,
      data: { detail: mockMusicDetail },
      target: "#music-mount",
    });
    plugin.install?.(asPlayer(fake));

    const dialog = fake.el.querySelector(".nova-player-dialog-wrap");
    const wrap = dialog?.nextSibling;
    expect(wrap instanceof HTMLElement).toBe(true);
    expect((wrap as HTMLElement).className).toBe("nova-player-music-wrap");
    const app = (wrap as HTMLElement).querySelector<HTMLElement>("#musicApp");
    expect(app).not.toBeNull();
    expect(app?.className).toContain("nova-music-in-player");
    expect(app?.className).toContain("nova-music-dark");
    // 外部挂载点不显示
    expect(externalTarget.querySelector("#musicApp")).toBeNull();

    plugin.uninstall?.();
    expect(fake.el.querySelector(".nova-player-music-wrap")).toBeNull();
  });

  it("关闭按钮：卸载面板并回调宿主 onClose", () => {
    let closed = false;
    const plugin = MusicPlugin({
      musicId: mockMusicDetail.music_id,
      data: {
        detail: mockMusicDetail,
        videoList: mockVideoList,
        recommendList: mockRecommendList,
      },
      target: "#music-mount",
      onClose: (): void => {
        closed = true;
      },
    });
    plugin.install?.(asPlayer(fake));

    const closeButton =
      externalTarget.querySelector<HTMLElement>(".nova-music-close");
    expect(closeButton).not.toBeNull();
    closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(closed).toBe(true);
    expect(externalTarget.querySelector("#musicApp")).toBeNull();
    plugin.uninstall?.();
  });
});

describe("MusicPlugin 双模式切换", () => {
  it("全屏状态变化时在页面挂载点与播放器内之间切换", async () => {
    const plugin = MusicPlugin({
      musicId: mockMusicDetail.music_id,
      data: { detail: mockMusicDetail },
      target: "#music-mount",
    });
    plugin.install?.(asPlayer(fake));

    expect(externalTarget.querySelector("#musicApp")).not.toBeNull();

    // 进入网页全屏 → 切到播放器内部
    fake.webFullscreen = true;
    fake.state.emit("player.isWebFullscreen", true);
    const wrap = fake.el.querySelector(".nova-player-music-wrap");
    expect(wrap).not.toBeNull();
    expect(wrap?.querySelector("#musicApp")).not.toBeNull();
    expect(externalTarget.querySelector("#musicApp")).toBeNull();

    // 退出网页全屏 → 回到页面挂载点
    fake.webFullscreen = false;
    fake.state.emit("player.isWebFullscreen", false);
    expect(externalTarget.querySelector("#musicApp")).not.toBeNull();
    expect(fake.el.querySelector("#musicApp")).toBeNull();

    plugin.uninstall?.();
  });

  it("未配置 target 时非全屏不挂载任何面板", async () => {
    const plugin = MusicPlugin({
      musicId: mockMusicDetail.music_id,
      data: { detail: mockMusicDetail },
    });
    plugin.install?.(asPlayer(fake));
    expect(document.querySelector("#musicApp")).toBeNull();
    // 全屏时仍可显示
    fake.fullscreen = true;
    fake.state.emit("player.isFullscreen", true);
    expect(fake.el.querySelector("#musicApp")).not.toBeNull();
    plugin.uninstall?.();
  });
});

describe("Top 音乐模式依赖音乐插件", () => {
  /** 构造 Top 插件宿主 */
  function createTopHost(withMusicPlugin: boolean): {
    registerTopPluginMount: (mountFn: unknown) => void;
    unregisterTopPluginMount: (mountFn?: unknown) => void;
    refreshTop: () => void;
    hasPlugin: (name: string) => boolean;
  } {
    let registered: unknown = null;
    return {
      registerTopPluginMount(mountFn: unknown): void {
        registered = mountFn;
      },
      unregisterTopPluginMount(): void {
        registered = null;
      },
      refreshTop(): void {
        // noop
      },
      hasPlugin(name: string): boolean {
        return withMusicPlugin && name === "music";
      },
      getMount(): unknown {
        return registered;
      },
    };
  }

  it("安装音乐插件后 Top 渲染音乐形态", () => {
    const host = createTopHost(true);
    const plugin = TopPlugin({ data: { music: true, musicTitle: "发现《晚风信笺》" } });
    plugin.install?.(host as unknown as VideoPlayer);
    const registered = (
      host as unknown as { getMount(): (c: HTMLElement, ctx: unknown) => void }
    ).getMount();
    const container = document.createElement("div");
    container.className = "nova-player-top-wrap";
    document.body.appendChild(container);
    registered(container, { props: { music: true } });
    expect(container.querySelector(".nova-player-music")).not.toBeNull();
    expect(
      container.querySelector(".nova-player-music-marquee-content")?.textContent,
    ).toBe("发现《晚风信笺》");
    plugin.uninstall?.();
  });

  it("未安装音乐插件时 Top 回落普通形态", () => {
    const host = createTopHost(false);
    const plugin = TopPlugin({ data: { music: true, musicTitle: "发现《晚风信笺》" } });
    plugin.install?.(host as unknown as VideoPlayer);
    const registered = (
      host as unknown as { getMount(): (c: HTMLElement, ctx: unknown) => void }
    ).getMount();
    const container = document.createElement("div");
    container.className = "nova-player-top-wrap";
    document.body.appendChild(container);
    registered(container, { props: { music: true } });
    expect(container.querySelector(".nova-player-music")).toBeNull();
    plugin.uninstall?.();
  });
});
