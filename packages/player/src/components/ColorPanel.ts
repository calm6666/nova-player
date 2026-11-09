/**
 * ============================================
 * 色彩调整面板组件 (ColorPanel)
 * ============================================
 * 行为：三条滑杆（饱和度 / 亮度 / 对比度，0-200，默认 100）拖动时通过
 * 回调通知上层，由上层将 CSS filter 写入 .nova-player-video 元素；重置恢复默认。
 */

import { h, defineComponent, useTemplateRef, t, signal } from '@lumina/framework/core';
import type { Signal } from "@lumina/framework/core";
import { isBrowser } from '@lumina/framework/utils';
import type { ComponentLifecycle } from "@lumina/framework/types";
import type { VNode } from "@lumina/framework/types";

/** 滑杆数值上限 */
const SLIDER_MAX = 200;

/** 滑杆默认值（对应滤镜 100%，即不做调整） */
const SLIDER_DEFAULT = 100;

/** 滑杆轨道的可用像素宽度（与既有实现的 translateX 换算一致） */
const TRACK_WIDTH = 268;

/**
 * 色彩调整面板组件 Props 接口
 */
export interface ColorPanelProps {
  /** 关闭面板的回调函数 */
  onClose?: () => void;
  /** 饱和度变化时的回调函数（0-200） */
  onSaturateChange?: (value: number) => void;
  /** 亮度变化时的回调函数（0-200） */
  onBrightnessChange?: (value: number) => void;
  /** 对比度变化时的回调函数（0-200） */
  onContrastChange?: (value: number) => void;
  /** 重置色彩参数的回调函数 */
  onReset?: () => void;
}

/**
 * 色彩调整面板对外暴露的 API
 */
export interface ColorPanelApi {
  /** 打开面板 */
  open: () => void;
  /** 关闭面板 */
  close: () => void;
  /** 设置饱和度（0-200） */
  setSaturate: (value: number) => void;
  /** 设置亮度（0-200） */
  setBrightness: (value: number) => void;
  /** 设置对比度（0-200） */
  setContrast: (value: number) => void;
  /** 重置为默认值 */
  reset: () => void;
}

/** 关闭图标（与既有实现的 Close 图标一致） */
const CloseIcon = (): VNode =>
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
  );

/** 单条滑杆的 DOM 引用集合 */
interface SliderRefs {
  bar: Signal<HTMLDivElement | null>;
  thumb: Signal<HTMLDivElement | null>;
  value: Signal<HTMLDivElement | null>;
  root: Signal<HTMLDivElement | null>;
}

/**
 * 色彩调整面板组件
 */
export const ColorPanel = defineComponent<ColorPanelProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 状态数据
    // ============================================

    /** 当前饱和度值（0-200） */
    let saturate = SLIDER_DEFAULT;

    /** 当前亮度值（0-200） */
    let brightness = SLIDER_DEFAULT;

    /** 当前对比度值（0-200） */
    let contrast = SLIDER_DEFAULT;

    // ============================================
    // DOM 引用
    // ============================================

    /** 饱和度滑杆 DOM 引用集合 */
    const saturateRefs: SliderRefs = {
      bar: useTemplateRef<HTMLDivElement>(lifecycle, "saturateBarRef"),
      thumb: useTemplateRef<HTMLDivElement>(lifecycle, "saturateThumbRef"),
      value: useTemplateRef<HTMLDivElement>(lifecycle, "saturateValueRef"),
      root: useTemplateRef<HTMLDivElement>(lifecycle, "saturateSliderRef"),
    };

    /** 亮度滑杆 DOM 引用集合 */
    const brightnessRefs: SliderRefs = {
      bar: useTemplateRef<HTMLDivElement>(lifecycle, "brightnessBarRef"),
      thumb: useTemplateRef<HTMLDivElement>(lifecycle, "brightnessThumbRef"),
      value: useTemplateRef<HTMLDivElement>(lifecycle, "brightnessValueRef"),
      root: useTemplateRef<HTMLDivElement>(lifecycle, "brightnessSliderRef"),
    };

    /** 对比度滑杆 DOM 引用集合 */
    const contrastRefs: SliderRefs = {
      bar: useTemplateRef<HTMLDivElement>(lifecycle, "contrastBarRef"),
      thumb: useTemplateRef<HTMLDivElement>(lifecycle, "contrastThumbRef"),
      value: useTemplateRef<HTMLDivElement>(lifecycle, "contrastValueRef"),
      root: useTemplateRef<HTMLDivElement>(lifecycle, "contrastSliderRef"),
    };

    // ============================================
    // DOM 更新方法
    // ============================================

    /**
     * 将滑杆数值限制在有效区间内
     * @param value - 原始数值
     * @returns 限制后的数值（0-200）
     */
    const clampValue = (value: number): number =>
      Math.min(SLIDER_MAX, Math.max(0, Math.round(value)));

    /**
     * 更新单条滑杆的 UI（进度条缩放、手柄位置、数值文本）
     * @param refs - 滑杆 DOM 引用集合
     * @param value - 当前数值
     */
    const updateSliderUI = (refs: SliderRefs, value: number): void => {
      /** 进度比例（0-1） */
      const progress = value / SLIDER_MAX;
      if (refs.bar.value) {
        refs.bar.value.style.transform = `scaleX(${progress})`;
      }
      if (refs.thumb.value) {
        refs.thumb.value.style.transform = `translateX(${progress * TRACK_WIDTH}px)`;
      }
      if (refs.value.value) {
        refs.value.value.innerText = String(value);
      }
    };

    /**
     * 设置饱和度并更新滑杆 UI
     * @param value - 新的饱和度值（0-200）
     */
    const setSaturate = (value: number): void => {
      saturate = clampValue(value);
      updateSliderUI(saturateRefs, saturate);
    };

    /**
     * 设置亮度并更新滑杆 UI
     * @param value - 新的亮度值（0-200）
     */
    const setBrightness = (value: number): void => {
      brightness = clampValue(value);
      updateSliderUI(brightnessRefs, brightness);
    };

    /**
     * 设置对比度并更新滑杆 UI
     * @param value - 新的对比度值（0-200）
     */
    const setContrast = (value: number): void => {
      contrast = clampValue(value);
      updateSliderUI(contrastRefs, contrast);
    };

    /** 重置三条滑杆为默认值并通知上层 */
    const reset = (): void => {
      setSaturate(SLIDER_DEFAULT);
      setBrightness(SLIDER_DEFAULT);
      setContrast(SLIDER_DEFAULT);
      props.onSaturateChange?.(saturate);
      props.onBrightnessChange?.(brightness);
      props.onContrastChange?.(contrast);
      props.onReset?.();
    };

    // ============================================
    // 滑杆拖拽
    // ============================================

    /**
     * 根据鼠标位置计算滑杆数值
     * @param root - 滑杆根元素
     * @param clientX - 鼠标 X 坐标
     * @returns 滑杆数值（0-200）
     */
    const valueFromEvent = (
      root: HTMLDivElement | null,
      clientX: number,
    ): number => {
      if (!root) return SLIDER_DEFAULT;
      /** 滑杆轨道边界矩形 */
      const rect = root.getBoundingClientRect();
      if (rect.width <= 0) return SLIDER_DEFAULT;
      /** 鼠标位置比例（0-1） */
      const ratio = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width),
      );
      return Math.round(ratio * SLIDER_MAX);
    };

    /**
     * 为单条滑杆绑定拖拽事件（document 级 mousemove / mouseup）
     * @param refs - 滑杆 DOM 引用集合
     * @param apply - 数值变化时的应用函数（更新 UI + 通知上层）
     */
    const bindSliderDrag = (
      refs: SliderRefs,
      apply: (value: number) => void,
    ): void => {
      if (!refs.root.value) return;
      refs.root.value.addEventListener("mousedown", (event: MouseEvent) => {
        event.preventDefault();
        apply(valueFromEvent(refs.root.value, event.clientX));
        /** 拖拽过程中的鼠标移动处理 */
        const onMouseMove = (e: MouseEvent): void => {
          apply(valueFromEvent(refs.root.value, e.clientX));
        };
        /** 拖拽结束时的鼠标释放处理 */
        const onMouseUp = (): void => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    };

    // ============================================
    // 显隐控制（nova-player-panel-active 类机制，与既有实现一致）
    // ============================================

    /**
     * 响应式信号：面板可见性
     * 替代旧的 panelRef.classList.add/remove('nova-player-panel-active')
     * 信号在根节点 class 数组+对象形式中被读取，编译期提取到 __reactiveAttrs，
     * mount 时注册 effect，信号变化时自动 normalizeClass 重新应用
     */
    const visibleSignal = signal<boolean>(false);

    /**
     * 显示面板：更新信号（响应式系统自动同步根节点 nova-player-panel-active 类）
     */
    const open = (): void => {
      visibleSignal.value = true;
    };

    /**
     * 隐藏面板：更新信号（响应式系统自动同步根节点 nova-player-panel-active 类）
     */
    const close = (): void => {
      visibleSignal.value = false;
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    /**
     * 组件挂载后：绑定三条滑杆的拖拽事件，并通过事件向外暴露控制方法
     */
    lifecycle.onMounted = (): void => {
      if (isBrowser()) {
        bindSliderDrag(saturateRefs, (value) => {
          setSaturate(value);
          props.onSaturateChange?.(value);
        });
        bindSliderDrag(brightnessRefs, (value) => {
          setBrightness(value);
          props.onBrightnessChange?.(value);
        });
        bindSliderDrag(contrastRefs, (value) => {
          setContrast(value);
          props.onContrastChange?.(value);
        });
      }
      lifecycle.emit?.("colorPanelMounted", {
        open,
        close,
        setSaturate,
        setBrightness,
        setContrast,
        reset,
      } satisfies ColorPanelApi);
    };

    /**
     * 渲染单条滑杆
     * @param value - 当前数值
     * @param refs - 滑杆 DOM 引用集合
     * @returns 滑杆虚拟节点
     */
    const renderSlider = (value: number, refs: SliderRefs): VNode =>
      h(
        "div",
        {
          class: "nova-player-color-panel-slider ui ui-slider ui-dark",
          ref: refs.root,
        },
        h(
          "div",
          { class: "ui-area" },
          h(
            "div",
            { class: "ui-track" },
            h(
              "div",
              { class: "ui-bar-wrap" },
              h("div", {
                class: "ui-bar ui-bar-normal",
                role: "progressbar",
                style: { transform: `scaleX(${value / SLIDER_MAX})` },
                ref: refs.bar,
              }),
            ),
            h(
              "div",
              {
                class: "ui-thumb",
                style: {
                  transform: `translateX(${(value / SLIDER_MAX) * TRACK_WIDTH}px)`,
                },
                ref: refs.thumb,
              },
              h("div", { class: "ui-thumb-dot" }),
            ),
          ),
        ),
      );

    // ============================================
    // 组件渲染（DOM 结构与既有实现一致）
    // ============================================

    return h(
      "div",
      {
        // 响应式 class：编译期将含 signal.value 的数组提取到 __reactiveAttrs，
        // mount 时注册 effect，visibleSignal 变化时自动 normalizeClass 重新应用
        class: [
          "nova-player-color-panel",
          { "nova-player-panel-active": visibleSignal.value },
        ],
      },
      h(
        "div",
        { class: "nova-player-color-panel-title" },
        "色彩调整",
        h(
          "span",
          {
            class: "nova-player-color-panel-close",
            onClick: () => {
              close();
              props.onClose?.();
            },
          },
          h("span", { class: "common-svg-icon" }, CloseIcon()),
        ),
      ),
      h(
        "div",
        { class: "nova-player-color-panel-saturate nova-player-color-wrap" },
        h(
          "div",
          { class: "nova-player-color-panel-name" },
          t("player.ui.colorpanel.saturation"),
        ),
        renderSlider(saturate, saturateRefs),
        h(
          "div",
          { class: "nova-player-color-panel-value", ref: "saturateValueRef" },
          String(saturate),
        ),
      ),
      h(
        "div",
        { class: "nova-player-color-panel-brightness nova-player-color-wrap" },
        h(
          "div",
          { class: "nova-player-color-panel-name" },
          t("player.ui.colorpanel.brightness"),
        ),
        renderSlider(brightness, brightnessRefs),
        h(
          "div",
          { class: "nova-player-color-panel-value", ref: "brightnessValueRef" },
          String(brightness),
        ),
      ),
      h(
        "div",
        { class: "nova-player-color-panel-contrast nova-player-color-wrap" },
        h(
          "div",
          { class: "nova-player-color-panel-name" },
          t("player.ui.colorpanel.contrast"),
        ),
        renderSlider(contrast, contrastRefs),
        h(
          "div",
          { class: "nova-player-color-panel-value", ref: "contrastValueRef" },
          String(contrast),
        ),
      ),
      h(
        "div",
        { class: "nova-player-color-panel-reset" },
        h(
          "span",
          { class: "nova-player-color-panel-btn ui ui-button", onClick: reset },
          h(
            "div",
            { class: "ui-area ui-button-black" },
            t("player.ui.colorpanel.reset"),
          ),
        ),
      ),
    );
  },
);
