import { describe, expect, it } from "vitest";
import {
  formatDanmakuCount,
  formatOnlineCount,
} from "@/nova/utils/formatCount";

/**
 * 发送栏计数展示格式回归测试（参考 B 站数量级策略）
 *
 * - 在线人数：< 1 万原样；万级 / 亿级保留一位小数（向下截断）
 * - 弹幕条数：< 1000 原样；1000–9999 显示「1000+」；
 *   万级 / 亿级保留一位小数并封顶加「+」
 */

describe("formatOnlineCount（在线观看人数）", () => {
  it("小于 1 万原样输出", () => {
    expect(formatOnlineCount(0)).toBe("0");
    expect(formatOnlineCount(999)).toBe("999");
    expect(formatOnlineCount(9999)).toBe("9999");
  });

  it("万级保留一位小数（向下截断）", () => {
    expect(formatOnlineCount(10000)).toBe("1万");
    expect(formatOnlineCount(12345)).toBe("1.2万");
    expect(formatOnlineCount(99999)).toBe("9.9万");
    expect(formatOnlineCount(100000)).toBe("10万");
    expect(formatOnlineCount(123456)).toBe("12.3万");
  });

  it("亿级使用亿单位", () => {
    expect(formatOnlineCount(100000000)).toBe("1亿");
    expect(formatOnlineCount(123456789)).toBe("1.2亿");
  });
});

describe("formatDanmakuCount（弹幕条数）", () => {
  it("小于 1000 原样输出", () => {
    expect(formatDanmakuCount(0)).toBe("0");
    expect(formatDanmakuCount(999)).toBe("999");
  });

  it("1000–9999 显示 1000+", () => {
    expect(formatDanmakuCount(1000)).toBe("1000+");
    expect(formatDanmakuCount(9999)).toBe("1000+");
  });

  it("万级保留一位小数并加号", () => {
    expect(formatDanmakuCount(10000)).toBe("1万+");
    expect(formatDanmakuCount(12345)).toBe("1.2万+");
    expect(formatDanmakuCount(99999)).toBe("9.9万+");
    expect(formatDanmakuCount(100000)).toBe("10万+");
    expect(formatDanmakuCount(123456)).toBe("12.3万+");
  });

  it("亿级保留一位小数并加号", () => {
    expect(formatDanmakuCount(100000000)).toBe("1亿+");
    expect(formatDanmakuCount(123456789)).toBe("1.2亿+");
  });

  it("异常输入归一化为 0", () => {
    expect(formatDanmakuCount(-1)).toBe("0");
    expect(formatDanmakuCount(Number.NaN)).toBe("0");
  });
});
