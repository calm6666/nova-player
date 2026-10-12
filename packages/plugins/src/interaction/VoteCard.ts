/**
 * ============================================
 * VoteCard — 投票卡片（纯响应式 VNode 组件）
 * ============================================
 * 渲染投票卡片到互动容器：问题文案 + 选项列表
 * 投票后展示结果：
 * - 根加 -voted 类（scss 控制全部百分比角标 opacity 0.9）与
 *   -selected 类（voteFont 文案闪变动画 + 未选项 buffer 灰色填充）
 * - 选中行加 -selected/-select 类（角标透明度 / buffer 蓝色填充）
 * - buffer 宽度投票后内联写入选项占比，由 CSS transition: width 1s
 *   从 0 平滑过渡到占比，百分比文本由状态信号响应式更新
 * 右上角带两半环倒计时关闭按钮（100% → 0 随播放推进消隐，点击即关闭）
 *
 * 响应式写法：class/style 直接绑定动态表达式（内部读取 signal.value），
 * 响应式文本使用零参箭头函数子节点协议（编译期 _reactiveText / 运行时
 * flattenInto 规范化双路径支持）
 *
 * 模式无关设计：组件无「编辑/展示」概念——回调可选化：
 * - onVoteSelect/onClose 为 undefined 时对应元素不注册监听（编辑模式不传）
 * - bindDrag 为 undefined 时不绑定拖拽（展示模式不传）
 */

import { h, signal, For } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";
import type { ActiveCardEntry, InteractionVote, VoteOption } from "./types";
import { renderCloseCircle } from "./closeCircle";

// ============================================
// 类名常量
// ============================================

const CLASS_NAMES = {
  HL_VOTE: "nova-danmaku-x-vote",
  HL_VOTE_QUESTION: "nova-danmaku-x-vote-question",
  HL_VOTE_AN: "nova-danmaku-x-vote-an",
  HL_VOTE_AN_BG: "nova-danmaku-x-vote-an-bg",
  HL_VOTE_AN_BG_BUFFER: "nova-danmaku-x-vote-an-bg-buffer",
  HL_VOTE_AN_TEXT: "nova-danmaku-x-vote-an-text",
  HL_VOTE_AN_TEXT_INDEX: "nova-danmaku-x-vote-an-text-index",
  HL_VOTE_AN_TEXT_DOC: "nova-danmaku-x-vote-an-text-doc",
  HL_VOTE_AN_PERCENT: "nova-danmaku-x-vote-an-percent",
  HL_VOTE_AN_SELECTED: "nova-danmaku-x-vote-an-selected",
  HL_VOTE_AN_VOTED: "nova-danmaku-x-vote-an-voted",
  /** 根元素投票后标记：驱动 voteFont 文案闪变动画 + 未选项 buffer 灰色填充 */
  HL_VOTE_SELECTED: "nova-danmaku-x-selected",
  /** 选中行标记：驱动该行 buffer 蓝色填充 */
  HL_VOTE_AN_SELECT: "nova-danmaku-x-select",
  HL_SHOW: "nova-danmaku-x-show",
} as const;

// ============================================
// 卡片交互状态（由插件持有，跨 DOM 重建保留）
// ============================================

/** 投票卡片的交互状态信号集合 */
export interface VoteCardState {
  /** 选中的选项下标（-1 = 未投票，>= 0 = 已投票） */
  votedIndex: Signal<number>;
  /** 总票数（驱动各选项进度条宽度与百分比文本） */
  totalVotes: Signal<number>;
  /**
   * 选项列表（For 控制流的渲染源）：按引用 diff，
   * 编辑增删选项时插件层原位 push/截断后写入新数组，
   * For 仅对差异行创建/销毁 DOM，既有行全部复用
   */
  optionsSignal: Signal<VoteOption[]>;
}

/**
 * 创建投票卡片的初始交互状态
 * @param options - 初始选项列表（浅拷贝入信号，选项对象引用与数据源一致）
 */
export function createVoteCardState(options: VoteOption[]): VoteCardState {
  return {
    votedIndex: signal(-1),
    totalVotes: signal(0),
    optionsSignal: signal([...options]),
  };
}

// ============================================
// 卡片渲染选项
// ============================================

/**
 * 投票卡片渲染选项
 *
 * 模式差异由「是否传回调」表达，组件内部无模式概念：
 * - 展示模式：onVoteSelect + onClose 传入
 * - 编辑模式：仅传 bindDrag（选项点击与关闭均不注册）
 */
export interface VoteCardOptions {
  /** 选项被点击回调（undefined 时不注册监听；由插件负责校验未投、累加票数） */
  onVoteSelect?: (optionIndex: number) => void;
  /** 关闭按钮点击回调（触发卡片淡出并删除 DOM；undefined 时圆环不注册点击） */
  onClose?: () => void;
  /**
   * 拖拽绑定器（仅编辑模式提供）：接收卡片根元素，
   * 返回清理函数供条目移除时解绑（undefined 时不绑定拖拽）
   */
  bindDrag?: (el: HTMLDivElement) => (() => void) | void;
}

// ============================================
// 渲染辅助
// ============================================

/**
 * 计算选项得票百分比（四舍五入取整，总票数为 0 时返回 0，避免除零）
 * @param votes - 该选项票数
 * @param totalVotes - 总票数
 * @returns 百分比整数值（0-100）
 */
function computePercent(votes: number, totalVotes: number): number {
  if (totalVotes <= 0) return 0;
  return Math.round((votes / totalVotes) * 100);
}

/**
 * 渲染单个投票选项行
 *
 * 结构（对齐旧 VotePlugin 的 DOM）：
 * ```html
 * <div class="nova-danmaku-x-vote-an" data-index="0">
 *   <div class="nova-danmaku-x-vote-an-bg">
 *     <div class="nova-danmaku-x-vote-an-bg-buffer"></div>
 *   </div>
 *   <div class="nova-danmaku-x-vote-an-text">
 *     <div class="nova-danmaku-x-vote-an-text-index">A</div>
 *     <div class="nova-danmaku-x-vote-an-text-doc">选项文案</div>
 *   </div>
 *   <div class="nova-danmaku-x-vote-an-percent">50%</div>
 * </div>
 * ```
 *
 * 响应式点：
 * - 行类名：选中行追加 -selected（角标透明度）与 -select（buffer 蓝色）
 *   类，直接表达式编译器追踪 votedIndex
 * - buffer 样式：未投票为空串（回落 scss 默认 width 0），投票后内联
 *   写入选项占比，CSS transition: width 1s, border-radius 0s 1s
 *   从 0 平滑过渡到占比（圆角在 1s 宽度动画完成刻才切换为全圆角）
 * - 选项文案：读取 optionsVersion 的显式 getter（updateCardContent 的
 *   字段级细腻更新——只驱动选项行，不触碰 question）
 * - 百分比角标：投票后显示 "N%"（零参箭头函数响应式文本）
 *
 * @param option - 选项数据（optionText / votes）
 * @param index - 选项下标（字母下标 = 65 + index）
 * @param state - 交互状态信号集合
 * @param options - 渲染选项
 * @param optionsVersion - 选项文案版本号（optionTexts 编辑的响应式驱动源）
 * @returns 选项行 VNode
 */
function renderVoteOption(
  option: VoteOption,
  index: number,
  state: VoteCardState,
  options: VoteCardOptions,
  optionsVersion: Signal<number>,
): VNode {
  return h(
    "div",
    {
      "data-index": index,
      // 行类名直接表达式：选中行追加 -selected（角标透明度）与
      // -select（buffer 蓝色填充）类，未选中时仅基础类
      class:
        state.votedIndex.value === index
          ? `${CLASS_NAMES.HL_VOTE_AN} ${CLASS_NAMES.HL_VOTE_AN_SELECTED} ${CLASS_NAMES.HL_VOTE_AN_SELECT}`
          : CLASS_NAMES.HL_VOTE_AN,
      onClick: options.onVoteSelect
        ? (e: Event): void => {
            e.stopPropagation();
            // 已投票后不再响应（插件层校验的渲染层兜底）
            if (state.votedIndex.value >= 0) return;
            // 实时反查下标：For 复用行时闭包 index 可能与列表错位
            //（选项仅尾部增删，正常场景两者一致，反查为兜底）
            const liveIndex = state.optionsSignal.value.indexOf(option);
            if (liveIndex >= 0) options.onVoteSelect?.(liveIndex);
          }
        : undefined,
    },
    // 进度条底 + buffer（投票后宽度内联写入占比，CSS transition 从 0 过渡）
    h(
      "div",
      { class: CLASS_NAMES.HL_VOTE_AN_BG },
      h("div", {
        class: CLASS_NAMES.HL_VOTE_AN_BG_BUFFER,
        // 直接表达式：未投票返回空串（不设置内联属性，回落 scss 默认
        // width 0）；投票后内联写入选项占比（响应式 style 的
        // prevStyleProps 机制增量更新），scss 的
        // transition: width 1s, border-radius 0s 1s 使宽度从 0 平滑
        // 过渡到占比、圆角在宽度动画完成（1s）那一刻才从 4px 0 0 4px
        // 瞬时切换为 4px（100% 满宽时右角补圆）
        style:
          state.votedIndex.value < 0
            ? ""
            : (() => {
                const percent = computePercent(
                  option.votes ?? 0,
                  state.totalVotes.value,
                );
                return `width: ${percent}%;
              border-radius: ${percent == 100 ? "4px;" : "4px 0 0 4px;"}`;
              })(),
      }),
    ),
    // 选项文案：字母下标（A/B/C...）+ 选项文本
    // 选项文本为读取 optionsVersion 的显式 getter（字段级细腻更新：
    // optionTexts 编辑只驱动选项行，question 不受影响）
    h(
      "div",
      { class: CLASS_NAMES.HL_VOTE_AN_TEXT },
      h(
        "div",
        { class: CLASS_NAMES.HL_VOTE_AN_TEXT_INDEX },
        // String.fromCharCode(65 + index),
      ),
      h(
        "div",
        { class: CLASS_NAMES.HL_VOTE_AN_TEXT_DOC },
        (): string => {
          void optionsVersion.value;
          return option.optionText;
        },
      ),
    ),
    // 百分比角标（投票后显示，透明度由根 -voted 类 / 行 -selected 类的 scss 控制）
    h(
      "div",
      { class: CLASS_NAMES.HL_VOTE_AN_PERCENT },
      (): string => {
        if (state.votedIndex.value < 0) return "";
        const percent = computePercent(
          option.votes ?? 0,
          state.totalVotes.value,
        );
        return `${percent}%`;
      },
    ),
  );
}

// ============================================
// 卡片渲染
// ============================================

/**
 * 渲染投票卡片
 *
 * @param entry - 活跃卡片条目（show 信号驱动显隐过渡，remaining 驱动关闭环倒计时）
 * @param state - 交互状态信号集合（跨 DOM 重建保留，由插件持有）
 * @param options - 渲染选项（回调可选，未传则不注册对应监听）
 * @returns 卡片根元素 VNode
 */
export function renderVoteCard(
  entry: ActiveCardEntry<InteractionVote>,
  state: VoteCardState,
  options: VoteCardOptions,
): VNode {
  const { item } = entry;
  const { onClose, bindDrag } = options;

  return h(
    "div",
    {
      // 定位变量为静态 style（编辑模式拖拽由 dragEditor 直接 setProperty 覆盖）
      style: { "--top": `${item.top}%`, "--left": `${item.left}%` },
      // 编辑模式：根元素挂载时交给绑定器，清理函数存入条目供移除时调用
      ref: bindDrag
        ? (el: Element): void => {
            if (!(el instanceof HTMLDivElement)) return;
            entry.dragCleanup?.();
            entry.dragCleanup = bindDrag(el) ?? null;
          }
        : undefined,
      // 根类名直接表达式：显隐过渡类 + 投票后 -voted 类（百分比角标透明度）
      // 与 -selected 类（voteFont 文案闪变 + 未选项 buffer 灰色填充）
      class: [
        CLASS_NAMES.HL_VOTE,
        state.votedIndex.value >= 0 ? CLASS_NAMES.HL_VOTE_AN_VOTED : "",
        state.votedIndex.value >= 0 ? CLASS_NAMES.HL_VOTE_SELECTED : "",
        entry.show.value ? CLASS_NAMES.HL_SHOW : "",
      ]
        .filter((name: string): boolean => name !== "")
        .join(" "),
    },
    // 右上角两半环倒计时关闭按钮（onClose 缺省时仅渲染不注册点击）
    renderCloseCircle(
      entry.remaining,
      onClose
        ? (): void => {
            onClose();
          }
        : undefined,
    ),
    // 投票问题文案（读取 contentVersion 的显式 getter，文案编辑精准更新）
    h(
      "div",
      { class: CLASS_NAMES.HL_VOTE_QUESTION },
      (): string => {
        void entry.contentVersion.value;
        return item.question;
      },
    ),
    // 选项列表（For 按引用 diff）：编辑增删选项时插件层原位变更
    // optionsSignal，仅差异行创建/销毁 DOM，既有行及其文本/进度条
    // 响应式更新全部复用（卡片 DOM 不销毁重建）
    h(For, {
      each: state.optionsSignal,
      render: (option: VoteOption, index: number): VNode =>
        renderVoteOption(
          option,
          index,
          state,
          options,
          entry.optionsVersion,
        ),
    }),
  );
}
