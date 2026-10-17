/**
 * `<nova-live-player-control-bar>` 控制层 Web Component。
 *
 * 内部使用 Lumina 框架声明式渲染：控制条结构与状态更新全部由 VNode /
 * signal 完成；对外只暴露 `bind()` 注入信号与回调。
 */

import { h, signal, t } from '@/core';
import type { Signal } from '@/core';
import {
  danmakuIcon,
  danmakuOffIcon,
  danmakuSettingIcon,
  exitFullscreenIcon,
  exitWebscreenIcon,
  fullscreenIcon,
  mutedIcon,
  pauseIcon,
  playIcon,
  refreshIcon,
  sendIcon,
  volumeIcon,
  webscreenIcon,
} from '@/live/icons';
import type { NovaControlAction, NovaPanelName, NovaScreenMode } from '@/live/types';
import type { VNode } from '@/types';
import { NovaLiveUiElement } from './base';
import { icon, reactive, text } from '../ui/helpers';

/** 控制层标签名。 */
export const CONTROL_BAR_TAG = 'nova-live-player-control-bar';

/** 控制层注入参数。 */
export interface ControlBarProps {
  /** 是否正在播放。 */
  playing: Signal<boolean>;
  /** 是否静音。 */
  muted: Signal<boolean>;
  /** 音量 0-100。 */
  volume: Signal<number>;
  /** 弹幕开关。 */
  danmakuOn: Signal<boolean>;
  /** 清晰度文案。 */
  qualityLabel: Signal<string>;
  /** 倍速文案。 */
  speedLabel: Signal<string>;
  /** 屏幕形态。 */
  screenMode: Signal<NovaScreenMode>;
  /** 控制条是否显示。 */
  visible: Signal<boolean>;
  /** 开播时长文案。 */
  liveTime: Signal<string>;
  /** 动作回调。 */
  onAction: (action: NovaControlAction) => void;
  /** 音量回调。 */
  onVolume: (volume: number) => void;
  /** 图标 hover 打开面板。 */
  onPanelHover: (name: NovaPanelName) => void;
  /** 图标离开面板。 */
  onPanelLeave: (name: NovaPanelName) => void;
}

/** 控制条按钮定义。 */
interface ButtonSpec {
  /** 动作。 */
  action: NovaControlAction;
  /** 无障碍文案。 */
  label: string;
  /** 面板 hover 名称。 */
  panel?: NovaPanelName;
  /** 是否文本按钮。 */
  text?: boolean;
}

/** 左侧按钮（播放、音量、刷新）。 */
const LEFT_ACTIONS: NovaControlAction[] = ['toggle-play', 'refresh', 'toggle-mute'];

/** 右侧按钮顺序。 */
const RIGHT_ACTIONS: NovaControlAction[] = [
  'quality',
  'toggle-danmaku',
  'send-danmaku',
  'danmaku-setting',
  'webscreen',
  'fullscreen',
];

/** 按钮静态定义。 */
const BUTTONS: Record<string, ButtonSpec> = {
  'toggle-play': { action: 'toggle-play', label: 'livePlayer.control.play' },
  'toggle-mute': { action: 'toggle-mute', label: 'livePlayer.control.mute' },
  refresh: { action: 'refresh', label: 'livePlayer.control.refresh' },
  quality: { action: 'quality', label: 'livePlayer.control.quality', text: true, panel: 'quality' },
  'toggle-danmaku': { action: 'toggle-danmaku', label: 'livePlayer.control.danmaku' },
  'send-danmaku': { action: 'send-danmaku', label: 'livePlayer.control.send' },
  speed: { action: 'speed', label: 'livePlayer.control.speed', text: true, panel: 'speed' },
  'danmaku-setting': {
    action: 'danmaku-setting',
    label: 'livePlayer.control.danmakuSetting',
    panel: 'danmaku',
  },
  webscreen: { action: 'webscreen', label: 'livePlayer.control.webscreen' },
  fullscreen: { action: 'fullscreen', label: 'livePlayer.control.fullscreen' },
};

/** 音量浮层状态。 */
interface VolumeState {
  /** 是否显示。 */
  open: Signal<boolean>;
  /** 显示。 */
  show: () => void;
  /** 延迟隐藏。 */
  hide: () => void;
}

/** 控制层元素。 */
export class NovaLivePlayerControlBarElement extends NovaLiveUiElement {
  /** 注入参数。 */
  private props: ControlBarProps | null = null;

  /** 注入信号与回调并重建视图。 */
  public bind(props: ControlBarProps): void {
    this.props = props;
    this.remountView();
  }

  /** 渲染控制条。 */
  protected render(): VNode {
    if (!this.props) return h('div', { class: 'nova-live-player-control' });
    return this.renderControlBar(this.props);
  }

  /** 渲染控制层主体。 */
  private renderControlBar(props: ControlBarProps): VNode {
    const volumeOpen = signal(false);
    let volumeCloseTimer: ReturnType<typeof setTimeout> | null = null;
    const showVolume = (): void => {
      if (volumeCloseTimer !== null) {
        clearTimeout(volumeCloseTimer);
        volumeCloseTimer = null;
      }
      volumeOpen.value = true;
    };
    const hideVolume = (): void => {
      if (volumeCloseTimer !== null) clearTimeout(volumeCloseTimer);
      volumeCloseTimer = setTimeout((): void => {
        volumeOpen.value = false;
        volumeCloseTimer = null;
      }, 180);
    };
    const volumeState: VolumeState = { open: volumeOpen, show: showVolume, hide: hideVolume };

    return h(
      'div',
      {
        class: 'nova-live-player-control',
        ...reactive({ 'data-visible': (): string => String(props.visible.value) }),
      },
      h(
        'div',
        { class: 'nova-live-player-control-area' },
        h(
          'div',
          { class: 'nova-live-player-control-left' },
          ...LEFT_ACTIONS.map((action) =>
            this.renderButton(action, props, action === 'toggle-mute' ? volumeState : null),
          ),
        ),
        h(
          'div',
          { class: 'nova-live-player-control-time nova-live-player-control-tip-wrap' },
          h('span', { class: 'nova-live-player-control-time-label' }, t('livePlayer.info.liveDuration')),
          h('span', { class: 'nova-live-player-control-time-value' }, text((): string => props.liveTime.value)),
          h(
            'span',
            { class: 'nova-live-player-control-tip' },
            t('livePlayer.info.liveDuration'),
          ),
        ),
        h(
          'div',
          { class: 'nova-live-player-control-right' },
          ...RIGHT_ACTIONS.map((action) => this.renderButton(action, props, null)),
        ),
      ),
    );
  }

  /** 渲染单个按钮。 */
  /** 控件提示文案，随当前状态变化。 */
  private tipLabel(key: NovaControlAction, props: ControlBarProps): string {
    switch (key) {
      case 'toggle-play':
        return props.playing.value ? t('livePlayer.control.pause') : t('livePlayer.control.play');
      case 'toggle-mute':
        return props.muted.value || props.volume.value === 0
          ? t('livePlayer.control.unmute')
          : t('livePlayer.control.mute');
      case 'toggle-danmaku':
        return props.danmakuOn.value
          ? t('livePlayer.control.danmakuOff')
          : t('livePlayer.control.danmakuOn');
      case 'webscreen':
        return props.screenMode.value === 'webscreen'
          ? t('livePlayer.control.exitWebscreen')
          : t('livePlayer.control.webscreen');
      case 'fullscreen':
        return props.screenMode.value === 'fullscreen'
          ? t('livePlayer.control.exitFullscreen')
          : t('livePlayer.control.fullscreen');
      default:
        return t(BUTTONS[key].label);
    }
  }

  private renderButton(
    key: NovaControlAction,
    props: ControlBarProps,
    volumeState: VolumeState | null,
  ): VNode {
    const spec = BUTTONS[key];
    /** 弹幕关闭时「弹幕设置」按钮进入禁用态（hover / 点击都不打开面板）。 */
    const disabled = (): boolean => key === 'danmaku-setting' && !props.danmakuOn.value;
    const wrapProps = {
      class:
        key === 'toggle-mute'
          ? 'nova-live-player-control-tip-wrap nova-live-player-control-volume-wrap'
          : 'nova-live-player-control-tip-wrap',
      onMouseenter: (): void => {
        if (spec.panel && !disabled()) props.onPanelHover(spec.panel);
        if (volumeState) volumeState.show();
      },
      onMouseleave: (): void => {
        if (spec.panel) props.onPanelLeave(spec.panel);
        if (volumeState) volumeState.hide();
      },
    };

    const buttonAttrs: Record<string, unknown> = {
      type: 'button',
      'data-action': spec.action,
      'aria-label': t(spec.label),
      onClick: (): void => props.onAction(spec.action),
    };
    if (key === 'webscreen' || key === 'fullscreen') {
      buttonAttrs.__reactiveAttrs = {
        class: (): string =>
          `nova-live-player-control-button${spec.text ? ' is-text' : ''}${
            (key === 'webscreen' && props.screenMode.value === 'webscreen') ||
            (key === 'fullscreen' && props.screenMode.value === 'fullscreen')
              ? ' is-active'
              : ''
          }`,
      };
    } else if (key === 'danmaku-setting') {
      buttonAttrs.__reactiveAttrs = {
        class: (): string =>
          `nova-live-player-control-button${spec.text ? ' is-text' : ''}${disabled() ? ' is-disabled' : ''}`,
        'aria-disabled': (): string => String(disabled()),
      };
    } else {
      buttonAttrs.class = ['nova-live-player-control-button', { 'is-text': spec.text === true }];
    }

    const button = h('button', buttonAttrs, this.renderButtonContent(key, props));

    if (key === 'toggle-mute' && volumeState) {
      return h(
        'div',
        wrapProps,
        button,
        this.renderVolume(props, volumeState),
        h('span', { class: 'nova-live-player-control-tip' }, text((): string => this.tipLabel(key, props))),
      );
    }
    return h(
      'div',
      wrapProps,
      button,
      h('span', { class: 'nova-live-player-control-tip' }, text((): string => this.tipLabel(key, props))),
    );
  }

  /** 渲染按钮内容。 */
  private renderButtonContent(key: NovaControlAction, props: ControlBarProps): VNode {
    if (key === 'quality') {
      return text((): string => props.qualityLabel.value || t('livePlayer.control.quality'));
    }
    if (key === 'toggle-play') {
      return h(
        'span',
        { class: 'nova-live-player-control-icon' },
        h(
          'span',
          { class: 'nova-live-player-icon-play', ...reactive({ hidden: (): boolean => props.playing.value }) },
          icon(playIcon(), 'nova-live-player-icon'),
        ),
        h(
          'span',
          { class: 'nova-live-player-icon-pause', ...reactive({ hidden: (): boolean => !props.playing.value }) },
          icon(pauseIcon(), 'nova-live-player-icon'),
        ),
      );
    }
    if (key === 'toggle-mute') {
      return h(
        'span',
        { class: 'nova-live-player-control-icon' },
        h(
          'span',
          { ...reactive({ hidden: (): boolean => props.muted.value || props.volume.value === 0 }) },
          icon(volumeIcon(), 'nova-live-player-icon'),
        ),
        h(
          'span',
          { ...reactive({ hidden: (): boolean => !(props.muted.value || props.volume.value === 0) }) },
          icon(mutedIcon(), 'nova-live-player-icon'),
        ),
      );
    }
    if (key === 'toggle-danmaku') {
      return h(
        'span',
        { class: 'nova-live-player-control-icon' },
        h(
          'span',
          { ...reactive({ hidden: (): boolean => !props.danmakuOn.value }) },
          icon(danmakuIcon(), 'nova-live-player-icon'),
        ),
        h(
          'span',
          { ...reactive({ hidden: (): boolean => props.danmakuOn.value }) },
          icon(danmakuOffIcon(), 'nova-live-player-icon'),
        ),
      );
    }
    if (key === 'webscreen') {
      const active = (): boolean => props.screenMode.value === 'webscreen';
      return h(
        'span',
        { class: 'nova-live-player-control-icon' },
        h(
          'span',
          { ...reactive({ hidden: active }) },
          icon(webscreenIcon(), 'nova-live-player-icon'),
        ),
        h(
          'span',
          { ...reactive({ hidden: (): boolean => !active() }) },
          icon(exitWebscreenIcon(), 'nova-live-player-icon'),
        ),
      );
    }
    if (key === 'fullscreen') {
      const active = (): boolean => props.screenMode.value === 'fullscreen';
      return h(
        'span',
        { class: 'nova-live-player-control-icon' },
        h(
          'span',
          { ...reactive({ hidden: active }) },
          icon(fullscreenIcon(), 'nova-live-player-icon'),
        ),
        h(
          'span',
          { ...reactive({ hidden: (): boolean => !active() }) },
          icon(exitFullscreenIcon(), 'nova-live-player-icon'),
        ),
      );
    }
    if (key === 'danmaku-setting') return icon(danmakuSettingIcon(), 'nova-live-player-control-icon');
    if (key === 'send-danmaku') return icon(sendIcon(), 'nova-live-player-control-icon');
    if (key === 'refresh') return icon(refreshIcon(), 'nova-live-player-control-icon');
    return h('span', {});
  }

  /** 渲染竖向音量浮层（浮层是 wrap 的子节点，移动到滑块不会触发关闭）。 */
  private renderVolume(props: ControlBarProps, state: VolumeState): VNode {
    let dragging = false;
    const updateFromClientY = (clientY: number, rail: HTMLElement): void => {
      const rect = rail.getBoundingClientRect();
      if (rect.height <= 0) return;
      const ratio = 1 - (clientY - rect.top) / rect.height;
      props.onVolume(Math.max(0, Math.min(100, Math.round(ratio * 100))));
    };
    return h(
      'div',
      {
        class: 'nova-live-player-volume',
        ...reactive({ hidden: (): boolean => !state.open.value }),
        onMouseenter: (): void => state.show(),
        onMouseleave: (): void => state.hide(),
      },
      h('div', { class: 'nova-live-player-volume-value' }, text((): string => String(props.volume.value))),
      h(
        'div',
        {
          class: 'nova-live-player-volume-rail',
          role: 'slider',
          onPointerdown: (event: PointerEvent): void => {
            const rail = event.currentTarget as HTMLElement;
            dragging = true;
            updateFromClientY(event.clientY, rail);
            const onMove = (moveEvent: PointerEvent): void => {
              if (dragging) updateFromClientY(moveEvent.clientY, rail);
            };
            const stop = (): void => {
              dragging = false;
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
          class: 'nova-live-player-volume-fill',
          ...reactive({ style: (): Record<string, string> => ({ height: `${props.volume.value}%` }) }),
        }),
        h('div', {
          class: 'nova-live-player-volume-thumb',
          ...reactive({ style: (): Record<string, string> => ({ bottom: `${props.volume.value}%` }) }),
        }),
      ),
    );
  }
}
