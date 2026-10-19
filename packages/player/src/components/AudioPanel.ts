/**
 * ============================================
 * 音效调节面板（右键菜单 → 音效调节）
 * ============================================
 * 仅在加载 audioEffect 插件后由 PlayerDocker 懒挂载。
 * 两页：
 * - 预设：3×3 组合预设 + 音量增强滑块 + 重置 / 自定义
 * - 均衡器：预设 / 段数选择 + 5/10 段竖向 EQ + 重置
 */

import { h, defineComponent, signal, t, useTemplateRef } from "@/core";
import type { ComponentLifecycle } from "@/types";

/** 音效插件面板使用的最小 API 契约 */
export interface AudioPanelApi {
  setVolume?(db: number): void;
  selectCombination?(preset: string): void;
  setEQPreset?(preset: string, bandCount?: string): void;
  setEQGains?(gains: readonly number[]): void;
}

export interface AudioPanelProps {
  /** 音效插件 API（未装插件时不会挂载本组件） */
  api?: AudioPanelApi | null;
  /** 关闭面板 */
  onClose?: () => void;
}

export interface AudioPanelHandle {
  open: () => void;
  close: () => void;
}

/** 组合预设（与 audioEffect 插件的 CombinationPresetName 对齐） */
const PRESETS: ReadonlyArray<{ value: string; key: string }> = [
  { value: "a3d", key: "player.ui.audio.preset.a3d" },
  { value: "bassBooster", key: "player.ui.audio.preset.bass" },
  { value: "bathroom", key: "player.ui.audio.preset.bathroom" },
  { value: "concertHall", key: "player.ui.audio.preset.hall" },
  { value: "phone", key: "player.ui.audio.preset.phone" },
  { value: "piano", key: "player.ui.audio.preset.piano" },
  { value: "pop", key: "player.ui.audio.preset.pop" },
  { value: "rnb", key: "player.ui.audio.preset.rnb" },
  { value: "spokenWord", key: "player.ui.audio.preset.vocal" },
];

/** EQ 预设 */
const EQ_PRESETS: ReadonlyArray<{ value: string; key: string }> = [
  { value: "default", key: "player.ui.audio.eq.default" },
  { value: "classical", key: "player.ui.audio.eq.classical" },
  { value: "dance", key: "player.ui.audio.eq.dance" },
  { value: "deep", key: "player.ui.audio.eq.deep" },
  { value: "electronic", key: "player.ui.audio.eq.electronic" },
  { value: "hiphop", key: "player.ui.audio.eq.hiphop" },
  { value: "jazz", key: "player.ui.audio.eq.jazz" },
  { value: "latin", key: "player.ui.audio.eq.latin" },
  { value: "piano", key: "player.ui.audio.eq.piano" },
  { value: "pop", key: "player.ui.audio.eq.pop" },
  { value: "rnb", key: "player.ui.audio.eq.rnb" },
  { value: "rock", key: "player.ui.audio.eq.rock" },
  { value: "spokenWord", key: "player.ui.audio.eq.spoken" },
];

/** EQ 频段标签 */
const EQ_BANDS: Readonly<Record<"5" | "10", readonly string[]>> = {
  "5": ["60", "250", "1k", "4k", "12k"],
  "10": [
    "32",
    "64",
    "125",
    "250",
    "500",
    "1k",
    "2k",
    "4k",
    "8k",
    "16k",
  ],
};

/** 关闭图标（16×16 线性） */
const CLOSE_PATH =
  "m8 6.939 3.182-3.182a.75.75 0 1 1 1.061 1.061L9.061 8l3.182 3.182a.75.75 0 1 1-1.061 1.061L8 9.061l-3.182 3.182a.75.75 0 1 1-1.061-1.061L6.939 8 3.757 4.818a.75.75 0 1 1 1.061-1.061L8 6.939z";

export const AudioPanel = defineComponent<AudioPanelProps>(
  (props, lifecycle: ComponentLifecycle) => {
    const panelRef = useTemplateRef<HTMLDivElement>(lifecycle, "panelRef");
    const activeSignal = signal(false);
    const pageSignal = signal<"preset" | "eq">("preset");
    const gainSignal = signal(0);
    const bandCountSignal = signal<"5" | "10">("10");
    const eqPresetSignal = signal("default");
    const gainsSignal = signal<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const close = (): void => {
      activeSignal.value = false;
    };

    const open = (): void => {
      activeSignal.value = true;
      pageSignal.value = "preset";
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("audioPanelMounted", { open, close } as AudioPanelHandle);
    };

    /** 把信号状态同步回原生 range（重置 / 切段数后受控回显） */
    const syncInputs = (): void => {
      const root = panelRef.value;
      if (!root) return;
      const gain = root.querySelector<HTMLInputElement>(
        ".nova-audio-panel-range",
      );
      if (gain) gain.value = String(gainSignal.value);
      root
        .querySelectorAll<HTMLInputElement>(".nova-audio-panel-eq-range")
        .forEach((input, index) => {
          input.value = String(gainsSignal.value[index] ?? 0);
        });
    };

    /** 应用组合预设 */
    const choosePreset = (value: string): void => {
      props.api?.selectCombination?.(value);
    };

    /** 音量增强滑块 */
    const changeGain = (value: number): void => {
      gainSignal.value = value;
      props.api?.setVolume?.(value);
    };

    /** 重置 */
    const reset = (): void => {
      choosePreset("default");
      changeGain(0);
      syncInputs();
    };

    /** 切换 EQ 段数 */
    const changeBandCount = (count: "5" | "10"): void => {
      bandCountSignal.value = count;
      gainsSignal.value = Array.from(
        { length: count === "5" ? 5 : 10 },
        () => 0,
      );
      props.api?.setEQPreset?.(eqPresetSignal.value, count);
      requestAnimationFrame(syncInputs);
    };

    /** EQ 预设变化 */
    const changeEqPreset = (preset: string): void => {
      eqPresetSignal.value = preset;
      props.api?.setEQPreset?.(preset, bandCountSignal.value);
    };

    /** 单段增益变化 */
    const changeBand = (index: number, value: number): void => {
      const next = [...gainsSignal.value];
      next[index] = value;
      gainsSignal.value = next;
      props.api?.setEQGains?.(next);
    };

    /** EQ 重置 */
    const resetEq = (): void => {
      changeEqPreset("default");
      gainsSignal.value = Array.from(
        { length: bandCountSignal.value === "5" ? 5 : 10 },
        () => 0,
      );
      props.api?.setEQGains?.(gainsSignal.value);
      requestAnimationFrame(syncInputs);
    };

    const closeButton = (): ReturnType<typeof h> =>
      h(
        "div",
        {
          class: "nova-audio-panel-close",
          role: "button",
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            close();
          },
        },
        h(
          "svg",
          { viewBox: "0 0 16 16" },
          h("path", { d: CLOSE_PATH, fill: "currentColor" }),
        ),
      );

    /** 第一页：组合预设 */
    const renderPresetPage = (): ReturnType<typeof h> =>
      h(
        "div",
        { class: "nova-audio-panel-page" },
        h(
          "div",
          { class: "nova-audio-panel-title" },
          t("player.ui.audio.title"),
        ),
        closeButton(),
        h(
          "div",
          { class: "nova-audio-panel-presets" },
          ...PRESETS.map((preset) =>
            h(
              "button",
              {
                class: "nova-audio-panel-preset",
                type: "button",
                onClick: () => choosePreset(preset.value),
              },
              t(preset.key),
            ),
          ),
        ),
        h(
          "div",
          { class: "nova-audio-panel-gain" },
          h(
            "span",
            { class: "nova-audio-panel-gain-title" },
            t("player.ui.audio.gain"),
          ),
          h(
            "div",
            { class: "nova-audio-panel-gain-control" },
            h("span", { class: "nova-audio-panel-gain-edge" }, "-12dp"),
            h("input", {
              class: "nova-audio-panel-range",
              type: "range",
              min: -12,
              max: 12,
              step: 1,
              value: String(gainSignal.value),
              onInput: (event: Event) => {
                const target = event.target;
                if (target instanceof HTMLInputElement) {
                  changeGain(Number(target.value));
                }
              },
            }),
            h("span", { class: "nova-audio-panel-gain-edge" }, "+12dp"),
          ),
        ),
        h(
          "div",
          { class: "nova-audio-panel-footer" },
          h(
            "button",
            {
              class: "nova-audio-panel-reset",
              type: "button",
              onClick: reset,
            },
            t("player.ui.audio.reset"),
          ),
          h(
            "span",
            {
              class: "nova-audio-panel-more",
              onClick: () => {
                pageSignal.value = "eq";
              },
            },
            t("player.ui.audio.custom"),
          ),
        ),
      );

    /** 第二页：均衡器 */
    const renderEqPage = (): ReturnType<typeof h> =>
      h(
        "div",
        { class: "nova-audio-panel-page nova-audio-panel-eq-page" },
        h(
          "div",
          { class: "nova-audio-panel-eq-header" },
          h(
            "span",
            {
              class: "nova-audio-panel-back",
              onClick: () => {
                pageSignal.value = "preset";
              },
            },
            t("player.ui.audio.preset_page"),
          ),
          h(
            "label",
            { class: "nova-audio-panel-select-label" },
            t("player.ui.audio.eq_label"),
            h(
              "select",
              {
                class: "nova-audio-panel-select",
                onChange: (event: Event) => {
                  const target = event.target;
                  if (target instanceof HTMLSelectElement) {
                    changeEqPreset(target.value);
                  }
                },
              },
              ...EQ_PRESETS.map((preset) =>
                h(
                  "option",
                  {
                    value: preset.value,
                    selected: eqPresetSignal.value === preset.value,
                  },
                  t(preset.key),
                ),
              ),
            ),
          ),
          h(
            "label",
            { class: "nova-audio-panel-select-label" },
            t("player.ui.audio.band_label"),
            h(
              "select",
              {
                class: "nova-audio-panel-select",
                onChange: (event: Event) => {
                  const target = event.target;
                  if (target instanceof HTMLSelectElement) {
                    changeBandCount(target.value as "5" | "10");
                  }
                },
              },
              h(
                "option",
                { value: "3", disabled: true },
                "3",
              ),
              h("option", { value: "5" }, "5段"),
              h(
                "option",
                { value: "10", selected: bandCountSignal.value === "10" },
                "10段",
              ),
            ),
          ),
          closeButton(),
        ),
        h(
          "div",
          { class: "nova-audio-panel-eq-scale" },
          h("span", {}, "+12"),
          h("span", {}, "0"),
          h("span", {}, "-12"),
        ),
        h(
          "div",
          { class: "nova-audio-panel-eq-bands" },
          ...(EQ_BANDS[bandCountSignal.value] as readonly string[]).map(
            (label, index) =>
              h(
                "div",
                { class: "nova-audio-panel-eq-band" },
                h("input", {
                  class: "nova-audio-panel-eq-range",
                  type: "range",
                  min: -12,
                  max: 12,
                  step: 1,
                  value: String(gainsSignal.value[index] ?? 0),
                  onInput: (event: Event) => {
                    const target = event.target;
                    if (target instanceof HTMLInputElement) {
                      changeBand(index, Number(target.value));
                    }
                  },
                }),
                h("span", { class: "nova-audio-panel-eq-key" }, label),
              ),
          ),
        ),
        h(
          "button",
          {
            class: "nova-audio-panel-eq-reset",
            type: "button",
            onClick: resetEq,
          },
          t("player.ui.audio.reset"),
        ),
      );

    return h(
      "div",
      {
        ref: "panelRef",
        class: [
          "nova-player-audio-panel",
          { "nova-player-panel-active": activeSignal.value },
        ],
        style: { display: activeSignal.value ? "flex" : "none" },
      },
      h(
        "div",
        { class: "nova-audio-panel-move" },
        h(
          "div",
          {
            class: [
              "nova-audio-panel-view",
              { "nova-player-panel-active": pageSignal.value === "preset" },
            ],
          },
          renderPresetPage(),
        ),
        h(
          "div",
          {
            class: [
              "nova-audio-panel-view",
              { "nova-player-panel-active": pageSignal.value === "eq" },
            ],
          },
          renderEqPage(),
        ),
      ),
    );
  },
);
