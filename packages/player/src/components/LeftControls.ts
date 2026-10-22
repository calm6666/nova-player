/**
 * ============================================
 * 左侧控制按钮组件 (LeftControls)
 * ============================================
 * 独立的函数组件，拥有自己的生命周期
 *
 * 设计模式（响应式系统）：
 *   - config 通过 useContext(ConfigContext) 获取，不走 props 传递
 *   - duration / currentTime 通过 useReactiveState 获取 Signal
 *   - 时间显示通过 _reactiveText 在 VNode 中响应式渲染（signal 变化自动更新 Text 节点）
 *   - 按钮显隐通过 Show 控制流组件条件渲染（mount/destroy 切换，不重渲染）
 *   - 章节按钮通过 Show 在 VNode 树中条件渲染（替代 mount(vnode, container)）
 *   - 事件通过 defineComponent 的第二泛型参数声明，用 lifecycle.emit 发射
 *   - 保留命令式：LottieIcon.play() / ViewpointMenu.rebuildPoints() 等组件 API 调用
 */

import {
  h,
  defineComponent,
  useTemplateRef,
  useReactiveState,
  useContext,
  Show,
  signal,
  onEffect,
  t,
} from "@/core";
import type { ProgressSegment, VNode } from "@/types";
import { PlayerStateKeyEnum, ConfigContext } from "@/store/runtimeState";
import { StateContext } from "@/store/runtimeState";
import { ConfigStoreContext } from "@/store/configStore";
import { PlayerState } from "@/types";
import { formatTime } from "@/utils/formatTime";
import { normalizeSegmentSpan } from "@/nova/utils/media/progressSegment";
import { LottieIcon, type LottieIconApi } from "./LottieIcon";
import { ViewpointMenu, type ViewpointItem } from "./ViewpointMenu";
import pauseToPlayAnimationData from "../assets/lottie-icon/pause-to-play-animation.json";
import playToPauseAnimationData from "../assets/lottie-icon/play-to-pause-animation.json";

/**
 * LeftControls 组件事件映射
 * 键名对应 lifecycle.emit 的事件名，值类型对应事件参数
 * defineComponent<Props, Events> 第二泛型参数会自动生成 onXxx 回调 props
 */
export type LeftControlsEvents = {
  /** 点击上一个按钮 */
  prev: undefined;
  /** 点击下一个按钮 */
  next: undefined;
  /** 点击播放/暂停按钮 */
  playPause: undefined;
  /** 进度跳转，参数为跳转目标时间（秒） */
  seek: number;
  /** 组件挂载完成 */
  leftControlsMounted: undefined;
  /** 章节面板挂载完成，回传其重建 API */
  viewpointMenuMounted: { rebuildPoints: (next: ViewpointItem[]) => void };
};

/**
 * LeftControls 组件 Props 接口
 * config 和 duration 不再通过 props 传递，改为 useContext 获取
 * 避免层级穿透，与 RightControls 保持一致
 */
export interface LeftControlsProps {
  /** 播放场景：embedded 时不渲染上一个 / 下一个 */
  scene?: "station" | "embedded";
}

/**
 * LeftControls 组件 - 使用 defineComponent 创建独立组件
 * 第二泛型参数 LeftControlsEvents 声明组件可发射的事件
 * 父组件通过 onPrev、onNext 等 props 监听事件
 */
export const LeftControls = defineComponent<
  LeftControlsProps,
  LeftControlsEvents
>((props, lifecycle) => {
  /**
   * 通过 useContext 获取配置上下文
   * ConfigContext 由父组件 Controls 通过 provide 注入
   * 无需 props 传递，组件直接订阅，避免层级穿透
   */
  const configCtx = useContext(ConfigContext);
  const config = configCtx;

  /** 可订阅配置中心（由 VideoPlayer 注入），用于 prev/next 按钮「设置即生效」 */
  const configStore = useContext(ConfigStoreContext);

  /** 配置订阅清理函数 */
  const configCleanups: Array<() => void> = [];

  /**
   * 通过 useContext 获取状态管理器
   * StateContext 由 VideoPlayer 通过 provide 注入
   * duration / currentTime 等动态数据通过 useReactiveState 获取 Signal
   */
  const state = useContext(StateContext);

  /**
   * 响应式状态 Signal（useReactiveState 返回 Signal，读取 .value 自动建立依赖）
   * 在 _reactiveText / Show 的 getter 内读取 .value，signal 变化时自动更新
   */
  const currentTimeSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.CURRENT_TIME, lifecycle)
    : signal<number | undefined>(undefined);
  const durationSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.DURATION, lifecycle)
    : signal<number | undefined>(undefined);
  const playlistLengthSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.PLAYLIST_LENGTH, lifecycle)
    : signal<number | undefined>(undefined);
  const playlistIndexSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.PLAYLIST_INDEX, lifecycle)
    : signal<number | undefined>(undefined);

  /**
   * configStore 没有原生 Signal API，用 signal 包装其路径值
   * subscribePath 回调中写入 signal，VNode 内读取 .value 自动追踪
   */
  const prevConfigSignal = signal<boolean>(true);
  const nextConfigSignal = signal<boolean>(true);
  const segmentsSignal = signal<boolean>(false);

  /**
   * 时间编辑态 Signal：true 时隐藏时间文本、显示 seek 输入框
   * 通过响应式 style 绑定驱动两个元素切换（编译器包装为 __reactiveAttrs）
   */
  const timeEditingSignal = signal<boolean>(false);

  /** 从状态管理器读取当前时长，用于章节按钮等非响应式路径的初始值 */
  const duration = state?.get(PlayerStateKeyEnum.DURATION) ?? 0;

  /** 章节面板的重建 API（时长到手后用它把章节点换到与进度条同轴的时间） */
  let viewpointApi: { rebuildPoints: (next: ViewpointItem[]) => void } | null =
    null;

  // ============================================
  // DOM 引用（仅保留组件 API 引用，DOM 文本/显隐已由响应式系统管理）
  // ============================================

  /** 播放/暂停按钮图标 API 引用（LottieIcon 暴露的接口，用于调用 play/advanceSlot） */
  const playOrPauseIconBtnRef = useTemplateRef<LottieIconApi>(
    lifecycle,
    "playOrPauseIconBtnRef",
  );

  /** 时间 seek 输入框 DOM 引用（进入编辑态时赋值 / focus / select） */
  const timeSeekInputRef = useTemplateRef<HTMLInputElement>(
    lifecycle,
    "timeSeekInputRef",
  );

  // ============================================
  // 事件处理函数
  // ============================================

  /**
   * 处理上一个按钮点击
   * 通过 lifecycle.emit 发射事件，父组件通过 onPrev 监听
   */
  const handlePrev = (): void => {
    lifecycle.emit?.("prev");
  };

  /**
   * 处理下一个按钮点击
   * 通过 lifecycle.emit 发射事件，父组件通过 onNext 监听
   */
  const handleNext = (): void => {
    lifecycle.emit?.("next");
  };

  /** 当前是否正在播放（用于切换播放/暂停图标动画方向） */
  let playing: boolean = false;

  /**
   * 切换播放/暂停状态
   * 根据当前播放状态决定动画方向，然后发射 playPause 事件
   */
  const togglePlayPause = (): void => {
    if (playing) {
      playToPauseAnimation();
      playing = false;
    } else {
      pauseToPlayAnimation();
      playing = true;
    }
    lifecycle.emit?.("playPause");
  };

  /**
   * 暂停→播放图标动画
   * 先切换到播放动画槽位（slot 0），再播放
   */
  const pauseToPlayAnimation = (): void => {
    if (playOrPauseIconBtnRef.value?.getCurrentSlotIndex() != 0) {
      playOrPauseIconBtnRef.value?.advanceSlot();
    }
    playOrPauseIconBtnRef.value?.play();
  };

  /**
   * 播放→暂停图标动画
   * 先切换到暂停动画槽位（slot 1），再播放
   */
  const playToPauseAnimation = (): void => {
    if (playOrPauseIconBtnRef.value?.getCurrentSlotIndex() != 1) {
      playOrPauseIconBtnRef.value?.advanceSlot();
    }
    playOrPauseIconBtnRef.value?.play();
  };

  // ============================================
  // 时间点击编辑（点击时间 → 显示 input → 校验格式 → seek）
  // ============================================

  /**
   * 时间输入框的合法格式：可选小时位 + 分 + 秒
   * - "12:34"     → 12 分 34 秒
   * - "1:02:03"   → 1 小时 2 分 3 秒
   * - 分 / 秒必须 ≤ 59（[0-5]?\d 两位内约束），小时位不限（由时长上限兜底）
   */
  const TIME_INPUT_PATTERN = /^(?:(\d+):)?([0-5]?\d):([0-5]\d)$/;

  /**
   * 解析时间输入字符串为秒数
   * @param raw - 用户输入的原始字符串
   * @returns 对应秒数；格式非法时返回 null
   */
  const parseTimeInput = (raw: string): number | null => {
    const match = TIME_INPUT_PATTERN.exec(raw.trim());
    if (!match) return null;
    const hours = match[1] !== undefined ? Number.parseInt(match[1], 10) : 0;
    const minutes = Number.parseInt(match[2], 10);
    const seconds = Number.parseInt(match[3], 10);
    return hours * 3600 + minutes * 60 + seconds;
  };

  /**
   * 进入时间编辑态：隐藏时间文本、显示输入框
   * 输入框初值取当前播放时间（是否带小时位与时间显示格式保持一致）
   * rAF 等待响应式 style 应用到 DOM 后再 focus + select 全选
   */
  const enterTimeEditMode = (): void => {
    if (timeEditingSignal.value) return;
    timeEditingSignal.value = true;
    requestAnimationFrame(() => {
      const input = timeSeekInputRef.value;
      // rAF 回调执行时可能已退出编辑态（快速点击场景），需再次确认
      if (!input || !timeEditingSignal.value) return;
      input.value = formatTime(
        currentTimeSignal.value ?? 0,
        (durationSignal.value ?? 0) >= 3600,
      );
      input.focus();
      input.select();
    });
  };

  /**
   * 提交时间 seek：校验格式与时长上限
   * - 格式非法或超出视频时长：仅退出编辑态，不 seek
   * - 合法：退出编辑态并发射 seek 事件（父组件 Controls 转发给播放器）
   */
  const commitTimeSeek = (): void => {
    if (!timeEditingSignal.value) return;
    // 先读取输入值再翻转编辑态（翻转后输入框即将被 display:none 隐藏）
    const raw = timeSeekInputRef.value?.value ?? "";
    timeEditingSignal.value = false;
    const seconds = parseTimeInput(raw);
    if (seconds === null) return;
    const total = durationSignal.value ?? 0;
    if (total > 0 && seconds > total) return;
    lifecycle.emit?.("seek", seconds);
  };

  /** 取消时间编辑（Esc）：仅退出编辑态，不 seek */
  const cancelTimeEdit = (): void => {
    timeEditingSignal.value = false;
  };

  /**
   * 输入框失焦：点击输入框外部时提交 seek
   * 守卫说明：Enter / Esc 提交会先置编辑态为 false，
   * 随后 display:none 引发的连锁 blur 由该守卫拦截，避免重复 seek
   */
  const handleTimeInputBlur = (): void => {
    if (!timeEditingSignal.value) return;
    commitTimeSeek();
  };

  /** 输入框键盘事件：Enter 提交 seek，Escape 取消编辑 */
  const handleTimeInputKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTimeSeek();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelTimeEdit();
    }
  };

  /**
   * 上一个/下一个按钮的 SVG 图标渲染函数
   * 返回内联 SVG VNode，包含播放控制箭头图标
   */
  const nextBtnIconRenderer: () => VNode | null = () => {
    return h(
      "svg",
      {
        "xml:space": "preserve",
        "data-pointer": "none",
        style: "enable-background:new 0 0 22 22",
        viewBox: "0 0 22 22",
      },
      h("path", {
        d: "M16 5a1 1 0 0 0-1 1v4.615a1.431 1.431 0 0 0-.615-.829L7.21 5.23A1.439 1.439 0 0 0 5 6.445v9.11a1.44 1.44 0 0 0 2.21 1.215l7.175-4.555a1.436 1.436 0 0 0 .616-.828V16a1 1 0 0 0 2 0V6C17 5.448 16.552 5 16 5z",
      }),
    );
  };

  // ============================================
  // 状态监听（响应式系统：useReactiveState + onEffect）
  // ============================================
  // useContext(StateContext) 从最近的 Provider 获取状态管理器实例
  //
  // 响应式工作原理：
  //   1. useReactiveState(state, path, lifecycle) 返回 Signal<T>
  //   2. 在 _reactiveText getter 内读取 .value 自动建立响应式依赖
  //   3. signal 变化时 effect 自动重跑，精准更新对应 Text 节点（不重渲染组件）
  //   4. 在 Show 的 when getter 内读取 .value 自动条件切换
  //
  // 时间显示已迁移到 _reactiveText（VNode 中响应式渲染），无需 useState 订阅
  // prev/next 显隐已迁移到 Show + signal（VNode 中条件渲染），无需 setControlVisible
  // 播放状态仍保留 onEffect（驱动 LottieIcon.play() 组件 API 调用）

  if (state) {
    /**
     * 监听播放状态变化（保留命令式：LottieIcon.play() 是组件 API 调用，非 DOM 操作）
     * 当外部（VideoPlayer / 插件）改变播放状态时，自动切换播放/暂停图标动画
     */
    const playStateSignal = useReactiveState(
      state,
      PlayerStateKeyEnum.STATE,
      lifecycle,
    );
    onEffect(lifecycle, () => {
      const ps = playStateSignal.value as PlayerState | undefined;
      if (ps === PlayerState.PLAYING) {
        playing = true;
        pauseToPlayAnimation();
      } else if (ps === PlayerState.PAUSED || ps === PlayerState.ENDED) {
        playing = false;
        playToPauseAnimation();
      }
    });
  }

  // ============================================
  // 底部左侧按钮渲染器映射表
  // ============================================

  /**
   * 上一个按钮的 VNode 模板（不含显隐逻辑，由 Show 控制流包裹决定显隐）
   * Show 的 when getter 读取 playlistLengthSignal/playlistIndexSignal/prevConfigSignal，
   * 任意 signal 变化时自动重新评估条件，mount/destroy 切换按钮（不重渲染）
   */
  const prevButtonVNode = () =>
    h(
      "div",
      {
        role: "button",
        "aria-label": t("player.ui.controls.prev"),
        class: "nova-player-ctrl-btn nova-player-ctrl-prev",
        onClick: handlePrev,
      },
      h(
        "div",
        { class: "nova-player-ctrl-btn-icon" },
        h(
          "span",
          {
            class: "common-svg-icon",
            "data-name": "prev",
          },
          nextBtnIconRenderer(),
        ),
      ),
    );

  /** 下一个按钮的 VNode 模板（同上，由 Show 控制流决定显隐） */
  const nextButtonVNode = () =>
    h(
      "div",
      {
        role: "button",
        "aria-label": t("player.ui.controls.next"),
        class: "nova-player-ctrl-btn nova-player-ctrl-next",
        onClick: handleNext,
      },
      h(
        "div",
        { class: "nova-player-ctrl-btn-icon" },
        h(
          "span",
          {
            class: "common-svg-icon",
            "data-name": "next",
          },
          nextBtnIconRenderer(),
        ),
      ),
    );

  /**
   * prev 按钮显隐条件 getter（在 Show 的 effect 内运行，自动追踪 signal 依赖）
   * - playlistLength > 1 且 playlistIndex > 0：播放列表有多个视频且不在第一个
   * - prevConfigSignal：configStore 的 ui.controls.prev 开关
   */
  const isPrevVisible = (): boolean => {
    if (props.scene === "embedded") return false;
    const total = playlistLengthSignal.value ?? 0;
    const index = playlistIndexSignal.value ?? 0;
    return total > 1 && index > 0 && prevConfigSignal.value;
  };

  /** next 按钮显隐条件 getter（同上，index < total - 1 判断不在最后一个） */
  const isNextVisible = (): boolean => {
    if (props.scene === "embedded") return false;
    const total = playlistLengthSignal.value ?? 0;
    const index = playlistIndexSignal.value ?? 0;
    return total > 1 && index < total - 1 && nextConfigSignal.value;
  };

  /** 按钮类型到渲染函数的映射表，每个键对应一种控制按钮的渲染逻辑 */
  const bottomLeftRenderers: Record<string, () => VNode | null> = {
    /**
     * 渲染上一个按钮（Show 控制流包裹，条件变化时 mount/destroy 切换，不重渲染）
     * 替代旧的 setControlVisible + el.style.display = '...' 命令式操作
     */
    prev: () => h(Show, { when: isPrevVisible }, prevButtonVNode()),
    /** 渲染播放/暂停按钮，包含播放和暂停两个 Lottie 动画图标 */
    play: () =>
      h(
        "div",
        {
          role: "button",
          "aria-label": t("player.ui.controls.playPause"),
          class: "nova-player-ctrl-btn nova-player-ctrl-play",
          onClick: togglePlayPause,
        },
        h(
          "div",
          {
            class: "nova-player-ctrl-btn-icon",
          },
          h(LottieIcon, {
            name: "play-or-pause",
            sequence: [
              {
                animationData: pauseToPlayAnimationData,
                complete: "stop",
                autoplay: false,
              },
              {
                animationData: playToPauseAnimationData,
                complete: "stop",
                autoplay: false,
              },
            ],
            ref: "playOrPauseIconBtnRef",
          }),
        ),
      ),
    /** 渲染下一个按钮（Show 控制流包裹，同 prev） */
    next: () => h(Show, { when: isNextVisible }, nextButtonVNode()),
    /**
     * 渲染时间显示区域，包含 seek 输入框 + 当前时间/总时长文本
     * - 响应式文本：signal 变化自动更新 Text 节点
     * - 时间编辑：timeEditingSignal 驱动 input / label 的 display 切换
     *   （style 对象内读取 .value，编译器包装为 __reactiveAttrs，signal 变化自动应用样式）
     */
    time: () =>
      h(
        "div",
        { class: "nova-player-ctrl-btn nova-player-ctrl-time" },
        h("input", {
          id: "playerCtrlTimeSeekInput",
          class: "nova-player-ctrl-time-seek",
          type: "text",
          ref: "timeSeekInputRef",
          // 编辑态显示输入框，非编辑态隐藏（value 由 enterTimeEditMode 命令式赋值）
          style: { display: timeEditingSignal.value ? "" : "none" },
          onKeydown: handleTimeInputKeydown,
          onBlur: handleTimeInputBlur,
        }),
        h(
          "div",
          {
            class: "nova-player-ctrl-time-label",
            // 编辑态隐藏时间文本（与输入框互斥显示）
            style: { display: timeEditingSignal.value ? "none" : "" },
            // 点击时间进入编辑态
            onClick: enterTimeEditMode,
          },
          // 零参箭头函数 = 显式响应式 getter 协议（与 Solid 的 {() => expr} 一致）：
          // 编译器包装为 _reactiveText(() => formatTime(...))，mount 建 Text 节点 + effect，
          // currentTimeSignal 变化时自动更新 textContent，无需手动 el.textContent = ...
          h("span", { class: "nova-player-ctrl-time-current" }, () =>
            // 时长 ≥ 1 小时强制带小时位（如 00:00:00），避免播放过程中
            // 当前时间在 "MM:SS" / "HH:MM:SS" 之间来回切换
            formatTime(
              currentTimeSignal.value ?? 0,
              (durationSignal.value ?? 0) >= 3600,
            ),
          ),
          h("span", { class: "nova-player-ctrl-time-divide" }, "/"),
          h("span", { class: "nova-player-ctrl-time-duration" }, () =>
            formatTime(durationSignal.value ?? 0),
          ),
        ),
      ),
    /**
     * 渲染看点（章节）菜单（Show 控制流包裹，segmentsSignal 为 true 时 mount，false 时 destroy）
     *
     * 替代旧的 mount(vnode, container) 命令式补挂：
     * segments 变化时 segmentsSignal 自动驱动 Show mount/destroy，
     * ViewpointMenu 挂载后通过 rebuildPoints 增量更新章节点（组件 API 调用，非 DOM 操作）
     */
    viewpoint: () =>
      h(
        Show,
        { when: () => segmentsSignal.value },
        h(ViewpointMenu, {
          points: computeViewpointPoints(),
          currentTime: currentTimeSignal,
          onSeek: (time: number) => lifecycle.emit?.("seek", time),
          onViewpointMenuMounted: (api: {
            rebuildPoints: (next: ViewpointItem[]) => void;
          }) => {
            viewpointApi = api;
            // 挂载后用当前 segments 重建点位（可能比 VNode 创建时更新）
            const pts = computeViewpointPoints();
            if (pts.length > 0) api.rebuildPoints(pts);
          },
        }),
      ),
  };

  /** 底部左侧按钮的渲染顺序配置 */
  const bottomLeftOrder = ["prev", "play", "next", "time", "viewpoint"];

  /**
   * 从当前 config.progressSegments 计算章节点位
   * 供 ViewpointMenu 初始 props 和 rebuildPoints 调用共用
   * @returns 章节点位数组；分段不足 2 个时返回空数组
   */
  const computeViewpointPoints = (): ViewpointItem[] => {
    const segments = config.progressSegments;
    if (!segments || segments.length <= 1) return [];
    const mediaDuration = state?.get(PlayerStateKeyEnum.DURATION) ?? duration;
    return normalizeSegmentSpan(segments, mediaDuration).map((segment) => ({
      title: segment.label,
      time: segment.startTime,
    }));
  };

  // ============================================
  // 生命周期钩子
  // ============================================

  /**
   * 组件挂载后：
   * - 时间显示已由 _reactiveText 响应式管理，无需手动初始化 textContent
   * - prev/next 显隐已由 Show + signal 响应式管理，无需 setControlVisible
   * - 章节按钮已由 Show 控制流响应式管理（segmentsSignal 驱动 mount/destroy），无需命令式补挂
   * - 这里只需：初始化 config signal + 订阅 configStore + 注册 durationSignal 重建 effect
   */
  lifecycle.onMounted = (): void => {
    // 初始化 config signal（从 configStore 读取当前值写入 signal，驱动 Show 首次评估）
    prevConfigSignal.value =
      configStore?.getPath<boolean>("ui.controls.prev") ?? config.prev ?? true;
    nextConfigSignal.value =
      configStore?.getPath<boolean>("ui.controls.next") ?? config.next ?? true;
    segmentsSignal.value = (config.progressSegments?.length ?? 0) > 1;

    // 订阅 configStore 路径变化，更新 signal（Show 自动响应 signal 变化）
    if (configStore) {
      (["prev", "next"] as const).forEach((key) => {
        configCleanups.push(
          configStore.subscribePath(`ui.controls.${key}`, (value) => {
            if (key === "prev") prevConfigSignal.value = value !== false;
            else nextConfigSignal.value = value !== false;
          }),
        );
      });
      configCleanups.push(
        configStore.subscribePath("ui.controls.progressSegments", (value) => {
          config.progressSegments = Array.isArray(value)
            ? (value as ProgressSegment[])
            : [];
          segmentsSignal.value = config.progressSegments.length > 1;
          // segments 变化后重建点位（Show 根据 segmentsSignal 决定是否 mount/destroy）
          viewpointApi?.rebuildPoints(computeViewpointPoints());
        }),
      );
      configCleanups.push(
        configStore.subscribePath("progress.segments", (value) => {
          config.progressSegments = Array.isArray(value)
            ? (value as ProgressSegment[])
            : [];
          segmentsSignal.value = config.progressSegments.length > 1;
          viewpointApi?.rebuildPoints(computeViewpointPoints());
        }),
      );
    }

    // 时长到手后把章节点重建成与进度条同轴的时间（依赖 durationSignal）
    // 保留命令式：ViewpointMenu.rebuildPoints 是组件 API 调用，非 DOM 操作
    onEffect(lifecycle, () => {
      const mediaDuration = durationSignal.value ?? 0;
      if (mediaDuration <= 0) return;
      const segments = config.progressSegments;
      if (!segments || segments.length <= 1) return;
      viewpointApi?.rebuildPoints(computeViewpointPoints());
    });

    lifecycle.emit?.("leftControlsMounted");
  };

  /** 组件销毁前取消配置订阅 */
  lifecycle.onBeforeDestroy = (): void => {
    configCleanups.forEach((fn) => fn());
    configCleanups.length = 0;
  };

  // ============================================
  // 主渲染函数
  // ============================================
  return h(
    "div",
    { class: "nova-player-control-bottom-left" },
    ...bottomLeftOrder
      .map((key) => {
        /** 当前键对应的渲染函数 */
        const renderer = bottomLeftRenderers[key];
        if (!renderer) return null;
        return renderer();
      })
      .filter((vnode): vnode is VNode => vnode !== null),
  );
});
