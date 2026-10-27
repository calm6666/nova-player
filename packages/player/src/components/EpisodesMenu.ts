/**
 * ============================================
 * 选集面板组件 (EpisodesMenu)
 * ============================================
 * 声明式响应式版本：
 * - 当前集下标由 activeIndexSignal 驱动（For 项 class / Show 播放中图标）
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
  computed,
  For,
  Show,
} from "@/core";
import type { ReadonlySignal } from "@/core";
import { useComponentUnmount } from "@/nova/core/componentUnmount";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import type { AnimationFrameID } from "@/utils/rafTimeout";
import { PlayerStateKeyEnum, StateContext } from "@/store/runtimeState";
import type { VNode } from "@/types";

/**
 * 选集项
 */
export interface EpisodeOption {
  /** 唯一标识（对应 MediaItem.id / cid） */
  id?: string | number;
  /** 显示标题 */
  title?: string;
  /** 下标（必须与传入数组下标一致，点击时回传它） */
  index: number;
}

export interface EpisodesMenuProps {
  /** 选集列表（空数组时面板显示空态） */
  episodes: EpisodeOption[];
  /** 当前集下标 */
  currentIndex: number;
  /**
   * 配置显隐（ui.controls.episodes）
   * 父层可传 Signal 形态（props 惰性代理读取穿透建立依赖），
   * 缺省可见；display 由本组件根节点响应式 style 单一来源管理
   */
  visible?: boolean | ReadonlySignal<boolean>;
  /**
   * 是否有播放列表（长度 > 1）
   * 父层可传 Signal 形态；驱动根节点 nova-player-has-playlist 类
   * （替代旧的 RightControls querySelector + classList.toggle 命令式写入）
   */
  hasPlaylist?: boolean | ReadonlySignal<boolean>;
}

export interface EpisodesMenuEvents {
  /** 点击某一集 */
  episodeChange: (index: number) => void;
}

/**
 * 运行时类型谓词：For 控制流的回调入参为 unknown（For 的 props 为
 * Record<string, unknown>，类型信息在回调边界丢失），
 * 用谓词收窄替代 as 断言
 */
const isEpisodeOption = (item: unknown): item is EpisodeOption =>
  typeof item === "object" &&
  item !== null &&
  "index" in item &&
  typeof item.index === "number";

/** 列表区域最小高度，与参考实现的 min-height: 480px 对齐（普通模式盖掉，由 scss 控制） */
const MENU_MIN_HEIGHT = "180px";

/** 当前集「播放中」三段竖条图标（参考 DOM：viewBox 0 0 12 13 + 3 个 rect） */
const PlayingIcon = (): VNode =>
  h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      "data-pointer": "none",
      viewBox: "0 0 12 13",
    },
    h("rect", { width: "2", height: "6", x: "1", y: "3.5", rx: "1" }),
    h("rect", { width: "2", height: "4", x: "9", y: "4.5", rx: "1" }),
    h("rect", { width: "2", height: "10", x: "5", y: "1.5", rx: "1" }),
  );

/**
 * EpisodesMenu 组件 - 使用 defineComponent 创建独立组件
 * 渲染选集按钮与选集面板，当前集高亮 + 播放中图标
 */
export const EpisodesMenu = defineComponent<
  EpisodesMenuProps,
  EpisodesMenuEvents
>((props, lifecycle) => {
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
   * 配置显隐派生信号：父层经 visible prop 传入（支持 Signal 形态，
   * props 惰性代理读取穿透 Signal.value 自动建立依赖），
   * display 由本组件根节点响应式 style 单一来源管理，
   * 消除旧的 RightControls querySelector 直写 display
   */
  const configVisibleSignal = computed(() => props.visible !== false);

  /**
   * 是否有播放列表派生信号：父层经 hasPlaylist prop 传入（支持 Signal 形态），
   * 驱动根节点 nova-player-has-playlist 类（__reactiveAttrs + normalizeClass），
   * 替代旧的 classList.toggle 命令式写入
   */
  const hasPlaylistSignal = computed(() => props.hasPlaylist === true);

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
   * 响应式信号：运行时播放列表下标（外部切集时同步）
   * useReactiveState 返回 Signal，读取 .value 自动建立依赖
   */
  const playlistIndexStateSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.PLAYLIST_INDEX, lifecycle)
    : signal<unknown>(undefined);

  /**
   * 当前集下标：运行时状态优先，未就绪时回落到 props.currentIndex
   * 不再维护本地镜像 signal 与同步 effect
   */
  const activeIndex = computed<number>(() => {
    const index = playlistIndexStateSignal.value;
    return typeof index === "number" ? index : (props.currentIndex ?? 0);
  });

  // ============================================
  // 事件处理函数
  // ============================================

  /**
   * 鼠标进入选集按钮：延迟展开面板（面板显隐由本组件自己负责）
   */
  const handleMouseEnter = (): void => {
    cancelRaf(hideTimer!);
    hideTimer = null;
    if (showTimer !== null) return;
    showTimer = rafTimeout(() => {
      showTimer = null;
      setShown(true);
    }, 120);
  };

  /**
   * 鼠标离开选集按钮：延迟收起面板
   */
  const handleMouseLeave = (): void => {
    cancelRaf(showTimer!);
    showTimer = null;
    if (hideTimer !== null) return;
    hideTimer = rafTimeout(() => {
      hideTimer = null;
      setShown(false);
    }, 220);
  };

  /**
   * 键盘可达性：Enter / Space 展开面板
   * @param event - 键盘事件
   */
  const handleKeydown = (event: KeyboardEvent): void => {
    const key = event.key;
    if (key !== "Enter" && key !== " ") return;
    event.preventDefault();
    clearTimers();
    setShown(true);
  };

  // ============================================
  // 生命周期钩子
  // ============================================

  useComponentUnmount(lifecycle, clearTimers);

  // ============================================
  // 主渲染函数
  // ============================================

  return h(
    "div",
    {
      // 展开态类名由 shownSignal 响应式驱动（__reactiveAttrs + normalizeClass）；
      // has-playlist 类由 hasPlaylistSignal 响应式驱动
      class: [
        "nova-player-ctrl-btn",
        "nova-player-ctrl-eplist",
        { "state-show": shownSignal.value },
        { "nova-player-has-playlist": hasPlaylistSignal.value },
      ],
      role: "button",
      "aria-label": t("player.ui.controls.episodes"),
      // 配置显隐：display 单一来源（父层 ui.controls.episodes 经 visible prop 传入）
      style: { display: configVisibleSignal.value ? "" : "none" },
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
      onKeydown: handleKeydown,
    },
    // 按钮文案
    h(
      "div",
      { class: "nova-player-ctrl-eplist-result" },
      t("player.ui.settings.episodes"),
    ),
    // 选集面板
    h(
      "div",
      {
        class: "nova-player-ctrl-eplist-menu-wrap",
        style: { minHeight: MENU_MIN_HEIGHT },
      },
      h(
        "div",
        { class: "nova-player-ctrl-eplist-section" },
        h(
          "div",
          {
            class: "nova-player-ctrl-eplist-section-bottom",
            style: {
              touchAction: "pan-x",
              userSelect: "none",
              webkitUserDrag: "none",
              webkitTapHighlightColor: "rgba(0, 0, 0, 0)",
            },
          },
          h(
            "ul",
            { class: "nova-player-ctrl-eplist-section-content" },
            // For 组件：key-based 精准更新，每个选集项只渲染一次
            // 选中态由响应式 class（activeIndex.value 自动驱动）自动同步，无需 onEffect + classList.toggle
            h(For, {
              each: props.episodes ?? [],
              key: (item: unknown, _index: number): string =>
                isEpisodeOption(item) ? String(item.index) : "",
              render: (item: unknown, _index: number): VNode => {
                // For 回调入参为 unknown：类型谓词收窄（替代 as 断言）
                if (!isEpisodeOption(item)) return h("li", {});
                const ep = item;
                return h(
                  "li",
                  {
                    class: [
                      "nova-player-ctrl-eplist-multi-menu-item",
                      {
                        "nova-player-state-active":
                          activeIndex.value === ep.index,
                      },
                    ],
                    "data-index": String(ep.index),
                    onClick: () => {
                      // 当前项点击不做任何事；选中态由父层播放列表状态回流
                      if (ep.index === activeIndex.value) return;
                      lifecycle.emit?.("episodeChange", ep.index);
                    },
                  },
                  // Show 控制流：当前集时 mount 播放中图标，非当前集时 destroy
                  // 替代旧的 ...(isActive ? [renderPlayingIcon()] : []) 条件数组
                  h(
                    Show,
                    { when: () => activeIndex.value === ep.index },
                    h(
                      "span",
                      { class: "nova-player-ctrl-eplist-multi-menu-item-icon" },
                      PlayingIcon(),
                    ),
                  ),
                  h(
                    "span",
                    { class: "nova-player-ctrl-eplist-multi-menu-item-text" },
                    ep.title ?? "",
                  ),
                );
              },
            }),
            // Show 控制流：选集列表为空时 mount 空态项，非空时 destroy
            // 替代旧的 items.length === 0 ? [createEmptyItem()] : ... 三元
            h(
              Show,
              { when: () => (props.episodes ?? []).length === 0 },
              h(
                "li",
                {
                  class:
                    "nova-player-ctrl-eplist-multi-menu-item nova-player-ctrl-eplist-empty",
                },
                h(
                  "span",
                  { class: "nova-player-ctrl-eplist-multi-menu-item-text" },
                  "暂无选集",
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
});
