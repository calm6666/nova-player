/**
 * ============================================
 * Dropdown 下拉菜单（nano-ui: bui-dropdown）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass } from "../shared";
import { ChevronDownIcon } from "../icons";

export interface DropdownItem {
  value: string | number;
  name: string;
  disabled?: boolean;
}

export interface DropdownProps {
  /** 选项 */
  items?: DropdownItem[];
  /** 初始值 */
  value?: string | number;
  /** 禁用 */
  disabled?: boolean;
  /** 深色 */
  dark?: boolean;
  /** 变化回调 */
  onChange?: (value: string | number) => void;
}

export interface DropdownApi {
  setValue: (value: string | number) => void;
  getValue: () => string | number | undefined;
  toggle: () => void;
}

export const Dropdown = defineComponent<DropdownProps>(
  (props: DropdownProps, lifecycle: ComponentLifecycle) => {
    const items = props.items ?? [];
    const current = signal<string | number | undefined>(props.value ?? items[0]?.value);
    const open = signal<boolean>(false);

    const active = (): DropdownItem | undefined =>
      items.find((item) => item.value === current.value) ?? items[0];

    const setValue = (value: string | number): void => {
      if (props.disabled) return;
      current.value = value;
      open.value = false;
      props.onChange?.(value);
    };

    const toggle = (): void => {
      if (!props.disabled) open.value = !open.value;
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("dropdownMounted", {
        setValue,
        getValue: () => current.value,
        toggle,
      } satisfies DropdownApi);
    };

    return h(
      "div",
      {
        class: [
          ...rootClass("dropdown", props),
          {
            "lui-no-event": Boolean(props.disabled),
            "lui-dropdown-unfold": open.value,
          },
        ],
      },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          { class: "lui-dropdown-wrap" },
          h(
            "div",
            { class: "lui-dropdown-display", onClick: toggle },
            h("span", { class: "lui-dropdown-name" }, () => active()?.name ?? ""),
            h("span", { class: "lui-dropdown-icon" }, ChevronDownIcon()),
          ),
          h(
            "div",
            {
              class: "lui-dropdown-items",
              style: { display: open.value ? "block" : "none" },
            },
            ...items.map((item) =>
              h(
                "div",
                {
                  class: ["lui-dropdown-item", { "lui-disabled": Boolean(item.disabled) }],
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
    );
  },
);

export default Dropdown;
