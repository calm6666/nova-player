/**
 * ============================================
 * 章节/视点选择菜单组件 (ViewpointMenu)
 * ============================================
 * 用于 LeftControls 的章节/视点选择菜单
 * 支持章节列表渲染、章节点击跳转、菜单悬停动画回调
 *
 * 声明式响应式版本：
 * - 章节列表由 pointsSignal 驱动 For 控制流（key-based 精准更新），
 *   rebuildPoints 仅写信号，替代旧的 menu.replaceChildren + materialize 重建
 * - 章节文案由 currentTitle 驱动（_reactiveText 自动更新 Text 节点），
 *   替代旧的三处 viewpointTextRef.innerText 命令式写入
 * - 面板展开态由 shownSignal 驱动根节点 state-show 类（__reactiveAttrs），
 *   hover 定时器（rafTimeout）仅负责延迟时序并写信号，不直接操作 DOM
 */

import { h, defineComponent, signal, computed, For, t } from "@/core";
import { useComponentUnmount } from "@/nova/core/componentUnmount";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import type { AnimationFrameID } from "@/utils/rafTimeout";
import type { VNode } from "@/types";
import { ArrowRight } from "@/components/icons";

/** 展开 / 收起动画的延迟（毫秒） */
const MENU_SHOW_DELAY = 120;
const MENU_HIDE_DELAY = 220;

/**
 * 章节/视点数据接口
 */
export interface ViewpointItem {
  /** 章节标题 */
  title: string;
  /** 章节起始时间（秒） */
  time: number;
}

/**
 * ViewpointMenu 组件 Props 接口
 */
export interface ViewpointMenuProps {
  /** 章节/视点列表 */
  points?: ViewpointItem[];
  /** 当前播放时间（秒） */
  currentTime?: number;
  /** 跳转到指定时间的回调函数 */
  onSeek?: (time: number) => void;
}

/**
 * ViewpointMenu 组件 - 使用 defineComponent 创建独立组件
 * 渲染章节/视点选择菜单，支持当前章节高亮
 */
export type ViewpointMenuEvents = {
  seek: number;
  viewpointMenuMounted: { rebuildPoints: (next: ViewpointItem[]) => void };
};

/**
 * 运行时类型谓词：For 控制流的回调入参为 unknown（For 的 props 为
 * Record<string, unknown>，类型信息在回调边界丢失），
 * 用谓词收窄替代 as 断言
 */
const isViewpointItem = (item: unknown): item is ViewpointItem =>
  typeof item === "object" &&
  item !== null &&
  "title" in item &&
  typeof item.title === "string" &&
  "time" in item &&
  typeof item.time === "number";

export const ViewpointMenu = defineComponent<
  ViewpointMenuProps,
  ViewpointMenuEvents
>((props, lifecycle) => {
  // 初值仅用于列表信号初始化（挂载后列表只经 rebuildPoints 写入信号更新）
  const initialPoints = props.points ?? [];

  // ============================================
  // 响应式信号（渲染层唯一数据源）
  // ============================================

  /** 章节列表信号（可被 rebuildPoints 整体替换，For 按新列表 diff） */
  const pointsSignal = signal<ViewpointItem[]>(initialPoints);

  /**
   * 章节文案：由章节列表 + 当前播放时间派生
   * 不再维护可写 signal，播放时间变化时自动刷新
   */
  const currentTitle = computed<string>(() => {
    const list = pointsSignal.value;
    if (list.length === 0) return t("player.ui.controls.chapters");
    const now = props.currentTime ?? 0;
    const current = list.find((point, index) => isCurrentPoint(point.time, index, now));
    return `${t("player.ui.controls.chapters")} · ${current?.title ?? list[0].title}`;
  });

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
  // 派生计算
  // ============================================

  /**
   * 判断指定时间是否属于当前章节
   * @param time - 章节起始时间
   * @param index - 章节在列表中的索引
   * @returns 是否为当前正在播放的章节
   */
  const isCurrentPoint = (time: number, index: number, now = props.currentTime ?? 0): boolean => {
    // 当前时间 >= 该章节时间，且 < 下一章节时间
    if (now < time) return false;
    /** 下一个章节的数据 */
    const nextPoint = pointsSignal.value[index + 1];
    if (!nextPoint) return true;
    return now < nextPoint.time;
  };

  /**
   * 解析当前章节文案（播放时间所属章节，无匹配时回退首个章节）
   * 调用方需保证列表非空
   * @returns 按钮显示文案
   */
    /**
   * 用新的章节数据重建列表（时长到手后重建，使章节时间与进度条同轴）
   * 写入信号即可：For 按新列表 diff 更新 DOM，文案随信号自动刷新
   * @param next - 归一后的章节数据
   */
  const rebuildPoints = (next: ViewpointItem[]): void => {
    pointsSignal.value = next ?? [];
  };

  // ============================================
  // 事件处理函数
  // ============================================

  /**
   * 鼠标进入章节按钮：延迟展开面板（面板显隐由本组件自己负责）
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
   * 鼠标离开章节按钮：延迟收起面板
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

  // ============================================
  // 渲染辅助函数
  // ============================================

  /**
   * 渲染单个章节菜单项（For 组件的 render 回调，每个 key 只调用一次；
   * 选中态在项创建时求值一次，与原 DOM 构建时机一致）
   * @param point - 章节数据
   * @param index - 章节在列表中的索引
   * @returns 菜单项 VNode
   */
  const renderViewpointItem = (point: ViewpointItem, index: number): VNode => {
    return h(
      "li",
      {
        // 选中态类名用对象形式（normalizeClass 展开），替代旧的 filter().join() 字符串拼接
        class: [
          "nova-player-ctrl-viewpoint-menu-item",
          { active: isCurrentPoint(point.time, index) },
        ],
        "data-time": point.time,
        onClick: () => {
          lifecycle.emit?.("seek", point.time);
        },
      },
      h("span", {
        class: "nova-player-ctrl-viewpoint-menu-item-team team-blue",
        style: { opacity: "0", display: "none" },
        "data-time": point.time,
      }),
      h(
        "span",
        {
          class: "nova-player-ctrl-viewpoint-menu-item-content",
          "data-time": point.time,
        },
        point.title,
      ),
    );
  };

  // ============================================
  // 生命周期钩子
  // ============================================

  /**
   * 组件挂载后的回调，设置初始章节文案并通知外部组件已就绪
   */
  lifecycle.onMounted = (): void => {
    lifecycle.emit?.("viewpointMenuMounted", { rebuildPoints });
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
        "nova-player-ctrl-viewpoint",
        { "state-show": shownSignal.value },
      ],
      role: "button",
      "aria-label": t("player.ui.controls.chapters"),
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    },
    h(
      "div",
      { class: "nova-player-ctrl-viewpoint-inner" },
      h(
        "div",
        { class: "nova-player-ctrl-viewpoint-content" },
        // 章节文本（子节点位置零参箭头函数 → _reactiveText：
        // currentTitle 变化时自动更新 Text 节点）
        h(
          "span",
          { class: "nova-player-ctrl-viewpoint-text" },
          () => currentTitle.value,
        ),
        // 章节图标
        h(
          "span",
          { class: "nova-player-ctrl-viewpoint-icon" },
          h("span", { class: "common-svg-icon" },
            h(ArrowRight)
          ),
        ),
        // 章节下拉菜单（For：key-based 精准更新，pointsSignal 变化时自动同步，
        // 替代旧的 points.map 静态展开 + replaceChildren 命令式重建）
        h(
          "div",
          { class: "nova-player-ctrl-viewpoint-menu-wrap" },
          h(
            "ul",
            { class: "nova-player-ctrl-viewpoint-menu" },
            h(For, {
              each: pointsSignal,
              key: (item: unknown, index: number): string =>
                isViewpointItem(item) ? String(item.time) : String(index),
              render: (item: unknown, index: number): VNode =>
                isViewpointItem(item)
                  ? renderViewpointItem(item, index)
                  : h("li", {}),
            }),
          ),
        ),
      ),
    ),
  );
});
