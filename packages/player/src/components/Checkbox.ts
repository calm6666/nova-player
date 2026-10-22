/**
 * ============================================
 * 复选框组件
 * ============================================
 */

import { h, defineComponent, useTemplateRef } from '@/core';
import { CheckboxDefaultIcon, CheckboxSelectedIcon } from './icons';
import type { ComponentLifecycle } from '@/types';

/**
 * 复选框组件 Props 接口
 */
export interface CheckboxProps {
  /** 是否选中 */
  checked?: boolean;
  /** 标签文本 */
  label?: string;
  /** 选中状态变化时的回调函数 */
  onChange?: (checked: boolean) => void;
  /** 复选框点击时的回调函数 */
  onClick?: () => void;
}

/**
 * 复选框组件
 */
export const Checkbox = defineComponent<CheckboxProps>((props, lifecycle: ComponentLifecycle) => {
  /**
   * 当前选中状态
   */
  let checked = props.checked ?? false;

  /**
   * 复选框输入元素引用
   */
  const checkboxInputRef = useTemplateRef<HTMLInputElement>(lifecycle, 'checkboxInputRef');

  // ============================================
  // DOM 更新方法
  // ============================================

  /**
   * 处理选中状态变化（以 input.checked 为准，选中样式由 CSS 的 :checked 承担）
   * @param event - change 事件
   */
  const handleChange = (event: Event): void => {
    if (!(event.target instanceof HTMLInputElement)) return;
    checked = event.target.checked;
    props.onChange?.(checked);
    props.onClick?.();
  };

  /**
   * 外部设置选中状态
   * @param value - 是否选中
   */
  const setChecked = (value: boolean): void => {
    checked = value;
    if (checkboxInputRef.value) {
      checkboxInputRef.value.checked = value;
    }
  };

  // ============================================
  // 生命周期钩子
  // ============================================

  /**
   * 组件挂载后的回调，向外暴露设置选中状态的方法
   */
  lifecycle.onMounted = (): void => {
    // 挂载时按初始 checked 落一次（否则 checked:true 的框看起来是未选中）
    setChecked(checked);
    lifecycle.emit?.('checkboxMounted', { setChecked });
  };

  return h('span', {
    class: 'ui-checkbox',
  },
    h('div', {
      class: 'ui-checkbox-area',
    },
      h('input', {
        class: 'ui-checkbox-input',
        type: 'checkbox',
        checked,
        ref: 'checkboxInputRef',
        ...(props.label ? { 'aria-label': props.label } : {}),
        onChange: handleChange,
      }),
      h('label', {
        class: 'ui-checkbox-label',
      },
        h('span', {
          class: 'ui-checkbox-icon ui-checkbox-icon-default',
        }, CheckboxDefaultIcon()),
        h('span', {
          class: 'ui-checkbox-icon ui-checkbox-icon-selected',
        }, CheckboxSelectedIcon()),
        props.label
          ? h('span', { class: 'ui-checkbox-name' }, props.label)
          : null,
      ),
    ),
  );
});
