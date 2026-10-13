/**
 * ============================================
 * 互动视频层容器组件 (InteractiveVideoLayer)
 * ============================================
 * 仅渲染互动视频的根容器 .nova-player-interaction-wrap，
 * 内部不渲染任何内容：剧情进度条（story / oval / hover-item）、
 * 分支选择（question + canvas）、特殊节点（special）、隐藏节点（hidden）、
 * 倒计时（countdown）、重播按钮（replay）等全部由 plugins 包下的
 * 互动视频插件注入（样式同样由插件以 ?inline scss 运行时注入）。
 *
 * 与 InteractionLayer（交互卡片容器 .nova-player-cmd-dm-wrap）的区别：
 * - 两者是不同插件的不同挂载容器，互不干扰
 * - 本容器由互动视频插件使用，承载剧情进度条 / 分支选择等互动视频功能
 *
 * 挂载位置：视频区域内、控制栏（Controls）之前（倒数第二）；
 * 整体随控制栏显隐的联动由插件注入样式实现
 * （.nova-player-container[data-ctrl-hidden] 规则）。
 */

import { h, defineComponent, useTemplateRef } from "@/core";
import type { ComponentLifecycle } from "@/types";

// ============================================
// 互动视频层 API（挂载后回传给 PlayerDocker / 插件）
// ============================================

/** 互动视频层 API：暴露根容器引用，插件据此注入内容 */
export interface InteractiveVideoLayerAPI {
  /** 互动视频根容器（.nova-player-interaction-wrap） */
  wrap: HTMLElement | null;
}

// ============================================
// InteractiveVideoLayer 组件
// ============================================

/**
 * InteractiveVideoLayer 组件 - 互动视频根容器
 * 结构上只输出一个空的 .nova-player-interaction-wrap，
 * 所有内部结构与样式均由互动视频插件负责（与 InteractionLayer
 * 承载交互卡片插件的模式一致）
 */
export const InteractiveVideoLayer = defineComponent(
  (_props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // DOM 引用
    // ============================================

    /** 互动视频根容器 DOM 引用，插件将内容注入到此容器 */
    const wrapRef = useTemplateRef<HTMLDivElement>(lifecycle, "wrapRef");

    // ============================================
    // 生命周期钩子
    // ============================================

    /** 组件挂载后对外暴露根容器引用 */
    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("interactiveVideoLayerMounted", {
        wrap: wrapRef.value,
      } satisfies InteractiveVideoLayerAPI);
    };

    /** 组件销毁前清理容器内的所有子节点（插件注入的内容一并移除） */
    lifecycle.onBeforeDestroy = (): void => {
      if (wrapRef.value) {
        while (wrapRef.value.firstChild) {
          wrapRef.value.removeChild(wrapRef.value.firstChild);
        }
      }
    };

    // ============================================
    // 主渲染函数：仅一个空的根容器
    // ============================================

    return h("div", {
      class: "nova-player-interaction-wrap",
      ref: "wrapRef",
    });
  },
);

export default InteractiveVideoLayer;
