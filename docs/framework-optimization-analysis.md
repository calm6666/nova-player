# 框架优化分析报告：h 函数与 vite-plugin-lumina-compile

> 分析范围：`core/h.ts`、`core/internal.ts`、`core/mount.ts`、`core/ssr.ts`、`plugins/vite-plugin-lumina-compile/*`
> 结论先行：编译插件的思路（h() → 专用内部函数）方向正确，但目前存在 **3 个编译路径下的功能性 Bug**、**1 个架构性缺陷（dev/prod 双路径不一致）**，以及若干未完成的优化点。h 函数本身有少量可减的分配开销。

---

## 一、整体架构回顾

框架是"无响应式 + 手动 DOM 更新"的极简 VNode 框架：

- `h(tag, attrs, ...children)` 返回纯数据 VNode；
- `mount/materialize` 递归创建 DOM；`hydrate` 复用 SSR 的 DOM；
- 编译插件在生产构建时把 `h()` 替换为 `_createStaticEl/_createEl/_createSvgEl/_createFragment/_createComp`，跳过运行时类型判断，并把静态调用提升为模块级常量。

这个设计和 Vue 3 的 `transformElement + hoistStatic`、Solid 的编译思路一致，方向没问题。问题出在**双路径一致性**和**编译产物覆盖不完整**上。

---

## 二、P0：编译路径下的 3 个功能性 Bug

### Bug 1：SSR 会把 `__events` 序列化成垃圾属性

- 位置：`core/ssr.ts` `SKIP_ATTRS`（L59-71）
- 现象：编译后的代码 `_createEl('div', { __events: { click: fn } })` 走 SSR 时，`serializeAttrs` 遍历 attrs：`__events` 不在 SKIP_ATTRS 里，也不以 `on` 开头，值又是对象 → 输出 `__events="[object Object]"` 到 HTML。
- 对比：dev 模式下 `h()` 不产生 `__events`，所以这个 Bug 只在"生产构建 + SSR"时出现——正是最不容易被发现的位置。
- 修复：`SKIP_ATTRS` 加入 `"__events"`（与 `__ref`/`__providers` 并列）。

### Bug 2：hydrate 不认 `__ref`，编译后水合丢失 ref 绑定

- 位置：`core/mount.ts` L838 `const refValue = attrs.ref;`
- 现象：`applyAttrs` 用 `attrs.__ref ?? attrs.ref`（L301），但 `hydrateNode` 只读 `attrs.ref`。编译后 ref 被改名为 `__ref`，水合时 ref 完全失效（回调 ref / 对象 ref 都不执行）。
- 修复：hydrateNode 改为 `const refValue = attrs.__ref ?? attrs.ref;`，与 applyAttrs 对齐。

### Bug 3：`_createEl/_createStaticEl` 不提取元素级 `__providers`

- 位置：`core/internal.ts` L38-71；`core/mount.ts` L336-420（applyAttrs 的 key 跳过清单）
- 现象：`h()` 的元素分支会提取 `__providers` 并写入 `vnode.__providers`（h.ts L349-356），但编译后的 `_createEl` 原样保留 attrs → `applyAttrs` 遍历时执行 `el.setAttribute('__providers', '[object Object]')`，且 `useContext` 沿 `__parent` 链找不到 Provider。框架文档（context.ts L73）明确支持 `h('div', { __providers: [...] }, children)` 这种写法，编译后即失效。
- 修复：`_createEl`（含静态分支）提取 `__providers` 到 `vnode.__providers` 并从 attrs 删除；`applyAttrs` 的跳过清单补上 `__providers` 兜底。

> 这三个 Bug 同根同源：**编译产物引入的新内部字段（`__events`/`__ref`/`__providers`）没有在所有消费点（mount / hydrate / SSR）同步处理**。建议先统一为一份"内部字段清单"，三处消费点共用。

---

## 三、P1：架构性缺陷——dev/prod 双路径不一致

当前插件 dev 模式 `transform` 直接 `return null`，只有 prod 走编译路径。后果：

1. 上面 3 个 Bug 在 `vite dev` 下永远不会复现，上线才炸；
2. dev 与 prod 的 VNode 结构、attrs 内容、错误行为都可能不同（如 SVG 根节点 xmlns、`__providers` 提取），"dev 正常 prod 异常"排查成本极高；
3. `__lumina_type` 标记、`_create*` 函数在 dev 下零覆盖。

Vue/Solid 的做法是 **dev 和 prod 编译同一份代码**，差异只由 `__DEV__` 条件分支 + DCE 决定。本插件已经注入了 `__LUMINA_DEV__`，完全可以：

- dev 也执行转换（生成 `_create*`），只是保留 `if (__LUMINA_DEV__)` 包裹的开发警告；
- 或至少：新增"编译产物级"集成测试，把 transformCode 的输出喂给 jsdom 跑 mount/SSR/hydrate，覆盖编译路径。

---

## 四、P1：插件自身的正确性风险

### 4.1 `isHCall` 不校验 `h` 的来源，会误伤其他库

- `transform.ts` L128-130：只要 callee 是标识符 `h` 就转换；`index.ts` L73-78 的 `usesFrameworkAPI` 正则也不检查 import 的**来源模块**。
- 后果：文件里 `import { h } from 'preact'`（或用户自己的局部 `h` 函数），只要同时 import 了本框架的任意 API，preact 的 `h(...)` 会被改写成 `_createComp(...)` → 静默破坏。
- 修复：在 traverse 里用 babel scope 解析 `h` 的 binding，确认其来自框架模块；`usesFrameworkAPI` 的正则把 `from ['"]...` 的来源也纳入匹配（只认 `@/core`、`lumina`、`nova` 等已知入口）。

### 4.2 静态提升不递归：真实代码几乎提升不动

- `transform.ts` `isAllStatic` L157-173：参数里出现任何 CallExpression（包括嵌套的 `h(...)`）即判为非静态。
- 实际代码（如 `Ending.ts`、`SettingMenu.ts`、`ColorPanel.ts`）几乎全是"外层 h + 嵌套 h"的树，当前策略下只有孤立的叶子节点能提升，收益很小。
- 修复：参考 Vue 的 `isStaticNode`：递归判定整棵子树静态后整体提升，提升代码里嵌套调用换成 `_createStaticEl`，并保证提升顺序（子先父后）。

### 4.3 提升的静态节点被多处挂载时会互相污染

- `_hoisted_N` 是模块级共享对象，`materialize` 会写 `vnode.el`（mount.ts L203-205）、`child.__parent`；若同一静态节点在树中出现两次（或同一组件两次渲染复用），后挂载的会覆盖 `el`，`destroy` 只移除最后一个。
- 修复：Vue 的做法是 `cloneVNode(hoisted)`——提升常量使用时包一层浅拷贝，或在 `materialize` 入口对"无 `__parent` 的已挂载节点"做克隆。

### 4.4 其他小问题

- `export default defineComponent(...)` 不注入 `__lumina_type`（transform.ts L353-358），prod 下仍走反射 fallback——可用"本地 const + 重新 export default"改写。
- `markClassComponent` 只认字面名为 `Component` 的父类（L380-381）。
- `markComponentType` 用 `s.appendRight(node.end, ';\n...')` 注入，遇到 `export const X = defineComponent(...)` 等写法是合法的，但没有针对 ASI/注释边界做测试。
- SVG 标签表在 `core/h.ts` 与 `plugins/.../svgTags.ts` **双份维护**（内容相同），必然漂移——应只保留一份，两处 import。
- 注入的 `import { _createStaticEl, ... } from '@/core/internal'` 硬编码别名 `@/core`：用户项目必须恰好配了同名 alias 才能用这个插件；应从框架解析路径推导，或支持配置。
- 只要发生任何转换就注入全部 5 个函数（transform.ts L33-34），应跟踪实际用到的函数按需注入（rollup 能摇掉，但产物更干净）。

---

## 五、P2：h 函数本身的优化点

### 5.1 子节点扁平化分配过多

- `h.ts` L232-234：`children.flat(3).filter(...)`——每次调用产生最多 4 个中间数组。
- 修复：单次遍历的手写 flatten（维护一个栈/深度），`null/undefined` 内联过滤，一次分配。`core/internal.ts` 的 `flattenChildren` 同样处理。

### 5.2 组件 props 双重展开

- `h.ts` L254 `const attrsWithoutRef = { ...rawAttrs }` + L263 `props = { ...attrsWithoutRef, children }`：两次对象展开。
- 修复：一次遍历拷贝并剔除 `ref`/`__providers`，最后补 `children`。

### 5.3 dev 下组件类型反射可缓存

- `getComponentType`（h.ts L115-131）在无 `__lumina_type` 标记时每次做 `Object.getOwnPropertyDescriptor` 反射。prod 有标记没问题，dev 可用 `WeakMap<Function, 'fn'|'class'>` 缓存（class 身份稳定，缓存安全）。

### 5.4 小项

- `when(false, vnode)` 返回 `""`，mount 时会创建一个空文本节点；可返回 `null` 让 `h()` 过滤（需同步改类型）。
- `show()` 每次调用深拷贝 style（L574-601）——这是 P1-8 的修复产物，行为正确，但高频调用下成本存在；若热路径需要，可改为惰性拷贝。

---

## 六、P2：构建产物层面的优化机会

1. `packages/player/vite.config.ts` `minify: false`：`isDev()` 是函数调用，esbuild define 只替换 `__LUMINA_DEV__`，**不做 minify 就不会发生 DCE**，lib 构建产物里 dev 警告代码全部保留。建议 lib 构建开 `minify: 'esbuild'`（或把 `isDev()` 内联为可折叠的常量表达式）。
2. `include: [/\.tsx?$/]` 默认不含 `.js/.mjs`：消费方若用 JS 写组件，编译优化完全缺席（demo 是 .ts 无感，但对外提供时要注意）。
3. 插件对 `each`/`when`/`show` 没有任何编译处理——`each` 每次渲染全量重建数组（无 key diff），这是设计决策（无响应式），但如果要做性能提升，`each` 的 keyed diff 是下一个大头，建议单独立项评估。

---

## 七、建议的落地顺序

| 优先级 | 事项 | 工作量 |
|--------|------|--------|
| P0 | 修 3 个编译路径 Bug（`__events` SSR、hydrate `__ref`、元素级 `__providers`） | 小（~1 天） |
| P1 | 插件补测试：transform 单测（快照）+ 编译产物跑 mount/SSR/hydrate 集成测试 | 中（~2 天） |
| P1 | `isHCall` 来源校验（babel scope） | 小 |
| P1 | 静态提升递归化 + 提升节点 clone 复用 | 中（~2 天） |
| P2 | SVG 表去重、按需注入 import、`export default` 标记、alias 可配置 | 小 |
| P2 | h() flatten 单遍化、props 单次展开、dev 类型缓存 | 小 |
| P2 | lib 构建开 minify 让 `__LUMINA_DEV__` DCE 生效 | 小 |

> 注：本次分析过程中 `pnpm test` 因沙箱限制（esbuild spawn EPERM）无法执行，上述结论全部基于静态代码阅读；建议修复后在本地跑一遍 `pnpm test` 和 `pnpm build` 验证。

---

## 八、P0 修复记录（已完成）

| Bug | 修复文件 | 说明 |
|-----|---------|------|
| SSR 序列化 `__events` | `core/ssr.ts` | `SKIP_ATTRS` 增加 `"__events"`，与 `__ref`/`__providers` 并列 |
| hydrate 不认 `__ref` | `core/mount.ts` | `hydrateNode` 改为 `attrs.__ref ?? attrs.ref`，与 `applyAttrs` 对齐 |
| 元素级 `__providers` 失效 | `core/internal.ts` + `core/mount.ts` | `_createStaticEl/_createEl/_createSvgEl` 提取 `__providers` 到 `vnode.__providers`（与 h() 一致）；`applyAttrs` 跳过清单兜底加 `__providers` |

回归测试：

- `tests/core/ssr.test.ts`：`__ref`/`__events` 不序列化（新增 2 条）
- `tests/core/hydrate.test.ts`：编译路径 `__ref` 水合绑定（新增 1 条）
- `tests/core/internal.test.ts`（新增）：`__providers` 提取、无 DOM 属性泄漏、SSR 跳过、与 h() 行为一致性（6 条）

验证结果：`tests/core` 222 条全通过；全量 382 条中仅 `VideoPlayer > should merge default config` 失败——经 stash 对照确认是**改动前即存在**的历史问题（`PlayerConfig.controls` 默认值合并，与 typecheck 中 `Property 'controls' does not exist on type 'PlayerConfig'` 同源），与本次修复无关。

---

## 九、P1/P2 修复记录（已完成）

### 9.1 插件核心改造：dev/prod 统一编译（与 Vue/Solid 一致）

- **`plugins/vite-plugin-lumina-compile/index.ts`**
  - `dev` 选项默认改为 `true`：开发模式也执行转换，dev/prod 同一套编译产物，编译路径的 Bug 在 dev 即可暴露（双路径不一致是 P0 三连 Bug 的根源）
  - `hoistStatic` 仅生产构建生效（`isProduction && opts.hoistStatic`，与 Vue plugin-vue 一致）
  - 新增 `internalImportSource` 选项（默认 `@/core/internal`），用户可覆盖别名
- **dev 验证**：`vite dev` 下 `demo/main.ts` 实际输出 `_createComp`×58 / `_createEl`×103 / 注入 `core/internal` 导入，且无 `_hoisted_`（提升仅生产）

### 9.2 插件正确性修复（`plugins/vite-plugin-lumina-compile/transform.ts` 重写）

| 问题 | 修复 |
|------|------|
| `isHCall` 不校验来源，preact 等库的 `h` 会被误改 | babel scope binding 校验（`isFrameworkNamedImport`）：只有来自 `@/core`/`@/nova` 等框架模块的 h/defineComponent/Fragment/Component 才转换；支持 `import { h as alias }` 别名 |
| 静态提升不递归，真实代码几乎提升不动 | 递归 `isStaticSubtree` + 预扫描标记提升目标；AST 级代码生成（`genStaticExpr`），无字符串拼接冲突；嵌套静态调用内联进父级提升代码 |
| 提升常量共享对象互相污染（el 覆盖/destroy 错删） | 使用点生成 `_cloneHoisted(_hoisted_N)`（新增 `core/internal.ts` 运行时函数，深克隆独立树，Vue cloneVNode 同思路） |
| `h('fragment', {}, ...)` 的 attrs 被当子节点 | 字符串形式与 `h(Fragment, {}, ...)` 形式都丢弃 attrs，生成 `_createFragment(...children)` |
| `export default defineComponent(...)` 无标记 | 改写为临时 const + 标记 + 重新导出 |
| class 标记只看字面名 `Component` | 改为 binding 校验 |
| 只要转换就注入全部 5 个函数 | `usedInternalFns` 按需注入 |
| attrs 内的 h() 调用被转换/与 rewriteAttrs 冲突 | `isInsideAttrsOfHCall` 跳过 |

### 9.3 运行时与构建优化

- **`core/h.ts`**：`flattenChildren` 单遍扁平化（替代 `flat(3)+filter` 的 4 次分配）；组件 props 单次遍历拷贝（替代两次展开）；`getComponentType` 增加 WeakMap 缓存（dev 反射只做一次）；`SVG_TAGS` 导出为单一数据源
- **`core/internal.ts`**：flatten 复用 `h.ts` 实现；`_createComp` props 单次拷贝；新增 `_cloneHoisted`
- **`plugins/.../svgTags.ts`**：改为从 `core/h` 再导出（消除双份 SVG 表漂移）
- **`core/index.ts`**：导出 `_cloneHoisted`
- **`packages/player/vite.config.ts`**：`minify: false → 'esbuild'`，让 `__LUMINA_DEV__` 替换后触发 DCE（此前 dev 警告代码全量留在库产物）

### 9.4 新增测试

- `tests/plugin/lumina-compile.test.ts`（20 条）：dev 默认编译、dev:false 退出、递归提升、克隆复用、属性预分类、SVG、Fragment 两种形式、组件/export default/class 标记、preact h 与局部 h 不误伤、别名导入、按需注入、真实组件文件（Ending.ts）dev/prod 冒烟
- `tests/core/internal.test.ts` 新增 `_cloneHoisted` 多次挂载互不污染测试

验证结果：全量 402 条中 401 通过（唯一失败仍为历史遗留的 `VideoPlayer > should merge default config`）；`core/`、`plugins/`、`tests/` 目录 tsc 类型检查零新增错误；`packages/player` 的 `vite build` 生产构建通过（`tsc && vite build` 中的 tsc 步骤因改动前就存在的类型错误失败，经 stash 对照确认与本次修改无关），产物经 sourcemap 确认包含 `_hoisted_N`/`_cloneHoisted`，且 minify 后 dev 警告代码已被 DCE 移除。

---

## 十、编译器优化（本轮：attrs 护栏收紧 / L12 / L15）

> §9.2 末行「attrs 内的 h() 调用被转换/与 rewriteAttrs 冲突 → `isInsideAttrsOfHCall` 跳过」
> 中的「与 rewriteAttrs 冲突」表述**已过时**，本轮重新表述并收紧，见 10.1。

### 10.1 `isInsideAttrsOfHCall` 收紧：区分「值位置」与「函数体内」

**问题**：原实现只要向上遇到「框架 h() 的第 2 实参」就跳过，导致 `For/Switch/Match/Dynamic`
的 render/key 回调与组件 render prop 体内的代码**静默失去全部编译期优化**
（无 `__reactiveAttrs`、无 `_reactiveText`、无静态提升 ⇒ 信号属性不会自动更新）。
典型受害位置：`packages/*/src/**` 中所有 `render: (item) => h('div', { class: dyn }, ...)`。

**收紧后的精确规则**（沿祖先链自底向上）：

| 位置 | 判定 | 处理 |
|------|------|------|
| 直接落在 ObjectProperty 的 value / ArrayExpression 元素 / SpreadElement 参数上 | 值位置 | **跳过**（属性值不是子节点） |
| 跨越函数边界（箭头/函数表达式/函数声明）后 | 函数体内 | **正常转换** |
| 容器里的值本身就是函数定义 | 该边只是函数定义处 | 不视为值位置 |

```ts
// h(C, { icon:  h('span') })                  → 跳过（icon 的值就是该 VNode）
// h(C, { list: [h('i')] })                    → 跳过
// h(C, { ...h('div') })                       → 跳过
// h(For, { render: (i) => h('div', ...) })    → 转换 ✅
// h(C, { render: (x) => h('b', {}, x) })      → 转换 ✅
```

**为什么值位置必须跳过（真实机制，已实测）**：父级 `rewriteAttrs` / `rewriteCompAttrs`
用 `s.overwrite(attrsArg.start, attrsArg.end, newStr)` 覆盖**整个 attrs 区间**，
且新串由 `s.original.slice(...)` 生成。MagicString 允许「父区间包含子区间」的覆盖，
但覆盖会**静默丢弃子级已写入的编辑**：子级的 `_createEl` 转换、提升声明与 `_cloneHoisted`
引用全部消失，只留下永不引用的 `const _hoisted_N = ...` 与多余 import（死代码 + 体积膨胀）。
（另：真正**部分重叠**的两次编辑会直接抛 `Cannot split a chunk that has already been edited`。）

**连带修复**：新增 `hasAttrsAncestor`（不区分值位置/函数体，只要整段位于某个祖先 h() 的
attrs 实参内即为真），用于静态提升的两趟预扫描准入 —— 否则 attrs 内的静态子树仍会被
标记为提升目标，产生上面那种「声明被覆盖丢弃」的死代码。

**实测效果**（对全仓 213 个源文件 × `tmplStatic` 双路径编译）：

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 残留的框架 `h()` 调用 | 136 | 10（全部位于注释中） |
| `_createEl` 调用 | 1584 | 1708 |
| 受影响文件（去重） | — | 59 |

### 10.2 L12：静态 attrs 单独提升（`_hoisted_attrs_N`）

「attrs 全静态 + children 动态」时把 attrs 对象提升为模块级常量，省掉每次渲染的对象分配。

准入条件：`hoistStatic` 开启（与整棵子树提升同一开关，dev 不提升）；tag 为字符串字面量且
非 fragment；**不是**整棵静态提升目标；至少一个动态子节点；attrs 为非空对象字面量且每个属性
都是「非 computed + 值静态 + 不含任何标识符引用」；不含 `onXxx` 事件；不含
`__reactiveAttrs`/`__events`/`__ref`/`__providers`；`ref` 与 `rewriteAttrs` 一致地重命名为 `__ref`。

> `containsIdentifier` 检查的原因：静态 attrs 在模块初始化时求值一次，
> 若值引用导入绑定而该绑定后续被改写，提升会把值冻结成早期快照，与「每次渲染重新求值」不一致。

**共享对象安全性（已核对运行时，未发现 mutate）**：

- `core/mount.ts` 的 `applyAttrs` / `applyReactiveAttrs` / `bindRef` / `clearRef` 只**读取** `attrs`
  （`for...in` + 读值 + `hasOwnProperty`），全部分支无写入、无删除。
- `core/internal.ts` 的 `extractProviders` 在含 `__providers` 时返回 `{ ...attrs }` **浅拷贝**并
  `delete rest.__providers`，**不修改入参**；不含 `__providers` 时原样返回。
- 准入条件显式拒绝事件 / 动态值 / SpreadElement，因此产物中不存在需要逐次生成的
  `__events` / `__reactiveAttrs`，共享容器恒为只读访问。
- 反过来，编译路径**不使用** `core/h.ts` 中那处 `delete vnode.attrs["__providers"]`
  （那是未编译 h() 路径），因此共享 attrs 不会被该分支删除。

**实测效果**：产物新增 `_hoisted_attrs_N` 声明 1084 处（双路径合计），涉及 59 个文件。

### 10.3 L15：`_createCompPure`（先实测，后实施）

**微基准（实施前，同形状 A/B，只差 ref/__providers 提取）**：

| 组 | 基准 | Pure | 提升 |
|----|------|------|------|
| round0 | 45.69ms | 40.47ms | 11.42% |
| round1 | 45.91ms | 40.51ms | 11.77% |
| round2 | 47.98ms | 44.38ms | 7.51% |
| 3 轮均值 | 46.53ms | 41.79ms | **10.19%** |

独立重复 3 次得 15.79% / 12.33% / 7.51%，**稳定高于 5% 阈值**，故予实施。
实施后 `tests/plugin/lumina-compile-l15-bench.test.ts` 直接对比生产函数，多次运行落在
**6.3%～22.8%** 区间（受机器负载影响），并带「Pure 不慢于基准」的护栏断言。

**编译期准入** `canUseCompPure`：attrs 省略 / `null` / `undefined` 字面量 / 对象字面量且
每个属性为非 computed 的 ObjectProperty 且键名不是 `ref`/`__providers`。
SpreadElement、computed key、动态 attrs 表达式一律回退 `_createComp`。

**运行时实现**（`core/internal.ts`，`core/index.ts` 导出）跳过：`'ref' in attrs` + 三形态提取、
`'__providers' in attrs` + `Array.isArray`、以及两个内部键的 props 过滤分支。
**完整保留**：children 扁平化 → `props.children`、`maybeReactiveProps` 响应式 props
（控制流组件豁免）、函数/类组件渲染 + `reportError` 上报后 rethrow、`vnode.__parent`、
未标记组件类型的 `h()` fallback。**不设置** `vnode.__providers` —— 这正是准入条件必须严格的原因。

**实测效果**：`_createCompPure` 调用 276 处，`_createComp` 由 294 降至 20。

### 10.4 L13：评估后**不实施**（产物已按已发布设计验证）

原测试期望静态子树产出裸 VNode 字面量 `{ tag, attrs, children }` 并跳过
`_createStaticEl/_createSvgEl/_createFragment`。经评估**不采用**：

1. 三个 helper 承担运行时必需语义：`__providers` 提取（§8 Bug 3）、`flattenChildren`、
   SVG 的 `__ns`（`materialize` 依赖它调用 `createElementNS`）；改字面量等于把这些逻辑
   在编译期内联复制。
2. 提升节点**只在模块初始化时创建一次**，改字面量省掉的是一次性构造，收益≈0。
3. 生产默认 `tmplStatic: true`，真实构建走 HTML 字符串 + `_tmpl`（cloneNode 直达 DOM），
   VNode 构造路径仅作裸 SVG 子标签等场景兜底。

因此 `tests/plugin/lumina-compile-l12-l13.test.ts` 的 L13 用例改写为验证**已发布设计**
（`_createStaticEl`/`_createSvgEl`/`_createFragment`/`_tmpl` + `_cloneHoisted`，且不残留 `h()`），
并在文件内注明上述理由。这是本轮**唯一**的测试语义变更。

### 10.5 本轮验证结果

| 验证项 | 结果 |
|--------|------|
| 全仓产物基线 diff（213 文件 × 双路径） | 59 个文件 / 118 个 (文件,模式) 对发生变化，**0 个未归类**，`_failed=0` |
| 死代码检查 | 未引用的 `_hoisted_*` 声明 **0**；未使用的 internal import **0**（改造前后均为 0） |
| AST 级语义核对 | 源级 attrs 规范形（还原 `__events`/`__reactiveAttrs`/`__ref`/`_hoisted_*` 后）**遗失 0 处** |
| 全量 vitest | **330 通过 / 0 失败**（11 个测试文件） |
| tsc | 根 + `packages/player` + `packages/live-player`：我的改动范围**零错误**；根检查仅剩 2 条既有错误（`packages/plugins/src/utils/danmakuMask/segmentationWorker.ts` 缺 `@mediapipe/tasks-vision` 类型，与本轮无关） |
| 生产构建 | `packages/player`、`packages/live-player` 均 `✓ built`；`tsconfig` 类型检查 exit 0 |
| 产物体积（同一机器 A/B 对照，改造前 vs 改造后） | player `index.js` 1,577,103 → 1,593,414（+1.03%）、`lumina.js` 95,565 → 96,925（+1.42%）、live-player `index.js` 229,448 → 231,412（+0.86%）、live-player `lumina.js` 100,720 → 99,779（**−0.93%**）；8 个产物合计 3,429,711 → 3,448,405（**+0.55%**） |

体积增量主要来自 1084 处 `_hoisted_attrs_N` 常量声明与 `_createCompPure` 函数体；
对应收益是每次渲染不再重新分配 attrs 对象、组件创建少两次内部键判定。
两次「我的实现」构建产物字节完全一致（可复现）。

> 遗留未处理项（需负责人决策，不在本轮写入范围）：
> `packages/live-player/src/business/views/GiftPanel.ts` 头部注释仍写着
> 「`For.render` 内返回的 VNode 不会参与属性响应式提取（编译期跳过 attrs 内的 h()），
> 因此条目上的 class 依赖的状态统一并入 key」——本轮 10.1 之后该前提已不再成立
> （`For.render` 回调体现在会正常编译并生成 `__reactiveAttrs`），该注释与随之而来的
> 「class 并入 key」规避手法可以重新评估。该文件属于 `packages/**`，不在本轮写入范围。
