/**
 * ============================================
 * DanmakuSwitch 弹幕开关（nano-ui: bui-danmaku-switch）
 * ============================================
 */

import { h, defineComponent, signal } from "@lumina/framework/core";
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";
import { rootClass } from "../shared";

export type DanmakuSwitchState = 1 | 2 | 3;

export interface DanmakuSwitchProps {
  /** 初始选中（二态） */
  value?: boolean;
  /** 三态模式 */
  threeState?: boolean;
  /** 初始状态（三态：1 开 / 2 半 / 3 关） */
  state?: DanmakuSwitchState;
  /** 开态内容 */
  onContent?: VNode | string;
  /** 半态内容 */
  middleContent?: VNode | string;
  /** 关态内容 */
  offContent?: VNode | string;
  /** 深色 */
  dark?: boolean;
  /** 禁用 */
  disabled?: boolean;
  /** 状态变化回调 */
  onChange?: (state: DanmakuSwitchState) => void;
}

export interface DanmakuSwitchApi {
  setState: (state: DanmakuSwitchState) => void;
  getState: () => DanmakuSwitchState;
}

export const DanmakuSwitch = defineComponent<DanmakuSwitchProps>(
  (props: DanmakuSwitchProps, lifecycle: ComponentLifecycle) => {
    const initial: DanmakuSwitchState = props.threeState
      ? (props.state ?? 3)
      : props.value
        ? 1
        : 3;
    const state = signal<DanmakuSwitchState>(initial);
    let input: HTMLInputElement | null = null;

    const apply = (next: DanmakuSwitchState): void => {
      state.value = next;
      if (input) {
        input.checked = next !== 3;
        input.indeterminate = next === 2;
      }
      props.onChange?.(next);
    };

    const handleChange = (event: Event): void => {
      if (props.disabled || !(event.target instanceof HTMLInputElement)) return;
      if (props.threeState) {
        apply(state.value === 1 ? 2 : state.value === 2 ? 3 : 1);
        return;
      }
      apply(event.target.checked ? 1 : 3);
    };

    lifecycle.onMounted = (): void => {
      if (input) {
        input.checked = state.value !== 3;
        input.indeterminate = state.value === 2;
      }
      lifecycle.emit?.("danmakuSwitchMounted", {
        setState: apply,
        getState: () => state.value,
      } satisfies DanmakuSwitchApi);
    };

    return h(
      "div",
      {
        class: [
          ...rootClass("danmaku-switch", props),
          props.threeState ? "lui-danmaku-switch-new" : "",
          `lui-danmaku-switch-state-${state.value}`,
        ],
      },
      h(
        "div",
        { class: "lui-area" },
        h("input", {
          class: "lui-danmaku-switch-input",
          type: "checkbox",
          ref: (el: Element) => { input = el as HTMLInputElement; },
          checked: state.value !== 3,
          disabled: Boolean(props.disabled),
          onChange: handleChange,
        }),
        h(
          "label",
          { class: "lui-danmaku-switch-label" },
          h("span", { class: "lui-danmaku-switch-on" }, props.onContent ?? ""),
          h("span", { class: "lui-danmaku-switch-middle" }, props.middleContent ?? ""),
          h("span", { class: "lui-danmaku-switch-off" }, props.offContent ?? ""),
        ),
      ),
    );
  },
);

export default DanmakuSwitch;
