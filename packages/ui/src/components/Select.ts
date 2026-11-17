/**
 * ============================================
 * Select 下拉选择（nano-ui: bui-select → lui-select）
 * ============================================
 */

import { h, defineComponent, signal, onEffect, useTemplateRef } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass, type UiOption } from "../shared";
import { ChevronDownIcon } from "../icons";

export interface SelectProps {
  /** 初始值 */
  value?: string | number;
  /** 选项 */
  items?: UiOption[];
  /** 结果文本（不传则取当前项 name） */
  result?: string;
  /** 列表最大高度 */
  maxHeight?: number;
  /** 清晰度菜单皮肤 */
  qualityMenu?: boolean;
  /** 清晰度菜单底部间距 */
  bridgeHeight?: number;
  /** hover 展开 */
  hoverEvents?: boolean;
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 变化回调 */
  onChange?: (value: string | number) => void;
}

export interface SelectApi {
  setValue: (value: string | number) => void;
  getValue: () => string | number | undefined;
  fold: () => void;
  unfold: () => void;
}

export const Select = defineComponent<SelectProps>(
  (props: SelectProps, lifecycle: ComponentLifecycle) => {
    const items = props.items ?? [];
    const current = signal<string | number | undefined>(props.value ?? items[0]?.value);
    const open = signal<boolean>(false);
    /** 列表容器 / 列表（模板字符串 ref，与播放器组件写法一致） */
    const listWrapRef = useTemplateRef<HTMLElement>(lifecycle, "listWrapRef");
    const listRef = useTemplateRef<HTMLElement>(lifecycle, "listRef");

    const getItem = (): UiOption | undefined =>
      items.find((item) => item.value === current.value) ?? items[0];

    /** 把列表高度同步到 DOM（nano-ui 的展开/收起靠 list 高度过渡） */
    const syncListHeight = (): void => {
      const wrap = listWrapRef.value;
      const list = listRef.value;
      if (!wrap || !list) return;
      if (open.value) {
        list.style.height = "auto";
        wrap.style.height = `${list.scrollHeight}px`;
      } else {
        wrap.style.height = "0px";
        list.style.height = "0px";
      }
    };

    /** 以 onEffect 跟随 open 信号更新 DOM（框架响应式写法，不再手写 setTimeout） */
    onEffect(lifecycle, (): void => {
      void open.value;
      syncListHeight();
    });

    const setOpen = (next: boolean): void => {
      if (props.disabled) return;
      open.value = next;
    };

    const setValue = (value: string | number): void => {
      if (props.disabled) return;
      current.value = value;
      setOpen(false);
      props.onChange?.(value);
    };

    const unfold = (): void => setOpen(true);
    const fold = (): void => setOpen(false);

    lifecycle.onMounted = (): void => {
      syncListHeight();
      lifecycle.emit?.("selectMounted", {
        setValue,
        getValue: () => current.value,
        fold,
        unfold,
      } satisfies SelectApi);
    };

    const areaClass = [
      "lui-area",
      {
        "lui-select-quality-menu": Boolean(props.qualityMenu),
        "lui-select-bscroll": Boolean(props.maxHeight),
      },
    ];

    return h(
      "div",
      {
        class: [
          ...rootClass("select", props),
          { "lui-select-unfold": open.value },
        ],
        onMouseEnter: props.hoverEvents ? unfold : undefined,
        onMouseLeave: props.hoverEvents ? fold : undefined,
      },
      h(
        "div",
        { class: areaClass },
        h(
          "div",
          { class: "lui-select-wrap" },
          h(
            "div",
            { class: "lui-select-border" },
            h(
              "div",
              {
                class: "lui-select-header",
                onClick: () => (open.value ? fold() : unfold()),
              },
              h("span", { class: "lui-select-result" }, () => props.result ?? getItem()?.name ?? ""),
              h(
                "span",
                { class: "lui-select-arrow" },
                h("span", { class: "lui-select-arrow-down" }, ChevronDownIcon()),
              ),
            ),
            h(
              "div",
              {
                class: "lui-select-list-wrap",
                style: props.maxHeight ? { maxHeight: `${props.maxHeight}px` } : undefined,
                ref: "listWrapRef",
              },
              h(
                "ul",
                {
                  class: "lui-select-list",
                  style: props.qualityMenu
                    ? { bottom: `${21 + (props.bridgeHeight ?? 0)}px` }
                    : undefined,
                  ref: "listRef",
                },
                ...items.map((item) =>
                  h(
                    "li",
                    {
                      class: [
                        "lui-select-item",
                        {
                          "lui-select-item-disabled": Boolean(item.disabled),
                          "lui-select-item-active": item.value === current.value,
                        },
                        item.className ?? "",
                      ],
                      "data-value": item.value,
                      onClick: () => {
                        if (!item.disabled) setValue(item.value);
                      },
                    },
                    item.name,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  },
);

export default Select;
