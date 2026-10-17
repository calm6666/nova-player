/**
 * 弹幕设置面板（根元素内部 DOM，非独立 Web Component）。
 *
 * 结构与交互对齐点播播放器 DmSetting 面板，并按直播场景精简：
 * - 第一页：显示区域、弹幕密度、不透明度、字体大小、弹幕速度、
 *   弹幕随屏幕缩放 / 智能防挡、高级设置；
 * - 第二页：更多弹幕设置（返回）、弹幕字体 + 粗体、描边类型、恢复默认。
 */

import { computed, h } from '@/core';
import type { ReadonlySignal, Signal } from '@/core';
import type { NovaDanmakuSetting, NovaDanmakuStroke } from '@/live/types';
import type { VNode } from '@/types';
import { t } from '@/core';
import { icon, reactive } from './helpers';
import { arrowLeftIcon, arrowRightIcon } from '@/live/icons';
import { Checkbox, Segmented, Slider } from './controls';

/** 字体候选。*/
const FONT_FAMILIES: ReadonlyArray<{ labelKey: string; value: string }> = [
  { labelKey: 'livePlayer.dmSetting.font.simhei', value: "SimHei, 'Microsoft JhengHei'" },
  { labelKey: 'livePlayer.dmSetting.font.simsun', value: 'SimSun' },
  { labelKey: 'livePlayer.dmSetting.font.newsimsun', value: 'NSimSun' },
  { labelKey: 'livePlayer.dmSetting.font.fangsong', value: 'FangSong' },
  { labelKey: 'livePlayer.dmSetting.font.msyh', value: "'Microsoft YaHei'" },
  { labelKey: 'livePlayer.dmSetting.font.msyhLight', value: "'Microsoft Yahei UI Light'" },
  { labelKey: 'livePlayer.dmSetting.font.notoDemi', value: "'Noto Sans CJK SC DemiLight'" },
  { labelKey: 'livePlayer.dmSetting.font.notoRegular', value: "'Noto Sans CJK SC Regular'" },
];

/** 面板注入参数。*/
export interface DmSettingPanelProps {
  /** 当前设置。*/
  setting: Signal<NovaDanmakuSetting>;
  /** 当前页（0 主面板 / 1 更多设置）。*/
  page: Signal<number>;
  /** 是否显示。*/
  visible: Signal<boolean>;
  /** 设置变化。*/
  onChange: (patch: Partial<NovaDanmakuSetting>) => void;
  /** 恢复默认。*/
  onReset: () => void;
  /** 鼠标进入面板（保持打开）。*/
  onPointerEnter: () => void;
  /** 鼠标离开面板（延迟关闭）。*/
  onPointerLeave: () => void;
  /** 面板内部交互（固定面板，不因鼠标离开关闭）。*/
  onPin: () => void;
}

/** 密度选项。*/
const DENSITY_OPTIONS: ReadonlyArray<{ value: number; labelKey: string }> = [
  { value: 0.5, labelKey: 'livePlayer.dmSetting.densityNormal' },
  { value: 0.8, labelKey: 'livePlayer.dmSetting.densityMore' },
  { value: 1, labelKey: 'livePlayer.dmSetting.densityOverlap' },
];

/** 弹幕设置面板。*/
export function DmSettingPanel(props: DmSettingPanelProps): VNode {
  const fontSizePercent = computed((): number => Math.round((props.setting.value.fontsize / 25) * 100));
  const densityValue = computed((): number =>
    props.setting.value.density >= 0.9 ? 1 : props.setting.value.density >= 0.7 ? 0.8 : 0.5,
  );

  const page1 = h(
    'div',
    {
      ...reactive({
        class: (): string =>
          `nova-live-player-dm-setting-page nova-live-player-dm-setting-page-main${
            props.page.value !== 0 ? ' is-hidden' : ''
          }`,
      }),
    },
    Slider({
      label: t('livePlayer.dmSetting.area'),
      value: computed((): number => props.setting.value.area),
      min: 25,
      max: 100,
      step: 25,
      marks: [25, 50, 75, 100],
      format: (value): string => `${value}%`,
      onChange: (value): void => props.onChange({ area: value }),
    }),
    h(
      'div',
      { class: 'nova-live-player-dm-setting-row' },
      h('span', { class: 'nova-live-player-dm-setting-row-label' }, t('livePlayer.dmSetting.density')),
      h(
        'div',
        { class: 'nova-live-player-dm-setting-row-control' },
        Segmented<number>({
          value: densityValue,
          className: 'nova-live-player-dm-setting-density',
          options: DENSITY_OPTIONS.map((item) => ({ value: item.value, label: t(item.labelKey) })),
          onChange: (value): void => props.onChange({ density: value }),
        }),
      ),
    ),
    Slider({
      label: t('livePlayer.dmSetting.opacity'),
      value: computed((): number => Math.round(props.setting.value.opacity * 100)),
      min: 20,
      max: 100,
      step: 5,
      format: (value): string => `${value}%`,
      onChange: (value): void => props.onChange({ opacity: value / 100 }),
    }),
    Slider({
      label: t('livePlayer.dmSetting.fontsize'),
      value: fontSizePercent,
      min: 50,
      max: 200,
      step: 10,
      format: (value): string => `${value}%`,
      onChange: (value): void => props.onChange({ fontsize: Math.round((25 * value) / 100) }),
    }),
    Slider({
      label: t('livePlayer.dmSetting.speed'),
      value: computed((): number => props.setting.value.speed),
      min: 1,
      max: 10,
      step: 1,
      format: (value): string =>
        value <= 3 ? t('livePlayer.dmSetting.speedSlow') : value >= 8 ? t('livePlayer.dmSetting.speedFast') : t('livePlayer.dmSetting.speedNormal'),
      onChange: (value): void => props.onChange({ speed: value }),
    }),
    h(
      'div',
      { class: 'nova-live-player-dm-setting-checks' },
      Checkbox({
        label: t('livePlayer.dmSetting.autoScale'),
        checked: computed((): boolean => props.setting.value.autoScale),
        onChange: (checked): void => props.onChange({ autoScale: checked }),
      }),
      Checkbox({
        label: t('livePlayer.dmSetting.smartMask'),
        checked: computed((): boolean => props.setting.value.mask),
        onChange: (checked): void => props.onChange({ mask: checked }),
      }),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'nova-live-player-dm-setting-advanced',
        onClick: (): void => {
          props.page.value = 1;
        },
      },
      h('span', {}, t('livePlayer.dmSetting.advanced')),
      icon(arrowRightIcon(), 'nova-live-player-dm-setting-arrow'),
    ),
  );

  const fontOptions = FONT_FAMILIES.map((font) =>
    h(
      'option',
      { value: font.value, selected: props.setting.value.fontFamily === font.value },
      t(font.labelKey),
    ),
  );
  const fontSelect = h(
    'select',
    {
      class: 'nova-live-player-dm-setting-select',
      ref: (el: unknown): void => {
        if (!(el instanceof HTMLSelectElement)) return;
        el.value = props.setting.value.fontFamily;
        el.addEventListener('change', (): void => props.onChange({ fontFamily: el.value }));
      },
    },
    ...fontOptions,
  );

  const strokeButton = (value: NovaDanmakuStroke, label: string): VNode =>
    h(
      'button',
      {
        type: 'button',
        'data-stroke': value,
        onClick: (): void => {
          props.onPin();
          props.onChange({ fontBorder: value });
        },
        ...reactive({
          class: (): string =>
            `nova-live-player-dm-setting-stroke${props.setting.value.fontBorder === value ? ' is-active' : ''}`,
        }),
      },
      label,
    );

  const page2 = h(
    'div',
    {
      ...reactive({
        class: (): string =>
          `nova-live-player-dm-setting-page nova-live-player-dm-setting-page-more${
            props.page.value !== 1 ? ' is-hidden' : ''
          }`,
      }),
    },
    h(
      'button',
      {
        type: 'button',
        class: 'nova-live-player-dm-setting-back',
        onClick: (): void => {
          props.page.value = 0;
        },
      },
      icon(arrowLeftIcon(), 'nova-live-player-dm-setting-arrow'),
      h('span', {}, t('livePlayer.dmSetting.more')),
    ),
    h(
      'div',
      { class: 'nova-live-player-dm-setting-font-row' },
      h('div', { class: 'nova-live-player-dm-setting-font-title' }, t('livePlayer.dmSetting.font')),
      h(
        'div',
        { class: 'nova-live-player-dm-setting-font-control' },
        fontSelect,
        h('div', { class: 'nova-live-player-dm-setting-font-bold' }, Checkbox({
          label: t('livePlayer.dmSetting.bold'),
          checked: computed((): boolean => props.setting.value.bold),
          onChange: (checked): void => {
            props.onPin();
            props.onChange({ bold: checked });
          },
        })),
      ),
    ),
    h(
      'div',
      { class: 'nova-live-player-dm-setting-stroke-block' },
      h('div', { class: 'nova-live-player-dm-setting-font-title' }, t('livePlayer.dmSetting.stroke')),
      h(
        'div',
        { class: 'nova-live-player-dm-setting-stroke-list' },
        strokeButton('heavy', t('livePlayer.dmSetting.strokeHeavy')),
        strokeButton('outline', t('livePlayer.dmSetting.strokeOutline')),
        strokeButton('projection', t('livePlayer.dmSetting.strokeProjection')),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'nova-live-player-dm-setting-reset',
        onClick: (): void => {
          props.onPin();
          props.onReset();
        },
      },
      t('livePlayer.common.reset'),
    ),
  );

  return h(
    'div',
    {
      class: 'nova-live-player-dm-setting-panel',
      'data-panel': 'danmaku',
      onMouseenter: (): void => props.onPointerEnter(),
      onMouseleave: (): void => props.onPointerLeave(),
      ...reactive({ hidden: (): boolean => !props.visible.value }),
    },
    h(
      'div',
      {
        class: 'nova-live-player-dm-setting-box',
        ...reactive({
          style: (): Record<string, string> =>
            props.page.value === 0
              ? { width: '320px', height: '300px' }
              : { width: '300px', height: '232px' },
        }),
      },
      page1,
      page2,
    ),
  );
}

/** 供根元素读取的只读类型别名。*/
export type DmSettingSignals = ReadonlySignal<NovaDanmakuSetting>;


