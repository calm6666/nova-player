/**
 * ============================================
 * 控制栏 Hi-Res 图标 · 独立测试页
 * ============================================
 * 覆盖 5 个可截图状态：
 *   ① 普通态（未激活 + 大会员徽标，点击走会员引导占位）
 *   ② hover tooltip（真实鼠标悬停触发，TopCenter / gap 19 / slotMode）
 *   ③ 激活态（state-active 图标变蓝，提示切为「关闭Hi-Res无损音质」）
 *   ④ 会员标签（withoutVip →「限免中」，点击允许切换 FLAC）
 *   ⑤ 全屏间距（data-screen=full → TopCenter gap 28）
 *
 * 页面复用真实组件链路：Controls（hover 委托）→ Tooltips（提示渲染）。
 * 访问：http://localhost:5173/demo/hires-control/index.html
 */

import {
  h,
  defineComponent,
  mount,
  signal,
  initI18n,
  t,
  For,
  Show,
} from "@/core";
import type { VNode } from "@/types";
import { Controls } from "@/nova/components/Controls";
import { Tooltips } from "@/nova/components/Tooltips";
import type {
  HiResAuthState,
  HiResClickPayload,
  HiResGuideRequest,
} from "@/nova/components/RightControls";
import type { Tooltip } from "@/nova/types";
import zhCN from "../../locales/zh-CN.json";
import enUS from "../../locales/en-US.json";
import "@/styles/style.scss";
import "./style.css";

// ============================================
// i18n：测试页固定中文（与线上现场一致）
// ============================================

initI18n({
  enabled: true,
  locale: "zh-CN",
  fallbackLocale: "en-US",
  messages: { "zh-CN": zhCN, "en-US": enUS },
});

// ============================================
// Tooltips 组件挂载后暴露的 API 子集
// ============================================

interface TooltipsApi {
  openTip: (btnElement: HTMLElement | null, name: string) => void;
  closeTip: (name: string) => void;
  updateTip: (name: string, text: string) => void;
  updateTipKey: (name: string, key: string) => void;
  setScreen: (screen: "normal" | "full" | "web") => void;
  hideAll: () => void;
}

// ============================================
// 用例配置
// ============================================

interface HiResCaseConfig {
  /** 用例标识（同时作为 section 的 id：case-<key>） */
  key: string;
  /** 用例标题 */
  title: string;
  /** 状态说明 */
  desc: string;
  /** Hi-Res 鉴权快照（缺省视为已登录且具备权限） */
  hiResAuth?: HiResAuthState;
  /** Hi-Res 初始激活态 */
  hiResActive?: boolean;
  /** 挂载后自动打开 tooltip（用于静态截图；hover 用例由截图脚本真实悬停） */
  autoOpenTooltip: boolean;
  /** 是否模拟全屏（data-screen=full，验证 gap 28） */
  fullscreen?: boolean;
}

interface HiResCaseProps extends HiResCaseConfig {
  /** 记录交互（页面底部日志） */
  onLog: (line: string) => void;
  /** 挂载并完成 tooltip 初始化后回调（截图脚本等待全部就绪） */
  onReady: () => void;
}

const HIRES_CASES: HiResCaseConfig[] = [
  {
    key: "normal",
    title: "① 普通态",
    desc: "未激活 + 大会员徽标；点击无会员权限 → 会员引导占位（见页面底部日志）",
    hiResAuth: { loggedIn: true, withoutVip: false },
    autoOpenTooltip: false,
  },
  {
    key: "hover",
    title: "② Hover tooltip",
    desc: "真实鼠标悬停 300ms：TopCenter / gap 19 / slotMode 内联徽标",
    autoOpenTooltip: false,
  },
  {
    key: "active",
    title: "③ 激活态",
    desc: "FLAC 已开启：state-active 图标变主色，提示文案切为「关闭Hi-Res无损音质」",
    hiResActive: true,
    autoOpenTooltip: true,
  },
  {
    key: "trial",
    title: "④ 会员标签（限免中）",
    desc: "withoutVip 快照：tooltip 徽标显示「限免中」，点击允许切换 FLAC",
    hiResAuth: { loggedIn: true, withoutVip: true },
    autoOpenTooltip: true,
  },
  {
    key: "full",
    title: "⑤ 全屏间距",
    desc: "data-screen=full：TopCenter 间距 28（非全屏 19）",
    autoOpenTooltip: true,
    fullscreen: true,
  },
];

// ============================================
// 单个用例卡片
// ============================================

const HiResCase = defineComponent<HiResCaseProps>((props, lifecycle) => {
  /** Tooltips 挂载后填充的 API */
  const tooltipsApi: Partial<TooltipsApi> = {};

  /** 控制栏舞台（tooltip 触发按钮的检索根节点） */
  let stageEl: HTMLElement | null = null;

  /** 转发 tooltip 显示（Controls 委托触发 → 本用例的 Tooltips 渲染） */
  const showTooltip = (tip: Tooltip): void => {
    tooltipsApi.openTip?.(tip.element, tip.dataName);
  };

  /** 转发 tooltip 隐藏 */
  const hideTooltip = (tip: Tooltip): void => {
    tooltipsApi.closeTip?.(tip.dataName);
  };

  /** Hi-Res 切换事件（宿主占位：真实项目在此调用 FLAC 音质切换） */
  const onHiResClick = (payload: HiResClickPayload): void => {
    props.onLog(
      `Hi-Res 切换：${payload.active ? "开启" : "关闭"} FLAC（quality=${payload.quality}）`,
    );
  };

  /** 未登录 → 快捷登录占位 */
  const onHiResLoginRequired = (): void => {
    props.onLog("Hi-Res 点击：未登录 → requestQuickLogin()（占位）");
  };

  /** 无会员权限 → 会员引导占位 */
  const onHiResGuide = (payload: HiResGuideRequest): void => {
    props.onLog(
      `Hi-Res 点击：无权限 → 会员引导（subtitle=${t(payload.subtitleKey)} / appId=${payload.appId} / appSubId=${payload.appSubId} / quality=${payload.quality} / qn=${payload.qn}）`,
    );
  };

  lifecycle.onMounted = (): void => {
    // 全屏用例：先同步屏幕模式，Tooltips 才会按 gap.full 定位
    if (props.fullscreen) tooltipsApi.setScreen?.("full");
    requestAnimationFrame(() => {
      if (props.autoOpenTooltip && stageEl) {
        const button = stageEl.querySelector<HTMLElement>(
          ".nova-player-ctrl-flac",
        );
        if (button) tooltipsApi.openTip?.(button, "ctrl:flac");
      }
      props.onReady();
    });
  };

  return h(
    "section",
    { class: "hires-case", id: `case-${props.key}` },
    h(
      "header",
      { class: "hires-case-header" },
      h("span", { class: "hires-case-badge" }, props.title),
      h("span", { class: "hires-case-desc" }, props.desc),
    ),
    h(
      "div",
      {
        class: "hires-stage nova-player-docker",
        ref: (el: unknown) => {
          if (el instanceof HTMLElement) stageEl = el;
        },
      },
      h(
        "div",
        {
          class: "nova-player-container",
          "data-screen": props.fullscreen ? "full" : "normal",
        },
        h(Controls, {
          duration: 754,
          volume: 0.7,
          backrate: 1,
          hiRes: true,
          hiResAuth: props.hiResAuth,
          hiResActive: props.hiResActive,
          onShowTooltip: showTooltip,
          onHideTooltip: hideTooltip,
          onHiResClick,
          onHiResLoginRequired,
          onHiResGuide,
        }),
        h(Tooltips, {
          onTooltipsMounted: (api: TooltipsApi) => {
            Object.assign(tooltipsApi, api);
          },
        }),
      ),
    ),
  );
});

// ============================================
// 页面根组件
// ============================================

const App = defineComponent((_props, _lifecycle) => {
  /** 交互日志（点击 Hi-Res 后由用例回调写入） */
  const logSignal = signal<string[]>([]);
  /** 已就绪用例数 */
  const readySignal = signal<number>(0);

  const pushLog = (line: string): void => {
    logSignal.value = [...logSignal.value, `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${line}`];
  };

  const markReady = (): void => {
    readySignal.value += 1;
    if (readySignal.value >= HIRES_CASES.length) {
      // 截图脚本等待该属性出现后再开始悬停 / 截图
      document.documentElement.dataset.hiresReady = "true";
    }
  };

  return h(
    "main",
    { class: "hires-page" },
    h(
      "header",
      { class: "hires-page-header" },
      h("h1", { class: "hires-page-title" }, "控制栏 · Hi-Res 无损音质图标"),
      h(
        "p",
        { class: "hires-page-subtitle" },
        "复用真实 Controls + Tooltips 组件链路：hover 委托 300ms 显示，TopCenter 定位，",
        "slotMode 徽标（大会员 / 限免中），激活态 state-active 切换图标主色与提示文案。",
        h("br"),
        "访问地址：",
        h("code", {}, "http://localhost:5173/demo/hires-control/index.html"),
      ),
    ),
    h(
      "div",
      { class: "hires-cases" },
      ...HIRES_CASES.map((config: HiResCaseConfig) =>
        h(HiResCase, { ...config, onLog: pushLog, onReady: markReady }),
      ),
    ),
    h(
      "section",
      { class: "hires-log" },
      h("h2", { class: "hires-log-title" }, "交互日志（点击 Hi-Res 按钮验证登录 / 会员引导占位）"),
      h(
        Show,
        { when: () => logSignal.value.length === 0 },
        h(
          "p",
          { class: "hires-log-empty" },
          "暂无交互。点击 ① 可看到无权限会员引导；点击 ② / ④ 可看到 FLAC 切换回调。",
        ),
      ),
      h(
        "ul",
        { class: "hires-log-list" },
        h(For, {
          each: () => logSignal.value,
          key: (line: string, index: number): string => `${index}-${line}`,
          render: (line: string): VNode => h("li", {}, line),
        }),
      ),
    ),
  );
});

// ============================================
// 挂载
// ============================================

const root = document.getElementById("app");
if (!root) {
  throw new Error("Hi-Res 测试页缺少 #app 根节点");
}

mount(h(App), root);
