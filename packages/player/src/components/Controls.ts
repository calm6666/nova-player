/**
 * ============================================
 * 控制条组件 (Controls)
 * ============================================
 * 声明式响应式版本：
 * - 时间文本由 LeftControls 响应式渲染（订阅 DURATION/CURRENT_TIME 运行时状态）
 * - 音量数值 / 音量条 / 静音图标由 VolumeSlider 响应式管理（订阅 VOLUME 状态）
 * - 进度滑块由 TopControls 自行管理
 *   历史遗留的对应 DOM 引用与命令式更新函数已随子组件接管而移除；
 *   对外 ControlsAPI 契约保持不变（显示类方法保留为文档化空实现，父层零改动）
 * - 控制栏本体保留的命令式仅为 C 类时序行为：tooltip 按钮由左右控制栏
 *   子组件渲染，父层挂载后 querySelector 检索并挂载原生鼠标事件
 * - data-shadow-show 由 shadowShowSignal 响应式驱动（__reactiveAttrs），
 *   高能进度条由 Show + pbpRenderedSignal 条件渲染
 */

import {
  h,
  defineComponent,
  useTemplateRef,
  useContext,
  useReactiveState,
  signal,
  onEffect,
  untracked,
  Show,
} from "@/core";
import type { Tooltip, ControlsConfig } from "@/nova/types";
import type { PlayerScene } from "@/types";
import type { PlayerPluginFlags } from "./PlayerDocker";
import type {
  EnergyProgressData,
  EnergyProgressProvider,
  ProgressPreviewProvider,
  ProgressSegment,
  ProgressSkipPoints,
} from "@/types";
import {
  ConfigContext,
  PlayerStateKeyEnum,
  StateContext,
} from "@/store/runtimeState";
import type { PlayerStateMap, TypedStateManager } from "@/store/runtimeState";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import type { AnimationFrameID } from "@/utils/rafTimeout";
import { isBrowser } from "@/utils";
import { ComponentEventEnum } from "@/core/events";
import { LeftControls } from "./LeftControls";
import { RightControls } from "./RightControls";
import { TopControls } from "./TopControls";
import { PbpControls } from "./PbpControls";
import { ShadowProgressArea } from "./ShadowProgressArea";
import type { ShadowProgressAreaApi } from "./ShadowProgressArea";
import type { ProgressBarApi } from "./ProgressBar";

/**
 * 视频进度数据
 */
interface VideoPlayerProgress {
  /** 当前播放时间（秒） */
  currentTime: number;
}

/**
 * Controls 组件 Props 接口
 */
export type ControlsEvents = {
  controlsMounted: ControlsAPI;
  playPause: undefined;
  seek: number;
  seekStart: undefined;
  seekEnd: undefined;
  volumeChange: number;
  muteToggle: undefined;
  backrateChange: number;
  /** 全屏切换 */
  fullscreenToggle: undefined;
  /** 网页全屏切换 */
  webFullscreenToggle: undefined;
  /** 画中画切换 */
  pipToggle: undefined;
  /** 宽屏切换（播放器只更新状态与回调，布局由外部容器决定） */
  wideToggle: undefined;
  prev: undefined;
  next: undefined;
  qualityChange: string;
  /** 选集面板选择某一集，值为列表下标 */
  eplistChange: number;
  subtitleToggle: boolean;
  subtitleLangChange: string;
  subtitleStyleChange: {
    fontSize?: number;
    color?: string;
    position?: "top" | "bottom";
    offset?: number;
    strokeColor?: string;
    strokeWidth?: number;
    opacity?: number;
    scale?: boolean;
    fade?: boolean;
  };
  bilingualChange: boolean;
  settingChange: { key: string; value: boolean | string | number };
  moreSettingClick: undefined;
  showTooltip: Tooltip;
  hideTooltip: Tooltip;
  progressChange: number;
  stateChange: unknown;
  /** 顶部进度条挂载完成，向上层回传其更新 API */
  progressBarMounted: ProgressBarApi;
};

export interface ControlsProps {
  duration: number;
  volume: number;
  backrate: number;
  /** 播放场景：embedded 时使用简化控制栏（无 pip / wide / web / 设置等） */
  scene?: PlayerScene;
  /** 预览图提供者（progress.previewProvider 配置注入，透传给顶部进度条） */
  previewProvider?: ProgressPreviewProvider;
  /** 高能进度条数据提供者（progress.energyProvider 配置注入，异步到达后写入 PbpControls） */
  energyProvider?: EnergyProgressProvider;
  /** 片头 / 片尾跳过断点（progress.skipPoints 配置注入，透传给顶部进度条） */
  skipPoints?: ProgressSkipPoints;
  /**
   * 插件安装标志读取器（getter 形态，PlayerDocker 透传）：
   * 响应式表达式 / effect 内调用读取，未装 subtitle 插件时字幕
   * 按钮整体隐藏，支持运行中装卸插件
   */
  plugins?: () => PlayerPluginFlags;
}

/**
 * 控制栏暴露的 API 接口
 */
export interface ControlsAPI {
  /** 更新音量显示 */
  updateVolumeDisplay: (vol: number) => void;
  /** 显示控制栏 */
  showControl: () => void;
  /** 隐藏控制栏 */
  hideControl: () => void;
  /** 更新静音状态 */
  updateMute: (isMuted: boolean) => void;
  /** 更新缓冲进度 */
  updateBuffer: (buffer: number) => void;
  /** 更新当前播放时间 */
  updateCurrent: (current: number) => void;
  /** 初始化时长显示 */
  initDuration: () => void;
  /** 更新总时长（底部影子进度条与进度条分段共用） */
  setDuration: (duration: number) => void;
  /** 重建底部影子进度条分段（progress.segments 运行时变化时调用） */
  setProgressSegments: (segments?: ProgressSegment[]) => void;
  /** 分段进度条常驻展开开关（仅多段时生效） */
  setShadowPermanent: (enabled: boolean) => void;
  /** 注入高能进度条数据（客户端水合后唯一数据源） */
  setEnergy: (data: EnergyProgressData | null) => void;
}

/**
 * 控制条组件
 */
export const Controls = defineComponent<ControlsProps, ControlsEvents>(
  (props, lifecycle) => {
    // ============================================
    // 状态数据
    // ============================================

    /** 视频总时长由 props 直接提供；元数据更新仍通过 setDuration 同步给子条 */
    const configCtx = useContext<ControlsConfig>(ConfigContext);
    /** 控制条配置（浅拷贝，避免修改原始 props） */
    const config: ControlsConfig = {
      ...configCtx,
    };

    const stateMgr = useContext<TypedStateManager<PlayerStateMap> | null>(
      StateContext,
    );

    /** 底部影子进度条 API（由 ShadowProgressArea 挂载后填充） */
    let shadowApi: ShadowProgressAreaApi | null = null;

    /** 高能进度条常驻态初值：读运行时状态（由 VideoPlayer 构造期写入——
     *  持久化恢复或「多分段即常驻」规则兜底），此处禁止再无条件 set：
     *  setup 无条件覆盖会把构造期恢复的持久化值抹掉，并经落库订阅
     *  把覆盖值写回 store，导致用户设置每次刷新被重置 */
    let pbpPermanent = Boolean(stateMgr?.get(PlayerStateKeyEnum.PBP_PERMANENT));

    /**
     * 响应式信号：高能进度条渲染态
     * 驱动 PbpControls 的条件渲染（Show 控制流）：
     * false → 整个组件不挂载；重新勾选 → 重新挂载并通过 onPbpControlsMounted 恢复数据
     * undefined 兜底为 true（状态写入早于本组件 setup，正常不会出现）
     */
    const pbpRenderedSignal = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.PBP_RENDERED, lifecycle)
      : signal<boolean | undefined>(undefined);

    /** 应用常驻态到运行时状态（订阅方据此更新影子进度条与高能进度条） */
    const applyPermanent = (next: boolean): void => {
      pbpPermanent = next;
      stateMgr?.set(PlayerStateKeyEnum.PBP_PERMANENT, next);
    };

    /**
     * 分段进度条常驻展开：
     * 必须同时满足「配置开启」+「多段」，否则 .permanent 不展开。
     */
    let shadowPermanentEnabled = config.shadowPermanent === true;
    let shadowSegments = config.progressSegments ?? [];

    /** 同步影子进度条常驻态：只由分段开关 + 多段决定 */
    const syncShadowPermanent = (): void => {
      // 只由 progress.shadowPermanent / progress.applyPermanent 决定
      const permanent: boolean = shadowPermanentEnabled;
      shadowApi?.setPermanent(permanent);
      pbpApi?.setPermanent(permanent);
    };

    // 常驻态订阅：图钉点击写入运行时状态，这里落到影子条与高能条。
    // 必须在 setup 阶段调用 onEffect：mount 在 onMounted 阶段先启动 _effects 再执行用户钩子，
    // 若在 onMounted 回调内注册，effect 将错过启动窗口永不运行，pin 点击后状态无人消费（点击失效根因）
    if (stateMgr) {
      const pbpPermanentSignal = useReactiveState(
        stateMgr,
        PlayerStateKeyEnum.PBP_PERMANENT,
        lifecycle,
      );
      onEffect(lifecycle, () => {
        pbpPermanent = Boolean(pbpPermanentSignal.value);
        syncShadowPermanent();
        pbpApi?.setPbpPermanent(pbpPermanent);
        pbpApi?.setPermanent(pbpPermanent);
        pbpApi?.setShow(pbpPermanent || !shadowShowSignal.value);
      });

      /**
       * 播放列表索引变化兜底：切换视频时 prev/next 按钮可能被 Show 控制流
       * 销毁（如切到第一集时上一个按钮卸载），若其 tip 正在显示，按钮销毁
       * 后不会再有 mouseout 冒泡到委托容器，tip 会永久残留——这里在索引
       * 变化时主动关闭两个按钮的 tip 并清理悬停状态
       */
      const playlistIndexSignal = useReactiveState(
        stateMgr,
        PlayerStateKeyEnum.PLAYLIST_INDEX,
        lifecycle,
      );
      onEffect(lifecycle, () => {
        // 读取建立依赖：索引变化（切换视频）时重跑
        playlistIndexSignal.value;
        // 副作用必须包裹 untracked 阻断依赖追踪泄漏：
        //   hideTip / emit("hideTooltip") 的同步调用链会一路延伸到
        //   Tooltips.hideTooltip，其幂等守卫 `name in activePositionsSig.value`
        //   会读取 Tooltips 内部的 tip 显示状态 signal——若不隔离，该 signal
        //   会被收集为本 effect 的依赖，此后每次 tip 显示（openTip 写入
        //   activePositionsSig）都会触发本 effect 重跑，立即关闭刚显示的
        //   tip 并清空 hoveredTipBtn，表现为切换视频后 prev/next 的 tip
        //   永远无法显示（首次切换时 Tooltips 已挂载、closeTip 真正执行，
        //   污染订阅恰好在那一次重跑中建立）
        untracked(() => {
          if (hoveredTipBtn) {
            const stale = hoveredTipBtn;
            hoveredTipBtn = null;
            hideTip(stale);
          } else {
            // 未悬停时也兜底关闭（tip 可能因按钮销毁而残留，悬停状态已丢失）
            tooltipBtns
              .filter((btn) => btn.name === "prev" || btn.name === "next")
              .forEach((btn) => {
                lifecycle.emit?.(ComponentEventEnum.STATE_CHANGE, {
                  tooltip: btn,
                  action: "hide",
                });
                lifecycle.emit?.("hideTooltip", btn);
              });
          }
        });
      });
    }

    /** 视频进度数据（currentTime 用于高能进度条重挂时恢复进度） */
    const videoProgress: VideoPlayerProgress = {
      currentTime: 0,
    };

    // ============================================
    // 响应式 Signal（驱动 onEffect / _reactiveText 自动更新 DOM）
    // ============================================

    /** 影子进度条显隐 Signal（驱动 data-shadow-show 属性） */
    const shadowShowSignal = signal<boolean>(true);

    /** 需要显示提示信息的按钮列表 */
    const tooltipBtns: Tooltip[] = [
      { element: null, name: "prev", dataName: "ctrl:prev" },
      { element: null, name: "next", dataName: "ctrl:next" },
      { element: null, name: "pip", dataName: "ctrl:pip" },
      { element: null, name: "wide", dataName: "ctrl:widescreen" },
      { element: null, name: "web", dataName: "ctrl:webscreen" },
      { element: null, name: "full", dataName: "ctrl:fullscreen" },
    ];

    /** 提示按钮延迟显示的定时器 */
    let inTimer: AnimationFrameID | null = null;

    /** 提示按钮名 → 选择器（按钮由左右控制栏子组件渲染，父层挂载后才可检索到） */
    const TOOLTIP_SELECTORS: Record<string, string> = {
      prev: ".nova-player-ctrl-btn.nova-player-ctrl-prev",
      next: ".nova-player-ctrl-btn.nova-player-ctrl-next",
      pip: ".nova-player-ctrl-btn.nova-player-ctrl-pip",
      wide: ".nova-player-ctrl-btn.nova-player-ctrl-wide",
      web: ".nova-player-ctrl-btn.nova-player-ctrl-web",
      full: ".nova-player-ctrl-btn.nova-player-ctrl-full",
    };

    /** 当前悬停中的提示按钮（委托去重：按钮内部子元素间移动不重复触发） */
    let hoveredTipBtn: Tooltip | null = null;

    // ============================================
    // DOM 元素引用（全部通过 ref 对象获取）
    // ============================================

    /** 控制栏主体容器元素（tooltip 按钮检索的根节点） */
    const controlEntityRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "controlEntityRef",
    );
    // 说明：时间 / 音量 / 倍速 / 进度滑块的显示元素已由 LeftControls /
    // VolumeSlider / RightControls / TopControls 子组件自行渲染并响应式管理，
    // 控制栏不再持有对应 DOM 引用（历史遗留的空引用已移除）
    // 高能进度条 API（由 PbpControls 挂载后填充）
    let pbpApi: {
      setShow: (show: boolean) => void;
      setPbpPermanent: (pbpPermanent: boolean) => void;
      setPermanent: (permanent: boolean) => void;
      setEnergy: (data: EnergyProgressData | null) => void;
      setProgress: (time: number) => void;
      setDuration: (duration: number) => void;
    } | null = null;

    /** 高能数据请求序号（异步 energyProvider 竞态保护：仅应用最新一次请求的结果） */
    let energyRequestId = 0;

    /** 外部注入的高能数据；undefined 表示尚未注入 */
    let injectedEnergy: EnergyProgressData | null | undefined;
    const setEnergy = (data: EnergyProgressData | null): void => {
      injectedEnergy = data;
      pbpApi?.setEnergy(data);
    };

    /**
     * 拉取高能进度条数据（同步或异步 provider 均兼容）
     *
     * 数据获取逻辑由外部实现（progress.energyProvider 配置注入）：
     * - 同步返回：立即写入 PbpControls；
     * - 异步返回：resolve 后经序号校验再写入，过期的响应（组件重挂期间
     *   发起的更新请求）直接丢弃，避免旧数据覆盖新数据。
     */
    const loadEnergyData = (): void => {
      if (injectedEnergy !== undefined) {
        pbpApi?.setEnergy(injectedEnergy);
        return;
      }
      const provider = props.energyProvider;
      if (!provider) return;
      energyRequestId += 1;
      const requestId = energyRequestId;
      const result = provider();
      if (result instanceof Promise) {
        void result
          .then((data) => {
            if (requestId !== energyRequestId) return;
            pbpApi?.setEnergy(data);
          })
          .catch(() => {
            // 获取失败视为无高能数据：不影响曲线已绘制的状态，静默降级
          });
        return;
      }
      pbpApi?.setEnergy(result);
    };

    // ============================================
    // 事件处理函数
    // ============================================

    /**
     * 从事件目标解析命中的提示按钮（含命中元素本体）
     *
     * @param target - mouseover/mouseout 的事件目标
     * @returns 命中的按钮描述；未命中任何提示按钮时返回 null
     */
    const findTipBtnFromTarget = (
      target: EventTarget | null,
    ): Tooltip | null => {
      if (!(target instanceof Element)) return null;
      for (const btn of tooltipBtns) {
        const selector = TOOLTIP_SELECTORS[btn.name] ?? "";
        const element = selector ? target.closest<HTMLElement>(selector) : null;
        if (element) {
          return { element, name: btn.name, dataName: btn.dataName };
        }
      }
      return null;
    };

    /**
     * 隐藏指定提示按钮的 tip 并清理悬停状态
     * @param btn - 要隐藏的按钮描述
     */
    const hideTip = (btn: Tooltip): void => {
      if (inTimer !== null) {
        cancelRaf(inTimer);
        inTimer = null;
      }
      lifecycle.emit?.(ComponentEventEnum.STATE_CHANGE, {
        tooltip: btn,
        action: "hide",
      });
      lifecycle.emit?.("hideTooltip", btn);
    };

    /**
     * 初始化提示按钮的鼠标悬浮事件，延迟 300ms 显示/立即隐藏提示
     *
     * 采用容器级事件委托（mouseover/mouseout + closest 匹配）而非逐按钮
     * 绑定 mouseenter/mouseleave：prev/next 按钮由 LeftControls 内的 Show
     * 控制流条件渲染，切换视频（如切到第一集）时按钮 DOM 会被销毁重建——
     * 逐按钮绑定会让重建后的新按钮失去事件，且正在显示的 tip 因按钮销毁
     * 而永远收不到 mouseleave，永久残留在屏幕上；委托到常驻的控制栏容器
     * 则不受按钮销毁/重建影响（C 类保留命令式：跨子组件 DOM 的一次性时序行为）
     *
     * @param entity - 控制栏主体容器元素（六个提示按钮的共同祖先）
     */
    const initTooltip = (entity: HTMLDivElement): void => {
      entity.addEventListener("mouseover", (event: MouseEvent) => {
        const btn = findTipBtnFromTarget(event.target);
        if (!btn) return;
        // 去重：按钮内部子元素间移动（同一按钮）不重复触发
        if (hoveredTipBtn && hoveredTipBtn.element === btn.element) return;
        // 从其它按钮/空白处移入新按钮：撤销旧的待显示定时器并隐藏旧 tip
        if (hoveredTipBtn) {
          hideTip(hoveredTipBtn);
        }
        hoveredTipBtn = btn;
        if (inTimer !== null) {
          cancelRaf(inTimer);
        }
        inTimer = rafTimeout(() => {
          inTimer = null;
          lifecycle.emit?.(ComponentEventEnum.STATE_CHANGE, {
            tooltip: btn,
            action: "show",
          });
          lifecycle.emit?.("showTooltip", btn);
        }, 300);
      });

      entity.addEventListener("mouseout", (event: MouseEvent) => {
        const current = hoveredTipBtn;
        if (!current || !current.element) return;
        // 仅处理「离开当前悬停按钮」：事件目标在按钮内、
        // 且相关目标（移入目的地）不在按钮内时才算真正离开
        if (
          !(event.target instanceof Node) ||
          !current.element.contains(event.target)
        ) {
          return;
        }
        const related = event.relatedTarget;
        if (related instanceof Node && current.element.contains(related)) {
          return;
        }
        hoveredTipBtn = null;
        hideTip(current);
      });
    };

    // ============================================
    // 更新函数
    // ============================================

    /**
     * 更新当前播放时间，转发给底部影子进度条与高能进度条
     * （时间文本由 LeftControls 响应式渲染、滑块由 TopControls 自行管理，无需命令式同步）
     * @param current - 当前播放时间（秒）
     */
    const updateCurrent = (current: number): void => {
      videoProgress.currentTime = current;
      // 底部影子进度条与顶部进度条同源：控制栏隐藏时显示的就是它
      shadowApi?.updateProgress(current);
      // 高能进度条按同一进度重绘已播放面积
      pbpApi?.setProgress(current);
    };

    /**
     * 更新音量显示（契约保留，内部为空实现）
     * 音量数值 / 音量条 / 静音图标已由 VolumeSlider 子组件响应式管理
     * （订阅 PlayerStateKeyEnum.VOLUME 运行时状态，父层写状态后自动同步），
     * 本方法仅为维持 ControlsAPI 对外契约（PlayerDocker 沿用既有调用）
     * @param _newVolume - 新的音量值，范围 0-1（显示已由子组件接管，未使用）
     */
    const updateVolumeDisplay = (_newVolume: number): void => {};

    /**
     * 初始化总时长文本显示（契约保留，内部为空实现）
     * 总时长文本由 LeftControls 响应式渲染（订阅 DURATION 运行时状态），
     * 本方法仅为维持 ControlsAPI 对外契约（PlayerDocker 沿用既有调用）
     */
    const initDuration = (): void => {};

    /**
     * 更新总时长，并同步到底部影子进度条
     * @param value - 视频总时长（秒）
     */
    const setDuration = (value: number): void => {
      shadowApi?.setDuration(value);
      // 高能进度条需要总时长把播放进度换算成采样点下标
      pbpApi?.setDuration(value);
    };

    /**
     * 重建底部影子进度条分段（顶部进度条由上层经 ProgressBarApi 重建）
     * @param next - 最新分段数据
     */
    const setProgressSegments = (next?: ProgressSegment[]): void => {
      shadowSegments = next ?? [];
      shadowApi?.rebuildSegments(next);
      // 不再因「多段」自动常驻；只有 progress.shadowPermanent 开启才展开
      syncShadowPermanent();
    };

    /** 运行时切换分段进度条常驻展开（仅多段时生效） */
    const setShadowPermanent = (enabled: boolean): void => {
      shadowPermanentEnabled = enabled;
      syncShadowPermanent();
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    const applyShadowShow = (show: boolean): void => {
      shadowShowSignal.value = show;
      pbpApi?.setShow(!show);
    };

    lifecycle.onMounted = (): void => {
      // 常驻态订阅已在 setup 阶段注册（onEffect 依赖 mount 的 _effects 启动窗口，onMounted 回调内注册不会生效）
      syncShadowPermanent();
      pbpApi?.setPbpPermanent(pbpPermanent);

      // 填充菜单配置：子组件（LeftControls / RightControls）先于父组件挂载，
      // 此处控制条主体 DOM 已就绪，可在实体容器上挂载 tooltip 事件委托
      // （与既有实现 initMenu 的容器级初始化方式一致）
      const entity = controlEntityRef.value;
      if (entity) {
        initTooltip(entity);
      }

      // 影子进度条显隐初始态（响应式 attr 已订阅 shadowShowSignal，自动驱动 data-shadow-show 属性）
      shadowShowSignal.value = true;

      // 暴露控制栏 API 给父组件
      lifecycle.emit?.("controlsMounted", {
        updateVolumeDisplay,
        showControl: () => {
          applyShadowShow(false);
        },
        hideControl: () => {
          applyShadowShow(true);
        },
        updateMute: (_isMuted: boolean) => {
          // 契约保留：静音图标由 VolumeSlider 响应式管理，无需转发
        },
        updateBuffer: (buffer: number) => {
          shadowApi?.updateBuffer(buffer);
        },
        updateCurrent,
        initDuration,
        setDuration,
        setProgressSegments,
        setShadowPermanent,
        setEnergy,
      });
    };

    // ============================================
    // 子组件事件处理函数
    // ============================================

    /**
     * 处理左侧控制栏组件的事件分发
     * @param event - 事件名称
     * @param arg1 - 事件参数1
     * @param arg2 - 事件参数2
     */
    const handleLeftSeek = (time: number): void => {
      lifecycle.emit?.("seek", time);
    };

    /**
     * 处理右侧控制栏组件的事件分发
     * @param event - 事件名称
     * @param arg1 - 事件参数1（可能是鼠标事件、数字或字符串）
     * @param arg2 - 事件参数2
     */
    const handleRightBackrateChange = (rate: number): void => {
      lifecycle.emit?.("backrateChange", rate);
    };

    const handleRightQualityChange = (quality: string): void => {
      lifecycle.emit?.("qualityChange", quality);
    };

    /** 选集面板选择某一集：仅透传下标，由上层接到 VideoPlayer.switchTo(index) */
    /** 字幕：开关向上转发 */
    const handleRightSubtitleToggle = (visible: boolean): void => {
      lifecycle.emit?.("subtitleToggle", visible);
    };

    /** 字幕：语言切换向上转发 */
    const handleRightSubtitleLangChange = (lang: string): void => {
      lifecycle.emit?.("subtitleLangChange", lang);
    };

    /** 字幕：样式变化向上转发 */
    const handleRightSubtitleStyleChange = (patch: {
      fontSize?: number;
      color?: string;
      position?: "top" | "bottom";
      offset?: number;
      strokeColor?: string;
      strokeWidth?: number;
      opacity?: number;
      scale?: boolean;
      fade?: boolean;
    }): void => {
      lifecycle.emit?.("subtitleStyleChange", patch);
    };

    /** 字幕：双语开关向上转发 */
    const handleRightBilingualChange = (enabled: boolean): void => {
      lifecycle.emit?.("bilingualChange", enabled);
    };

    const handleRightEplistChange = (index: number): void => {
      lifecycle.emit?.("eplistChange", index);
    };

    const handleRightSettingChange = (payload: {
      key: string;
      value: boolean | string | number;
    }): void => {
      // 「高能进度条」复选框（key=highenergy）现在只写渲染态（PBP_RENDERED），
      // 渲染由 Controls 的 Show 条件渲染消费，常驻态归图钉（pbpPinClick）管理，无需命令式转发
      lifecycle.emit?.("settingChange", payload);
    };

    // ============================================
    // 主渲染函数
    // ============================================

    return h(
      "div",
      { class: "nova-player-control-wrap" },
      h("div", { class: "nova-player-control-mask" }),
      h(
        "div",
        {
          class: "nova-player-control-entity",
          // shadowShowSignal 初始为 true（与既有实现一致）：
          // scss 中 data-shadow-show="false" 会强制显示 .nova-player-control-top（进度条），
          // 而 data-ctrl-hidden 只控制 .nova-player-control-bottom 的显隐。
          // 若初始为 "false"，会出现「进度条显示了但底部按钮没一起显示」的不同步现象。
          // 响应式 attr：编译器自动 __reactiveAttrs，shadowShowSignal 变化时自动更新 DOM
          "data-shadow-show": shadowShowSignal.value ? "true" : "false",
          ref: "controlEntityRef",
        },
        h(TopControls, {
          progressSegments: config.progressSegments,
          previewProvider: props.previewProvider,
          skipPoints: props.skipPoints,
          onSeek: (time) => {
            updateCurrent(time);
            lifecycle.emit?.("seek", time);
          },
          onSeekStart: () => {
            lifecycle.emit?.("seekStart");
          },
          onSeekEnd: () => {
            lifecycle.emit?.("seekEnd");
          },
          // 继续向上转发 ProgressBar 的更新 API，最终由 PlayerDocker 持有
          onProgressBarMounted: (api) =>
            lifecycle.emit?.("progressBarMounted", api),
        }),
        h(
          "div",
          { class: "nova-player-control-bottom" },
          h(LeftControls, {
            scene: props.scene,
            onPrev: () => lifecycle.emit?.("prev"),
            onNext: () => lifecycle.emit?.("next"),
            onPlayPause: () => lifecycle.emit?.("playPause"),
            onSeek: handleLeftSeek,
          }),
          h("div", { class: "nova-player-control-bottom-center" }),
          h(RightControls, {
            scene: props.scene,
            /** 插件安装标志信号：字幕按钮按 subtitle 标志显隐（透传） */
            plugins: props.plugins,
            onFullscreen: () => lifecycle.emit?.("fullscreenToggle"),
            onWebFullscreen: () => lifecycle.emit?.("webFullscreenToggle"),
            onPip: () => lifecycle.emit?.("pipToggle"),
            onWide: () => lifecycle.emit?.("wideToggle"),
            onMute: () => lifecycle.emit?.("muteToggle"),
            onBackrateChange: handleRightBackrateChange,
            onVolumeChange: (vol) => {
              updateVolumeDisplay(vol);
              lifecycle.emit?.("volumeChange", vol);
            },
            onMuteToggle: () => lifecycle.emit?.("muteToggle"),
            onQualityChange: handleRightQualityChange,
            onEplistChange: handleRightEplistChange,
            onSubtitleToggle: handleRightSubtitleToggle,
            onSubtitleLangChange: handleRightSubtitleLangChange,
            onSubtitleStyleChange: handleRightSubtitleStyleChange,
            onBilingualChange: handleRightBilingualChange,
            onSettingChange: handleRightSettingChange,
            onMoreSettingClick: () => lifecycle.emit?.("moreSettingClick"),
          }),
        ),
        // 底部影子进度条（控制栏隐藏时常驻下沿，与顶部进度条同几何同数据源）
        h(ShadowProgressArea, {
          duration: props.duration,
          progressSegments: shadowSegments,
          permanent: shadowPermanentEnabled,
          onShadowProgressAreaMounted: (api: ShadowProgressAreaApi) => {
            shadowApi = api;
          },
        }),
        // 高能进度条（常驻 DOM，控制栏展开时由 setShow(true) 抬到控制栏之上）
        // 渲染开关（设置面板复选框）驱动 Show 条件渲染：false → 整个组件不挂载
        h(
          Show,
          { when: () => isBrowser() && pbpRenderedSignal.value !== false },
          h(PbpControls, {
            // 常驻态初值：来自播放器配置 / 持久化恢复（构造期已写入
            // PBP_PERMANENT 运行时状态，setup 读取为局部快照传入 props，
            // PbpControls 以此初始化 permanentSignal）；后续更新走两条链：
            // 1. PBP_PERMANENT 状态订阅 → pbpApi.setPermanent（图钉点击/程序切换）
            // 2. Show 销毁重建时 onPbpControlsMounted 里重新补调
            permanent: shadowPermanentEnabled,
            onPbpControlsMounted: (api: {
              setShow: (show: boolean) => void;
              setPermanent: (permanent: boolean) => void;
              setPbpPermanent: (pbpPermanent: boolean) => void;
              setEnergy: (data: EnergyProgressData | null) => void;
              setProgress: (time: number) => void;
              setDuration: (duration: number) => void;
            }) => {
              pbpApi = api;
              // 数据与常驻态可能早于组件挂载到达：挂载时补一次
              // 重新勾选（Show 由 false → true）时也走这里恢复数据
              api.setDuration(props.duration);
              api.setPbpPermanent(pbpPermanent);
              // 恢复展开态：重挂实例的 showSignal 重置为 false，
              // 若控制栏正显示中（shadowShow=false）不补调 setShow，
              // 高能条会落回 bottom:3px 被 mask 遮罩盖住（z-index:-1），勾选后肉眼不可见
              api.setShow(!shadowShowSignal.value);
              // 高能数据经 energyProvider 拉取（异步结果经序号校验写入，
              // 重新勾选 Show 由 false → true 时也走这里恢复数据）
              if (injectedEnergy !== undefined) api.setEnergy(injectedEnergy);
              else loadEnergyData();
              api.setProgress(videoProgress.currentTime);
            },
            onPbpClick: ({ time }: { time: number }) => {
              // 点击高能进度条曲线：跳转到对应时间点（上抛 seek 事件由 VideoPlayer 处理）
              lifecycle.emit?.("seek", time);
            },
            // 图钉：切换《高能进度条》常驻（与提示文案语义一致）
            onPbpPinClick: () => {
              const current = Boolean(
                stateMgr?.get(PlayerStateKeyEnum.PBP_PERMANENT),
              );
              applyPermanent(!current);
            },
          }),
        ),
      ),
    );
  },
);
