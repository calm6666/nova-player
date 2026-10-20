/**
 * ============================================
 * Toast 提示组件（按 B 站 toastStore / toast DOM 实现）
 * ============================================
 * 结构：toast-wrap
 *        ├── toast-auto
 *        └── toast-fixed
 * 每条：toast-row > toast-item
 * item 内可选：cancel / badge / text / confirm
 */

import { h, defineComponent, signal, t, For } from "@/core";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import type { AnimationFrameID } from "@/utils/rafTimeout";
import { Close } from "@/nova/components/icons";
import type { ComponentLifecycle } from "@/types";

/** 单条 Toast 配置 */
export interface ToastOptions {
  text: string;
  /** 自动消失时间（毫秒） */
  duration?: number;
  /** 左侧关闭按钮 */
  manualMode?: boolean;
  /** 徽章图片 */
  badgeUrl?: string;
  /** 确认按钮文字 */
  confirmText?: string;
  /** 确认回调 */
  onConfirm?: () => void;
  /** 关闭回调 */
  onClose?: () => void;
  /** 固定组（不自动消失） */
  fixed?: boolean;
  /** 时间文本 */
  time?: string;
}

interface ToastRecord extends ToastOptions {
  iid: number;
  /** 正在执行收起动画 */
  hidden?: boolean;
}

export interface ToastProps {
  visible?: boolean;
  text?: string;
  jumpTime?: string;
  onClose?: () => void;
  onJump?: () => void;
}

export const Toast = defineComponent<ToastProps>(
  (props, lifecycle: ComponentLifecycle) => {
    const records = signal<ToastRecord[]>([]);
    const autoTimers = new Map<number, AnimationFrameID>();
    const removeTimers = new Map<number, AnimationFrameID>();
    const remaining = new Map<number, number>();
    const startedAt = new Map<number, number>();
    let nextId = 1;

    const clearAutoTimer = (iid: number): void => {
      const timer = autoTimers.get(iid);
      if (timer) cancelRaf(timer);
      autoTimers.delete(iid);
    };

    const startAutoTimer = (iid: number, duration: number): void => {
      clearAutoTimer(iid);
      startedAt.set(iid, Date.now());
      autoTimers.set(
        iid,
        rafTimeout(() => remove(iid), duration),
      );
    };

    /** 悬停暂停：记录剩余时间 */
    const pauseTimer = (iid: number): void => {
      const timer = autoTimers.get(iid);
      if (!timer) return;
      cancelRaf(timer);
      autoTimers.delete(iid);
      const left = remaining.get(iid) ?? 0;
      const elapsed = Date.now() - (startedAt.get(iid) ?? Date.now());
      remaining.set(iid, Math.max(0, left - elapsed));
    };

    /** 离开恢复计时 */
    const resumeTimer = (iid: number): void => {
      const left = remaining.get(iid);
      if (left === undefined || left <= 0) return;
      startAutoTimer(iid, left);
    };

    /** 播放收起动画后移除 */
    const remove = (iid: number): void => {
      clearAutoTimer(iid);
      const record = records.value.find((item) => item.iid === iid);
      if (!record || record.hidden) return;
      records.value = records.value.map((item) =>
        item.iid === iid ? { ...item, hidden: true } : item,
      );
      const timer = rafTimeout(() => {
        records.value = records.value.filter((item) => item.iid !== iid);
        removeTimers.delete(iid);
        remaining.delete(iid);
        startedAt.delete(iid);
      }, 250);
      removeTimers.set(iid, timer);
    };

    const add = (options: ToastOptions): number => {
      const iid = nextId++;
      const duration =
        options.duration && options.duration > 0 ? options.duration : 0;
      const record: ToastRecord = { ...options, iid, duration };
      records.value = [...records.value, record];
      if (duration > 0 && !options.fixed) {
        remaining.set(iid, duration);
        startAutoTimer(iid, duration);
      }
      return iid;
    };

    const showToast = (options: ToastOptions): number => add(options);

    const showAutoToast = (text: string, duration = 3000): void => {
      add({ text, duration });
    };

    const hideAutoToast = (): void => {
      const last = [...records.value]
        .reverse()
        .find((item) => !item.fixed && !item.hidden);
      if (last) remove(last.iid);
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
        .filter((item) => item.fixed && !item.hidden)
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
      autoTimers.forEach((timer) => cancelRaf(timer));
      removeTimers.forEach((timer) => cancelRaf(timer));
      autoTimers.clear();
      removeTimers.clear();
    };

    const renderRow = (item: ToastRecord) =>
      h(
        "div",
        {
          class: [
            "nova-player-toast-row",
            { "nova-player-toast-unfold": !item.hidden },
          ],
          onMouseEnter: () => pauseTimer(item.iid),
          onMouseLeave: () => resumeTimer(item.iid),
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
                  },
                },
                item.confirmText,
              )
            : null,
        ),
      );

    return h(
      "div",
      {
        class: "nova-player-toast-wrap",
        style: { display: records.value.length > 0 ? "block" : "none" },
      },
      h(
        "div",
        { class: "nova-player-toast-auto" },
        h(For, {
          each: (): ToastRecord[] =>
            records.value.filter((item) => !item.fixed),
          key: (item: ToastRecord): number => item.iid,
          render: renderRow,
        }),
      ),
      h(
        "div",
        { class: "nova-player-toast-fixed" },
        h(For, {
          each: (): ToastRecord[] =>
            records.value.filter((item) => item.fixed),
          key: (item: ToastRecord): number => item.iid,
          render: renderRow,
        }),
      ),
    );
  },
);
