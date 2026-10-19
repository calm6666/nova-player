/**
 * ============================================
 * 设置面板组件 (SettingMenu)
 * ============================================
 * 声明式响应式版本：
 * - 面板展开态由 shownSignal 驱动根节点 state-show 类（__reactiveAttrs），
 *   hover 定时器（rafTimeout）仅负责延迟时序并写信号，不直接操作 DOM
 * - 面板翻页（第一页设置 / 第二页更多设置）由 pageIndexSignal 一站式驱动：
 *   页签 active 类 / state-show-right / 外框尺寸 / move 位移全部为派生绑定，
 *   过渡由 .ui-panel-wrap / .ui-panel-move 上的 CSS transition 承担
 */

import {
  h,
  defineComponent,
  useTemplateRef,
  useContext,
  useReactiveState,
  signal,
  computed,
  onEffect,
  Show,
  t,
} from "@/core";
import type { Signal, ReadonlySignal } from "@/core";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import type { AnimationFrameID } from "@/utils/rafTimeout";
import { PlayerStateKeyEnum, StateContext } from "@/store/runtimeState";
import { ConfigStoreContext } from "@/store/configStore";
import type { PlayerStateMap, TypedStateManager } from "@/store/runtimeState";
import type { VNode } from "@/types";
import { LottieIcon, LottieIconApi } from "./LottieIcon";
import { Switch } from "@/nova/components/Switch";
import { Checkbox } from "@/nova/components/Checkbox";
import { ArrowRight } from "./icons";
import { RadioGroup } from "./RadioGroup";
import type { RadioGroupOption } from "./RadioGroup";
import type { PlayerPluginFlags } from "./PlayerDocker";
import settingHoverAnimationData from "../assets/lottie-icon/settings-animation.json";

export interface SettingMenuProps {
  /** 高能进度条常驻当前状态（面板显示真实状态用） */
  permanent?: boolean;
  /**
   * 配置显隐（ui.controls.setting）
   * 父层可传 Signal 形态（props 惰性代理读取穿透建立依赖），
   * 缺省可见；display 由本组件根节点响应式 style 单一来源管理
   */
  visible?: boolean | ReadonlySignal<boolean>;
  /**
   * 插件安装标志读取器（getter 形态，RightControls 透传）：
   * 未装 audioEffect 插件时第二页「音量均衡」音频设置区块不渲染，
   * 面板高度联动收缩；未传（独立使用场景）保持既有行为
   */
  plugins?: () => PlayerPluginFlags;
}

export type SettingMenuEvents = {
  settingChange: { key: string; value: boolean | string | number };
  moreSettingClick: undefined;
};

const MENU_SHOW_DELAY = 120;
const MENU_HIDE_DELAY = 220;

/** 第一页（设置主面板）尺寸，px */
const SETTING_PAGE_MAIN = { width: 132, height: 140 };
/**
 * 第二页（更多设置）尺寸，px（页内容为固定结构，尺寸为常量）
 * 高度按 CSS 推导：padding 上下 16×2 + 5 个 title（16+4）+ 4 组
 * radio 内容（24+12）+ others（title 20 + checkbox 行 20）= 296px
 */
const SETTING_PAGE_MORE = { width: 286, height: 296 };
/**
 * 「音量均衡」区块高度，px（title 16+4 + 内容 24 + 区块间距 12）
 * 未装音效插件时区块不渲染，第二页高度相应收缩
 */
const LOUDNESS_BLOCK_HEIGHT = 56;
/**
 * 第二页（无音频设置）尺寸：隐藏音量均衡区块后的收缩高度
 * 音效插件未装时使用，面板高度随区块渲染状态动态选择
 */
const SETTING_PAGE_MORE_NO_AUDIO = {
  width: 286,
  height: SETTING_PAGE_MORE.height - LOUDNESS_BLOCK_HEIGHT,
};

export const SettingMenu = defineComponent<SettingMenuProps, SettingMenuEvents>(
  (props, lifecycle) => {
    const settingIconRef = useTemplateRef<LottieIconApi>(
      lifecycle,
      "settingIconRef",
    );

    let showTimer: AnimationFrameID | null = null;
    let hideTimer: AnimationFrameID | null = null;

    /**
     * 响应式信号：面板展开态
     * 驱动根节点 state-show 类（编译器包装为 __reactiveAttrs，
     * 变化时经 normalizeClass 精准更新类名），
     * 替代旧的 rootRef.classList.toggle 命令式写法
     */
    const shownSignal = signal<boolean>(false);

    /**
     * 响应式信号：当前页下标（0 设置主面板 / 1 更多设置）
     * 一站式驱动翻页三联动（替代旧的 switchPanelPage 命令式工具与 pageBox 量测回退）：
     *   - 页签 ui-panel-item-active 类 / .ui-area 的 state-show-right（响应式 class）
     *   - 外框 .ui-panel-wrap 的宽高跟随当前页（响应式 style）
     *   - .ui-panel-move 的 translateX 位移（响应式 style）
     * 写信号即可，过渡由各节点 CSS transition 承担
     */
    const pageIndexSignal = signal<number>(0);

    /**
     * 配置显隐派生信号：父层经 visible prop 传入（支持 Signal 形态，
     * props 惰性代理读取穿透 Signal.value 自动建立依赖），
     * display 由本组件根节点响应式 style 单一来源管理，
     * 消除旧的 RightControls querySelector 直写 display（两边写 display 打架）
     */
    const configVisibleSignal = computed(() => props.visible !== false);

    /**
     * 面板 hover 显隐：写信号即可，DOM 类名由响应式系统自动同步
     * @param show - 是否展开
     */
    const setShown = (show: boolean): void => {
      shownSignal.value = show;
    };

    const clearTimers = (): void => {
      cancelRaf(showTimer!);
      cancelRaf(hideTimer!);
      showTimer = null;
      hideTimer = null;
    };

    const handleMouseEnter = (): void => {
      settingIconRef.value?.play();
      cancelRaf(hideTimer!);
      hideTimer = null;
      if (showTimer !== null) return;
      showTimer = rafTimeout(() => {
        showTimer = null;
        setShown(true);
      }, MENU_SHOW_DELAY);
    };

    /**
     * 复位到第一页（面板收起时调用，下次打开即第一页）
     * 响应式：写页码信号即可，页签类名 / 外框尺寸 / 位移由响应式系统自动同步
     */
    const resetPage = (): void => {
      pageIndexSignal.value = 0;
    };

    const handleMouseLeave = (): void => {
      cancelRaf(showTimer!);
      showTimer = null;
      if (hideTimer !== null) return;
      hideTimer = rafTimeout(() => {
        hideTimer = null;
        resetPage();
        setShown(false);
      }, MENU_HIDE_DELAY);
    };

    const handleMirrorChange = (checked: boolean): void => {
      lifecycle.emit?.("settingChange", { key: "mirror", value: checked });
    };

    const handleLoopChange = (checked: boolean): void => {
      lifecycle.emit?.("settingChange", { key: "loop", value: checked });
    };

    const handleAutostartChange = (checked: boolean): void => {
      lifecycle.emit?.("settingChange", { key: "autostart", value: checked });
    };

    const handleSkipIntroOutroChange = (checked: boolean): void => {
      lifecycle.emit?.("settingChange", {
        key: "skipIntroOutro",
        value: checked,
      });
    };

    const handleLightoffChange = (checked: boolean): void => {
      lifecycle.emit?.("settingChange", { key: "lightoff", value: checked });
    };

    const handlePipChange = (checked: boolean): void => {
      lifecycle.emit?.("settingChange", { key: "pip", value: checked });
      // 请求是异步的且可能被浏览器拒绝（无用户手势 / 视频未就绪 / 不支持）：
      // 成功时由下方 IS_PIP effect 正常同步；这里延迟一拍按真实状态对账，
      // 失败时把复选框复位，避免「面板勾着、播放器实际没进 PiP」。
      cancelRaf(pipSyncTimer!);
      pipSyncTimer = rafTimeout(() => {
        pipSyncTimer = null;
        const actual = pipSignal.value;
        if (actual !== undefined) pipApi?.setChecked(Boolean(actual));
      }, 300);
    };

    /** 更多设置：翻到第二页（写页码信号驱动翻页三联动） */
    const handleMoreClick = (): void => {
      pageIndexSignal.value = 1;
      lifecycle.emit?.("moreSettingClick");
    };

    /**
     * renderRadioGroup：单选组渲染助手
     * 响应式迁移后单选组不再需要 DOM 引用（refKey 残留传参会触发未注册告警），已一并移除
     *
     * @param options - 选项列表
     * @param key - 设置项 key（settingChange 事件回传）
     * @param checkedValue - 可选受控选中值信号（编码格式单选传入：
     *        与运行时状态 CODEC_PREFER_TYPE 双向同步——onSelect 经
     *        applySettingChange → setCodecPrefer → state.set 写回，
     *        外部 API 改值时信号驱动选中态原位更新）
     */
    const renderRadioGroup = (
      options: RadioGroupOption[],
      key: string,
      checkedValue?: Signal<boolean | string | number | undefined>,
    ): VNode =>
      RadioGroup(options, {
        name: key,
        ...(checkedValue ? { checkedValue } : {}),
        onSelect: (option) => {
          lifecycle.emit?.("settingChange", { key, value: option.value });
        },
      });

    /**
     * 开关 API 容器：三个 Switch + 关灯 Checkbox 挂载后暴露 setChecked，
     * 由下方 onEffect 依信号值受控同步（key 对应 switches[].key）
     */
    const switchApis: Record<
      "mirror" | "loop" | "autostart",
      { setChecked: (value: boolean) => void } | null
    > = {
      mirror: null,
      loop: null,
      autostart: null,
    };

    /** 关灯复选框 API（LIGHTOFF 运行时状态受控同步，不持久化） */
    let lightoffApi: { setChecked: (value: boolean) => void } | null = null;

    /** 高能进度条复选框 API（供渲染态双向同步） */
    let highenergyApi: { setChecked: (value: boolean) => void } | null = null;

    /**
     * 画中画复选框 API（IS_PIP 受控同步）
     *
     * 画中画状态可能来自三条链路：本面板复选框、控制栏按钮、
     * 浏览器原生 PiP UI / 关闭 PiP 窗口（PlayerDocker 监听 document 事件）。
     * 全部收敛到运行时状态 IS_PIP，本面板作为受控复选框跟随该状态。
     */
    let pipApi: { setChecked: (value: boolean) => void } | null = null;

    /** 画中画请求对账定时器（浏览器可能拒绝请求，需按真实状态复位勾选） */
    let pipSyncTimer: AnimationFrameID | null = null;

    const stateMgr = useContext<TypedStateManager<PlayerStateMap> | null>(
      StateContext,
    );
    /** 配置中心（读取 progress.skipPoints / ui.endingStyle 决定是否展示跳过头尾） */
    const configStore = useContext(ConfigStoreContext);

    /**
     * 响应式信号：高能进度条渲染态（设置面板复选框 = 是否渲染开关）
     * 注意与常驻态（PBP_PERMANENT，右侧图钉图标）解耦：
     * 取消勾选 → PbpControls 整个不挂载；常驻开关只控制展开行为
     * useReactiveState 返回 Signal，读取 .value 自动建立响应式依赖
     */
    const pbpRenderedSignal: Signal<boolean | undefined> = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.PBP_RENDERED, lifecycle)
      : signal<boolean | undefined>(undefined);

    /**
     * 响应式信号：编码偏好（0 默认 / 1 HEVC / 2 AVC / 3 AV1）
     * 与运行时状态 CODEC_PREFER_TYPE 同步（useReactiveState 派生）：
     * 构造时由持久化值初始化（下次加载即上次设置），面板选择经
     * setCodecPrefer 写回状态 → 信号驱动选中态原位更新
     */
    const codecPreferSignal: Signal<number | undefined> = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.CODEC_PREFER_TYPE, lifecycle)
      : signal<number | undefined>(undefined);

    /**
     * 响应式信号：镜像 / 循环 / 自动开播 / 关灯 / 播完暂停
     * 全部与运行时状态同步（useReactiveState 派生）：
     * 构造时由持久化值初始化（关灯不持久化恒 false），面板操作经
     * settingChange → applySettingChange 写回状态 → 信号驱动
     * Switch/Checkbox/单选组受控回显，外部 API 改值时同样原位更新
     */
    const mirrorSignal: Signal<boolean | undefined> = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.MIRROR, lifecycle)
      : signal<boolean | undefined>(undefined);
    const loopSignal: Signal<boolean | undefined> = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.LOOP, lifecycle)
      : signal<boolean | undefined>(undefined);
    const autostartSignal: Signal<boolean | undefined> = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.AUTOSTART, lifecycle)
      : signal<boolean | undefined>(undefined);
    const skipIntroOutroSignal: Signal<boolean | undefined> = stateMgr
      ? useReactiveState(
          stateMgr,
          PlayerStateKeyEnum.SKIP_INTRO_OUTRO,
          lifecycle,
        )
      : signal<boolean | undefined>(undefined);
    const lightoffSignal: Signal<boolean | undefined> = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.LIGHTOFF, lifecycle)
      : signal<boolean | undefined>(undefined);
    const pauseAfterEndSignal: Signal<boolean | undefined> = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.PAUSE_AFTER_END, lifecycle)
      : signal<boolean | undefined>(undefined);

    /**
     * 响应式信号：画中画状态（IS_PIP）
     * 控制栏按钮 / 浏览器原生 PiP 变化 / 本面板复选框统一写回该状态，
     * 面板复选框经 setChecked 受控跟随（与镜像/循环等开关同一模式）
     */
    const pipSignal: Signal<boolean | undefined> = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.IS_PIP, lifecycle)
      : signal<boolean | undefined>(undefined);

    /**
     * 响应式信号：画面比例（"0:0" 自适应 / "4:3" / "16:9"）
     * 与运行时状态 ASPECT_RATIO 同步：构造期 "0:0"，持久化值经
     * MOUNTED setAspectRatio 写回 → 信号驱动单选组选中态
     */
    const aspectSignal: Signal<string | undefined> = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.ASPECT_RATIO, lifecycle)
      : signal<string | undefined>(undefined);

    /**
     * 派生信号：播放方式单选值（0 自动连播 / 2 播完暂停）
     * PAUSE_AFTER_END 为 boolean，单选组 value 为 0/2，经下方 onEffect
     * 单向映射写入（RadioGroup 受控信号需可写，computed 只读不兼容）
     */
    const handoffValueSignal = signal<number>(0);

    /**
     * 左侧菜单的三个开关项（对应参考的 bui-switch 组）
     * 受控模式：checked 取响应式信号初值（构造时即持久化值），
     * 后续变化经 switchMounted 暴露的 setChecked API 原位同步
     * （autostart 不再硬编码 true，跟随持久化真实值回显）
     */
    /**
     * 是否展示「跳过头尾」开关：电视剧 / 番剧片尾或提供片头片尾断点时展示
     * （普通视频没有 op/ed 时间轴，不显示该项）
     */
    const skipPointsConfig = configStore?.getPath<{
      introEnd?: number;
      outroStart?: number;
    }>("progress.skipPoints");
    const isOgvEnding =
      configStore?.getPath<string>("ui.endingStyle") === "ogv";
    const showSkipIntroOutro =
      isOgvEnding ||
      Boolean(
        skipPointsConfig &&
          (skipPointsConfig.introEnd !== undefined ||
            skipPointsConfig.outroStart !== undefined),
      );

    /** 首页高度：有「跳过头尾」开关时多一行（32px） */
    const mainPageHeight =
      SETTING_PAGE_MAIN.height + (showSkipIntroOutro ? 32 : 0);

    /** 「跳过头尾」Switch 受控 API */
    let skipIntroOutroApi: { setChecked: (value: boolean) => void } | null =
      null;

    const switches: Array<{
      cls: string;
      name: string;
      key: "mirror" | "loop" | "autostart";
      checked?: boolean;
      onChange: (checked: boolean) => void;
    }> = [
      {
        cls: "nova-player-ctrl-setting-mirror",
        name: t("player.ui.settings.mirror"),
        key: "mirror",
        checked: mirrorSignal.value ?? false,
        onChange: handleMirrorChange,
      },
      {
        cls: "nova-player-ctrl-setting-loop",
        name: t("player.ui.settings.loop"),
        key: "loop",
        checked: loopSignal.value ?? false,
        onChange: handleLoopChange,
      },
      {
        cls: "nova-player-ctrl-setting-autoplay",
        name: t("player.ui.settings.autostart"),
        key: "autostart",
        checked: autostartSignal.value ?? false,
        onChange: handleAutostartChange,
      },
    ];

    /**
     * 派生信号：音效插件是否安装（音频设置区块的渲染开关）
     * 读 plugins getter 建立依赖，插件运行中装卸时区块即时挂/摘，
     * 第二页面板高度随区块渲染状态联动收缩
     */
    const hasAudioEffectSignal = computed(
      () => props.plugins?.().audioEffect ?? true,
    );

    /**
     * 响应式同步：信号变化 → 调用组件 API 同步勾选状态
     * onEffect 内读取 signal.value 自动追踪，信号变化时自动重跑
     * 保留命令式：setChecked() 是组件 API 调用（非 DOM 操作）
     * 覆盖：高能进度条 / 镜像 / 循环 / 自动开播 / 关灯 / 播放方式
     */
    onEffect(lifecycle, () => {
      const value = pbpRenderedSignal.value;
      if (value !== undefined) highenergyApi?.setChecked(value);
      // 三个 Switch 受控（状态源：持久化 flags 或运行时状态）
      const mirror = mirrorSignal.value;
      if (mirror !== undefined) switchApis.mirror?.setChecked(mirror);
      const loop = loopSignal.value;
      if (loop !== undefined) switchApis.loop?.setChecked(loop);
      const autostart = autostartSignal.value;
      if (autostart !== undefined) switchApis.autostart?.setChecked(autostart);
      // 跳过头尾（仅 OGV / 有断点时展示）
      const skip = skipIntroOutroSignal.value;
      if (skip !== undefined) skipIntroOutroApi?.setChecked(skip);
      // 关灯（不持久化，仅运行时状态）
      const lightoff = lightoffSignal.value;
      if (lightoff !== undefined) lightoffApi?.setChecked(lightoff);
      // 画中画（控制栏 / 浏览器原生 PiP 变化同样回显到设置面板）
      const pip = pipSignal.value;
      if (pip !== undefined) pipApi?.setChecked(Boolean(pip));
      // 播放方式单选值映射（boolean → 0/2）
      handoffValueSignal.value = pauseAfterEndSignal.value === true ? 2 : 0;
    });

    lifecycle.onBeforeDestroy = (): void => {
      cancelRaf(pipSyncTimer!);
      pipSyncTimer = null;
      clearTimers();
    };

    return h(
      "div",
      {
        // 展开态类名由 shownSignal 响应式驱动（__reactiveAttrs + normalizeClass）
        class: [
          "nova-player-ctrl-btn",
          "nova-player-ctrl-setting",
          { "state-show": shownSignal.value },
        ],
        role: "button",
        "aria-label": t("player.ui.settings.title"),
        // 配置显隐：display 单一来源（父层 ui.controls.setting 经 visible prop 传入）
        style: { display: configVisibleSignal.value ? "" : "none" },
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
      },
      h(
        "div",
        { class: "nova-player-ctrl-btn-icon" },
        h(LottieIcon, {
          name: "setting",
          animationData: settingHoverAnimationData,
          loop: false,
          autoplay: false,
          ref: "settingIconRef",
        }),
      ),
      h(
        "div",
        { class: "nova-player-ctrl-setting-box" },
        h(
            "div",
            {
              class: "nova-player-ctrl-setting-menu ui ui-panel ui-dark",
            },
            h(
              "div",
              {
                // 翻到第二页时加 state-show-right（pageIndexSignal 响应式驱动）
                class: ["ui-area", { "state-show-right": pageIndexSignal.value > 0 }],
              },
              h(
                "div",
                {
                  class: "ui-panel-wrap",
                // 外框尺寸跟随当前页（响应式 style 派生，过渡由 CSS transition 承担）
                // 第二页高度联动音频设置区块：未装音效插件时区块不
                // 渲染，高度取收缩尺寸（296 - 56 = 240）
                style: {
                  width: `${(pageIndexSignal.value === 0 ? SETTING_PAGE_MAIN : SETTING_PAGE_MORE).width}px`,
                  height: `${
                    pageIndexSignal.value === 0
                      ? mainPageHeight
                      : (hasAudioEffectSignal.value
                          ? SETTING_PAGE_MORE
                          : SETTING_PAGE_MORE_NO_AUDIO
                        ).height
                  }px`,
                },
                },
                h(
                  "div",
                  {
                    class: "ui-panel-move",
                    // 位移由 pageIndexSignal 派生：第二页时左移一页宽（过渡由 CSS transition 承担）
                    style: {
                      width: `${SETTING_PAGE_MAIN.width + SETTING_PAGE_MORE.width}px`,
                      transform: `translateX(${pageIndexSignal.value === 0 ? 0 : -SETTING_PAGE_MAIN.width}px)`,
                    },
                  },
                  h(
                    "div",
                    {
                      // 页签 active 类由 pageIndexSignal 响应式驱动
                      class: [
                        "ui-panel-item",
                        { "ui-panel-item-active": pageIndexSignal.value === 0 },
                      ],
                      style: {
                        width: `${SETTING_PAGE_MAIN.width}px`,
                        height: `${mainPageHeight}px`,
                      },
                    },
                  h(
                    "div",
                    { class: "nova-player-ctrl-setting-menu-left" },
                    ...switches.map((item) =>
                      h(
                        "div",
                        { class: `${item.cls} ui ui-switch` },
                        h(Switch, {
                          size: "small",
                          name: item.name,
                          checked: item.checked,
                          onChange: item.onChange,
                          // 挂载后捕获 API：onEffect 依持久化/运行时状态受控同步勾选态
                          onSwitchMounted: (api: {
                            setChecked: (value: boolean) => void;
                          }) => {
                            switchApis[item.key] = api;
                          },
                        }),
                      ),
                    ),
                    h(
                      "div",
                      {
                        class: "nova-player-ctrl-setting-oped",
                        style: {
                          display: showSkipIntroOutro ? "" : "none",
                        },
                      },
                      h(
                        "div",
                        { class: "ui ui-switch" },
                        h(Switch, {
                          size: "small",
                          name: t("player.ui.settings.skip_intro_outro"),
                          checked: skipIntroOutroSignal.value ?? false,
                          onChange: handleSkipIntroOutroChange,
                          onSwitchMounted: (api: {
                            setChecked: (value: boolean) => void;
                          }) => {
                            skipIntroOutroApi = api;
                          },
                        }),
                      ),
                    ),
                    h(
                      "div",
                      {
                        class: "nova-player-ctrl-setting-more",
                        onClick: handleMoreClick,
                      },
                      h(
                        "span",
                        { class: "nova-player-ctrl-setting-more-text" },
                        t("player.ui.settings.more"),
                      ),
                      h(
                        "span",
                        { class: "nova-player-ctrl-setting-more-arrow" },
                        ArrowRight(),
                      ),
                    ),
                  ),
                ),
                h(
                  "div",
                  {
                    // 第二页页签 active 类由 pageIndexSignal 响应式驱动
                    class: [
                      "ui-panel-item",
                      { "ui-panel-item-active": pageIndexSignal.value === 1 },
                    ],
                    style: { width: `${SETTING_PAGE_MORE.width}px` },
                  },
                  h(
                    "div",
                    { class: "nova-player-ctrl-setting-menu-right" },
                    h(
                      "div",
                      { class: "nova-player-ctrl-setting-handoff" },
                      h(
                        "div",
                        { class: "nova-player-ctrl-setting-handoff-title" },
                        t("player.ui.settings.handoff.title"),
                      ),
                      h(
                        "div",
                        {
                          class:
                            "nova-player-ctrl-setting-handoff-content ui ui-radio ui-dark",
                        },
                        h(
                          "div",
                          { class: "ui-area" },
                          renderRadioGroup(
                            // 响应式迁移后单选组不再需要 DOM 引用，refKey 参数已删除（避免运行时未注册告警）
                            [
                              {
                                label: t("player.ui.settings.handoff.auto"),
                                value: 0,
                              },
                              {
                                label: t("player.ui.settings.handoff.pause"),
                                value: 2,
                              },
                            ],
                            "handoff",
                            // 受控模式：播完暂停持久化值驱动选中态
                            // （构造时即上次选择，外部 API 改值时原位更新）
                            handoffValueSignal,
                          ),
                        ),
                      ),
                    ),
                    h(
                      "div",
                      { class: "nova-player-ctrl-setting-aspect" },
                      h(
                        "div",
                        { class: "nova-player-ctrl-setting-aspect-title" },
                        t("player.ui.settings.aspect.title"),
                      ),
                      h(
                        "div",
                        {
                          class:
                            "nova-player-ctrl-setting-aspect-content ui ui-radio ui-dark",
                        },
                        h(
                          "div",
                          { class: "ui-area" },
                          renderRadioGroup(
                            // 响应式迁移后单选组不再需要 DOM 引用，refKey 参数已删除（避免运行时未注册告警）
                            [
                              {
                                label: t("player.ui.settings.aspect.auto"),
                                value: "0:0",
                              },
                              { label: "4:3", value: "4:3" },
                              { label: "16:9", value: "16:9" },
                            ],
                            "aspect",
                            // 受控模式：画面比例持久化值驱动选中态
                            // （构造期 "0:0"，MOUNTED 恢复持久化值时原位更新）
                            aspectSignal,
                          ),
                        ),
                      ),
                    ),
                    h(
                      "div",
                      { class: "nova-player-ctrl-setting-codec" },
                      h(
                        "div",
                        { class: "nova-player-ctrl-setting-codec-title" },
                        t("player.ui.settings.codec.title"),
                      ),
                      h(
                        "div",
                        {
                          class:
                            "nova-player-ctrl-setting-codec-content ui ui-radio ui-dark",
                        },
                        h(
                          "div",
                          { class: "ui-area" },
                          renderRadioGroup(
                          // 响应式迁移后单选组不再需要 DOM 引用，refKey 参数已删除（避免运行时未注册告警）
                          [
                            {
                              label: t("player.ui.settings.codec.default"),
                              value: 0,
                            },
                            { label: "AV1", value: 3 },
                            { label: "HEVC", value: 1 },
                            { label: "AVC", value: 2 },
                          ],
                          "codec",
                          // 受控模式：选中态与运行时状态/持久化值双向同步
                          // （构造时即持久化值——下次加载即上次设置），
                          // 不再用静态 checked 标记
                          codecPreferSignal,
                        ),
                        ),
                      ),
                    ),
                    // 音频设置（音量均衡）区块：按音效插件安装状态
                    // 条件渲染——未装插件时整个区块不挂载（Show 控制
                    // 流），面板高度联动收缩（见 ui-panel-wrap 的
                    // 高度表达式）；装卸即时联动由 hasAudioEffectSignal
                    // 驱动
                    h(
                      Show,
                      { when: (): boolean => hasAudioEffectSignal.value },
                      h(
                        "div",
                        { class: "nova-player-ctrl-setting-loudness" },
                        h(
                          "div",
                          { class: "nova-player-ctrl-setting-loudness-title" },
                          t("player.ui.settings.loudness.title"),
                        ),
                        h(
                          "div",
                          {
                            class:
                              "nova-player-ctrl-setting-loudness-content ui ui-radio ui-dark",
                          },
                          h(
                            "div",
                            { class: "ui-area" },
                            renderRadioGroup(
                              // 响应式迁移后单选组不再需要 DOM 引用，refKey 参数已删除（避免运行时未注册告警）
                              [
                                {
                                  label: t(
                                    "player.ui.settings.loudness.standard",
                                  ),
                                  value: 1,
                                },
                                {
                                  label: t("player.ui.settings.loudness.dynamic"),
                                  value: 2,
                                },
                                {
                                  label: t("player.ui.settings.loudness.off"),
                                  value: 0,
                                  checked: true,
                                },
                              ],
                              "loudness",
                            ),
                          ),
                        ),
                      ),
                    ),
                    h(
                      "div",
                      { class: "nova-player-ctrl-setting-others" },
                      h(
                        "div",
                        { class: "nova-player-ctrl-setting-others-title" },
                        t("player.ui.settings.others"),
                      ),
                      h(
                        "div",
                        { class: "nova-player-ctrl-setting-others-content" },
                        h(
                          "div",
                          {
                            class:
                              "nova-player-ctrl-setting-checkbox nova-player-ctrl-setting-lightoff",
                          },
                          h(Checkbox, {
                            label: t("player.ui.settings.lightoff"),
                            // 受控初值（关灯不持久化，恒 false 即默认开灯），
                            // 后续经 LIGHTOFF 运行时状态 + onCheckboxMounted API 同步
                            checked: lightoffSignal.value ?? false,
                            onChange: handleLightoffChange,
                            onCheckboxMounted: (api: {
                              setChecked: (value: boolean) => void;
                            }) => {
                              lightoffApi = api;
                            },
                          }),
                        ),
                        h("div", {
                          class:
                            "nova-player-ctrl-setting-checkbox nova-player-ctrl-setting-widesave",
                          style: { display: "none" },
                        }),
                        h("div", {
                          class:
                            "nova-player-ctrl-setting-checkbox nova-player-ctrl-setting-panoram",
                          style: { display: "none" },
                        }),
                        h(
                          "div",
                          {
                            class:
                              "nova-player-ctrl-setting-checkbox nova-player-ctrl-setting-highenergy",
                          },
                          h(Checkbox, {
                            label: t("player.ui.settings.highenergy"),
                            // 复选框 = 是否渲染开关（默认渲染）；常驻开关是右侧图钉图标
                            checked: pbpRenderedSignal.value ?? true,
                            onChange: (checked: boolean) => {
                              stateMgr?.set(
                                PlayerStateKeyEnum.PBP_RENDERED,
                                checked,
                              );
                              lifecycle.emit?.("settingChange", {
                                key: "highenergy",
                                value: checked,
                              });
                            },
                            onCheckboxMounted: (api: {
                              setChecked: (value: boolean) => void;
                            }) => {
                              highenergyApi = api;
                            },
                          }),
                        ),
                        h(
                          "div",
                          {
                            class:
                              "nova-player-ctrl-setting-checkbox nova-player-ctrl-setting-pip",
                          },
                          h(Checkbox, {
                            label: t("player.ui.settings.pip"),
                            // 受控回显：状态源 IS_PIP（控制栏 / 浏览器原生 PiP 同步）
                            checked: pipSignal.value ?? false,
                            onChange: handlePipChange,
                            onCheckboxMounted: (api: {
                              setChecked: (value: boolean) => void;
                            }) => {
                              pipApi = api;
                            },
                          }),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  },
);
