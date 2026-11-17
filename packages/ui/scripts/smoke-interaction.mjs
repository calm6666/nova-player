/**
 * @lumina/ui 交互冒烟：happy-dom 下验证点击 / 命令式 API / 响应式更新。
 */
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
globalThis.window = win;
globalThis.document = win.document;
Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true });
for (const key of ["Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLDivElement", "Node", "SVGElement", "DocumentFragment", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent"]) {
  if (win[key] && !globalThis[key]) globalThis[key] = win[key];
}

const { h, mount } = await import("@lumina/framework/core");
const ui = await import("../dist/index.js");
const { Button, Checkbox, Radio, Switch, DanmakuSwitch, Input, Select, ColorPicker, Collapse, Dialog, Menu, Dropdown, Tabs, Panel, DynamicPanel, LongList, Swiper, Slider, Progress, CircleProgress, CloseButton } = ui;

const tick = () => new Promise((r) => setTimeout(r, 10));
let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; console.error("FAIL", name, extra); }
};
const host = () => { const el = document.createElement("div"); document.body.appendChild(el); return el; };
const q = (root, sel) => root.querySelector(sel);
const text = (root, sel) => q(root, sel)?.textContent ?? "";
const click = (el) => el && el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

// 1. Button
{
  let n = 0; const el = host();
  mount(h(Button, { text: "btn", onClick: () => n++ }), el);
  click(q(el, ".lui-button")); ok("Button click", n === 1);
}

// 2. Checkbox
{
  let v = null; const el = host();
  mount(h(Checkbox, { name: "c", onChange: (x) => (v = x) }), el);
  const input = q(el, ".lui-checkbox-input"); input.checked = true;
  input.dispatchEvent(new win.Event("change", { bubbles: true }));
  await tick(); ok("Checkbox change", input.checked && v === true);
}

// 3. Radio
{
  const el = host();
  mount(h(Radio, { value: 1, labels: [{ value: 1, name: "a" }, { value: 2, name: "b" }] }), el);
  const inputs = el.querySelectorAll(".lui-radio-input");
  inputs[1].checked = true; inputs[1].dispatchEvent(new win.Event("change", { bubbles: true }));
  await tick(); ok("Radio select", inputs[1].checked);
}

// 4. Switch
{
  const el = host();
  mount(h(Switch, { name: "s", value: false }), el);
  const input = q(el, ".lui-switch-input"); input.checked = true;
  input.dispatchEvent(new win.Event("change", { bubbles: true }));
  await tick(); ok("Switch toggle", input.checked);
}

// 5. DanmakuSwitch 三态 API
{
  let api = null; const el = host();
  mount(h(DanmakuSwitch, { threeState: true, onDanmakuSwitchMounted: (a) => (api = a) }), el);
  api.setState(3); await tick();
  ok("DanmakuSwitch state3", q(el, ".lui-danmaku-switch").classList.contains("lui-danmaku-switch-state-3"), q(el, ".lui-danmaku-switch").className);
}

// 6. Input API
{
  let api = null; const el = host();
  mount(h(Input, { value: "a", onInputMounted: (a) => (api = a) }), el);
  api.setValue("abc"); await tick();
  ok("Input setValue", q(el, ".lui-input-input").value === "abc");
}

// 7. Select 展开 + 选择
{
  const el = host();
  mount(h(Select, { value: 1, items: [{ value: 1, name: "一" }, { value: 2, name: "二" }] }), el);
  click(q(el, ".lui-select-header")); await tick();
  const list = q(el, ".lui-select-list");
  ok("Select unfold", list.style.display === "block" || list.style.display === "", list.getAttribute("style") ?? "");
  click(el.querySelectorAll(".lui-select-item")[1]); await tick();
  ok("Select pick", text(el, ".lui-select-result") === "二" && el.querySelectorAll(".lui-select-item-active").length === 1, text(el, ".lui-select-result"));
}

// 8. ColorPicker
{
  const el = host();
  mount(h(ColorPicker, { value: "#FFFFFF", options: ["#111111", "#222222"] }), el);
  click(el.querySelectorAll(".lui-color-picker-option")[1]); await tick();
  ok("ColorPicker pick", text(el, ".lui-color-picker-input") === "#222222", text(el, ".lui-color-picker-input"));
}

// 9. Collapse
{
  const el = host();
  mount(h(Collapse, { value: true, foldText: "fold", unfoldText: "unfold" }), el);
  click(q(el, ".lui-collapse-header")); await tick();
  ok("Collapse fold", q(el, ".lui-collapse-wrap").classList.contains("lui-collapse-wrap-folded"), q(el, ".lui-collapse-wrap").className);
  ok("Collapse text", text(el, ".lui-collapse-arrow-text") === "fold", text(el, ".lui-collapse-arrow-text"));
}

// 10. Dialog close
{
  const el = host();
  let closed = 0;
  mount(h(Dialog, { title: "t", onClose: () => closed++ }), el);
  click(q(el, ".lui-dialog-close")); await tick();
  ok("Dialog close", q(el, ".lui-dialog-wrap").style.display === "none" && closed === 1, q(el, ".lui-dialog-wrap").style.display);
}

// 11. Menu
{
  const el = host(); let hit = 0;
  mount(h(Menu, { items: [{ name: "a", onClick: () => hit++ }] }), el);
  click(q(el, ".lui-menu-item")); ok("Menu click", hit === 1);
}

// 12. Dropdown
{
  const el = host();
  mount(h(Dropdown, { value: 1, items: [{ value: 1, name: "一" }, { value: 2, name: "二" }] }), el);
  click(q(el, ".lui-dropdown-display")); await tick();
  ok("Dropdown unfold", q(el, ".lui-dropdown-items").style.display === "block", q(el, ".lui-dropdown-items").getAttribute("style") ?? "");
  click(el.querySelectorAll(".lui-dropdown-item")[1]); await tick();
  ok("Dropdown pick", text(el, ".lui-dropdown-name") === "二", text(el, ".lui-dropdown-name"));
}

// 13. Tabs
{
  const el = host();
  mount(h(Tabs, { value: "a", items: [{ value: "a", name: "A" }, { value: "b", name: "B" }] }), el);
  click(el.querySelectorAll(".lui-tabs-header-item")[1]); await tick();
  ok("Tabs switch", el.querySelectorAll(".lui-tabs-header-item-active")[0]?.textContent === "B");
}

// 14. Panel API
{
  let api = null; const el = host();
  mount(h(Panel, { value: 0, pages: [{ width: 100, height: 20 }, { width: 100, height: 20 }], onPanelMounted: (a) => (api = a) }), el);
  api.setValue(1); await tick();
  ok("Panel page", (q(el, ".lui-panel-move").style.transform || "").includes("-100px"), q(el, ".lui-panel-move").style.transform);
}

// 15. DynamicPanel API
{
  let api = null; const el = host();
  mount(h(DynamicPanel, { pages: [h("div", {}, "1"), h("div", {}, "2")], onDynamicPanelMounted: (a) => (api = a) }), el);
  api.setValue(1); await tick();
  ok("DynamicPanel page", el.querySelectorAll(".lui-dynamic-panel-item-active")[0] === el.querySelectorAll(".lui-dynamic-panel-item")[1]);
}

// 16. LongList scrollTo
{
  let api = null; const el = host();
  mount(h(LongList, { count: 20, itemHeight: 20, listHeight: 100, renderItem: (i) => String(i), onLongListMounted: (a) => (api = a) }), el);
  api.scrollTo(5); ok("LongList scrollTo", q(el, ".lui-long-list-wrap").scrollTop === 100);
}

// 17. Swiper next
{
  const el = host();
  mount(h(Swiper, { value: 0, list: [{ edgeId: 1, cover: "a", title: "1" }, { edgeId: 2, cover: "b", title: "2" }] }), el);
  click(q(el, ".lui-swiper-next")); await tick();
  ok("Swiper next", el.querySelectorAll(".lui-swiper-item")[1].classList.contains("lui-swiper-item-active"));
}

// 18. Slider API
{
  let api = null; const el = host();
  mount(h(Slider, { value: 10, showTooltip: true, formatTooltip: (v) => `${Math.floor(v)}%`, onSliderMounted: (a) => (api = a) }), el);
  api.setValue(70); await tick();
  ok("Slider thumb", (q(el, ".lui-thumb").style.left || "").startsWith("70"), q(el, ".lui-thumb").getAttribute("style") ?? "");
  ok("Slider tooltip", text(el, ".lui-thumb-tooltip") === "70%", text(el, ".lui-thumb-tooltip"));
  ok("Slider bar", (q(el, ".lui-bar-normal").style.transform || "").includes("0.7"), q(el, ".lui-bar-normal").style.transform);
}

// 19. Progress API
{
  let api = null; const el = host();
  mount(h(Progress, { value: 10, onProgressMounted: (a) => (api = a) }), el);
  api.setValue(70); await tick();
  ok("Progress width", (q(el, ".lui-progress-bar").style.width || "") === "70%", q(el, ".lui-progress-bar").style.width);
}

// 20. CircleProgress API
{
  let api = null; const el = host();
  mount(h(CircleProgress, { value: 10, onCircleProgressMounted: (a) => (api = a) }), el);
  api.setValue(70); await tick();
  ok("CircleProgress percent", text(el, ".lui-circle-progress-percent") === "70%", text(el, ".lui-circle-progress-percent"));
}

// 21. CloseButton API
{
  let api = null; const el = host();
  mount(h(CloseButton, { value: 10, onCloseButtonMounted: (a) => (api = a) }), el);
  api.setValue(60); await tick();
  const style = q(el, ".lui-circle-left-bar").getAttribute("style") ?? "";
  ok("CloseButton deg", style.includes("--leftDeg"), style);
}

console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
