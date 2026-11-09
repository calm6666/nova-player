/**
 * ============================================
 * 弹幕类型选择面板组件 (Selection)
 * ============================================
 */

import { h, defineComponent, useTemplateRef, useContext, t, signal } from '@lumina/framework/core';
import type { ComponentLifecycle } from "@lumina/framework/types";
import type { VNode } from "@lumina/framework/types";
import type { TypedStateManager } from "@lumina/framework/core/state";
import { StateContext, PlayerStateKeyEnum, type PlayerStateMap } from "../store/runtimeState";

/**
 * 弹幕模式类型
 * 1: 滚动弹幕, 4: 底部弹幕, 5: 顶部弹幕（与既有实现的 data-value 一致）
 */
export type DanmakuMode = 1 | 4 | 5;

/**
 * 弹幕字号类型
 * small: 小字号, normal: 标准字号
 */
export type DanmakuSize = "small" | "normal";

/** 字号档位到状态值的映射（与既有实现「小 / 标准」两档一致） */
const SIZE_VALUE_MAP: Record<DanmakuSize, number> = {
  small: 0,
  normal: 50,
};

/**
 * Selection 组件 Props 接口
 */
export interface SelectionProps {
  /** 初始弹幕颜色值 */
  initialColor?: string;
  /** 初始弹幕模式 */
  initialMode?: DanmakuMode;
  /** 初始弹幕字号 */
  initialSize?: DanmakuSize;
  /** 弹幕颜色变化时的回调函数 */
  onColorChange?: (color: string) => void;
  /** 弹幕模式变化时的回调函数 */
  onModeChange?: (mode: DanmakuMode) => void;
  /** 弹幕字号变化时的回调函数 */
  onSizeChange?: (size: DanmakuSize) => void;
}

/**
 * 预设弹幕颜色列表（与既有实现一致）
 */
const COLOR_LIST: string[] = [
  "#FE0302",
  "#FF7204",
  "#FFAA02",
  "#FFD302",
  "#FFFF00",
  "#A0EE00",
  "#00CD00",
  "#019899",
  "#4266BE",
  "#89D5FF",
  "#CC0273",
  "#222222",
  "#9B9B9B",
  "#FFFFFF",
];

/**
 * 弹幕类型选择面板组件
 */
export const Selection = defineComponent<SelectionProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 状态管理器（通过 Context 获取）
    // ============================================

    /** 运行时状态管理器，设置项变化时写入 */
    const stateMgr = useContext<TypedStateManager<PlayerStateMap> | null>(
      StateContext,
    );

    // ============================================
    // 状态数据（响应式信号：驱动按钮 class 与色块 style 自动更新）
    // ============================================

    /**
     * 当前选中的弹幕模式信号
     * 替代旧的 let currentMode + modeButtonRefs.forEach + classList.toggle('active', ...)
     * 信号在各按钮 class 数组+对象形式中被读取，编译期提取到 __reactiveAttrs，
     * mount 时注册 effect，信号变化时自动 normalizeClass 重新应用
     */
    const currentModeSignal = signal<DanmakuMode>(props.initialMode || 1);

    /**
     * 当前选中的弹幕字号信号
     * 替代旧的 let currentSize + sizeSmallRef/sizeNormalRef.classList.toggle('active', ...)
     * 同样由按钮 class 数组+对象形式自动追踪
     */
    const currentSizeSignal = signal<DanmakuSize>(
      props.initialSize || "normal",
    );

    /**
     * 当前选中的弹幕颜色信号
     * 替代旧的 let currentColor + colorBoxRef.style.background = color 命令式操作
     * 信号在色块 style 对象形式中被读取，编译期提取到 __reactiveAttrs，
     * mount 时注册 effect，信号变化时自动 normalizeStyle 增量更新
     * 同时驱动各色板的 color-picker-option-active 类自动互斥
     */
    const currentColorSignal = signal<string>(props.initialColor || "#FFFFFF");

    // ============================================
    // DOM 元素引用
    // ============================================

    /**
     * 颜色输入框元素引用
     * 用于同步 input.value 表单属性（非样式：setAttribute('value') 不会更新运行时值）
     */
    const inputRef = useTemplateRef<HTMLInputElement>(lifecycle, "inputRef");

    // ============================================
    // 状态写入
    // ============================================

    /**
     * 将当前颜色写入运行时状态
     * @param color - 颜色值
     */
    const writeColorState = (color: string): void => {
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_COLOR, color);
    };

    /**
     * 将当前模式写入运行时状态
     * @param mode - 弹幕模式
     */
    const writeModeState = (mode: DanmakuMode): void => {
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_MODE, mode);
    };

    /**
     * 将当前字号写入运行时状态
     * @param size - 弹幕字号档位
     */
    const writeSizeState = (size: DanmakuSize): void => {
      stateMgr?.set(PlayerStateKeyEnum.DANMAKU_FONT_SIZE, SIZE_VALUE_MAP[size]);
    };

    // ============================================
    // 事件处理
    // ============================================

    /**
     * 处理颜色选择事件（色板点击）
     *
     * 响应式：currentColorSignal 变化后，色块 style 与各色板的 active 类
     * 由 __reactiveAttrs effect 自动同步，无需 querySelectorAll + classList
     *
     * @param _element - 被点击的色板元素（保留参数签名，响应式后未使用）
     * @param color - 选中的颜色值
     */
    const selectColor = (_element: HTMLElement, color: string): void => {
      if (inputRef.value) {
        // input.value 是表单元素属性，setAttribute('value') 不会更新运行时值，保留命令式
        inputRef.value.value = color;
      }
      currentColorSignal.value = color;
      writeColorState(color);
      props.onColorChange?.(color);
      lifecycle.emit?.("colorChange", color);
    };

    /**
     * 处理颜色输入框输入事件
     * 保证输入是以 "#" 开始的合法颜色值（与既有实现 handleInput 一致），
     * 输入有效时通过信号同步预览方块颜色（响应式）并写入状态。
     * @param event - 输入事件
     */
    const handleInput = (event: Event): void => {
      if (!(event.target instanceof HTMLInputElement)) return;
      /** 输入框当前值 */
      const value = event.target.value;
      if (inputRef.value) {
        if (!value.startsWith("#")) {
          // 更新值，但不触发 input 事件，避免无限循环（与既有实现一致）
          inputRef.value.value = `#${value}`;
        }
        if (value.length >= 4) {
          // 信号变化后色块 style effect 自动同步 background
          currentColorSignal.value = value;
          writeColorState(value);
          props.onColorChange?.(value);
        }
      }
    };

    /**
     * 处理弹幕模式选择事件
     *
     * 响应式：currentModeSignal 变化后，各模式按钮的 active 类由 __reactiveAttrs
     * effect 自动互斥，无需 modeButtonRefs.forEach + classList.toggle
     *
     * @param _index - 选项索引（保留参数签名，响应式后未使用）
     * @param mode - 选中的弹幕模式
     */
    const handleModeSelect = (_index: number, mode: DanmakuMode): void => {
      currentModeSignal.value = mode;
      writeModeState(mode);
      props.onModeChange?.(mode);
      lifecycle.emit?.("modeChange", mode);
    };

    /**
     * 处理弹幕字号选择事件
     *
     * 响应式：currentSizeSignal 变化后，字号按钮的 active 类由 __reactiveAttrs
     * effect 自动同步，无需 sizeSmallRef/sizeNormalRef.classList.toggle
     *
     * @param size - 选中的弹幕字号档位
     */
    const handleSizeSelect = (size: DanmakuSize): void => {
      currentSizeSignal.value = size;
      writeSizeState(size);
      props.onSizeChange?.(size);
      lifecycle.emit?.("sizeChange", size);
    };

    // ============================================
    // DOM 更新方法（对外 API）
    // ============================================

    /**
     * 外部设置弹幕颜色
     * 信号变化后色块 style 与色板 active 类自动同步，无需手动设置 colorBox.style
     * @param color - 颜色值
     */
    const setColor = (color: string): void => {
      if (inputRef.value) {
        // input.value 是表单元素属性，保留命令式
        inputRef.value.value = color;
      }
      currentColorSignal.value = color;
      writeColorState(color);
    };

    /**
     * 外部设置弹幕模式
     * @param mode - 弹幕模式
     */
    const setMode = (mode: DanmakuMode): void => {
      /** 模式选项列表的渲染顺序：滚动 / 顶部 / 底部 */
      const modeOrder: DanmakuMode[] = [1, 5, 4];
      const index = modeOrder.indexOf(mode);
      if (index >= 0) {
        handleModeSelect(index, mode);
      }
    };

    /**
     * 外部设置弹幕字号
     * @param size - 弹幕字号档位
     */
    const setSize = (size: DanmakuSize): void => {
      handleSizeSelect(size);
    };

    // ============================================
    // 渲染函数
    // ============================================

    /**
     * 渲染字号选择行
     *
     * 按钮 class 用数组+对象形式，含 currentSizeSignal.value，
     * 编译期提取到 __reactiveAttrs，mount 时注册 effect，
     * 信号变化时自动 normalizeClass 重新应用 active 类
     *
     * @returns 字号选择虚拟节点
     */
    const renderSizeSelection = (): VNode =>
      h(
        "div",
        { class: "nova-player-mode-selection-row fontsize" },
        h("div", { class: "row-title" }, t("player.ui.selection.font_size")),
        h(
          "div",
          { class: "row-selection" },
          h(
            "div",
            { class: "hui-radio-wrap-button" },
            h(
              "div",
              {
                class: [
                  "radio-button",
                  { active: currentSizeSignal.value === "small" },
                ],
                onClick: () => handleSizeSelect("small"),
              },
              h("span", {}, t("player.ui.selection.small")),
            ),
            h(
              "div",
              {
                class: [
                  "radio-button",
                  { active: currentSizeSignal.value === "normal" },
                ],
                onClick: () => handleSizeSelect("normal"),
              },
              h("span", {}, t("player.ui.selection.standard")),
            ),
          ),
        ),
      );

    /**
     * 渲染模式选择行
     *
     * 按钮 class 用数组+对象形式，含 currentModeSignal.value === mode.value，
     * 编译期提取到 __reactiveAttrs，mount 时注册 effect，
     * 信号变化时自动 normalizeClass 重新应用 active 类（互斥）
     *
     * @returns 模式选择虚拟节点
     */
    const renderModeSelection = (): VNode => {
      /** 弹幕模式选项列表，包含模式值、显示标签和图标路径（与既有实现一致） */
      const modes: { value: DanmakuMode; label: string; icon: string }[] = [
        {
          value: 1,
          label: "player.ui.selection.scroll",
          icon: "M23 3H5a4 4 0 0 0-4 4v14a4 4 0 0 0 4 4h18a4 4 0 0 0 4-4V7a4 4 0 0 0-4-4zM11 9h6a1 1 0 0 1 0 2h-6a1 1 0 0 1 0-2zm-3 2H6V9h2v2zm4 4h-2v-2h2v2zm9 0h-6a1 1 0 0 1 0-2h6a1 1 0 0 1 0 2z",
        },
        {
          value: 5,
          label: "player.ui.selection.top",
          icon: "M23 3H5a4 4 0 0 0-4 4v14a4 4 0 0 0 4 4h18a4 4 0 0 0 4-4V7a4 4 0 0 0-4-4zM9 9H7V7h2v2zm4 0h-2V7h2v2zm4 0h-2V7h2v2zm4 0h-2V7h2v2z",
        },
        {
          value: 4,
          label: "player.ui.selection.bottom",
          icon: "M23 3H5a4 4 0 0 0-4 4v14a4 4 0 0 0 4 4h18a4 4 0 0 0 4-4V7a4 4 0 0 0-4-4zM9 21H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z",
        },
      ];

      return h(
        "div",
        { class: "nova-player-mode-selection-row mode" },
        h("div", { class: "row-title" }, t("player.ui.selection.mode")),
        h(
          "div",
          { class: "row-selection" },
          ...modes.map((mode, index) =>
            h(
              "div",
              {
                class: [
                  "selection-span js-action",
                  { active: currentModeSignal.value === mode.value },
                ],
                "data-type": "mode",
                "data-value": mode.value.toString(),
                name: "mode_selector",
                onClick: () => handleModeSelect(index, mode.value),
              },
              h(
                "span",
                { class: "selection-icon", name: "mode_selector" },
                h(
                  "svg",
                  {
                    xmlns: "http://www.w3.org/2000/svg",
                    "xml:space": "preserve",
                    "data-pointer": "none",
                    style: "enable-background:new 0 0 28 28",
                    viewBox: "0 0 28 28",
                  },
                  h("path", { d: mode.icon }),
                ),
              ),
              h(
                "span",
                { class: "selection-name", name: "mode_selector" },
                t(mode.label),
              ),
            ),
          ),
        ),
      );
    };

    /**
     * 渲染颜色选择行
     *
     * 色块 style 用对象形式含 currentColorSignal.value，编译期提取到 __reactiveAttrs，
     * mount 时注册 effect，信号变化时自动 normalizeStyle 增量更新 background。
     * 各色板 class 用数组+对象形式含 currentColorSignal.value === color 判断，
     * 信号变化时所有色板 active 类自动互斥（无需 querySelectorAll）。
     *
     * @returns 颜色选择虚拟节点
     */
    const renderColorSelection = (): VNode =>
      h(
        "div",
        { class: "nova-player-mode-selection-row color" },
        h("div", { class: "row-title" }, t("player.ui.selection.color")),
        h(
          "div",
          { class: "row-selection" },
          h(
            "div",
            { class: "color-input-warp" },
            h("input", {
              type: "text",
              ref: "inputRef",
              onInput: handleInput,
            }),
            // 色块 style 用对象形式，含 currentColorSignal.value，编译期提取到 __reactiveAttrs
            h("div", {
              class: "color-input-box",
              style: { background: currentColorSignal.value },
            }),
          ),
        ),
        h(
          "ul",
          { class: "color-picker-options" },
          ...COLOR_LIST.map((color) =>
            h("li", {
              class: [
                "color-picker-option",
                {
                  "color-picker-option-active":
                    currentColorSignal.value === color,
                },
              ],
              style: { background: color },
              onClick: (event: MouseEvent) => {
                if (event.currentTarget instanceof HTMLElement) {
                  selectColor(event.currentTarget, color);
                }
              },
            }),
          ),
        ),
      );

    // ============================================
    // 生命周期钩子
    // ============================================

    /**
     * 组件挂载后：初始化输入框值（表单属性，需命令式），
     * 同步初始设置到运行时状态，并向外暴露设置方法
     *
     * 色块 background 与色板 active 类已由响应式 class/style（__reactiveAttrs）
     * 在 mount 时自动应用首帧值，无需手动设置 colorBoxRef.style / classList
     */
    lifecycle.onMounted = (): void => {
      if (inputRef.value) {
        // input.value 是表单元素属性，setAttribute('value') 不会更新运行时值，保留命令式
        inputRef.value.value = currentColorSignal.value;
      }
      writeColorState(currentColorSignal.value);
      writeModeState(currentModeSignal.value);
      writeSizeState(currentSizeSignal.value);
      lifecycle.emit?.("selectionMounted", { setColor, setMode, setSize });
    };

    // ============================================
    // 组件渲染（DOM 结构与既有实现一致）
    // ============================================

    return h(
      "div",
      { class: "nova-player-mode-selection-panel" },
      renderSizeSelection(),
      renderModeSelection(),
      renderColorSelection(),
    );
  },
);
