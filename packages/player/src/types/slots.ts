/**
 * ============================================
 * 插槽注入类型定义 (slots)
 * ============================================
 *
 * 阶段 C.1：播放器支持外部通过配置注入控制栏插槽与片尾页面内容。
 *
 * 设计要点：
 * - 控制栏插槽走「配置数组 + 位置/顺序」：每项携带 position/order/vnode，
 *   由 LeftControls / RightControls / TopControls 按 position 分组、按 order 升序渲染。
 * - 片尾页面插槽走「整页替换」：传入 content 即替换默认 Ending 组件渲染。
 * - 插槽 VNode 的生命周期由播放器统一管理（mount/destroy），外部只负责构造 VNode。
 */

import { createContext } from '@/core';
import type { VNode } from '@/types';
import type { TypedStateManager } from '@/core';
import type { PlayerStateMap } from '@/store/runtimeState';
import type { VideoPlayer } from '@/nova/player';

/**
 * 插槽位置枚举
 *
 * - leftEnd：左侧按钮组末尾（prev / play / next / time 之后）
 * - rightStart：右侧按钮组开头（quality 之前）
 * - rightEnd：右侧按钮组末尾（full 之后）
 * - topRight：顶部栏右侧（与顶部进度条同层）
 * - bottomCenter：底部中央（LeftControls 与 RightControls 之间）
 */
export type ControlSlotPosition =
  | 'leftEnd'
  | 'rightStart'
  | 'rightEnd'
  | 'topRight'
  | 'bottomCenter';

/**
 * 单个插槽项
 */
export interface ControlSlotItem {
  /** 唯一 id，用于 diff / 卸载 */
  id: string;
  /** 插槽位置 */
  position: ControlSlotPosition;
  /**
   * 排序权重，小的在前；默认 0
   *
   * 同一 position 内多个插槽按 order 升序排列；同 order 时按数组顺序稳定排列。
   */
  order?: number;
  /**
   * VNode 或返回 VNode 的函数
   *
   * 函数形式接收 SlotContext，可读取 player / state 进行动态渲染。
   * 框架无响应式：函数仅在挂载期调用一次，外部若需更新需自行重建 VNode。
   */
  vnode: VNode | ((ctx: SlotContext) => VNode);
}

/**
 * 插槽上下文
 *
 * 传递给函数形式 vnode 的运行时上下文，供其访问播放器实例与状态管理器。
 */
export interface SlotContext {
  /** 播放器实例（可用于调用 API / 订阅事件） */
  player: VideoPlayer;
  /** 运行时状态管理器（与组件树内 useContext(StateContext) 同源） */
  state: TypedStateManager<PlayerStateMap>;
}

/**
 * 其它框架 UI 的挂载函数：播放器只提供已有容器，不创建包装 DOM。
 */
export interface SlotMount {
  mount: (
    container: HTMLElement,
    ctx: SlotContext | null,
  ) => void | (() => void);
}

/** 插槽输入：原生 DOM / 其它框架挂载函数 / 返回它们的函数 */
export type SlotContent =
  | Node
  | SlotMount
  | ((ctx: SlotContext) => SlotContent | null);

/** Top / Ending 单插槽类型别名 */
export type TopSlot = SlotContent;
export type EndingSlot = SlotContent;

/**
 * 解析插槽内容；函数形式在 ctx 为空时不执行
 */
export function resolveSlotContent(
  content: SlotContent | undefined,
  ctx: SlotContext | null,
): Node | SlotMount | null {
  let current: SlotContent | null | undefined = content;
  while (typeof current === "function") {
    current = ctx ? current(ctx) : null;
    if (current == null) return null;
  }
  return current ?? null;
}

/**
 * 播放器实例上下文
 *
 * 由 VideoPlayer.render() 通过 __providers 注入，供子组件在渲染插槽函数时
 * 构造 SlotContext。默认值为 null：未注入时不调用函数式 vnode。
 */
export const PlayerContext = createContext<VideoPlayer | null>(null);

/**
 * 按位置过滤插槽并按 order 升序稳定排序
 *
 * 稳定排序：同 order 时保持原数组顺序（Array.prototype.sort 在主流引擎中是稳定排序）。
 * 函数式 vnode 在此不展开，由调用方在持有时通过 resolveSlotVNode 处理。
 *
 * @param slots - 全量插槽列表（来自 ui.slots）
 * @param position - 目标位置
 * @returns 该位置下的插槽项（已排序）
 */
export function pickSlotsByPosition(
  slots: readonly ControlSlotItem[] | undefined,
  position: ControlSlotPosition,
): readonly ControlSlotItem[] {
  if (!slots || slots.length === 0) return [];
  return slots
    .filter((slot) => slot.position === position)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * 解析单个插槽项的 VNode
 *
 * - vnode 为 VNode 时直接返回
 * - vnode 为函数时调用并传入 SlotContext；ctx 为 null 时跳过（返回 null）
 *
 * @param slot - 插槽项
 * @param ctx - SlotContext，player / state 任一缺失视为不可用
 * @returns 解析后的 VNode 或 null
 */
export function resolveSlotVNode(
  slot: ControlSlotItem,
  ctx: SlotContext | null,
): VNode | null {
  const { vnode } = slot;
  if (typeof vnode === "function") {
    if (!ctx) return null;
    return vnode(ctx);
  }
  return vnode;
}

/** 判断其它框架挂载描述 */
export function isSlotMount(value: unknown): value is SlotMount {
  return (
    typeof value === "object" &&
    value !== null &&
    "mount" in value &&
    typeof (value as SlotMount).mount === "function"
  );
}
