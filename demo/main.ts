/**
 * ============================================
 * SSR + Hydrate 演示 - 组件与状态定义（现代暗色主题）
 * ============================================
 * 此文件定义所有 demo 组件、状态管理器和事件总线
 * 不包含任何浏览器端渲染或水合逻辑
 *
 * 文件职责划分：
 *   - main.ts: 组件定义 + 状态 + 事件总线（本文件）
 *   - entry-server.ts: 服务端渲染入口（Node.js 环境执行）
 *   - entry-client.ts: 客户端水合入口（浏览器环境执行）
 *   - server.mjs: Express 服务器（真正的 SSR）
 *
 * UI 设计参考：root index.html 暗色主题（#1a1a2e + #00b4d8）
 * 图标系统：icons.ts 中的 SVG 组件，无 Unicode emoji
 *
 * 组件覆盖清单（核心 SSR + 水合测试）
 * 1.  ThemeSwitcher    - lifecycle.emit + 状态管理
 * 2.  EventLog         - ref 回调 + 事件总线
 * 3.  PlayerSection    - 页面 SSR 输出播放器占位，播放器由客户端创建挂载
 * 4.  App              - 根组件
 * 7.  RootLayout       - 根布局（注入 Context）
 */

import {
  h,
  defineComponent,
  useTemplateRef,
  createContext,
  provide,
  createTypedStateManager,
  createTypedEventBus,
  useState,
} from "@/core";
import { VideoPlayer } from "@/nova/player";

// SVG 图标组件（替代 Unicode emoji）
import {
  IconSun,
  IconMoon,
  IconSettings,
  IconTrash,
  IconTerminal,
  IconVideo,
} from "./icons";

// ============================================
// 类型定义
// ============================================

interface AppStateMap {
  "app.count": number;
  "app.theme": string;
  "app.lastAction": string;
}

interface AppEventMap {
  COUNT_INCREMENT: { count: number };
  COUNT_DECREMENT: { count: number };
  THEME_CHANGE: { theme: string };
  ACTION_LOG: { action: string; timestamp: number };
}

interface ThemeContextValue {
  primaryColor: string;
  bgColor: string;
  textColor: string;
  fontSize: string;
}

// ============================================
// Context 创建
// ============================================

const ThemeContext = createContext<ThemeContextValue>({
  primaryColor: "#00b4d8",
  bgColor: "#1a1a2e",
  textColor: "#e0e0e0",
  fontSize: "14px",
});

// ============================================
// 事件总线和状态管理器
// ============================================

export const appEventBus = createTypedEventBus<AppEventMap>();

export const appState = createTypedStateManager<AppStateMap>({
  app: {
    count: 0,
    theme: "dark",
    lastAction: "init",
  },
});

// ============================================
// 主题配置（暗色优先）
// ============================================

const darkTheme: ThemeContextValue = {
  primaryColor: "#00b4d8",
  bgColor: "#1a1a2e",
  textColor: "#e0e0e0",
  fontSize: "14px",
};

// ============================================
// 共用样式工具
// ============================================
// 所有样式已提取到 demo/styles.css
// 组件通过 class 属性引用 CSS 类名
// 子组件4：主题切换
// ============================================

interface ThemeSwitcherEvents {
  themeChange: { theme: string };
}

const ThemeSwitcher = defineComponent<
  Record<string, unknown>,
  ThemeSwitcherEvents
>((_props, lifecycle) => {
  const themeBtnRef = useTemplateRef<HTMLElement>(lifecycle, 'themeBtnRef');
  const themeIconRef = useTemplateRef<HTMLElement>(lifecycle, 'themeIconRef');
  const themeLabelRef = useTemplateRef<HTMLElement>(lifecycle, 'themeLabelRef');

  lifecycle.onMounted = () => {
    appEventBus.emit("ACTION_LOG", {
      action: "ThemeSwitcher: onMounted",
      timestamp: Date.now(),
    });

    useState(
      appState,
      "app.theme",
      (newTheme: string) => {
        const isDark = newTheme === "dark";
        if (themeLabelRef.value) {
          themeLabelRef.value.textContent = isDark ? "切换到亮色" : "切换到暗色";
        }
        // 通过 data 属性标记当前主题图标，初次的图标由 SSR 渲染决定
        if (themeIconRef.value) {
          themeIconRef.value.setAttribute(
            "data-theme-icon",
            isDark ? "moon" : "sun",
          );
        }
        if (themeBtnRef.value) {
          themeBtnRef.value.style.background = isDark
            ? "rgba(255,255,255,0.06)"
            : "rgba(255,255,255,0.18)";
        }
      },
      lifecycle,
    );
  };

  const handleToggle = () => {
    const currentTheme = appState.get("app.theme") ?? "dark";
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    appState.set("app.theme", newTheme);
    appState.set("app.lastAction", "theme-toggle");
    appEventBus.emit("THEME_CHANGE", { theme: newTheme });
    lifecycle.emit?.("themeChange", { theme: newTheme });
  };

  const isDark = (appState.get("app.theme") ?? "dark") === "dark";
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.body.dataset.theme = isDark ? "dark" : "light";
  }

  return h(
    "div",
    { class: "panel theme-switcher" },
    h("div", { class: "panel-title" }, h(IconSettings, { size: 16 }), "主题切换（lifecycle.emit）"),
    h(
      "div",
      { class: "theme-switcher-row" },
      h(
        "button",
        {
          ref: 'themeBtnRef',
          onClick: handleToggle,
          class: "btn",
          "aria-label": "切换主题",
        },
        h(
          "span",
          { ref: 'themeIconRef', class: "theme-icon-wrap" },
          isDark ? h(IconMoon, { size: 14 }) : h(IconSun, { size: 14 }),
        ),
        h("span", { ref: 'themeLabelRef' }, isDark ? "切换到亮色" : "切换到暗色"),
      ),
    ),
  );
});

// ============================================
// 子组件8：事件日志（ref 回调 + 事件总线）
// ============================================

const EventLog = defineComponent((_props, _lifecycle) => {
  return h(
    "div",
    { class: "panel event-log" },
    h(
      "div",
      { class: "panel-title-between" },
      h(
        "div",
        { class: "log-header-row" },
        h(IconTerminal, { size: 16 }),
        "事件日志（事件总线）",
      ),
      h(
        "span",
        {
          class: "log-count",
        },
        "0 条",
      ),
    ),
    h("div", {
      class: "log-content",
    }),
  );
});

// ============================================
// 子组件17：PlayerSection（VideoPlayer SSR 原生集成）
// ============================================

/**
 * VideoPlayer 实例持有者
 * - SSR 阶段：createSSRPlayer 创建实例，render() 返回 VNode 用于 renderToString
 * - 客户端水合后：同一实例的 onMounted 回调自动绑定事件到已有 DOM
 * - entry-client.ts 通过此变量访问播放器实例（切换源、销毁等）
 */
export let playerInstance: VideoPlayer | null = null;

/**
 * 更新播放器实例引用（供 entry-client.ts 切换源时调用）
 */
export function setPlayerInstance(p: VideoPlayer | null): void {
  playerInstance = p;
}

/**
 * VideoPlayer 客户端集成组件
 *
 * 页面 SSR 只输出播放器占位容器；
 * entry-client 在页面水合完成后创建并挂载播放器。
 */
const PlayerSection = defineComponent(() => {

  return h(
    "div",
    { class: "panel player-section" },
    h("div", { class: "panel-title" }, h(IconVideo, { size: 16 }), "VideoPlayer 客户端渲染 + 页面 SSR"),
    /**
     * 播放器容器
     * 页面由 SSR 输出占位容器，播放器在水合后由 entry-client 创建挂载
     */
    h(
      "div",
      {
        id: "player-wrapper",
        class: "player-wrapper",
      },
      h("div", { class: "player-empty" }, "请先添加视频来源"),
    ),
    h(
      "div",
      {
        class: "player-controls",
      },
      // 语言切换按钮组（测试 i18n 动态切换：播放器暴露 setLocale API，
      // 切换后所有 t() 文案经编译期 _reactiveText 包装精准更新 DOM）
      h(
        "button",
        {
          id: "btn-locale-zh",
          class: "btn-locale active",
        },
        "中文",
      ),
      h(
        "button",
        {
          id: "btn-locale-en",
          class: "btn-locale",
        },
        "English",
      ),
      // 运行期注册新语言包演示：点击时 registerLocale("ja-JP", ...) 后切换
      h(
        "button",
        {
          id: "btn-locale-ja",
          class: "btn-locale",
        },
        "日本語",
      ),
      // 查询当前语言：getLocale() + getLocaleSignal().value 对照
      h(
        "button",
        {
          id: "btn-locale-info",
          class: "btn-locale",
        },
        "i18n 状态",
      ),
      // 预览图模式切换：雪碧图（sprite.jpg + pvdata 裁切）↔ 逐帧（preview.bin data URL）
      // 点击不重建播放器：demo 侧用可变 provider 运行期替换数据源，下次悬停即生效
      // （active 高亮由 entry-client 水合后按当前模式 / 回退结果同步，SSR 默认雪碧图）
      h(
        "button",
        {
          id: "btn-preview-sprite",
          class: "btn-locale active",
        },
        "预览·雪碧图",
      ),
      h(
        "button",
        {
          id: "btn-preview-frames",
          class: "btn-locale",
        },
        "预览·逐帧bin",
      ),
      h(
        "button",
        {
          id: "btn-destroy-player",
          class: "btn-danger",
        },
        h(IconTrash, { size: 14 }),
        "销毁播放器",
      ),
    ),
    h(
      "section",
      {
        class: "source-card",
      },
      h("h3", { class: "source-card-title" }, "添加来源"),
      h(
        "div",
        {
          class: "source-row",
        },
        h("input", {
          id: "input-source-url",
          class: "source-input",
          placeholder: "粘贴 mpd / m3u8 链接，或 DASH/HLS JSON",
        }),
        h(
          "button",
          {
            id: "btn-add-source",
            class: "btn-accent source-btn",
          },
          "添加链接",
        ),
      ),
      h(
        "div",
        {
          class: "source-row",
        },
        h(
          "label",
          {
            class: "source-file",
          },
          h("span", { class: "source-file-label" }, "本地视频"),
          h("input", {
            id: "input-local-file",
            class: "source-file-input",
            type: "file",
            accept: "video/*",
          }),
        ),
        h(
          "label",
          {
            class: "source-file",
          },
          h("span", { class: "source-file-label" }, "JSON 清单"),
          h("input", {
            id: "input-json-file",
            class: "source-file-input",
            type: "file",
            accept: ".json,application/json",
          }),
        ),
      ),
    ),
    h(
      "section",
      {
        class: "source-card",
      },
      h("h3", { class: "source-card-title" }, "来源列表"),
      h("ul", { id: "source-list", class: "source-list" }),
    ),
    // 弹幕列表面板：mock-server 拉取的弹幕 + 本地发送的弹幕
    // （时间点 + 内容；entry-client 水合后渲染并随发送动态追加）
    h(
      "section",
      {
        class: "source-card",
      },
      h("h3", { class: "source-card-title" }, "弹幕列表（mock 拉取 + 本地发送）"),
      h("ul", { id: "danmaku-list", class: "danmaku-list" }),
    ),
    // 插件 API 演示：调用 player 公开方法 / 插件运行时 API
    // （按钮 id 由 SSR 输出，entry-client.ts 水合后绑定事件）
    h(
      "section",
      {
        class: "source-card",
      },
      h("h3", { class: "source-card-title" }, "插件 API 演示"),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h(
          "button",
          { id: "btn-danmaku-toggle", class: "btn" },
          "切换弹幕显隐",
        ),
        h(
          "button",
          { id: "btn-danmaku-opacity", class: "btn" },
          "弹幕透明度 0.5",
        ),
        h(
          "button",
          { id: "btn-subtitle-style", class: "btn" },
          "字幕字号 24px",
        ),
        h(
          "button",
          { id: "btn-subtitle-toggle", class: "btn" },
          "切换字幕显隐",
        ),
        h(
          "button",
          { id: "btn-quality-auto", class: "btn" },
          "画质 auto",
        ),
        h(
          "button",
          { id: "btn-display-wide", class: "btn" },
          "宽屏模式",
        ),
        h(
          "button",
          { id: "btn-display-normal", class: "btn" },
          "普通模式",
        ),
      ),
    ),
    // 互动视频（华强买瓜）：协议（HLS/DASH）× playurl 格式（URL/JSON）选择 +
    // 播放按钮。剧情树来自 mock-server /api/interactive/story（88 节点，带 avid
    // 引用）；分支切换由互动视频插件驱动，播放地址经 /api/interactive/playurl
    // 按（avid + 所选协议 + 所选格式）按需解析（对齐 B 站互动视频标准做法）
    h(
      "section",
      {
        class: "source-card",
      },
      h(
        "h3",
        { class: "source-card-title" },
        "互动视频 · 华强买瓜（协议 × playurl 格式）",
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h(
          "button",
          { id: "btn-hq-protocol-hls", class: "btn" },
          "协议：HLS",
        ),
        h(
          "button",
          { id: "btn-hq-protocol-dash", class: "btn" },
          "协议：DASH",
        ),
        h(
          "button",
          { id: "btn-hq-format-url", class: "btn" },
          "格式：URL",
        ),
        h(
          "button",
          { id: "btn-hq-format-json", class: "btn" },
          "格式：JSON",
        ),
        h(
          "button",
          { id: "btn-hq-play", class: "btn" },
          "播放互动视频",
        ),
      ),
      // 状态行：剧情树加载进度 / 协议格式生效组合 / 接口报错信息
      h("div", { id: "hq-status", class: "hq-status" }, "未加载剧情树"),
    ),
    // 交互卡片：展示 / 编辑双模式切换 + 运行期添加表单
    // 展示模式（默认）：卡片按时间窗口纯展示，注册全部交互监听
    // 编辑模式：卡片常驻可拖拽，点击类监听不注册
    // 切换实现：mode 为构造期配置 → 卸载旧实例 + 携带数据快照重建
    h(
      "section",
      {
        class: "source-card",
      },
      h("h3", { class: "source-card-title" }, "交互卡片 · 展示 / 编辑模式"),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h(
          "button",
          { id: "btn-interaction-view", class: "btn" },
          "展示模式",
        ),
        h(
          "button",
          { id: "btn-interaction-edit", class: "btn" },
          "编辑模式",
        ),
      ),
      // 运行期添加卡片表单（两模式均可用）：时间窗可手填或一键取当前
      // 播放时间，类型专属字段由 entry-client 按下拉选择动态渲染
      h(
        "div",
        {
          id: "interaction-add-form",
          class: "ice-form",
        },
        h(
          "div",
          { class: "ice-field" },
          h("span", { class: "ice-label" }, "卡片类型"),
          h(
            "select",
            { id: "ice-add-type", class: "ice-select" },
            h("option", { value: "guide" }, "点赞关注卡片"),
            h("option", { value: "link" }, "外链卡片"),
            h("option", { value: "vote" }, "投票卡片"),
            h("option", { value: "score" }, "评分卡片"),
            h("option", { value: "scoreSum" }, "评分总结卡片"),
          ),
        ),
        h(
          "div",
          { class: "ice-field" },
          h("span", { class: "ice-label" }, "起始(秒)"),
          h("input", {
            id: "ice-add-start",
            class: "ice-input ice-num",
            type: "number",
            step: "0.1",
            min: "0",
            placeholder: "默认当前时间",
          }),
          h(
            "button",
            { id: "btn-ice-start-now", class: "ice-mini", type: "button" },
            "取当前",
          ),
        ),
        h(
          "div",
          { class: "ice-field" },
          h("span", { class: "ice-label" }, "结束(秒)"),
          h("input", {
            id: "ice-add-end",
            class: "ice-input ice-num",
            type: "number",
            step: "0.1",
            min: "0",
            placeholder: "默认起始+10",
          }),
          h(
            "button",
            { id: "btn-ice-end-now", class: "ice-mini", type: "button" },
            "取当前",
          ),
        ),
        h(
          "div",
          { class: "ice-field" },
          h("span", { class: "ice-label" }, "顶部(%)"),
          h("input", {
            id: "ice-add-top",
            class: "ice-input ice-num",
            type: "number",
            step: "1",
            min: "0",
            max: "100",
            placeholder: "40",
          }),
          h("span", { class: "ice-label ice-label-gap" }, "左侧(%)"),
          h("input", {
            id: "ice-add-left",
            class: "ice-input ice-num",
            type: "number",
            step: "1",
            min: "0",
            max: "100",
            placeholder: "50",
          }),
        ),
        // 类型专属字段容器：entry-client 按下拉选择动态渲染
        // （guide 类型 / link 文案 / vote 问题+选项 / score 标题+图标）
        h("div", { id: "ice-add-kind-fields" }),
        h(
          "button",
          { id: "btn-ice-add", class: "btn", type: "button" },
          "添加卡片",
        ),
      ),
      // 通用工具行（展示 / 编辑两模式均可用）：
      // updateData 重置 / closeCard 关闭首个卡片 / getContainer 查询容器 /
      // getStatus 导出数据
      h(
        "div",
        {
          id: "interaction-extra-row",
          class: "demo-btn-row",
        },
        h(
          "button",
          { id: "btn-interaction-reset", class: "btn" },
          "重置交互数据",
        ),
        h(
          "button",
          { id: "btn-interaction-close", class: "btn" },
          "关闭首个卡片",
        ),
        h(
          "button",
          { id: "btn-interaction-container", class: "btn" },
          "获取交互容器",
        ),
        h(
          "button",
          { id: "btn-interaction-dump", class: "btn" },
          "导出交互数据",
        ),
      ),
      // 内容编辑面板：仅编辑模式显示，entry-client 水合后按
      // getStatus() 动态渲染每张卡片的编辑表单（时间窗 / 定位 / 文本，
      // change 提交调 updateCardContent，结构操作后全量重建面板）
      h("div", {
        id: "interaction-content-panel",
        class: "interaction-content-panel is-hidden",
      }),
    ),
    // 弹幕插件运行时 API 全量演示（DanmakuPluginAPI 27 个方法）：
    // 控制（send/sendBatch/play/pause/stop/clear/seek/getStats/getManager）
    // 渲染样式（setRenderMode/setFontSize/setAutoScale/setMaskConfig/setFilter/setScreenMode）
    // 参数与数据源（setSpeed/setSpeedMultiplier/setArea/setAreaRatio/setDensity/load/loadDanmaku）
    // （setVisible/setOpacity 经上方播放器级按钮 setDanmakuVisible/setDanmakuOpacity 覆盖）
    h(
      "section",
      {
        class: "source-card",
      },
      h("h3", { class: "source-card-title" }, "弹幕插件 API 演示"),
      h(
        "div",
        { class: "demo-btn-row" },
        h("button", { id: "btn-dm-send", class: "btn" }, "插件发送弹幕"),
        h("button", { id: "btn-dm-sendbatch", class: "btn" }, "插件批量发送"),
        h("button", { id: "btn-dm-pause", class: "btn" }, "弹幕动画暂停"),
        h("button", { id: "btn-dm-play", class: "btn" }, "弹幕动画恢复"),
        h("button", { id: "btn-dm-stop", class: "btn" }, "停止弹幕调度"),
        h("button", { id: "btn-dm-clear", class: "btn" }, "清空屏幕弹幕"),
        h("button", { id: "btn-dm-seek", class: "btn" }, "重置弹幕调度"),
        h("button", { id: "btn-dm-stats", class: "btn" }, "弹幕性能统计"),
      ),
      h(
        "div",
        { class: "demo-btn-row" },
        h("button", { id: "btn-dm-render", class: "btn" }, "切换渲染引擎"),
        h("button", { id: "btn-dm-font", class: "btn" }, "切换字号档位"),
        h("button", { id: "btn-dm-autoscale", class: "btn" }, "随屏缩放开/关"),
        h("button", { id: "btn-dm-mask", class: "btn" }, "智能防挡开/关"),
        h("button", { id: "btn-dm-filter", class: "btn" }, "循环类型过滤"),
        h("button", { id: "btn-dm-screen", class: "btn" }, "弹幕屏幕模式"),
      ),
      h(
        "div",
        { class: "demo-btn-row" },
        h("button", { id: "btn-dm-speedgear", class: "btn" }, "速度档位循环"),
        h("button", { id: "btn-dm-speedmul", class: "btn" }, "速度倍率循环"),
        h("button", { id: "btn-dm-area", class: "btn" }, "区域档位/比例"),
        h("button", { id: "btn-dm-density", class: "btn" }, "弹幕密度循环"),
        h("button", { id: "btn-dm-fontscale", class: "btn" }, "字号缩放循环"),
        h("button", { id: "btn-dm-resize", class: "btn" }, "重算弹幕布局"),
        h("button", { id: "btn-dm-load", class: "btn" }, "重装弹幕数据源"),
        h("button", { id: "btn-dm-loaddanmaku", class: "btn" }, "直接装填弹幕"),
      ),
    ),
    // 字幕插件运行时 API 全量演示（SubtitlePluginAPI）：
    // AI 识别（isAiEnabled/enableAi/disableAi/startLocalAi/stopLocalAi/
    //         switchLocalAiLanguage/refreshAiSubtitle/refreshRange）
    // 状态查询（getCurrentSubtitle/getFullTranscript/listTracks/activateTrack/
    //          setTranslationTrack/getStatus）
    // 样式与数据源（setStyle/setFontSize/setColor/setBackgroundColor/setStroke/
    //               setPosition/setOffset/switchLanguage/toggle/show/hide/
    //               seek/load/unload）
    h(
      "section",
      {
        class: "source-card",
      },
      h("h3", { class: "source-card-title" }, "字幕插件 API 演示"),
      h(
        "div",
        { class: "demo-btn-row" },
        h("button", { id: "btn-sub-ai", class: "btn" }, "AI 字幕总开关"),
        h("button", { id: "btn-sub-localai-start", class: "btn" }, "启动本地识别"),
        h("button", { id: "btn-sub-localai-stop", class: "btn" }, "停止本地识别"),
        h("button", { id: "btn-sub-localai-lang", class: "btn" }, "切换识别语言"),
        h("button", { id: "btn-sub-refresh", class: "btn" }, "刷新识别/区间"),
      ),
      h(
        "div",
        { class: "demo-btn-row" },
        h("button", { id: "btn-sub-current", class: "btn" }, "当前字幕"),
        h("button", { id: "btn-sub-transcript", class: "btn" }, "完整字幕稿"),
        h("button", { id: "btn-sub-tracks", class: "btn" }, "字幕轨列表"),
        h("button", { id: "btn-sub-track-next", class: "btn" }, "切换激活轨"),
        h("button", { id: "btn-sub-translation", class: "btn" }, "翻译轨开/关"),
        h("button", { id: "btn-sub-status", class: "btn" }, "字幕插件状态"),
      ),
      h(
        "div",
        { class: "demo-btn-row" },
        h("button", { id: "btn-sub-style", class: "btn" }, "循环字幕配色"),
        h("button", { id: "btn-sub-pos", class: "btn" }, "循环字幕位置"),
        h("button", { id: "btn-sub-offset", class: "btn" }, "循环字幕偏移"),
        h("button", { id: "btn-sub-langswitch", class: "btn" }, "切换语言轨"),
        h("button", { id: "btn-sub-toggle", class: "btn" }, "字幕显隐切换"),
        h("button", { id: "btn-sub-load", class: "btn" }, "装填内联字幕"),
        h("button", { id: "btn-sub-unload", class: "btn" }, "卸载字幕"),
        h("button", { id: "btn-sub-seek", class: "btn" }, "字幕重定位"),
      ),
    ),
    // 分段进度条运行时编辑：分段数据经构造配置 progress.segments 传入，
    // 运行时更新走 player.setConfig({ progress: { segments } }) 深合并，
    // 播放器内部 syncSegmentsToControls 同步到进度条控件；
    // 添加表单支持手填时间点 / 一键取当前播放时间 / 选择插入位置
    // （末尾追加 / 开头插入 / 在指定段之前），列表行内可直接改
    // 标题与起止时间（change 提交，实时生效）
    h(
      "section",
      {
        class: "source-card",
      },
      h("h3", { class: "source-card-title" }, "分段进度条 API"),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h(
          "button",
          { id: "btn-seg-reset", class: "btn" },
          "重新拉取分段",
        ),
        h(
          "button",
          { id: "btn-seg-apply", class: "btn" },
          "应用分段 (setConfig)",
        ),
      ),
      // 添加分段表单：文字 / 起止时间（取当前播放时间）/ 插入位置
      h(
        "div",
        {
          id: "segment-add-form",
          class: "ice-form",
        },
        h(
          "div",
          { class: "ice-field" },
          h("span", { class: "ice-label" }, "分段文字"),
          h("input", {
            id: "seg-add-label",
            class: "ice-input",
            type: "text",
            placeholder: "默认「分段N」",
          }),
        ),
        h(
          "div",
          { class: "ice-field" },
          h("span", { class: "ice-label" }, "起始(秒)"),
          h("input", {
            id: "seg-add-start",
            class: "ice-input ice-num",
            type: "number",
            step: "0.1",
            min: "0",
            placeholder: "默认当前时间",
          }),
          h(
            "button",
            { id: "btn-seg-start-now", class: "ice-mini", type: "button" },
            "取当前",
          ),
        ),
        h(
          "div",
          { class: "ice-field" },
          h("span", { class: "ice-label" }, "结束(秒)"),
          h("input", {
            id: "seg-add-end",
            class: "ice-input ice-num",
            type: "number",
            step: "0.1",
            min: "0",
            placeholder: "默认起始+30",
          }),
          h(
            "button",
            { id: "btn-seg-end-now", class: "ice-mini", type: "button" },
            "取当前",
          ),
        ),
        h(
          "div",
          { class: "ice-field" },
          h("span", { class: "ice-label" }, "插入位置"),
          // 选项由 entry-client 按 demoSegments 动态维护
          // （末尾追加 / 插入到最前 / 在指定段之前）
          h("select", { id: "seg-add-pos", class: "ice-select" }),
        ),
        h(
          "button",
          { id: "btn-seg-add-form", class: "btn", type: "button" },
          "添加分段",
        ),
      ),
      // 分段列表面板：entry-client 水合后按 demoSegments 渲染
      // （标题 / 起止时间行内编辑 + 删除按钮），结构操作后全量重建
      h("div", { id: "segment-list", class: "seg-list-panel" }),
    ),
    // 播放器核心 API 全量演示（VideoPlayer 公开方法）：
    // 播放控制 / 音量 / 倍速循环 / 画面 / 设置 / 画质 / 播放列表 /
    // 状态查询 / 弹幕与字幕代理 / 插件与事件 / setConfig 深合并
    h(
      "section",
      {
        class: "source-card",
      },
      h("h3", { class: "source-card-title" }, "播放器核心 API"),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-play", class: "btn" }, "播放 play()"),
        h("button", { id: "btn-api-pause", class: "btn" }, "暂停 pause()"),
        h("button", { id: "btn-api-toggle", class: "btn" }, "播放/暂停切换"),
        h("button", { id: "btn-api-seek", class: "btn" }, "跳到当前+30s"),
        h("button", { id: "btn-api-seekby", class: "btn" }, "相对跳转 +10s"),
        h("button", { id: "btn-api-reload", class: "btn" }, "重新加载"),
        h("button", { id: "btn-api-autoplay", class: "btn" }, "尝试自动播放"),
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-volume", class: "btn" }, "音量轮换"),
        h("button", { id: "btn-api-getvolume", class: "btn" }, "查音量"),
        h("button", { id: "btn-api-mute", class: "btn" }, "静音切换"),
        h("button", { id: "btn-api-setmuted", class: "btn" }, "设置静音轮换"),
        h("button", { id: "btn-api-ismuted", class: "btn" }, "是否静音"),
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-rate", class: "btn" }, "倍速轮换"),
        h("button", { id: "btn-api-getrate", class: "btn" }, "查倍速"),
        h("button", { id: "btn-api-loop", class: "btn" }, "循环开关"),
        h("button", { id: "btn-api-playmode", class: "btn" }, "播放模式轮换"),
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-fullscreen", class: "btn" }, "全屏切换"),
        h("button", { id: "btn-api-isfullscreen", class: "btn" }, "全屏状态"),
        h("button", { id: "btn-api-webfs", class: "btn" }, "网页全屏切换"),
        h("button", { id: "btn-api-iswebfs", class: "btn" }, "网页全屏状态"),
        h("button", { id: "btn-api-pip", class: "btn" }, "画中画切换"),
        h("button", { id: "btn-api-enterpip", class: "btn" }, "进入画中画"),
        h("button", { id: "btn-api-exitpip", class: "btn" }, "退出画中画"),
        h("button", { id: "btn-api-displaymode", class: "btn" }, "显示模式轮换"),
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-mirror", class: "btn" }, "镜像开关"),
        h("button", { id: "btn-api-autostart", class: "btn" }, "自动连播开关"),
        h("button", { id: "btn-api-lightoff", class: "btn" }, "关灯开关"),
        h("button", { id: "btn-api-ratio", class: "btn" }, "画面比例轮换"),
        h("button", { id: "btn-api-codec", class: "btn" }, "编码偏好轮换"),
        h("button", { id: "btn-api-loudness", class: "btn" }, "音量均衡轮换"),
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-getquality", class: "btn" }, "当前画质"),
        h("button", { id: "btn-api-qualities", class: "btn" }, "画质列表"),
        h("button", { id: "btn-api-qualitymode", class: "btn" }, "画质能力"),
        h("button", { id: "btn-api-setqualitymode", class: "btn" }, "画质模式轮换"),
        h("button", { id: "btn-api-qualitylimits", class: "btn" }, "画质上限 2000"),
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-next", class: "btn" }, "下一集"),
        h("button", { id: "btn-api-prev", class: "btn" }, "上一集"),
        h("button", { id: "btn-api-playlist", class: "btn" }, "播放列表"),
        h("button", { id: "btn-api-index", class: "btn" }, "当前索引"),
        h("button", { id: "btn-api-poster", class: "btn" }, "设置封面"),
        h("button", { id: "btn-api-load", class: "btn" }, "加载首项源"),
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-time", class: "btn" }, "当前时间"),
        h("button", { id: "btn-api-duration", class: "btn" }, "总时长"),
        h("button", { id: "btn-api-buffered", class: "btn" }, "缓冲进度"),
        h("button", { id: "btn-api-ispause", class: "btn" }, "是否暂停"),
        h("button", { id: "btn-api-isplaying", class: "btn" }, "是否播放中"),
        h("button", { id: "btn-api-resize", class: "btn" }, "广播尺寸"),
        h("button", { id: "btn-api-state", class: "btn" }, "状态快照"),
        h("button", { id: "btn-api-config", class: "btn" }, "playback 配置"),
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-dmvisible", class: "btn" }, "弹幕显隐轮换"),
        h("button", { id: "btn-api-dmvisstate", class: "btn" }, "弹幕显隐状态"),
        h("button", { id: "btn-api-dmspeed", class: "btn" }, "弹幕速度轮换"),
        h("button", { id: "btn-api-dmsource", class: "btn" }, "弹幕数据源"),
        h("button", { id: "btn-api-dmclear", class: "btn" }, "清空弹幕"),
        h("button", { id: "btn-api-dmsend", class: "btn" }, "发送弹幕"),
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-subvisible", class: "btn" }, "字幕显隐轮换"),
        h("button", { id: "btn-api-subvisstate", class: "btn" }, "字幕显隐状态"),
        h("button", { id: "btn-api-sublang", class: "btn" }, "字幕语言轮换"),
        h("button", { id: "btn-api-sublist", class: "btn" }, "装填内联字幕轨"),
      ),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-api-pluginapi", class: "btn" }, "弹幕插件实例"),
        h("button", { id: "btn-api-once", class: "btn" }, "once 绑定 play"),
        h("button", { id: "btn-api-onoff", class: "btn" }, "on/off 切换 pause"),
        h("button", { id: "btn-api-applysetting", class: "btn" }, "设置项 loop 轮换"),
        h("button", { id: "btn-api-setconfig", class: "btn" }, "setConfig 音量 0.8"),
      ),
    ),
    // 音效插件 API（AudioEffectPlugin，经 getPluginAPI("audioEffect") 获取）：
    // 五种效果开关（EQ/混响/A3D/电话/压缩器）、EQ 与混响预设、
    // 音效音量（dB）、组合预设、效果列表与效果链查询
    h(
      "section",
      {
        class: "source-card",
      },
      h("h3", { class: "source-card-title" }, "音效插件 API"),
      h(
        "div",
        {
          class: "demo-btn-row",
        },
        h("button", { id: "btn-ae-eq", class: "btn" }, "EQ 开/关"),
        h("button", { id: "btn-ae-reverb", class: "btn" }, "混响 开/关"),
        h("button", { id: "btn-ae-a3d", class: "btn" }, "A3D 开/关"),
        h("button", { id: "btn-ae-phone", class: "btn" }, "电话 开/关"),
        h("button", { id: "btn-ae-compressor", class: "btn" }, "压缩器 开/关"),
        h("button", { id: "btn-ae-eqpreset", class: "btn" }, "EQ 预设轮换"),
        h("button", { id: "btn-ae-revpreset", class: "btn" }, "混响预设轮换"),
        h("button", { id: "btn-ae-volume", class: "btn" }, "音效音量轮换"),
        h("button", { id: "btn-ae-combo", class: "btn" }, "组合预设轮换"),
        h("button", { id: "btn-ae-list", class: "btn" }, "效果名列表"),
        h("button", { id: "btn-ae-chain", class: "btn" }, "效果链状态"),
      ),
    ),
    h(
      "p",
      {
        class: "player-description",
      },
      "页面由 SSR 输出，播放器完全在客户端水合后创建挂载；视频源切换走 switchTo / refresh，不重建播放器。",
    ),
  );
});

// ============================================
// 根应用组件
// ============================================

const App = defineComponent((_props, lifecycle) => {
  const appRootRef = useTemplateRef<HTMLElement>(lifecycle, 'appRootRef');

  /**
   * 生成主题 CSS 自定义属性
   * 默认暗色主题（#1a1a2e + #00b4d8）
   */
  const getThemeVars = (isDark: boolean): Record<string, string> => ({
    "--accent": isDark ? "#00b4d8" : "#1976D2",
    "--accent-hover": isDark ? "#0096b7" : "#1565C0",
    "--bg-base": isDark ? "#1a1a2e" : "#f5f5f5",
    "--panel-bg": isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
    "--btn-bg": isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
    "--border-color": isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
    "--text-primary": isDark ? "#e0e0e0" : "#333333",
    "--text-secondary": isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
    "--font-size": "14px",
  });

  lifecycle.onMounted = () => {
    appEventBus.emit("ACTION_LOG", {
      action: "App: onMounted (水合完成)",
      timestamp: Date.now(),
    });

    useState(
      appState,
      "app.theme",
      (newTheme: string) => {
        const isDark = newTheme === "dark";
        const vars = getThemeVars(isDark);
        if (typeof document !== "undefined") {
          document.documentElement.dataset.theme = newTheme;
          document.body.dataset.theme = newTheme;
        }
        if (appRootRef.value) {
          for (const [key, value] of Object.entries(vars)) {
            appRootRef.value.style.setProperty(key, value);
          }
        }
      },
      lifecycle,
    );
  };

  const isDark = (appState.get("app.theme") ?? "dark") === "dark";
  const themeVars = getThemeVars(isDark);

  return h(
    "div",
    {
      class: "app-root",
      ref: 'appRootRef',
      style: themeVars,
    },
    // ===== 顶部标题 =====
    h(
      "header",
      {
        class: "app-header",
      },
      h(
        "h1",
        {
          class: "app-title",
        },
        "Lumina Framework",
      ),
      h(
        "p",
        {
          class: "app-subtitle",
        },
        "SSR + Hydrate 全功能验证 · VideoPlayer 集成测试",
      ),
    ),

    // ===== 主内容区 =====
    h(
      "main",
      {
        class: "app-main",
      },
      // VideoPlayer 集成测试
      h(PlayerSection, {}),

      // 主题切换
      h(ThemeSwitcher, {}),


      // 事件日志
      h(EventLog, {}),
    ),

    // ===== 底部 =====
    h(
      "footer",
      {
        class: "app-footer",
      },
      "Lumina Framework SSR + Hydrate Demo · 暗色主题 · SVG 图标",
    ),
  );
});

// ============================================
// 根布局组件
// ============================================

export const RootLayout = defineComponent(() => {
  return h(
    "div",
    {},
    provide(
      [{ contextId: ThemeContext.id, value: darkTheme }],
      () => h(App, {}),
    ),
  );
});
