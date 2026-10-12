/**
 * ============================================
 * ScoreCard — 评分卡片（纯响应式 VNode 组件）
 * ============================================
 * 渲染评分卡片到互动容器：标题 + 5 个评分项（1-5 分）+ 平均分 + 参与人数
 * 图标全部使用图片资源（描边版 off / 填充版 on，按评分类型映射）：
 * - 星星 / 爱心 / 柠檬 ×（描边 / 填充）共 6 张图片（icons.ts 统一持有）
 * - 悬停联动：悬停某项时该项放大（CSS :hover scale）且该项及之前的
 *   全部图标切换为填充版，**仅该项的数值气泡显示**（display
 *   由内联响应式表达式驱动）；移开恢复；已评分后评分区 pointer-events:
 *   none（-has-result 类）悬停自然失效
 * - 数字 / 结果文本颜色 = 图标填充主色（星星 #ffb027 / 爱心 #FA5555 /
 *   柠檬 #F7DC6F），随图标类型编辑响应式切换
 * 评分后展示结果：
 * - 根加 -has-result 类（scss 控制评分项依次左移收拢 + 结果区淡入，
 *   位移序列 0/-20/-40/-60/-80px，延迟 0.2/0.3/0.4/0.5/0.6s）
 * - 点击评分时同步清悬停值 → 数值气泡全部即刻消失（无 -voted 常显态）
 * - 平均分与参与人数由状态信号响应式更新；**平均分为 10 分制口径**
 *   （图标/数字是 1-5，总分按 value×2 累计 —— 参考行为：评 3 分 →
 *   平均 6.0）
 * 右上角带两半环倒计时关闭按钮（100% → 0 随播放推进消隐，点击即关闭）
 *
 * 响应式写法：class / style / src 等属性直接绑定内联动态表达式
 * （表达式内直接读取 signal.value，编译器自动追踪为响应式属性），
 * 响应式文本使用零参箭头函数子节点协议
 *
 * 模式无关设计：组件无「编辑/展示」概念——回调可选化：
 * - onScoreSelect/onClose 为 undefined 时对应元素不注册监听（编辑模式不传）
 * - bindDrag 为 undefined 时不绑定拖拽（展示模式不传）
 */

import { h, signal } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";
import type {
  ActiveCardEntry,
  InteractionScore,
  InteractionType,
} from "./types";
import { getScoreIconPair, getScoreThemeColor } from "./icons";
import { renderCloseCircle } from "./closeCircle";

// ============================================
// 类名常量
// ============================================

const CLASS_NAMES = {
  HL_SCORE: "nova-danmaku-x-score",
  HL_SCORE_TITLE: "nova-danmaku-x-score-title",
  HL_SCORE_AREA: "nova-danmaku-x-score-area",
  HL_SCORE_AREA_ITEM: "nova-danmaku-x-score-area-item",
  HL_SCORE_RESULT: "nova-danmaku-x-score-result",
  HL_SCORE_COUNT: "nova-danmaku-x-score-count",
  HL_SCORE_HAS_RESULT: "nova-danmaku-x-has-result",
  HL_SHOW: "nova-danmaku-x-show",
} as const;

// ============================================
// 卡片交互状态（由插件持有，跨 DOM 重建保留）
// ============================================

/** 评分卡片的交互状态信号集合 */
export interface ScoreCardState {
  /** 选中的评分值（0 = 未评分，1-5 = 已评分） */
  selected: Signal<number>;
  /** 参与人数 */
  count: Signal<number>;
  /** 总分和（平均分 = totalScore / count） */
  totalScore: Signal<number>;
  /** 悬停高亮的评分值（0 = 无悬停，1-5 = 悬停项及之前的图标填充） */
  hoverIndex: Signal<number>;
  /**
   * 图标类型列表（单元素，渲染层 src 表达式读取 [0]）：
   * 图标类型编辑时插件层写入 [新类型]，img src 响应式替换，
   * 评分项容器 / 数值气泡 / 类名全部复用（卡片 DOM 不销毁重建）
   */
  scoreIconList: Signal<InteractionType[]>;
}

/**
 * 创建评分卡片的初始交互状态
 * @param scoreType - 初始图标类型（1 = 星星，2 = 爱心，3 = 柠檬）
 */
export function createScoreCardState(
  scoreType: InteractionType,
): ScoreCardState {
  return {
    selected: signal(0),
    count: signal(0),
    totalScore: signal(0),
    hoverIndex: signal(0),
    scoreIconList: signal([scoreType]),
  };
}

// ============================================
// 卡片渲染选项
// ============================================

/**
 * 评分卡片渲染选项
 *
 * 模式差异由「是否传回调」表达，组件内部无模式概念：
 * - 展示模式：onScoreSelect + onClose 传入
 * - 编辑模式：仅传 bindDrag（评分项点击与关闭均不注册）
 */
export interface ScoreCardOptions {
  /** 评分项被点击回调（undefined 时不注册监听；由插件负责校验未评、累加分数） */
  onScoreSelect?: (value: number) => void;
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

/** 评分项数量固定 5 个（1-5 分） */
const SCORE_ITEM_COUNT = 5;

/**
 * 渲染单个评分项
 *
 * 结构（对齐参考 DOM，图片与数值平级）：
 * ```html
 * <div class="nova-danmaku-x-score-area-item" data-val="1">
 *   <img src="..." class="on">
 *   <span>1</span>
 * </div>
 * ```
 *
 * 响应式点（表达式内联读取 signal.value，编译器自动追踪）：
 * - img class：on（填充版）/ off（描边版）——悬停联动填充数
 *   = 悬停值（>0 时）或已选值，项下标 < 填充数即填充
 * - img src：随填充态与图标类型（scoreIconList[0]）切换对应图片
 * - span：仅显示自身评分值数字，颜色继承评分区主题色
 *
 * 悬停联动：进入某项 → hoverIndex 置为该项值（该项及之前全部填充，
 * 图标为填充版）；离开 → 归零恢复为已选值的填充态
 *
 * @param index - 评分项下标（0-4，评分值 = index + 1）
 * @param state - 交互状态信号集合
 * @param options - 渲染选项
 * @returns 评分项 VNode
 */
function renderScoreItem(
  index: number,
  state: ScoreCardState,
  options: ScoreCardOptions,
): VNode {
  /** 本项代表的评分值（1-5） */
  const value = index + 1;

  return h(
    "div",
    {
      "data-val": value,
      class: CLASS_NAMES.HL_SCORE_AREA_ITEM,
      // 悬停联动：仅展示模式（onScoreSelect 存在）且未评分时响应
      onMouseenter: options.onScoreSelect
        ? (): void => {
            if (state.selected.value > 0) return;
            state.hoverIndex.value = value;
          }
        : undefined,
      onMouseleave: options.onScoreSelect
        ? (): void => {
            state.hoverIndex.value = 0;
          }
        : undefined,
      onClick: options.onScoreSelect
        ? (e: Event): void => {
            e.stopPropagation();
            // 已评分后不再响应（插件层校验的渲染层兜底）
            if (state.selected.value > 0) return;
            options.onScoreSelect?.(value);
            // 评分落定后立即清悬停值：数值气泡随悬停态显示（非已评态），
            // 清零后全部气泡即刻消失（「点击后数字直接关闭」，对齐参考行为）
            state.hoverIndex.value = 0;
          }
        : undefined,
    },
    // 图标图片：填充数 = 悬停值（>0 时）或已选值，项下标 < 填充数即 on（填充版）
    // src / class 均为内联动态表达式（直接读取 signal.value，响应式替换）
    h("img", {
      class:
        (state.hoverIndex.value > 0
          ? state.hoverIndex.value
          : state.selected.value) > index
          ? "on"
          : "off",
      src:
        (state.hoverIndex.value > 0
          ? state.hoverIndex.value
          : state.selected.value) > index
          ? getScoreIconPair(state.scoreIconList.value[0] ?? 1).on
          : getScoreIconPair(state.scoreIconList.value[0] ?? 1).off,
      alt: "",
    }),
    // 数值气泡：仅显示自身评分值（1-5），颜色继承评分区主题色。
    // 显隐协议（对齐参考行为）：默认 display:none（scss 基础规则），
    // 悬停联动 —— 仅悬停项自己的气泡显示（hoverIndex === value，
    // 图标填充仍是该项及之前联动），移开隐藏；已评分后不再有悬停态
    // （has-result 禁指针 + 点击时清零）→ 气泡消失（「点击后数字直接关闭」）
    h(
      "span",
      {
        style: {
          display:
            state.hoverIndex.value > 0 &&
            state.hoverIndex.value === value
              ? "block"
              : "none",
        },
      },
      String(value),
    ),
  );
}

// ============================================
// 卡片渲染
// ============================================

/**
 * 渲染评分卡片
 *
 * @param entry - 活跃卡片条目（show 信号驱动显隐过渡，remaining 驱动关闭环倒计时）
 * @param state - 交互状态信号集合（跨 DOM 重建保留，由插件持有）
 * @param options - 渲染选项（回调可选，未传则不注册对应监听）
 * @returns 卡片根元素 VNode
 */
export function renderScoreCard(
  entry: ActiveCardEntry<InteractionScore>,
  state: ScoreCardState,
  options: ScoreCardOptions,
): VNode {
  const { item } = entry;
  const { onClose, bindDrag } = options;

  return h(
    "div",
    {
      // 定位/缩放变量为静态 style（--scale 供缩放，编辑模式拖拽由 dragEditor 覆盖 --top/--left）
      style: {
        "--top": `${item.top}%`,
        "--left": `${item.left}%`,
        "--scale": "1",
      },
      // 编辑模式：根元素挂载时交给绑定器，清理函数存入条目供移除时调用
      ref: bindDrag
        ? (el: Element): void => {
            if (!(el instanceof HTMLDivElement)) return;
            entry.dragCleanup?.();
            entry.dragCleanup = bindDrag(el) ?? null;
          }
        : undefined,
      // 根类名直接表达式：显隐过渡类 + 评分后 -has-result
      // （评分项收拢 + 结果区淡入）类。**无 -voted 类**：数值气泡的显隐
      // 完全由悬停态驱动（悬停联动显示前 n 项，点击评分后清零全消失），
      // 对齐参考 DOM —— 评分类组合只有 has-result，没有 voted
      class: [
        CLASS_NAMES.HL_SCORE,
        state.selected.value > 0 ? CLASS_NAMES.HL_SCORE_HAS_RESULT : "",
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
    // 评分标题（读取 contentVersion 的显式 getter，文案编辑精准更新）
    h("div", { class: CLASS_NAMES.HL_SCORE_TITLE }, (): string => {
      void entry.contentVersion.value;
      return item.title;
    }),
    // 评分项列表（固定 5 项，1-5 分）：
    // 主题色内联 style（图标类型编辑时响应式切换数字与结果颜色）
    h(
      "div",
      {
        class: CLASS_NAMES.HL_SCORE_AREA,
        style: {
          color: getScoreThemeColor(state.scoreIconList.value[0] ?? 1),
        },
      },
      ...Array.from(
        { length: SCORE_ITEM_COUNT },
        (_, index: number): VNode => renderScoreItem(index, state, options),
      ),
    ),
    // 平均分（响应式文本：参与人数 > 0 时保留一位小数；颜色 = 图标填充主色）
    h(
      "div",
      { class: CLASS_NAMES.HL_SCORE_RESULT },
      "平均 ",
      h(
        "span",
        {
          style: {
            color: getScoreThemeColor(state.scoreIconList.value[0] ?? 1),
          },
        },
        (): string => {
          const count = state.count.value;
          return count > 0 ? (state.totalScore.value / count).toFixed(1) : "0";
        },
      ),
    ),
    // 参与人数（响应式文本）
    h(
      "div",
      { class: CLASS_NAMES.HL_SCORE_COUNT },
      (): string => `${state.count.value}人参与`,
    ),
  );
}
