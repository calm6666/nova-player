/**
 * ============================================
 * 对话框组件 (Dialog)
 * ============================================
 * 支持弹幕详情提示弹窗 (DmTip) 和通用对话框
 */

import { h, defineComponent, useTemplateRef, materialize } from '@lumina/framework/core';
import { isBrowser } from '@lumina/framework/utils';
import { Close } from "./icons";
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";

/**
 * 安全转义 CSS 颜色值字符串
 * 防止注入 expression() 或 javascript: 等危险值
 */
function sanitizeColor(color: string): string {
  // 只允许合法的 CSS 颜色值字符
  return color.replace(/[^a-zA-Z0-9#,.\s()%-]/g, "");
}

// ============================================
// 弹幕提示数据接口
// ============================================

/** 弹幕详情提示数据，用于展示弹幕的元信息 */
export interface DmTipData {
  /** 弹幕文本内容 */
  content: string;
  /** 弹幕出现的时间点（秒） */
  timePoint: number;
  /** 发送该弹幕的用户名 */
  user?: string;
  /** 弹幕文字颜色，CSS 颜色值 */
  color?: string;
  /** 弹幕显示模式（如滚动、顶部固定、底部固定） */
  mode?: string;
  /** 弹幕字体大小（像素） */
  fontSize?: number;
}

// ============================================
// 对话框组件 Props 接口
// ============================================

/** 对话框组件属性接口 */
export interface DialogProps {
  /** 是否显示对话框 */
  visible?: boolean;
  /** 对话框内容文本 */
  content?: string;
  /** 关闭对话框时的回调函数 */
  onClose?: () => void;
}

// ============================================
// 对话框组件
// ============================================

/**
 * 对话框组件
 * 提供弹幕详情提示弹窗的创建与销毁，以及通用对话框容器
 */
export const Dialog = defineComponent<DialogProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // DOM 引用
    // ============================================

    /** 对话框外层容器 DOM 引用 */
    const dialogWrapRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "dialogWrapRef",
    );

    /** 当前显示的弹幕提示弹窗 DOM 元素 */
    let dmTipElement: HTMLDivElement | null = null;

    // ============================================
    // 弹幕提示方法
    // ============================================

    /**
     * 弹幕提示里的一行「标签 + 值」
     * @param label - 标签文本
     * @param value - 值文本
     * @param color - 值的颜色（可选）
     * @returns 行虚拟节点
     */
    const tipRow = (label: string, value: string, color?: string): VNode =>
      h(
        "div",
        { class: "nova-player-dm-tip-row" },
        h("span", { class: "nova-player-dm-tip-label" }, label),
        h(
          "span",
          color
            ? {
                class: "nova-player-dm-tip-value",
                style: { color: sanitizeColor(color) },
              }
            : { class: "nova-player-dm-tip-value" },
          value,
        ),
      );

    /**
     * 显示弹幕详情提示弹窗
     * @param dmTip - 弹幕提示数据
     * @param container - 弹幕元素所在的容器，提示弹窗将挂载到此容器内
     */
    const showDmTip = (dmTip: DmTipData, container: HTMLElement): void => {
      if (!isBrowser()) return;
      // 先移除已有的提示
      hideDmTip();

      if (!container) return;

      /** 时间点对应的分钟数 */
      const minutes = Math.floor(dmTip.timePoint / 60);
      /** 时间点对应的秒数 */
      const seconds = Math.floor(dmTip.timePoint % 60);
      /** 格式化后的时间字符串，格式为 "mm:ss" */
      const timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

      /** 弹幕提示弹窗根元素（关闭按钮同样由虚拟节点挂载，不再手工绑定监听） */
      const tipEl = materialize(
        h(
          "div",
          { class: "nova-player-dm-tip" },
          tipRow("内容：", dmTip.content),
          tipRow("时间：", timeStr),
          ...(dmTip.user ? [tipRow("用户：", dmTip.user)] : []),
          ...(dmTip.color ? [tipRow("颜色：", dmTip.color, dmTip.color)] : []),
          h(
            "div",
            {
              class: "nova-player-dm-tip-close",
              onClick: () => {
                hideDmTip();
                props.onClose?.();
              },
            },
            Close(),
          ),
        ),
      ) as HTMLDivElement;

      container.appendChild(tipEl);
      dmTipElement = tipEl;
    };

    /**
     * 隐藏弹幕详情提示弹窗
     * @param element - 可选指定要移除的提示元素，不传则移除当前记录的提示元素
     */
    const hideDmTip = (element?: HTMLElement): void => {
      /** 实际要移除的目标元素 */
      const target = element ?? dmTipElement;
      if (target && target.parentNode) {
        target.parentNode.removeChild(target);
      }
      if (target === dmTipElement || !element) {
        dmTipElement = null;
      }
    };

    // ============================================
    // 生命周期
    // ============================================

    /** 组件挂载后对外暴露对话框容器和弹幕提示控制方法 */
    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("dialogMounted", {
        dialogWrap: dialogWrapRef.value,
        showDmTip,
        hideDmTip,
      });
    };

    /** 组件销毁前清理弹幕提示和容器内的所有子节点 */
    lifecycle.onBeforeDestroy = (): void => {
      // 清理弹幕提示
      hideDmTip();
      // 清理对话框容器内所有子节点
      if (dialogWrapRef.value) {
        while (dialogWrapRef.value.firstChild) {
          dialogWrapRef.value.removeChild(dialogWrapRef.value.firstChild);
        }
      }
    };

    // ============================================
    // 渲染输出
    // ============================================

    return h("div", {
      class: "nova-player-dialog-wrap",
      ref: "dialogWrapRef",
      style: {
        display: props.visible ? "" : "none",
      },
    });
  },
);

export default Dialog;
