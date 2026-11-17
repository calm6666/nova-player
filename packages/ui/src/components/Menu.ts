/**
 * ============================================
 * Menu 菜单列表（nano-ui: bui-menu → lui-menu）
 * ============================================
 */

import { h, defineComponent } from "@lumina/framework/core";
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rootClass } from "../shared";

export interface MenuItem {
  name: string;
  /** 点击回调 */
  onClick?: () => void;
  /** 跳转链接 */
  link?: string;
}

export interface MenuProps {
  /** 菜单项 */
  items?: MenuItem[];
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
}

export const Menu = defineComponent<MenuProps>(
  (props: MenuProps, lifecycle: ComponentLifecycle) => {
    const items = props.items ?? [];
    const handleClick = (item: MenuItem): void => {
      item.onClick?.();
      if (item.link && typeof window !== "undefined") window.open(item.link);
    };
    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("menuMounted", {});
    };
    return h(
      "div",
      { class: rootClass("menu", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "ul",
          { class: "lui-menu-items" },
          ...items.map((item, index) =>
            h(
              "li",
              {
                class: "lui-menu-item",
                "data-index": index,
                onClick: () => handleClick(item),
              },
              item.name,
            ),
          ),
        ),
      ),
    );
  },
);

export default Menu;
