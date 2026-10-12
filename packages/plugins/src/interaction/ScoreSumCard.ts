/**
 * ============================================
 * ScoreSumCard — 评分总结卡片（纯响应式 VNode 组件）
 * ============================================
 * 汇总全部评分卡片的展示卡：每张评分卡一行（题目 + 当前平均分），
 * 右上角为总参与人数，内容数据由插件运行期从 scoreList 与各评分卡
 * 交互状态聚合后经 summary signal 注入（评分窗口与总结窗口互斥，
 * 聚合值在进入窗口时计算一次即可保持正确）
 *
 * DOM 结构（对齐参考 DOM）：
 * ```html
 * <div class="nova-danmaku-x-scoreSum nova-danmaku-x-show"
 *      style="--left:50%;--top:60%;--scale:1">
 *   <div class="nova-danmaku-x-scoreSum-title"></div>
 *   <div class="nova-danmaku-x-scoreSum-count">0人参与</div>
 *   <div class="nova-danmaku-x-scoreSum-area" style="height:97px">
 *     <div class="nova-danmaku-x-scoreSum-item nova-danmaku-x-show">
 *       <div class="nova-danmaku-x-scoreSum-item-name">题目</div>
 *       <div class="nova-danmaku-x-scoreSum-item-count">0.0</div>
 *     </div>
 *   </div>
 *   <div class="nova-danmaku-x-circle">…关闭环…</div>
 * </div>
 * ```
 *
 * 视觉细节：
 * - 203px 宽深色圆角卡，缩放经 CSS 变量 --scale（新卡片统一缩放协议）
 * - 汇总行默认 opacity:0 + translateY(-10px)，挂载后按序追加 show 类
 *   逐行上浮淡入（130ms 过渡，行间隔 100ms 错峰）
 * - 行内平均分颜色 #ffb027（与星星填充主色一致）
 *
 * 模式无关设计：onClose 缺省（编辑模式）时关闭圆环不注册点击，
 * bindDrag 缺省（展示模式）时不绑定拖拽
 */

import { h, signal } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";
import type { ActiveCardEntry, InteractionScoreSum } from "./types";
import { renderCloseCircle } from "./closeCircle";

// ============================================
// 类名常量
// ============================================

const CLASS_NAMES = {
  HL_SCORE_SUM: "nova-danmaku-x-scoreSum",
  HL_SCORE_SUM_TITLE: "nova-danmaku-x-scoreSum-title",
  HL_SCORE_SUM_COUNT: "nova-danmaku-x-scoreSum-count",
  HL_SCORE_SUM_AREA: "nova-danmaku-x-scoreSum-area",
  HL_SCORE_SUM_ITEM: "nova-danmaku-x-scoreSum-item",
  HL_SCORE_SUM_ITEM_NAME: "nova-danmaku-x-scoreSum-item-name",
  HL_SCORE_SUM_ITEM_COUNT: "nova-danmaku-x-scoreSum-item-count",
  HL_SHOW: "nova-danmaku-x-show",
} as const;

// ============================================
// 汇总数据结构
// ============================================

/** 单行汇总（对应一张评分卡片） */
export interface ScoreSumSummaryItem {
  /** 评分卡片题目 */
  name: string;
  /** 当前平均分（保留一位小数，如 "0.0"） */
  average: string;
}

/** 评分总结卡片的聚合数据 */
export interface ScoreSumSummary {
  /** 全部评分卡片的汇总行 */
  items: ScoreSumSummaryItem[];
  /** 总参与人数（全部评分卡参与数之和） */
  count: number;
}

// ============================================
// 卡片渲染选项
// ============================================

/**
 * 评分总结卡片渲染选项
 *
 * 模式差异由「是否传回调」表达：
 * - 展示模式：onClose 传入（点击关闭 → 插件生成左下角缩小条目）
 * - 编辑模式：仅传 bindDrag（总结卡无点击交互）
 */
export interface ScoreSumCardOptions {
  /** 关闭按钮点击回调（undefined 时圆环不注册点击） */
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

/** 汇总区高度公式：上下内边距 16px + 每行 24px 高 + 3px 行底距（含末行） */
const summarizeAreaHeight = (itemCount: number): number =>
  16 + 27 * itemCount;

/** 汇总行淡入错峰间隔（毫秒） */
const ITEM_STAGGER_MS = 100;

/**
 * 渲染单行汇总（题目 + 平均分）
 *
 * 行默认 opacity:0 + translateY(-10px)，由本地 show 信号在挂载后
 * 按序翻转为 show 类播放上浮淡入（CSS 130ms 过渡）
 *
 * @param item - 汇总行数据
 * @param show - 该行的显隐信号（延迟翻转驱动逐行错峰）
 */
function renderSummaryItem(
  item: ScoreSumSummaryItem,
  show: Signal<boolean>,
): VNode {
  return h(
    "div",
    {
      // 行显隐类直接表达式（show 翻转追加过渡类播放上浮淡入）
      class:
        show.value === true
          ? `${CLASS_NAMES.HL_SCORE_SUM_ITEM} ${CLASS_NAMES.HL_SHOW}`
          : CLASS_NAMES.HL_SCORE_SUM_ITEM,
    },
    h("div", { class: CLASS_NAMES.HL_SCORE_SUM_ITEM_NAME }, item.name),
    h("div", { class: CLASS_NAMES.HL_SCORE_SUM_ITEM_COUNT }, item.average),
  );
}

// ============================================
// 卡片渲染
// ============================================

/**
 * 渲染评分总结卡片
 *
 * @param entry - 活跃卡片条目（show 驱动显隐过渡，remaining 驱动关闭环倒计时）
 * @param summary - 聚合数据 signal（插件在创建条目时计算注入）
 * @param options - 渲染选项（回调可选，未传则不注册对应监听）
 * @returns 卡片根元素 VNode
 */
export function renderScoreSumCard(
  entry: ActiveCardEntry<InteractionScoreSum>,
  summary: Signal<ScoreSumSummary>,
  options: ScoreSumCardOptions,
): VNode {
  const { item } = entry;
  const { onClose, bindDrag } = options;

  // 每行一个本地 show 信号：挂载后按序延迟翻转，驱动逐行错峰上浮
  const itemShowSignals: Signal<boolean>[] = summary.value.items.map(() =>
    signal(false),
  );
  itemShowSignals.forEach((show, index: number) => {
    window.setTimeout((): void => {
      show.value = true;
    }, ITEM_STAGGER_MS * (index + 1));
  });

  return h(
    "div",
    {
      // 定位/缩放变量为静态 style（--scale 为新卡片统一缩放协议）
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
      // 根类名直接表达式：显隐过渡类
      class:
        entry.show.value === true
          ? `${CLASS_NAMES.HL_SCORE_SUM} ${CLASS_NAMES.HL_SHOW}`
          : CLASS_NAMES.HL_SCORE_SUM,
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
    // 标题（参考 DOM 为空标题占位，保持结构一致）
    h("div", { class: CLASS_NAMES.HL_SCORE_SUM_TITLE }, ""),
    // 总参与人数（响应式文本，读取 summary 聚合值）
    h(
      "div",
      { class: CLASS_NAMES.HL_SCORE_SUM_COUNT },
      (): string => `${summary.value.count}人参与`,
    ),
    // 汇总行容器：高度随行数响应式（style 表达式读取 summary）
    h(
      "div",
      {
        class: CLASS_NAMES.HL_SCORE_SUM_AREA,
        style: {
          height: `${summarizeAreaHeight(summary.value.items.length)}px`,
        },
      },
      ...summary.value.items.map(
        (summaryItem: ScoreSumSummaryItem, index: number): VNode =>
          renderSummaryItem(summaryItem, itemShowSignals[index]),
      ),
    ),
  );
}
