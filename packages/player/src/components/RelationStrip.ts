/**
 * ============================================
 * 外链播放器底部相关推荐条 (RelationStrip)
 * ============================================
 * 对应 B 站 external player 的 bpx-player-relation-wrap：
 * 卡片始终显示，按容器宽度动态增删；进入按钮跟随控制栏 / Top 显隐。
 */

import { h, defineComponent, t, signal, For } from "@/core";
import type { EndingRelatedItem } from "@/types";
import type { VNode } from "@/types";

export interface RelationStripProps {
  /** 相关推荐列表 */
  related?: EndingRelatedItem[];
  /** 点击推荐卡片回调 */
  onSelect?: (item: EndingRelatedItem) => void;
}

/** 秒数格式化为 mm:ss */
const formatDuration = (value?: number | string): string => {
  if (value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value) || value < 0) return "";
  const total = Math.floor(value);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/** 渲染单张推荐卡片 */
const renderItem = (
  item: EndingRelatedItem,
  onSelect?: (item: EndingRelatedItem) => void,
): VNode => {
  const content: VNode[] = [
    h(
      "div",
      { class: "nova-player-relation-context-poster" },
      item.pic
        ? h("img", {
            class: "nova-player-relation-context-poster-img",
            src: item.pic,
            alt: item.title,
          })
        : null,
      formatDuration(item.duration)
        ? h(
            "div",
            { class: "nova-player-relation-context-poster-duration" },
            formatDuration(item.duration),
          )
        : null,
    ),
    h("div", { class: "nova-player-relation-context-title" }, item.title),
  ];

  return h(
    "div",
    {
      class: "nova-player-relation-context-item",
      role: "button",
      onClick: () => onSelect?.(item),
    },
    ...content,
  );
};

export const RelationStrip = defineComponent<RelationStripProps>(
  (props, lifecycle) => {
    const all = props.related ?? [];
    if (all.length === 0) {
      return h("div", {
        class: "nova-player-relation-wrap",
        style: { display: "none" },
      });
    }

    /** 按容器宽度动态计算卡片数量（最多 6 张） */
    const visibleItems = signal<EndingRelatedItem[]>(all.slice(0, 6));
    let wrapEl: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const updateCount = (): void => {
      const width =
        wrapEl?.parentElement?.clientWidth ?? wrapEl?.clientWidth ?? 0;
      if (width <= 0) return;
      // 真实外链暂停页阈值：6 / 5 / 4 / 0
      const count =
        width >= 1140 ? 6 : width >= 930 ? 5 : width >= 720 ? 4 : 0;
      visibleItems.value = all.slice(0, count);
      wrapEl?.classList.toggle("is-relation-empty", count === 0);
      wrapEl?.classList.toggle("is-relation-tiny", width < 440);
    };

    lifecycle.onMounted = (): void => {
      updateCount();
      const target = wrapEl?.parentElement ?? wrapEl;
      if (target && typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => updateCount());
        resizeObserver.observe(target);
      }
    };

    lifecycle.onBeforeDestroy = (): void => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    };

    return h(
      "div",
      {
        class: "nova-player-relation-wrap",
        ref: (el: Element) => {
          wrapEl = el instanceof HTMLElement ? el : null;
        },
      },
      h(
        "div",
        { class: "nova-player-relation-button" },
        t("player.ui.embed.enter_quality"),
        h(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            viewBox: "0 0 16 16",
            "data-pointer": "none",
          },
          h("path", {
            d: "m9.188 7.999-3.359 3.359a.75.75 0 1 0 1.061 1.061l3.889-3.889a.75.75 0 0 0 0-1.061L6.89 3.58a.75.75 0 1 0-1.061 1.061l3.359 3.358z",
          }),
        ),
      ),
      h(
        "div",
        { class: "nova-player-relation-context" },
        h(For, {
          each: (): EndingRelatedItem[] => visibleItems.value,
          key: (item: EndingRelatedItem, index: number): string =>
            `${index}:${item.title}`,
          render: (item: EndingRelatedItem): VNode =>
            renderItem(item, props.onSelect),
        }),
      ),
    );
  },
);
