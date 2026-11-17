/**
 * ============================================
 * Panel 横向分页面板（nano-ui: bui-panel → lui-panel）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass } from "../shared";

export interface PanelPage {
  width: number;
  height: number;
}

export interface PanelProps {
  /** 页面尺寸列表 */
  pages?: PanelPage[];
  /** 当前页 */
  value?: number;
  /** move 总宽度 */
  totalWidth?: number;
  /** 深色 */
  dark?: boolean;
  /** 页切换回调 */
  onChange?: (index: number) => void;
}

export interface PanelApi {
  setValue: (index: number) => void;
  getValue: () => number;
}

export const Panel = defineComponent<PanelProps>(
  (props: PanelProps, lifecycle: ComponentLifecycle) => {
    const pages = props.pages ?? [];
    const current = signal<number>(props.value ?? 0);

    const offset = (): number =>
      pages.slice(0, current.value).reduce((sum, page) => sum + page.width, 0);

    const totalWidth = (): number =>
      props.totalWidth ?? pages.reduce((sum, page) => sum + page.width, 0);

    const setValue = (index: number): void => {
      current.value = Math.max(0, Math.min(pages.length - 1, index));
      props.onChange?.(current.value);
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("panelMounted", { setValue, getValue: () => current.value } satisfies PanelApi);
    };

    const activePage = pages[current.value] ?? { width: 0, height: 0 };

    return h(
      "div",
      { class: rootClass("panel", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          {
            class: "lui-panel-wrap",
            style: {
              width: `${activePage.width}px`,
              height: `${activePage.height}px`,
            },
          },
          h(
            "div",
            {
              class: "lui-panel-move",
              style: {
                width: `${totalWidth()}px`,
                transform: `translateX(${-offset()}px)`,
              },
            },
            ...pages.map((page, index) =>
              h("div", {
                class: ["lui-panel-item", { "lui-panel-item-active": index === current.value }],
                style: { width: `${page.width}px`, height: `${page.height}px` },
              }),
            ),
          ),
        ),
      ),
    );
  },
);

export default Panel;
