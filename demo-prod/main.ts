/**
 * demo-prod 组件定义
 * ============================================
 * 与 demo/main.ts 结构一致，但播放器从构建产物导入（验证打包是否正确）。
 *
 * 导入策略：
 * - 框架核心（h, defineComponent, useState 等）：经 workspace 包名
 *   @lumina/framework 导入（框架已独立成包）
 * - 播放器（VideoPlayer）：从 @lumina/nova 构建产物导入
 *   这是 vite build 构建后的 ES 模块产物，验证 luminaCompile 插件是否生效
 * - 插件（HLS, DASH）：在 entry-client.ts 中按需从 dist 导入
 */

import {
  h,
  defineComponent,
  createTypedStateManager,
  useTemplateRef,
  signal,
  computed,
  effect,
  onEffect,
} from "@lumina/framework";
import type { Signal } from "@lumina/framework";

// ★ 从构建产物导入播放器（monorepo 链接到 packages/player/dist）
import { VideoPlayer } from "@lumina/nova";

// ============================================
// 全局状态：简单的计数器，用于验证 useState + hydrate
// ============================================

/** 状态路径 → 类型映射 */
interface AppState {
  "app.count": number;
}

/** 创建类型安全的状态管理器，初始值 count = 0 */
const appState = createTypedStateManager<AppState>({ app: { count: 0 } });

// ============================================
// 组件 1：VideoPlayer 播放器
// ============================================
//
// 工作流程：
// 1. new VideoPlayer(config) — 构造函数 SSR 安全（不访问 DOM）
// 2. player.render() — 返回完整播放器 UI 的 VNode 树
// 3. SSR 阶段：renderToString 将 VNode 序列化为 HTML，首屏即含播放器 UI
// 4. 客户端水合：hydrate() 绑定事件到已有 DOM，无需二次挂载

const PlayerSection = defineComponent(() => {
  // 播放器配置：MP4 视频源，静音自动播放
  const cfg = {
    src: "http://127.0.0.1:9000/hfs/2477ae7a06076094f88e58417a9211797648bfde5f6244713b12404de1372440.mp4",
    autoplay: false,
    muted: true,
    volume: 0.8,
    keyboard: true,
    debug: false,
  };

  // 创建播放器实例（SSR 安全，不访问浏览器 API）
  const player = new VideoPlayer(cfg as never);

  return h(
    "div",
    { class: "panel" },
    // 面板标题
    h("h2", { class: "panel-title" }, "VideoPlayer · 构建产物验证"),

    // 播放器容器：嵌入 player.render() 返回的 VNode
    // SSR 输出完整 HTML，水合时 PlayerDocker.onMounted 自动绑定事件
    h(
      "div",
      {
        id: "player-wrapper",
        class: "player-wrapper",
      },
      player.render(),
    ),

    // 操作按钮行
    h(
      "div",
      {
        style: { display: "flex", gap: "8px", marginTop: "10px" },
      },
      h("button", { id: "btn-switch", class: "btn" }, "切换视频源"),
      h("button", { id: "btn-destroy", class: "btn" }, "销毁播放器"),
    ),
  );
});

// ============================================
// 组件 2：计数器（useTemplateRef + state.signal + onEffect）
// ============================================
//
// 新框架统一为 useTemplateRef + Signal：
// - useTemplateRef(lifecycle, 'count') 返回 Signal，字符串 key 绑定 DOM，销毁自动清空
// - state.signal('app.count') 把状态路径变成 Signal，与 signal/effect 同引擎
// - onEffect 挂载后启动、依赖变化自动重跑、销毁自动 dispose

const Counter = defineComponent((_props, lifecycle) => {
  // 用字符串 key 获取 DOM 元素引用（SSR 时 Signal = null，水合后指向真实 DOM）
  const countEl = useTemplateRef<HTMLElement>(lifecycle, 'count');
  // 状态路径 → Signal（与 signal/computed 同引擎）
  const countSig = appState.signal('app.count');

  const getCount = (): number => appState.get("app.count") ?? 0;

  // onEffect：首次同步执行完成初始渲染，countSig 变化时自动重跑
  onEffect(lifecycle, () => {
    if (countEl.value) countEl.value.textContent = String(countSig.value);
  });

  return h(
    "div",
    { class: "panel" },
    h("h2", { class: "panel-title" }, "计数器 · useTemplateRef + state.signal + onEffect"),

    h(
      "div",
      {
        style: { display: "flex", alignItems: "center", gap: "12px" },
      },
      h(
        "button",
        {
          class: "btn",
          onClick: () => appState.set("app.count", getCount() - 1),
        },
        "−",
      ),
      h(
        "span",
        {
          ref: 'count',
          style: {
            fontSize: "20px",
            fontWeight: "700",
            minWidth: "40px",
            textAlign: "center",
          },
        },
        String(getCount()),
      ),
      h(
        "button",
        {
          class: "btn",
          onClick: () => appState.set("app.count", getCount() + 1),
        },
        "+",
      ),
      h(
        "button",
        {
          class: "btn",
          onClick: () => appState.set("app.count", 0),
        },
        "重置",
      ),
    ),
  );
});

// ============================================
// 组件 3：signal + effect（裸 effect，手动 dispose）
// ============================================
//
// 展示最底层的响应式原语：signal（变量）+ effect（副作用）。
// 手动在 onMounted 启动、onDestroyed 中 dispose；生产推荐用 onEffect 自动绑定生命周期。

const SignalCounter = defineComponent((_props, lifecycle) => {
  // signal：响应式变量，读 .value 建立依赖
  const count = signal(0);
  const elRef = useTemplateRef<HTMLSpanElement>(lifecycle, 'n');

  let dispose: (() => void) | undefined;
  lifecycle.onMounted = () => {
    // effect 首次同步执行 + count 变化自动重跑；返回 dispose 函数
    dispose = effect(() => {
      if (elRef.value) elRef.value.textContent = String(count.value);
    });
  };
  lifecycle.onDestroyed = () => {
    dispose?.();
  };

  return h(
    "div",
    { class: "panel" },
    h("h2", { class: "panel-title" }, "signal + effect · 裸响应式原语"),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "12px" } },
      h("button", { class: "btn", onClick: () => count.value-- }, "−"),
      h("span", { ref: 'n', style: { fontSize: "20px", fontWeight: "700" } }, "0"),
      h("button", { class: "btn", onClick: () => count.value++ }, "+"),
    ),
  );
});

// ============================================
// 组件 4：computed + onEffect（派生值自动更新）
// ============================================

const ComputedExample = defineComponent((_props, lifecycle) => {
  const a = signal(2);
  const b = signal(3);
  // computed：派生值，依赖 a/b，自动缓存 + 惰性求值
  const sum = computed(() => a.value + b.value);
  const sumElRef = useTemplateRef<HTMLSpanElement>(lifecycle, 'sum');

  onEffect(lifecycle, () => {
    if (sumElRef.value) {
      sumElRef.value.textContent = `${a.value} + ${b.value} = ${sum.value}`;
    }
  });

  return h(
    "div",
    { class: "panel" },
    h("h2", { class: "panel-title" }, "computed + onEffect · 派生值"),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "12px" } },
      h("button", { class: "btn", onClick: () => a.value++ }, "a + 1"),
      h("button", { class: "btn", onClick: () => b.value++ }, "b + 1"),
      h("span", { ref: 'sum', style: { fontSize: "18px" } }, "2 + 3 = 5"),
    ),
  );
});

// ============================================
// 组件 5：useTemplateRef（字符串 key 绑定 + 操作 DOM）
// ============================================

const TemplateRefExample = defineComponent((_props, lifecycle) => {
  // useTemplateRef：返回 Signal，挂载后自动指向 DOM，销毁自动置 null
  const inputRef = useTemplateRef<HTMLInputElement>(lifecycle, 'input');
  const boxRef = useTemplateRef<HTMLDivElement>(lifecycle, 'box');

  const focus = (): void => {
    inputRef.value?.focus();
  };
  const measure = (): void => {
    if (boxRef.value) {
      boxRef.value.textContent = `${boxRef.value.offsetWidth} × ${boxRef.value.offsetHeight}`;
    }
  };

  return h(
    "div",
    { class: "panel" },
    h("h2", { class: "panel-title" }, "useTemplateRef · 字符串 key 绑定 DOM"),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "12px" } },
      h("input", { ref: 'input', class: "btn", placeholder: "点击按钮聚焦我" }),
      h("button", { class: "btn", onClick: focus }, "聚焦输入框"),
    ),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "12px", marginTop: "12px" } },
      h("div", {
        ref: 'box',
        style: {
          padding: "16px 24px",
          background: "rgba(0,180,216,.12)",
          borderRadius: "8px",
          border: "1px solid rgba(0,180,216,.35)",
        },
      }, "盒子尺寸待测"),
      h("button", { class: "btn", onClick: measure }, "读取尺寸"),
    ),
  );
});

// ============================================
// 组件 6：signal 作为 prop 传给子组件（子组件 effect 追踪）
// ============================================
//
// props 是引用传递、无解包，signal 对象原样传给子组件，
// 子组件在 effect 里读 props.count.value 自动建立依赖。

const SignalChild = defineComponent<{ count: Signal<number> }>((props, lifecycle) => {
  const elRef = useTemplateRef<HTMLSpanElement>(lifecycle, 'child');
  onEffect(lifecycle, () => {
    if (elRef.value) {
      elRef.value.textContent = `子组件读到 count = ${props.count.value}`;
    }
  });
  return h("span", { ref: 'child', style: { fontSize: "16px", color: "#81c784" } }, "子组件读到 count = 0");
});

const ParentChildSignal = defineComponent((_props, _lifecycle) => {
  const shared = signal(0);
  return h(
    "div",
    { class: "panel" },
    h("h2", { class: "panel-title" }, "signal 作为 prop 传给子组件"),
    h(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "12px" } },
      h("button", { class: "btn", onClick: () => shared.value++ }, "父组件 +1"),
      h(SignalChild, { count: shared }),
    ),
  );
});

// ============================================
// 组件 7：SSR 信息展示
// ============================================

const Info = defineComponent(() => {
  return h(
    "div",
    { class: "panel" },
    h("h2", { class: "panel-title" }, "构建信息"),

    h(
      "div",
      {
        style: {
          fontSize: "13px",
          color: "rgba(255,255,255,0.5)",
          lineHeight: "1.8",
        },
      },
      h("div", {}, "播放器: packages/player/dist/index.es.js"),
      h("div", {}, "插件:   packages/plugins/dist/"),
      h("div", {}, "编译:   vite-plugin-lumina-compile"),
      h("div", {}, "渲染:   renderToString → HTML → hydrate"),
    ),
  );
});

// ============================================
// 根组件
// ============================================

const RootLayout = defineComponent(() => {
  return h(
    "div",
    { class: "app-container" },
    h("h1", {}, "Nova Player · 构建产物验证"),
    h(
      "p",
      { class: "subtitle" },
      "SSR + Hydration · luminaCompile 编译优化 · useTemplateRef + Signal 响应式",
    ),
    PlayerSection({}),
    Counter({}),
    SignalCounter({}),
    ComputedExample({}),
    TemplateRefExample({}),
    ParentChildSignal({}),
    Info({}),
  );
});

// ============================================
// 导出入口函数（SSR 和客户端共用）
// ============================================

/**
 * createApp 被 entry-server.ts（SSR）和 entry-client.ts（水合）共同调用。
 * 两次调用必须产生完全相同的 VNode 树，否则 hydrate 时 VNode 与 DOM 不匹配。
 */
export function createApp(_props: Record<string, unknown>) {
  return h(RootLayout, {});
}
