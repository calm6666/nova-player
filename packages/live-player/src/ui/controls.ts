/**
 * 面板内部通用控件（滑块 / 复选/ 分段选择），全部使用框架 VNode + signal。 */

import { h } from '@/core';
import type { ReadonlySignal } from '@/core';
import { checkIcon } from '@/live/icons';
import type { VNode } from '@/types';
import { icon, reactive, text } from './helpers';

/** 滑块参数。*/
export interface SliderProps {
  /** 标签。*/
  label: string;
  /** 当前值。*/
  value: ReadonlySignal<number>;
  /** 最小值。*/
  min: number;
  /** 最大值。*/
  max: number;
  /** 步长。*/
  step: number;
  /** 数值展示。*/
  format: (value: number) => string;
  /** 刻度值。*/
  marks?: number[];
  /** 值变化。*/
  onChange: (value: number) => void;
}

/** 滑块组件。*/
export function Slider(props: SliderProps): VNode {
  const percent = (value: number): number =>
    props.max === props.min ? 0 : ((value - props.min) / (props.max - props.min)) * 100;

  const updateFromClientX = (clientX: number, track: HTMLElement): void => {
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = props.min + ratio * (props.max - props.min);
    const next = Math.max(props.min, Math.min(props.max, Math.round(raw / props.step) * props.step));
    if (next !== props.value.value) props.onChange(next);
  };

  return h(
    'div',
    { class: 'nova-live-player-slider-row' },
    h(
      'div',
      { class: 'nova-live-player-slider-head' },
      h('span', { class: 'nova-live-player-slider-label' }, props.label),
      h('span', { class: 'nova-live-player-slider-value' }, text((): string => props.format(props.value.value))),
    ),
    h(
      'div',
      {
        class: 'nova-live-player-slider-track',
        onPointerdown: (event: PointerEvent): void => {
          const track = event.currentTarget as HTMLElement;
          event.preventDefault();
          updateFromClientX(event.clientX, track);
          const onMove = (moveEvent: PointerEvent): void => updateFromClientX(moveEvent.clientX, track);
          const stop = (): void => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', stop);
            window.removeEventListener('pointercancel', stop);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', stop);
          window.addEventListener('pointercancel', stop);
        },
      },
      h('div', {
        class: 'nova-live-player-slider-fill',
        ...reactive({ style: (): Record<string, string> => ({ width: `${percent(props.value.value)}%` }) }),
      }),
      h('div', {
        class: 'nova-live-player-slider-dot',
        ...reactive({ style: (): Record<string, string> => ({ left: `${percent(props.value.value)}%` }) }),
      }),
      ...(props.marks ?? []).map((mark) =>
        h('span', {
          class: 'nova-live-player-slider-mark',
          style: { left: `${percent(mark)}%` },
        }),
      ),
    ),
  );
}

/** 复选参数。*/
export interface CheckboxProps {
  /** 文案。*/
  label: string;
  /** 状态。*/
  checked: ReadonlySignal<boolean>;
  /** 变更。*/
  onChange: (checked: boolean) => void;
  /** 附加类名。*/
  className?: string;
}

/** 复选框组件（自绘，不使用原生 input，避免属性与属性同步问题）。*/
export function Checkbox(props: CheckboxProps): VNode {
  return h(
    'div',
    {
      class: ['nova-live-player-checkbox', props.className ?? ''],
      'data-name': props.className ?? '',
      role: 'checkbox',
      onClick: (): void => props.onChange(!props.checked.value),
      ...reactive({ 'aria-checked': (): string => String(props.checked.value) }),
    },
    h(
      'span',
      {
        ...reactive({
          class: (): string =>
            `nova-live-player-checkbox-box${props.checked.value ? ' is-checked' : ''}`,
        }),
      },
      icon(checkIcon(), 'nova-live-player-checkbox-icon'),
    ),
    h('span', { class: 'nova-live-player-checkbox-label' }, props.label),
  );
}

/** 分段选择参数。*/
export interface SegmentedProps<T extends string | number> {
  /** 选项。*/
  options: ReadonlyArray<{ value: T; label: string }>;
  /** 当前值。*/
  value: ReadonlySignal<T>;
  /** 变更。*/
  onChange: (value: T) => void;
  /** 附加类名。*/
  className?: string;
}

/** 分段选择组件。*/
export function Segmented<T extends string | number>(props: SegmentedProps<T>): VNode {
  return h(
    'div',
    { class: ['nova-live-player-segmented', props.className ?? ''] },
    ...props.options.map((option) =>
      h(
        'button',
        {
          type: 'button',
          'data-value': String(option.value),
          onClick: (): void => props.onChange(option.value),
          ...reactive({
            class: (): string =>
              `nova-live-player-segmented-item${props.value.value === option.value ? ' is-active' : ''}`,
          }),
        },
        option.label,
      ),
    ),
  );
}




