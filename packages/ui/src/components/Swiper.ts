/**
 * ============================================
 * Swiper 横向卡片轮播（nano-ui: bui-swiper）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass } from "../shared";
import { EnterIcon } from "../icons";

export interface SwiperItem {
  edgeId: string | number;
  cover: string;
  title: string;
}

export interface SwiperProps {
  /** 卡片列表 */
  list?: SwiperItem[];
  /** 当前 index */
  value?: number;
  /** 卡片高度 */
  height?: number;
  /** 卡片宽度 */
  width?: number;
  /** 卡片间距 */
  margin?: string;
  /** 边框 */
  border?: boolean;
  /** 深色 */
  dark?: boolean;
  /** 点击卡片 */
  onClickItem?: (item: SwiperItem, index: number) => void;
  /** 切换回调 */
  onChange?: (index: number) => void;
}

export interface SwiperApi {
  prev: () => void;
  next: () => void;
  goTo: (index: number) => void;
}

export const Swiper = defineComponent<SwiperProps>(
  (props: SwiperProps, lifecycle: ComponentLifecycle) => {
    const list = props.list ?? [];
    const current = signal<number>(props.value ?? 0);
    const width = props.width ?? 117;
    const height = props.height ?? 89;

    const goTo = (index: number): void => {
      const next = Math.max(0, Math.min(list.length - 1, index));
      current.value = next;
      props.onChange?.(next);
    };
    const prev = (): void => goTo(current.value - 1);
    const next = (): void => goTo(current.value + 1);

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("swiperMounted", { prev, next, goTo } satisfies SwiperApi);
    };

    return h(
      "div",
      { class: rootClass("swiper", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          {
            class: [
              "lui-swiper-wrap",
              {
                "lui-swiper-has-pre": current.value > 0,
                "lui-swiper-has-next": current.value < list.length - 1,
              },
            ],
            style: { height: `${height}px` },
          },
          list.length
            ? h("div", { class: "lui-swiper-pre", onClick: prev }, EnterIcon())
            : null,
          h(
            "div",
            { class: "lui-swiper-overhide" },
            h(
              "div",
              {
                class: ["lui-swiper-list", { "lui-swiper-border": props.border !== false }],
                style: {
                  transform: `translateX(${-current.value * (width + 12)}px)`,
                },
              },
              ...list.map((item, index) =>
                h(
                  "div",
                  {
                    class: [
                      "lui-swiper-item",
                      { "lui-swiper-item-active": index === current.value },
                    ],
                    style: {
                      width: `${width}px`,
                      height: `${height}px`,
                      margin: props.margin ?? "0 0 0 25px",
                    },
                    onClick: () => props.onClickItem?.(item, index),
                  },
                  h("div", { class: "lui-swiper-img" }, h("img", { src: item.cover, alt: item.title })),
                  h("div", { class: "lui-swiper-text" }, item.title),
                ),
              ),
            ),
          ),
          list.length
            ? h("div", { class: "lui-swiper-next", onClick: next }, EnterIcon())
            : null,
        ),
      ),
    );
  },
);

export default Swiper;
