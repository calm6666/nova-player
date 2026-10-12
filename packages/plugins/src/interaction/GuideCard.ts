/**
 * ============================================
 * GuideCard — 点赞关注卡片（纯响应式 VNode 组件）
 * ============================================
 * 渲染点赞/投币/收藏/关注卡片到互动容器
 * 根类名固定为 nova-danmaku-x-editor，形态（type）经 guideTypeSignal
 * 驱动根类名变体切换（三连/关注区 DOM 恒在、CSS 显隐，编辑不重建卡片）
 * 关注按钮通过 no-follow / following 两个互斥类切换「关注 / 已关注」
 *
 * 响应式写法：class/style 直接绑定动态表达式（内部读取 signal.value），
 * 编译器（luminaCompile）自动追踪依赖并包装为响应式属性
 *
 * 模式无关设计：组件无「编辑/展示」概念——
 * - 业务回调（onLike 等）为 undefined 时对应元素不注册点击监听
 *   （编辑模式由插件层不传回调实现「点击不生效」）
 * - bindDrag 为 undefined 时不绑定拖拽（展示模式不传）
 */

import { h, signal } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";
import type {
  ActiveCardEntry,
  InteractionGuideThree,
  InteractionType,
} from "./types";

// ============================================
// 图标（每次调用产生新 VNode，避免多实例共享同一 VNode 对象）
// ============================================

/** 点赞图标（实心） */
function renderLikeIcon(): VNode {
  return h(
    "svg",
    { "data-pointer": "none", viewBox: "0 0 24 24", fill: "currentColor" },
    h("path", {
      d: "M4.909 8.543v15.275h-1.78a2.944 2.944 0 0 1-2.947-2.94v-9.395c0-1.624 1.32-2.94 2.948-2.94h1.779Zm8.64-8.114c1.282.62 2.128 2.183 2.128 4.272 0 1.25-.156 2.53-.468 3.842h5.655a2.955 2.955 0 0 1 2.868 3.662l-1.865 7.568a5.318 5.318 0 0 1-5.163 4.045H6.682V8.508l.132-.047c2.316-.894 3.634-3.072 3.957-6.64C10.9.396 12.256-.196 13.548.428Z",
    }),
  );
}

/** 投币图标（实心） */
function renderCoinIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 24 24", fill: "currentColor" },
    h("path", {
      "fill-rule": "nonzero",
      d: "M12 .182C18.527.182 23.818 5.473 23.818 12A11.818 11.818 0 0 1 12 23.818C5.473 23.818.182 18.527.182 12 .182 5.473 5.473.182 12 .182Zm3.658 6.753a.844.844 0 1 0 0-1.688H8.342a.844.844 0 0 0 0 1.688h2.814v1.44a5.335 5.335 0 0 0-5.065 5.313v1.126a.844.844 0 0 0 1.688 0v-1.126a3.647 3.647 0 0 1 3.377-3.624v7.879a.844.844 0 1 0 1.688 0v-7.879c1.9.141 3.37 1.72 3.377 3.624v1.126a.844.844 0 0 0 1.688 0v-1.126a5.335 5.335 0 0 0-5.065-5.312v-1.44Z",
    }),
  );
}

/** 收藏图标（实心） */
function renderCollectIcon(): VNode {
  return h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", "data-pointer": "none", viewBox: "0 0 24 24", fill: "currentColor" },
    h("path", {
      "fill-rule": "nonzero",
      d: "M17.992 7.2c-1.098-.17-2.11-.93-2.532-1.945l-1.941-4.059c-.59-1.352-2.447-1.352-3.122 0L8.54 5.256C8.034 6.27 7.106 7.03 6.008 7.2l-4.388.676c-1.35.17-1.94 1.86-.928 2.875l3.291 3.383c.76.76 1.097 1.86.928 2.959l-.759 4.735c-.253 1.438 1.266 2.452 2.532 1.776l3.713-2.03a3.272 3.272 0 0 1 3.29 0l3.714 2.03c1.266.676 2.7-.338 2.531-1.776l-.843-4.735c-.17-1.1.168-2.198.928-2.96l3.29-3.382c1.014-1.014.423-2.706-.927-2.875L17.992 7.2Z",
    }),
  );
}

/** 加号图标（关注按钮） */
function renderPlusIcon(): VNode {
  return h(
    "svg",
    { width: "16", height: "16", viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", class: "icon" },
    h("path", {
      "fill-rule": "evenodd",
      "clip-rule": "evenodd",
      d: "M7.25098 8.75V13.25C7.25098 13.6642 7.58676 14 8.00098 14C8.41519 14 8.75098 13.6642 8.75098 13.25V8.75H13.251C13.6652 8.75 14.001 8.41421 14.001 8C14.001 7.58579 13.6652 7.25 13.251 7.25H8.75098V2.75C8.75098 2.33579 8.41519 2 8.00098 2C7.58676 2 7.25098 2.33579 7.25098 2.75V7.25H2.75098C2.33676 7.25 2.00098 7.58579 2.00098 8C2.00098 8.41421 2.33676 8.75 2.75098 8.75H7.25098Z",
      fill: "currentColor",
    }),
  );
}

// ============================================
// 类名常量
// ============================================

const CLASS_NAMES = {
  HL_GUIDE_THREE: "nova-danmaku-x-guide-three",
  HL_GUIDE_THREE_LIKE: "nova-danmaku-x-guide-three-like",
  HL_GUIDE_THREE_COIN: "nova-danmaku-x-guide-three-coin",
  HL_GUIDE_THREE_COLLECT: "nova-danmaku-x-guide-three-collect",
  HL_GUIDE_FOLLOW: "nova-danmaku-x-guide-follow",
  HL_GUIDE_FOLLOW_0: "nova-danmaku-x-guide-follow-0",
  HL_GUIDE_FOLLOW_1: "nova-danmaku-x-guide-follow-1",
  HL_EDITOR: "nova-danmaku-x-editor",
  HL_EDITOR_NO_GUIDE_THREE: "nova-danmaku-x-editor-no-guide-three",
  HL_EDITOR_NO_FOLLOW: "nova-danmaku-x-editor-no-follow",
  HL_SHOW: "nova-danmaku-x-show",
  IS_ACTIVE: "is_active",
  NO_FOLLOW: "no-follow",
  FOLLOWING: "following",
} as const;

// ============================================
// 卡片交互状态（由插件持有，跨 DOM 重建保留）
// ============================================

/** 点赞关注卡片的交互状态信号集合 */
export interface GuideCardState {
  /**
   * 卡片形态（1=三连+关注 2=仅三连 3=仅关注）：驱动根类名变体切换，
   * 三连区/关注区 DOM 恒在、CSS 显隐，形态编辑不重建卡片
   */
  guideTypeSignal: Signal<InteractionType>;
  /** 点赞激活态 */
  likeActive: Signal<boolean>;
  /** 投币激活态 */
  coinActive: Signal<boolean>;
  /** 收藏激活态 */
  collectActive: Signal<boolean>;
  /** 是否已关注（no-follow / following 互斥切换） */
  following: Signal<boolean>;
}

/**
 * 创建点赞关注卡片的初始交互状态
 *
 * likeActive 初始为 true：对齐旧 GuidePlugin 的渲染行为（点赞图标硬编码挂 is_active 类，
 * 视频播放到该卡片时间点时默认展示「已点赞」状态）
 *
 * @param guideType - 初始卡片形态（数据 type 缺省时按 1 处理，与
 *   渲染表达式的兜底分支语义一致）
 */
export function createGuideCardState(guideType: InteractionType): GuideCardState {
  return {
    guideTypeSignal: signal(guideType),
    likeActive: signal(true),
    coinActive: signal(false),
    collectActive: signal(false),
    following: signal(false),
  };
}

// ============================================
// 卡片渲染选项
// ============================================

/**
 * 点赞关注卡片渲染选项
 *
 * 模式差异由「是否传回调」表达，组件内部无模式概念：
 * - 展示模式：全部回调传入（点击切换激活态）
 * - 编辑模式：业务回调不传（点击不生效），仅传 bindDrag（拖拽定位）
 */
export interface GuideCardOptions {
  /** 点赞点击回调（undefined 时不注册点击监听） */
  onLike?: () => void;
  /** 投币点击回调 */
  onCoin?: () => void;
  /** 收藏点击回调 */
  onCollect?: () => void;
  /** 关注点击回调 */
  onFollow?: () => void;
  /**
   * 拖拽绑定器（仅编辑模式提供）：接收卡片根元素，
   * 返回清理函数供条目移除时解绑（undefined 时不绑定拖拽）
   */
  bindDrag?: (el: HTMLDivElement) => (() => void) | void;
}

// ============================================
// 卡片渲染
// ============================================

/**
 * 渲染点赞关注卡片
 *
 * @param entry - 活跃卡片条目（show 信号驱动显隐过渡）
 * @param state - 交互状态信号集合（跨重建保留）
 * @param options - 渲染选项（回调可选，未传则不注册对应监听）
 * @returns 卡片根元素 VNode
 */
export function renderGuideCard(
  entry: ActiveCardEntry<InteractionGuideThree>,
  state: GuideCardState,
  options: GuideCardOptions,
): VNode {
  const { item } = entry;
  const { onLike, onCoin, onCollect, onFollow, bindDrag } = options;

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
      // 根类名直接表达式：显隐过渡类 + 形态变体类（读 guideTypeSignal，
      // 形态编辑时插件层写信号 → 类名原位切换，2 隐藏关注 / 3 隐藏三连）
      class: [
        CLASS_NAMES.HL_EDITOR,
        state.guideTypeSignal.value === 2
          ? CLASS_NAMES.HL_EDITOR_NO_FOLLOW
          : state.guideTypeSignal.value === 3
            ? CLASS_NAMES.HL_EDITOR_NO_GUIDE_THREE
            : "",
        entry.show.value ? CLASS_NAMES.HL_SHOW : "",
      ]
        .filter((name: string): boolean => name !== "")
        .join(" "),
    },
    // 三连区：点赞 / 投币 / 收藏（点击切换激活态；编辑模式回调缺省则不注册监听）
    h(
      "div",
      { class: CLASS_NAMES.HL_GUIDE_THREE },
      h(
        "span",
        {
          class: state.likeActive.value
            ? `${CLASS_NAMES.HL_GUIDE_THREE_LIKE} ${CLASS_NAMES.IS_ACTIVE}`
            : CLASS_NAMES.HL_GUIDE_THREE_LIKE,
          onClick: onLike
            ? (e: Event): void => {
                e.stopPropagation();
                onLike();
              }
            : undefined,
        },
        renderLikeIcon(),
      ),
      h(
        "span",
        {
          class: state.coinActive.value
            ? `${CLASS_NAMES.HL_GUIDE_THREE_COIN} ${CLASS_NAMES.IS_ACTIVE}`
            : CLASS_NAMES.HL_GUIDE_THREE_COIN,
          onClick: onCoin
            ? (e: Event): void => {
                e.stopPropagation();
                onCoin();
              }
            : undefined,
        },
        renderCoinIcon(),
      ),
      h(
        "span",
        {
          class: state.collectActive.value
            ? `${CLASS_NAMES.HL_GUIDE_THREE_COLLECT} ${CLASS_NAMES.IS_ACTIVE}`
            : CLASS_NAMES.HL_GUIDE_THREE_COLLECT,
          onClick: onCollect
            ? (e: Event): void => {
                e.stopPropagation();
                onCollect();
              }
            : undefined,
        },
        renderCollectIcon(),
      ),
    ),
    // 关注区：no-follow（未关注）与 following（已关注）互斥类切换
    h(
      "div",
      {
        class: `${CLASS_NAMES.HL_GUIDE_FOLLOW} ${state.following.value ? CLASS_NAMES.FOLLOWING : CLASS_NAMES.NO_FOLLOW}`,
      },
      h(
        "span",
        {
          class: CLASS_NAMES.HL_GUIDE_FOLLOW_0,
          onClick: onFollow
            ? (e: Event): void => {
                e.stopPropagation();
                onFollow();
              }
            : undefined,
        },
        renderPlusIcon(),
        h("span", {}, "关注"),
      ),
      h("span", { class: CLASS_NAMES.HL_GUIDE_FOLLOW_1 }, "已关注"),
    ),
  );
}
