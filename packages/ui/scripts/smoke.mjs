/**
 * @lumina/ui SSR 冒烟：用 renderToString 渲染全部 21 个组件，验证无运行时异常。
 */
import { h, renderToString } from "@lumina/framework/core";
import {
  Button, Checkbox, Radio, Switch, DanmakuSwitch, Input, Collapse, Dialog,
  Menu, Dropdown, Tabs, Panel, DynamicPanel, LongList, Swiper, Slider,
  Progress, CircleProgress, CloseButton, ColorPicker, Select,
} from "../dist/index.js";

const cases = [
  ["Button", Button, { text: "按钮", type: "blue" }],
  ["Checkbox", Checkbox, { name: "复选", value: true, redDot: true }],
  ["Radio", Radio, { value: 1, labels: [{ value: 1, name: "一" }, { value: 2, name: "二" }] }],
  ["Switch", Switch, { name: "开关", value: true }],
  ["DanmakuSwitch", DanmakuSwitch, { threeState: true, state: 1 }],
  ["Input", Input, { type: "number", value: 2 }],
  ["Collapse", Collapse, { value: true, body: h("div", {}, "body") }],
  ["Dialog", Dialog, { title: "标题", body: h("p", {}, "内容") }],
  ["Menu", Menu, { items: [{ name: "a" }] }],
  ["Dropdown", Dropdown, { items: [{ value: "a", name: "A" }] }],
  ["Tabs", Tabs, { items: [{ value: "a", name: "A" }] }],
  ["Panel", Panel, { pages: [{ width: 100, height: 100 }] }],
  ["DynamicPanel", DynamicPanel, { pages: [h("div", {}, "p")] }],
  ["LongList", LongList, { count: 3, itemHeight: 20, listHeight: 100, renderItem: (i) => `row ${i}` }],
  ["Swiper", Swiper, { list: [{ edgeId: 1, cover: "x", title: "t" }] }],
  ["Slider", Slider, { value: 40, steps: [{ name: "0", value: 0 }] }],
  ["Progress", Progress, { value: 40, valWidth: 40, steps: [{ value: 0 }] }],
  ["CircleProgress", CircleProgress, { value: 50 }],
  ["CloseButton", CloseButton, { value: 50 }],
  ["ColorPicker", ColorPicker, { value: "#00A1D6" }],
  ["Select", Select, { items: [{ value: 1, name: "一" }] }],
];

let failures = 0;
for (const [name, Comp, props] of cases) {
  try {
    const html = renderToString(h(Comp, props));
    if (!html || typeof html !== "string" || !html.includes("lui")) {
      throw new Error("empty/invalid html: " + String(html).slice(0, 80));
    }
    console.log("PASS", name, html.length);
  } catch (e) {
    failures++;
    console.error("FAIL", name, e.message);
  }
}
console.log(failures === 0 ? "ALL PASS" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
