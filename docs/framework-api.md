# Lumina 框架使用文档 · 完整 API 手册

> 版本：1.0.0
> 定位：极简 TypeScript VNode 框架 —— **无虚拟 DOM diff、挂载一次 + Signal 精准更新 DOM**
> 响应式引擎：自研 signalsCore（[core/signalsCore.ts](../core/signalsCore.ts)），零外部运行时依赖

---

## 目录

1. [核心概念](#一核心概念)
2. [快速开始](#二快速开始)
3. [`h()` — 创建 VNode](#三h--创建-vnode)
4. [`defineComponent()` — 定义组件](#四definecomponent--定义组件)
5. [生命周期](#五生命周期)
6. [内置助手：Fragment / when / each / show](#六内置助手fragment--when--each--show)
7. [模板引用：useTemplateRef（Vue 3.5 风格）](#七模板引用usetemplaterefvue-35-风格)
8. [响应式系统：signal / computed / effect / onEffect](#八响应式系统signal--computed--effect--oneffect)
9. [状态管理：state（重点）](#九状态管理state重点)
10. [Context 上下文](#十context-上下文)
11. [事件总线](#十一事件总线)
12. [钩子系统](#十二钩子系统)
13. [挂载 / 水合 / 销毁](#十三挂载--水合--销毁)
14. [服务端渲染 SSR](#十四服务端渲染-ssr)
15. [样式与类名工具](#十五样式与类名工具)
16. [警告与错误处理](#十六警告与错误处理)
17. [Vite 编译插件](#十七vite-编译插件)
18. [编译期内部函数](#十八编译期内部函数)
19. [完整 API 速查表](#十九完整-api-速查表)

---

## 一、核心概念

框架的设计取向是「**极简 + 显式**」：

| 特性       | 说明                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| 无 diff    | 没有虚拟 DOM 比对，**挂载一次**后由 Signal 响应式表达式精准更新 DOM（命令式场景可手动更新） |
| 无模板编译 | 用 `h()` 函数直接描述结构（可选 `vite-plugin-lumina-compile` 做编译期优化）                 |
| 响应式可选 | 用 `signal` + `effect` 精确驱动 DOM 更新，**读谁追踪谁**                                    |
| 同引擎     | `signal` / `computed` / `effect` / `onEffect` / `useState` / 模板引用**全部基于 signals**   |

### 渲染模型

```
defineComponent(setup)
   ↓ setup 执行一次，返回 VNode 树
mount(vnode, container)          ← 或 hydrate(vnode, container)
   ↓ 递归创建 DOM（ref 绑定、事件绑定）
onMounted
   ↓ 响应式 effect 启动（首次同步执行 = 初始渲染）
signal 变化 → effect 重跑 → 你手动写 DOM
```

**更新模型**：框架不做整树重渲染。响应式表达式（DOM 属性表达式 / 子节点 `() => expr` / 组件 prop）
由编译插件提取为 effect，Signal 变化时精准更新对应 DOM；Canvas、原生控件等命令式路径可在
`effect` / `useState` 的 updater 里手动更新 DOM。

---

## 二、快速开始

```ts
import {
  h,
  defineComponent,
  mount,
  signal,
  onEffect,
  useTemplateRef,
} from "@/core";

const Counter = defineComponent((props, lifecycle) => {
  // 1. 响应式变量
  const count = signal(0);
  // 2. 模板引用（字符串 key）
  const labelRef = useTemplateRef<HTMLSpanElement>(lifecycle, "label");

  // 3. effect：挂载后启动，count 变化自动重跑
  onEffect(lifecycle, () => {
    if (labelRef.value) labelRef.value.textContent = String(count.value);
  });

  return h(
    "div",
    { class: "counter" },
    h("button", { onClick: () => count.value-- }, "−"),
    h("span", { ref: "label", style: { minWidth: "40px" } }, "0"),
    h("button", { onClick: () => count.value++ }, "+"),
  );
});

mount(h(Counter, {}), document.getElementById("app")!);
```

---

## 三、`h()` — 创建 VNode

```ts
h(tag, attrs?, ...children): VNode
```

### 三种用法

```ts
// 1. 元素
h("div", { class: "box", id: "main" }, "文本", h("span", {}, "子节点"));

// 2. 组件（组件会在 h() 内立即执行，返回其根 VNode）
h(MyComponent, { title: "Hi", onClick: fn }, h("p", {}, "children"));

// 3. 无 attrs
h("br");
h("div", null, "text");
```

### 参数

| 参数       | 类型                              | 说明                                                                                              |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `tag`      | `string \| Component`             | 标签名或组件函数/类                                                                               |
| `attrs`    | `Record<string, unknown> \| null` | 属性、事件、ref、style、class、指令                                                               |
| `children` | `HChild[]`（可变参数）            | `VNode \| string \| null \| undefined`，支持嵌套数组（扁平化深度 3），自动过滤 `null`/`undefined` |

### attrs 支持的全部键

| 键                                                             | 处理方式                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `class` / `className`                                          | `normalizeClass` 标准化（字符串 / 数组 / 对象）                       |
| `style`                                                        | 字符串或对象，camelCase 自动转 kebab-case，走 `el.style.setProperty`  |
| `ref`                                                          | 模板引用：**字符串 key** / `Signal` / 回调 / 旧 `{ current }` 对象    |
| `onXxx`                                                        | 元素上 → DOM 事件（`onClick` → `click`）；组件上 → 作为 prop 传给组件 |
| `directives`                                                   | `[[directiveFn, value], ...]`，执行后返回的清理函数在销毁时调用       |
| `svgContent`                                                   | SVG 字符串（经 DOMParser 安全清理后插入）                             |
| `__providers`                                                  | Context 注入（元素级），会被提取并从 attrs 移除                       |
| `value` / `checked` / `disabled` / `readOnly` / `innerHTML` 等 | 直接赋值到 DOM property（白名单）                                     |
| `key`                                                          | 类型层面保留（框架不做 diff，不参与运行时）                           |
| 其他                                                           | `el.setAttribute(key, String(value))`                                 |

### 子节点扁平化

```ts
h("ul", {}, ...each(items, (it) => h("li", {}, it.name))); // 展开
h(
  "ul",
  {},
  each(items, (it) => h("li", {}, it.name)),
); // 数组也可以
h("div", {}, [h("a"), [h("b")]]); // 嵌套数组最多展开 3 层
h("div", {}, null, undefined, "x"); // → 只渲染 'x'
```

---

## 四、`defineComponent()` — 定义组件

```ts
defineComponent<P, E = void>(
  setup: (props: P, lifecycle: ...) => VNode
): ExposedComponent<P, E>
```

- `P`：props 类型
- `E`：事件映射类型（可选）。声明后 `lifecycle.emit` / `lifecycle.on` 获得类型安全

### 基础组件

```ts
const Greeting = defineComponent<{ name: string }>((props) => {
  return h("div", { class: "greeting" }, `Hello, ${props.name}!`);
});

h(Greeting, { name: "World" });
```

### 带类型安全事件

```ts
interface MyEvents {
  submit: { id: number };
  cancel: undefined;
}

const Form = defineComponent<{ title: string }, MyEvents>(
  (props, lifecycle) => {
    // emit：payload 类型受约束
    const onSubmit = () => lifecycle.emit?.("submit", { id: 1 });
    const onCancel = () => lifecycle.emit?.("cancel"); // 无 payload

    // on：监听父组件传入的回调（等价于 props.onSubmit）
    lifecycle.on?.("submit", (payload) => console.log(payload.id));

    return h(
      "form",
      {},
      h("button", { onClick: onSubmit }, "提交"),
      h("button", { onClick: onCancel }, "取消"),
    );
  },
);

// 父组件：E 自动生成 onXxx props
h(Form, {
  title: "标题",
  onSubmit: (payload) => console.log(payload.id), // 类型安全
  onCancel: () => {},
});
```

### 暴露实例 API（配合模板引用）

```ts
const Player = defineComponent<Record<string, never>, { play(): void }>(
  (_props, lifecycle) => {
    lifecycle.expose?.({ play: () => console.log("play") });
    return h("div", { class: "player" });
  },
);

// 父组件通过字符串 ref 拿到 expose 的 API
const playerRef = useTemplateRef<{ play(): void }>(lifecycle, "player");
onEffect(lifecycle, () => playerRef.value?.play());
return h(Player, { ref: "player" });
```

### `props.children`

所有子节点通过 `props.children` 传入（`VNode[]`）：

```ts
const Layout = defineComponent((props: { children: VNode[] }) => {
  return h("div", { class: "layout" }, ...props.children);
});
```

### 类组件（兼容）

```ts
class MyComp implements ComponentInstance<{ title: string }> {
  props: { title: string };
  constructor(props: { title: string }) {
    this.props = props;
  }
  render(): VNode {
    return h("div", {}, this.props.title);
  }
  onMounted(): void {}
}
h(MyComp, { title: "x" });
```

---

## 五、生命周期

在 `lifecycle` 上直接赋值：

| 钩子              | 时机                         | 递归顺序 |
| ----------------- | ---------------------------- | -------- |
| `onBeforeMount`   | DOM 已创建、**尚未插入容器** | 父 → 子  |
| `onMounted`       | DOM 已插入容器，`ref` 已绑定 | 子 → 父  |
| `onBeforeDestroy` | 即将销毁，DOM 仍在           | 父 → 子  |
| `onDestroyed`     | 已销毁，ref 已清空           | 子 → 父  |

```ts
const Comp = defineComponent((props, lifecycle) => {
  lifecycle.onBeforeMount = () => {};
  lifecycle.onMounted = () => {
    // 此处 ref.value / lifecycle.el 已可用
  };
  lifecycle.onBeforeDestroy = () => {};
  lifecycle.onDestroyed = () => {};
  return h("div", {});
});
```

**`lifecycle.el`**：组件根 DOM 元素，挂载/水合后由框架自动设置，用于手动 DOM 操作。

**注意**：`onMounted` 中启动的 `effect` 建议改用 `onEffect()`（自动 dispose）。

---

## 六、内置助手：Fragment / when / each / show

### `Fragment`

不产生真实 DOM 节点，只输出子元素（SSR 与水合行为一致）。

```ts
import { Fragment } from "@/core";

h(Fragment, {}, h("div", {}, "A"), h("div", {}, "B"));
// → 直接输出两个 div，无包裹元素

// 也可以直接当函数调用
Fragment({ children: [h("span", {}, "x")] });
```

### `when(condition, vnode)`

条件渲染，条件为假时返回 `''`。

```ts
when(isAdmin, h("div", {}, "管理员面板"));
```

### `each(items, renderFn)`

列表渲染，返回 `VNode[]`。

```ts
each(users, (user, index) =>
  h("li", { key: user.id }, `${index}. ${user.name}`),
);
```

### `show(visible, vnode)`

通过 `display` 控制显隐（元素始终在 DOM 中）。**不修改传入的 VNode**，返回带 `display` 样式的新节点。

```ts
import { show } from "@/core/h"; // 注意：show 从 core/h 导出
show(isModalOpen, h("div", { class: "modal" }, "内容"));
```

---

## 七、模板引用：`useTemplateRef`（Vue 3.5 风格）

用**字符串 key** 绑定 DOM，返回**响应式 Signal**，挂载时自动赋值、销毁时自动置 `null`（不留悬挂引用）。

### 基础用法

```ts
const inputRef = useTemplateRef<HTMLInputElement>(lifecycle, "input");

onEffect(lifecycle, () => {
  inputRef.value?.focus(); // .value 读 DOM；挂载前/销毁后为 null
});

return h("input", { ref: "input" });
```

### 签名

```ts
useTemplateRef<T = Element>(
  lifecycle: { _templateRefs?: Map<string, Signal<unknown>> },
  key: string,
): Signal<T | null>
```

- `T` **不限制为 Element**：DOM 元素用 `useTemplateRef<HTMLDivElement>`，组件引用用 `useTemplateRef<LottieIconApi>`
- 解析规则：沿 `__parent` 链向上找**最近的组件**的 `_templateRefs`，不跨组件边界
- key 必须唯一；未注册的 key 会在开发环境输出警告

### 四种 ref 形式对比

| 形式                   | 写法                                           | 说明                              |
| ---------------------- | ---------------------------------------------- | --------------------------------- |
| **字符串 key（推荐）** | `ref: 'input'` + `useTemplateRef(lc, 'input')` | 与 DOM 解耦，自动清理             |
| **Signal 直绑**        | `const s = signal(null); ref: s`               | 循环/动态场景用（每个 item 独立） |
| 回调                   | `ref: (el, vnode) => {}`                       | 向后兼容                          |
| 旧对象（已弃用）       | `const r = ref(); ref: r` → `r.current`        | 向后兼容，建议迁移                |

### 循环中的引用（重要）

`useTemplateRef` 按 key **去重**，循环里必须用独立 `signal()`：

```ts
const itemRefs: Record<string, Signal<HTMLDivElement | null>> = {};

items.map((item) => {
  // ❌ 错误：同一个 key 会返回同一个 Signal（所有 item 共享）
  // const r = useTemplateRef<HTMLDivElement>(lifecycle, 'item');

  // ✅ 正确：每个 item 独立 Signal
  const r = signal<HTMLDivElement | null>(null);
  itemRefs[item.name] = r;
  return h("div", { ref: r });
});
```

### 旧 API（已弃用）

```ts
import { ref } from "@/core";
const el = ref<HTMLDivElement>(); // { current: null }
h("div", { ref: el });
el.current; // 访问
```

### 类型守卫

```ts
isRefObject(value): value is { current: unknown }
isSignalRef(value): value is Signal<unknown>
```

---

## 八、响应式系统：signal / computed / effect / onEffect

全部基于自研 signalsCore（`core/signalsCore.ts`），零外部运行时依赖。

### `signal(initial)`

```ts
const count = signal(0);
count.value; // 读（在 effect 内读会建立依赖）
count.value = 1; // 写（触发依赖它的 effect）
count.peek(); // 读但不建立依赖
```

### `computed(fn)`

派生值，惰性求值 + 自动缓存。

```ts
const a = signal(2);
const b = signal(3);
const sum = computed(() => a.value + b.value);
sum.value; // 5
```

### `effect(fn)`

依赖变化自动重跑，**首次同步执行**，返回 `dispose` 函数。

```ts
const dispose = effect(() => {
  console.log(count.value); // count 变化时重跑
});
dispose(); // 停止追踪
```

### `onEffect(lifecycle, fn)`（推荐）

把 effect 绑定到组件生命周期：**挂载/水合后启动**（此时 ref 已就绪）、**销毁时自动 dispose**。

```ts
onEffect(lifecycle, () => {
  if (labelRef.value) labelRef.value.textContent = String(count.value);
});
```

> **关键**：只有 effect 内部读取 `.value` 才建立依赖；setup 里直接读 `.value` 是快照。

### `batch(fn)`

批量提交，把同一批内的多次写入合并为一次通知。

```ts
batch(() => {
  a.value = 1;
  b.value = 2;
});
// 依赖 a、b 的 effect 只跑一次
```

### `untracked(fn)`

读取信号但不建立依赖。

```ts
untracked(() => {
  console.log(count.value);
}); // 不会因 count 变化重跑
```

### 响应式变量作为 prop 传递

props 是**引用传递、无解包**，signal 对象原样传给子组件：

```ts
const Child = defineComponent<{ count: Signal<number> }>((props, lifecycle) => {
  const el = useTemplateRef<HTMLSpanElement>(lifecycle, "n");
  onEffect(lifecycle, () => {
    // 自动追踪 props.count
    if (el.value) el.value.textContent = String(props.count.value);
  });
  return h("span", { ref: "n" }, "0");
});

const Parent = defineComponent((_props, _lifecycle) => {
  const count = signal(0);
  return h(
    "div",
    {},
    h("button", { onClick: () => count.value++ }, "+"),
    h(Child, { count }), // ✅ 传 signal 本身
    // h(Child, { count: count.value }),  // ❌ 传快照，子组件永远不更新
  );
});
```

---

## 九、状态管理：state（重点）

集中式路径状态（如 `'player.volume'`）。**底层同样是 signal**：每个路径一个惰性 `Signal`，`set` 写 signal、`subscribe`/`useState` 通过 `effect` 订阅。

### 创建

```ts
import { createTypedStateManager } from "@/core";

interface AppState {
  "app.count": number;
  "player.volume": number;
  "player.muted": boolean;
}

const state = createTypedStateManager<AppState>({
  app: { count: 0 },
  player: { volume: 0.8, muted: false },
});

// 无类型版本（已弃用，建议用泛型版）
const raw = createStateManager({ count: 0 });
```

### 方法

#### `get(path)`

```ts
state.get("app.count"); // number | undefined
```

#### `set(path, value, silent?)`

```ts
state.set("app.count", 5); // 写入并通知
state.set("app.count", 5, true); // silent：只写入不通知订阅者
```

- `===` 短路：值未变化不触发通知
- 支持嵌套路径，中间对象不存在时自动创建
- `silent` 会同步 Signal 值（保证 `get` 与 `signal()` 一致），但不触发订阅回调

#### `subscribe(path, listener)`

```ts
const unsub = state.subscribe("app.count", (newVal, oldVal) => {
  console.log(newVal, oldVal);
});
unsub();
```

**语义保证**：

- **只在变化时通知**（订阅时不会立即调用）
- 触发机构是 `effect` → **尊重 `batch()`**（批量内多次 set 合并为一次通知）
- 异常隔离：单个监听器抛错不影响其他

#### `signal(path)` ⭐

把状态路径变成**响应式 Signal**，与 `signal`/`computed`/`effect` 同引擎：

```ts
const volumeSig = state.signal("player.volume"); // Signal<number>
onEffect(lifecycle, () => {
  el.value = String(volumeSig.value);
});
```

#### `getState()`

返回完整状态的**深拷贝**（支持 Date/RegExp/Map/Set）。

```ts
const snapshot = state.getState();
```

### `useState(state, path, updater, lifecycle)`

订阅状态路径的便捷 helper（订阅语义，与 `subscribe` 一致）：

```ts
import { useState } from "@/core";

const current = useState(
  state,
  "player.volume",
  (newVal, oldVal) => {
    // 状态变化时手动更新 DOM（不会在订阅时立即执行）
    if (elRef.value) elRef.value.textContent = String(newVal);
  },
  lifecycle, // 传入 lifecycle → 销毁时自动取消订阅
);

// current 是订阅时的当前值，用于 setup 阶段的首次渲染
return h("span", { ref: "label" }, String(current ?? 0));
```

**参数**

| 参数        | 类型                                         | 说明         |
| ----------- | -------------------------------------------- | ------------ |
| `state`     | `TypedStateManager<TMap>`                    | 状态管理器   |
| `path`      | `K extends keyof TMap`                       | 状态路径     |
| `updater`   | `(newVal: TMap[K], oldVal: TMap[K]) => void` | 变化回调     |
| `lifecycle` | `{ onDestroyed?, _stateCleanups? }`          | 用于自动清理 |

**返回**：`TMap[K] | undefined`（当前值）

### `useState` vs `state.signal` + `onEffect`

|                  | `useState`                       | `state.signal(path)` + `onEffect` |
| ---------------- | -------------------------------- | --------------------------------- |
| 触发时机         | **仅变化时**（返回初始值单独用） | **首次挂载 + 变化时**             |
| 拿旧值           | ✅ `oldVal`                      | ❌（如需旧值自己缓存）            |
| 与 computed 组合 | ❌                               | ✅                                |
| 适用             | 简单订阅 + 手动改 DOM            | 需要统一响应式链路                |

```ts
// 方式 A：useState
const v = useState(
  state,
  "player.volume",
  (nv) => {
    el.textContent = String(nv);
  },
  lc,
);

// 方式 B：signal + onEffect（推荐用于新代码）
const vol = state.signal("player.volume");
onEffect(lc, () => {
  el.textContent = String(vol.value);
});
```

### 状态路径与事件总线的关系

- `state`：**数据**（可读可写、有当前值）
- `events`（事件总线）：**瞬时通知**（无当前值）

---

## 十、Context 上下文

跨层级传递数据，避免 props 逐层穿透。Context 分静态与响应式两种：

- `createContext<T>(defaultValue)`：静态上下文。Provider 值在 setup 期读取一次；值对象内部可自行携带 Signal，由消费方在 effect 中读取。
- `createReactiveContext<T>(resolve)`：响应式上下文。Provider 的 `value` 传取值函数 `() => T`，`useContext` 返回惰性 Proxy：字段读取发生在 effect / 响应式 getter 中时自动解包 Signal 并建立依赖，数据变化时精准更新对应 DOM（无需整树重渲染）。

```ts
import {
  createContext,
  createReactiveContext,
  useContext,
  provide,
} from "@/core";

// 静态上下文
const ThemeContext = createContext<"light" | "dark">("light");

// 响应式上下文（会变化的跨层数据）
const ConfigContext = createReactiveContext<ControlsConfig>(
  () => defaultControls,
);

provide(
  [{ contextId: ConfigContext.id, value: () => controlsSignal.value }],
  () => h(Child, {}),
);

const config = useContext(ConfigContext);
h("span", {}, () => config.title); // controlsSignal 变化 → 文本精准更新
```

### API

```ts
interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T;
  /** 响应式上下文标记 */
  readonly reactive?: boolean;
  /** 响应式上下文默认取值函数 */
  readonly resolve?: () => T;
}

createContext<T>(defaultValue: T): Context<T>
createReactiveContext<T extends object>(
  resolve: () => T,
  defaultValue?: T,
): Context<T>
useContext<T>(context: Context<T>): T
provide(providers: ProviderEntry[], childFn: () => VNode): VNode
```

### ProviderEntry

```ts
interface ProviderEntry {
  contextId: symbol;
  value: unknown; // 响应式上下文传取值函数 () => T
}
```

### SSR 批量隔离

```ts
const snapshot = saveContext();
// ... 渲染另一个请求 ...
restoreContext(snapshot);
```

> 静态 Context 的值变化不会触发更新；需要随数据变化的跨层数据使用 `createReactiveContext`，
> 并在组件内以响应式表达式（`() => ctx.field` / DOM 属性表达式 / 组件 prop）读取字段。
> 响应式上下文的值必须是对象（Proxy 无法代理原始值）。

---

## 十一、事件总线

### `createTypedEventBus<TMap>()`（推荐）

```ts
import { createTypedEventBus } from "@/core";

interface MyEvents {
  play: undefined;
  volumeChange: { volume: number };
}

const bus = createTypedEventBus<MyEvents>();

const unsub = bus.on("volumeChange", (data) => console.log(data.volume)); // 类型安全
bus.emit("volumeChange", { volume: 0.5 });
bus.emit("play"); // 无 payload 事件
bus.off("volumeChange", handler);
unsub();
```

**特性**：监听器**同步执行**、异常隔离（单个监听器抛错不影响其他）、严格按 emit 顺序。

### `createEventBus()`（已弃用）

无类型版本，签名 `on<T>(event, handler)` / `off` / `emit<T>(event, payload?)`。

---

## 十二、钩子系统

允许插件在关键点介入，支持链式处理（前一个的返回值作为下一个的输入）。

```ts
import { createHookSystem } from "@/core";

const hooks = createHookSystem();

const unregister = hooks.register<{ url: string }, { url: string }>(
  "before:load",
  (ctx) => ({ url: ctx.url + "?t=" + Date.now() }),
);

const result = hooks.run<{ url: string }, { url: string }>("before:load", {
  url: "video.mp4",
});
// result.url === 'video.mp4?t=1234567890'

unregister();
```

```ts
interface HookSystem {
  register<T, R>(name: string, handler: (ctx: T) => R): () => void;
  run<T, R>(name: string, context: T): R;
}
```

> `run` 中单个 handler 抛错会被捕获并 `console.error`，不影响后续 handler；handler 返回 `undefined` 时保留上一个上下文。

---

## 十三、挂载 / 水合 / 销毁

### `mount(vnode, container)`

客户端首次挂载：递归创建 DOM → 绑定 ref/事件 → 触发生命周期。

```ts
mount(h(App, {}), document.getElementById("root")!);
```

服务端环境（`isBrowser()` 为 false）跳过 DOM 操作，仅触发生命周期。

### `hydrate(vnode, container)`

复用 SSR 产出的 DOM，只绑定事件/ref/指令，不重建 DOM，然后触发 `onBeforeMount` / `onMounted`。

```ts
hydrate(createApp({}), document.getElementById("root")!);
```

> **要求**：SSR 与客户端必须产生**结构完全相同**的 VNode 树，否则会标签不匹配告警。

### `destroy(vnode)`

递归销毁：`onBeforeDestroy` → 事件/指令清理 → `_stateCleanups`（useState 取消订阅、effect dispose）→ **清空 ref** → 子节点递归 → 移出 DOM → `onDestroyed`（含 `_templateRefs` 全部置 `null`）。

### `materialize(vnode)`

将 VNode 递归转换为真实 DOM（`mount` 内部使用，也可单独调用）。

### `applyAttrs(el, attrs, vnode)`

把 attrs 应用到已存在的元素（`materialize` 内部使用）。

### `invokeLifecycle(vnode, method)`

递归调用生命周期（`method`: `'onBeforeMount' | 'onMounted' | 'onBeforeDestroy' | 'onDestroyed'`），顺序见[生命周期](#五生命周期)。

---

## 十四、服务端渲染 SSR

### `renderToString(vnode)`

```ts
import { renderToString } from "@/core";

const html = renderToString(h("div", { class: "x" }, "Hello"));
// <div class="x">Hello</div>
```

**特性**：

- 文本转义（`& < > " '`）
- `Fragment` 只输出子元素
- `style` 对象 → 内联样式串（camelCase → kebab-case，CSS 变量 `--x` 保留）
- `class` 数组/对象标准化
- 布尔属性按 HTML 语义输出（`disabled` 而非 `disabled="true"`）
- 跳过 `ref` / `__ref` / `__events` / `__providers` / `directives` / `svgContent` / `innerHTML` / `textContent` / `key`
- 组件递归渲染；错误上报后**重抛**

**SSR 与水合的配合**：

```ts
// entry-server.ts
export function render() {
  return renderToString(createApp({}));
}

// entry-client.ts
hydrate(createApp({}), document.getElementById("root")!);
```

`effect` / `onEffect` **不在 SSR 执行**（只在挂载/水合后启动），因此 SSR 输出的是初始值；请在组件的静态 VNode 里写好初始文本，保证首屏一致。

---

## 十五、样式与类名工具

```ts
import {
  normalizeStyle,
  normalizeStyleValue,
  normalizeClass,
  serializeStyle,
  applyStyle,
  camelToKebab,
} from "@/core";
```

### `normalizeClass(raw: ClassInput): string`

```ts
normalizeClass("a b"); // 'a b'
normalizeClass(["a", { b: true, c: false }]); // 'a b'
normalizeClass({ active: true, hidden: false }); // 'active'
normalizeClass(null); // ''
```

### `normalizeStyle(raw: StyleInput): NormalizedStyle | null`

字符串或对象 → `{ 'font-size': '16px' }`；空结果返回 `null`。值为 `null`/`undefined`/`false` 的属性会被丢弃。

### `normalizeStyleValue(key, value): { prop, value } | null`

单个属性标准化；`--custom-prop` 不做 camelCase→kebab 转换。

### `serializeStyle(raw, escapeFn): string`

SSR 用：返回 ` style="color: red; font-size: 16px;"`，空结果返回 `''`（不会产生 `style=""`）。

### `applyStyle(el, raw): void`

客户端用：走 `el.style.setProperty`（支持 CSS 变量）。

### `camelToKebab(str): string`

`fontSize` → `font-size`。

---

## 十六、警告与错误处理

```ts
import {
  warn,
  reportError,
  safeCall,
  safeAsyncCall,
  assertWarn,
  onFrameworkError,
  onFrameworkWarning,
  WarnSource,
  ErrorSource,
} from "@/core";
```

### 来源枚举

```ts
enum WarnSource {
  H = "h",
  COMPONENT = "component",
  MOUNT = "mount",
  CONTEXT = "context",
  SSR = "ssr",
  LIFECYCLE = "lifecycle",
  STATE = "state",
  EVENT_BUS = "event-bus",
}

enum ErrorSource {
  RENDER = "render",
  LIFECYCLE = "lifecycle",
  EVENT_HANDLER = "event-handler",
  SSR = "ssr",
  HYDRATE = "hydrate",
  SETUP = "setup",
}
```

### API

| API                                           | 说明                                                           |
| --------------------------------------------- | -------------------------------------------------------------- |
| `warn(source, message, data?)`                | 输出警告；**仅开发环境打印到控制台**，始终分发给注册的处理器   |
| `reportError(source, message, error?, data?)` | 上报错误（不抛出），开发环境打印                               |
| `safeCall(fn, source, message, data?)`        | 安全执行同步函数，捕获异常并上报，返回 `T \| undefined`        |
| `safeAsyncCall(fn, source, message, data?)`   | 异步版本，返回 `Promise<T \| undefined>`                       |
| `assertWarn(condition, source, message)`      | 条件为假时输出警告                                             |
| `onFrameworkError(handler)`                   | 注册全局错误处理器，返回取消函数                               |
| `onFrameworkWarning(handler)`                 | 注册全局警告处理器，返回取消函数                               |
| `isDev()`                                     | 是否开发环境（由 `__LUMINA_DEV__` 注入，未注入时默认 `false`） |

```ts
const unsub = onFrameworkError((err) => {
  console.error(`[${err.source}] ${err.message}`, err.error);
});

safeCall(() => riskyOperation(), ErrorSource.RENDER, "渲染失败");
```

### `__LUMINA_DEV__`

由 Vite 编译插件通过 `define` 自动注入：dev `true`、prod `false`（触发死代码消除）。生产构建需开启 `minify` 才能真正 DCE。

---

## 十七、Vite 编译插件

```ts
// vite.config.ts
import { luminaCompile } from "./plugins/vite-plugin-lumina-compile";

export default defineConfig({
  plugins: [luminaCompile()], // 零配置
});
```

### 转换内容

| 源码                                              | 编译后                                                                  | 收益                           |
| ------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| `h('div', { class: 'x' }, 'text')`（全静态）      | `const _hoisted_1 = _createStaticEl(...)` + `_cloneHoisted(_hoisted_1)` | 静态子树只在模块加载时构建一次 |
| `h('div', { onClick: fn }, c)`                    | `_createEl('div', { __events: { click: fn } }, c)`                      | 跳过事件属性遍历判断           |
| `h('div', { ref: r })`                            | `_createEl('div', { __ref: r })`                                        | 跳过 ref 判断                  |
| `h('svg', {}, h('circle'))`                       | `_createSvgEl(...)`                                                     | 跳过 SVG_TAGS 查找             |
| `h('fragment', {}, ...)` / `h(Fragment, {}, ...)` | `_createFragment(...)`                                                  | 丢弃 attrs，直接 rest children |
| `h(MyComp, { p: 1 })`                             | `_createComp(MyComp, { p: 1 })`                                         | 跳过组件类型反射               |
| `const C = defineComponent(...)`                  | 追加 `C.__lumina_type = 'fn'`                                           | 运行时 O(1) 读标记             |
| `class C extends Component {}`                    | 追加 `C.__lumina_type = 'class'`                                        | 同上                           |
| `export default defineComponent(...)`             | 改为 `const _defaultComponent_1 = ...` + 标记 + re-export               | 同上                           |

### 安全设计

- **binding 校验**：只有从框架模块（`@/core`、`@/nova`）导入的 `h`/`defineComponent`/`Fragment`/`Component` 才被转换，**不误伤 preact 等其他库的同名导出**
- **dev/prod 同一套产物**：开发环境也编译（与 Vue/Solid 一致），差异只由 `__LUMINA_DEV__` 控制
- **静态提升仅生产生效**（与 Vue plugin-vue 一致），使用点用 `_cloneHoisted` 克隆避免共享节点污染
- 语法错误时跳过转换、返回原码

### 选项

```ts
interface LuminaCompileOptions {
  /** 静态提升，默认 true（仅生产构建生效） */
  hoistStatic?: boolean;
  /** 注入 __lumina_type 组件类型标记，默认 true */
  compileComponentType?: boolean;
  /** onXxx → __events、ref → __ref 预分类，默认 true */
  compileAttrs?: boolean;
  /** 开发环境也执行转换，默认 true（false = dev 零转换） */
  dev?: boolean;
  /** 包含的文件，默认 [/\.tsx?$/] */
  include?: RegExp[];
  /** 排除的文件，默认 [/node_modules/, /\.test\./, /\.spec\./, /[\\/]core[\\/]/, /plugins[\\/]vite-plugin-lumina-compile/] */
  exclude?: RegExp[];
  /** 编译产物引用的内部函数导入路径，默认 '@/core/internal' */
  internalImportSource?: string;
}
```

---

## 十八、编译期内部函数

`core/internal.ts` 导出的函数由编译器生成的代码引用，**通常不需要手写**：

| 函数                                          | 用途                                                   |
| --------------------------------------------- | ------------------------------------------------------ |
| `_createStaticEl(tag, attrs?, ...children)`   | 静态元素（不做任何判断）                               |
| `_createEl(tag, attrs?, ...children)`         | 动态元素（`__events`/`__ref` 已预分类）                |
| `_createSvgEl(tag, attrs?, ...children)`      | SVG 元素（预设命名空间）                               |
| `_createFragment(...children)`                | Fragment                                               |
| `_createComp(component, attrs?, ...children)` | 组件（读 `__lumina_type` 跳过反射）                    |
| `_cloneHoisted(vnode)`                        | 克隆静态提升节点（每个使用点独立，避免 `el` 互相覆盖） |

这些函数都**保留完整运行时语义**（`__providers` 提取、children 扁平化、错误上报、`__parent` 设置）。

---

## 十九、完整 API 速查表

### 从 `@/core` 导出

| 分类          | API                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **VNode**     | `h`, `defineComponent`, `Fragment`, `when`, `each`                                                                                      |
| **模板引用**  | `useTemplateRef`, `ref`(弃用)                                                                                                           |
| **响应式**    | `signal`, `computed`, `effect`, `batch`, `untracked`, `onEffect`                                                                        |
| **状态**      | `createStateManager`, `createTypedStateManager`, `useState`                                                                             |
| **Context**   | `createContext`, `useContext`, `provide`, `saveContext`, `restoreContext`                                                               |
| **事件总线**  | `createEventBus`(弃用), `createTypedEventBus`                                                                                           |
| **钩子**      | `createHookSystem`                                                                                                                      |
| **DOM**       | `mount`, `materialize`, `applyAttrs`, `destroy`, `invokeLifecycle`, `hydrate`                                                           |
| **SSR**       | `renderToString`                                                                                                                        |
| **样式**      | `normalizeStyle`, `normalizeStyleValue`, `normalizeClass`, `serializeStyle`, `applyStyle`, `camelToKebab`                               |
| **警告/错误** | `warn`, `reportError`, `safeCall`, `safeAsyncCall`, `assertWarn`, `onFrameworkError`, `onFrameworkWarning`, `WarnSource`, `ErrorSource` |
| **编译期**    | `_createStaticEl`, `_createEl`, `_createSvgEl`, `_createFragment`, `_createComp`, `_cloneHoisted`                                       |

### 仅从子路径导出

| API                                            | 路径                 |
| ---------------------------------------------- | -------------------- |
| `show`                                         | `@/core/h`           |
| `flattenChildren`, `SVG_TAGS`, `isFnComponent` | `@/core/h`           |
| `isRefObject`, `isSignalRef`                   | `@/core/templateRef` |
| `pushProviderStack`, `popProviderStack`        | `@/core/context`     |
| `isDev`（未在 index 导出）                     | `@/core/warning`     |

### 类型（从 `@/core` / `@/types` 导入）

```ts
// VNode
(VNode, VNodeAttrs, VNodeChild, VNodeInternalAttrs, HAttrs, HChild);

// 组件
(Component,
  FnComponent,
  ClassComponent,
  ComponentInstance,
  ExposedComponent,
  ExposedApi,
  ComponentAttrs,
  EventCallbacks);

// 生命周期
(Lifecycle,
  ComponentLifecycle,
  TypedComponentLifecycle,
  TypedEmit,
  TypedOn,
  ComponentCallbacks);

// 引用
(Ref, RefValue);

// 响应式
(Signal, ReadonlySignal);

// 状态 / 事件 / 钩子
(StateManager,
  TypedStateManager,
  EventBus,
  TypedEventBus,
  HookSystem,
  PlayerEventMap,
  PlayerEventBus);

// 指令
(Directive, DirectiveTuple, DirectiveFn);

// 警告/错误
(FrameworkError, FrameworkWarning, GlobalErrorHandler, GlobalWarningHandler);
```

### 常见陷阱

| 陷阱                                        | 正确做法                                      |
| ------------------------------------------- | --------------------------------------------- |
| 在 setup 里读 `signal.value` 当依赖         | 在 `effect` / `onEffect` 里读                 |
| 循环里用 `useTemplateRef(lc, '同一个key')`  | 每个 item 用独立 `signal()`                   |
| 子组件 prop 传 `count.value`                | 传 `count`（signal 本身）                     |
| 状态变化后等 DOM 自动更新                   | 在 `effect` / `useState` updater 里手动写 DOM |
| SSR 首屏文本与客户端不一致                  | 在静态 VNode 里写好初始文本，effect 只做更新  |
| `ref: 'x'` 但没调 `useTemplateRef(lc, 'x')` | 两者 key 必须一致，否则开发环境告警           |

---

## 附录：`<video>` 元素全部标准媒体事件

播放器对 `<video>` 绑定了 **HTML5 媒体元素全部 21 个标准事件**，每个事件都会：

1. 同步运行时状态到 Store / StateManager
2. 通过事件总线发出对应的 `PlayerEventEnum` 事件
3. 触发 `PlayerConfig.callbacks` 中的回调

### 事件清单与暴露名称

| `<video>` 事件   | `PlayerEventEnum` | `callbacks` 回调 | 参数                      |
| ---------------- | ----------------- | ---------------- | ------------------------- |
| `loadstart`      | `LOAD_START`      | `loadstart`      | —                         |
| `loadedmetadata` | `LOADED_METADATA` | `loadedmetadata` | `(duration: number)`      |
| `loadeddata`     | `LOADED_DATA`     | `loadeddata`     | —                         |
| `canplay`        | `CAN_PLAY`        | `canplay`        | —                         |
| `durationchange` | `DURATION_CHANGE` | `durationchange` | `(duration: number)`      |
| `progress`       | `PROGRESS`        | `progress`       | `(buffered: TimeRanges)`  |
| `suspend`        | `SUSPEND`         | `suspend`        | —                         |
| `stalled`        | `STALLED`         | `stalled`        | —                         |
| `abort`          | `ABORT`           | `abort`          | —                         |
| `emptied`        | `EMPTIED`         | `emptied`        | —                         |
| `error`          | `ERROR`           | `error`          | `(error: MediaError)`     |
| `play`           | `PLAY`            | `play`           | —                         |
| `playing`        | `PLAYING`         | `playing`        | —                         |
| `pause`          | `PAUSE`           | `pause`          | —                         |
| `ended`          | `ENDED`           | `ended`          | —                         |
| `timeupdate`     | `TIME_UPDATE`     | `timeupdate`     | `(currentTime, duration)` |
| `seeking`        | `SEEKING`         | `seeking`        | `(currentTime: number)`   |
| `seeked`         | `SEEKED`          | `seeked`         | `(currentTime: number)`   |
| `volumechange`   | `VOLUME_CHANGE`   | `volumechange`   | `(volume, muted)`         |
| `ratechange`     | `RATE_CHANGE`     | `ratechange`     | `(rate: number)`          |
| `waiting`        | `WAITING`         | `waiting`        | —                         |

### 使用示例

```ts
const player = new VideoPlayer({
  src: "video.mp4",
  callbacks: {
    loadstart: () => console.log("开始加载"),
    loadedmetadata: (duration) => console.log("时长", duration),
    seeking: (t) => console.log("跳转到", t),
    seeked: (t) => console.log("跳转完成", t),
    ratechange: (r) => console.log("速率", r),
    stalled: () => console.warn("数据停滞"),
    suspend: () => console.log("浏览器暂停加载（已缓冲足够）"),
    abort: () => console.log("加载被中止"),
    emptied: () => console.log("媒体被清空"),
  },
});

// 或通过事件总线
player.on(PlayerEventEnum.SEEKED, ({ currentTime }) => {});
```

### 需要注意的浏览器行为差异

| 事件                | 注意事项                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `ended`             | `loop=true` 且 `playbackRate` 非负时**不会触发**                                                                                 |
| `error`             | 使用 `<source>` 子元素时错误在 `<source>` 上触发且**不冒泡**到 `<video>`；播放器始终把 `src` 直接设在 `<video>` 上，因此可以捕获 |
| `seeking` / `pause` | 部分旧版浏览器在程序化 seek 时可能触发额外的 `pause`                                                                             |
| `timeupdate`        | 触发频率在约 **4Hz ~ 66Hz** 之间，取决于系统负载（勿做重活）                                                                     |
| `progress`          | 加载过程中**周期性**触发，不是一次性                                                                                             |
| `loadeddata`        | 移动端「数据节省」模式下可能**不触发**                                                                                           |
| `stalled`           | Firefox 在正确派发该事件上曾有实现问题                                                                                           |
| `play`              | autoplay 场景下可能在视频成功加载前就触发（即使最终加载失败）                                                                    |
