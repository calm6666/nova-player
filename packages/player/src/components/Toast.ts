/**
 * ============================================
 * Toast 提示组件（按 B 站真实 toastStore / toast DOM 实现）
 * ============================================
 * 结构：toast-wrap > toast-row > toast-item
 * item 内可选：toast-cancel / toast-badge / toast-text / toast-confirm
 */

import { h, defineComponent, signal, t, For } from "@/core";
import { Close } from "@/nova/components/icons";
import type { ComponentLifecycle } from "@/types";

/** 单条 Toast 配置 */
export interface ToastOptions {
  /** 文本 */
  text: string;
  /** 自动消失时间（毫秒）；不传则不自动消失 */
  duration?: number;
  /** 显示左侧关闭按钮 */
  manualMode?: boolean;
  /** 左侧徽章图片 */
  badgeUrl?: string;
  /** 右侧确认按钮文字 */
  confirmText?: string;
  /** 确认回调 */
  onConfirm?: () => void;
  /** 关闭回调 */
  onClose?: () => void;
  /** 固定提示（不自动消失） */
  fixed?: boolean;
  /** 固定提示附带的时间文本 */
  time?: string;
}

interface ToastRecord extends ToastOptions {
  iid: number;
}

export interface ToastProps {
  /** 保留字段 */
  visible?: boolean;
  /** 初始文本 */
  text?: string;
  /** 初始跳转时间 */
  jumpTime?: string;
  /** 关闭固定提示回调 */
  onClose?: () => void;
  /** 跳转回调 */
  onJump?: () => void;
}

export const Toast = defineComponent<ToastProps>(
  (props, lifecycle: ComponentLifecycle) => {
    const records = signal<ToastRecord[]>([]);
    const timers = new Map<number, ReturnType<typeof setTimeout>>();
    let nextId = 1;

    const remove = (iid: number): void => {
      const timer = timers.get(iid);
      if (timer) clearTimeout(timer);
      timers.delete(iid);
      records.value = records.value.filter((item) => item.iid !== iid);
    };

    const add = (options: ToastOptions): number => {
      const record: ToastRecord = { ...options, iid: nextId++ };
      records.value = [...records.value, record];
      if (options.duration && options.duration > 0) {
        timers.set(
          record.iid,
          setTimeout(() => remove(record.iid), options.duration),
        );
      }
      return record.iid;
    };

    const showToast = (options: ToastOptions): number => add(options);

    const showAutoToast = (text: string, duration = 3000): void => {
      add({ text, duration });
    };

    const hideAutoToast = (): void => {
      const lastAuto = [...records.value]
        .reverse()
        .find((item) => !item.fixed && item.duration);
      if (lastAuto) remove(lastAuto.iid);
    };

    const showFixedToast = (text: string, jumpTime: string): void => {
      add({
        text,
        fixed: true,
        manualMode: true,
        time: jumpTime,
        confirmText: t("player.ui.toast.jump"),
        onConfirm: () => props.onJump?.(),
        onClose: () => props.onClose?.(),
      });
    };

    const hideFixedToast = (): void => {
      records.value
        .filter((item) => item.fixed)
        .forEach((item) => remove(item.iid));
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("toastMounted", {
        showAutoToast,
        hideAutoToast,
        showFixedToast,
        hideFixedToast,
        showToast,
      });
    };

    lifecycle.onBeforeDestroy = (): void => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };

    return h(
      "div",
      {
        class: "nova-player-toast-wrap",
        style: { display: records.value.length > 0 ? "block" : "none" },
      },
      h(For, {
        each: (): ToastRecord[] => records.value,
        key: (item: ToastRecord): number => item.iid,
        render: (item: ToastRecord) =>
          h(
            "div",
            {
              class: [
                "nova-player-toast-row",
                { "nova-player-toast-unfold": true },
              ],
            },
            h(
              "div",
              { class: "nova-player-toast-item" },
              item.manualMode
                ? h(
                    "span",
                    {
                      class: "nova-player-toast-cancel",
                      onClick: (event: MouseEvent) => {
                        event.stopPropagation();
                        item.onClose?.();
                        remove(item.iid);
                      },
                    },
                    h("span", { class: "common-svg-icon" }, Close()),
                  )
                : null,
              item.badgeUrl
                ? h(
                    "span",
                    { class: "nova-player-toast-badge" },
                    h("img", { src: item.badgeUrl, alt: "badge-icon" }),
                  )
                : null,
              h("span", { class: "nova-player-toast-text" }, item.text),
              item.time
                ? h("span", { class: "nova-player-toast-time" }, item.time)
                : null,
              item.confirmText
                ? h(
                    "span",
                    {
                      class: "nova-player-toast-confirm",
                      onClick: (event: MouseEvent) => {
                        event.stopPropagation();
                        item.onConfirm?.();
                        remove(item.iid);
                      },
                    },
                    item.confirmText,
                  )
                : null,
            ),
          ),
      }),
    );
  },
);
