/**
 * `<nova-live-player-control-bar>` 控制层 Web Component。
 *
 * 内部使用 Lumina 框架声明式渲染：控制条结构与状态更新全部由 VNode /
 * signal 完成；对外只暴露 `bind()` 注入信号与回调。
 */

import { h, signal, t } from "@/core";
import type { Signal } from "@/core";
import {
  danmakuIcon,
  danmakuOffIcon,
  danmakuSettingIcon,
  exitFullscreenIcon,
  exitMiniIcon,
  exitWebscreenIcon,
  fullscreenIcon,
  miniIcon,
  mutedIcon,
  pauseIcon,
  playIcon,
  refreshIcon,
  sendIcon,
  volumeIcon,
  webscreenIcon,
} from "@/live/icons";
import type {
  NovaControlAction,
  NovaPanelName,
  NovaScreenMode,
} from "@/live/types";
import type { LiveTimerRegistry } from "@/live/core/timers";
import type { VNode } from "@/types";
import { NovaLiveUiElement } from "./base";
import { icon, reactive, text } from "../ui/helpers";

/** 控制层标签名。 */
export const CONTROL_BAR_TAG = "nova-live-player-control-bar";

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
  /** 是否已安装弹幕插件（未安装时弹幕入口禁用并 Toast 提示）。 */
  danmakuAvailable: boolean;
  /** 清晰度文案。 */
  qualityLabel: Signal<string>;
  /** 倍速文案。 */
  speedLabel: Signal<string>;
  /** 屏幕形态。 */
  screenMode: Signal<NovaScreenMode>;
  /** 是否处于小窗（悬浮小播放器）状态。 */
  mini: Signal<boolean>;
  /** 控制条是否显示。 */
  visible: Signal<boolean>;
  /** 开播时长文案。 */
  liveTime: Signal<string>;
  /** 统一计时器注册表（音量浮层延迟隐藏等）。 */
  timers: LiveTimerRegistry;
  /** 动作回调。 */
  onAction: (action: NovaControlAction) => void;
  /** 音量回调。 */
  onVolume: (volume: number) => void;
  /** 音量浮层 hover 状态（让控制条在浮层打开时保持显示）。 */
  onVolumeHover: (open: boolean) => void;
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
const LEFT_ACTIONS: NovaControlAction[] = [
  "toggle-play",
  "refresh",
  "toggle-mute",
];

/** 右侧按钮顺序。 */
const RIGHT_ACTIONS: NovaControlAction[] = [
  "quality",
  "toggle-danmaku",
  "danmaku-setting",
  "send-danmaku",
  "webscreen",
  "mini",
  "fullscreen",
];

/** 按钮静态定义。 */
const BUTTONS: Record<string, ButtonSpec> = {
  "toggle-play": { action: "toggle-play", label: "livePlayer.control.play" },
  "toggle-mute": { action: "toggle-mute", label: "livePlayer.control.mute" },
  refresh: { action: "refresh", label: "livePlayer.control.refresh" },
  quality: {
    action: "quality",
    label: "livePlayer.control.quality",
    text: true,
    panel: "quality",
  },
  "toggle-danmaku": {
    action: "toggle-danmaku",
    label: "livePlayer.control.danmaku",
  },
  "danmaku-setting": {
    action: "danmaku-setting",
    label: "livePlayer.control.danmakuSetting",
    panel: "danmaku",
  },
  "send-danmaku": { action: "send-danmaku", label: "livePlayer.control.send" },
  speed: {
    action: "speed",
    label: "livePlayer.control.speed",
    text: true,
    panel: "speed",
  },
  webscreen: { action: "webscreen", label: "livePlayer.control.webscreen" },
  mini: { action: "mini", label: "livePlayer.control.mini" },
  fullscreen: { action: "fullscreen", label: "livePlayer.control.fullscreen" },
};

/** 音量浮层隐藏延时（hover-intent：离开按钮 / 浮层后稍等再关）。 */
const VOLUME_HIDE_DELAY = 180;

/** 音量浮层计时器键（同一元素只有一个待隐藏计时器）。 */
const VOLUME_HIDE_TIMER = "volume-hide";

/** 控制层元素。 */
export class NovaLivePlayerControlBarElement extends NovaLiveUiElement {
  /** 注入参数。 */
  private props: ControlBarProps | null = null;

  /** 音量浮层显示状态（实例级，重建视图不会丢失）。 */
  private readonly volumeOpen = signal(false);

  /** 注入信号与回调并重建视图。 */
  public bind(props: ControlBarProps): void {
    this.props = props;
    this.remountView();
  }

  /** 离开文档：收起音量浮层（计时器由根元素的统一注册表清理）。 */
  protected onDisconnect(): void {
    this.volumeOpen.value = false;
    this.props = null;
  }

  /** 显示音量浮层，并清除可能存在的隐藏计时器。 */
  private showVolume(): void {
    this.props?.timers.clearTimeout(VOLUME_HIDE_TIMER);
    if (!this.volumeOpen.value) this.volumeOpen.value = true;
    this.props?.onVolumeHover(true);
  }

  /** 延迟隐藏音量浮层（重复调度只保留一个待执行计时器）。 */
  private scheduleHideVolume(): void {
    this.props?.timers.setTimeout(
      VOLUME_HIDE_TIMER,
      (): void => {
        this.volumeOpen.value = false;
        this.props?.onVolumeHover(false);
      },
      VOLUME_HIDE_DELAY,
    );
  }

  /** 渲染控制条。 */
  protected render(): VNode {
    if (!this.props) return h("div", { class: "nova-live-player-control" });
    return this.renderControlBar(this.props);
  }

  /** 渲染控制层主体。 */
  private renderControlBar(props: ControlBarProps): VNode {
    return h(
      "div",
      {
        class: "nova-live-player-control",
        ...reactive({
          "data-visible": (): string => String(props.visible.value),
        }),
      },
      h(
        "div",
        { class: "nova-live-player-control-area" },
        h(
          "div",
          { class: "nova-live-player-control-left" },
          ...LEFT_ACTIONS.map((action) =>
            this.renderButton(action, props, action === "toggle-mute"),
          ),
        ),
        h(
          "div",
          {
            class:
              "nova-live-player-control-time nova-live-player-control-tip-wrap",
          },
          h(
            "span",
            { class: "nova-live-player-control-time-label" },
            t("livePlayer.info.liveDuration"),
          ),
          h(
            "span",
            { class: "nova-live-player-control-time-value" },
            text((): string => props.liveTime.value),
          ),
          h(
            "span",
            { class: "nova-live-player-control-tip" },
            t("livePlayer.info.liveDuration"),
          ),
        ),
        h(
          "div",
          { class: "nova-live-player-control-right" },
          ...RIGHT_ACTIONS.map((action) => this.renderButton(action, props, false)),
        ),
      ),
    );
  }

  /** 渲染单个按钮。 */
  /** 控件提示文案，随当前状态变化。 */
  private tipLabel(key: NovaControlAction, props: ControlBarProps): string {
    switch (key) {
      case "toggle-play":
        return props.playing.value
          ? t("livePlayer.control.pause")
          : t("livePlayer.control.play");
      case "toggle-mute":
        return props.muted.value || props.volume.value === 0
          ? t("livePlayer.control.unmute")
          : t("livePlayer.control.mute");
      case "toggle-danmaku":
        return props.danmakuOn.value
          ? t("livePlayer.control.danmakuOff")
          : t("livePlayer.control.danmakuOn");
      case "webscreen":
        return props.screenMode.value === "webscreen"
          ? t("livePlayer.control.exitWebscreen")
          : t("livePlayer.control.webscreen");
      case "fullscreen":
        return props.screenMode.value === "fullscreen"
          ? t("livePlayer.control.exitFullscreen")
          : t("livePlayer.control.fullscreen");
      case "mini":
        return props.mini.value
          ? t("livePlayer.control.exitMini")
          : t("livePlayer.control.mini");
      default:
        return t(BUTTONS[key].label);
    }
  }

  private renderButton(
    key: NovaControlAction,
    props: ControlBarProps,
    withVolume: boolean,
  ): VNode {
    const spec = BUTTONS[key];
    const isDanmakuControl =
      key === "toggle-danmaku" ||
      key === "send-danmaku" ||
      key === "danmaku-setting";

    /**
     * 弹幕入口禁用条件：
     * - 未安装弹幕插件：开关 / 发送 / 设置全部禁用；
     * - 已安装但弹幕关闭：设置入口禁用（与点播播放器一致）。
     */
    const disabled = (): boolean => {
      if (isDanmakuControl && !props.danmakuAvailable) return true;
      return key === "danmaku-setting" && !props.danmakuOn.value;
    };

    const wrapProps = {
      class: withVolume
        ? "nova-live-player-control-tip-wrap nova-live-player-control-volume-wrap"
        : "nova-live-player-control-tip-wrap",
      onMouseenter: (): void => {
        if (spec.panel && !disabled()) props.onPanelHover(spec.panel);
        if (withVolume) this.showVolume();
      },
      onMouseleave: (): void => {
        if (spec.panel) props.onPanelLeave(spec.panel);
        if (withVolume) this.scheduleHideVolume();
      },
    };

    const buttonAttrs: Record<string, unknown> = {
      type: "button",
      "data-action": spec.action,
      "aria-label": t(spec.label),
      onClick: (): void => props.onAction(spec.action),
    };
    if (isDanmakuControl || key === "webscreen" || key === "fullscreen") {
      buttonAttrs.__reactiveAttrs = {
        class: (): string =>
          `nova-live-player-control-button${spec.text ? " is-text" : ""}${disabled() ? " is-disabled" : ""}`,
        "aria-disabled": (): string => String(disabled()),
      };
    } else if (key === "mini") {
      // 小窗按钮的 tooltip / 无障碍文案随状态切换。
      buttonAttrs.__reactiveAttrs = {
        class: (): string => "nova-live-player-control-button",
        "aria-label": (): string => this.tipLabel(key, props),
      };
    } else {
      buttonAttrs.class = [
        "nova-live-player-control-button",
        { "is-text": spec.text === true },
      ];
    }

    const button = h(
      "button",
      buttonAttrs,
      this.renderButtonContent(key, props),
    );

    if (withVolume) {
      return h(
        "div",
        wrapProps,
        button,
        this.renderVolume(props),
        h(
          "span",
          { class: "nova-live-player-control-tip" },
          text((): string => this.tipLabel(key, props)),
        ),
      );
    }
    return h(
      "div",
      wrapProps,
      button,
      h(
        "span",
        { class: "nova-live-player-control-tip" },
        text((): string => this.tipLabel(key, props)),
      ),
    );
  }

  /** 渲染按钮内容。 */
  private renderButtonContent(
    key: NovaControlAction,
    props: ControlBarProps,
  ): VNode {
    if (key === "quality") {
      return text(
        (): string =>
          props.qualityLabel.value || t("livePlayer.control.quality"),
      );
    }
    if (key === "toggle-play") {
      return h(
        "span",
        { class: "nova-live-player-control-icon" },
        h(
          "span",
          {
            class: "nova-live-player-icon-play",
            ...reactive({ hidden: (): boolean => props.playing.value }),
          },
          icon(playIcon(), "nova-live-player-icon"),
        ),
        h(
          "span",
          {
            class: "nova-live-player-icon-pause",
            ...reactive({ hidden: (): boolean => !props.playing.value }),
          },
          icon(pauseIcon(), "nova-live-player-icon"),
        ),
      );
    }
    if (key === "toggle-mute") {
      return h(
        "span",
        { class: "nova-live-player-control-icon" },
        h(
          "span",
          {
            ...reactive({
              hidden: (): boolean =>
                props.muted.value || props.volume.value === 0,
            }),
          },
          icon(volumeIcon(), "nova-live-player-icon"),
        ),
        h(
          "span",
          {
            ...reactive({
              hidden: (): boolean =>
                !(props.muted.value || props.volume.value === 0),
            }),
          },
          icon(mutedIcon(), "nova-live-player-icon"),
        ),
      );
    }
    if (key === "toggle-danmaku") {
      return h(
        "span",
        { class: "nova-live-player-control-icon" },
        h(
          "span",
          { ...reactive({ hidden: (): boolean => !props.danmakuOn.value }) },
          icon(danmakuIcon(), "nova-live-player-icon"),
        ),
        h(
          "span",
          { ...reactive({ hidden: (): boolean => props.danmakuOn.value }) },
          icon(danmakuOffIcon(), "nova-live-player-icon"),
        ),
      );
    }
    if (key === "webscreen") {
      const active = (): boolean => props.screenMode.value === "webscreen";
      return h(
        "span",
        { class: "nova-live-player-control-icon" },
        h(
          "span",
          { ...reactive({ hidden: active }) },
          icon(webscreenIcon(), "nova-live-player-icon"),
        ),
        h(
          "span",
          { ...reactive({ hidden: (): boolean => !active() }) },
          icon(exitWebscreenIcon(), "nova-live-player-icon"),
        ),
      );
    }
    if (key === "fullscreen") {
      const active = (): boolean => props.screenMode.value === "fullscreen";
      return h(
        "span",
        { class: "nova-live-player-control-icon" },
        h(
          "span",
          { ...reactive({ hidden: active }) },
          icon(fullscreenIcon(), "nova-live-player-icon"),
        ),
        h(
          "span",
          { ...reactive({ hidden: (): boolean => !active() }) },
          icon(exitFullscreenIcon(), "nova-live-player-icon"),
        ),
      );
    }
    if (key === "mini") {
      // 小窗按钮：进入小窗后图标与 tooltip 同步切换为「退出小窗模式」。
      const active = (): boolean => props.mini.value;
      return h(
        "span",
        { class: "nova-live-player-control-icon" },
        h(
          "span",
          { ...reactive({ hidden: active }) },
          icon(miniIcon(), "nova-live-player-icon"),
        ),
        h(
          "span",
          { ...reactive({ hidden: (): boolean => !active() }) },
          icon(exitMiniIcon(), "nova-live-player-icon"),
        ),
      );
    }
    if (key === "danmaku-setting")
      return icon(danmakuSettingIcon(), "nova-live-player-control-icon");
    if (key === "send-danmaku")
      return icon(sendIcon(), "nova-live-player-control-icon");
    if (key === "refresh")
      return icon(refreshIcon(), "nova-live-player-control-icon");
    return h("span", {});
  }

  /** 渲染竖向音量浮层（浮层是 wrap 的子节点，移动到滑块不会触发关闭）。 */
  private renderVolume(props: ControlBarProps): VNode {
    let dragging = false;
    const updateFromClientY = (clientY: number, rail: HTMLElement): void => {
      const rect = rail.getBoundingClientRect();
      if (rect.height <= 0) return;
      const ratio = 1 - (clientY - rect.top) / rect.height;
      props.onVolume(Math.max(0, Math.min(100, Math.round(ratio * 100))));
    };
    return h(
      "div",
      {
        class: "nova-live-player-volume",
        ...reactive({ hidden: (): boolean => !this.volumeOpen.value }),
        // hover-intent：进入浮层本体立刻取消按钮离开时排下的隐藏计时器，
        // 保证「hover 打开后立刻被另一个计时器关掉」不再发生。
        onMouseenter: (): void => this.showVolume(),
        onMouseleave: (): void => this.scheduleHideVolume(),
      },
      h(
        "div",
        { class: "nova-live-player-volume-value" },
        text((): string => String(props.volume.value)),
      ),
      h(
        "div",
        {
          class: "nova-live-player-volume-rail",
          role: "slider",
          onPointerdown: (event: PointerEvent): void => {
            const rail = event.currentTarget as HTMLElement;
            dragging = true;
            updateFromClientY(event.clientY, rail);
            const onMove = (moveEvent: PointerEvent): void => {
              if (dragging) updateFromClientY(moveEvent.clientY, rail);
            };
            const stop = (): void => {
              dragging = false;
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", stop);
              window.removeEventListener("pointercancel", stop);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", stop);
            window.addEventListener("pointercancel", stop);
          },
        },
        h("div", {
          class: "nova-live-player-volume-fill",
          ...reactive({
            style: (): Record<string, string> => ({
              height: `${props.volume.value}%`,
            }),
          }),
        }),
        h("div", {
          class: "nova-live-player-volume-thumb",
          ...reactive({
            style: (): Record<string, string> => ({
              bottom: `${props.volume.value}%`,
            }),
          }),
        }),
      ),
    );
  }
}
