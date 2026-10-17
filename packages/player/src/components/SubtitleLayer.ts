/**
 * ============================================
 * 字幕容器组件 (SubtitleLayer)
 * ============================================
 * 字幕DOM容器在player侧，字幕逻辑实现在插件侧
 * 与弹幕(RowDm)和互动(InteractionLayer)采用相同的低耦合模式
 * 字幕插件将自身DOM注入到 .nova-player-subtitle-wrap 容器中
 *
 * 职责划分（唯一定位 owner 是 SubtitlePlugin）：
 * - 本组件：面板容器 + 字号/颜色 signal 样式（经 __reactiveAttrs 增量更新）
 * - SubtitlePlugin.applyPosition：档位（panel data-position 属性）/
 *   底部偏移（--subtitle-offset 变量）/ 拖拽（pointer 事件绑字幕文本
 *   元素，拖动改文本元素 inline 定位）——控制栏抬升与全屏适配由
 *   subtitlelayer.scss 以 .nova-player-container 属性选择器
 *   （data-ctrl-hidden / data-screen）纯 CSS 派生，无 JS 参与
 */

import { h, defineComponent, useTemplateRef, signal } from "@/core";
import type { ComponentLifecycle } from "@/types";

// ============================================
// 字幕位置类型
// ============================================

/** 字幕显示位置类型：顶部、居中、底部 */
export type SubtitlePosition = "top" | "center" | "bottom";

// ============================================
// SubtitleLayer 组件 Props 接口
// ============================================

/** 字幕容器组件属性接口 */
export interface SubtitleLayerProps {
  /** 是否显示字幕层 */
  visible?: boolean;
}

// ============================================
// SubtitleLayer 组件
// ============================================

/**
 * SubtitleLayer 组件 - 使用 defineComponent 创建独立组件
 * 提供字幕插件注入 DOM 的容器
 * 类名使用 'nova-player-subtitle-wrap'
 */
export const SubtitleLayer = defineComponent<SubtitleLayerProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // DOM 引用
    // ============================================

    /** 字幕容器 DOM 引用，字幕插件将内容注入到此容器 */
    const subtitleWrapRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "subtitleWrapRef",
    );

    // ============================================
    // 响应式状态（字号/颜色；
    // 初值 null 表示未设置，与原实现初始不写对应内联样式一致）
    // ============================================

    /** 字幕字体大小（px），null 表示未设置 */
    const fontSizeSig = signal<number | null>(null);

    /** 字幕文字颜色，null 表示未设置 */
    const colorSig = signal<string | null>(null);

    /** 字幕背景颜色，null 表示未设置 */
    const backgroundColorSig = signal<string | null>(null);

    // ============================================
    // 样式控制方法（对外 API——内部仅写 signal）
    // ============================================

    /**
     * 设置字幕字体大小
     * @param size - 字体大小（px）
     */
    const setFontSize = (size: number): void => {
      fontSizeSig.value = size;
    };

    /**
     * 设置字幕文字颜色
     * @param color - CSS 颜色值
     */
    const setColor = (color: string): void => {
      colorSig.value = color;
    };

    /**
     * 设置字幕背景颜色
     * @param color - CSS 颜色值
     */
    const setBackgroundColor = (color: string): void => {
      backgroundColorSig.value = color;
    };

    /**
     * 设置字幕位置档位：委托插件侧（唯一定位 owner）——
     * 经事件总线转发到 SubtitlePlugin（其 applyPosition 写
     * panel data-position 属性），本组件不写定位样式
     * @param position - 字幕位置（top / center / bottom）
     */
    const setPosition = (position: SubtitlePosition): void => {
      lifecycle.emit?.("subtitlePositionChange", position);
    };

    // ============================================
    // 生命周期
    // ============================================

    /** 组件挂载后对外暴露字幕容器引用和样式控制方法 */
    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("subtitleLayerMounted", {
        subtitleWrap: subtitleWrapRef.value,
        setFontSize,
        setColor,
        setBackgroundColor,
        setPosition,
      });
    };

    /** 组件销毁前清理字幕容器内的所有子节点 */
    lifecycle.onBeforeDestroy = (): void => {
      // 容器子树由字幕插件注入并所有，命令式清空（非本组件渲染数据）
      if (subtitleWrapRef.value) {
        while (subtitleWrapRef.value.firstChild) {
          subtitleWrapRef.value.removeChild(subtitleWrapRef.value.firstChild);
        }
      }
    };

    // ============================================
    // 渲染输出
    // ============================================

    /**
     * 派生面板样式（仅字号/颜色；定位由插件侧 data-position 属性
     * + CSS 变量驱动，见 subtitlelayer.scss）
     */
    const buildStyle = (): Record<string, string> => {
      const style: Record<string, string> = {
        display: props.visible === false ? "none" : "",
      };
      const fontSize = fontSizeSig.value;
      if (fontSize !== null) style.fontSize = `${fontSize}px`;
      const color = colorSig.value;
      if (color !== null) style.color = color;
      const backgroundColor = backgroundColorSig.value;
      if (backgroundColor !== null) style.backgroundColor = backgroundColor;
      return style;
    };

    return h(
      "div",
      {
        class: "nova-player-subtitle-wrap",
        ref: "subtitleWrapRef",
      },
      h("div", {
        class: "nova-subtitle-x-subtitle-panel",
        style: buildStyle(),
      }),
    );
  },
);

export default SubtitleLayer;
