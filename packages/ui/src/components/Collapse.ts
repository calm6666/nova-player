/**
 * ============================================
 * Collapse 折叠面板（nano-ui: bui-collapse）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";
import { rootClass } from "../shared";

export interface CollapseProps {
  /** 初始展开 */
  value?: boolean;
  /** 收起文案 */
  foldText?: string;
  /** 展开文案 */
  unfoldText?: string;
  /** 是否可折叠 */
  canCollapse?: boolean;
  /** 头部额外内容 */
  header?: VNode;
  /** 面板内容 */
  body?: VNode;
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 变化回调 */
  onChange?: (value: boolean) => void;
}

export interface CollapseApi {
  unfold: () => void;
  fold: () => void;
  toggle: () => void;
  getValue: () => boolean;
}

export const Collapse = defineComponent<CollapseProps>(
  (props: CollapseProps, lifecycle: ComponentLifecycle) => {
    const open = signal<boolean>(Boolean(props.value));
    const canCollapse = props.canCollapse !== false;

    const setOpen = (next: boolean): void => {
      if (!canCollapse) return;
      open.value = next;
      props.onChange?.(next);
    };

    const unfold = (): void => setOpen(true);
    const fold = (): void => setOpen(false);
    const toggle = (): void => setOpen(!open.value);

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("collapseMounted", {
        unfold,
        fold,
        toggle,
        getValue: () => open.value,
      } satisfies CollapseApi);
    };

    return h(
      "div",
      { class: rootClass("collapse", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          {
            class: [
              "lui-collapse-wrap",
              { "lui-collapse-wrap-folded": !open.value },
            ],
          },
          h(
            "div",
            { class: "lui-collapse-header", onClick: canCollapse ? toggle : undefined },
            h(
              "div",
              { class: "lui-collapse-arrow" },
              h(
                "span",
                { class: "lui-collapse-arrow-text" },
                () => open.value ? (props.unfoldText ?? "") : (props.foldText ?? ""),
              ),
            ),
            props.header ?? null,
          ),
          h(
            "div",
            {
              class: "lui-collapse-body",
              style: open.value ? undefined : { height: "0px" },
            },
            props.body ?? null,
          ),
        ),
      ),
    );
  },
);

export default Collapse;
