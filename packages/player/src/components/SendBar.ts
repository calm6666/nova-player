/**
 * ============================================
 * 弹幕发送栏组件 (SendBar)
 * ============================================
 * 提供弹幕输入、发送、弹幕开关和设置面板等交互功能
 */

import {
  h,
  defineComponent,
  useTemplateRef,
  t,
  signal,
  computed,
  Show,
} from "@/core";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import type { AnimationFrameID } from "@/utils/rafTimeout";
import type { ComponentLifecycle } from "@/types";
import { DmSetting } from "@/nova/components/DmSetting";
import type { DmSettingApi } from "@/nova/components/DmSetting";
import { Selection } from "@/nova/components/Selection";
import {
  DanmakuSwitchOn,
  DanmakuSwitchOff,
  DanmakuSetting,
  DanmakuTextSetting,
} from "@/nova/components/icons";

/**
 * 面板显示状态
 * 管理设置面板和弹幕类型选择面板的延迟显示/隐藏定时器
 */
export interface DmShowpanel {
  /** 设置面板的定时器 */
  setting: {
    /** 设置面板延迟显示的定时器 ID */
    showTimer: AnimationFrameID | null;
    /** 设置面板延迟隐藏的定时器 ID */
    hideTimer: AnimationFrameID | null;
  };
  /** 弹幕类型选择面板的定时器 */
  selection: {
    /** 选择面板延迟显示的定时器 ID */
    showTimer: AnimationFrameID | null;
    /** 选择面板延迟隐藏的定时器 ID */
    hideTimer: AnimationFrameID | null;
  };
}

/**
 * 提示按钮信息
 * 用于弹幕开关悬停时显示提示气泡
 */
export interface Tooltip {
  /** 触发提示的 DOM 元素 */
  element: HTMLElement | null;
  /** 提示名称 */
  name: string;
  /** 提示的数据属性名 */
  dataName: string;
}

/**
 * SendBar 组件 Props 接口
 * 定义弹幕发送栏的所有属性和回调
 */
export interface SendBarProps {
  /** 在线观看人数文本 */
  onlineCount?: string;
  /** 弹幕总数文本 */
  danmakuCount?: string;
  /** 是否显示登录提示（未登录时显示登录/注册链接） */
  showLoginTip?: boolean;
  /** 弹幕开关初始状态，true 为开启 */
  danmakuSwitch?: boolean;
  /** 输入框占位符文本 */
  placeholder?: string;
  /** 输入框获得焦点时的回调 */
  onInputFocus?: () => void;
  /** 输入框失去焦点时的回调 */
  onInputBlur?: () => void;
  /** 弹幕开关状态变化时的回调 */
  onDanmakuSwitch?: (checked: boolean) => void;
  /** 发送弹幕时的回调，参数为弹幕文本 */
  onSendDanmaku?: (text: string) => void;
  /** 显示提示气泡时的回调 */
  onShowTooltip?: (tooltip: Tooltip) => void;
  /** 隐藏提示气泡时的回调 */
  onHideTooltip?: () => void;
}

/**
 * 弹幕发送栏组件
 * 提供弹幕输入、发送、开关控制和设置面板等交互功能
 */
export const SendBar = defineComponent<SendBarProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 状态数据
    // ============================================

    /** 面板显示状态，管理设置面板和弹幕类型选择面板的定时器 */
    const dmShowpanel: DmShowpanel = {
      setting: { showTimer: null, hideTimer: null },
      selection: { showTimer: null, hideTimer: null },
    };

    /** 提示气泡延迟显示的定时器 ID */
    let tipInTimer: AnimationFrameID | null = null;

    /**
     * 弹幕输入框文本信号（渲染层唯一数据源）
     * 发送按钮的 disabled 态由此信号与弹幕开关信号共同驱动，
     * 输入内容变化时发送按钮高亮态实时响应式更新
     */
    const inputValueSignal = signal("");

    /**
     * 弹幕设置面板展开态信号（渲染层唯一数据源）
     * openPanel/closePanel 的 rafTimeout 回调写入，面板 class 由
     * __reactiveAttrs 自动同步（替代 classList.add/remove 命令式操作）
     */
    const settingShowSig = signal<boolean>(false);

    /**
     * 弹幕类型选择面板展开态信号（同上，延迟显示/隐藏由定时器时序保留）
     */
    const selectionShowSig = signal<boolean>(false);

    /**
     * 弹幕开关状态信号（true 表示弹幕开启）
     * 作为渲染层的唯一数据源，所有依赖此状态的 UI（弹幕类型按钮显隐、
     * 发送按钮 disabled 态、「已关闭弹幕」提示）均由此信号驱动响应式更新
     */
    const isDanmakuEnabledSignal = signal<boolean>(
      props.danmakuSwitch ?? true,
    );

    /**
     * 是否允许发送弹幕（computed 派生信号）
     * 同时依赖输入文本与弹幕开关，两个依赖无条件收集：
     * 先分别读取两个信号再做逻辑与，避免 && 短路求值
     * 导致弹幕开关的响应式依赖在空输入时被跳过收集
     */
    const canSendSignal = computed((): boolean => {
      const hasText = inputValueSignal.value.trim().length > 0;
      const dmEnabled = isDanmakuEnabledSignal.value;
      return hasText && dmEnabled;
    });

    /** 弹幕开关提示信息 */
    const tooltip: Tooltip = {
      element: null,
      name: "danmaku-switch",
      dataName: "danmaku_switch",
    };

    /** 弹幕设置面板 API（关闭面板时复位到第一页） */
    let dmSettingApi: DmSettingApi | null = null;

    // ============================================
    // DOM 元素引用
    // ============================================

    /** 弹幕设置图标 DOM 引用，用于绑定鼠标悬停事件 */
    const settingIconRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "settingIconRef",
    );

    /** 弹幕类型选择图标 DOM 引用，用于绑定鼠标悬停事件 */
    const textSettingIconRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "textSettingIconRef",
    );

    /** 弹幕输入框 DOM 引用 */
    const inputRef = useTemplateRef<HTMLInputElement>(lifecycle, "inputRef");

    /** 弹幕开关复选框 DOM 引用 */
    const switchInputRef = useTemplateRef<HTMLInputElement>(
      lifecycle,
      "switchInputRef",
    );

    // ============================================
    // 事件处理
    // ============================================

    /**
     * 处理输入框获得焦点事件
     * 说明：lifecycle.emit 会同时路由到 props.onInputFocus（框架 onXxx 约定），
     * 因此这里不再显式调用 props 回调，否则会重复触发
     */
    const handleInputFocus = (): void => {
      lifecycle.emit?.("inputFocus");
    };

    /** 处理输入框失去焦点事件（同上，避免重复触发 props 回调） */
    const handleInputBlur = (): void => {
      lifecycle.emit?.("inputBlur");
    };

    /**
     * 处理输入框内容变化事件
     * @param event - 输入事件
     */
    const handleInputChange = (event: Event): void => {
      if (!(event.target instanceof HTMLInputElement)) return;
      inputValueSignal.value = event.target.value;
    };

    /** 处理发送弹幕，清空输入框并触发回调（emit 会路由到 props.onSendDanmaku） */
    const handleSend = (): void => {
      if (canSendSignal.value) {
        lifecycle.emit?.("sendDanmaku", inputValueSignal.value.trim());
        if (inputRef.value) {
          inputRef.value.value = "";
        }
        inputValueSignal.value = "";
      }
    };

    /**
     * 处理弹幕开关变化事件
     * emit 会同时路由到 props.onDanmakuSwitch，不再显式调用 props 回调
     * @param event - 变化事件
     */
    const handleSwitchChange = (event: Event): void => {
      if (!(event.target instanceof HTMLInputElement)) return;
      isDanmakuEnabledSignal.value = event.target.checked;
      lifecycle.emit?.("danmakuSwitch", event.target.checked);
    };

    /**
     * 显示弹幕开关的提示气泡
     * emit 会同时路由到 props.onShowTooltip，不再显式调用 props 回调
     * @param event - 鼠标进入事件
     */
    const showSwitchTip = (event: Event): void => {
      if (!tooltip.element && event.target instanceof HTMLElement) {
        tooltip.element = event.target;
      }
      cancelRaf(tipInTimer!);
      tipInTimer = rafTimeout(() => {
        lifecycle.emit?.("showTooltip", tooltip);
      }, 300);
    };

    /** 隐藏弹幕开关的提示气泡（同上，避免重复触发 props 回调） */
    const hideSwitchTip = (): void => {
      cancelRaf(tipInTimer!);
      lifecycle.emit?.("hideTooltip", tooltip);
    };

    /**
     * 打开指定面板（设置面板或弹幕类型选择面板）
     * 延迟 300ms 显示的时序保留 rafTimeout；回调仅写 signal，
     * 面板 class 由渲染层 __reactiveAttrs 自动同步
     * @param panel - 面板类型，'setting' 为设置面板，'selection' 为类型选择面板
     */
    const openPanel = (panel: "setting" | "selection"): void => {
      switch (panel) {
        case "setting":
          cancelRaf(dmShowpanel.setting.hideTimer!);
          dmShowpanel.setting.showTimer = rafTimeout(() => {
            settingShowSig.value = true;
          }, 300);
          break;
        case "selection":
          cancelRaf(dmShowpanel.selection.hideTimer!);
          dmShowpanel.selection.showTimer = rafTimeout(() => {
            selectionShowSig.value = true;
          }, 300);
          break;
      }
    };

    /**
     * 关闭指定面板（设置面板或弹幕类型选择面板）
     * 延迟 300ms 隐藏的时序保留 rafTimeout；回调仅写 signal
     * @param panel - 面板类型，'setting' 为设置面板，'selection' 为类型选择面板
     */
    const closePanel = (panel: "setting" | "selection"): void => {
      switch (panel) {
        case "setting":
          cancelRaf(dmShowpanel.setting.showTimer!);
          dmShowpanel.setting.hideTimer = rafTimeout(() => {
            dmSettingApi?.resetPage();
            settingShowSig.value = false;
          }, 300);
          break;
        case "selection":
          cancelRaf(dmShowpanel.selection.showTimer!);
          dmShowpanel.selection.hideTimer = rafTimeout(() => {
            selectionShowSig.value = false;
          }, 300);
          break;
      }
    };

    // ============================================
    // API 方法
    // ============================================

    /**
     * 设置输入框的值
     * @param value - 要设置的文本值
     */
    const setInputValue = (value: string): void => {
      inputValueSignal.value = value;
      if (inputRef.value) {
        inputRef.value.value = value;
      }
    };

    /**
     * 设置弹幕开关状态
     * @param enabled - true 开启弹幕，false 关闭弹幕
     */
    const setDanmakuSwitch = (enabled: boolean): void => {
      isDanmakuEnabledSignal.value = enabled;
      if (switchInputRef.value) {
        switchInputRef.value.checked = enabled;
      }
    };

    /** 聚焦弹幕输入框 */
    const focusInput = (): void => {
      inputRef.value?.focus();
    };

    /** 让弹幕输入框失去焦点 */
    const blurInput = (): void => {
      inputRef.value?.blur();
    };

    // ============================================
    // 生命周期
    // ============================================

    /** 设置图标鼠标进入事件处理，打开设置面板 */
    const handleSettingMouseEnter = (): void => openPanel("setting");
    /** 设置图标鼠标离开事件处理，关闭设置面板 */
    const handleSettingMouseLeave = (): void => closePanel("setting");
    /** 弹幕类型图标鼠标进入事件处理，打开类型选择面板 */
    const handleTextSettingMouseEnter = (): void => openPanel("selection");
    /** 弹幕类型图标鼠标离开事件处理，关闭类型选择面板 */
    const handleTextSettingMouseLeave = (): void => closePanel("selection");

    /** 组件挂载后绑定鼠标悬停事件并对外暴露控制方法 */
    lifecycle.onMounted = (): void => {
      // 添加事件监听
      settingIconRef.value?.addEventListener(
        "mouseenter",
        handleSettingMouseEnter,
      );
      settingIconRef.value?.addEventListener(
        "mouseleave",
        handleSettingMouseLeave,
      );
      textSettingIconRef.value?.addEventListener(
        "mouseenter",
        handleTextSettingMouseEnter,
      );
      textSettingIconRef.value?.addEventListener(
        "mouseleave",
        handleTextSettingMouseLeave,
      );

      lifecycle.emit?.("sendBarMounted", {
        setInputValue,
        setDanmakuSwitch,
        focusInput,
        blurInput,
      });
    };

    /** 组件销毁前移除鼠标悬停事件监听 */
    lifecycle.onBeforeDestroy = (): void => {
      settingIconRef.value?.removeEventListener(
        "mouseenter",
        handleSettingMouseEnter,
      );
      settingIconRef.value?.removeEventListener(
        "mouseleave",
        handleSettingMouseLeave,
      );
      textSettingIconRef.value?.removeEventListener(
        "mouseenter",
        handleTextSettingMouseEnter,
      );
      textSettingIconRef.value?.removeEventListener(
        "mouseleave",
        handleTextSettingMouseLeave,
      );
    };

    // ============================================
    // 组件渲染
    // ============================================
    return h(
      "div",
      { class: "nova-player-sending-bar" },
      // 视频信息
      h(
        "div",
        { class: "nova-player-video-info" },
        h(
          "div",
          { class: "nova-player-video-info-online" },
          h("b", {}, props.onlineCount || "1000+"),
          t("player.ui.sendbar.watching"),
        ),
        h(
          "div",
          { class: "nova-player-video-info-divide" },
          t("player.ui.sendbar.divide"),
        ),
        h(
          "div",
          { class: "nova-player-video-info-dm" },
          t("player.ui.sendbar.danmaku_count", {
            count: props.danmakuCount || "0",
          }),
        ),
      ),
      // 弹幕根容器
      h(
        "div",
        { class: "nova-player-dm-root" },
        // 弹幕开关
        h(
          "div",
          { class: "nova-player-dm-switch danmaku-switch" },
          h(
            "div",
            {
              class: "switch-area",
              onMouseEnter: showSwitchTip,
              onMouseLeave: hideSwitchTip,
            },
            h("input", {
              class: "danmaku-switch-input",
              type: "checkbox",
              checked: isDanmakuEnabledSignal.value,
              ref: "switchInputRef",
              onChange: handleSwitchChange,
            }),
            h(
              "label",
              { class: "danmaku-switch-label" },
              h(
                "span",
                { class: "danmaku-switch-on" },
                // 弹幕开关图标：既有实现 icons 的 DanmakuSwitchOn SVG
                h("span", { class: "common-svg-icon" }, DanmakuSwitchOn()),
              ),
              h(
                "span",
                { class: "danmaku-switch-off" },
                // 弹幕开关图标：既有实现 icons 的 DanmakuSwitchOff SVG
                h("span", { class: "common-svg-icon" }, DanmakuSwitchOff()),
              ),
            ),
          ),
        ),
        // 弹幕设置
        h(
          "div",
          {
            class: "nova-player-dm-setting",
            ref: "settingIconRef",
          },
          // 弹幕设置图标：既有实现 icons 的 DanmakuSetting SVG
          DanmakuSetting(),
          h(
            "div",
            {
              class: [
                "nova-player-dm-setting-wrap",
                { "nova-player-dm-setting-show": settingShowSig.value },
              ],
            },
            h(
              "div",
              { class: "nova-player-dm-setting-box ui ui-panel ui-dark" },
              // 弹幕设置面板（显示区域 / 不透明度 / 字号 / 速度，写入运行时状态）
              h(DmSetting, {
                onDmSettingMounted: (api: DmSettingApi) => {
                  dmSettingApi = api;
                },
              }),
            ),
          ),
        ),
        // 输入栏
        h(
          "div",
          { class: "nova-player-video-inputbar nova-player-checkBox-hide" },
          h(
            "div",
            {
              class: "nova-player-video-inputbar-wrap",
              "data-v-risk": "fingerprint",
            },
            // 弹幕类型按钮（弹幕关闭时隐藏）
            h(
              "div",
              {
                class: "nova-player-video-btn-dm",
                style: { display: isDanmakuEnabledSignal.value ? "" : "none" },
                ref: "textSettingIconRef",
              },
              h(
                "span",
                {
                  class:
                    "nova-player-iconfont nova-player-iconfont-danmakutype",
                },
                // 弹幕类型图标：既有实现 icons 的 DanmakuTextSetting SVG
                h("span", { class: "common-svg-icon" }, DanmakuTextSetting()),
              ),
              h(
                "div",
                {
                  class: [
                    "nova-player-mode-selection-container",
                    {
                      "nova-player-mode-selection-show": selectionShowSig.value,
                    },
                  ],
                },
                // 弹幕类型选择面板（字号 / 模式 / 颜色，写入运行时状态）
                h(Selection, {}),
              ),
            ),
            // 登录提示
            props.showLoginTip
              ? h(
                  "div",
                  { class: "nova-player-dm-wrap" },
                  t("player.ui.sendbar.login_required_prefix"),
                  h(
                    "a",
                    { href: "", "data-action": "login" },
                    t("player.ui.sendbar.login"),
                  ),
                  t("player.ui.sendbar.or"),
                  h(
                    "a",
                    {
                      href: "//passport.bilibili.com/login?register_page=1",
                      target: "_blank",
                      "data-action": "login",
                    },
                    t("player.ui.sendbar.register"),
                  ),
                )
              : null,
            // 已关闭弹幕提示
            // 弹幕关闭时显示「已关闭弹幕」（同 B 站交互）
            // 使用 Show 控制流实现响应式条件渲染：子节点位置的三元表达式
            // 只在初始渲染时求值一次，无法响应 signal 变化
            h(
              Show,
              { when: (): boolean => !isDanmakuEnabledSignal.value },
              h(
                "div",
                { class: "nova-player-dm-wrap" },
                t("player.ui.sendbar.danmaku_closed"),
              ),
            ),
            // 输入框
            h("input", {
              class: "nova-player-dm-input",
              placeholder:
                props.placeholder || t("player.ui.sendbar.placeholder_default"),
              autocomplete: "off",
              // 未登录显示登录提示、弹幕关闭显示「已关闭弹幕」，
              // 两种状态都隐藏输入框（读信号响应式驱动，同上方
              // 弹幕类型按钮的 display 写法）
              style: {
                display:
                  props.showLoginTip || !isDanmakuEnabledSignal.value
                    ? "none"
                    : "block",
              },
              ref: "inputRef",
              onFocus: handleInputFocus,
              onBlur: handleInputBlur,
              onInput: handleInputChange,
              onKeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter") handleSend();
              },
            }),
          ),
          // 发送按钮
          h(
            "div",
            {
              class: [
                "nova-player-dm-btn-send",
                "nova-player-button",
                canSendSignal.value ? "" : "disabled",
              ]
                .filter(Boolean)
                .join(" "),
              "data-v-risk": "fingerprint",
              onClick: handleSend,
            },
            h("div", { class: "button-blue" }, t("player.ui.sendbar.send")),
          ),
        ),
      ),
    );
  },
);
