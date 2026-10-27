/**
 * ============================================
 * DanmakuList 视图挂载 / 更新 / 卸载验证
 * ============================================
 * 使用 vitest（jsdom 环境，happy-dom 等价方式）验证弹幕列表组件的核心路径：
 * - mount：根节点 / 列表行 / i18n 文案正确渲染；
 * - update：setList 写入 signal 后列表精准更新；
 * - unmount：dispose 销毁后容器恢复为空；
 * - 交互：行点击回调、动态文案（屏蔽态 / 历史日期 / 屏蔽词 / 字体）更新。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initI18n } from "@/core";
import zhCN from "../locales/zh-CN.json";
import { mountDanmakuListView } from "@/lumina/plugins/danmaku/DanmakuList/DanmakuList";
import type { DanmakuListViewHandle } from "@/lumina/plugins/danmaku/DanmakuList/DanmakuList";
import { DanmakuType } from "@/types/danmaku";
import type { DanmakuItem } from "@/types/danmaku";

// i18n 启用中文，用于断言文案 key 均已补齐
initI18n({ enabled: true, locale: "zh-CN", messages: { "zh-CN": zhCN } });

/** 初始弹幕数据 */
const BASE_LIST: DanmakuItem[] = [
  { id: "dm-a", text: "爱丽丝！", time: 6, type: DanmakuType.SCROLL },
  { id: "dm-b", text: "白嫖成功", time: 11, type: DanmakuType.SCROLL },
  { id: "dm-c", text: "荧妹", time: 875, type: DanmakuType.SCROLL },
];

/** 更新后的弹幕数据（一条保留、一条新增、一条删除） */
const NEXT_LIST: DanmakuItem[] = [
  { id: "dm-b", text: "白嫖成功", time: 11, type: DanmakuType.SCROLL },
  { id: "dm-d", text: "新弹幕", time: 42, type: DanmakuType.SCROLL },
];

describe("DanmakuList 视图", () => {
  /** 挂载容器 */
  let container: HTMLElement;
  /** 视图句柄 */
  let handle: DanmakuListViewHandle | null;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "danmaku-list";
    document.body.appendChild(container);
    handle = null;
  });

  afterEach(() => {
    handle?.dispose();
    handle = null;
    container.remove();
  });

  it("mount：渲染根节点 / 列表行 / i18n 文案", () => {
    handle = mountDanmakuListView(container, BASE_LIST);

    // 组件根：不额外包 DOM，容器内唯一根为 .nova-docker.nova-docker-minor
    const root = container.querySelector(".nova-docker.nova-docker-minor");
    expect(root).not.toBeNull();
    expect(container.children.length).toBe(1);

    // 列表行：3 条弹幕 + 时间格式化
    const rows = container.querySelectorAll(".dm-info-row");
    expect(rows.length).toBe(3);
    expect(rows[0].querySelector(".dm-info-time")?.textContent).toBe("00:06");
    expect(rows[0].querySelector(".dm-info-dm")?.textContent).toBe("爱丽丝！");
    expect(rows[2].querySelector(".dm-info-time")?.textContent).toBe("14:35");

    // 文案经 i18n t("player.ui.danmaku.*") 输出
    expect(container.textContent).toContain("弹幕列表");
    expect(container.textContent).toContain("弹幕内容");
    expect(container.textContent).toContain("查看历史弹幕");
    // 行 data-index：列表索引（按行身份响应式更新，删除/排序后仍正确）
    const firstRow = container.querySelector(".dm-info-row");
    expect(firstRow?.getAttribute("data-index")).toBe("0");
    expect(rows[1].getAttribute("data-index")).toBe("1");
    expect(rows[2].getAttribute("data-index")).toBe("2");
    // li 与行容器、文本、操作按钮均带 data-index（与源组件 DOM 一致）
    expect(rows[0].parentElement?.getAttribute("data-index")).toBe("0");
    expect(
      rows[0].querySelector(".dm-info-dm")?.getAttribute("data-index"),
    ).toBe("0");
    // 回归：文本节点不得出现函数源码
    expect(container.innerHTML).not.toContain("=>");
  });

  it("大数据量：超过阈值启用虚拟窗口，仅渲染可视行", () => {
    const many: DanmakuItem[] = Array.from({ length: 1000 }, (_, index) => ({
      id: `dm-${index}`,
      text: `弹幕内容 ${index}`,
      time: index,
      type: DanmakuType.SCROLL,
    }));
    handle = mountDanmakuListView(container, many);

    const rows = container.querySelectorAll(".dm-info-row");
    // 只渲染窗口槽位（可视行 + overscan），不是 1000 条
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(100);
    // 虚拟容器：ul 总高度 = 条数 × 24px（真实内容高度），行绝对定位
    const list = container.querySelector(".ui-long-list-list") as HTMLElement;
    expect(list.style.height).toBe("24000px");
    expect(list.classList.contains("nova-player-long-list-virtual")).toBe(true);
    const firstRow = rows[0].parentElement as HTMLElement;
    expect(
      firstRow.style.position === "absolute" ||
        getComputedStyle(firstRow).position,
    ).toBeTruthy();
    // 首行显示第 0 条
    expect(rows[0].querySelector(".dm-info-time")?.textContent).toBe("00:00");
  });

  it("小数据量：不超过阈值时全量渲染", () => {
    const small: DanmakuItem[] = Array.from({ length: 200 }, (_, index) => ({
      id: `dm-${index}`,
      text: `弹幕内容 ${index}`,
      time: index,
      type: DanmakuType.SCROLL,
    }));
    handle = mountDanmakuListView(container, small);
    expect(container.querySelectorAll(".dm-info-row").length).toBe(200);
    expect(
      container
        .querySelector(".ui-long-list-list")
        ?.classList.contains("nova-player-long-list-virtual"),
    ).toBe(false);
  });

  it("虚拟滚动：槽位 DOM 复用，滚动只更新窗口内容与 transform", () => {
    const many: DanmakuItem[] = Array.from({ length: 1000 }, (_, index) => ({
      id: `dm-${index}`,
      text: `弹幕内容 ${index}`,
      time: index,
      type: DanmakuType.SCROLL,
    }));
    handle = mountDanmakuListView(container, many);
    const list = container.querySelector(".ui-long-list-list") as HTMLElement;
    const firstRow = container.querySelector(".dm-info-row");
    const rowCount = container.querySelectorAll(".dm-info-row").length;
    expect(firstRow).not.toBeNull();

    container.querySelector(".ui-long-list-wrap")?.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 600,
        bubbles: true,
        cancelable: true,
      }),
    );

    // 窗口槽位数量不变、首行仍是同一个 DOM 节点（不重建行）
    expect(container.querySelectorAll(".dm-info-row").length).toBe(rowCount);
    expect(container.querySelector(".dm-info-row")).toBe(firstRow);
    // 滚动只更新容器 transform（像素级）
    expect(list.style.transform).toContain("-600px");
    // 跨行后窗口内容更新：overscan=6，600/24=25 → 起始行 19
    expect(container.querySelector(".dm-info-time")?.textContent).toBe("00:19");
    // 虚拟窗口行 data-index = 全局行索引（随窗口滚动响应式更新）
    expect(
      container.querySelector(".dm-info-row")?.getAttribute("data-index"),
    ).toBe("19");
  });

  it("虚拟滚动：删除一条弹幕后槽位与其余行节点保持不变", () => {
    const many: DanmakuItem[] = Array.from({ length: 500 }, (_, index) => ({
      id: `dm-${index}`,
      text: `弹幕内容 ${index}`,
      time: index,
      type: DanmakuType.SCROLL,
    }));
    handle = mountDanmakuListView(container, many);
    const firstRow = container.querySelector(".dm-info-row");
    const nextMany = many.filter((_item, index) => index !== 100);
    handle.setList(nextMany);
    expect(container.querySelector(".dm-info-row")).toBe(firstRow);
    expect(container.querySelectorAll(".dm-info-row").length).toBeLessThan(100);
  });

  it("update：setList 后列表数据精准更新", () => {
    handle = mountDanmakuListView(container, BASE_LIST);
    expect(container.querySelectorAll(".dm-info-row").length).toBe(3);

    const beforeRows = container.querySelectorAll(".dm-info-row");
    expect(beforeRows.length).toBe(3);

    handle.setList(NEXT_LIST);

    const rows = container.querySelectorAll(".dm-info-row");
    expect(rows.length).toBe(2);
    // 删除 dm-a 后，保留的 dm-b 行仍是同一个 DOM 节点（按行身份 diff，不按索引重排）
    expect(rows[0]).toBe(beforeRows[1]);
    // 删除后索引响应式重排：原第 1 条变为第 0 条
    expect(rows[0].getAttribute("data-index")).toBe("0");
    expect(rows[1].getAttribute("data-index")).toBe("1");
    expect(rows[0].querySelector(".dm-info-dm")?.textContent).toBe("白嫖成功");
    expect(rows[1].querySelector(".dm-info-dm")?.textContent).toBe("新弹幕");
    expect(container.textContent).not.toContain("爱丽丝！");
  });

  it("unmount：dispose 后容器清空且可重复挂载", () => {
    handle = mountDanmakuListView(container, BASE_LIST);
    expect(container.querySelector(".nova-docker")).not.toBeNull();

    handle.dispose();
    handle = null;
    expect(container.querySelector(".nova-docker")).toBeNull();
    expect(container.children.length).toBe(0);

    // 重复挂载：新句柄可独立工作
    handle = mountDanmakuListView(container, NEXT_LIST);
    expect(container.querySelectorAll(".dm-info-row").length).toBe(2);
  });

  it("事件：点击弹幕行回调跳转时间", () => {
    const seeked: number[] = [];
    handle = mountDanmakuListView(container, BASE_LIST, {
      handlers: {
        onSeek: (seconds: number): void => {
          seeked.push(seconds);
        },
      },
    });

    const row = container.querySelector(".dm-info-row");
    expect(row).not.toBeNull();
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(seeked).toEqual([6]);
  });

  it("动态文本：交互后仍为真实文本而非函数源码", () => {
    /** 断言容器内无函数源码泄漏 */
    const expectCleanText = (): void => {
      expect(container.innerHTML).not.toContain("=>");
      expect(container.textContent).not.toContain("() =>");
    };

    handle = mountDanmakuListView(container, BASE_LIST, { loggedIn: true });
    expectCleanText();

    // 屏蔽用户：按钮文案切换为「取消屏蔽」
    const blockBtn = container.querySelector(".dm-info-block-btn");
    expect(blockBtn?.textContent).toBe("屏蔽用户");
    blockBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(container.querySelector(".dm-info-block-btn")?.textContent).toBe(
      "取消屏蔽",
    );
    expectCleanText();

    // 查看历史弹幕：打开日期选择器并选择可用日期 → 历史标签更新
    container
      .querySelector(".nova-player-dm-btn-history")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      container
        .querySelector(".nova-player-date-picker")
        ?.classList.contains("nova-player-show"),
    ).toBe(true);
    const enabledDay = container.querySelector(
      ".nova-player-date-picker-day.day-enable",
    );
    expect(enabledDay).not.toBeNull();
    enabledDay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      container.querySelector(".nova-player-dm-number-span")?.textContent,
    ).not.toBe("");
    expectCleanText();

    // 屏蔽词：新增后条数 / 状态文案正确，切换状态后文案更新
    const addInput = container.querySelector(
      ".nova-player-block-add-input",
    ) as HTMLInputElement | null;
    expect(addInput).not.toBeNull();
    if (addInput !== null) addInput.value = "测试词";
    addInput?.dispatchEvent(new Event("input", { bubbles: true }));
    container
      .querySelector(".nova-player-block-add-btn")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      container.querySelector(".nova-player-block-number")?.textContent,
    ).toBe("1");
    expect(
      container.querySelector(
        ".nova-player-block-list-line .nova-player-block-list-state",
      )?.textContent,
    ).toBe("开启");
    container
      .querySelector(
        ".nova-player-block-list-line .nova-player-block-list-state",
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(
      container.querySelector(
        ".nova-player-block-list-line .nova-player-block-list-state",
      )?.textContent,
    ).toBe("关闭");
    expectCleanText();

    // 高级弹幕：切换字体后展示名更新
    container
      .querySelector(
        ".nova-player-adv-danmaku-font-family-select .ui-select-header",
      )
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const fontItems = container.querySelectorAll(".ui-select-item");
    expect(fontItems.length).toBeGreaterThan(1);
    fontItems[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(container.querySelector(".ui-select-result")?.textContent).toBe(
      "宋体",
    );
    expectCleanText();
  });
});
