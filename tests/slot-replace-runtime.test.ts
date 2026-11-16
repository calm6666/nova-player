// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  h,
  signal,
  defineComponent,
  VideoPlayer,
} from "@lumina/nova";
import type { SlotContext } from "@lumina/nova";

// jsdom 不实现浏览器观察器；播放器挂载会注册它们
class TestObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}
(globalThis as unknown as { ResizeObserver: typeof TestObserver }).ResizeObserver =
  TestObserver;
(globalThis as unknown as {
  IntersectionObserver: typeof TestObserver;
}).IntersectionObserver = TestObserver;

/** 与 app 的 WatchlaterPlayer 能力子集对齐（只用于插槽内容） */
interface PlayerLike {
  on?(event: string, handler: (...args: unknown[]) => void): () => void;
  state?: { get?(key: string): unknown };
  isPlaying?(): boolean;
  getVolume?(): number;
  setMuted?(muted: boolean): void;
  setVolume?(volume: number): void;
}

/**
 * 编译语义下的音量插槽内容（双图标 + 类名切换）：
 * 与 apps/web 的 VolumeIconTile 同构，验证「replace 插槽 + 信号 + class 洞」链路。
 */
const VolumeTile = defineComponent<{ player: PlayerLike | null }>(
  (props, lifecycle) => {
    const muted = signal(false);
    const volume = signal(1);
    lifecycle.onMounted = (): void => {
      muted.value = Boolean(props.player?.state?.get?.("player.muted"));
      volume.value = Number(props.player?.getVolume?.() ?? 1);
      const off = props.player?.on?.(
        "volumechange",
        (nextVolume: unknown, nextMuted: unknown) => {
          volume.value = Number(nextVolume ?? 1);
          muted.value = Boolean(nextMuted);
        },
      );
      lifecycle.onBeforeDestroy = (): void => off?.();
    };
    const isMutedView = (): boolean => muted.value || volume.value === 0;
    return h(
      "div",
      {
        class: ["nova-player-ctrl-btn-icon", isMutedView() ? "vol-muted" : ""],
      },
      h("span", { class: "icon-on", "data-name": "volume" }, "on"),
      h("span", { class: "icon-off", "data-name": "volume" }, "off"),
    );
  },
);

/** 与 MiniPlayTile 同构：暂停态 root 追加类名 */
const MiniPlayingTile = defineComponent<{ player: PlayerLike | null }>(
  (props, lifecycle) => {
    const playing = signal(false);
    lifecycle.onMounted = (): void => {
      playing.value = Boolean(props.player?.isPlaying?.());
      const off = props.player?.on?.("statechange", (state: unknown) => {
        if (state === "playing") playing.value = true;
        else if (state === "paused" || state === "ended") playing.value = false;
      });
      lifecycle.onBeforeDestroy = (): void => off?.();
    };
    return h(
      "div",
      {
        class: ["nova-player-ctrl-btn", playing.value ? "" : "miniPaused"],
      },
      h("div", { class: "nova-player-ctrl-btn-icon" }, "icon"),
    );
  },
);

describe("replace 插槽运行时（player dist 级联）", () => {
  it("音量插槽：双图标默认渲染、点击冒泡静音、类名随 volumechange 切换", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const player = new VideoPlayer({
      src: "https://example.com/video.mp4",
      playback: { autoplay: false, muted: false, volume: 0.5 },
      ui: {
        slots: [
          {
            id: "wl-volume",
            slot: "controls.right.start",
            replace: "volume",
            replacePanel: "native",
            content: (ctx: SlotContext) =>
              h(VolumeTile, { player: ctx.player as unknown as PlayerLike }),
          },
        ],
      },
    });
    player.mount(host);

    const volumeBtn = host.querySelector<HTMLElement>(
      ".nova-player-ctrl-volume",
    );
    expect(volumeBtn).not.toBeNull();
    const icon = volumeBtn?.querySelector<HTMLElement>(
      ".nova-player-ctrl-btn-icon",
    );
    expect(icon).not.toBeNull();
    // 两个图标常驻（有声 / 静音），默认显示有声态
    expect(icon?.querySelectorAll("span").length).toBe(2);
    expect(icon?.className).not.toContain("vol-muted");

    icon?.click();
    // 点击应冒泡到播放器音量按钮根节点（原生按钮壳），触发静音
    expect(player.state?.get?.("player.muted")).toBe(true);
    // 类名由 volumechange 信号驱动更新（不是重建 DOM）
    expect(icon?.className).toContain("vol-muted");

    player.destroy();
    host.remove();
  });

  it("mini 播放插槽：class 洞随播放器状态变化（暂停类移除）", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const player = new VideoPlayer({
      src: "https://example.com/video.mp4",
      playback: { autoplay: false, muted: true },
      ui: {
        slots: [
          {
            id: "wl-mini",
            slot: "video.overlay",
            content: (ctx: SlotContext) =>
              h(MiniPlayingTile, {
                player: ctx.player as unknown as PlayerLike,
              }),
          },
        ],
      },
    });
    player.mount(host);

    const mini = host.querySelector<HTMLElement>(".miniPaused");
    expect(mini).not.toBeNull();
    // jsdom 无真实媒体，play() 可能 reject；只要触发状态即可
    await player.play().catch(() => undefined);
    expect(mini?.className ?? "").not.toContain("miniPaused");

    player.destroy();
    host.remove();
  });
});
