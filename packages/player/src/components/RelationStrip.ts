/**
 * ============================================
 * 外链播放器底部相关推荐条 (RelationStrip)
 * ============================================
 * 对应 B 站 external player 的 bpx-player-relation-wrap：
 * 播放中悬停/显示控制栏时，在底部浮出 6 张相关推荐卡片。
 * 仅在 scene=embedded 且外部提供 related 数据时渲染。
 */

import { h, defineComponent, t } from "@/core";
import type { EndingRelatedItem } from "@/types";
import type { VNode } from "@/types";

export interface RelationStripProps {
  /** 相关推荐列表（最多渲染 6 张） */
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
  (props, _lifecycle) => {
    const related = (props.related ?? []).slice(0, 6);
    if (related.length === 0) {
      return h("div", {
        class: "nova-player-relation-wrap",
        style: { display: "none" },
      });
    }

    return h(
      "div",
      { class: "nova-player-relation-wrap" },
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
        ...related.map((item) => renderItem(item, props.onSelect)),
      ),
    );
  },
);
