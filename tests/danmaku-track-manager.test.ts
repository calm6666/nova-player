import { describe, expect, it } from "vitest";
import { TrackManager } from "@/lumina/plugins/utils/danmaku/trackManager";
import {
  DanmakuArea,
  DanmakuType,
  type DanmakuRenderItem,
} from "@/lumina/plugins/utils/danmaku/types";

/**
 * 轨道分配回归测试
 *
 * 核心约束：轨道占用必须按「弹幕动画的真实进度」判断，而不是
 * `performance.now() - createTime` 的墙钟差值。暂停 / 冻结时动画停住、
 * 墙钟继续走，若用墙钟会把暂停时长算成已滚动距离，轨道被提前判空，
 * 新弹幕（尤其本地即时发送）叠进同一轨道、同一位置。
 */

const WIDTH = 800;
const HEIGHT = 450;

function createTrackManager(): TrackManager {
  const manager = new TrackManager({
    trackHeight: 24,
    trackGap: 4,
    topMargin: 10,
    bottomMargin: 10,
    bottomSafeArea: 80,
    safeDistance: 20,
  });
  manager.initTracks(WIDTH, HEIGHT, DanmakuArea.FULL);
  return manager;
}

let renderIdSeed = 0;

function createItem(
  overrides: Partial<DanmakuRenderItem> = {},
): DanmakuRenderItem {
  renderIdSeed += 1;
  return {
    id: renderIdSeed,
    text: "测试弹幕",
    time: 0,
    type: DanmakuType.SCROLL,
    renderId: `dm_test_${renderIdSeed}`,
    x: WIDTH,
    y: 0,
    width: 100,
    height: 24,
    speed: 0.15,
    trackIndex: -1,
    isRendering: true,
    createTime: 1000,
    duration: 6000,
    ...overrides,
  };
}

describe("TrackManager 轨道占用时间源", () => {
  it("动画进度冻结（暂停）时，墙钟越过整段时长也不复用该轨道", () => {
    const manager = createTrackManager();

    const first = createItem();
    const firstTrack = manager.getAvailableTrack(first, 1000);
    expect(firstTrack).toBe(0);
    manager.addToTrack(firstTrack, first);

    // 暂停：动画 currentTime 冻结在 0，但墙钟已经过去 60s
    first.getElapsedTime = (): number => 0;

    const second = createItem();
    const secondTrack = manager.getAvailableTrack(second, 1000 + 60_000);

    expect(secondTrack).not.toBe(firstTrack);
    expect(secondTrack).toBe(1);
  });

  it("固定弹幕暂停期间保持轨道占用，后续弹幕不得同轨叠加", () => {
    const manager = createTrackManager();

    const first = createItem({ type: DanmakuType.TOP, duration: 4000 });
    const firstTrack = manager.getAvailableTrack(first, 1000);
    expect(firstTrack).toBe(0);
    manager.addToTrack(firstTrack, first);

    first.getElapsedTime = (): number => 0;

    const second = createItem({ type: DanmakuType.TOP, duration: 4000 });
    const secondTrack = manager.getAvailableTrack(second, 1000 + 60_000);

    expect(secondTrack).not.toBe(firstTrack);
  });

  it("没有动画进度读取器（Canvas 引擎）时回退墙钟差值", () => {
    const manager = createTrackManager();

    const first = createItem();
    const firstTrack = manager.getAvailableTrack(first, 1000);
    expect(firstTrack).toBe(0);
    manager.addToTrack(firstTrack, first);

    // Canvas 引擎不提供 getElapsedTime：位置本身由 createTime 墙钟驱动，
    // 墙钟越过后该轨道应可复用（保持原有 Canvas 语义）
    const second = createItem();
    expect(manager.getAvailableTrack(second, 1000 + 60_000)).toBe(
      firstTrack,
    );
  });
});
