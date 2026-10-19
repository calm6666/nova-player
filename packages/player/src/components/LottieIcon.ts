/**
 * ============================================
 * Lottie 动画图标组件 (LottieIcon)
 * ============================================
 * 封装 lottie-web 动画库，支持动态导入以减小包体积
 * 支持普通动画、悬停动画、切换动画等多种模式
 * 支持序列播放模式（A播完播B，B播完播A，可在任意帧暂停）
 * 不支持 lottie 时显示回退内容（插槽式 VNode）
 *
 * 组件不处理鼠标事件，通过 ref 暴露方法供父组件调用
 */

import { h, defineComponent, useTemplateRef } from "@/core";
import type { ComponentLifecycle, VNode } from "@/types";
import { isBrowser } from "@/utils";
import type { AnimationItem, LottiePlayer } from "lottie-web";

// ============================================
// 序列播放类型
// ============================================

/**
 * 动画槽位完成后的行为
 * - next: 播放下一个槽位（最后一个槽位回到第一个，形成循环序列）
 * - stop: 停在 stopFrame 指定的帧
 * - loop: 当前槽位循环播放
 */
export type AnimationSlotCompleteAction = "next" | "stop" | "loop";

/**
 * 序列播放中的单个动画槽位
 */
export interface AnimationSlot {
  /** 动画 JSON 数据，与 path 二选一 */
  animationData?: Record<string, unknown>;
  /** 动画 JSON 文件 URL，与 animationData 二选一 */
  path?: string;
  /** 是否自动播放，默认 true */
  autoplay?: boolean;
  /** 起始帧索引，设置后动画从该帧开始播放（autoplay 为 true 时）或停在该帧（autoplay 为 false 时） */
  startFrame?: number;
  /** 该段播放完毕后的行为，默认 'next' */
  complete?: AnimationSlotCompleteAction;
  /** 停止时停在哪个帧，默认最后一帧（op-1） */
  stopFrame?: number;
  /** 停止时是否反向播放到目标帧（形成"收回"效果），默认 false */
  reverseToStopFrame?: boolean;
  /** 该段是否循环播放（仅当 onComplete='loop' 时生效） */
  loop?: boolean;
}

// ============================================
// API 接口
// ============================================

/**
 * LottieIcon 对外暴露的 API 接口
 * 父组件通过 ref 获取组件实例，直接调用方法控制动画
 */
export interface LottieIconApi {
  /** 播放主动画 */
  play: () => void;
  /** 暂停主动画 */
  pause: () => void;
  /** 停止主动画并重置到初始帧 */
  stop: () => void;
  /** 切换到悬停态动画 */
  showHover: () => void;
  /** 恢复到主态动画 */
  hideHover: () => void;
  /** 切换动画（toggleData 模式）或重新播放 */
  toggle: () => void;
  /** 序列模式：前进到下一个槽位 */
  advanceSlot: () => void;
  /** 序列模式：设置当前槽位索引 */
  setSequenceSlot: (index: number) => void;
  /** 获取当前序列槽位索引 */
  getCurrentSlotIndex: () => number;
  /** 销毁动画实例并释放资源 */
  destroy: () => void;
}

// ============================================
// Props 接口
// ============================================

/**
 * LottieIcon 组件 Props 接口
 */
export interface LottieIconProps {
  // === 基础标识 ===
  /** 动画名称标识，用于 data-name 属性和事件区分 */
  name: string;

  // === 单动画模式 ===
  /** 动画 JSON 数据，与 path 二选一 */
  animationData?: Record<string, unknown>;
  /** 动画 JSON 文件 URL，与 animationData 二选一 */
  path?: string;
  /** 是否自动播放，默认 true */
  autoplay?: boolean;
  /** 是否循环播放，默认 true */
  loop?: boolean;
  /** 播放方向（1=正向，-1=反向），默认 1 */
  direction?: 1 | -1;
  /** 播放速度倍率，默认 1 */
  speed?: number;
  /** 渲染器类型，默认 svg */
  renderer?: "svg" | "canvas" | "html";

  // === 序列播放模式（与单动画模式互斥）===
  /**
   * 动画序列，传此值时忽略 animationData/path
   * 按数组顺序依次播放，根据每个 slot 的 onComplete 决定行为
   */
  sequence?: AnimationSlot[];
  /** 序列模式初始槽位索引，默认 0 */
  initialSlotIndex?: number;

  /**
   * 动画就绪回调（lottie 动态 import 完成且首个动画实例创建之后触发）
   *
   * lottie-web 是异步加载的：就绪前调用 setSequenceSlot/play 会被静默丢弃
   * （loadLottie 的 await 尚未完成）。父组件可在此回调里把图标补同步到
   * 当前业务状态对应的槽位，避免「挂载即处于激活态」时图标停在初始槽位。
   */
  onReady?: () => void;

  // === 交互 ===
  /** 悬停动画 JSON 数据 */
  hoverData?: Record<string, unknown>;
  /** 悬停动画 URL */
  hoverPath?: string;
  /** 切换动画 JSON 数据 */
  toggleData?: Record<string, unknown>;

  // === 回退 ===
  /** 回退内容（插槽式 VNode），lottie 加载失败时显示 */
  fallback?: VNode[];

  // === 样式 ===
  /** 追加的 CSS 类名（基础类 common-svg-icon 始终存在） */
  className?: string;
  /** 自定义行内样式 */
  style?: Record<string, string>;
}

// ============================================
// 组件实现
// ============================================

/**
 * LottieIcon 组件
 * 封装 lottie-web 动画，支持序列播放、插槽式回退
 * 不处理鼠标事件，通过 ref 暴露方法供父组件调用
 */
export const LottieIcon = defineComponent<LottieIconProps, LottieIconApi>(
  (props, lifecycle: ComponentLifecycle) => {
    const {
      /** 动画名称标识 */
      name,
      /** 动画 JSON 数据 */
      animationData,
      /** 动画 URL 路径 */
      path,
      /** 是否自动播放，默认 true */
      autoplay = true,
      /** 是否循环播放，默认 true */
      loop = false,
      /** 播放方向，默认 1（正向） */
      direction = 1,
      /** 播放速度，默认 1 */
      speed = 1,
      /** 渲染器类型，默认 svg */
      renderer = "svg",
      /** 动画序列 */
      sequence,
      /** 序列模式初始槽位索引 */
      initialSlotIndex = 0,
      /** 动画就绪回调（lottie 加载 + 首帧动画创建完成后触发） */
      onReady,
      /** 悬停动画 JSON 数据 */
      hoverData,
      /** 悬停动画 URL */
      hoverPath,
      /** 切换动画 JSON 数据 */
      toggleData,
      /** 回退内容（插槽式 VNode） */
      fallback,
      /** 追加的 CSS 类名 */
      className,
      /** 自定义行内样式 */
      style,
    } = props;

    // ============================================
    // DOM 引用
    // ============================================

    /** 图标容器 DOM 引用（span 元素） */
    const containerRef = useTemplateRef<HTMLSpanElement>(lifecycle, 'containerRef');

    // ============================================
    // 状态
    // ============================================

    /** lottie-web 模块引用，动态导入后赋值 */
    let lottieModule: LottiePlayer | null = null;

    /** 当前主动画实例 */
    let animationItem: AnimationItem | null = null;

    /** 悬停动画实例 */
    let hoverAnimationItem: AnimationItem | null = null;

    /** 是否处于切换状态（点击切换动画后为 true） */
    let isToggled = false;

    /** 是否处于回退模式（lottie 加载失败） */
    let isFallbackMode = false;

    // === 序列播放状态 ===

    /** 当前序列槽位索引 */
    let currentSlotIndex = 0;

    /** 序列中当前动画实例的 complete 回调引用 */
    let currentCompleteHandler: (() => void) | null = null;

    // ============================================
    // 动画创建
    // ============================================

    /**
     * 创建动画实例
     * lottie-web loadAnimation 参数为联合类型 AnimationConfigWithData | AnimationConfigWithPath
     * 二者互斥，需分别调用
     * @param data - 动画 JSON 数据
     * @param animPath - 动画 URL 路径
     * @param container - 容器元素
     * @param autoPlay - 是否自动播放
     * @param shouldLoop - 是否循环播放
     * @returns 动画实例或 null
     */
    const createAnimation = (
      data: Record<string, unknown> | undefined,
      animPath: string | undefined,
      container: HTMLElement,
      autoPlay: boolean,
      shouldLoop?: boolean,
    ): AnimationItem | null => {
      if (!lottieModule) return null;
      if (!data && !animPath) return null;

      // lottie-web loadAnimation 参数为联合类型：AnimationConfigWithData | AnimationConfigWithPath
      // 二者互斥，需分别调用
      if (data) {
        return lottieModule.loadAnimation({
          container,
          renderer,
          loop: shouldLoop ?? loop,
          autoplay: autoPlay,
          // lottie-web AnimationConfigWithData.animationData 定义为 any
          animationData: data,
        });
      }
      return lottieModule.loadAnimation({
        container,
        renderer,
        loop: shouldLoop ?? loop,
        autoplay: autoPlay,
        path: animPath,
      });
    };

    // ============================================
    // 序列播放
    // ============================================

    /**
     * 播放序列中的指定槽位
     * @param index - 槽位索引
     */
    const playSequenceSlot = (index: number): void => {
      if (!sequence || !lottieModule || !containerRef.value) return;
      if (index < 0 || index >= sequence.length) return;

      // 销毁当前动画
      destroyCurrentAnimation();

      currentSlotIndex = index;
      const slot = sequence[index];
      const shouldLoop = slot.complete === "loop" ? (slot.loop ?? true) : false;
      const slotAutoplay = slot.autoplay ?? autoplay;

      // 有 startFrame 时先以 autoplay=false 创建，再手动跳转，避免从第0帧闪一下
      animationItem = createAnimation(
        slot.animationData,
        slot.path,
        containerRef.value,
        slot.startFrame !== undefined ? false : slotAutoplay,
        shouldLoop,
      );
      if (animationItem) {
        animationItem.setDirection(direction);
        animationItem.setSpeed(speed);

        // 处理 startFrame：autoplay 时从该帧开始播放，否则停在该帧
        if (slot.startFrame !== undefined) {
          if (slotAutoplay) {
            animationItem.goToAndPlay(slot.startFrame, true);
          } else {
            animationItem.goToAndStop(slot.startFrame, true);
          }
        }

        // 监听完成事件
        if (slot.complete !== "loop") {
          currentCompleteHandler = (): void => {
            onSlotComplete(index);
          };
          animationItem.addEventListener("complete", currentCompleteHandler);
        }
      }
    };

    /**
     * 槽位播放完成回调
     * @param index - 完成的槽位索引
     */
    const onSlotComplete = (index: number): void => {
      if (!sequence) return;
      const slot = sequence[index];
      const action = slot.complete ?? "next";

      switch (action) {
        case "next": {
          // 最后一个槽位回到第一个，形成循环序列
          const nextIndex = (index + 1) % sequence.length;
          playSequenceSlot(nextIndex);
          break;
        }
        case "stop": {
          if (animationItem) {
            const targetFrame = slot.stopFrame ?? -1;
            if (slot.reverseToStopFrame && targetFrame >= 0) {
              // 反向播放到目标帧
              animationItem.setDirection(-1);
              animationItem.goToAndPlay(targetFrame, true);
            } else if (targetFrame >= 0) {
              animationItem.goToAndStop(targetFrame, true);
            }
            // stopFrame 为 undefined 时停在当前帧（最后一帧）
          }
          break;
        }
        case "loop":
          // loop 模式由 lottie-web 自身处理
          break;
      }
    };

    /**
     * 销毁当前动画实例
     */
    const destroyCurrentAnimation = (): void => {
      if (animationItem) {
        if (currentCompleteHandler) {
          animationItem.removeEventListener("complete", currentCompleteHandler);
          currentCompleteHandler = null;
        }
        animationItem.destroy();
        animationItem = null;
      }
    };

    // ============================================
    // 加载逻辑
    // ============================================

    /**
     * 动态导入 lottie-web 并初始化动画
     * 加载成功后创建主动画实例，失败时显示回退内容
     */
    const loadLottie = async (): Promise<void> => {
      if (!isBrowser()) return;
      try {
        const lottieMod: { default: LottiePlayer } = await import("lottie-web");
        lottieModule = lottieMod.default;

        if (!containerRef.value) return;

        // lottie 加载成功，清空回退内容后渲染动画
        containerRef.value.replaceChildren();

        // 序列模式
        if (sequence && sequence.length > 0) {
          playSequenceSlot(initialSlotIndex);
          // 通知父组件：动画实例已创建，可补同步业务状态对应的槽位
          onReady?.();
          return;
        }

        // 单动画模式
        animationItem = createAnimation(
          animationData,
          path,
          containerRef.value,
          autoplay,
        );
        if (animationItem) {
          animationItem.setDirection(direction);
          animationItem.setSpeed(speed);
        }
        // 通知父组件：动画实例已创建
        onReady?.();
      } catch {
        // lottie-web 加载失败，进入回退模式
        isFallbackMode = true;
        lifecycle.emit?.("loadError", name);
      }
    };

    // ============================================
    // 对外 API 方法
    // ============================================

    const api: LottieIconApi = {
      /** 播放主动画 */
      play: (): void => {
        if (sequence && sequence.length > 0) {
          animationItem?.goToAndPlay(
            sequence[currentSlotIndex].startFrame ?? 0,
            true,
          );
        } else {
          animationItem?.goToAndPlay(0);
        }
        // animationItem?.play()
      },

      /** 暂停主动画 */
      pause: (): void => {
        animationItem?.pause();
      },

      /** 停止主动画并重置到初始帧 */
      stop: (): void => {
        animationItem?.stop();
      },

      /** 切换到悬停态动画 */
      showHover: (): void => {
        if (isFallbackMode) return;
        if ((hoverData || hoverPath) && lottieModule && containerRef.value) {
          animationItem?.pause();
          hoverAnimationItem = createAnimation(
            hoverData,
            hoverPath,
            containerRef.value,
            true,
          );
          if (hoverAnimationItem) {
            hoverAnimationItem.setDirection(direction);
            hoverAnimationItem.setSpeed(speed);
          }
        }
      },

      /** 恢复到主态动画 */
      hideHover: (): void => {
        if (isFallbackMode) return;
        if (hoverAnimationItem) {
          hoverAnimationItem.destroy();
          hoverAnimationItem = null;
          animationItem?.play();
        }
      },

      /** 切换动画（toggleData 模式）或重新播放 */
      toggle: (): void => {
        if (isFallbackMode) return;

        // 序列模式：前进到下一个槽位
        if (sequence && sequence.length > 0) {
          const nextIndex = (currentSlotIndex + 1) % sequence.length;
          playSequenceSlot(nextIndex);
          return;
        }

        // 单动画 + 切换模式
        if (toggleData && lottieModule && containerRef.value) {
          isToggled = !isToggled;
          destroyCurrentAnimation();
          if (isToggled) {
            animationItem = createAnimation(
              toggleData,
              undefined,
              containerRef.value,
              true,
            );
          } else {
            animationItem = createAnimation(
              animationData,
              path,
              containerRef.value,
              true,
            );
          }
          if (animationItem) {
            animationItem.setDirection(direction);
            animationItem.setSpeed(speed);
          }
        } else {
          animationItem?.goToAndPlay(0, true);
        }
      },

      /** 序列模式：前进到下一个槽位 */
      advanceSlot: (): void => {
        if (!sequence) return;
        const nextIndex = (currentSlotIndex + 1) % sequence.length;
        playSequenceSlot(nextIndex);
      },

      setSequenceSlot: (index: number): void => {
        playSequenceSlot(index);
      },

      /** 获取当前序列槽位索引 */
      getCurrentSlotIndex: (): number => {
        return currentSlotIndex;
      },

      /** 销毁动画实例并释放资源 */
      destroy: (): void => {
        destroyCurrentAnimation();
        if (hoverAnimationItem) {
          hoverAnimationItem.destroy();
          hoverAnimationItem = null;
        }
        lottieModule = null;
        currentCompleteHandler = null;
      },
    };

    // ============================================
    // 生命周期钩子
    // ============================================
    lifecycle.expose?.(api);
    /**
     * 组件暴露 API 并动态加载 lottie-web
     */
    lifecycle.onMounted = (): void => {
      loadLottie();
    };

    /**
     * 组件销毁前，销毁所有动画实例并释放资源
     */
    lifecycle.onBeforeDestroy = (): void => {
      api.destroy();
    };

    // ============================================
    // 主渲染函数
    // ============================================

    /** 拼接类名：基础类 common-svg-icon 始终存在，className 追加 */
    const classStr = className
      ? `common-svg-icon ${className}`
      : "common-svg-icon";

    /** 回退子节点 */
    const children: VNode[] = [];

    // 回退内容（插槽式），lottie 成功后移除
    if (fallback && fallback.length > 0) {
      children.push(...fallback);
    }

    /** 构建 VNode 属性对象 */
    const attrs: Record<string, unknown> = {
      class: classStr,
      ref: 'containerRef',
      "data-name": name,
    };
    if (style) {
      attrs.style = style;
    }

    return h("span", attrs, ...children);
  },
);
