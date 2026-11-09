/**
 * ============================================
 * 互动层容器组件 (InteractionLayer)
 * ============================================
 * 仅渲染 .nova-player-cmd-dm-wrap > .nova-player-cmd-dm-inside 容器
 * 互动插件将自身 DOM 注入到该容器中
 */

import { h, defineComponent, useTemplateRef } from '@lumina/framework/core';
import type { ComponentLifecycle } from "@lumina/framework/types";

// ============================================
// 互动层容器组件 Props 接口
// ============================================

/** 互动层容器组件属性接口 */
export interface InteractionLayerProps {
  /** 是否显示互动区域的边线 */
  showLines?: boolean;
  /** 边线可见性配置，控制四条边的显示 */
  lineVisibility?: {
    /** 上边线是否可见 */
    top?: boolean;
    /** 下边线是否可见 */
    bottom?: boolean;
    /** 左边线是否可见 */
    left?: boolean;
    /** 右边线是否可见 */
    right?: boolean;
  };
}

// ============================================
// InteractionLayer 组件
// ============================================

/**
 * InteractionLayer 组件 - 使用 defineComponent 创建独立组件
 * 提供互动插件注入 DOM 的容器，替代原有 RowCmd 组件
 */
export const InteractionLayer = defineComponent<InteractionLayerProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // DOM 引用
    // ============================================

    /** 互动层外层容器 DOM 引用，用于设置边线样式 */
    const cmdDmWrapRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "cmdDmWrapRef",
    );

    /** 互动层内部容器 DOM 引用，互动插件将内容注入到此容器 */
    const dmInsideRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "dmInsideRef",
    );

    // ============================================
    // 样式计算
    // ============================================

    /**
     * 计算边线样式
     * @returns CSS 样式对象，包含 borderWidth、borderStyle、borderColor
     */
    const computeLineStyle = (): Record<string, string> => {
      if (!props.showLines) return {};

      /** 边线可见性配置，默认四条边均可见 */
      const visibility = props.lineVisibility ?? {
        top: true,
        bottom: true,
        left: true,
        right: true,
      };

      /** 各边边线宽度值数组，顺序为上、右、下、左 */
      const borderParts: string[] = [];

      if (visibility.top) borderParts.push("1px solid rgba(255,255,255,0.15)");
      else borderParts.push("none");

      if (visibility.right)
        borderParts.push("1px solid rgba(255,255,255,0.15)");
      else borderParts.push("none");

      if (visibility.bottom)
        borderParts.push("1px solid rgba(255,255,255,0.15)");
      else borderParts.push("none");

      if (visibility.left) borderParts.push("1px solid rgba(255,255,255,0.15)");
      else borderParts.push("none");

      return {
        borderWidth: borderParts.join(" "),
        borderStyle: "solid",
        borderColor: "rgba(255,255,255,0.15)",
      };
    };

    /**
     * 更新边线样式（响应式）
     * 当 showLines 或 lineVisibility 变化时调用
     */
    const updateLineStyle = (): void => {
      if (!cmdDmWrapRef.value) return;

      /** 计算得到的边线样式对象 */
      const lineStyle = computeLineStyle();
      Object.entries(lineStyle).forEach(([key, value]: [string, string]) => {
        cmdDmWrapRef.value?.style.setProperty(key, value);
      });
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    /** 组件挂载后初始化边线样式并对外暴露内部容器引用 */
    lifecycle.onMounted = (): void => {
      updateLineStyle();
      lifecycle.emit?.("interactionLayerMounted", {
        container: dmInsideRef.value,
      });
    };

    /** 组件销毁前清理容器内的所有子节点 */
    lifecycle.onBeforeDestroy = (): void => {
      // 清理容器内所有子节点
      if (dmInsideRef.value) {
        while (dmInsideRef.value.firstChild) {
          dmInsideRef.value.removeChild(dmInsideRef.value.firstChild);
        }
      }
    };

    // ============================================
    // 主渲染函数
    // ============================================

    return h(
      "div",
      {
        class: "nova-player-cmd-dm-wrap",
        ref: "cmdDmWrapRef",
        style: {
          ...computeLineStyle(),
        },
      },
      h("div", { class: "nova-player-cmd-dm-inside", ref: "dmInsideRef" }),
    );
  },
);

export default InteractionLayer;
