/**
 * ============================================
 * @lumina/ui 组件测试页（模拟数据 + 深色主题切换）
 * ============================================
 */

import { h, mount } from "@lumina/framework/core";
import type { VNode } from "@lumina/framework/types";
import "../src/styles/index.scss";

import {
  Button,
  Checkbox,
  Radio,
  Switch,
  DanmakuSwitch,
  Input,
  Collapse,
  Dialog,
  Menu,
  Dropdown,
  Tabs,
  Panel,
  DynamicPanel,
  LongList,
  Swiper,
  Slider,
  Progress,
  CircleProgress,
  CloseButton,
  ColorPicker,
  Select,
} from "../src/index";

const app = document.getElementById("app")!;

const card = (title: string, ...children: Array<VNode | string | null>): VNode =>
  h(
    "div",
    { class: "demo-card" },
    h("div", { class: "demo-title" }, title),
    h("div", { class: "demo-body" }, ...children),
  );

const wide = (node: VNode): VNode => h("div", { style: { width: "100%" } }, node);

const cover = (label: string, color: string): string =>
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="234" height="178"><rect width="234" height="178" fill="${color}"/><text x="50%" y="52%" fill="#fff" font-size="18" text-anchor="middle">${label}</text></svg>`,
  );

const buildView = (): VNode => h(
  "div",
  { class: "demo-page" },
  card("Button", ...([
    h(Button, { text: "默认 white" }),
    h(Button, { text: "blue", type: "blue" }),
    h(Button, { text: "blue2", type: "blue2" }),
    h(Button, { text: "gray", type: "gray" }),
    h(Button, { text: "yellow", type: "yellow" }),
    h(Button, { text: "禁用", type: "blue", disabled: true }),
  ] as VNode[])),
  card("Checkbox", ...([
    h(Checkbox, { name: "接收推送", value: true, onChange: (v) => console.log("checkbox", v) }),
    h(Checkbox, { name: "带红点", value: false, redDot: true }),
    h(Checkbox, { name: "禁用", value: true, disabled: true }),
  ] as VNode[])),
  card("Radio（normal）", h(Radio, {
    dark,
    value: 1,
    labels: [
      { value: 1, name: "选项一" },
      { value: 2, name: "选项二" },
      { value: 3, name: "选项三" },
    ],
    onChange: (v) => console.log("radio", v),
  })),
  card("Radio（button）", h(Radio, {
    dark,
    value: "b",
    style: "button",
    labels: [
      { value: "a", name: "A" },
      { value: "b", name: "B" },
      { value: "c", name: "C" },
    ],
  })),
  card("Switch", ...([
    h(Switch, { name: "弹幕开关", value: true }),
    h(Switch, { name: "红点", value: false, redDot: true }),
    h(Switch, { name: "禁用", value: true, disabled: true }),
  ] as VNode[])),
  card("DanmakuSwitch", h(DanmakuSwitch, {
    dark,
    threeState: true,
    state: 1,
    onContent: "开",
    middleContent: "半",
    offContent: "关",
    onChange: (s) => console.log("danmaku switch", s),
  })),
  card("Input", ...([
    wide(h(Input, { placeholder: "文本输入", value: "hello" })),
    wide(h(Input, { type: "number", value: 3, step: 1, min: 0, max: 10 })),
    wide(h(Input, { type: "textarea", placeholder: "多行文本" })),
  ] as VNode[])),
  card("Select", wide(h(Select, {
    dark,
    value: 1080,
    items: [
      { value: 1080, name: "1080P 高清" },
      { value: 720, name: "720P" },
      { value: 480, name: "480P" },
    ],
    onChange: (v) => console.log("select", v),
  }))),
  card("ColorPicker", h(ColorPicker, { value: "#00A1D6" })),
  card("Collapse", wide(h(Collapse, {
    dark,
    value: false,
    foldText: "展开",
    unfoldText: "收起",
    body: h("div", { style: { padding: "8px 0", color: "inherit" } }, "这是折叠面板的内容"),
  }))),
  card("Dialog", h(Dialog, {
    dark,
    title: "对话框标题",
    body: h("p", { style: { color: "inherit" } }, "对话框内容，点击右上角关闭。"),
  })),
  card("Menu", h(Menu, {
    dark,
    items: [
      { name: "复制视频地址", onClick: () => console.log("copy") },
      { name: "快捷键说明" },
      { name: "播放器版本" },
    ],
  })),
  card("Dropdown", wide(h(Dropdown, {
    dark,
    value: "v1",
    items: [
      { value: "v1", name: "版本一" },
      { value: "v2", name: "版本二" },
      { value: "v3", name: "版本三" },
    ],
  }))),
  card("Tabs", wide(h(Tabs, {
    dark,
    value: "t1",
    items: [
      { value: "t1", name: "标签一" },
      { value: "t2", name: "标签二" },
    ],
    renderBody: (item) =>
      h("div", { style: { padding: "12px", color: "inherit" } }, `${item.name}的内容`),
  }))),
  card("Panel", wide(h(Panel, {
    dark,
    value: 0,
    pages: [
      { width: 200, height: 100 },
      { width: 200, height: 100 },
    ],
  }))),
  card("DynamicPanel", wide(h(DynamicPanel, {
    dark,
    value: 0,
    pages: [
      h("div", { style: { padding: "12px", color: "inherit" } }, "动态面板 1"),
      h("div", { style: { padding: "12px", color: "inherit" } }, "动态面板 2"),
    ],
  }))),
  card("LongList", wide(h(LongList, {
    dark,
    listHeight: 160,
    itemHeight: 24,
    count: 50,
    renderItem: (index) => `第 ${index + 1} 行`,
  }))),
  card("Swiper", wide(h(Swiper, {
    dark,
    value: 0,
    list: [
      { edgeId: 1, cover: cover("卡片一", "#00a1d6"), title: "卡片一" },
      { edgeId: 2, cover: cover("卡片二", "#fb7299"), title: "卡片二" },
      { edgeId: 3, cover: cover("卡片三", "#7c3aed"), title: "卡片三" },
    ],
  }))),
  card("Slider", wide(h(Slider, {
    dark,
    value: 40,
    trackBreadth: 4,
    thumbWidth: 12,
    showTooltip: true,
    videoProgress: true,
    steps: [
      { name: "0:00", value: 0 },
      { name: "2:00", value: 0.5 },
      { name: "4:00", value: 1 },
    ],
    formatTooltip: (v) => `${Math.floor(v)}%`,
    onChange: (v) => console.log("slider", v),
  }))),
  card("Progress", wide(h(Progress, {
    dark,
    value: 40,
    valWidth: 48,
    steps: [
      { value: 0 },
      { value: 50 },
      { value: 100 },
    ],
  }))),
  card("CircleProgress", h(CircleProgress, {
    dark,
    value: 68,
    topText: "加载中",
    bottomText: "68%",
  })),
  card("CloseButton", h(
    "div",
    { style: { position: "relative", width: "40px", height: "40px", margin: "20px" } },
    h(CloseButton, { width: 18, height: 18, value: 60 }),
  )),
);

let darkMode = false;

function renderApp(): void {
  app.innerHTML = "";
  mount(buildView(), app);
}

const toolbar = document.createElement("div");
toolbar.className = "theme-toggle";
const toggle = document.createElement("button");
toggle.type = "button";
toggle.textContent = "切换深色 / 浅色";
toggle.addEventListener("click", () => {
  darkMode = !darkMode;
  // 主题只切全局 class，--nova-* 变量随之覆盖，组件不感知、不重挂
  document.documentElement.classList.toggle("lui-theme-dark", darkMode);
});
toolbar.appendChild(toggle);
document.body.appendChild(toolbar);
renderApp();
