/**
 * ============================================
 * 右侧控制按钮组件 (RightControls)
 * ============================================
 */

import {
  h,
  defineComponent,
  useTemplateRef,
  useReactiveState,
  useContext,
  signal,
  computed,
  onEffect,
  mount,
  destroy,
  t,
} from "@/core";
import type { VNode } from "@/types";
import type { PlayerPluginFlags } from "./PlayerDocker";
import { PlayerStateKeyEnum, ConfigContext } from "@/store/runtimeState";
import { StateContext } from "@/store/runtimeState";
import { ConfigStoreContext } from "@/store/configStore";
import { VolumeSlider } from "./VolumeSlider";
import { QualityMenu } from "./QualityMenu";
import { PlaybackRateMenu } from "./PlaybackRateMenu";
import { SettingMenu } from "./SettingMenu";
import { EpisodesMenu } from "./EpisodesMenu";
import { SubtitleMenu } from "./SubtitleMenu";
import type { SubtitleStylePatch } from "./SubtitleMenu";
import type { EpisodeOption } from "./EpisodesMenu";
import { LottieIcon, type LottieIconApi } from "./LottieIcon";
import { HiRes } from "./icons";
import fullscreenAnimationData from "../assets/lottie-icon/fullscreen-animation.json";
import webFullscreenAnimationData from "../assets/lottie-icon/web-fullscreen-animation.json";
import webExitFullscreenAnimationData from "../assets/lottie-icon/web-exit-fullscreen-animation.json";
import wideHoverAnimationData from "../assets/lottie-icon/wide-hover-animation.json";
import wideExitHoverAnimationData from "../assets/lottie-icon/wide-exit-hover-animation.json";
import pipHoverAnimationData from "../assets/lottie-icon/pip-hover-animation.json";
import pipExitHoverAnimationData from "../assets/lottie-icon/pip-exit-hover-animation.json";

/**
 * RightControls 组件 Props 接口
 */
export type RightControlsEvents = {
  fullscreen: undefined;
  webFullscreen: undefined;
  pip: undefined;
  wide: undefined;
  mute: undefined;
  backrateChange: number;
  volumeChange: number;
  muteToggle: undefined;
  qualityChange: string;
  /** 选集面板选择某一集，值为列表下标（透传 EpisodesMenu 的 episodeChange） */
  eplistChange: number;
  /** 字幕开关变化 */
  subtitleToggle: boolean;
  /** 字幕语言切换 */
  subtitleLangChange: string;
  /** 字幕样式变化（只带变化字段） */
  subtitleStyleChange: SubtitleStylePatch;
  /** 双语字幕开关变化 */
  bilingualChange: boolean;
  settingChange: { key: string; value: boolean | string | number };
  moreSettingClick: undefined;
  rightControlsMounted: undefined;
};

export interface RightControlsProps {
  /** 播放场景：embedded 时仅保留清晰度 / 倍速 / 音量 / 全屏 */
  scene?: "station" | "embedded";
  /** 是否显示 Hi-Res 无损音质标识（播放器能力检测后传入） */
  hiRes?: boolean;
  /**
   * 插件安装标志读取器（getter 形态，Controls 透传）：
   * 字幕按钮按 subtitle 标志显隐，未装 subtitle 插件时整体不显示
   */
  plugins?: () => PlayerPluginFlags;
}

/**
 * RightControls 组件 - 使用 defineComponent 创建独立组件
 */
export const RightControls = defineComponent<
  RightControlsProps,
  RightControlsEvents
>((props, lifecycle) => {
  const configCtx = useContext(ConfigContext);
  const config = configCtx;
  const state = useContext(StateContext);
  /** 可订阅配置中心（由 VideoPlayer 注入），用于控件开关「设置即生效」 */
  const configStore = useContext(ConfigStoreContext);

  // ============================================
  // 响应式 Signal（useReactiveState 返回 Signal，读取 .value 自动建立依赖）
  // ============================================

  /** State signals for button active state (useReactiveState returns Signal) */
  const isFullscreenSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.IS_FULLSCREEN, lifecycle)
    : signal<unknown>(undefined);
  const isWebFullscreenSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.IS_WEB_FULLSCREEN, lifecycle)
    : signal<unknown>(undefined);
  const isPipSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.IS_PIP, lifecycle)
    : signal<unknown>(undefined);
  const isWideSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.IS_WIDE_SCREEN, lifecycle)
    : signal<unknown>(undefined);

  /** Playlist signals for eplist visibility and rebuild */
  const playlistSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.PLAYLIST, lifecycle)
    : signal<unknown>(undefined);
  const playlistLengthSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.PLAYLIST_LENGTH, lifecycle)
    : signal<unknown>(undefined);
  const playlistIndexSignal = state
    ? useReactiveState(state, PlayerStateKeyEnum.PLAYLIST_INDEX, lifecycle)
    : signal<unknown>(undefined);

  /** Config signals for button visibility (configStore path values wrapped in signal) */
  const qualityConfigSignal = signal<boolean>(true);
  const episodesConfigSignal = signal<boolean>(true);
  const settingConfigSignal = signal<boolean>(true);
  const pipConfigSignal = signal<boolean>(true);
  const wideConfigSignal = signal<boolean>(true);
  const webConfigSignal = signal<boolean>(true);
  const fullscreenConfigSignal = signal<boolean>(true);

  // ============================================
  // 控件开关 → 显隐（ui.controls.*）
  // ============================================
  // 全部按钮显隐均为响应式 props 协议：
  //   - pip/wide/web/full 为本地 VNode，响应式 class + style 直接绑定
  //   - quality/eplist/setting 为独立组件，父层把 config signal 经
  //     visible（及 eplist 的 hasPlaylist）prop 传入，组件内部
  //     props 惰性代理读取穿透建立依赖并单一来源管理自身 display（见各组件）

  /** 配置订阅清理函数 */
  const configCleanups: Array<() => void> = [];

  // 运行时可用清晰度列表：初始快照由 QualityMenu 内部订阅后续变化
  const qualities = state?.get(PlayerStateKeyEnum.AVAILABLE_QUALITIES) ?? [];
  const currentQuality = state?.get(PlayerStateKeyEnum.QUALITY) ?? "auto";
  const rate = state?.get(PlayerStateKeyEnum.PLAYBACK_RATE) ?? 1;
  const rates = [2, 1.5, 1.25, 1, 0.75, 0.5];

  const onQualityChange = (quality: string): void => {
    lifecycle.emit?.("qualityChange", quality);
  };
  const onRateChange = (r: number): void => {
    lifecycle.emit?.("backrateChange", r);
  };
  const onSettingChange = (payload: {
    key: string;
    value: boolean | string | number;
  }): void => {
    lifecycle.emit?.("settingChange", payload);
  };
  /** 音量滑块拖拽 / 点击调量事件桥接（VolumeSlider 以单个数值发射） */
  const onVolumeChange = (volume: number): void => {
    lifecycle.emit?.("volumeChange", volume);
  };

  /** 音量图标点击静音切换事件桥接 */
  const onMuteToggle = (): void => {
    lifecycle.emit?.("muteToggle");
  };

  // ============================================
  // 选集面板（EpisodesMenu）数据与事件桥接
  // ============================================

  /** 选集列表（首帧快照来自运行时状态；后续变化由下方订阅刷新并重建面板） */
  let episodes: EpisodeOption[] = state?.get(PlayerStateKeyEnum.PLAYLIST) ?? [];
  /** 当前集下标（首帧快照；切集后的高亮由 EpisodesMenu 内部订阅同一状态键维护） */
  let currentIndex: number = state?.get(PlayerStateKeyEnum.PLAYLIST_INDEX) ?? 0;
  /** 选集面板组件节点（列表真正变化时据此原地重建） */
  let eplistVNode: VNode | null = null;

  /**
   * 列表内容签名：用于判断 PLAYLIST 通知是否真的换了列表
   * （切集时 VideoPlayer 会重写 PLAYLIST，但内容不变，此时不应重建面板）
   * @param list - 选集列表
   * @returns 内容签名
   */
  const episodesKey = (list: EpisodeOption[]): string =>
    list
      .map((item) => `${item.index}:${item.id ?? ""}:${item.title ?? ""}`)
      .join("|");

  /** 当前面板节点对应的列表签名 */
  let eplistKey = episodesKey(episodes);

  /** 播放列表长度读取辅助（类型守卫收窄，替代 as 断言） */
  const readPlaylistLength = (): number => {
    const raw = playlistLengthSignal.value;
    return typeof raw === "number" ? raw : 0;
  };

  /**
   * eplist 是否有播放列表（长度 > 1）派生信号
   * 经 hasPlaylist prop 传入 EpisodesMenu，驱动其根节点 nova-player-has-playlist 类
   * （响应式 class，替代旧的 querySelector + classList.toggle 命令式写入）；
   * 无状态管理器场景保持 false（与旧 effect 仅在有 state 时生效的语义一致）
   */
  const eplistHasPlaylistSignal = computed(() =>
    state ? readPlaylistLength() > 1 : false,
  );

  /**
   * eplist 显隐派生信号：列表长度 > 1 且配置开启
   * 经 visible prop 传入 EpisodesMenu，display 由其根节点响应式 style 单一来源管理
   * （替代旧的 querySelector 直写 display）；
   * 无状态管理器场景保持可见（与旧 effect 仅在有 state 时生效、默认显示的语义一致）
   */
  const eplistVisibleSignal = computed(() =>
    state ? readPlaylistLength() > 1 && episodesConfigSignal.value : true,
  );

  /** 选集面板点击某一集：下标向上抛，最终落到 VideoPlayer.switchTo(index) */
  const onEpisodeChange = (index: number): void => {
    lifecycle.emit?.("eplistChange", index);
  };

  /** 字幕面板：开关 */
  const onSubtitleToggle = (visible: boolean): void => {
    lifecycle.emit?.("subtitleToggle", visible);
  };

  /** 字幕面板：语言切换 */
  const onSubtitleLangChange = (lang: string): void => {
    lifecycle.emit?.("subtitleLangChange", lang);
  };

  /** 字幕面板：样式项变化（只带变化字段） */
  const onSubtitleStyleChange = (patch: SubtitleStylePatch): void => {
    lifecycle.emit?.("subtitleStyleChange", patch);
  };

  /** 字幕面板：双语开关 */
  const onBilingualChange = (enabled: boolean): void => {
    lifecycle.emit?.("bilingualChange", enabled);
  };

  /**
   * 创建选集面板节点
   *
   * 显式注入 StateContext：运行期重建发生在渲染栈之外（状态订阅回调里），
   * 组件沿 __parent 链取不到 Provider（与 PlayerDocker 懒挂载面板同一处理）。
   * @returns EpisodesMenu 组件节点
   */
  const createEplistVNode = (): VNode =>
    h(EpisodesMenu, {
      episodes,
      currentIndex,
      onEpisodeChange,
      // 显隐 / has-playlist 类为响应式 props（组件内部单一来源管理）
      visible: eplistVisibleSignal,
      hasPlaylist: eplistHasPlaylistSignal,
      __providers: state
        ? [{ contextId: StateContext.id, value: state }]
        : undefined,
    });

  /**
   * 原地重建选集面板（列表数据真正变化时调用）
   *
   * 框架无虚拟 DOM diff：EpisodesMenu 的 episodes 是 props 快照，
   * 仅靠订阅拿不到新列表，只能销毁旧实例再挂载新实例。
   * mount 只能追加到容器末尾，故挂载后立刻 insertBefore 插回原位置，
   * 保证选集按钮在右侧控制栏中的顺序不变。
   */
  const rebuildEplist = (): void => {
    const oldEl = eplistVNode?.el;
    const host = (oldEl?.parentNode ?? null) as HTMLElement | null;
    if (!eplistVNode || !oldEl || !host) return; // 尚未挂载：首帧渲染自带最新数据

    const anchor = oldEl.nextSibling;
    destroy(eplistVNode);

    const next = createEplistVNode();
    eplistVNode = next;

    mount(next, host);
    if (next.el) {
      host.insertBefore(next.el, anchor);
    }
  };

  // ============================================
  // 事件处理函数
  // ============================================

  /**
   * 切换全屏状态
   */
  const toggleFullscreen = (): void => {
    lifecycle.emit?.("fullscreen");
  };

  /**
   * 切换网页全屏状态
   */
  const toggleWebFullscreen = (): void => {
    lifecycle.emit?.("webFullscreen");
  };

  /**
   * 切换画中画状态
   */
  const togglePip = (): void => {
    lifecycle.emit?.("pip");
  };

  /**
   * 切换宽屏状态
   */
  const toggleWide = (): void => {
    lifecycle.emit?.("wide");
  };

  /** 全屏按钮 API 引用 */
  const fullscreenRef = useTemplateRef<LottieIconApi>(
    lifecycle,
    "fullscreenRef",
  );
  /** 网页全屏按钮 API 引用 */
  const webFullscreenRef = useTemplateRef<LottieIconApi>(
    lifecycle,
    "webFullscreenRef",
  );
  /** 宽屏按钮 API 引用 */
  const wideRef = useTemplateRef<LottieIconApi>(lifecycle, "wideRef");
  /** 画中画按钮 API 引用 */
  const pipRef = useTemplateRef<LottieIconApi>(lifecycle, "pipRef");

  // ============================================
  // 状态图标同步（pip / web 全屏 / 宽屏）
  // ============================================
  // 槽位约定：sequence[0] = 未激活态动画，sequence[1] = 已激活（退出）态动画。
  // 三个按钮的 slot 都是 autoplay:false，setSequenceSlot 会重建动画并停在
  // 该槽位第一帧——正好满足「切换后默认留在第一帧」；hover 才 play()。
  // 与 LeftControls 播放/暂停的区别：那边状态切换要播过渡动画（play），
  // 这里状态切换只换槽位、不播。

  /** 状态值 → 目标槽位（激活态用退出图标） */
  function resolveSlot(isActive: unknown): number {
    return Boolean(isActive) ? 1 : 0;
  }

  /**
   * 把画中画图标同步到当前状态槽位（不播放，停在第一帧）
   *
   * 同时用于三处：状态 effect、hover 移出复位、lottie 异步就绪后的补同步。
   */
  function syncPipIcon(): void {
    pipRef.value?.setSequenceSlot(resolveSlot(isPipSignal.value));
  }

  /** 把网页全屏图标同步到当前状态槽位（不播放，停在第一帧） */
  function syncWebFullscreenIcon(): void {
    webFullscreenRef.value?.setSequenceSlot(
      resolveSlot(isWebFullscreenSignal.value),
    );
  }

  /** 把宽屏图标同步到当前状态槽位（不播放，停在第一帧） */
  function syncWideIcon(): void {
    wideRef.value?.setSequenceSlot(resolveSlot(isWideSignal.value));
  }

  /**
   * 全屏悬悬停事件处理函数
   */
  const mouseFullscreenEnter = (): void => {
    fullscreenRef.value?.play();
  };

  /**
   * 全屏悬停事件处理函数
   */
  const mouseFullscreenLeave = (): void => {};

  /**
   * 网页全屏悬悬停事件处理函数
   */
  const mouseWebEnter = (): void => {
    webFullscreenRef.value?.play();
  };

  /**
   * 网页全屏悬停事件处理函数
   * 移出后复位到当前状态槽位第一帧（hover 动画 complete 停在末帧，
   * 不复位会与「默认第一帧」的状态图标不一致）
   */
  const mouseWebLeave = (): void => {
    syncWebFullscreenIcon();
  };

  /**
   * 宽屏悬悬停事件处理函数
   */
  const mouseWideEnter = (): void => {
    wideRef.value?.play();
  };

  /**
   * 宽屏悬停事件处理函数
   * 移出后复位到当前状态槽位第一帧
   */
  const mouseWideLeave = (): void => {
    syncWideIcon();
  };

  /**
   * 画中画悬悬停事件处理函数
   */
  const mousePipEnter = (): void => {
    pipRef.value?.play();
  };

  /**
   * 画中画悬停事件处理函数
   * 移出后复位到当前状态槽位第一帧
   */
  const mousePipLeave = (): void => {
    syncPipIcon();
  };

  // ============================================
  // 状态监听（响应式系统：useReactiveState + onEffect）
  // ============================================
  // useContext(StateContext) 从最近的 Provider 获取状态管理器实例
  // useReactiveState 返回 Signal，在 onEffect 内读取 .value 自动建立依赖
  // signal 变化时 effect 自动重跑，精准更新对应 DOM（不重渲染组件）

  if (state) {
    /**
     * Playlist content change → rebuild eplist panel
     * Only rebuild when content actually changes (checked via episodesKey)
     * 保留命令式：mount/destroy 重建面板是复杂场景（框架无 vdom diff）
     */
    onEffect(lifecycle, () => {
      const list = playlistSignal.value as EpisodeOption[] | undefined;
      if (!list) return;
      const nextKey = episodesKey(list);
      if (nextKey === eplistKey) return;
      episodes = list;
      eplistKey = nextKey;
      rebuildEplist();
    });

    /** Playlist index change → update currentIndex snapshot（仅更新变量，不操作 DOM） */
    onEffect(lifecycle, () => {
      const index = playlistIndexSignal.value;
      if (typeof index === "number") currentIndex = index;
    });

    /**
     * 画中画状态 → 图标槽位（状态驱动，只切槽位停第一帧，不播放）
     *
     * 与 LeftControls 的播放/暂停通道相同（useReactiveState + onEffect +
     * LottieIcon 命令 API），但动作不同：那边状态变化要播放过渡动画，
     * 这里状态变化只把图标切到目标槽位并停在第一帧，hover 才播放。
     */
    onEffect(lifecycle, () => {
      const isPip = isPipSignal.value;
      pipRef.value?.setSequenceSlot(resolveSlot(isPip));
    });

    /** 网页全屏状态 → 图标槽位（停第一帧，hover 才播放） */
    onEffect(lifecycle, () => {
      const isWeb = isWebFullscreenSignal.value;
      webFullscreenRef.value?.setSequenceSlot(resolveSlot(isWeb));
    });

    /** 宽屏状态 → 图标槽位（停第一帧，hover 才播放） */
    onEffect(lifecycle, () => {
      const isWide = isWideSignal.value;
      wideRef.value?.setSequenceSlot(resolveSlot(isWide));
    });
  }

  // ============================================
  // 底部右侧按钮渲染器映射表
  // ============================================

  /** 按钮类型到渲染函数的映射表，每个键对应一种控制按钮的渲染逻辑 */
  const bottomRightRenderers: Record<string, () => VNode | null> = {
    /** 渲染 Hi-Res 无损音质标识 */
    flac: () => {
      if (props.hiRes === false) return null;
      return h(
        "div",
        {
          class: "nova-player-ctrl-btn nova-player-ctrl-flac",
          role: "img",
          "aria-label": t("player.ui.controls.hires"),
          title: t("player.ui.controls.hires"),
        },
        h(
          "div",
          {
            class: "nova-player-ctrl-btn-icon",
          },
          h(HiRes),
        ),
      );
    },
    /** 渲染画质选择菜单（visible 经响应式 prop 传入，display 由其根节点单一来源管理） */
    quality: () => {
      return h(QualityMenu, {
        qualities,
        currentQuality,
        onQualityChange,
        visible: qualityConfigSignal,
      });
    },
    /** 渲染选集菜单（列表数据 / 当前集高亮由 EpisodesMenu 内部订阅运行时状态维护） */
    eplist: () => {
      eplistVNode = createEplistVNode();
      return eplistVNode;
    },
    /** 渲染播放速率选择菜单 */
    playbackrate: () => h(PlaybackRateMenu, { rate, rates, onRateChange }),
    /** 渲染字幕设置面板（开关 / 语言 / 字号颜色位置等 / 双语） */
    subtitle: () => {
      /** 字幕样式初值（面板内部会按用户操作命令式更新） */
      const subtitleStyle = {
        fontSize: 0,
        color: "#ffffff",
        position: "bottom" as const,
        offset: 0,
        strokeColor: "none",
        strokeWidth: 0,
        opacity: 0.87,
        scale: false,
        fade: false,
      };
      return h(SubtitleMenu, {
        /** 插件安装标志读取器透传：未装 subtitle 插件时按钮整体隐藏 */
        plugins: props.plugins,
        visible: state?.get(PlayerStateKeyEnum.SUBTITLE_VISIBLE) ?? false,
        lang: state?.get(PlayerStateKeyEnum.SUBTITLE_LANG) ?? "",
        // 语言列表：播放器暂无对应运行时状态键；由使用方通过配置提供，缺省为空数组
        languages:
          configStore?.getPath<
            { lang: string; label: string; isDefault?: boolean }[]
          >("subtitle.list") ?? [],
        style: subtitleStyle,
        onSubtitleToggle,
        onSubtitleLangChange,
        onSubtitleStyleChange,
        onBilingualChange,
      });
    },
    /** 渲染音量滑块组件（hover 展开 / 拖拽调量 / 静音切换） */
    volume: () => h(VolumeSlider, { onVolumeChange, onMuteToggle }),
    /** 渲染设置菜单（visible 经响应式 prop 传入，display 由其根节点单一来源管理） */
    setting: () => {
      return h(SettingMenu, {
        onSettingChange,
        visible: settingConfigSignal,
        /** 插件安装标志读取器透传：未装 audioEffect 插件时第二页音频设置区块不渲染 */
        plugins: props.plugins,
      });
    },
    /** 渲染画中画按钮（state-active 由 isPipSignal 驱动，style.display 由 pipConfigSignal 驱动） */
    pip: () => {
      return h(
        "div",
        {
          class: [
            "nova-player-ctrl-btn nova-player-ctrl-pip",
            { "state-active": Boolean(isPipSignal.value) },
          ],
          style: { display: pipConfigSignal.value ? "" : "none" },
          role: "button",
          "aria-label": t("player.ui.controls.pip"),
          // 响应式迁移后显隐/激活态由响应式 class+style 驱动，不再需要按钮根节点引用（删除残留 ref，避免运行时未注册告警）
          onClick: togglePip,
          onMouseEnter: mousePipEnter,
          onMouseLeave: mousePipLeave,
        },
        h(
          "div",
          { class: "nova-player-ctrl-btn-icon" },
          h(LottieIcon, {
            name: "pip",
            sequence: [
              {
                animationData: pipHoverAnimationData,
                complete: "stop",
                autoplay: false,
              },
              {
                animationData: pipExitHoverAnimationData,
                complete: "stop",
                autoplay: false,
              },
            ],
            // 初始槽位按挂载时的状态快照选择；lottie 异步就绪后再经
            // onReady 补同步一次，覆盖「挂载即已激活」与加载时序空窗
            initialSlotIndex: resolveSlot(isPipSignal.value),
            onReady: syncPipIcon,
            ref: "pipRef",
          }),
        ),
      );
    },
    /** 渲染宽屏按钮（state-active 由 isWideSignal 驱动，style.display 由 wideConfigSignal 驱动） */
    wide: () => {
      return h(
        "div",
        {
          class: [
            "nova-player-ctrl-btn nova-player-ctrl-wide",
            { "state-active": Boolean(isWideSignal.value) },
          ],
          style: { display: wideConfigSignal.value ? "" : "none" },
          role: "button",
          "aria-label": t("player.ui.controls.widescreen"),
          // 响应式迁移后显隐/激活态由响应式 class+style 驱动，不再需要按钮根节点引用（删除残留 ref，避免运行时未注册告警）
          onClick: toggleWide,
          onMouseEnter: mouseWideEnter,
          onMouseLeave: mouseWideLeave,
        },
        h(
          "div",
          { class: "nova-player-ctrl-btn-icon" },
          h(LottieIcon, {
            name: "wide",
            sequence: [
              {
                animationData: wideHoverAnimationData,
                complete: "stop",
                autoplay: false,
              },
              {
                animationData: wideExitHoverAnimationData,
                complete: "stop",
                autoplay: false,
              },
            ],
            initialSlotIndex: resolveSlot(isWideSignal.value),
            onReady: syncWideIcon,
            ref: "wideRef",
          }),
        ),
      );
    },
    /** 渲染网页全屏按钮（state-active 由 isWebFullscreenSignal 驱动，style.display 由 webConfigSignal 驱动） */
    web: () => {
      return h(
        "div",
        {
          class: [
            "nova-player-ctrl-btn nova-player-ctrl-web",
            { "state-active": Boolean(isWebFullscreenSignal.value) },
          ],
          style: { display: webConfigSignal.value ? "" : "none" },
          role: "button",
          "aria-label": t("player.ui.controls.webFullscreen"),
          // 响应式迁移后显隐/激活态由响应式 class+style 驱动，不再需要按钮根节点引用（删除残留 ref，避免运行时未注册告警）
          onClick: toggleWebFullscreen,
          onMouseEnter: mouseWebEnter,
          onMouseLeave: mouseWebLeave,
        },
        h(
          "div",
          { class: "nova-player-ctrl-btn-icon" },
          h(LottieIcon, {
            name: "webFullscreen",
            sequence: [
              {
                animationData: webFullscreenAnimationData,
                complete: "stop",
                autoplay: false,
              },
              {
                animationData: webExitFullscreenAnimationData,
                complete: "stop",
                autoplay: false,
              },
            ],
            initialSlotIndex: resolveSlot(isWebFullscreenSignal.value),
            onReady: syncWebFullscreenIcon,
            ref: "webFullscreenRef",
          }),
        ),
      );
    },
    /** 渲染全屏按钮（state-active 由 isFullscreenSignal 驱动，style.display 由 fullscreenConfigSignal 驱动） */
    full: () =>
      h(
        "div",
        {
          class: [
            "nova-player-ctrl-btn nova-player-ctrl-full",
            { "state-active": Boolean(isFullscreenSignal.value) },
          ],
          style: { display: fullscreenConfigSignal.value ? "" : "none" },
          role: "button",
          "aria-label": t("player.ui.controls.fullscreen"),
          // 响应式迁移后显隐/激活态由响应式 class+style 驱动，不再需要按钮根节点引用（删除残留 ref，避免运行时未注册告警）
          onMouseEnter: mouseFullscreenEnter,
          onMouseLeave: mouseFullscreenLeave,
          onClick: toggleFullscreen,
        },
        h(
          "div",
          { class: "nova-player-ctrl-btn-icon" },
          h(LottieIcon, {
            name: "fullscreen",
            animationData: fullscreenAnimationData,
            ref: "fullscreenRef",
            autoplay: false,
          }),
        ),
      ),
  };

  /** 底部右侧按钮的渲染顺序配置（embedded 仅保留核心项） */
  const bottomRightOrder =
    props.scene === "embedded"
      ? ["quality", "playbackrate", "volume", "full"]
      : [
          "flac",
          "quality",
          "eplist",
          "playbackrate",
          "subtitle",
          "volume",
          "setting",
          "pip",
          "wide",
          "web",
          "full",
        ];

  // ============================================
  // 生命周期钩子
  // ============================================

  /**
   * 组件挂载后：初始化 config signal（驱动 onEffect 首次评估）并订阅 configStore 路径变化
   * signal 变化时 onEffect 自动重跑，无需手动调用 setControlVisible
   */
  lifecycle.onMounted = (): void => {
    // Initialize config signals from configStore (drives onEffect for visibility)
    qualityConfigSignal.value =
      configStore?.getPath<boolean>("ui.controls.quality") ??
      config.quality ??
      true;
    episodesConfigSignal.value =
      configStore?.getPath<boolean>("ui.controls.episodes") ??
      config.episodes ??
      true;
    settingConfigSignal.value =
      configStore?.getPath<boolean>("ui.controls.setting") ??
      config.setting ??
      true;
    pipConfigSignal.value =
      configStore?.getPath<boolean>("ui.controls.pip") ?? config.pip ?? true;
    wideConfigSignal.value =
      configStore?.getPath<boolean>("ui.controls.wideScreen") ??
      config.wideScreen ??
      true;
    webConfigSignal.value =
      configStore?.getPath<boolean>("ui.controls.webFullscreen") ??
      config.webFullscreen ??
      true;
    // fullscreen 不在 ControlsConfig 类型中，仅由 configStore 运行时路径驱动，缺省可见
    fullscreenConfigSignal.value =
      configStore?.getPath<boolean>("ui.controls.fullscreen") ?? true;

    // Subscribe to configStore path changes → update signals → onEffect auto-responds
    if (configStore) {
      configCleanups.push(
        configStore.subscribePath("ui.controls.quality", (value) => {
          qualityConfigSignal.value = value !== false;
        }),
      );
      configCleanups.push(
        configStore.subscribePath("ui.controls.episodes", (value) => {
          episodesConfigSignal.value = value !== false;
        }),
      );
      configCleanups.push(
        configStore.subscribePath("ui.controls.setting", (value) => {
          settingConfigSignal.value = value !== false;
        }),
      );
      configCleanups.push(
        configStore.subscribePath("ui.controls.pip", (value) => {
          pipConfigSignal.value = value !== false;
        }),
      );
      configCleanups.push(
        configStore.subscribePath("ui.controls.wideScreen", (value) => {
          wideConfigSignal.value = value !== false;
        }),
      );
      configCleanups.push(
        configStore.subscribePath("ui.controls.webFullscreen", (value) => {
          webConfigSignal.value = value !== false;
        }),
      );
      configCleanups.push(
        configStore.subscribePath("ui.controls.fullscreen", (value) => {
          fullscreenConfigSignal.value = value !== false;
        }),
      );
    }

    lifecycle.emit?.("rightControlsMounted");
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
    { class: "nova-player-control-bottom-right" },
    ...bottomRightOrder
      .map((key) => {
        /** 当前键对应的渲染函数 */
        const renderer = bottomRightRenderers[key];
        if (!renderer) return null;
        return renderer();
      })
      .filter((vnode): vnode is VNode => vnode !== null),
  );
});
