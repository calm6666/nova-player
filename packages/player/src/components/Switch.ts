/**
 * ============================================
 * 开关组件 (Switch)
 * ============================================
 *
 * DOM 结构与 CSS 类名与既有实现保持一致：
 *   .ui-switch（根节点，携带 switch-small / switch-middle / switch-large、
 *              switch-checked / switch-disabled 状态类）
 *     input[type="checkbox"]
 *     .switch-inner
 *     .switch-circle（loading 态时插入加载图标）
 *
 * 行为：input change 事件驱动 switch-checked 类切换（对应既有实现 change()）；
 * loading(bool) 在圆点内插入 / 移除加载图标。
 */

import { h, defineComponent, useTemplateRef, materialize, signal } from '@lumina/framework/core';
import type { ComponentLifecycle } from '@lumina/framework/types';
import type { VNode } from '@lumina/framework/types';

/**
 * 开关尺寸类型：small / middle / large
 */
export type SwitchSize = 'small' | 'middle' | 'large';

/**
 * 开关组件 Props 接口
 */
export interface SwitchProps {
  /** 开关尺寸，默认 middle */
  size?: SwitchSize;
  /** 开关文字（传入后渲染为 label 内嵌文字，对应参考的 bui-switch-name） */
  name?: string;
  /** 是否选中，默认 false */
  checked?: boolean;
  /** 是否禁用，默认 false */
  disabled?: boolean;
  /** 选中状态变化时的回调函数 */
  onChange?: (checked: boolean) => void;
}

/**
 * 开关组件对外暴露的 API
 */
export interface SwitchApi {
  /** 设置选中状态（同步 input.checked 与样式类） */
  setChecked: (value: boolean) => void;
  /** 设置禁用状态 */
  setDisabled: (value: boolean) => void;
  /** 设置加载状态（在圆点内插入 / 移除加载图标，对应既有实现 loading()） */
  loading: (value: boolean) => void;
}

/** 加载图标（旋转圆环，与既有实现 loading 态一致） */
const LoadingIcon = (): VNode =>
  h('svg', {
    viewBox: '0 0 1024 1024',
    version: '1.1',
    xmlns: 'http://www.w3.org/2000/svg',
    class: 'switch-loading-icon',
  }, h('path', {
    d: 'M512 64a32 32 0 0 1 32 32v128a32 32 0 0 1-64 0V96a32 32 0 0 1 32-32z m0 704a32 32 0 0 1 32 32v128a32 32 0 0 1-64 0v-128a32 32 0 0 1 32-32z m448-256a32 32 0 0 1-32 32h-128a32 32 0 0 1 0-64h128a32 32 0 0 1 32 32z m-704 0a32 32 0 0 1-32 32H96a32 32 0 0 1 0-64h128a32 32 0 0 1 32 32z',
  }));

/**
 * 开关组件
 */
export const Switch = defineComponent<SwitchProps>((props, lifecycle: ComponentLifecycle) => {
  // ============================================
  // 状态数据（响应式信号：根节点 class 数组+对象形式自动追踪）
  // ============================================

  /**
   * 当前选中状态信号
   * 替代旧的 let checked + switchRef.classList.toggle('switch-checked', checked)
   * 信号在根节点 class 数组中被读取，编译期提取到 __reactiveAttrs，
   * mount 时注册 effect，信号变化时自动 normalizeClass 重新应用
   */
  const checkedSignal = signal<boolean>(props.checked ?? false);

  /**
   * 当前禁用状态信号
   * 替代旧的 let disabled + switchRef.classList.toggle('switch-disabled', disabled)
   * 同样由根节点 class 数组+对象形式自动追踪
   */
  const disabledSignal = signal<boolean>(props.disabled ?? false);

  // ============================================
  // DOM 引用
  // ============================================

  /** 复选框输入元素引用（用于同步 input.checked/disabled 表单属性） */
  const inputRef = useTemplateRef<HTMLInputElement>(lifecycle, 'inputRef');

  /** 圆点元素引用（loading 图标插入位置） */
  const circleRef = useTemplateRef<HTMLDivElement>(lifecycle, 'circleRef');

  /** 已插入的加载图标节点（自持引用，避免反查子元素） */
  let loadingIcon: Element | null = null;

  // ============================================
  // DOM 更新方法
  // ============================================

  /**
   * 处理复选框 change 事件（对应既有实现 change()）
   * 以 input.checked 为准更新信号（响应式系统自动同步根节点 class），
   * 禁用态下不响应
   * @param event - change 事件
   */
  const handleChange = (event: Event): void => {
    if (disabledSignal.value) {
      return;
    }
    if (!(event.target instanceof HTMLInputElement)) return;
    checkedSignal.value = event.target.checked;
    props.onChange?.(checkedSignal.value);
  };

  /**
   * 外部设置选中状态
   * 信号变化后根节点 class effect 自动同步 switch-checked 类；
   * input.checked 是表单元素属性（非样式），保留命令式设置以正确反映运行时状态
   * @param value - 是否选中
   */
  const setChecked = (value: boolean): void => {
    checkedSignal.value = value;
    if (inputRef.value) {
      inputRef.value.checked = value;
    }
  };

  /**
   * 外部设置禁用状态
   * 信号变化后根节点 class effect 自动同步 switch-disabled 类；
   * input.disabled 是表单元素属性（非样式），保留命令式设置
   * @param value - 是否禁用
   */
  const setDisabled = (value: boolean): void => {
    disabledSignal.value = value;
    if (inputRef.value) {
      inputRef.value.disabled = value;
    }
  };

  /**
   * 设置加载状态（对应既有实现 loading()）
   * @param value - 是否处于加载状态
   */
  const loading = (value: boolean): void => {
    const circle = circleRef.value;
    if (!circle) return;
    if (value) {
      // 已持有加载图标节点时直接复用，不再反查子元素
      if (loadingIcon) return;
      loadingIcon = materialize(LoadingIcon()) as Element;
      circle.appendChild(loadingIcon);
      return;
    }
    if (!loadingIcon) return;
    loadingIcon.remove();
    loadingIcon = null;
  };

  // ============================================
  // 生命周期钩子
  // ============================================

  /**
   * 组件挂载后：同步表单元素初始状态，并通过事件向外暴露控制方法
   * 根节点 class 已由响应式 class（数组+对象形式）自动追踪信号，无需手动 toggle
   */
  lifecycle.onMounted = (): void => {
    if (inputRef.value) {
      inputRef.value.checked = checkedSignal.value;
      inputRef.value.disabled = disabledSignal.value;
    }
    lifecycle.emit?.('switchMounted', { setChecked, setDisabled, loading } satisfies SwitchApi);
  };

  // ============================================
  // 组件渲染（DOM 结构与既有实现一致）
  // ============================================

  // 带文字形态：与参考 bui-switch 一致（input + label > name + body > dot），
  // 面板 scss 通过 .ui-switch-labeled 覆盖基础尺寸，不影响无文字形态
  // 根节点 class 含 signal.value，编译期提取到 __reactiveAttrs 自动追踪
  if (props.name !== undefined) {
    return h('div', {
      class: [`ui-switch ui-switch-labeled switch-${props.size ?? 'middle'}`, {
        'switch-checked': checkedSignal.value,
        'switch-disabled': disabledSignal.value,
      }],
    // 响应式迁移后根节点 class 由 checkedSignal/disabledSignal 信号驱动，不再需要 switchRef 引用（删除残留 ref 字符串，避免运行时未注册告警）
  },
      h('input', {
        type: 'checkbox',
        class: 'ui-switch-input',
        'aria-label': props.name,
        ref: 'inputRef',
        onChange: handleChange,
      }),
      h('div', { class: 'ui-switch-label' },
        h('span', { class: 'ui-switch-name' }, props.name),
        h('div', { class: 'ui-switch-body' },
          h('span', { class: 'ui-switch-dot' },
            h('span', { ref: 'circleRef' }),
          ),
        ),
      ),
    );
  }

  return h('div', {
    class: [`ui-switch switch-${props.size ?? 'middle'}`, {
      'switch-checked': checkedSignal.value,
      'switch-disabled': disabledSignal.value,
    }],
    // 响应式迁移后根节点 class 由 checkedSignal/disabledSignal 信号驱动，不再需要 switchRef 引用（删除残留 ref 字符串，避免运行时未注册告警）
  },
    h('input', {
      type: 'checkbox',
      ref: 'inputRef',
      onChange: handleChange,
    }),
    h('div', { class: 'switch-inner' }),
    h('div', { class: 'switch-circle', ref: 'circleRef' }),
  );
});
