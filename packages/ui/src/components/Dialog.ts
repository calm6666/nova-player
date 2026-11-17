/**
 * ============================================
 * Dialog 对话框（nano-ui: bui-dialog → lui-dialog）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";
import { rootClass } from "../shared";
import { CloseIcon } from "../icons";

export interface DialogProps {
  /** 标题 */
  title?: string;
  /** 是否显示 */
  visible?: boolean;
  /** 内容 */
  body?: VNode;
  /** 深色 */
  dark?: boolean;
  /** 关闭回调 */
  onClose?: () => void;
}

export interface DialogApi {
  show: () => void;
  hide: () => void;
  getValue: () => boolean;
}

export const Dialog = defineComponent<DialogProps>(
  (props: DialogProps, lifecycle: ComponentLifecycle) => {
    const visible = signal<boolean>(props.visible !== false);

    const show = (): void => { visible.value = true; };
    const hide = (): void => { visible.value = false; };

    const handleClose = (): void => {
      hide();
      props.onClose?.();
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("dialogMounted", {
        show,
        hide,
        getValue: () => visible.value,
      } satisfies DialogApi);
    };

    return h(
      "div",
      { class: rootClass("dialog", props) },
      h(
        "div",
        { class: "lui-area" },
        h(
          "div",
          { class: "lui-dialog-wrap", style: { display: visible.value ? "" : "none" } },
          props.title ? h("div", { class: "lui-dialog-title" }, props.title) : null,
          h("div", { class: "lui-dialog-body" }, props.body ?? null),
          h("div", { class: "lui-dialog-close", onClick: handleClose }, CloseIcon()),
        ),
      ),
    );
  },
);

export default Dialog;
