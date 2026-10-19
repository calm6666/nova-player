import { describe, expect, it } from "vitest";
import zhCN from "../core/locales/zh-CN.json";
import enUS from "../core/locales/en-US.json";

/**
 * 提示 / 控件文字 i18n 完整性回归测试
 *
 * 覆盖 Tooltips 默认提示项（含动态「进入/退出」态 key）、PlayerDocker
 * 动态 updateTipKey、以及本次一并国际化的按钮 aria/文字 key。
 * 任一语言缺 key 时 t() 会回退成 key 字面量，这里提前拦住。
 */
const REQUIRED_KEYS = [
  // Tooltips 静态提示
  "player.ui.tooltip.codec.default",
  "player.ui.tooltip.codec.av1",
  "player.ui.tooltip.codec.hevc",
  "player.ui.tooltip.codec.avc",
  "player.ui.tooltip.danmaku_switch.close",
  "player.ui.tooltip.danmaku_switch.open",
  "player.ui.tooltip.preventshade",
  "player.ui.tooltip.special_more",
  "player.ui.tooltip.feedback",
  "player.ui.tooltip.prev",
  "player.ui.tooltip.next",
  // 状态动态提示（进入 / 退出）
  "player.ui.tooltip.widescreen.enter",
  "player.ui.tooltip.widescreen.exit",
  "player.ui.tooltip.webscreen.enter",
  "player.ui.tooltip.webscreen.exit",
  "player.ui.tooltip.pip.enter",
  "player.ui.tooltip.pip.exit",
  "player.ui.tooltip.fullscreen.enter",
  "player.ui.tooltip.fullscreen.exit",
  // 控件按钮文字 / aria
  "player.ui.controls.prev",
  "player.ui.controls.next",
  "player.ui.controls.playPause",
  "player.ui.controls.playbackRate",
  "player.ui.controls.quality",
  "player.ui.controls.episodes",
] as const;

const LOCALES: Array<[string, Record<string, string>]> = [
  ["zh-CN", zhCN as Record<string, string>],
  ["en-US", enUS as Record<string, string>],
];

describe("提示/控件文字 i18n", () => {
  for (const [locale, messages] of LOCALES) {
    it(`${locale} 包含全部提示与控件文案 key`, () => {
      const missing = REQUIRED_KEYS.filter((key) => !messages[key]);
      expect(missing).toEqual([]);
    });

    it(`${locale} 提示文案非空`, () => {
      for (const key of REQUIRED_KEYS) {
        expect(messages[key]?.trim().length ?? 0).toBeGreaterThan(0);
      }
    });
  }

  it("宽屏进入/退出文案可区分", () => {
    for (const [, messages] of LOCALES) {
      expect(messages["player.ui.tooltip.widescreen.enter"]).not.toBe(
        messages["player.ui.tooltip.widescreen.exit"],
      );
    }
  });
});
