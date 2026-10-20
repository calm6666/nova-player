/**
 * ============================================
 * 播放器主容器组件 (PlayerDocker)
 * ============================================
 */

import {
  defineComponent,
  h,
  mount,
  destroy,
  useTemplateRef,
  useContext,
  useState,
  Show,
  t,
} from "@/core";
import type { TypedStateManager } from "@/core";
import type { PlayerEventBus } from "@/core/events";
import { useComponentUnmount } from "@/nova/core/componentUnmount";
import type { EnergyProgressProvider, ProgressPreviewProvider } from "@/types";
import { createHotkeyHandlers, type HotkeyContext } from "@/nova/core/hotkeys";
import {
  isBrowser,
  safeResizeObserver,
  safeIntersectionObserver,
} from "@/utils";
import { Controls } from "@/nova/components/Controls";
import type { ControlsAPI } from "@/nova/components/Controls";
import type { Tooltip } from "@/nova/types";
import type { ProgressBarApi } from "@/nova/components/ProgressBar";
import { VolumeHint } from "@/nova/components/VolumeHint";
import { Tooltips } from "@/nova/components/Tooltips";
import { RowDm } from "@/nova/components/RowDm";
import { SubtitleLayer } from "@/nova/components/SubtitleLayer";
import { InteractionLayer } from "@/nova/components/InteractionLayer";
import { InteractiveVideoLayer } from "@/nova/components/InteractiveVideoLayer";
import type { InteractiveVideoLayerAPI } from "@/nova/components/InteractiveVideoLayer";
import { ErrorSign } from "@/nova/components/ErrorSign";
import type { ErrorSignAPI, ErrorSignInfo } from "@/nova/components/ErrorSign";
import { Dialog } from "@/nova/components/Dialog";
import { Context as ContextMenu } from "@/nova/components/Context";
import {
  HotkeyPanel,
  type HotkeyPanelApi,
} from "@/nova/components/HotkeyPanel";
import { PlayerEventEnum } from "@/core/events";
import {
  PlayerStateKeyEnum,
  StateContext,
  type PlayerStateMap,
} from "@/store/runtimeState";
import { ConfigStoreContext, type ConfigStore } from "@/store/configStore";
import type { VideoPlayer } from "@/player/VideoPlayer";
import {
  PlayerContext,
  isSlotMount,
  resolveSlotContent,
  type SlotContent,
  type SlotContext,
  type SlotMount,
} from "@/nova/types/slots";
import { PlayerState } from "@/types";
import type {
  DisplayMode,
  PlayerConfig,
  ProgressSegment,
  VNode,
} from "@/types";
import type { QualityLevel } from "@/types/streamPlugin";
import { Toast } from "@/nova/components/Toast";
import type { ToastOptions } from "@/nova/components/Toast";
import { Loading } from "@/nova/components/Loading";
import { State } from "@/nova/components/State";
import { createBufferSpeedSampler } from "@/nova/utils/media/bufferSpeed";
import type { BufferSpeedSampler } from "@/nova/utils/media/bufferSpeed";
import { SendBar } from "@/nova/components/SendBar";
import { ColorPanel, type ColorPanelApi } from "@/nova/components/ColorPanel";
import {
  AudioPanel,
  type AudioPanelApi,
  type AudioPanelHandle,
} from "@/nova/components/AudioPanel";
import { VideoInfo, type VideoInfoApi } from "@/nova/components/VideoInfo";
import { RelationStrip } from "@/nova/components/RelationStrip";
import { Mini, type MiniApi } from "@/nova/components/Mini";

// ============================================
// 组件 API 接口定义
// ============================================

/** 弹幕层 API */
interface DanmakuLayerAPI {
  /** 切换弹幕播放/暂停状态（根容器 danmaku-x-paused 类，原版暂停机制） */
  playPause: (state: "playing" | "paused") => void;
  /** 显示弹幕提示信息 */
  showDmTip: (event: MouseEvent, element: HTMLElement) => void;
  /** 隐藏弹幕提示信息 */
  hideDmTip: (element: HTMLElement) => void;
}

/** SendBar 组件挂载后回传的控制 API */
interface SendBarAPI {
  /** 设置输入框的值 */
  setInputValue: (value: string) => void;
  /** 设置弹幕开关状态 */
  setDanmakuSwitch: (enabled: boolean) => void;
  /** 聚焦弹幕输入框 */
  focusInput: () => void;
  /** 让弹幕输入框失去焦点 */
  blurInput: () => void;
}

/** Toast 组件挂载后回传的控制 API */
interface ToastAPI {
  /** 显示自动消失的短暂提示 */
  showAutoToast: (text: string, duration?: number) => void;
  /** 隐藏自动消失的短暂提示 */
  hideAutoToast: () => void;
  /** 显示固定提示 */
  showFixedToast: (text: string, jumpTime: string) => void;
  /** 隐藏固定提示 */
  hideFixedToast: () => void;
  /** 通用 Toast（自动 / 手动关闭 / 徽章 / 确认 / 固定） */
  showToast?: (options: ToastOptions) => number | void;
}

/** Loading 组件挂载后回传的控制 API */
interface LoadingAPI {
  /** 显示加载面板 */
  show: () => void;
  /** 隐藏加载面板 */
  hide: () => void;
  /** 设置加载提示文本 */
  setText: (text: string) => void;
}

/** State 组件挂载后回传的控制 API */
interface StateAPI {
  /** 更新缓冲速度文本（字节/秒；无效值会隐藏速度文本） */
  updateBufferSpeed: (speed: number) => void;
  /** 显示缓冲图标与文本（「正在缓冲...」） */
  showBuffering: () => void;
  /** 隐藏缓冲图标与文本 */
  hideBuffering: () => void;
  /** 显示中央播放图标（暂停态） */
  /** 隐藏中央播放图标 */
}

/** 顶部栏组件挂载后回传的控制 API */
interface EndingApi {
  showEndWrap: () => void;
  closeEndWrap: () => void;
}

interface TopAPI {
  /** 设置视频标题文本 */
  setTitle: (title: string) => void;
  /** 设置 UP 主头像图片地址 */
  setAvatar: (avatar: string) => void;
  /** 显示顶部栏 */
  show: () => void;
  /** 隐藏顶部栏 */
  hide: () => void;
}

/** 字幕层 API */
interface SubtitleLayerAPI {
  /** 字幕容器元素 */
  subtitleWrap: HTMLElement | null;
  /** 设置字幕字体大小 */
  setFontSize: (size: number) => void;
  /** 设置字幕颜色 */
  setColor: (color: string) => void;
  /** 设置字幕背景颜色 */
  setBackgroundColor: (color: string) => void;
  /** 设置字幕位置（顶部/居中/底部） */
  setPosition: (position: "top" | "center" | "bottom") => void;
}

/** 互动层 API */
interface InteractionLayerAPI {
  /** 互动层容器元素 */
  container: HTMLElement | null;
}

/** 对话框 API */
interface DialogAPI {
  /** 对话框容器元素 */
  dialogWrap: HTMLElement | null;
  /** 显示弹幕提示详情 */
  showDmTip: (
    dmTip: {
      content: string;
      timePoint: number;
      user?: string;
      color?: string;
      mode?: string;
      fontSize?: number;
    },
    container: HTMLElement,
  ) => void;
  /** 隐藏弹幕提示详情 */
  hideDmTip: (element?: HTMLElement) => void;
}

// ============================================
// 组件事件类型
// ============================================

export type PlayerDockerEvents = {
  mounted: {
    container: HTMLElement;
    videoArea: HTMLElement;
    videoWrap: HTMLElement;
    video: HTMLVideoElement;
    /** 弹幕发送区（未装 danmaku 插件时整个发送区不渲染，为 null） */
    sendingArea: HTMLElement | null;
  };
  videoCreated: { video: HTMLVideoElement };
  /** 用户选择了新的清晰度档位，值为档位 id（'auto' 表示自动） */
  qualityChange: string;

  /** 视频区域被单击（由 VideoPlayer 转发为对外的 click 事件） */
  perchClick: MouseEvent;
  /** 视频区域被双击（由 VideoPlayer 转发为对外的 dblclick 事件） */
  perchDblclick: MouseEvent;

  // ===== 控件条交互事件（阶段 J：控件交互接线）=====
  /** 控制栏组件挂载完成，回传其操作 API */
  controlsMounted: ControlsAPI;
  /** 播放 / 暂停按钮 */
  playPause: undefined;
  /** 进度条跳转到指定时间（秒） */
  seek: number;
  /** 进度条开始拖拽 */
  seekStart: undefined;
  /** 进度条结束拖拽 */
  seekEnd: undefined;
  /** 静音切换 */
  muteToggle: undefined;
  /** 播放速率变化 */
  backrateChange: number;
  /** 全屏切换 */
  fullscreenToggle: undefined;
  /** 选集菜单选择，值为列表下标（由 VideoPlayer 接到 switchTo(index)） */
  eplistChange: number;
  /** 字幕开关变化 */
  subtitleToggle: boolean;
  /** 字幕语言切换 */
  subtitleLangChange: string;
  /** 字幕样式变化（只带变化字段） */
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
  /** 双语字幕开关变化 */
  bilingualChange: boolean;
  /** 设置菜单项变化 */
  settingChange: { key: string; value: boolean | string | number };
  /** 点击「更多设置」 */
  moreSettingClick: undefined;
  /** 外链顶部评论 */
  comment: undefined;
  /** 外链顶部分享 */
  share: undefined;
  /** 外链顶部更多 */
  more: undefined;
  /** 请求显示 tooltip */
  showTooltip: Tooltip;
  /** 请求隐藏 tooltip */
  hideTooltip: Tooltip;
  /** 播放状态变化 */
  stateChange: unknown;
  /** 画面显示模式变化（普通 / 网页全屏 / 宽屏 / 迷你） */
  displayModeChange: DisplayMode;
  loadedMetadata: { duration: number };
  timeUpdate: { currentTime: number };
  progress: { buffer: number };
  play: undefined;
  pause: undefined;
  ended: undefined;
  waiting: undefined;
  canplay: undefined;
  /** 缓冲足够、可流畅播放到结尾 */
  canPlayThrough: undefined;

  // ===== HTML5 媒体元素标准事件（完整 21 个）=====
  /** 开始加载媒体 */
  loadStart: undefined;
  /** 首帧数据加载完成 */
  loadedData: undefined;
  /** 媒体时长变化 */
  durationChange: { duration: number };
  /** 实际开始播放（缓冲结束后） */
  playing: undefined;
  /** 跳转开始 */
  seeking: { currentTime: number };
  /** 跳转完成 */
  seeked: { currentTime: number };
  /** 音量 / 静音变化 */
  volumeChange: { volume: number; muted: boolean };
  /** 播放速率变化 */
  rateChange: { rate: number };
  /** 浏览器主动暂停加载（非错误） */
  suspend: undefined;
  /** 数据停滞 */
  stalled: undefined;
  /** 加载被中止 */
  abort: undefined;
  /** 媒体被清空 */
  emptied: undefined;
  /** 加载 / 解码错误 */
  error: { error: MediaError | null | undefined };

  contextMenu: { x: number; y: number };
  playerLoaded: undefined;
  danmakuLayerMounted: DanmakuLayerAPI;
  showDmTip: { event: MouseEvent; element: HTMLElement };
  hideDmTip: { element: HTMLElement };
  subtitleLayerMounted: SubtitleLayerAPI;
  interactionLayerMounted: InteractionLayerAPI;
  /** 互动视频层容器挂载完成，回传根容器引用（互动视频插件注入点） */
  interactiveVideoLayerMounted: InteractiveVideoLayerAPI;
  /** 错误面板挂载完成，回传 show / hide API */
  errorSignMounted: ErrorSignAPI;
  /** 错误面板点击「刷新」按钮（由 VideoPlayer 落地为 reload()） */
  retry: undefined;
  dialogMounted: DialogAPI;
  pipToggle: undefined;
  prev: undefined;
  next: undefined;
  like: undefined;
  coin: undefined;
  favorite: undefined;
  tripleLike: undefined;
  follow: undefined;
  danmakuToggle: undefined;
  /** 发送弹幕，值为弹幕文本 */
  sendDanmaku: string;
};

// ============================================
// 组件属性接口
// ============================================

/**
 * 插件安装标志（UI 按需渲染的数据源）
 *
 * 由 VideoPlayer 维护的响应式信号承载：install / uninstall 时更新，
 * PlayerDocker / Controls 通过 Show 控制流读取信号条件渲染对应图层
 * 与控制入口——未安装插件的 DOM 完全不挂载（而非 CSS 隐藏）。
 * 插件名约定与各插件类的 readonly name 一致
 * （danmaku / subtitle / interaction / interactiveVideo）。
 */
export interface PlayerPluginFlags {
  /** 弹幕插件：控制弹幕层 RowDm 与底部弹幕发送栏 SendBar */
  danmaku: boolean;
  /** 字幕插件：控制字幕层 SubtitleLayer 与控制栏字幕按钮 / 字幕设置面板 */
  subtitle: boolean;
  /** 交互插件：控制交互层 InteractionLayer */
  interaction: boolean;
  /** 互动视频插件：控制互动视频层 InteractiveVideoLayer */
  interactiveVideo: boolean;
  /** 音效插件：控制设置面板第二页「音量均衡」音频设置区块 */
  audioEffect: boolean;
}

/**
 * 清晰度运行时快照
 *
 * 由 `VideoPlayer.render()` 传入的初始值；因框架无虚拟 DOM diff，
 * 后续变化统一由组件内订阅 `stateMgr` 的 `player.*` 状态驱动。
 */
export interface QualitySnapshot {
  /** 运行时可用档位列表 */
  qualities: QualityLevel[];
  /** 当前生效档位 id（'auto' 或档位 id） */
  current: string;
  /** 清晰度切换生命周期：idle | switching | switched | failed */
  switchState: "idle" | "switching" | "switched" | "failed";
  /** 清晰度能力：none | static | adaptive */
  mode: "none" | "static" | "adaptive";
}

export interface PlayerDockerProps {
  /** 所属播放器实例（用于插件视图动态刷新，不参与 DOM 渲染） */
  player?: VideoPlayer;
  /** 事件总线（供插件层订阅播放器事件） */
  events?: PlayerEventBus;
  /** 视频源地址 */
  src?: string;
  /** 播放器名称（用于容器 aria-label） */
  playerName?: string;
  /** 是否自动播放 */
  autoplay?: boolean;
  /** 初始音量（0-1） */
  volume?: number;
  /** 初始是否静音 */
  muted?: boolean;
  /** 整包配置（供读取 ui.controls / danmaku / progress.segments 等） */
  config?: PlayerConfig;
  /** 清晰度运行时快照 */
  quality?: QualitySnapshot;
  /**
   * 流媒体模式下载速度提供者（字节/秒）
   *
   * 由 VideoPlayer 注入（其持有 StreamMiddleware，可转发流媒体插件的
   * `getStats().downloadSpeed`）；返回 0 / 负数 / NaN 表示无数据，
   * 此时 PlayerDocker 会回退到原生 Resource Timing 采样。
   */
  getStreamDownloadSpeed?: () => number;

  /**
   * 原生流媒体播放器实例提供者（dash.js / hls.js / flv.js 实例）
   *
   * 由 VideoPlayer 注入（其持有 StreamMiddleware，转发当前生效插件的
   * `getNativePlayer()`）；供 VideoInfo 等统计面板读取库原生实时数据，
   * 原生播放（非流媒体模式）返回 null。
   */
  getNativeStreamPlayer?: () => unknown;

  /**
   * 预览图提供者（progress.previewProvider 配置注入）
   *
   * 进度条悬停时按「悬停时间 + 总时长」询问外部预览帧，
   * 支持同步或异步（Promise）返回；数据获取逻辑完全由外部实现。
   */
  previewProvider?: ProgressPreviewProvider;

  /**
   * 高能进度条数据提供者（progress.energyProvider 配置注入）
   *
   * 支持同步或异步（Promise）返回；数据到达后 PbpControls 绘制曲线，
   * 未提供数据时该层不渲染（保持不可见）。
   */
  energyProvider?: EnergyProgressProvider;

  /**
   * 插件安装标志读取器（按需渲染的数据源，getter 形态）
   *
   * 由 VideoPlayer 注入：`() => pluginFlags.value`——普通函数不触发
   * props 代理的 Signal 解包（reactiveProps 仅解包 Signal / _rp thunk），
   * 全透传链（Controls → RightControls → SubtitleMenu）拿到的都是
   * 函数本体；effect / 响应式表达式内调用时读取 signal.value 自动
   * 建立依赖，插件装卸即时联动显隐。未装插件的图层经 Show 控制
   * 流条件挂载，DOM 完全不进入文档流。
   * 未传（直接使用 PlayerDocker 的场景）时保持既有行为：全部渲染。
   */
  plugins?: () => PlayerPluginFlags;

  /** 音效插件 API 读取器（右键「音效调节」面板使用，未装插件返回 null） */
  getAudioEffect?: () => AudioPanelApi | null;
}

// ============================================
// 播放器主容器组件
// ============================================

/**
 * 播放器主容器组件
 */
export const PlayerDocker = defineComponent<
  PlayerDockerProps,
  PlayerDockerEvents
>((props, lifecycle) => {
  // ============================================
  // 播放场景（station：站内完整；embedded：外链 / iframe 嵌入）
  // ============================================

  /** 是否外链嵌入场景 */
  const embeddedMode = props.config?.ui?.scene === "embedded";

  /** 外链场景数据（标题 / UP / 推荐 / 跳转地址） */
  const embeddedConfig = props.config?.ui?.embedded;

  /** 片尾形态：standard（普通）/ ogv（电视剧 / 番剧） */
  const endingStyle = props.config?.ui?.endingStyle ?? "standard";


  /** 打开外链场景的跳转地址（无地址时静默忽略） */
  const openEmbeddedUrl = (url?: string): void => {
    if (!url || !isBrowser()) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // ============================================
  // DOM 元素引用
  // ============================================

  /** 视频元素 */
  const videoRef = useTemplateRef<HTMLVideoElement>(lifecycle, "videoRef");

  /** 播放器外层容器 */
  const playerDockerRef = useTemplateRef<HTMLDivElement>(
    lifecycle,
    "playerDockerRef",
  );

  /** 播放器容器 */
  const playerContainerRef = useTemplateRef<HTMLDivElement>(
    lifecycle,
    "playerContainerRef",
  );

  /** 视频区域 */
  const playerVideoAreaRef = useTemplateRef<HTMLDivElement>(
    lifecycle,
    "playerVideoAreaRef",
  );

  /** 插件根容器 */
  const topRootRef = useTemplateRef<HTMLDivElement>(lifecycle, "topRootRef");
  const endingRootRef = useTemplateRef<HTMLDivElement>(
    lifecycle,
    "endingRootRef",
  );
  let topMountCleanup: (() => void) | null = null;
  let endingMountCleanup: (() => void) | null = null;

  /** 视频占位容器 */
  const playerVideoPerchRef = useTemplateRef<HTMLDivElement>(
    lifecycle,
    "playerVideoPerchRef",
  );

  /** 视频包装容器 */
  const playerVideoWrapRef = useTemplateRef<HTMLDivElement>(
    lifecycle,
    "playerVideoWrapRef",
  );

  /** 发送区域 */
  const playerSendingAreaRef = useTemplateRef<HTMLDivElement>(
    lifecycle,
    "playerSendingAreaRef",
  );

  // ============================================
  // 状态管理器（通过 Context 获取，无需 props 传递）
  // ============================================

  const stateMgr = useContext<TypedStateManager<PlayerStateMap> | null>(
    StateContext,
  );

  // ============================================
  // 配置中心（可订阅，设置即生效）
  // ============================================

  /** 可订阅配置中心（由 VideoPlayer 通过 __providers 注入；未注入时为 null） */
  const configStore = useContext<ConfigStore | null>(ConfigStoreContext);
  /** 插件 / 插槽上下文 */
  const slotPlayer = props.player ?? useContext(PlayerContext);
  const providerPlayer = (
    props as unknown as {
      __providers?: Array<{ contextId: PropertyKey; value: unknown }>;
    }
  ).__providers?.find((provider) => provider.contextId === PlayerContext.id)
    ?.value as VideoPlayer | undefined;
  const resolvedPlayer = slotPlayer ?? providerPlayer;
  const slotContext: SlotContext | null =
    resolvedPlayer && stateMgr
      ? { player: resolvedPlayer, state: stateMgr }
      : null;

  type MountFn = (container: HTMLElement) => void | (() => void);

  /** 把插槽内容转成挂载函数；不创建包装 DOM */
  const createSlotMount = (content: SlotContent | undefined): MountFn | null => {
    const resolved = resolveSlotContent(content, slotContext);
    if (!resolved) return null;
    if (isSlotMount(resolved)) {
      return (container) => resolved.mount(container, slotContext);
    }
    if (typeof Node !== "undefined" && resolved instanceof Node) {
      return (container) => {
        container.appendChild(resolved);
        return () => {
          if (resolved.parentNode === container) container.removeChild(resolved);
        };
      };
    }
    return null;
  };

  /** 插槽优先于插件；每次刷新时重新解析，支持插件动态装载 / 卸载 */
  const getTopMount = (): SlotMount["mount"] | null => {
    const pluginMount = resolvedPlayer?.getTopPluginMount() ?? null;
    return (
      createSlotMount(readUi()?.top) ??
      (pluginMount
        ? (container: HTMLElement, ctx?: SlotContext | null) =>
            pluginMount(container, ctx ?? slotContext)
        : null)
    );
  };

  const getEndingMount = (): SlotMount["mount"] | null => {
    const pluginMount = resolvedPlayer?.getEndingPluginMount() ?? null;
    return (
      createSlotMount(readUi()?.ending) ??
      (pluginMount
        ? (container: HTMLElement, ctx?: SlotContext | null) =>
            pluginMount(container, ctx ?? slotContext)
        : null)
    );
  };

  const mountTopView = (): void => {
    topMountCleanup?.();
    topMountCleanup = null;
    const root = topRootRef.value;
    if (!root) return;
    root.replaceChildren();
    const mount = getTopMount();
    if (mount) {
      topMountCleanup =
        mount(root, {
          ...(slotContext ?? {}),
          props: buildTopProps(),
        } as SlotContext) ?? null;
    }
  };

  const syncEndingRootClass = (): void => {
    const root = endingRootRef.value;
    if (!root) return;
    const style = readUi()?.endingStyle ?? endingStyle;
    root.className =
      style === "ogv"
        ? "nova-player-ending-wrap nova-ogv-ending-wrap"
        : style === "interactive"
          ? "nova-player-ending-wrap nova-interactive-ending-wrap"
          : embeddedMode
            ? "nova-player-ending-wrap nova-player-embedded-ending-wrap"
            : "nova-player-ending-wrap";
  };

  const mountEndingView = (): void => {
    endingMountCleanup?.();
    endingMountCleanup = null;
    const root = endingRootRef.value;
    if (!root) return;
    syncEndingRootClass();
    root.replaceChildren();
    const mount = getEndingMount();
    if (mount) {
      endingMountCleanup =
        mount(root, {
          ...(slotContext ?? {}),
          props: buildEndingProps(),
        } as SlotContext) ?? null;
    }
  };


  // ============================================
  // 状态读取辅助（单一来源：stateMgr；为 null 时安全降级到 props）
  // ============================================

  /** 读取当前音量（state 优先，降级到 props） */
  const readVolume = (): number =>
    stateMgr?.get(PlayerStateKeyEnum.VOLUME) ?? props.volume ?? 0.3;

  /** 读取当前是否静音（state 优先，降级到 props） */
  const readMuted = (): boolean =>
    stateMgr?.get(PlayerStateKeyEnum.MUTED) ?? props.muted ?? false;

  /** 读取当前播放倍速 */
  const readBackrate = (): number =>
    stateMgr?.get(PlayerStateKeyEnum.PLAYBACK_RATE) ?? 1;

  /** 读取视频总时长（秒） */
  const readDuration = (): number =>
    stateMgr?.get(PlayerStateKeyEnum.DURATION) ?? 0;

  /** 读取当前播放时间（秒） */
  const readCurrentTime = (): number =>
    stateMgr?.get(PlayerStateKeyEnum.CURRENT_TIME) ?? 0;

  /** 是否正在播放（依据单一状态源 `player.state`） */
  const readIsPlaying = (): boolean =>
    stateMgr?.get(PlayerStateKeyEnum.STATE) === PlayerState.PLAYING;

  /**
   * 应用画面显示模式：写状态 + 同步容器 `data-screen` + 向上广播 `displayModeChange`。
   *
   * 说明：全屏（full）不属于 `DisplayMode`（无 'full'），由 `player.isFullscreen` 承载；
   * 宽屏（wide）布局完全由播放器外部容器决定，不在此处处理——宽屏只更新
   * `IS_WIDE_SCREEN` 并广播 `wideScreenChange`（见 toggleWide），播放器不写
   * `data-screen`、不改内部布局。故此处只处理 normal / web / mini 三种。
   *
   * @param mode - 目标显示模式
   */
  const applyDisplayMode = (mode: DisplayMode): void => {
    stateMgr?.set(PlayerStateKeyEnum.DISPLAY_MODE, mode);
    stateMgr?.set(PlayerStateKeyEnum.IS_MIN_PLAYER, mode === "mini");
    stateMgr?.set(PlayerStateKeyEnum.IS_WEB_FULLSCREEN, mode === "web");
    playerContainerRef.value?.setAttribute("data-screen", mode);
    moveSendBar(mode);
    // 同步提示工具的屏幕模式（既有实现的 tooltips.screen 赋值；
    // 全屏 'full' 由 onFullscreenChange 单独维护）
    tooltipsApi.setScreen?.(mode === "web" ? "web" : "normal");
    lifecycle.emit?.("displayModeChange", mode);
  };

  /**
   * 按显示模式移动弹幕发送栏（与既有实现的 sendBar.moveDom 一致）：
   * - wide / web / full：移动到 `.nova-player-control-bottom-center`（底部控制栏中央）
   * - normal / mini：移回 `.nova-player-sending-area`
   * 仅搬移已有的 `.nova-player-sending-bar` 节点，不改变任何类名与内部结构
   * @param mode - 目标显示模式（full 为浏览器全屏，不属于 DisplayMode，仅内部使用）
   */
  let sendingBarHome: HTMLElement | null = null;
  let sendingBarNext: Node | null = null;

  const moveSendBar = (mode: DisplayMode | "full"): void => {
    const bar = playerContainerRef.value?.querySelector<HTMLElement>(
      ".nova-player-sending-bar",
    );
    if (!bar) return;
    const center = playerContainerRef.value?.querySelector<HTMLElement>(
      ".nova-player-control-bottom-center",
    );
    if (mode === "wide" || mode === "web" || mode === "full") {
      if (mode === "full" && center && center.children.length > 0) return;
      if (!sendingBarHome && bar.parentElement) {
        sendingBarHome = bar.parentElement;
        sendingBarNext = bar.nextSibling;
      }
      if (center && bar.parentElement !== center) {
        bar.remove();
        center.appendChild(bar);
      }
    } else {
      const home = sendingBarHome ?? playerSendingAreaRef.value;
      if (home && bar.parentElement !== home) {
        bar.remove();
        const anchor =
          sendingBarNext && sendingBarNext.parentNode === home
            ? sendingBarNext
            : null;
        home.insertBefore(bar, anchor);
      }
    }
  };

  // ============================================
  // 初始化方法
  // ============================================

  /**
   * 判断视频源是否可直接播放（不需要流媒体插件）
   * .m3u8/.mpd/.flv/.json 等需要通过 HLS/DASH/FLV 插件加载
   */
  const isDirectPlayableSrc = (src: string): boolean => {
    const streamingExts = [".m3u8", ".mpd", ".flv", ".json"];
    const lower = src.split("?")[0].toLowerCase();
    return !streamingExts.some((ext) => lower.endsWith(ext));
  };

  /**
   * 初始化视频元素，创建 video 标签并绑定事件
   */
  const initVideo = (): void => {
    const video = videoRef.value;
    if (!video) return;

    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.playsInline = true;
    video.setAttribute("playsinline", "");

    // 仅对可直接播放的源设置 video.src
    // 流媒体源（.m3u8/.mpd/.flv/.json manifest）由插件负责加载
    if (props.src && isDirectPlayableSrc(props.src)) {
      video.src = props.src;
    }

    video.volume = readVolume();
    video.muted = readMuted();

    if (props.autoplay) {
      video.autoplay = true;
    }

    // 注意：HTML5 媒体元素标准事件（loadstart/loadedmetadata/play/pause/
    // timeupdate/waiting 等全部 21 个）不再在此层绑定 —— 由 VideoPlayer 核心
    // 的 bindVideoEvents 独占绑定（同步 stateMgr + 广播事件总线），本组件经
    // 「stateMgr 键订阅 + 事件总线订阅」双通道消费（见 setupVideoEventSubscriptions），
    // 消除此前每个事件双侧各绑一次的重复绑定与双重状态写入

    lifecycle.emit?.("videoCreated", { video });
  };

  // ============================================
  // video 事件消费（订阅制）
  // VideoPlayer 核心（bindVideoEvents）独占 video 原生事件绑定：同步
  // stateMgr 运行时状态并广播事件总线。本组件不再重复绑定任何媒体事件，
  // 经「stateMgr 键订阅 + 事件总线订阅」双通道完成全部 UI 更新：
  // - 键订阅（STATE / DURATION / CURRENT_TIME / BUFFERED / VOLUME / MUTED）
  //   注册于下方「运行时状态订阅」区（值驱动的 UI 更新）
  // - 总线订阅（WAITING / CAN_PLAY / SEEKING / SEEKED，含延迟判定等
  //   时序敏感逻辑）注册于 setupVideoEventSubscriptions
  // ============================================

  /** 缓冲指示的延迟句柄：短暂换档（画面未停）不显示，真正卡住才显示 */
  let buffDelayTimer: ReturnType<typeof setTimeout> | null = null;

  /** 取消尚未到期的缓冲指示 */
  const cancelBuffIndicator = (): void => {
    if (buffDelayTimer !== null) {
      clearTimeout(buffDelayTimer);
      buffDelayTimer = null;
    }
  };

  /** 播放头是否还能继续播（有后续数据）：判断"是否真的在缓冲"的准确依据 */
  const canContinuePlayback = (): boolean => {
    const video = videoRef.value;
    if (!video || video.paused) return true;
    if (video.readyState >= 3) return true;
    const ranges = video.buffered;
    for (let i = 0; i < ranges.length; i += 1) {
      if (
        video.currentTime >= ranges.start(i) - 0.05 &&
        video.currentTime < ranges.end(i) - 0.05
      ) {
        return true;
      }
    }
    return false;
  };

  /** 是否处于清晰度切换中（切档会引发 seek/waiting，但画面未停，不该算加载中） */
  const isQualitySwitching = (): boolean =>
    stateMgr?.get(PlayerStateKeyEnum.QUALITY_SWITCH_STATE) === "switching";

  /**
   * 订阅事件总线上由本组件消费的时序类媒体事件：
   * - WAITING：真正卡住（300ms 内未恢复）才亮缓冲指示，短暂换档被过滤
   * - CAN_PLAY：缓冲恢复撤下缓冲指示
   * - SEEKING / SEEKED：跳转起止的缓冲态亮灭（清晰度切换除外）
   * 订阅返回的解绑函数统一交给 cleanupFns（teardown 释放）
   */
  const setupVideoEventSubscriptions = (): void => {
    if (!props.events) return;

    cleanupFns.push(
      props.events.on(PlayerEventEnum.WAITING, () => {
        if (canContinuePlayback()) return;
        if (buffDelayTimer !== null) return;
        buffDelayTimer = setTimeout(() => {
          buffDelayTimer = null;
          playerContainerRef.value?.classList.add("state-buff");
          stateMgr?.set(PlayerStateKeyEnum.IS_LOADING, true);
        }, 300);
      }),
    );

    cleanupFns.push(
      props.events.on(PlayerEventEnum.CAN_PLAY, () => {
        cancelBuffIndicator();
        playerContainerRef.value?.classList.remove("state-buff");
        stateMgr?.set(PlayerStateKeyEnum.IS_LOADING, false);
      }),
    );

    cleanupFns.push(
      props.events.on(PlayerEventEnum.SEEKING, () => {
        playerContainerRef.value?.classList.add("state-buff");
        if (!isQualitySwitching()) {
          stateApi.showBuffering?.();
        }
      }),
    );

    cleanupFns.push(
      props.events.on(PlayerEventEnum.SEEKED, () => {
        playerContainerRef.value?.classList.remove("state-buff");
        stateApi.hideBuffering?.();
      }),
    );
  };

  /**
   * 订阅事件总线上的错误相关事件，驱动错误面板（ErrorSign）显隐：
   * - ERROR：显示错误面板并填充错误信息（错误码 / 出错主机名 /
   *   网络类错误时附带本地网络权限提示）
   * - ERROR_RECOVERY：备用源切换成功，隐藏错误面板
   * - LOADED_METADATA：重新加载成功（刷新按钮 → reload），隐藏错误面板
   * 订阅返回的解绑函数统一交给 cleanupFns（teardown 释放）
   */
  const setupErrorEventSubscriptions = (): void => {
    if (!props.events) return;

    cleanupFns.push(
      props.events.on(
        PlayerEventEnum.ERROR,
        (payload: { error: unknown; code?: number | string; message?: string }) => {
          /** 撤下缓冲指示（转圈/蒙层/延迟句柄），错误面板与转圈不并存 */
          cancelBuffIndicator();
          playerContainerRef.value?.classList.remove("state-buff");
          stateMgr?.set(PlayerStateKeyEnum.IS_LOADING, false);

          /** 从当前视频源 URL 提取出错主机名（解析失败返回 undefined） */
          const host = (() => {
            try {
              const url =
                videoRef.value?.currentSrc || videoRef.value?.src || "";
              return url ? new URL(url).host : undefined;
            } catch {
              return undefined;
            }
          })();

          errorSignApi.show?.({
            message: payload.message,
            code: payload.code,
            host,
            // 网络错误（MediaError.code === 2 / 流媒体网络类致命错误）时
            // 附带本地网络权限提示
            showLocalNetworkTip: payload.code === 2,
          });
        },
      ),
    );

    cleanupFns.push(
      props.events.on(PlayerEventEnum.ERROR_RECOVERY, () => {
        errorSignApi.hide?.();
      }),
    );

    cleanupFns.push(
      props.events.on(PlayerEventEnum.LOADED_METADATA, () => {
        errorSignApi.hide?.();
      }),
    );
  };

  // ============================================
  // 控制栏 API（延迟初始化后赋值）
  // ============================================

  /** 控制栏组件 API，由 Controls 组件挂载后填充 */
  const controlsApi: {
    /** 更新音量显示 */
    updateVolumeDisplay?: (vol: number) => void;
    /** 显示控制栏 */
    showControl?: () => void;
    /** 隐藏控制栏 */
    hideControl?: () => void;
    /** 更新静音状态 */
    updateMute?: (isMuted: boolean) => void;
    /** 更新缓冲进度 */
    updateBuffer?: (buffer: number) => void;
    /** 更新当前播放时间 */
    updateCurrent?: (current: number) => void;
    /** 初始化时长显示 */
    initDuration?: () => void;
    /** 更新总时长（顶部进度条与底部影子进度条共用） */
    setDuration?: (duration: number) => void;
    /** 重建底部影子进度条分段 */
    setProgressSegments?: (segments?: ProgressSegment[]) => void;
  } = {};

  /** 顶部进度条 API，由 ProgressBar（经 TopControls / Controls）挂载后填充 */
  const progressBarApi: {
    /** 更新已播放进度 */
    updateProgress?: (time: number) => void;
    /** 更新缓冲进度 */
    updateBuffer?: (buffer: number) => void;
    /** 更新视频总时长 */
    setDuration?: (duration: number) => void;
    /** 重建进度条分段（progress.segments 变化时调用） */
    rebuildSegments?: (segments?: ProgressSegment[]) => void;
  } = {};

  /**
   * 插件安装标志读取助手（Show 控制流 when 回调内使用）
   *
   * 调用 getter 读取当前标志：when 回调运行在 flow effect 内，
   * getter 内的 signal.value 读取自动建立依赖，插件装卸即时联动。
   * 语义：VideoPlayer 总是注入 plugins getter（未装插件 = false =
   * 不挂载对应图层）；直接使用 PlayerDocker 未传时保持既有行为
   * （全部渲染），`?? true` 兜底兼容这类调用方
   */
  const hasPlugin = (key: keyof PlayerPluginFlags): boolean =>
    props.plugins?.()[key] ?? true;

  /** 弹幕组件 API，由 RowDm 组件挂载后填充 */
  const rowDmApi: {
    /** 切换弹幕播放/暂停状态（根容器 danmaku-x-paused 类） */
    playPause?: (state: "playing" | "paused") => void;
    /** 显示弹幕提示信息 */
    showDmTip?: (event: MouseEvent, element: HTMLElement) => void;
    /** 隐藏弹幕提示信息 */
    hideDmTip?: (element: HTMLElement) => void;
  } = {};

  /** 字幕组件 API，由 SubtitleLayer 组件挂载后填充 */
  const subtitleApi: {
    /** 字幕容器元素 */
    subtitleWrap?: HTMLElement | null;
    /** 设置字幕字体大小 */
    setFontSize?: (size: number) => void;
    /** 设置字幕颜色 */
    setColor?: (color: string) => void;
    /** 设置字幕背景颜色 */
    setBackgroundColor?: (color: string) => void;
    /** 设置字幕位置 */
    setPosition?: (position: "top" | "center" | "bottom") => void;
  } = {};

  /** 互动层组件 API，由 InteractionLayer 组件挂载后填充 */
  const interactionApi: {
    /** 互动层容器元素 */
    container?: HTMLElement | null;
  } = {};

  /** 互动视频层容器 API，由 InteractiveVideoLayer 组件挂载后填充 */
  const interactiveVideoApi: {
    /** 互动视频根容器元素（互动视频插件的注入点） */
    wrap?: HTMLElement | null;
  } = {};

  /** 错误面板组件 API，由 ErrorSign 组件挂载后填充 */
  const errorSignApi: {
    /** 显示错误面板并填充错误信息 */
    show?: (info?: ErrorSignInfo) => void;
    /** 隐藏错误面板 */
    hide?: () => void;
  } = {};

  /** 快捷键面板 API，由 HotkeyPanel 组件挂载后填充 */
  const hotkeyPanelApi: Partial<HotkeyPanelApi> = {};

  /** 右键菜单组件 API，由 Context 组件挂载后填充 */
  const contextApi: {
    /** 在指定坐标显示右键菜单 */
    showMenu?: (x: number, y: number) => void;
    /** 隐藏右键菜单 */
    hideMenu?: () => void;
  } = {};

  /** 对话框组件 API，由 Dialog 组件挂载后填充 */
  const dialogApi: {
    /** 对话框容器元素 */
    dialogWrap?: HTMLElement | null;
    /** 显示弹幕提示详情 */
    showDmTip?: (
      dmTip: {
        content: string;
        timePoint: number;
        user?: string;
        color?: string;
        mode?: string;
        fontSize?: number;
      },
      container: HTMLElement,
    ) => void;
    /** 隐藏弹幕提示详情 */
    hideDmTip?: (element?: HTMLElement) => void;
  } = {};

  /** Toast 组件 API，由 Toast 组件挂载后填充 */
  const toastApi: Partial<ToastAPI> = {};

  /** 弹幕发送栏 API，由 SendBar 组件挂载后填充 */
  const sendBarApi: Partial<SendBarAPI> = {};

  /**
   * 弹幕输入框是否处于聚焦状态
   * 用于 videoArea mouseleave 时的豁免：网页全屏 / 全屏下正在输入弹幕时
   * 不隐藏控制栏（与既有实现的 isSendFocus 豁免一致）
   */
  let isSendFocus = false;

  /** Loading 组件 API，由 Loading 组件挂载后填充 */
  const loadingApi: Partial<LoadingAPI> = {};

  /** State 组件 API，由 State 组件挂载后填充（缓冲图标 / 播放图标 / 缓冲速度文本） */
  const stateApi: Partial<StateAPI> = {};

  /** 顶部栏组件 API，由 Top 组件挂载后填充（§3.2 ui.title → Top 组件文本） */
  const topApi: Partial<TopAPI> = {};

  /** 音量提示组件 API，由 VolumeHint 组件挂载后填充（对应既有实现的 volumehint） */
  const volumeHintApi: {
    /** 显示音量提示 */
    show?: (volume: number) => void;
    /** 隐藏音量提示 */
    hide?: () => void;
  } = {};

  /**
   * 提示工具组件 API，由 Tooltips 组件挂载后填充
   * （对应既有实现的 new Tooltips(this.playerContainer!)，
   * openTip / closeTip / updateTip / setScreen 与既有实现 Tooltips 类一一对应）
   */
  const tooltipsApi: {
    /** 打开提示（依据按钮元素实时计算位置） */
    openTip?: (btnElement: HTMLElement | null, name: string) => void;
    /** 关闭提示 */
    closeTip?: (name: string) => void;
    /** 更新提示文本 */
    updateTip?: (name: string, text: string) => void;
    /** 以 i18n key 更新提示文本（语言切换自动跟随，动态状态提示首选） */
    updateTipKey?: (name: string, key: string) => void;
    /** 同步屏幕模式（normal / full / web，影响提示的上下偏移） */
    setScreen?: (screen: "normal" | "full" | "web") => void;
    /** 隐藏全部提示 */
    hideAll?: () => void;
  } = {};

  /**
   * 显示控制栏按钮的 hover 提示（与既有实现的
   * showTooltip → tooltips.openTip 一致），同时继续向上层转发事件
   * @param tip - 提示信息（按钮元素 + dataName）
   */
  const handleShowTooltip = (tip: Tooltip): void => {
    tooltipsApi.openTip?.(tip.element, tip.dataName);
    lifecycle.emit?.("showTooltip", tip);
  };

  /**
   * 隐藏控制栏按钮的 hover 提示（与既有实现的
   * hideTooltip → tooltips.closeTip 一致），同时继续向上层转发事件
   * @param tip - 提示信息（仅需 dataName）
   */
  const handleHideTooltip = (tip: Tooltip): void => {
    tooltipsApi.closeTip?.(tip.dataName);
    lifecycle.emit?.("hideTooltip", tip);
  };

  /** 色彩调整面板 API，由 ColorPanel 组件挂载后填充（对应既有实现的 colorpanel） */
  const colorPanelApi: Partial<ColorPanelApi> = {};

  /** 音效调节面板 API，由 AudioPanel 组件挂载后填充 */
  const audioPanelApi: Partial<AudioPanelHandle> = {};

  /** 视频统计信息面板 API，由 VideoInfo 组件挂载后填充（对应既有实现的 info） */
  const videoInfoApi: Partial<VideoInfoApi> = {};

  /** 片尾面板 API，由 Ending 组件挂载后填充（对应既有实现的 ending） */
  const endingApi: Partial<EndingApi> = {};

  /** 迷你播放器面板 API，由 Mini 组件挂载后填充（对应既有实现的 mini） */
  const miniApi: Partial<MiniApi> = {};

  // ============================================
  // 面板懒挂载（既有实现的懒创建模式）
  // ============================================
  // 既有实现 controls/index.ts 打开面板时：
  //   if (!this.querySelector('.nova-player-video-area .nova-player-color-panel'))
  //     new Colorpanel(this.playerVideoArea!);
  // 面板第一次用到才创建，之后复用已有实例。
  // 这里用框架的动态挂载 API（@/core 的 mount / destroy，core/mount.ts 导出）
  // 实现同样的按需创建：ensurePanel(name) 首次调用时把面板挂进
  // .nova-player-video-area，之后复用已创建的实例。

  /** 懒挂载面板的 VNode 缓存（首次使用创建，之后复用；销毁时统一 destroy） */
  const lazyPanelVNodes: {
    color?: VNode;
    audio?: VNode;
    info?: VNode;
    keyboard?: VNode;
  } = {};

  /** 音量提示层懒挂载节点（首次滚轮/快捷键调节音量时创建，之后复用） */
  let volumeHintVNode: VNode | null = null;

  /**
   * 按需挂载面板（已挂载则直接复用）
   * @param name - 面板名：color 色彩调整 / info 视频统计信息 / keyboard 快捷键说明
   */
  const ensurePanel = (
    name: "color" | "audio" | "info" | "keyboard",
  ): void => {
    const videoArea = playerVideoAreaRef.value;
    if (!videoArea) return;

    if (name === "color" && !lazyPanelVNodes.color) {
      lazyPanelVNodes.color = h(ColorPanel, {
        onClose: () => {
          colorPanelApi.close?.();
        },
        onSaturateChange: (value: number) => {
          filterSaturate = value;
          applyVideoFilter();
        },
        onBrightnessChange: (value: number) => {
          filterBrightness = value;
          applyVideoFilter();
        },
        onContrastChange: (value: number) => {
          filterContrast = value;
          applyVideoFilter();
        },
        onReset: () => {
          filterSaturate = 100;
          filterBrightness = 100;
          filterContrast = 100;
          applyVideoFilter();
        },
        onColorPanelMounted: (api: ColorPanelApi) => {
          Object.assign(colorPanelApi, api);
        },
      });
      mount(lazyPanelVNodes.color, videoArea);
    }

    if (name === "audio" && !lazyPanelVNodes.audio) {
      lazyPanelVNodes.audio = h(AudioPanel, {
        api: props.getAudioEffect?.() ?? null,
        onClose: () => {
          audioPanelApi.close?.();
        },
        onAudioPanelMounted: (handle: AudioPanelHandle) => {
          Object.assign(audioPanelApi, handle);
        },
      });
      mount(lazyPanelVNodes.audio, videoArea);
    }

    if (name === "info" && !lazyPanelVNodes.info) {
      lazyPanelVNodes.info = h(VideoInfo, {
        src: props.src,
        // 原生流媒体实例提供者：码率曲线优先读 hls.js/dash.js 的静态码率
        getNativePlayer: props.getNativeStreamPlayer,
        onClose: () => {
          videoInfoApi.close?.();
        },
        onVideoInfoMounted: (api: VideoInfoApi) => {
          Object.assign(videoInfoApi, api);
        },
        // 动态挂载发生在渲染栈之外（右键菜单回调），组件拿不到 __parent 链
        // 上的 Provider，这里显式注入 StateContext（与 VideoPlayer.render()
        // 向 PlayerDocker 注入的方式一致）
        __providers: stateMgr
          ? [{ contextId: StateContext.id, value: stateMgr }]
          : undefined,
      });
      mount(lazyPanelVNodes.info, videoArea);
    }

    if (name === "keyboard" && !lazyPanelVNodes.keyboard) {
      lazyPanelVNodes.keyboard = h(HotkeyPanel, {
        onHotkeyPanelMounted: (api: HotkeyPanelApi) => {
          hotkeyPanelApi.open = api.open;
          hotkeyPanelApi.close = api.close;
        },
      });
      mount(lazyPanelVNodes.keyboard, videoArea);
    }
  };

  // ============================================
  // 视频色彩滤镜（右键「视频色彩调整」面板 → .nova-player-video 的 style.filter）
  // ============================================

  /** 当前饱和度（0-200，100 为默认） */
  let filterSaturate = 100;

  /** 当前亮度（0-200，100 为默认） */
  let filterBrightness = 100;

  /** 当前对比度（0-200，100 为默认） */
  let filterContrast = 100;

  /**
   * 将当前色彩参数写入 .nova-player-video 元素的 CSS filter
   * 默认值（100）的项不参与拼接，全部默认时清空 filter
   */
  const applyVideoFilter = (): void => {
    const video = videoRef.value;
    if (!video) return;
    /** 滤镜函数片段 */
    const parts: string[] = [];
    if (filterSaturate !== 100) parts.push(`saturate(${filterSaturate}%)`);
    if (filterBrightness !== 100)
      parts.push(`brightness(${filterBrightness}%)`);
    if (filterContrast !== 100) parts.push(`contrast(${filterContrast}%)`);
    video.style.filter = parts.join(" ");
  };

  // ============================================
  // 清晰度切换的局部运行变量
  // ============================================

  /** 最近一次清晰度切换请求的目标展示名（用于切换中 / 成功文案） */
  let requestedQualityLabel = "";

  /** 最近一次清晰度切换请求的目标档位 id */
  let requestedQualityTo = "";

  // ============================================
  // 清晰度切换 UI 反馈（B 站风格短文案）
  // ============================================

  /**
   * 依据清晰度切换生命周期状态驱动 Loading / Toast
   * - switching：显示 Loading「正在切换至 1080P」
   * - switched：隐藏 Loading + Toast「已切换至 1080P」
   * - failed：隐藏 Loading + Toast「清晰度切换失败」
   * @param phase - 切换生命周期状态
   */
  const driveQualitySwitchUI = (
    phase: "idle" | "switching" | "switched" | "failed",
  ): void => {
    if (phase === "switching") {
      loadingApi.show?.();
      loadingApi.setText?.(
        requestedQualityLabel
          ? `正在切换至 ${requestedQualityLabel}`
          : "正在切换清晰度",
      );
      return;
    }
    if (phase === "switched") {
      loadingApi.hide?.();
      toastApi.showAutoToast?.(
        `已切换至 ${requestedQualityLabel || requestedQualityTo || "目标清晰度"}`,
      );
      requestedQualityLabel = "";
      requestedQualityTo = "";
      return;
    }
    if (phase === "failed") {
      loadingApi.hide?.();
      toastApi.showAutoToast?.("清晰度切换失败");
      requestedQualityLabel = "";
      requestedQualityTo = "";
    }
  };

  /**
   * 订阅清晰度切换事件总线，记录目标档位的展示名 / id（供文案使用）
   * 事件晚于对应 state 变更到达，故这里只补充细节，不重复驱动 show/hide。
   */
  const setupQualityEvents = (): void => {
    const bus = props.events;
    if (!bus) return;

    const offRequested = bus.on(
      PlayerEventEnum.QUALITY_CHANGE_REQUESTED,
      (payload) => {
        requestedQualityTo = payload.to;
        requestedQualityLabel = payload.label ?? payload.to;
        // 用精确档位名刷新「切换中」提示（state 变更先于本事件到达）
        loadingApi.setText?.(
          requestedQualityLabel
            ? `正在切换至 ${requestedQualityLabel}`
            : "正在切换清晰度",
        );
      },
    );
    const offRendered = bus.on(
      PlayerEventEnum.QUALITY_CHANGE_RENDERED,
      (payload) => {
        requestedQualityTo = payload.to;
        if (payload.quality?.label)
          requestedQualityLabel = payload.quality.label;
      },
    );
    const offFailed = bus.on(
      PlayerEventEnum.QUALITY_CHANGE_FAILED,
      (payload) => {
        requestedQualityTo = payload.to;
      },
    );
    // 持久化进度恢复提示：VideoPlayer 在 loadedmetadata 后恢复上次观看位置时
    // 广播 restoreProgress，这里显示自动消失的 Toast（文案与既有实现一致）
    const offRestore = bus.on(PlayerEventEnum.RESTORE_PROGRESS, () => {
      toastApi.showAutoToast?.("已为你恢复到上次观看位置");
    });
    cleanupFns.push(offRequested, offRendered, offFailed, offRestore);
  };

  // ============================================
  // 缓冲速度采样（State 组件「正在缓冲... <速度>」文本的数据源）
  // ============================================
  // 两条路径：流媒体插件统计（字节/秒）优先，原生渐进式播放回退
  // PerformanceObserver + Resource Timing 滑动窗口；都取不到时不显示速度文本。

  /** 缓冲速度采样间隔（毫秒） */
  const BUFFER_SPEED_INTERVAL = 500;

  /** 缓冲速度采样器（懒创建，销毁时释放观察器） */
  let bufferSpeedSampler: BufferSpeedSampler | null = null;

  /** 缓冲速度采样定时器（仅缓冲期间运行） */
  let bufferSpeedTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 懒创建缓冲速度采样器
   * @returns 采样器实例
   */
  const getBufferSpeedSampler = (): BufferSpeedSampler => {
    if (!bufferSpeedSampler) {
      bufferSpeedSampler = createBufferSpeedSampler({
        // 流媒体模式：VideoPlayer → StreamMiddleware → 插件 getStats().downloadSpeed（字节/秒）
        getStreamSpeed: () => props.getStreamDownloadSpeed?.() ?? 0,
        // 原生模式：按当前媒体资源地址过滤 Resource Timing 条目
        getMediaUrl: () =>
          videoRef.value?.currentSrc || videoRef.value?.src || props.src,
      });
    }
    return bufferSpeedSampler;
  };

  /** 采样一次缓冲速度并写入 State（无有效数据时传 0，速度文本会被隐藏） */
  const sampleBufferSpeed = (): void => {
    stateApi.updateBufferSpeed?.(getBufferSpeedSampler().sample());
  };

  /**
   * 启停缓冲期间的缓冲速度采样
   * @param enabled - true 开始采样（缓冲中）；false 停止采样并清空速度文本
   */
  const setBufferSpeedSampling = (enabled: boolean): void => {
    // SSR 阶段不创建定时器
    if (!isBrowser()) return;
    if (enabled) {
      if (bufferSpeedTimer !== null) return;
      // 立即采样一次，避免首个间隔内速度文本为空
      sampleBufferSpeed();
      bufferSpeedTimer = setInterval(sampleBufferSpeed, BUFFER_SPEED_INTERVAL);
      return;
    }
    if (bufferSpeedTimer !== null) {
      clearInterval(bufferSpeedTimer);
      bufferSpeedTimer = null;
    }
    // 停止采样时清空速度文本，下次缓冲重新采样
    stateApi.updateBufferSpeed?.(0);
  };

  // ============================================
  // 运行时状态订阅（单一来源 stateMgr → 命令式更新 DOM）
  // ============================================

  if (stateMgr) {
    // 缓冲开始 / 结束（player.isLoading）→ State 的缓冲图标与文本 + 缓冲速度采样
    // （waiting / loadstart 置 true，canplay / playing / abort 置 false）
    useState(
      stateMgr,
      PlayerStateKeyEnum.IS_LOADING,
      (loading) => {
        if (loading) {
          stateApi.showBuffering?.();
          setBufferSpeedSampling(true);
        } else {
          stateApi.hideBuffering?.();
          setBufferSpeedSampling(false);
        }
      },
      lifecycle,
    );

    // 清晰度切换：switching / switched / failed 三段反馈
    useState(
      stateMgr,
      PlayerStateKeyEnum.QUALITY_SWITCH_STATE,
      (phase) => {
        driveQualitySwitchUI(phase);
      },
      lifecycle,
    );

    // ===== video 事件驱动的 UI 更新（核心层写键、本层订阅消费） =====

    // 播放状态（play / playing / pause / ended 汇聚到 STATE 键）→
    // 容器状态类 / 弹幕播放暂停 / 片尾推荐面板（合并原四个播放态 handler）
    useState(
      stateMgr,
      PlayerStateKeyEnum.STATE,
      (state) => {
        // 片尾打开期间隐藏控制栏 / 进入按钮 / 推荐条（避免与片尾面板叠层）
        if (state === PlayerState.ENDED) {
          playerContainerRef.value?.classList.add("state-ended");
        } else {
          playerContainerRef.value?.classList.remove("state-ended");
        }
        if (state === PlayerState.PLAYING) {
          // playing 语义：缓冲恢复后的实际播放，同时撤下暂停与缓冲样式
          cancelBuffIndicator();
          playerContainerRef.value?.classList.remove(
            "state-buff",
            "state-paused",
          );
          rowDmApi.playPause?.("playing");
          // 重新播放时隐藏片尾推荐面板（与既有实现行为一致）
          endingApi.closeEndWrap?.();
          return;
        }
        if (state === PlayerState.PAUSED) {
          playerContainerRef.value?.classList.add("state-paused");
          rowDmApi.playPause?.("paused");
          return;
        }
        if (state === PlayerState.ENDED) {
          // 播放结束时显示片尾推荐面板（与既有实现行为一致）
          endingApi.showEndWrap?.();
          // 片尾不是播放态：也要启动自动隐藏，让进入观看入口跟随控制栏收起
          resetAutoHideTimer();
        }
      },
      lifecycle,
    );

    // 总时长（loadedmetadata / durationchange 双事件统一写入 DURATION 键）→
    // 控制栏与顶部进度条的时长初始化（合并原双 handler 的重复 UI 动作，幂等）
    useState(
      stateMgr,
      PlayerStateKeyEnum.DURATION,
      (duration) => {
        // 迷你播放器进度条的总时长基准
        miniApi.setDuration?.(duration);
        // 延迟初始化控制栏（确保 Controls 组件已挂载）
        controlsApi.initDuration?.();
        // 将总时长回传给进度条（进度条挂载时 props.duration 仍为 0）
        progressBarApi.setDuration?.(duration);
        // 底部影子进度条共用同一份总时长
        controlsApi.setDuration?.(duration);
        controlsApi.updateVolumeDisplay?.(readVolume());
        if (readMuted()) {
          controlsApi.updateMute?.(true);
        }
        // 视频加载完成即显示控制栏（与既有实现 loadedmetadata → showControls 一致；
        // 初始加载与 load() 换源后的 loadedmetadata 都会经过此处）
        showControls("video");
      },
      lifecycle,
    );

    // 当前播放时间（timeupdate / seeked 写入 CURRENT_TIME 键）→
    // 控制栏时间 / 顶部进度条 / 迷你播放器进度
    useState(
      stateMgr,
      PlayerStateKeyEnum.CURRENT_TIME,
      (currentTime) => {
        const video = videoRef.value;
        // 画面在推进就说明没卡住：DASH 换档取新分片会触发 seek/waiting，但画面仍在播
        if (video && !video.paused) {
          cancelBuffIndicator();
          stateApi.hideBuffering?.();
          if (stateMgr?.get(PlayerStateKeyEnum.IS_LOADING) ?? false) {
            playerContainerRef.value?.classList.remove("state-buff");
            stateMgr?.set(PlayerStateKeyEnum.IS_LOADING, false);
          }
        }
        controlsApi.updateCurrent?.(currentTime);
        // 将播放进度转发给顶部进度条（更新已播放条与滑块）
        progressBarApi.updateProgress?.(currentTime);
        // 迷你播放器模式时同步其播放进度条
        miniApi.changeTempo?.(currentTime);
      },
      lifecycle,
    );

    // 缓冲进度（progress 事件写入 BUFFERED 键）→
    // 控制栏缓冲条 / 顶部进度条缓冲条 / 迷你播放器
    useState(
      stateMgr,
      PlayerStateKeyEnum.BUFFERED,
      (buffer) => {
        controlsApi.updateBuffer?.(buffer);
        progressBarApi.updateBuffer?.(buffer);
        miniApi.changeBuffer?.(buffer);
      },
      lifecycle,
    );

    // 音量 / 静音（volumechange 事件写入 VOLUME / MUTED 键）→ 控制栏音量显示
    useState(
      stateMgr,
      PlayerStateKeyEnum.VOLUME,
      (volume) => {
        controlsApi.updateVolumeDisplay?.(volume);
      },
      lifecycle,
    );

    useState(
      stateMgr,
      PlayerStateKeyEnum.MUTED,
      (muted) => {
        controlsApi.updateMute?.(muted);
      },
      lifecycle,
    );

    // 弹幕设置（显隐/透明度/速度/区域/字号）不再在此层命令式写 DOM：
    // DanmakuPlugin 订阅对应 DANMAKU_* 状态键，由引擎内部完成参数应用
  }

  // ============================================
  // 配置中心订阅（progress.segments / interaction.keyboard 设置即生效）
  // ============================================

  /** 订阅配置中心中需要在 PlayerDocker 层生效的路径 */
  const setupConfigSubscriptions = (): void => {
    if (!configStore) return;

    // progress.segments 变化 → 重建进度条分段（顶部进度条与底部影子进度条同一份数据）
    const offSegments = configStore.subscribePath(
      "progress.segments",
      (value) => {
        const next = (value as ProgressSegment[] | undefined) ?? [];
        progressBarApi.rebuildSegments?.(next);
        controlsApi.setProgressSegments?.(next);
      },
    );

    // interaction.keyboard 变化 → 启停键盘监听
    const offKeyboard = configStore.subscribePath(
      "interaction.keyboard",
      (value) => {
        setKeyboardEnabled(value !== false);
      },
    );

    // ui.title 变化 → 同步顶部栏标题文本（§3.2 ui.title 应用矩阵）
    const offTitle = configStore.subscribePath("ui.title", (value) => {
      topApi.setTitle?.(String(value ?? ""));
    });

    cleanupFns.push(offSegments, offKeyboard, offTitle);
  };

  // ============================================
  // 控制栏自动隐藏定时器
  // ============================================

  /** 自动隐藏定时器 ID */
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  /** 自动隐藏延迟（毫秒） */
  const AUTO_HIDE_DELAY = 3000;

  // ============================================
  // 事件清理函数集合
  // ============================================

  /** 存储所有需要清理的事件解绑函数 */
  const cleanupFns: (() => void)[] = [];

  // ============================================
  // 播放控制方法
  // ============================================

  /** 切换播放/暂停 */
  const togglePlayPause = (): void => {
    const video = videoRef.value;
    if (!video) return;
    // 以 video 元素自身的暂停态为准，避免依赖任何本地状态副本
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
    // 切换播放状态后显示控制栏（与既有实现 togglePlayPause 末尾的 showControls 一致）
    showControls("video");
  };

  /** 切换全屏模式 */
  const toggleFullscreen = (): void => {
    if (!playerContainerRef.value) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      playerContainerRef.value.requestFullscreen();
    }
  };

  /**
   * 绑定 document 级滚轮调节音量（同函数引用重复绑定幂等）
   * 与既有实现的 addEventListener 一致
   */
  const bindVolumeWheel = (): void => {
    document.addEventListener("wheel", handleVolumeWheel, { passive: false });
  };

  /**
   * 解绑 document 级滚轮调节音量
   * 与既有实现的 removeEventListener 一致
   */
  const unbindVolumeWheel = (): void => {
    document.removeEventListener("wheel", handleVolumeWheel);
  };

  /**
   * 按当前全屏状态同步滚轮监听（网页全屏或浏览器全屏任一激活即绑定）
   *
   * 修复叠加场景：网页全屏 → 再进浏览器全屏 → 退出浏览器全屏时，
   * 旧实现无条件解绑，导致「仍在网页全屏却没有滚轮调音量」。
   */
  const syncVolumeWheelBinding = (): void => {
    const inFullscreen =
      (stateMgr?.get(PlayerStateKeyEnum.IS_FULLSCREEN) ?? false) ||
      (stateMgr?.get(PlayerStateKeyEnum.IS_WEB_FULLSCREEN) ?? false);
    if (inFullscreen) {
      bindVolumeWheel();
    } else {
      unbindVolumeWheel();
    }
  };

  /** 切换网页全屏模式 */
  const toggleWebFullscreen = (): void => {
    if (!playerDockerRef.value || !playerContainerRef.value) return;
    const isWeb = stateMgr?.get(PlayerStateKeyEnum.IS_WEB_FULLSCREEN) ?? false;
    if (isWeb) {
      playerDockerRef.value.classList.remove("mode-webscreen");
      document.body.classList.remove("webscreen-fix");
      applyDisplayMode("normal");
      // 退出网页全屏：按当前是否仍在浏览器全屏来决定是否继续监听整页滚轮
      syncVolumeWheelBinding();
      // 同步提示工具（与既有实现 toggleWebFullscreen:524-525 一致）
      tooltipsApi.updateTipKey?.(
        "ctrl:webscreen",
        "player.ui.tooltip.webscreen.enter",
      );
    } else {
      playerDockerRef.value.classList.add("mode-webscreen");
      document.body.classList.add("webscreen-fix");
      applyDisplayMode("web");
      // 进入网页全屏：开始监听整页滚轮（既有实现 toggleWebFullscreen:506）
      syncVolumeWheelBinding();
      // 同步提示工具（与既有实现 toggleWebFullscreen:511-512 一致）
      tooltipsApi.updateTipKey?.(
        "ctrl:webscreen",
        "player.ui.tooltip.webscreen.exit",
      );
    }
  };

  /**
   * 同步宽屏提示文案（进入宽屏 ↔ 退出宽屏）
   * 控制栏点击与外部 API（player.setWideScreen）共用，保证提示与状态一致
   * @param isWide - 当前是否宽屏
   */
  const syncWideTooltip = (isWide: boolean): void => {
    tooltipsApi.updateTipKey?.(
      "ctrl:widescreen",
      isWide
        ? "player.ui.tooltip.widescreen.exit"
        : "player.ui.tooltip.widescreen.enter",
    );
  };

  /**
   * 切换宽屏（宽屏布局完全由播放器外部容器决定）
   *
   * 控制栏宽屏按钮点击后：只切换内部宽屏状态并广播 `wideScreenChange`，
   * 回调参数为是否宽屏布尔值；外部程序通过 `player.on("wideScreenChange")`
   * （或 callbacks.wideScreenChange）监听后自行调整外部容器布局。
   * 播放器内部仅同步宽屏按钮 / 图标选中态与提示文案，不修改 `data-screen`、
   * 不搬移发送栏，避免与外部容器布局互相打架。
   */
  const toggleWide = (): void => {
    const next = !(stateMgr?.get(PlayerStateKeyEnum.IS_WIDE_SCREEN) ?? false);
    stateMgr?.set(PlayerStateKeyEnum.IS_WIDE_SCREEN, next);
    syncWideTooltip(next);
    props.events?.emit(PlayerEventEnum.WIDE_SCREEN_CHANGE, {
      isWideScreen: next,
    });
  };

  /** 切换静音状态 */
  const toggleMute = (): void => {    const next = !readMuted();
    if (videoRef.value) {
      videoRef.value.muted = next;
    }
    stateMgr?.set(PlayerStateKeyEnum.MUTED, next);
    controlsApi.updateMute?.(next);
  };

  /** 设置音量，限制在 0-1 范围内 */
  const setVolume = (vol: number): void => {
    const clamped = Math.min(1, Math.max(0, vol));
    if (videoRef.value) videoRef.value.volume = clamped;
    // 音量被调到大于 0 时自动解除静音，与主流播放器一致；
    // 否则静音状态下拖动音量条 / 向上滚轮会「数字在动但没声音」
    if (clamped > 0 && readMuted()) {
      if (videoRef.value) videoRef.value.muted = false;
      stateMgr?.set(PlayerStateKeyEnum.MUTED, false);
      controlsApi.updateMute?.(false);
    }
    stateMgr?.set(PlayerStateKeyEnum.VOLUME, clamped);
    controlsApi.updateVolumeDisplay?.(clamped);
  };

  /**
   * 跳转到指定时间（秒）
   *
   * 同步三处：video 元素的 currentTime、运行时状态 CURRENT_TIME，
   * 以及依赖进度更新的 UI（时间文本 / 进度条）。
   * 弹幕引擎自行监听 video seeking 事件完成 seek 重建，无需在此驱动。
   */
  const seekTo = (time: number): void => {
    const video = videoRef.value;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target =
      duration > 0 ? Math.min(Math.max(0, time), duration) : Math.max(0, time);
    video.currentTime = target;
    stateMgr?.set(PlayerStateKeyEnum.CURRENT_TIME, target);
    controlsApi.updateCurrent?.(target);
    progressBarApi.updateProgress?.(target);
  };

  /** 应用播放速率（同步 video、状态与事件总线） */
  const applyPlaybackRate = (rate: number): void => {
    if (videoRef.value) videoRef.value.playbackRate = rate;
    stateMgr?.set(PlayerStateKeyEnum.PLAYBACK_RATE, rate);
    props.events?.emit(PlayerEventEnum.RATE_CHANGE, rate);
  };

  /** 切换画中画（浏览器不支持时静默返回） */
  const togglePip = (): void => {
    if (!isBrowser()) return;
    const video = videoRef.value;
    if (!video) return;
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture();
      return;
    }
    if (
      document.pictureInPictureEnabled &&
      typeof video.requestPictureInPicture === "function"
    ) {
      void video.requestPictureInPicture();
    }
  };

  /**
   * 确保音量提示层已挂载
   *
   * 与 ColorPanel / AudioPanel 一致：首次真正需要显示时才创建 DOM，
   * 已创建则直接复用；未触发过音量提示时播放器里没有该节点。
   */
  const ensureVolumeHint = (): void => {
    if (volumeHintVNode) return;
    const videoArea = playerVideoAreaRef.value;
    if (!videoArea) return;
    volumeHintVNode = h(VolumeHint, {
      onVolumeHintMounted: (api: {
        show: (volume: number) => void;
        hide: () => void;
        setVolume: (volume: number) => void;
        setMuted: (muted: boolean) => void;
      }) => {
        volumeHintApi.show = api.show;
        volumeHintApi.hide = api.hide;
      },
    });
    mount(volumeHintVNode, videoArea);
  };

  /** 显示音量提示层（滚轮 / 快捷键调节音量时，与既有实现一致） */
  const showVolumeHint = (volume: number): void => {
    ensureVolumeHint();
    volumeHintApi.show?.(volume);
  };

  /**
   * 滚轮调节音量
   *
   * - 先显示音量提示（即使音量未变化也提示，既有实现 show() 无条件调用）；
   * - 步长 0.02，**向上/向下都能调**。
   *
   * 修复：旧实现在静音时忽略向下滚动（`!readMuted()` 守卫），
   * 而静音可能由「点击音量面板」的穿透 bug 意外触发，表现为「向下滚动没反应」。
   * 现在两个方向都生效；音量大于 0 时由 setVolume 自动解除静音。
   */
  const handleVolumeWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const current = readVolume();
    let next = current;
    if (event.deltaY < 0) {
      next = Math.min(1, Math.max(0, current + 0.02));
    } else if (event.deltaY > 0) {
      next = Math.min(1, Math.max(0, current - 0.02));
    }
    // 无论音量是否变化都显示提示（含 3 秒自动消失，既有实现 handleVolumeChangeWithWheel:735-736）
    showVolumeHint(next);
    if (next !== current) {
      setVolume(next);
    }
  };

  /**
   * 显示控制栏（与既有实现 showControls(position) 一致）：
   * - video：视频区移动触发，显示并启动 3 秒自动隐藏
   * - control / top：悬停在控制栏 / 顶栏上触发，仅显示、不自动隐藏，
   *   避免用户停留在菜单上时控制栏被定时器隐藏
   */
  const showControls = (
    position: "video" | "control" | "top" = "video",
  ): void => {
    if (!playerContainerRef.value) return;
    // 互动视频播完锁定（插件 handleEnded 已设 data-interactive-ended）：
    // 顶栏 / 控制栏不再随鼠标移入唤起，只留问题画布与重播按钮可交互；
    // 插件切分支 / 重播 / 起播时清除该属性，控制栏联动随之恢复
    if (playerContainerRef.value.hasAttribute("data-interactive-ended")) {
      return;
    }
    playerContainerRef.value.setAttribute("data-ctrl-hidden", "false");
    playerContainerRef.value.classList.remove("state-no-cursor");
    controlsApi.showControl?.();
    if (position === "video") {
      resetAutoHideTimer();
    } else if (autoHideTimer !== null) {
      // 停留控制栏 / 顶栏期间取消待执行的自动隐藏
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  };

  /** 隐藏控制栏 */
  const hideControls = (): void => {
    if (!playerContainerRef.value) return;
    playerContainerRef.value.setAttribute("data-ctrl-hidden", "true");
    playerContainerRef.value.classList.add("state-no-cursor");
    controlsApi.hideControl?.();
  };

  /** 重置自动隐藏定时器，播放中 3 秒后自动隐藏控制栏 */
  const resetAutoHideTimer = (): void => {
    if (autoHideTimer !== null) {
      clearTimeout(autoHideTimer);
    }
    autoHideTimer = setTimeout(() => {
      if (
        readIsPlaying() ||
        playerContainerRef.value?.classList.contains("state-ended")
      ) {
        hideControls();
      }
      autoHideTimer = null;
    }, AUTO_HIDE_DELAY);
  };

  // ============================================
  // 快捷键处理器
  // ============================================

  const hotkeyCtx: HotkeyContext = {
    getVideo: (): HTMLVideoElement | null => videoRef.value ?? null,
    togglePlayPause,
    toggleFullscreen,
    exitFullscreen: (): void => {
      // SSR 阶段不触碰 document
      if (!isBrowser()) return;
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      }
    },
    toggleMute,
    setVolume: (volume: number): void => {
      // 快捷键调节音量时同步显示音量提示（与既有实现的 ↑/↓ 行为一致）
      setVolume(volume);
      showVolumeHint(volume);
    },
    getVolume: (): number => readVolume(),
    seekBy: (seconds: number): void => {
      const video = videoRef.value;
      if (!video) return;
      const duration = Number.isFinite(video.duration)
        ? video.duration
        : Infinity;
      video.currentTime = Math.min(
        Math.max(0, video.currentTime + seconds),
        duration,
      );
    },
    setPlaybackRate: (rate: number): void => {
      if (videoRef.value) {
        videoRef.value.playbackRate = rate;
      }
      stateMgr?.set(PlayerStateKeyEnum.PLAYBACK_RATE, rate);
    },
    getPlaybackRate: (): number =>
      videoRef.value?.playbackRate ?? readBackrate(),
    like: () => {
      lifecycle.emit?.("like");
    },
    coin: () => {
      lifecycle.emit?.("coin");
    },
    favorite: () => {
      lifecycle.emit?.("favorite");
    },
    tripleLike: () => {
      lifecycle.emit?.("tripleLike");
    },
    follow: () => {
      lifecycle.emit?.("follow");
    },
    toggleDanmaku: () => {
      lifecycle.emit?.("danmakuToggle");
    },
    sendDanmaku: () => {
      // 快捷键触发发送弹幕：聚焦弹幕输入框（SendBar 挂载后可用）
      sendBarApi.focusInput?.();
    },
    prevEpisode: () => {
      lifecycle.emit?.("prev");
    },
    nextEpisode: () => {
      lifecycle.emit?.("next");
    },
  };

  /** keydown / keyup 需成对注册：→ 键的「长按倍速」依赖 keyup 还原速率 */
  const hotkeyHandlers = createHotkeyHandlers(hotkeyCtx);
  const onKeyboard = hotkeyHandlers.onKeydown;
  const onKeyboardUp = hotkeyHandlers.onKeyup;

  /** 键盘监听是否处于启用状态（供 `interaction.keyboard` 运行时启停） */
  let keyboardEnabled = false;

  /**
   * 启停键盘快捷键监听（keydown / keyup 成对处理）
   * @param enabled - 是否启用
   */
  const setKeyboardEnabled = (enabled: boolean): void => {
    if (enabled === keyboardEnabled) return;
    keyboardEnabled = enabled;
    if (enabled) {
      document.addEventListener("keydown", onKeyboard);
      document.addEventListener("keyup", onKeyboardUp);
    } else {
      document.removeEventListener("keydown", onKeyboard);
      document.removeEventListener("keyup", onKeyboardUp);
    }
  };

  /**
   * 全屏状态变化时，更新全屏标志与 `data-screen`
   *
   * 全屏不属于 `DisplayMode`（无 'full'），因此不写 `player.displayMode`，
   * 由 `player.isFullscreen` 单独承载。
   */
  const onFullscreenChange = (): void => {
    if (!playerContainerRef.value) return;
    if (document.fullscreenElement) {
      playerContainerRef.value.setAttribute("data-screen", "full");
      stateMgr?.set(PlayerStateKeyEnum.IS_FULLSCREEN, true);
      // 进入全屏：开始监听整页滚轮（既有实现 handleFullscreenChange:475；
      // 从网页全屏直接进入全屏时重复绑定，同函数引用幂等）
      syncVolumeWheelBinding();
      // 进入全屏：移动弹幕发送栏到底部中央 + 同步提示工具
      // （与既有实现 handleFullscreenChange:474-481 一致）
      moveSendBar("full");
      tooltipsApi.setScreen?.("full");
      tooltipsApi.updateTipKey?.(
        "ctrl:fullscreen",
        "player.ui.tooltip.fullscreen.exit",
      );
    } else {
      // 退出浏览器全屏：若仍处于网页全屏，data-screen 必须回到 "web" 而不是 "normal"，
      // 否则网页全屏相关的样式与可见性规则（如「选集」按钮）会失效
      const stillWebFullscreen =
        stateMgr?.get(PlayerStateKeyEnum.IS_WEB_FULLSCREEN) ?? false;
      playerContainerRef.value.setAttribute(
        "data-screen",
        stillWebFullscreen ? "web" : "normal",
      );
      stateMgr?.set(PlayerStateKeyEnum.IS_FULLSCREEN, false);
      // 退出全屏：按当前是否仍在网页全屏决定是否继续监听整页滚轮
      syncVolumeWheelBinding();
      // 退出全屏：弹幕发送栏移回发送区域 + 同步提示工具
      // （与既有实现 handleFullscreenChange:483-492 一致）
      moveSendBar("normal");
      tooltipsApi.setScreen?.(stillWebFullscreen ? "web" : "normal");
      tooltipsApi.updateTipKey?.(
        "ctrl:fullscreen",
        "player.ui.tooltip.fullscreen.enter",
      );
    }
  };

  /**
   * 画中画状态变化时，更新画中画标志
   */
  const onPipChange = (): void => {
    stateMgr?.set(
      PlayerStateKeyEnum.IS_PIP,
      document.pictureInPictureElement !== null,
    );
    // 同步画中画按钮的提示文本（与既有实现 handlePiPChange:649-656 一致）
    if (document.pictureInPictureElement !== null) {
      tooltipsApi.updateTipKey?.("ctrl:pip", "player.ui.tooltip.pip.exit");
    } else {
      tooltipsApi.updateTipKey?.("ctrl:pip", "player.ui.tooltip.pip.enter");
    }
  };

  /**
   * 右键菜单处理，阻止默认菜单并触发自定义菜单事件
   * @param event - 鼠标事件
   */
  const onContextMenu = (event: MouseEvent): void => {
    // 播放器自带右键菜单已打开时，再次右键放行：不拦截、不关菜单 → 弹出浏览器原生菜单
    const openedMenu = playerContainerRef.value?.querySelector(
      ".nova-player-contextmenu.nova-player-active",
    );
    if (openedMenu) {
      return;
    }
    event.preventDefault();
    // 菜单坐标相对播放器容器计算（与既有实现的 +2 偏移一致）
    const rect = playerContainerRef.value?.getBoundingClientRect();
    const x = rect ? Math.floor(event.clientX - rect.left + 2) : event.clientX;
    const y = rect ? Math.floor(event.clientY - rect.top + 2) : event.clientY;
    contextApi.showMenu?.(x, y);
    lifecycle.emit?.("contextMenu", { x: event.clientX, y: event.clientY });
  };

  /** 容器尺寸变化观察器，通知事件总线容器大小变化 */
  const resizeObserver = safeResizeObserver((entries) => {
    entries.forEach(() => {
      const width = playerDockerRef.value?.clientWidth ?? 0;
      const height = playerDockerRef.value?.clientHeight ?? 0;
      // 外链暂停页：容器过小时隐藏推荐卡片，保留进入观看入口
      playerContainerRef.value?.classList.toggle(
        "is-embedded-compact",
        embeddedMode && (width < 640 || height < 360),
      );
      props.events?.emit(PlayerEventEnum.RESIZE, { width, height });
    });
  });

  // ============================================
  // 迷你播放器 IntersectionObserver
  // ============================================

  /** 迷你播放器可见性观察器 */
  let miniPlayerObserver: IntersectionObserver | null = null;

  /** 迷你窗口默认右下角偏移（像素，与既有实现 miniPlayer 默认值一致） */
  const MINI_OFFSET = 84;

  /** 当前迷你窗口右偏移（像素，可拖拽改变） */
  let miniOffsetRight = MINI_OFFSET;

  /** 当前迷你窗口下偏移（像素，可拖拽改变） */
  let miniOffsetBottom = MINI_OFFSET;

  /** 迷你窗口拖拽元素（.nova-player-mini-warp），由 Mini 组件挂载后赋值 */
  let miniWarpEl: HTMLElement | null = null;

  /** 拖拽期间绑定在 document 上的 mousemove 处理器（销毁时清理用） */
  let miniDragMouseMove: ((e: MouseEvent) => void) | null = null;

  /** 拖拽期间绑定在 document 上的 mouseup 处理器（销毁时清理用） */
  let miniDragMouseUp: (() => void) | null = null;

  /** 进入迷你播放器模式：加 mode-mini 类 + 写 data-screen + 设置右下角偏移 */
  const enterMiniPlayer = (): void => {
    // 画中画状态下不进入迷你模式（与既有实现一致）
    if (stateMgr?.get(PlayerStateKeyEnum.IS_PIP)) return;
    playerDockerRef.value?.classList.add("mode-mini");
    applyDisplayMode("mini");
    const container = playerContainerRef.value;
    if (container) {
      container.style.right = `${miniOffsetRight}px`;
      container.style.bottom = `${miniOffsetBottom}px`;
    }
  };

  /** 退出迷你播放器模式：移除 mode-mini 类 + 还原 data-screen + 清除内联偏移样式 */
  const exitMiniPlayer = (): void => {
    playerDockerRef.value?.classList.remove("mode-mini");
    applyDisplayMode("normal");
    playerContainerRef.value?.removeAttribute("style");
  };

  /**
   * 迷你窗口拖拽（与既有实现 fnDown 行为一致：
   * 按下后通过 document 级 mousemove 更新 right/bottom 偏移）
   * @param event - 鼠标按下事件
   */
  const handleMiniDragDown = (event: MouseEvent): void => {
    event.preventDefault();
    /** 按下时的鼠标 X 坐标 */
    let startX = event.clientX;
    /** 按下时的鼠标 Y 坐标 */
    let startY = event.clientY;
    const onMouseMove = (e: MouseEvent): void => {
      miniOffsetRight += startX - e.clientX;
      miniOffsetBottom += startY - e.clientY;
      startX = e.clientX;
      startY = e.clientY;
      const container = playerContainerRef.value;
      if (container) {
        container.style.right = `${miniOffsetRight}px`;
        container.style.bottom = `${miniOffsetBottom}px`;
      }
    };
    const onMouseUp = (): void => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      miniDragMouseMove = null;
      miniDragMouseUp = null;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    miniDragMouseMove = onMouseMove;
    miniDragMouseUp = onMouseUp;
  };

  // ============================================
  // 事件绑定与解绑
  // ============================================

  /**
   * 初始化所有 DOM 事件监听
   * 在 onMounted 中调用
   */
  const initEvent = (): void => {
    const container = playerContainerRef.value;
    const videoArea = playerVideoAreaRef.value;
    const perch = playerVideoPerchRef.value;
    const docker = playerDockerRef.value;

    if (!container || !videoArea || !perch || !docker) return;

    // --- 控制栏点击兜底：SSR 水合时组件内 onClick 可能未重新绑定 ---
    const onControlCapture = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLElement>(".nova-player-ctrl-btn");
      if (!button) return;
      const classes = button.classList;
      if (classes.contains("nova-player-ctrl-play")) {
        event.stopImmediatePropagation();
        event.preventDefault();
        togglePlayPause();
      } else if (classes.contains("nova-player-ctrl-mute")) {
        event.stopImmediatePropagation();
        event.preventDefault();
        toggleMute();
      } else if (classes.contains("nova-player-ctrl-full")) {
        event.stopImmediatePropagation();
        event.preventDefault();
        toggleFullscreen();
      } else if (classes.contains("nova-player-ctrl-web")) {
        event.stopImmediatePropagation();
        event.preventDefault();
        toggleWebFullscreen();
      } else if (classes.contains("nova-player-ctrl-wide")) {
        event.stopImmediatePropagation();
        event.preventDefault();
        toggleWide();
      }
    };
    container.addEventListener("click", onControlCapture, true);
    cleanupFns.push(() => container.removeEventListener("click", onControlCapture, true));

    // --- ResizeObserver 容器尺寸变化 ---
    resizeObserver?.observe(docker);

    // --- mouseleave on videoArea → 隐藏控制栏 ---
    const onMouseLeaveVideoArea = (): void => {
      // 豁免（与既有实现一致）：
      // 网页全屏 / 全屏下，弹幕输入框聚焦时不隐藏控制栏，
      // 避免鼠标从输入框附近移开时控制栏被收起打断输入
      const displayMode = stateMgr?.get(PlayerStateKeyEnum.DISPLAY_MODE);
      const isFull = stateMgr?.get(PlayerStateKeyEnum.IS_FULLSCREEN) ?? false;
      if ((displayMode === "web" || isFull) && isSendFocus) {
        return;
      }
      hideControls();
    };
    videoArea.addEventListener("mouseleave", onMouseLeaveVideoArea);
    cleanupFns.push(() =>
      videoArea.removeEventListener("mouseleave", onMouseLeaveVideoArea),
    );

    // --- dblclick on perch → 切换全屏 ---
    const onDblClickPerch = (event: MouseEvent): void => {
      event.preventDefault();
      // 先对外广播，再执行全屏切换（订阅方可在切换前读到事件）
      lifecycle.emit?.("perchDblclick", event);
      toggleFullscreen();
    };
    perch.addEventListener("dblclick", onDblClickPerch);
    cleanupFns.push(() =>
      perch.removeEventListener("dblclick", onDblClickPerch),
    );

    // --- mousemove on perch → 显示控制栏并重置自动隐藏（与既有实现一致） ---
    // 悬停带 data-ctrl-hold 标记的插件浮层（如互动剧情条）时例外：
    // 与悬停控制栏 / 顶栏同语义 —— 仅显示、取消待执行的自动隐藏，
    // 杜绝「悬停剧情条静止 3 秒 → 控制栏隐藏把整个互动层一并藏起 →
    // 鼠标微动立即唤起」的显隐循环闪烁。标记为通用协议，
    // 任何插件 / 外部浮层声明该属性即可获得悬停保持行为。
    const onMouseMovePerch = (event: MouseEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-ctrl-hold]")
      ) {
        showControls("control");
        return;
      }
      showControls("video");
    };
    perch.addEventListener("mousemove", onMouseMovePerch);
    cleanupFns.push(() =>
      perch.removeEventListener("mousemove", onMouseMovePerch),
    );

    // --- mousemove on 控制栏 / 顶栏 → 仅显示、不自动隐藏 ---
    // 避免用户悬停菜单时被 3 秒定时器收起（与既有实现 showControls("control"/"top") 一致）
    const controlWrap = container.querySelector<HTMLElement>(
      ".nova-player-control-wrap",
    );
    if (controlWrap) {
      const onMouseMoveControl = (): void => {
        showControls("control");
      };
      controlWrap.addEventListener("mousemove", onMouseMoveControl);
      cleanupFns.push(() =>
        controlWrap.removeEventListener("mousemove", onMouseMoveControl),
      );
    }
    const topWrap = container.querySelector<HTMLElement>(
      ".nova-player-top-wrap",
    );
    if (topWrap) {
      const onMouseMoveTop = (): void => {
        showControls("top");
      };
      topWrap.addEventListener("mousemove", onMouseMoveTop);
      cleanupFns.push(() =>
        topWrap.removeEventListener("mousemove", onMouseMoveTop),
      );
    }

    // --- click on perch → 切换播放/暂停（400ms 延迟区分双击） ---
    /** 点击延迟定时器，用于区分单击和双击 */
    let clickTimer: ReturnType<typeof setTimeout> | null = null;
    const onClickPerch = (event: MouseEvent): void => {
      // 单击即对外广播（双击同样会先产生 click，与原生 DOM 语义一致）
      lifecycle.emit?.("perchClick", event);
      if (clickTimer !== null) {
        clearTimeout(clickTimer);
        clickTimer = null;
        return; // 双击的第二次点击，忽略
      }
      clickTimer = setTimeout(() => {
        togglePlayPause();
        clickTimer = null;
      }, 400);
    };
    perch.addEventListener("click", onClickPerch);
    cleanupFns.push(() => perch.removeEventListener("click", onClickPerch));

    // --- fullscreenchange 监听 ---
    document.addEventListener("fullscreenchange", onFullscreenChange);
    cleanupFns.push(() =>
      document.removeEventListener("fullscreenchange", onFullscreenChange),
    );

    // --- 画中画事件监听 ---
    document.addEventListener("enterpictureinpicture", onPipChange);
    cleanupFns.push(() =>
      document.removeEventListener("enterpictureinpicture", onPipChange),
    );
    document.addEventListener("leavepictureinpicture", onPipChange);
    cleanupFns.push(() =>
      document.removeEventListener("leavepictureinpicture", onPipChange),
    );

    // --- 键盘事件监听（受 interaction.keyboard 配置控制，支持运行时启停） ---
    // keydown / keyup 成对注册：→ 键的「长按倍速」需要 keyup 还原播放速率
    const keyboardConfig =
      configStore?.getPath<boolean | Record<string, unknown>>(
        "interaction.keyboard",
      ) ??
      props.config?.interaction?.keyboard ??
      true;
    setKeyboardEnabled(keyboardConfig !== false);
    cleanupFns.push(() => {
      setKeyboardEnabled(false);
      hotkeyHandlers.destroy();
    });

    // --- 滚轮调节音量 ---
    // 既有实现仅在网页全屏 / 全屏时绑定 document 滚轮，
    // 退出时解绑；普通模式下不绑定，页面滚轮行为不受影响。
    // 绑定 / 解绑由 toggleWebFullscreen 与 onFullscreenChange 的进入 / 退出分支驱动，
    // 此处仅兜底解绑（cleanupFns），防止销毁时残留监听
    cleanupFns.push(() =>
      document.removeEventListener("wheel", handleVolumeWheel),
    );

    // --- 右键菜单监听 ---
    container.addEventListener("contextmenu", onContextMenu);
    cleanupFns.push(() =>
      container.removeEventListener("contextmenu", onContextMenu),
    );

    // --- IntersectionObserver 迷你播放器 ---
    miniPlayerObserver = safeIntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            requestAnimationFrame(() => {
              // 播放器不可见 → 进入迷你播放器模式
              enterMiniPlayer();
            });
          } else {
            requestAnimationFrame(() => {
              // 播放器可见 → 退出迷你播放器模式
              exitMiniPlayer();
            });
          }
        });
      },
      { threshold: 0.5 },
    );
    if (miniPlayerObserver) {
      miniPlayerObserver.observe(docker);
    }
  };

  // ============================================
  // 生命周期钩子
  // ============================================

  lifecycle.onMounted = (): void => {
    resolvedPlayer?.registerTopViewRefresh(mountTopView);
    resolvedPlayer?.registerEndingViewRefresh(mountEndingView);
    mountTopView();
    mountEndingView();

    // 初始化视频
    initVideo();
    // 绑定所有 DOM 事件
    initEvent();
    // 订阅事件总线上的时序类媒体事件（WAITING / CAN_PLAY / SEEKING / SEEKED）
    setupVideoEventSubscriptions();
    // 订阅错误相关事件（ERROR / ERROR_RECOVERY / LOADED_METADATA），驱动错误面板显隐
    setupErrorEventSubscriptions();
    // 订阅清晰度切换事件（补充档位展示名）
    setupQualityEvents();
    // 订阅配置中心的动态变化（progress.segments / interaction.keyboard）
    setupConfigSubscriptions();

    // 宽屏提示与状态同步：外部 API（player.setWideScreen / toggleWideScreen）
    // 或控制栏点击都会更新提示文案（进入宽屏 ↔ 退出宽屏）
    const offWideTooltip = stateMgr?.subscribe(
      PlayerStateKeyEnum.IS_WIDE_SCREEN,
      (isWide) => syncWideTooltip(isWide),
    );
    if (offWideTooltip) cleanupFns.push(offWideTooltip);
    syncWideTooltip(stateMgr?.get(PlayerStateKeyEnum.IS_WIDE_SCREEN) ?? false);

    // 触发挂载完成回调
    // 【sendingArea 不再是挂载硬依赖】未装 danmaku 插件时发送区经
    // Show 控制流不渲染（playerSendingAreaRef 为 null），若仍作为
    // 必要条件，mounted 永不触发 → VideoPlayer 的流媒体初始化 /
    // 事件绑定 / 首帧加载链路全部中断，表现为无法播放
    if (
      playerDockerRef.value &&
      playerVideoAreaRef.value &&
      playerVideoWrapRef.value &&
      videoRef.value
    ) {
      lifecycle.emit?.("mounted", {
        container: playerDockerRef.value,
        videoArea: playerVideoAreaRef.value,
        videoWrap: playerVideoWrapRef.value,
        video: videoRef.value,
        sendingArea: playerSendingAreaRef.value ?? null,
      });
    }

    // 触发播放器加载完成事件
    lifecycle.emit?.("playerLoaded");
  };

  /** 组件卸载是否已执行（统一入口与 onBeforeDestroy 各会调用一次） */
  let tornDown = false;

  /**
   * 组件统一卸载：释放本组件申请的 DOM 调用 / 事件监听 / 定时器 / 观察器 / 懒挂载面板
   *
   * 幂等：播放器 destroy 先从最深子组件逐层调用本入口，core 的 destroy(vnode)
   * 随后还会触发一次 onBeforeDestroy，两次都安全。
   */
  const teardown = (): void => {
    topMountCleanup?.();
    topMountCleanup = null;
    endingMountCleanup?.();
    endingMountCleanup = null;

    if (tornDown) return;
    tornDown = true;

    // 清理自动隐藏定时器
    if (autoHideTimer !== null) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }

    // 清理网页全屏状态
    if (
      (stateMgr?.get(PlayerStateKeyEnum.IS_WEB_FULLSCREEN) ?? false) &&
      isBrowser()
    ) {
      playerDockerRef.value?.classList.remove("mode-webscreen");
      document.body.classList.remove("webscreen-fix");
    }

    // video 媒体事件监听已随订阅制重构移除（核心层独占绑定）；
    // 总线订阅解绑函数在 cleanupFns 中统一释放

    // 清理所有 DOM 事件监听
    cleanupFns.forEach((fn) => fn());
    cleanupFns.length = 0;

    // 停止缓冲速度采样（定时器）并释放 Resource Timing 观察器
    setBufferSpeedSampling(false);
    bufferSpeedSampler?.destroy();
    bufferSpeedSampler = null;

    // 销毁懒挂载的面板（ColorPanel / VideoInfo / HotkeyPanel）
    Object.values(lazyPanelVNodes).forEach((panelVNode) => {
      if (panelVNode) destroy(panelVNode);
    });
    lazyPanelVNodes.color = undefined;
    lazyPanelVNodes.audio = undefined;
    lazyPanelVNodes.info = undefined;
    lazyPanelVNodes.keyboard = undefined;

    // 销毁懒挂载的音量提示层
    if (volumeHintVNode) {
      destroy(volumeHintVNode);
      volumeHintVNode = null;
    }

    // 清理迷你播放器拖拽期间可能残留在 document 上的监听
    if (miniDragMouseMove) {
      document.removeEventListener("mousemove", miniDragMouseMove);
      miniDragMouseMove = null;
    }
    if (miniDragMouseUp) {
      document.removeEventListener("mouseup", miniDragMouseUp);
      miniDragMouseUp = null;
    }

    // 断开 ResizeObserver
    resizeObserver?.disconnect();

    // 断开 IntersectionObserver
    if (miniPlayerObserver) {
      miniPlayerObserver.disconnect();
      miniPlayerObserver = null;
    }

    // 卸载迷你窗口上的拖拽监听
    if (miniWarpEl) {
      miniWarpEl.removeEventListener("mousedown", handleMiniDragDown);
      miniWarpEl = null;
    }
  };

  // 统一卸载入口（最深子组件 → 根，由 VideoPlayer.destroy 在插件销毁之前调用）
  useComponentUnmount(lifecycle, teardown);
  // 契约钩子保持不变：直接 destroy(vnode) 的路径（如懒挂载面板）仍然有效
  lifecycle.onBeforeDestroy = teardown;

  // ============================================
  // 渲染输出
  // ============================================

  /**
   * 渲染播放器主容器
   */

  const readUi = () =>
    (resolvedPlayer?.props ?? configStore?.get() ?? props.config)?.ui;

  const readTopStyle = (): "default" | "tv" | "music" =>
    readUi()?.topStyle ??
    ((readUi()?.endingStyle ?? endingStyle) === "ogv" ? "tv" : "default");
  const readEndingStyle = () => readUi()?.endingStyle ?? endingStyle;

  /** 插件视图数据（挂载时构造，避免提前引用未初始化函数） */
  const buildTopProps = () => ({
            title:
              (embeddedMode
                ? (embeddedConfig?.title ?? readUi()?.title)
                : readUi()?.title) ?? props.playerName,
            avatar:
              embeddedConfig?.up?.face ?? readUi()?.up?.face,
            upName:
              embeddedConfig?.up?.name ?? readUi()?.up?.name,
            embedded: embeddedMode,
            tv: readTopStyle() === "tv",
            music: readTopStyle() === "music",
            musicTitle: readUi()?.musicTitle,
            followed: Boolean(
              embeddedConfig?.up?.followed ?? readUi()?.up?.followed,
            ),
            likeCount: embeddedConfig?.stats?.like,
            commentCount: embeddedConfig?.stats?.comment,
            onFollowClick: () => {
              lifecycle.emit?.("follow");
            },
            onLikeClick: () => {
              lifecycle.emit?.("like");
            },
            onCommentClick: () => {
              lifecycle.emit?.("comment");
            },
            onShareClick: () => {
              lifecycle.emit?.("share");
            },
            onMoreClick: () => {
              lifecycle.emit?.("more");
            },
            // 问题反馈图标的悬停提示（既有实现的
            // top.on("show-tooltip"/"hide-tooltip") 接通 Tooltips 组件）
            onShowTooltip: handleShowTooltip,
            onHideTooltip: handleHideTooltip,
          });
  const buildEndingProps = () => ({
            variant: embeddedMode
              ? "embedded"
              : readEndingStyle() === "ogv"
                ? "ogv"
                : readEndingStyle() === "interactive"
                  ? "interactive"
                  : "station",
            title: embeddedMode
              ? (embeddedConfig?.title ??
                readUi()?.title ??
                props.playerName)
              : readEndingStyle() === "ogv"
                ? (readUi()?.ogv?.title ??
                  readUi()?.title ??
                  props.playerName)
                : (readUi()?.title ?? props.playerName),
            cover: readUi()?.ogv?.cover,
            followed: readUi()?.ogv?.followed,
            followers: readUi()?.interactive?.followers,
            backtrack: readUi()?.interactive?.backtrack,
            activeBacktrackIndex:
              readUi()?.interactive?.activeBacktrackIndex,
            ratingPrompt: readUi()?.interactive?.ratingPrompt,
            upInfo: embeddedMode
              ? embeddedConfig?.up
              : readUi()?.up,
            likeCount: embeddedMode ? embeddedConfig?.stats?.like : undefined,
            shareCount: embeddedMode
              ? embeddedConfig?.stats?.comment
              : undefined,
            shareUrl: readUi()?.share?.url,
            embedCode: readUi()?.share?.embedCode,
            qrCodeUrl: readUi()?.share?.qrCodeUrl,
            related: embeddedMode
              ? embeddedConfig?.related
              : readEndingStyle() === "ogv"
                ? readUi()?.ogv?.related
                : readEndingStyle() === "interactive"
                  ? (readUi()?.interactive?.related ??
                    readUi()?.related)
                  : readUi()?.related,
            autoNext: embeddedMode
              ? false
              : () =>
                  (stateMgr?.get(PlayerStateKeyEnum.PLAYLIST_LENGTH) ?? 0) >
                    1 &&
                  !(props.config?.playback?.pauseAfterEnd ?? false),
            onRestart: () => {
              seekTo(0);
              void videoRef.value?.play();
            },
            onLike: () => {
              lifecycle.emit?.("like");
            },
            onCoin: () => {
              lifecycle.emit?.("coin");
            },
            onCollect: () => {
              lifecycle.emit?.("favorite");
            },
            onFollow: () => {
              lifecycle.emit?.("follow");
            },
            onAutoNext: () => {
              lifecycle.emit?.("next");
            },
            onRelatedClick: (item: { url?: string }) => {
              if (item.url) openEmbeddedUrl(item.url);
            },
            onEnterSite: () => {
              openEmbeddedUrl(embeddedConfig?.enterUrl);
            },
            onDownloadApp: () => {
              openEmbeddedUrl(embeddedConfig?.downloadUrl);
            },
            onEndingMounted: (api: EndingApi) => {
              Object.assign(endingApi, api);
            },
          });

  return h(
    "div",
    {
      class: "nova-player-docker nova-player-docker-major",
      "data-injector": "nano",
      ref: "playerDockerRef",
    },
    h(
      "div",
      {
        class: [
          "nova-player-container state-paused state-no-cursor state-disable-box-shadow",
          { "is-embedded": embeddedMode },
        ],
        "data-angle": "d3d11",
        "data-screen": "normal",
        // 初始隐藏控制栏（与既有实现模板一致），由鼠标移动 / 播放交互驱动显示
        "data-ctrl-hidden": "true",
        "aria-label": props.playerName || "嗨哩播放器",
        ref: "playerContainerRef",
      },
      h(
        "div",
        { class: "nova-player-primary-area" },
        // 视频区域
        h(
          "div",
          {
            class: "nova-player-video-area",
            ref: "playerVideoAreaRef",
          },
          // 视频占位容器
          h(
            "div",
            {
              class: "nova-player-video-perch",
              ref: "playerVideoPerchRef",
            },
            // 视频包装容器
            h(
              "div",
              {
                class: "nova-player-video-wrap",
                ref: "playerVideoWrapRef",
              },
              h("video", {
                class: "nova-player-video",
                crossorigin: "anonymous",
                preload: "auto",
                playsinline: "",
                ref: "videoRef",
              }),
            ),
          ),
          // 视频海报
          h("div", {
            class: "nova-player-video-poster",
            hidden: true,
          }),
          // 弹幕容器（按需渲染：未装 danmaku 插件时不挂载任何弹幕 DOM）
          h(
            Show,
            { when: (): boolean => hasPlugin("danmaku") },
            h(RowDm, {
              isOpen: true,
              onDanmakuLayerMounted: (data: DanmakuLayerAPI) => {
                // playPause：根容器 danmaku-x-paused 类（原版暂停机制）；
                // 弹幕渲染与设置应用由 DanmakuPlugin 接管，此层只保留播放暂停联动
                rowDmApi.playPause = data.playPause;
                rowDmApi.showDmTip = data.showDmTip;
                rowDmApi.hideDmTip = data.hideDmTip;
                lifecycle.emit?.("danmakuLayerMounted", data);
                // 弹幕层挂载完成，通知插件系统（不使用 DANMAKU_TOGGLE，那是切换弹幕可见性的事件）
              },
              onShowDmTip: (data: {
                event: MouseEvent;
                element: HTMLElement;
              }) => {
                lifecycle.emit?.("showDmTip", data);
                // Bridge to Dialog's showDmTip
                dialogApi.showDmTip?.(
                  {
                    content: data.element?.textContent ?? "",
                    timePoint: readCurrentTime(),
                  },
                  data.element,
                );
              },
              onHideDmTip: (data: { element: HTMLElement }) => {
                lifecycle.emit?.("hideDmTip", data);
                // Bridge to Dialog's hideDmTip
                dialogApi.hideDmTip?.(data.element);
              },
            }),
          ),
          // 播放状态层（缓冲图标 / 「正在缓冲... <速度>」/ 暂停时的中央播放图标）
          // 由 stateMounted 回传 API，经 state 订阅（player.isLoading / player.state）
          // 命令式更新；缓冲速度为 0（无有效数据）时速度文本自动隐藏
          h(State, {
            buffering: stateMgr?.get(PlayerStateKeyEnum.IS_LOADING) ?? false,
            onStateMounted: (api: StateAPI) => {
              Object.assign(stateApi, api);
              // 订阅回调早于 State 挂载时补一次同步（缓冲中直接进入对应显示态）
              if (stateMgr?.get(PlayerStateKeyEnum.IS_LOADING) ?? false) {
                stateApi.showBuffering?.();
                setBufferSpeedSampling(true);
              }
            },
          }),
          // 互动容器（按需渲染：未装 interaction 插件时不挂载交互层 DOM）
          h(
            Show,
            { when: (): boolean => hasPlugin("interaction") },
            h(InteractionLayer, {
              showLines: false,
              onInteractionLayerMounted: (data: InteractionLayerAPI) => {
                interactionApi.container = data.container;
                lifecycle.emit?.("interactionLayerMounted", data);
                props.events?.emit("interactionLayerMounted", data);
              },
            }),
          ),
          // 顶部栏（标题 / 关注 / 问题反馈，既有实现挂载于视频区域；
          // ui.title 动态更新时由 configStore 订阅驱动 setTitle）
          h("div", { class: "nova-player-top-wrap", ref: "topRootRef" }),
          // 外链场景：相关推荐条与 Top 同级，跟随控制栏显隐
          embeddedMode
            ? h(RelationStrip, {
                related: embeddedConfig?.related,
                onSelect: (item) => {
                  if (item.url) openEmbeddedUrl(item.url);
                },
              })
            : null,
          // 字幕容器（按需渲染：未装 subtitle 插件时不挂载字幕层 DOM）
          // 位于 Top 容器与 Ending 容器之间；定位规则全部由
          // subtitlelayer.scss 纯 CSS 派生（档位 data-position /
          // 偏移 --subtitle-offset / 控制栏抬升 .nova-player-container
          // 属性选择器）
          h(
            Show,
            { when: (): boolean => hasPlugin("subtitle") },
            h(SubtitleLayer, {
              visible: true,
              onSubtitleLayerMounted: (data: SubtitleLayerAPI) => {
                subtitleApi.subtitleWrap = data.subtitleWrap;
                subtitleApi.setFontSize = data.setFontSize;
                subtitleApi.setColor = data.setColor;
                subtitleApi.setBackgroundColor = data.setBackgroundColor;
                subtitleApi.setPosition = data.setPosition;
                lifecycle.emit?.("subtitleLayerMounted", data);
              },
            }),
          ),
          // 对话框容器
          h(Dialog, {
            onDialogMounted: (data: DialogAPI) => {
              dialogApi.dialogWrap = data.dialogWrap;
              dialogApi.showDmTip = data.showDmTip;
              dialogApi.hideDmTip = data.hideDmTip;
              lifecycle.emit?.("dialogMounted", data);
            },
          }),
          // 自动提示（清晰度切换成功 / 失败）
          h(Toast, {
            onToastMounted: (api: ToastAPI) => {
              toastApi.showAutoToast = api.showAutoToast;
              toastApi.hideAutoToast = api.hideAutoToast;
              toastApi.showFixedToast = api.showFixedToast;
              toastApi.hideFixedToast = api.hideFixedToast;
              toastApi.showToast = api.showToast;
            },
          }),
          // 加载遮罩（清晰度切换中）
          h(Loading, {
            onLoadingMounted: (api: LoadingAPI) => {
              loadingApi.show = api.show;
              loadingApi.hide = api.hide;
              loadingApi.setText = api.setText;
            },
          }),
          // 色彩调整面板 / 视频统计信息面板 / 快捷键说明面板：
          // 改为按需懒挂载（见上方 ensurePanel，既有实现的懒创建模式），
          // 首次通过右键菜单打开时才创建，不再常驻渲染
          // 片尾推荐面板（默认隐藏，播放结束时显示、重新播放时隐藏；
          // 推荐列表无真实数据源，仅渲染面板结构）
          h(
            "div",
            {
              class:
                endingStyle === "ogv"
                  ? "nova-player-ending-wrap nova-ogv-ending-wrap"
                  : endingStyle === "interactive"
                    ? "nova-player-ending-wrap nova-interactive-ending-wrap"
                    : embeddedMode
                      ? "nova-player-ending-wrap nova-player-embedded-ending-wrap"
                      : "nova-player-ending-wrap",
              ref: "endingRootRef",
            },
          ),
          // 迷你播放器面板（默认隐藏，播放器滚出视口进入迷你模式时由
          // data-screen="mini" 的样式规则显示；关闭 / 状态切换回调向上处理）
          h(Mini, {
            onClose: () => {
              // 关闭迷你窗口 → 退出迷你模式（与既有实现 close-mini 一致）
              exitMiniPlayer();
            },
            onStateChange: () => {
              togglePlayPause();
            },
            onMiniMounted: (api: MiniApi & { wrap?: HTMLElement | null }) => {
              Object.assign(miniApi, api);
              // 持有迷你窗口元素，用于绑定拖拽（与既有实现 playerMiniWarp.onmousedown 一致）
              if (api.wrap && !miniWarpEl) {
                miniWarpEl = api.wrap;
                miniWarpEl.addEventListener("mousedown", handleMiniDragDown);
              }
            },
          }),
          // 互动视频层容器（仅一个空的 .nova-player-interaction-wrap，
          // 剧情进度条 / 分支选择等内容由互动视频插件注入；位于控制栏之前。
          // 按需渲染：未装 interactiveVideo 插件时不挂载该空容器）
          h(
            Show,
            { when: (): boolean => hasPlugin("interactiveVideo") },
            h(InteractiveVideoLayer, {
              onInteractiveVideoLayerMounted: (data: InteractiveVideoLayerAPI) => {
                interactiveVideoApi.wrap = data.wrap;
                lifecycle.emit?.("interactiveVideoLayerMounted", data);
                props.events?.emit("interactiveVideoLayerMounted", data);
              },
            }),
          ),
          // 视频控制栏
          h(Controls, {
            duration: readDuration(),
            volume: readVolume(),
            backrate: readBackrate(),
            scene: embeddedMode ? "embedded" : "station",
            /** 插件安装标志读取器：字幕按钮按 subtitle 标志显隐（getter 本体透传给 SubtitleMenu） */
            plugins: props.plugins,
            previewProvider: props.previewProvider,
            energyProvider: props.energyProvider,
            skipPoints: props.config?.progress?.skipPoints,
            // ===== 控件条交互接线（设计文档阶段 J）=====
            // 控制栏挂载完成：持有其操作 API（时间/音量/缓冲等显示更新的入口）
            onControlsMounted: (api: ControlsAPI) => {
              Object.assign(controlsApi, api);
              props.player?.attachControlsApi?.(api);
            },
            // 播放 / 暂停
            onPlayPause: togglePlayPause,
            // 进度跳转与拖拽
            onSeek: seekTo,
            onSeekStart: () => {
              props.events?.emit(PlayerEventEnum.SEEK_START, {
                time: readCurrentTime(),
                previousTime: readCurrentTime(),
              });
            },
            onSeekEnd: () => {
              props.events?.emit(PlayerEventEnum.SEEK_END, {
                time: readCurrentTime(),
                previousTime: readCurrentTime(),
              });
            },
            // 音量 / 静音 / 倍速
            onVolumeChange: setVolume,
            onMuteToggle: toggleMute,
            onBackrateChange: applyPlaybackRate,
            // 画面模式
            onFullscreenToggle: toggleFullscreen,
            onPipToggle: togglePip,
            // 网页全屏按钮
            onWebFullscreenToggle: toggleWebFullscreen,
            // 宽屏按钮：只更新状态 + 广播 wideScreenChange，布局交给外部容器
            onWideToggle: toggleWide,
            // 分 P 切换：向上交给 VideoPlayer 的 prev() / next() / switchTo()
            onPrev: () => {
              lifecycle.emit?.("prev");
            },
            onNext: () => {
              lifecycle.emit?.("next");
            },
            // 选集面板选择某一集：透传列表下标，由 VideoPlayer 调 switchTo() 切集
            onEplistChange: (index: number) => {
              lifecycle.emit?.("eplistChange", index);
            },
            // 字幕设置面板：即时应用到字幕层 + 向上转发（由 VideoPlayer 落地）
            onSubtitleToggle: (visible: boolean) => {
              lifecycle.emit?.("subtitleToggle", visible);
            },
            onSubtitleLangChange: (lang: string) => {
              lifecycle.emit?.("subtitleLangChange", lang);
            },
            onSubtitleStyleChange: (patch: {
              fontSize?: number;
              color?: string;
              position?: "top" | "bottom";
              offset?: number;
              strokeColor?: string;
              strokeWidth?: number;
              opacity?: number;
              scale?: boolean;
              fade?: boolean;
            }) => {
              // 全部向上转发，由 VideoPlayer 落到字幕插件真实 API
              // （插件对字幕文本元素有唯一 inline 样式所有权，
              // 层级即时反馈会被插件样式覆盖，不再在此重复应用）
              lifecycle.emit?.("subtitleStyleChange", patch);
            },
            onBilingualChange: (enabled: boolean) => {
              lifecycle.emit?.("bilingualChange", enabled);
            },
            // 设置菜单：向上转发，由 VideoPlayer 统一应用
            onSettingChange: (payload: {
              key: string;
              value: boolean | string | number;
            }) => {
              lifecycle.emit?.("settingChange", payload);
            },
            onMoreSettingClick: () => {
              lifecycle.emit?.("moreSettingClick");
            },
            // tooltip / 状态变化：接通 Tooltips 组件并向上转发
            onShowTooltip: handleShowTooltip,
            onHideTooltip: handleHideTooltip,
            onStateChange: (payload: unknown) => {
              lifecycle.emit?.("stateChange", payload);
            },
            // 清晰度切换：向上暴露给 VideoPlayer，由其转发给流媒体中间件 / 插件
            onQualityChange: (quality: string) => {
              lifecycle.emit?.("qualityChange", quality);
            },
            // 顶部进度条挂载完成，持有其更新 API（timeupdate / progress 时调用）
            onProgressBarMounted: (api: ProgressBarApi) => {
              progressBarApi.updateProgress = api.updateProgress;
              progressBarApi.updateBuffer = api.updateBuffer;
              progressBarApi.setDuration = api.setDuration;
              progressBarApi.rebuildSegments = api.rebuildSegments;
            },
          }),
          // 错误面板（视频区域内最后一个容器：加载 / 播放失败时覆盖整个播放器；
          // 显隐由上方 setupErrorEventSubscriptions 订阅 ERROR / ERROR_RECOVERY 驱动）
          h(ErrorSign, {
            onErrorSignMounted: (api: ErrorSignAPI) => {
              errorSignApi.show = api.show;
              errorSignApi.hide = api.hide;
            },
            // 点击「刷新」按钮 → 上抛 retry 事件（由 VideoPlayer 落地为 reload()）
            onRetry: () => {
              lifecycle.emit?.("retry");
            },
          }),
        ),
        // 发送区域（弹幕输入栏，既有实现+ sendbar 挂载方式：
        // .nova-player-sending-area > .nova-player-sending-bar。
        // 按需渲染：未装 danmaku 插件时整个发送区域不挂载——
        // 连容器一起省掉，避免空 sending-area 撑高播放器底部布局）
        h(
          Show,
          { when: (): boolean => hasPlugin("danmaku") || embeddedMode },
          h(
            "div",
            {
              class: "nova-player-sending-area",
              ref: "playerSendingAreaRef",
            },
            h(SendBar, {
            // 弹幕开关初始状态来自运行时状态（与设置面板共享同一状态源）
            danmakuSwitch:
              stateMgr?.get(PlayerStateKeyEnum.DANMAKU_VISIBLE) ?? true,
            placeholder: embeddedMode
              ? t("player.ui.embed.send_placeholder")
              : undefined,
            // 输入框聚焦 / 失焦：维护 isSendFocus，供 mouseleave 豁免判断
            onInputFocus: () => {
              isSendFocus = true;
              // 聚焦输入时保持控制栏显示、取消自动隐藏（既有实现 input-focus 行为）
              showControls("control");
            },
            onInputBlur: () => {
              isSendFocus = false;
            },
            // 弹幕开关：写运行时状态（唯一数据源，插件订阅后自动应用）
            // 注意：不再向上发 danmakuToggle lifecycle 事件——
            // VideoPlayer 的该事件处理器是 toggle 语义，会把刚写入的值再翻转一次
            onDanmakuSwitch: (checked: boolean) => {
              stateMgr?.set(PlayerStateKeyEnum.DANMAKU_VISIBLE, checked);
              props.events?.emit(PlayerEventEnum.DANMAKU_TOGGLE, {
                visible: checked,
              });
            },
            // 发送弹幕：向上转发文本，同时广播「提交请求」事件（DANMAKU_SEND）
            // 注意：DANMAKU_SENT 的语义是「发送成功」，由 DanmakuPlugin 在服务器确认后发出；
            // 此处只是提交请求，若在此发 DANMAKU_SENT 会把「提交」误当成「成功」。
            onSendDanmaku: (text: string) => {
              props.events?.emit(PlayerEventEnum.DANMAKU_SEND, { text });
              lifecycle.emit?.("sendDanmaku", text);
            },
            // 弹幕开关提示气泡：与控制栏 tooltip 走同一通道（接通 Tooltips 组件）
            onShowTooltip: handleShowTooltip,
            onHideTooltip: handleHideTooltip,
            // 持有 SendBar 控制方法（setInputValue / focusInput 等）
            onSendBarMounted: (api: SendBarAPI) => {
              Object.assign(sendBarApi, api);
            },
          }),
          ),
        ),
      ),
      // 外链场景：右上角「进入哔哩哔哩」胶囊按钮
      // 外链暂停页的进入观看入口由 RelationStrip 统一渲染（卡片上方），
      // 不再额外渲染居中的重复胶囊按钮。
      // 按钮悬停提示工具（既有实现挂载于 .nova-player-container：
      // new Tooltips(this.playerContainer!)；Controls / SendBar / Top 的
      // tooltip 事件经 handleShowTooltip / handleHideTooltip 接通至此）
      h(Tooltips, {
        onTooltipsMounted: (api: {
          openTip: (btnElement: HTMLElement | null, name: string) => void;
          closeTip: (name: string) => void;
          updateTip: (name: string, text: string) => void;
          updateTipKey: (name: string, key: string) => void;
          setScreen: (screen: "normal" | "full" | "web") => void;
          hideAll: () => void;
        }) => {
          Object.assign(tooltipsApi, api);
        },
      }),
      // 右键菜单（默认隐藏，右键视频区域时在鼠标位置显示）
      h(ContextMenu, {
        audioEnabled: hasPlugin("audioEffect"),
        onContextMounted: (api: {
          showMenu: (x: number, y: number) => void;
          hideMenu: () => void;
        }) => {
          contextApi.showMenu = api.showMenu;
          contextApi.hideMenu = api.hideMenu;
        },
        onOpenPanel: (panel: "color" | "audio" | "keyboard" | "info") => {
          // 面板按需懒挂载：首次打开才创建（既有实现的懒创建模式），之后复用
          ensurePanel(panel);
          // 「视频色彩调整」菜单项 → 打开色彩调整面板
          if (panel === "color") {
            colorPanelApi.open?.();
          }
          // 「音效调节」菜单项 → 打开音效面板
          if (panel === "audio") {
            audioPanelApi.open?.();
          }
          // 「快捷键说明」菜单项 → 打开快捷键面板
          if (panel === "keyboard") {
            hotkeyPanelApi.open?.();
          }
          // 「视频统计信息」菜单项 → 打开统计信息面板
          if (panel === "info") {
            videoInfoApi.open?.();
          }
        },
      }),
    ),
  );
});

export default PlayerDocker;
