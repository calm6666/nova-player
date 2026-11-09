/**
 * ============================================
 * 弹幕容器组件 (RowDm)
 * ============================================
 * 职责收敛：本组件只负责渲染弹幕容器骨架（基础/高级/旋转）并提供
 * 「根容器暂停类」与「弹幕悬停提示」两条控制通道；
 * 弹幕的创建/动画/回收/设置应用全部由弹幕插件的 DanmakuManager 接管：
 * - 容器骨架：.nova-player-row-dm-wrap > 高级/基础/旋转容器，
 *   DanmakuPlugin 在 MOUNTED 后向 .nova-player-bas-dm-wrap 内挂载引擎层
 * - 暂停/恢复：沿用原版机制——根容器追加 danmaku-x-paused 类，
 *   由 pausedSig 驱动（__reactiveAttrs 自动同步，video play/pause 时联动）
 * - 悬停提示：命中弹幕元素时向父层 emit，由 Dialog 展示弹幕详情
 */

import { defineComponent, h, useTemplateRef, signal } from '@lumina/framework/core';
import type { ComponentLifecycle } from "@lumina/framework/types";

// ============================================
// 组件属性接口
// ============================================

/** 弹幕容器组件属性接口 */
export interface RowDmProps {
  /** 是否开启弹幕显示 */
  isOpen?: boolean;
}

// ============================================
// 弹幕容器组件
// ============================================

/**
 * 弹幕容器组件
 * 渲染弹幕容器骨架，并向外暴露播放暂停联动与悬停提示通道
 */
export const RowDm = defineComponent<RowDmProps>(
  (_props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // DOM 元素引用
    // ============================================

    /** 高级弹幕容器 DOM 引用，用于放置特殊效果弹幕 */
    const playerAdvDmWrapRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "playerAdvDmWrapRef",
    );

    /** 基础弹幕容器 DOM 引用，DanmakuPlugin 的引擎层挂载于此 */
    const playerBasDmWrapRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "playerBasDmWrapRef",
    );

    /** 旋转弹幕容器 DOM 引用，用于放置旋转特效弹幕 */
    const danmakuXRotateRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "danmakuXRotateRef",
    );

    // ============================================
    // 弹幕提示（DmTip）
    // ============================================

    /**
     * 显示弹幕提示，通知上层组件展示弹幕详情
     * @param event - 鼠标事件
     * @param element - 弹幕 DOM 元素
     */
    const showDmTip = (event: MouseEvent, element: HTMLElement): void => {
      lifecycle.emit?.("showDmTip", { event, element });
    };

    /**
     * 隐藏弹幕提示，通知上层组件关闭弹幕详情
     * @param element - 弹幕 DOM 元素
     */
    const hideDmTip = (element: HTMLElement): void => {
      lifecycle.emit?.("hideDmTip", { element });
    };

    // ============================================
    // 播放/暂停控制
    // ============================================

    /**
     * 弹幕容器暂停态信号（渲染层唯一数据源）
     * 初值 true：与原实现初始渲染即带 danmaku-x-paused 类一致
     * （弹幕容器默认暂停，收到 playing 才恢复 CSS 动画）
     */
    const pausedSig = signal<boolean>(true);

    /**
     * 切换弹幕的播放/暂停状态
     * 内部仅写 signal，根容器 class 由渲染层 __reactiveAttrs 自动同步
     * @param playState - 播放状态，'playing' 恢复动画，'paused' 暂停动画
     */
    const playPause = (playState: "playing" | "paused"): void => {
      pausedSig.value = playState !== "playing";
    };

    // ============================================
    // 生命周期
    // ============================================

    /** 组件挂载后对外暴露弹幕容器控制方法 */
    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("danmakuLayerMounted", {
        playPause,
        showDmTip,
        hideDmTip,
      });
    };

    /** 组件销毁前清理所有弹幕容器内的子节点 */
    lifecycle.onBeforeDestroy = (): void => {
      // 清理基础弹幕容器内所有子节点
      if (playerBasDmWrapRef.value) {
        while (playerBasDmWrapRef.value.firstChild) {
          playerBasDmWrapRef.value.removeChild(
            playerBasDmWrapRef.value.firstChild,
          );
        }
      }
      // 清理高级弹幕容器内所有子节点
      if (playerAdvDmWrapRef.value) {
        while (playerAdvDmWrapRef.value.firstChild) {
          playerAdvDmWrapRef.value.removeChild(
            playerAdvDmWrapRef.value.firstChild,
          );
        }
      }
      // 清理旋转弹幕容器内所有子节点
      if (danmakuXRotateRef.value) {
        while (danmakuXRotateRef.value.firstChild) {
          danmakuXRotateRef.value.removeChild(
            danmakuXRotateRef.value.firstChild,
          );
        }
      }
    };

    // ============================================
    // 渲染输出
    // ============================================

    /**
     * 渲染弹幕容器骨架
     * .nova-player-row-dm-wrap.danmaku-x-paused > .nova-player-adv-dm-wrap + .nova-player-bas-dm-wrap > .bas-danmaku.bas-danmaku-pause + .danmaku-x-dm-rotate
     *
     * 根容器暂停态 class 由 pausedSig 驱动（__reactiveAttrs 自动同步）：
     * danmaku-x-paused 使容器内所有 CSS 弹幕动画 paused（原版暂停机制），
     * 与引擎层自身的 .danmaku-layer.danmaku-x-paused 双层保障一致
     */
    return h(
      "div",
      {
        class: [
          "nova-player-row-dm-wrap",
          { "danmaku-x-paused": pausedSig.value },
        ],
      },
      // 高级弹幕容器
      h("div", {
        class: "nova-player-adv-dm-wrap",
        ref: "playerAdvDmWrapRef",
      }),
      // 基础弹幕容器（DanmakuPlugin 的引擎层挂载点）
      h(
        "div",
        {
          class: "nova-player-bas-dm-wrap",
          ref: "playerBasDmWrapRef",
        },
        h("div", {
          class: "bas-danmaku bas-danmaku-pause",
          style: { width: "100%" },
        }),
      ),
      // 旋转弹幕容器
      h("div", {
        class: "danmaku-x-dm-rotate",
        ref: "danmakuXRotateRef",
      }),
    );
  },
);

export default RowDm;
