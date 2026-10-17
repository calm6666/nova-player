import { h, signal } from '@/core';
import type { Signal } from '@/core';
import type { VNode } from '@/types';

export interface RadioGroupOption {
  label: string;
  value: boolean | string | number;
  checked?: boolean;
}

export interface RadioGroupConfig {
  name: string;
  onSelect: (option: RadioGroupOption) => void;
  refKey?: string;
  /**
   * 受控选中值信号（可选）：由外部状态源驱动选中态
   *
   * 提供时选中态完全跟随该信号（如运行时状态经 useReactiveState
   * 派生的信号——设置面板单选与持久化状态双向同步）；未提供时
   * 回退到内部信号 + options 的 checked 标记（既有行为不变）
   */
  checkedValue?: Signal<boolean | string | number | undefined>;
}

/**
 * 渲染一组单选胶囊
 * 声明式响应式版本：选中态由内部 checkedValueSignal 驱动 label 的
 * active 类（__reactiveAttrs），点击仅写信号 + 回调，
 * 组内互斥由响应式系统自动同步，
 * 替代旧的 querySelectorAll + classList.add/remove 命令式互斥
 * @param options - 选项列表
 * @param config - 组名、选中回调与可选模板引用
 * @returns 单选组虚拟节点
 */
export const RadioGroup = (
  options: RadioGroupOption[],
  config: RadioGroupConfig,
): VNode => {
  /**
   * 选中值信号：优先使用外部受控信号（config.checkedValue），
   * 未提供时初值取传入 options 中标记 checked 的项（非受控模式）
   */
  const initialChecked = options.find((option) => option.checked === true);
  const checkedValueSignal =
    config.checkedValue ??
    signal<boolean | string | number | undefined>(initialChecked?.value);

  return h(
    'div',
    {
      class: 'ui-radio-wrap ui-radio-button',
      ...(config.refKey ? { ref: config.refKey } : {}),
    },
    h(
      'div',
      { class: 'ui-radio-group', style: { margin: '0 -4px' } },
      ...options.map((option) =>
        h(
          'label',
          {
            // 选中态类名由 checkedValueSignal 响应式驱动（__reactiveAttrs + normalizeClass）
            class: [
              'ui-radio-item',
              { active: checkedValueSignal.value === option.value },
            ],
            style: { margin: '0 4px' },
            onClick: () => {
              // 写信号即可：active 类随信号在组内自动互斥切换
              checkedValueSignal.value = option.value;
              config.onSelect(option);
            },
          },
          h('input', {
            class: 'ui-radio-input',
            type: 'radio',
            name: config.name,
            value: String(option.value),
            checked: option.checked === true,
          }),
          h(
            'span',
            { class: 'ui-radio-label' },
            h('span', { class: 'ui-radio-text' }, option.label),
          ),
        ),
      ),
    ),
  );
};
