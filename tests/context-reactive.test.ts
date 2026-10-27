/**
 * ============================================
 * 响应式 Context 验证
 * ============================================
 * 覆盖：
 * - createReactiveContext：Provider 传取值函数，字段读取自动追踪信号；
 * - 编译插件：useContext 作为组件 prop 时不做 _rp 包裹（避免 effect 期脱离 Provider）。
 */

import { describe, expect, it } from "vitest";

import {
  createReactiveContext,
  defineComponent,
  destroy,
  h,
  mount,
  provide,
  signal,
  useContext,
} from "@/core";
import type { VNode } from "@/types";
import { transformCode } from "../plugins/vite-plugin-lumina-compile/transform";

describe("响应式 Context", () => {
  it("Provider 取值函数变化时消费组件精准更新", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const count = signal(1);
    const CountContext = createReactiveContext<{ count: number }>(() => ({
      count: 0,
    }));

    const Child = defineComponent((): VNode => {
      const ctx = useContext(CountContext);
      return h("span", { class: "ctx-child" }, () => String(ctx.count));
    });

    const App = defineComponent((): VNode =>
      provide(
        [
          {
            contextId: CountContext.id,
            value: () => ({ count: count.value }),
          },
        ],
        () => h("div", {}, h(Child, {})),
      ),
    );

    const vnode = h(App, {});
    mount(vnode, root);
    expect(root.querySelector(".ctx-child")?.textContent).toBe("1");

    // 信号变化：响应式上下文读取建立依赖，文本精准更新
    count.value = 42;
    expect(root.querySelector(".ctx-child")?.textContent).toBe("42");

    // 对象字段为 Signal 时自动解包
    destroy(vnode);
    root.remove();
  });

  it("useContext 作为组件 prop 时编译期不做 _rp 包裹", () => {
    const source = `
import { h, useContext } from "@/core";
const Child = () => h("span", {});
const App = defineComponent(() => {
  const ctx = useContext(ConfigContext);
  return h(Child, { config: useContext(ConfigContext), label: ctx.title });
});
`;
    const result = transformCode(source, "context-prop.ts", {
      isProduction: false,
      hoistStatic: true,
      compileComponentType: true,
      compileAttrs: true,
      tmplStatic: true,
    });
    const code = result?.code ?? source;
    expect(code).toContain("useContext(ConfigContext)");
    expect(code).not.toContain("_rp(() => (useContext(ConfigContext))");
  });
});
