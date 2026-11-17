/**
 * ============================================
 * LongList 长列表（nano-ui: bui-long-list）
 * ============================================
 */

import { h, defineComponent, For, useTemplateRef } from "@lumina/framework/core";
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";
import { rootClass } from "../shared";

export interface LongListProps {
  /** 可视高度 */
  listHeight?: number;
  /** 单行高度 */
  itemHeight?: number;
  /** 总条数 */
  count?: number;
  /** 行渲染 */
  renderItem?: (index: number) => VNode | string;
  /** 深色 */
  dark?: boolean;
}

export interface LongListApi {
  scrollTo: (index: number) => void;
}

export const LongList = defineComponent<LongListProps>(
  (props: LongListProps, lifecycle: ComponentLifecycle) => {
    const itemHeight = props.itemHeight ?? 20;
    const count = props.count ?? 0;
    const listHeight = props.listHeight ?? 300;
    const wrapRef = useTemplateRef<HTMLDivElement>(lifecycle, "wrapRef");
    let wrap: HTMLDivElement | null = null;

    const scrollTo = (index: number): void => {
      const el = wrap ?? wrapRef.value;
      if (el) el.scrollTop = index * itemHeight;
    };

    lifecycle.onMounted = (): void => {
      wrap = wrapRef.value;
      lifecycle.emit?.("longListMounted", { scrollTo } satisfies LongListApi);
    };

    return h(
      "div",
      { class: rootClass("long-list", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          {
            class: "lui-long-list-wrap",
            style: { height: `${listHeight}px`, overflowY: "auto" },
            ref: "wrapRef",
          },
          h(
            "ul",
            {
              class: "lui-long-list-list",
              style: { height: `${itemHeight * count}px` },
            },
            h(For, {
              each: (): number[] => Array.from({ length: count }, (_, index) => index),
              key: (index: unknown): string => String(index),
              render: (index: unknown): VNode =>
                h(
                  "li",
                  {
                    class: "lui-long-list-item",
                    "data-index": index as number,
                    style: { height: `${itemHeight}px` },
                  },
                  props.renderItem?.(index as number) ?? "",
                ),
            }),
          ),
        ),
      ),
    );
  },
);

export default LongList;
