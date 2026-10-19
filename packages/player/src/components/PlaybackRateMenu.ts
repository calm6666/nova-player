/**
 * ============================================
 * 播放倍速选择菜单组件 (PlaybackRateMenu)
 * ============================================
 * 声明式响应式版本：
 * - 当前倍速由 currentRateSignal 驱动（结果文案 _reactiveText / 项高亮 class）
 * - 面板展开态由 shownSignal 驱动根节点 state-show 类（__reactiveAttrs），
 *   hover 定时器（rafTimeout）仅负责延迟时序并写信号，不直接操作 DOM
 */

import {
  h,
  defineComponent,
  useReactiveState,
  useContext,
  t,
  signal,
  onEffect,
  For,
} from "@/core";
import type { VNode } from "@/types";
import { useComponentUnmount } from "@/nova/core/componentUnmount";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import type { AnimationFrameID } from "@/utils/rafTimeout";
import { PlayerStateKeyEnum, StateContext } from "@/store/runtimeState";

const MENU_SHOW_DELAY = 120;
const MENU_HIDE_DELAY = 220;

/**
 * PlaybackRateMenu 组件 Props 接口
 */
export interface PlaybackRateMenuProps {
  rate?: number;
  rates?: number[];
}

export type PlaybackRateMenuEvents = {
  rateChange: number;
  /** 挂载完成回传控制方法（供父层在倍速被外部改变时同步 UI） */
  playbackRateMenuMounted: { setRate: (rate: number) => void };
};

/**
 * PlaybackRateMenu 组件 - 使用 defineComponent 创建独立组件
 * 渲染播放倍速选择菜单，支持当前倍速高亮
 */
export const PlaybackRateMenu = defineComponent<
  PlaybackRateMenuProps,
  PlaybackRateMenuEvents
>((props, lifecycle) => {
  /** 初始倍速与可选档位 */
  const { rate = 1, rates = [2, 1.5, 1.25, 1, 0.75, 0.5] } = props;

  /** 运行时状态管理器（用于订阅当前倍速） */
  const state = useContext(StateContext);

  // ============================================
  // 面板展开态（hover 定时器时序 + signal 驱动类名）
  // ============================================

  /** 展开定时器 */
  let showTimer: AnimationFrameID | null = null;

  /** 收起定时器 */
  let hideTimer: AnimationFrameID | null = null;

  /**
   * 响应式信号：面板展开态
   * 驱动根节点 state-show 类（编译器包装为 __reactiveAttrs，
   * 变化时经 normalizeClass 精准更新类名），
   * 替代旧的 rootRef.classList.toggle 命令式写法
   */
  const shownSignal = signal<boolean>(false);

  /**
   * 落地面板展开态：写信号即可，DOM 类名由响应式系统自动同步
   * @param show - 是否展开
   */
  const setShown = (show: boolean): void => {
    shownSignal.value = show;
  };

  /** 取消两个方向的排队任务 */
  const clearTimers = (): void => {
    cancelRaf(showTimer!);
    cancelRaf(hideTimer!);
    showTimer = null;
    hideTimer = null;
  };

  // ============================================
  // 响应式信号
  // ============================================

  /**
   * 响应式信号：当前倍速
   * 替代旧的 let currentRate = rate 可变变量
   * signal 变化时自动驱动 _reactiveText 更新结果文案 + onEffect 更新高亮
   */
  const currentRateSignal = signal<number>(rate);

  /**
   * 响应式信号：运行时倍速状态（外部改变时同步）
   * useReactiveState 返回 Signal，读取 .value 自动建立依赖
   * 替代旧的 useState(state, PLAYBACK_RATE, (next) => setRate(next), lifecycle)
   */
  const playbackRateStateSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.PLAYBACK_RATE, lifecycle)
    : signal<unknown>(undefined);

  /**
   * 响应式同步：运行时倍速变化 → 更新本地倍速信号
   * onEffect 内读取 playbackRateStateSignal.value 自动追踪
   * 替代旧的 useState updater 回调
   */
  onEffect(lifecycle, () => {
    const next = playbackRateStateSignal.value;
    if (typeof next === "number") currentRateSignal.value = next;
  });

  // ============================================
  // 渲染辅助函数
  // ============================================

  /**
   * 格式化倍速标签文本
   * @param rateValue - 倍速值
   * @returns 格式化后的显示文本
   */
  const formatRateLabel = (rateValue: number): string => {
    return rateValue === 1 ? "1.0X" : `${rateValue}X`;
  };

  /**
   * 统一的倍速更新入口：更新信号（响应式系统自动刷新文本与高亮）
   * @param next - 新的倍速值
   */
  const setRate = (next: number): void => {
    currentRateSignal.value = next;
  };

  // ============================================
  // 事件处理函数
  // ============================================

  /**
   * 鼠标进入倍速按钮：延迟展开面板（面板显隐由本组件自己负责）
   */
  const handleMouseEnter = (): void => {
    cancelRaf(hideTimer!);
    hideTimer = null;
    if (showTimer !== null) return;
    showTimer = rafTimeout(() => {
      showTimer = null;
      setShown(true);
    }, MENU_SHOW_DELAY);
  };

  /**
   * 鼠标离开倍速按钮：延迟收起面板
   */
  const handleMouseLeave = (): void => {
    cancelRaf(showTimer!);
    showTimer = null;
    if (hideTimer !== null) return;
    hideTimer = rafTimeout(() => {
      hideTimer = null;
      setShown(false);
    }, MENU_HIDE_DELAY);
  };

  /**
   * 渲染单个倍速菜单项（For 组件的 render 回调）
   * 每个 key 只调用一次，选中态由响应式 class（currentRateSignal.value 自动驱动）自动同步
   * @param rateValue - 倍速值
   * @returns 菜单项 VNode
   */
  const renderRateItem = (rateValue: number): VNode =>
    h(
      "li",
      {
        class: [
          "nova-player-ctrl-playbackrate-menu-item",
          { "nova-player-state-active": currentRateSignal.value === rateValue },
        ],
        "data-value": rateValue.toString(),
        onClick: () => {
          // 先本地反馈，随后由运行时状态订阅统一校正
          setRate(rateValue);
          lifecycle.emit?.("rateChange", rateValue);
        },
      },
      formatRateLabel(rateValue),
    );

  // ============================================
  // 生命周期钩子
  // ============================================

  /**
   * 组件挂载后：回传控制方法，供父层主动同步
   * 文本与高亮已由 _reactiveText / onEffect 响应式管理，无需手动初始化
   */
  lifecycle.onMounted = (): void => {
    lifecycle.emit?.("playbackRateMenuMounted", { setRate });
  };

  useComponentUnmount(lifecycle, clearTimers);

  // ============================================
  // 主渲染函数
  // ============================================

  return h(
    "div",
    {
      // 展开态类名由 shownSignal 响应式驱动（__reactiveAttrs + normalizeClass）
      class: [
        "nova-player-ctrl-btn",
        "nova-player-ctrl-playbackrate",
        { "state-show": shownSignal.value },
      ],
      role: "button",
      "aria-label": t("player.ui.controls.playbackRate"),
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    },
    // 当前倍速显示：显式零参箭头 getter 协议
    // （t() 内部读取 localeSignal，显式 getter 才能在 currentRate 变化与
    // setLocale 语言切换时都重新求值；写成直接表达式会被求值成静态文本，
    // 切语言后「倍速」两个字不会跟着翻译）
    h(
      "div",
      { class: "nova-player-ctrl-playbackrate-result" },
      () => {
        const rateValue = currentRateSignal.value;
        return rateValue === 1
          ? t("player.ui.controls.playbackRate")
          : formatRateLabel(rateValue);
      },
    ),
    // 倍速下拉菜单（For 组件：key-based 精准更新，每个倍速值只渲染一次）
    h(
      "div",
      { class: "nova-player-ctrl-playbackrate-menu-wrap" },
      h(
        "ul",
        { class: "nova-player-ctrl-playbackrate-menu" },
        h(For, {
          each: rates,
          key: (_item: unknown, _index: number) => String(_item),
          // For 回调入参为 unknown：typeof 收窄（替代 as 断言）
          render: (item: unknown, _index: number): VNode =>
            typeof item === "number" ? renderRateItem(item) : h("li", {}),
        }),
      ),
    ),
  );
});
