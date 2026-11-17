/**
 * @lumina/ui 客户端挂载冒烟：happy-dom 中 mount 全部组件，验证 DOM 挂载与 root 类名。
 */
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
globalThis.window = win;
globalThis.document = win.document;
Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true });
for (const key of ["Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement",
  "HTMLDivElement", "Node", "SVGElement", "DocumentFragment", "Event", "MouseEvent",
  "KeyboardEvent", "CustomEvent"]) {
  if (win[key] && !globalThis[key]) globalThis[key] = win[key];
}

const { h, mount } = await import("@lumina/framework/core");
const ui = await import("../dist/index.js");

const { Button, Checkbox, Radio, Switch, DanmakuSwitch, Input, Collapse, Dialog,
  Menu, Dropdown, Tabs, Panel, DynamicPanel, LongList, Swiper, Slider,
  Progress, CircleProgress, CloseButton, ColorPicker, Select } = ui;

const cases = [
  [Button, { text: "按钮" }, "lui-button"],
  [Checkbox, { name: "a" }, "lui-checkbox"],
  [Radio, { labels: [{ value: 1, name: "一" }] }, "lui-radio"],
  [Switch, { name: "a" }, "lui-switch"],
  [DanmakuSwitch, { threeState: true }, "lui-danmaku-switch"],
  [Input, { value: "x" }, "lui-input"],
  [Collapse, { value: true }, "lui-collapse"],
  [Dialog, {}, "lui-dialog"],
  [Menu, { items: [{ name: "a" }] }, "lui-menu"],
  [Dropdown, { items: [{ value: 1, name: "a" }] }, "lui-dropdown"],
  [Tabs, { items: [{ value: 1, name: "a" }] }, "lui-tabs"],
  [Panel, { pages: [{ width: 10, height: 10 }] }, "lui-panel"],
  [DynamicPanel, { pages: [] }, "lui-dynamic-panel"],
  [LongList, { count: 2 }, "lui-long-list"],
  [Swiper, { list: [] }, "lui-swiper"],
  [Slider, { value: 10 }, "lui-slider"],
  [Progress, { value: 10 }, "lui-progress"],
  [CircleProgress, { value: 10 }, "lui-circle-progress"],
  [CloseButton, {}, "lui-circle"],
  [ColorPicker, {}, "lui-color-picker"],
  [Select, { items: [{ value: 1, name: "a" }] }, "lui-select"],
];

let fail = 0;
for (const [Comp, props, cls] of cases) {
  try {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mount(h(Comp, props), host);
    const found = host.querySelector("." + cls);
    if (!found) throw new Error("missing ." + cls + " in " + host.innerHTML.slice(0, 120));
    console.log("PASS", cls);
  } catch (e) {
    fail++;
    console.error("FAIL", cls, e.message);
  }
}
console.log(fail === 0 ? "ALL PASS" : fail + " FAILURES");
process.exit(fail === 0 ? 0 : 1);
