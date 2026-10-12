/**
 * ============================================
 * 滑块组件
 * ============================================
 * 声明式响应式版本：
 * - 滑块值由内部 valueSignal 驱动：进度条宽度为响应式 style 派生，
 *   数值文本为显式 getter 协议（编译器自动包装为 _reactiveText）
 * - 拖拽 / 点击写信号即可，preact signals 批量调度自动合并逐帧高频写，
 *   删除旧的 updateProgressBar 逐次命令式 DOM 更新
 * - progressRef 仅用于拖拽几何量测（getBoundingClientRect），
 *   属命令式读取场景，保留 DOM 引用
 */

import { h, defineComponent, signal, useTemplateRef } from '@/core';
import type { VNode, ComponentLifecycle } from '@/types';
import { isBrowser } from '@/utils';

/**
 * 标记点接口
 */
export interface SliderMark {
  /** 位置值 (0-100) */
  value: number;
  /** 显示名称 */
  name: string;
}

/**
 * 滑块组件 Props 接口
 */
export interface SliderProps {
  /** 滑块宽度，支持字符串或数字（像素） */
  width?: string | number;
  /** 当前值 (0-100) */
  value?: number;
  /** 标记点数组 */
  marks?: SliderMark[] | null;
  /** 步长，用于离散调整滑块值 */
  step?: number;
  /** 值变化回调 */
  onChange?: (value: number) => void;
  /** 拖动开始回调 */
  onDragStart?: () => void;
  /** 拖动结束回调 */
  onDragEnd?: () => void;
}

/**
 * 滑块组件
 */
export const Slider = defineComponent<SliderProps>((props, lifecycle: ComponentLifecycle) => {
  /** 滑块宽度，默认 100% */
  const width = props.width ?? '100%';

  /** 步长，默认为 1 表示连续调整 */
  const step = props.step ?? 1;

  /**
   * 是否为离散步长模式：带 dot 档位（marks）或显式 step 均视为离散
   * 离散模式下拖动与点击统一走「绝对定位 + 档位吸附」：
   * dot 直接跳到鼠标位置对应的最近档位，步长即相邻档位间距；
   * 连续模式（无 marks 且 step 为 1）保持增量拖拽，dot 跟随鼠标移动量
   */
  const isDiscrete =
    (props.marks !== null && props.marks !== undefined && props.marks.length > 0) ||
    step !== 1;

  /**
   * 响应式信号：当前滑块值 (0-100)
   * 驱动进度条宽度（响应式 style）与数值文本（_reactiveText），
   * 替代旧的 currentValue 变量 + updateProgressBar 命令式 DOM 更新
   */
  const valueSignal = signal<number>(props.value ?? 0);

  /** 拖动开始时的 X 坐标 */
  let startX = 0;

  /** 是否正在拖动 */
  let isDragging = false;

  /** 进度条容器元素引用（仅用于拖拽几何量测，属命令式读取场景） */
  const progressRef = useTemplateRef<HTMLDivElement>(lifecycle, 'progressRef');

  /**
   * 获取显示值，优先从标记点中查找名称，否则返回百分比字符串
   * 读取 valueSignal.value，在 _reactiveText 中调用时自动建立依赖
   */
  const getDisplayValue = (): string => {
    if (props.marks) {
      const mark = props.marks.find((m: SliderMark) => m.value === valueSignal.value);
      if (mark) {
        return mark.name;
      }
    }
    return `${Math.floor(valueSignal.value)}%`;
  };

  /**
   * 根据鼠标位置计算滑块值
   */
  const calculateValueFromPosition = (clientX: number): number => {
    if (!progressRef.value) {
      return valueSignal.value;
    }

    /** 进度条容器的边界矩形 */
    const rect = progressRef.value.getBoundingClientRect();
    /** 鼠标位置对应的百分比 */
    const percentage = Math.min(
      Math.max(0, ((clientX - rect.left) / rect.width) * 100),
      100
    );

    // 带 dot 档位（marks）的滑块：吸附到最近档位 —— dot 才是离散步长的
    // 事实来源（如区域/速度滑块 5 档，相邻档位间距 25），拖动/点击只落
    // 在档位值上；此前仅按 step 小步吸附，会在档位之间出现大量中间值，
    // 观感即「带 dot 却一步一步走」
    if (props.marks && props.marks.length > 0) {
      let nearest = props.marks[0].value;
      let minDist = Math.abs(percentage - nearest);
      for (const mark of props.marks) {
        const dist = Math.abs(percentage - mark.value);
        if (dist < minDist) {
          minDist = dist;
          nearest = mark.value;
        }
      }
      return nearest;
    }

    if (step !== 1) {
      return Math.min(
        Math.max(0, Math.round(percentage / step) * step),
        100
      );
    }

    return percentage;
  };

  /**
   * 处理进度条容器点击，直接跳转到点击位置
   * 响应式：写信号即可，进度条宽度 / 数值文本由响应式系统自动同步
   */
  const handleProgressClick = (event: MouseEvent): void => {
    valueSignal.value = calculateValueFromPosition(event.clientX);
    props.onChange?.(valueSignal.value);
  };

  /**
   * 处理滑块点鼠标按下，开始拖动
   */
  const handleDotMouseDown = (event: MouseEvent): void => {
    if (!isBrowser()) return;
    isDragging = true;

    // 增量拖拽（连续模式）才需要记录起点 X；离散模式拖动直接绝对定位吸附
    if (!isDiscrete) {
      startX = event.clientX;
    }

    props.onDragStart?.();

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  /**
   * 处理鼠标移动，实时更新滑块位置
   * 响应式：写信号即可（preact signals 批量调度自动合并逐帧高频写）
   */
  const handleMouseMove = (event: MouseEvent): void => {
    if (!isDragging || !progressRef.value) {
      return;
    }

    if (isDiscrete) {
      // 离散模式：绝对定位 + 档位吸附（带 marks 时吸附最近档位，步长 = 档位间距）
      valueSignal.value = calculateValueFromPosition(event.clientX);
    } else {
      /** 进度条容器的边界矩形 */
      const rect = progressRef.value.getBoundingClientRect();
      /** 鼠标移动的水平偏移量 */
      const deltaX = event.clientX - startX;
      /** 偏移量对应的百分比变化 */
      const deltaPercentage = (deltaX / rect.width) * 100;
      valueSignal.value = Math.min(Math.max(0, valueSignal.value + deltaPercentage), 100);
      startX = event.clientX;
    }

    props.onChange?.(valueSignal.value);
  };

  /**
   * 处理鼠标释放，结束拖动
   */
  const handleMouseUp = (): void => {
    isDragging = false;

    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    props.onDragEnd?.();
  };

  // ============================================
  // API 方法
  // ============================================

  /**
   * 设置当前值（写信号即可，进度条宽度 / 数值文本由响应式系统自动同步）
   */
  const setValue = (value: number): void => {
    valueSignal.value = Math.min(Math.max(0, value), 100);
  };

  /**
   * 获取当前值
   */
  const getValue = (): number => {
    return valueSignal.value;
  };

  // ============================================
  // 生命周期
  // ============================================

  /**
   * 组件挂载后，通过事件向上层暴露 setValue 和 getValue 方法
   */
  lifecycle.onMounted = (): void => {
    lifecycle.emit?.('sliderMounted', { setValue, getValue });
  };

  /**
   * 组件销毁前，移除全局鼠标事件监听并重置拖动状态
   */
  lifecycle.onBeforeDestroy = (): void => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    isDragging = false;
  };

  /**
   * 渲染标记点
   */
  const renderMarks = (): VNode | null => {
    if (!props.marks || props.marks.length === 0) {
      return null;
    }

    return h(
      'div',
      { class: 'ui-progress-step' },
      ...props.marks.map((mark: SliderMark) =>
        h(
          'div',
          {
            class: 'ui-progress-item',
            style: { left: `${mark.value}%` },
          },
          h('div', { class: 'ui-progress-lab' })
        )
      )
    );
  };

  return h(
    'div',
    {
      class: 'ui-area',
      style: { width: typeof width === 'number' ? `${width}px` : width },
    },
    h(
      'div',
      {
        class: 'ui-progress-wrap',
        ref: 'progressRef',
        onClick: handleProgressClick,
      },
      h(
        'div',
        {
          class: 'ui-progress-bar',
          // 进度条宽度由 valueSignal 响应式驱动（__reactiveAttrs 响应式 style），
          // 替代旧的 progressBarRef.style.width 命令式更新
          style: { width: `${Math.floor(valueSignal.value)}%` },
        },
        h('span', {
          class: 'ui-progress-dot',
          onMouseDown: handleDotMouseDown,
        })
      ),
      renderMarks()
    ),
    h(
      'div',
      {
        class: 'ui-progress-val',
        style: { width: '60px' },
      },
      // 显式 getter 协议：h() 子节点位置写零参箭头函数，
      // 编译器自动包装为 _reactiveText（运行时 flattenInto 兜底），
      // valueSignal 变化时精准更新 Text 节点，
      // 替代旧的 progressValRef.textContent 命令式更新
      () => getDisplayValue()
    )
  );
});
