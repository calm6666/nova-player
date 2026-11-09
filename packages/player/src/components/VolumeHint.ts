/**
 * ============================================
 * 音量提示组件
 * ============================================
 * 声明式响应式版本：显示/淡出/文本/图标四个状态全部由内部 signal
 * 驱动，渲染层零 DOM 操作（style/class/文本由编译器自动包装为
 * __reactiveAttrs / _reactiveText，signal 变化精准更新）。
 *
 * 对外保留 show/hide/setVolume/setMuted 命令式 API 契约不变
 * （父组件 PlayerDocker 经 onVolumeHintMounted 持有引用，零改动）；
 * API 内部仅写 signal，不再触碰 DOM。
 */

import { h, defineComponent, signal, t } from '@lumina/framework/core';
import type { ComponentLifecycle } from "@lumina/framework/types";
import { rafTimeout, cancelRaf } from '@lumina/framework/utils/rafTimeout';
import type { AnimationFrameID } from "@lumina/framework/utils/rafTimeout";
import { Volume, Mute } from "./icons";

/**
 * 音量提示组件 Props 接口
 */
export interface VolumeHintProps {
  /** 当前音量，范围 0-1（仅作初值快照，运行时由 show/setVolume 更新） */
  volume?: number;
  /** 是否显示音量提示（仅作初值快照） */
  visible?: boolean;
}

/**
 * 音量提示组件
 */
export const VolumeHint = defineComponent<VolumeHintProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 响应式状态（渲染层唯一数据源）
    // ============================================

    /** 是否显示（display 控制）——初值取 props 一次性快照，与原初值语义一致 */
    const visibleSig = signal<boolean>(props.visible ?? false);
    /** 是否处于完全显示态（opacity 控制；false 即进入 CSS transition 淡出） */
    const fadingSig = signal<boolean>(props.visible ?? false);
    /** 音量数值（驱动文本；0 显示静音文案） */
    const volumeSig = signal<number>(props.volume ?? 0);
    /** 静音图标状态（初值 false：原实现初渲染不带 muted class，
     *  muted 判定仅发生在 show(volume) 调用时，保持行为一致） */
    const mutedSig = signal<boolean>(false);

    // ============================================
    // 自动消失定时器（时序行为，保留命令式；
    // 与既有实现的 volumeHintShow.hintTimer / delayTimer 行为一致）
    // ============================================

    /** 显示 3 秒后开始淡出的定时器 */
    let hintTimer: AnimationFrameID | null = null;
    /** 淡出后延迟隐藏 display 的定时器 */
    let delayTimer: AnimationFrameID | null = null;

    // ============================================
    // 对外命令式 API（契约与原实现完全一致）
    // ——内部仅写 signal，渲染层声明式自动更新
    // ============================================

    /**
     * 显示音量提示并更新音量数值
     *
     * 与既有实现的 show 一致：
     * 先取消上一次的定时器，再显示；3 秒后淡出（opacity 0，
     * 由 CSS transition: opacity 0.3s 承担动画），再延时 300ms
     * 隐藏 display，实现「显示后延时自动消失」
     * @param volume - 当前音量，范围 0-1
     */
    const show = (volume: number): void => {
      cancelRaf(hintTimer!);
      cancelRaf(delayTimer!);
      volumeSig.value = volume;
      // 图标随 volume 联动（与原 show 实现一致：volume === 0 → muted）
      mutedSig.value = volume === 0;
      visibleSig.value = true;
      fadingSig.value = true;
      // 3 秒后淡出，再 300ms 后隐藏（与既有实现定时器逻辑一致）
      hintTimer = rafTimeout(() => {
        fadingSig.value = false;
        delayTimer = rafTimeout(() => {
          visibleSig.value = false;
        }, 300);
      }, 3000);
    };

    /**
     * 隐藏音量提示（同时清理自动消失定时器）
     */
    const hide = (): void => {
      cancelRaf(hintTimer!);
      cancelRaf(delayTimer!);
      visibleSig.value = false;
      fadingSig.value = false;
    };

    /**
     * 更新音量数值文本
     * @param volume - 当前音量，范围 0-1
     */
    const setVolume = (volume: number): void => {
      volumeSig.value = volume;
    };

    /**
     * 切换静音图标状态（与文本独立，保持 setMuted/setVolume 独立语义）
     * @param isMuted - 是否静音
     */
    const setMuted = (isMuted: boolean): void => {
      mutedSig.value = isMuted;
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("volumeHintMounted", {
        show,
        hide,
        setVolume,
        setMuted,
      });
    };

    lifecycle.onBeforeDestroy = (): void => {
      // 组件销毁前清理自动消失定时器，避免泄漏
      cancelRaf(hintTimer!);
      cancelRaf(delayTimer!);
    };

    // ============================================
    // 声明式渲染（零 DOM 操作）：
    // - style/class 内的 signal 访问由编译器包装为 __reactiveAttrs，
    //   signal 变化精准更新对应属性
    // - 文本使用显式 getter 协议（() => expr），编译器包装为
    //   _reactiveText：volumeSig 与 localeSignal（t 内部）双依赖，
    //   音量变化与语言动态切换均精准更新文本节点
    // ============================================

    return h(
      "div",
      {
        class: "nova-player-volume-hint",
        style: {
          display: visibleSig.value ? "" : "none",
          opacity: fadingSig.value ? "1" : "0",
        },
      },
      h(
        "span",
        {
          class: mutedSig.value
            ? "nova-player-volume-hint-icon nova-player-volume-muted"
            : "nova-player-volume-hint-icon",
          // 音量/静音图标：既有实现 icons 的 Volume、Mute SVG（禁止 unicode 字符当图标）；
          // 两个 SVG 均为 .nova-player-volume-hint-icon 的直接子元素，供
          // .nova-player-volume-muted 的 svg:nth-child(1)/(2) 规则切换显隐
        },
        Volume(),
        Mute(),
      ),
      h(
        "span",
        { class: "nova-player-volume-hint-text" },
        () =>
          volumeSig.value === 0
            ? t("player.ui.controls.mute")
            : `${Math.floor(volumeSig.value * 100)}%`,
      ),
    );
  },
);
