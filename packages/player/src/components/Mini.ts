/**
 * ============================================
 * 迷你播放器组件 (Mini)
 * ============================================
 */

import { h, defineComponent, useTemplateRef } from '@lumina/framework/core';
import type { ComponentLifecycle } from "@lumina/framework/types";

/**
 * 迷你播放器组件 Props 接口
 */
export interface MiniProps {
  /** 点击关闭按钮时的回调（上层退出迷你模式） */
  onClose?: () => void;
  /** 点击播放/暂停状态区时的回调（上层切换播放状态） */
  onStateChange?: () => void;
}

/**
 * 迷你播放器对外暴露的 API
 */
export interface MiniApi {
  /** 设置视频总时长（秒），作为进度比例的分母 */
  setDuration: (duration: number) => void;
  /** 更新缓冲进度条（scaleX） */
  changeBuffer: (buffer: number) => void;
  /** 更新播放进度条（scaleX） */
  changeTempo: (tempo: number) => void;
}

/**
 * 迷你播放器组件
 */
export const Mini = defineComponent<MiniProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 状态数据
    // ============================================

    /** 视频总时长（秒），由上层通过 setDuration 回传 */
    let duration = 0;

    // ============================================
    // DOM 引用
    // ============================================

    /** 迷你窗口根元素引用 */
    const miniWrapRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "miniWrapRef",
    );

    /** 缓冲进度条元素引用 */
    const progressBufferRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "progressBufferRef",
    );

    /** 播放进度条元素引用 */
    const progressTempoRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "progressTempoRef",
    );

    // ============================================
    // DOM 更新方法
    // ============================================

    /**
     * 设置视频总时长
     * @param value - 总时长（秒）
     */
    const setDuration = (value: number): void => {
      duration = value;
    };

    /**
     * 更新缓冲进度条的显示比例
     * @param buffer - 缓冲进度时间（秒）
     */
    const changeBuffer = (buffer: number): void => {
      if (progressBufferRef.value) {
        progressBufferRef.value.style.transform = `scaleX(${buffer / (duration || 1)})`;
      }
    };

    /**
     * 更新播放进度条的显示比例
     * @param tempo - 当前播放时间（秒）
     */
    const changeTempo = (tempo: number): void => {
      if (progressTempoRef.value) {
        progressTempoRef.value.style.transform = `scaleX(${tempo / (duration || 1)})`;
      }
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    /**
     * 组件挂载后，通过事件向外暴露控制方法与根元素引用
     */
    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("miniMounted", {
        setDuration,
        changeBuffer,
        changeTempo,
        wrap: miniWrapRef.value,
      });
    };

    // ============================================
    // 组件渲染（DOM 结构与既有实现一致）
    // ============================================

    return h(
      "div",
      { class: "nova-player-mini-warp", ref: "miniWrapRef" },
      // 关闭按钮
      h(
        "div",
        { class: "nova-player-mini-close", onClick: () => props.onClose?.() },
        h(
          "svg",
          {
            viewBox: "0 0 1024 1024",
            version: "1.1",
            xmlns: "http://www.w3.org/2000/svg",
          },
          h("path", {
            d: "M512 444.16l297.088-297.088c17.088-17.152 46.208-15.872 64.96 2.88 18.752 18.752 20.032 47.872 2.88 64.96L579.904 512l297.024 297.088c17.152 17.088 15.872 46.208-2.88 64.96-18.752 18.752-47.872 20.032-64.96 2.88L512 579.904l-297.088 297.024c-17.088 17.152-46.208 15.872-64.96-2.88-18.752-18.752-20.032-47.872-2.88-64.96L444.096 512 147.072 214.912c-17.152-17.088-15.872-46.208 2.88-64.96 18.752-18.752 47.872-20.032 64.96-2.88L512 444.096z",
          }),
        ),
      ),
      // 播放 / 暂停状态区（图标显隐由容器的 state-paused 类配合 CSS 控制）
      h(
        "div",
        {
          class: "nova-player-mini-state",
          onClick: () => props.onStateChange?.(),
        },
        h("div", { class: "nova-player-mini-state-play" }),
        h("div", { class: "nova-player-mini-state-pause" }),
      ),
      // 进度条（缓冲 + 播放）
      h(
        "div",
        { class: "nova-player-mini-progress" },
        h("div", {
          class: "nova-player-mini-progress-buffer",
          ref: "progressBufferRef",
        }),
        h("div", {
          class: "nova-player-mini-progress-tempo",
          ref: "progressTempoRef",
        }),
      ),
    );
  },
);
