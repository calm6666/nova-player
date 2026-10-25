/**
 * 根元素内部面板（清晰度 / 线路、速度、信息、快捷键、视频编码、右键菜单、
 * 发送条、Toast、错误、加载）的声明式 VNode 渲染。
 *
 * 这些面板不是自定义元素，全部挂在根元素内部。
 */

import { For, h, signal } from '@/core';
import type { Signal } from '@/core';
import type {
  NovaCodecCandidate,
  NovaContextMenuAction,
  NovaContextMenuTarget,
  NovaLineCandidate,
  NovaQualityCandidate,
  NovaVideoInfo,
} from '@/live/types';
import type { VNode } from '@/types';
import { t } from '@/core';
import { icon, reactive, text } from './helpers';
import { arrowLeftIcon, arrowRightIcon, playIcon } from '@/live/icons';

/** 面板通用 hover 注入。*/
export interface PanelHoverProps {
  /** 鼠标进入面板。*/
  onPointerEnter: () => void;
  /** 鼠标离开面板。*/
  onPointerLeave: () => void;
  /** 面板内部点击（固定面板）。*/
  onPin: () => void;
}

/** 清晰度 / 线路面板参数。*/
export interface QualityPanelProps extends PanelHoverProps {
  open: Signal<boolean>;
  page: Signal<number>;
  candidates: Signal<NovaQualityCandidate[]>;
  current: Signal<string>;
  lines: Signal<NovaLineCandidate[]>;
  lineCurrent: Signal<string>;
  onSelectQuality: (qn: string) => void;
  onSelectLine: (line: string) => void;
}

/** 清晰度面板（两页：清晰度 / 线路）。*/
export function QualityPanel(props: QualityPanelProps): VNode {
  const enhanceEnabled = signal(true);
  const currentLineLabel = (): string =>
    props.lines.value.find((item) => item.line === props.lineCurrent.value)?.label ?? t('livePlayer.line.main');

  const qualityPage = h(
    'div',
    {
      ...reactive({
        class: (): string =>
          `nova-live-player-quality-page${props.page.value !== 0 ? ' is-hidden' : ''}`,
      }),
    },
    h(
      'button',
      {
        type: 'button',
        class: 'nova-live-player-quality-page-head nova-live-player-quality-line-entry',
        onClick: (): void => {
          props.page.value = 1;
        },
      },
      h('span', { class: 'nova-live-player-quality-line-label' }, text(currentLineLabel)),
      icon(arrowRightIcon(), 'nova-live-player-quality-arrow-icon'),
    ),
    h(
      'div',
      { class: 'nova-live-player-quality-list' },
      h(For, {
        each: (): NovaQualityCandidate[] => props.candidates.value,
        key: (item: NovaQualityCandidate): string => item.qn,
        render: (item: NovaQualityCandidate): VNode =>
          h(
            'button',
            {
              type: 'button',
              'data-qn': item.qn,
              onClick: (): void => {
                props.onPin();
                props.onSelectQuality(item.qn);
              },
              ...reactive({
                class: (): string =>
                  `nova-live-player-quality-option${props.current.value === item.qn ? ' is-selected' : ''}`,
              }),
            },
            h('span', { class: 'nova-live-player-quality-label' }, item.label),
            item.hint ? h('span', { class: 'nova-live-player-quality-hint' }, item.hint) : null,
          ),
      }),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'nova-live-player-quality-enhance',
        onClick: (): void => {
          props.onPin();
          enhanceEnabled.value = !enhanceEnabled.value;
        },
      },
      h('span', { class: 'nova-live-player-quality-enhance-label' }, t('livePlayer.quality.enhance')),
      h('span', { class: 'nova-live-player-quality-enhance-help' }, '?'),
      h(
        'span',
        {
          ...reactive({
            class: (): string =>
              `nova-live-player-quality-switch${enhanceEnabled.value ? ' is-active' : ''}`,
          }),
        },
        h('span', { class: 'nova-live-player-quality-switch-dot' }),
      ),
    ),
  );

  const linePage = h(
    'div',
    {
      ...reactive({
        class: (): string =>
          `nova-live-player-quality-page${props.page.value !== 1 ? ' is-hidden' : ''}`,
      }),
    },
    h(
      'button',
      {
        type: 'button',
        class: 'nova-live-player-quality-page-head nova-live-player-quality-back',
        onClick: (): void => {
          props.page.value = 0;
        },
      },
      icon(arrowLeftIcon(), 'nova-live-player-quality-back-icon'),
      h('span', { class: 'nova-live-player-quality-back-label' }, text(currentLineLabel)),
    ),
    h(
      'div',
      { class: 'nova-live-player-line-list' },
      h(For, {
        each: (): NovaLineCandidate[] => props.lines.value,
        key: (item: NovaLineCandidate): string => item.line,
        render: (item: NovaLineCandidate): VNode =>
          h(
            'button',
            {
              type: 'button',
              'data-line': item.line,
              onClick: (): void => {
                props.onPin();
                props.onSelectLine(item.line);
              },
              ...reactive({
                class: (): string =>
                  `nova-live-player-line-option${props.lineCurrent.value === item.line ? ' is-selected' : ''}`,
              }),
            },
            item.label,
          ),
      }),
    ),
  );

  return h(
    'div',
    {
      class: 'nova-live-player-panel nova-live-player-quality-panel',
      'data-panel': 'quality',
      onMouseenter: (): void => props.onPointerEnter(),
      onMouseleave: (): void => props.onPointerLeave(),
      ...reactive({ hidden: (): boolean => !props.open.value }),
    },
    qualityPage,
    linePage,
  );
}

/** 速度面板参数。*/
export interface SpeedPanelProps extends PanelHoverProps {
  open: Signal<boolean>;
  rates: readonly number[];
  rate: Signal<number>;
  onSelect: (rate: number) => void;
}

/** 速度面板。*/
export function SpeedPanel(props: SpeedPanelProps): VNode {
  return h(
    'div',
    {
      class: 'nova-live-player-panel nova-live-player-speed-panel',
      'data-panel': 'speed',
      onMouseenter: (): void => props.onPointerEnter(),
      onMouseleave: (): void => props.onPointerLeave(),
      ...reactive({ hidden: (): boolean => !props.open.value }),
    },
    h('div', { class: 'nova-live-player-speed-title' }, t('livePlayer.control.speed')),
    h(
      'div',
      { class: 'nova-live-player-speed-list' },
      h(For, {
        each: (): readonly number[] => props.rates,
        key: (rate: number): string => String(rate),
        render: (rate: number): VNode =>
          h(
            'button',
            {
              type: 'button',
              'data-rate': String(rate),
              onClick: (): void => {
                props.onPin();
                props.onSelect(rate);
              },
              ...reactive({
                class: (): string =>
                  `nova-live-player-speed-option${props.rate.value === rate ? ' is-selected' : ''}`,
              }),
            },
            `${rate}x`,
          ),
      }),
    ),
  );
}

/** 曲线图采样数据。*/
export interface InfoChartSeries {
  /** 最近若干个缓冲采样点（毫秒）。*/
  buffer: readonly number[];
  /** 最近若干个丢帧采样点。*/
  dropped: readonly number[];
}

/** 信息面板参数。*/
export interface InfoPanelProps extends PanelHoverProps {
  open: Signal<boolean>;
  values: Signal<Record<keyof NovaVideoInfo, string>>;
  rows: ReadonlyArray<{ key: keyof NovaVideoInfo; labelKey: string }>;
  /** 曲线图采样数据（1Hz 采样、环形窗口）。*/
  series: Signal<InfoChartSeries>;
  onClose: () => void;
}

/** 曲线图 viewBox 宽度（运行时由 CSS 拉伸到卡片宽度）。*/
const CHART_VIEW_WIDTH = 300;

/** 曲线图 viewBox 高度。*/
const CHART_VIEW_HEIGHT = 48;

/** 曲线图上下留白（保证 0 值线与最大值线不被容器边缘裁切）。*/
const CHART_VIEW_PADDING = 2;

/** 保留一位小数，缩短 points 字符串。*/
const roundCoord = (value: number): number => Math.round(value * 10) / 10;

/**
 * 计算折线 `points` 坐标。
 *
 * x 轴按当前采样点数量均分（不显示刻度），y 轴按当前序列最大值归一化；
 * 空数据返回空串，`<polyline>` 因此不绘制任何线段。
 */
const chartPoints = (values: readonly number[]): string => {
  if (values.length === 0) return '';
  const max = Math.max(...values, 0);
  const scale = max > 0 ? max : 1;
  const span = Math.max(1, values.length - 1);
  const drawable = CHART_VIEW_HEIGHT - CHART_VIEW_PADDING * 2;
  return values
    .map((value, index): string => {
      const x = (index / span) * CHART_VIEW_WIDTH;
      const y = CHART_VIEW_PADDING + drawable - (Math.max(0, value) / scale) * drawable;
      return `${roundCoord(x)},${roundCoord(y)}`;
    })
    .join(' ');
};

/** 单条曲线卡片。*/
const InfoChart = (props: {
  titleKey: string;
  lineClass: string;
  values: () => readonly number[];
}): VNode =>
  h(
    'div',
    { class: 'nova-live-player-info-chart' },
    h('span', { class: 'nova-live-player-info-chart-title' }, t(props.titleKey)),
    h(
      'div',
      { class: 'nova-live-player-info-chart-body' },
      h(
        'svg',
        {
          class: 'nova-live-player-info-chart-svg',
          viewBox: `0 0 ${CHART_VIEW_WIDTH} ${CHART_VIEW_HEIGHT}`,
          preserveAspectRatio: 'none',
          'aria-hidden': 'true',
        },
        h('polyline', {
          class: `nova-live-player-info-chart-line ${props.lineClass}`,
          ...reactive({ points: (): string => chartPoints(props.values()) }),
        }),
      ),
    ),
  );

/** 信息面板。*/
export function InfoPanel(props: InfoPanelProps): VNode {
  return h(
    'div',
    {
      class: 'nova-live-player-panel nova-live-player-info',
      'data-panel': 'info',
      onMouseenter: (): void => props.onPointerEnter(),
      onMouseleave: (): void => props.onPointerLeave(),
      ...reactive({ hidden: (): boolean => !props.open.value }),
    },
    h(
      'div',
      { class: 'nova-live-player-info-title' },
      h('span', { class: 'nova-live-player-info-title-text' }, t('livePlayer.info.title')),
      h(
        'button',
        {
          type: 'button',
          class: 'nova-live-player-info-close',
          onClick: (): void => {
            props.onPin();
            props.onClose();
          },
        },
        t('livePlayer.common.close'),
      ),
    ),
    h(
      'div',
      { class: 'nova-live-player-info-body' },
      h(For, {
        each: (): ReadonlyArray<{ key: keyof NovaVideoInfo; labelKey: string }> => props.rows,
        key: (row: { key: keyof NovaVideoInfo; labelKey: string }): string => row.key,
        render: (row: { key: keyof NovaVideoInfo; labelKey: string }): VNode =>
          h(
            'div',
            { class: 'nova-live-player-info-row' },
            h('span', { class: 'nova-live-player-info-key' }, t(row.labelKey)),
            h(
              'span',
              { class: 'nova-live-player-info-value' },
              text((): string => props.values.value[row.key] ?? '-'),
            ),
          ),
      }),
      InfoChart({
        titleKey: 'livePlayer.info.chartBuffer',
        lineClass: 'nova-live-player-info-chart-line-buffer',
        values: (): readonly number[] => props.series.value.buffer,
      }),
      InfoChart({
        titleKey: 'livePlayer.info.chartDropped',
        lineClass: 'nova-live-player-info-chart-line-dropped',
        values: (): readonly number[] => props.series.value.dropped,
      }),
    ),
  );
}

/** 快捷键面板参数。*/
export interface HotkeyPanelProps extends PanelHoverProps {
  open: Signal<boolean>;
  rows: ReadonlyArray<{ keys: string; descKey: string }>;
  onClose: () => void;
}

/** 快捷键面板。*/
export function HotkeyPanel(props: HotkeyPanelProps): VNode {
  return h(
    'div',
    {
      class: 'nova-live-player-panel nova-live-player-hotkey',
      'data-panel': 'hotkey',
      onMouseenter: (): void => props.onPointerEnter(),
      onMouseleave: (): void => props.onPointerLeave(),
      ...reactive({ hidden: (): boolean => !props.open.value }),
    },
    h(
      'div',
      { class: 'nova-live-player-hotkey-title' },
      h('span', { class: 'nova-live-player-hotkey-title-text' }, t('livePlayer.hotkey.title')),
      h(
        'button',
        {
          type: 'button',
          class: 'nova-live-player-hotkey-close',
          onClick: (): void => {
            props.onPin();
            props.onClose();
          },
        },
        t('livePlayer.common.close'),
      ),
    ),
    h(
      'div',
      { class: 'nova-live-player-hotkey-body' },
      h(For, {
        each: (): ReadonlyArray<{ keys: string; descKey: string }> => props.rows,
        key: (row: { keys: string; descKey: string }): string => row.keys,
        render: (row: { keys: string; descKey: string }): VNode =>
          h(
            'div',
            { class: 'nova-live-player-hotkey-row' },
            h('span', { class: 'nova-live-player-hotkey-keys' }, row.keys),
            h('span', { class: 'nova-live-player-hotkey-desc' }, t(row.descKey)),
          ),
      }),
    ),
  );
}

/** 视频编码面板参数。*/
export interface CodecPanelProps extends PanelHoverProps {
  open: Signal<boolean>;
  candidates: Signal<NovaCodecCandidate[]>;
  current: Signal<string>;
  onSelect: (codec: string) => void;
  onClose: () => void;
}

/** 视频编码面板。*/
export function CodecPanel(props: CodecPanelProps): VNode {
  return h(
    'div',
    {
      class: 'nova-live-player-panel nova-live-player-codec-panel',
      'data-panel': 'codec',
      onMouseenter: (): void => props.onPointerEnter(),
      onMouseleave: (): void => props.onPointerLeave(),
      ...reactive({ hidden: (): boolean => !props.open.value }),
    },
    h(
      'div',
      { class: 'nova-live-player-codec-title' },
      h('span', { class: 'nova-live-player-codec-title-text' }, t('livePlayer.codec.title')),
      h(
        'button',
        {
          type: 'button',
          class: 'nova-live-player-codec-close',
          onClick: (): void => {
            props.onPin();
            props.onClose();
          },
        },
        t('livePlayer.common.close'),
      ),
    ),
    h(
      'div',
      { class: 'nova-live-player-codec-list' },
      h(For, {
        each: (): NovaCodecCandidate[] => props.candidates.value,
        key: (item: NovaCodecCandidate): string => item.codec,
        render: (item: NovaCodecCandidate): VNode =>
          h(
            'button',
            {
              type: 'button',
              'data-codec': item.codec,
              onClick: (): void => {
                props.onPin();
                props.onSelect(item.codec);
              },
              ...reactive({
                class: (): string =>
                  `nova-live-player-codec-option${props.current.value === item.codec ? ' is-selected' : ''}`,
              }),
            },
            h('span', { class: 'nova-live-player-codec-label' }, item.label),
            item.hint ? h('span', { class: 'nova-live-player-codec-hint' }, item.hint) : null,
          ),
      }),
    ),
    h(
      'div',
      {
        class: 'nova-live-player-codec-empty',
        ...reactive({ hidden: (): boolean => props.candidates.value.length > 0 }),
      },
      t('livePlayer.codec.empty'),
    ),
  );
}

/** 右键菜单项。*/
export interface MenuEntry {
  action: NovaContextMenuAction;
  label: string;
  disabled: boolean;
}

/** 右键菜单参数。*/
export interface ContextMenuProps {
  open: Signal<boolean>;
  x: Signal<number>;
  y: Signal<number>;
  items: Signal<MenuEntry[]>;
  target: Signal<NovaContextMenuTarget | null>;
  onAction: (action: NovaContextMenuAction) => void;
  onClose: () => void;
}

/** 右键菜单。*/
export function ContextMenu(props: ContextMenuProps): VNode {
  return h(
    'ul',
    {
      class: 'nova-live-player-menu',
      'data-panel': 'menu',
      onMouseenter: (): void => undefined,
      ...reactive({
        hidden: (): boolean => !props.open.value,
        style: (): Record<string, string> => ({ left: `${props.x.value}px`, top: `${props.y.value}px` }),
      }),
    },
    h(For, {
      each: (): MenuEntry[] => props.items.value,
      key: (item: MenuEntry): string => `${item.action}:${item.disabled}`,
      render: (item: MenuEntry): VNode =>
        h(
          'li',
          {
            class: 'nova-live-player-menu-item',
            'data-action': item.action,
            'data-disabled': String(item.disabled),
            onClick: (): void => {
              if (item.disabled) return;
              props.onClose();
              props.onAction(item.action);
            },
          },
          item.label,
        ),
    }),
  );
}

/** 发送条参数。*/
export interface SendBarProps {
  open: Signal<boolean>;
  onSubmit: (text: string) => void;
}

/** 弹幕发送条。*/
export function SendBar(props: SendBarProps): VNode {
  let inputEl: HTMLInputElement | null = null;
  const submit = (): void => {
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;
    props.onSubmit(text);
    inputEl.value = '';
    props.open.value = false;
  };
  return h(
    'div',
    {
      class: 'nova-live-player-send',
      ...reactive({ hidden: (): boolean => !props.open.value }),
    },
    h('input', {
      type: 'text',
      class: 'nova-live-player-send-input',
      ...reactive({ placeholder: (): string => t('livePlayer.send.placeholder') }),
      ref: (el: unknown): void => {
        inputEl = el instanceof HTMLInputElement ? el : null;
        if (inputEl) inputEl.focus();
      },
      onKeydown: (event: KeyboardEvent): void => {
        if (event.key === 'Enter') submit();
      },
    }),
    h(
      'button',
      { type: 'button', class: 'nova-live-player-send-button', onClick: submit },
      t('livePlayer.send.submit'),
    ),
  );
}

/** Toast 参数。*/
export interface ToastProps {
  visible: Signal<boolean>;
  message: Signal<string>;
  type: Signal<string>;
}

/** Toast。*/
export function ToastView(props: ToastProps): VNode {
  return h(
    'div',
    {
      class: 'nova-live-player-toast',
      ...reactive({
        hidden: (): boolean => !props.visible.value,
        'data-type': (): string => props.type.value,
      }),
    },
    text((): string => props.message.value),
  );
}

/** 错误面板参数。*/
export interface ErrorPanelProps {
  visible: Signal<boolean>;
  message: Signal<string>;
  onRetry: () => void;
}

/** 错误面板。*/
export function ErrorPanel(props: ErrorPanelProps): VNode {
  return h(
    'div',
    { class: 'nova-live-player-error', ...reactive({ hidden: (): boolean => !props.visible.value }) },
    h('div', { class: 'nova-live-player-error-title' }, t('livePlayer.error.title')),
    h('div', { class: 'nova-live-player-error-message' }, text((): string => props.message.value)),
    h(
      'button',
      { type: 'button', class: 'nova-live-player-error-retry', onClick: (): void => props.onRetry() },
      t('livePlayer.error.retry'),
    ),
  );
}

/** 加载指示参数。*/
export interface LoadingProps {
  visible: Signal<boolean>;
}

/** 加载指示。*/
export function LoadingView(props: LoadingProps): VNode {
  return h(
    'div',
    { class: 'nova-live-player-loading', ...reactive({ hidden: (): boolean => !props.visible.value }) },
    h('span', { class: 'nova-live-player-loading-ring' }),
  );
}

/** 关闭按钮使用文本，保留 playIcon 引用避免未使用告警。*/
export const DECORATIVE_PLAY_ICON = playIcon;



