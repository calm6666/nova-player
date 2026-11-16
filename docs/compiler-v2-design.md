# Lumina 编译插件 v2 设计：静态骨架与动态洞

> 状态：设计稿（未实现）
> 范围：`vite-plugin-lumina-compile` 的 v2 版本，与 v1 共存
> 结论：保留 `<template>.innerHTML` + `cloneNode` 主流模式；模板中禁止出现注释节点；客户端静态提升从「纯静态子树」扩展到「静态骨架 + 动态洞」；v2 支持按文件指定编译范围。

---

## 1. 背景

当前编译插件位于 `plugins/vite-plugin-lumina-compile/`：

- `index.ts`：Vite 插件外壳，负责环境识别、文件过滤、选项合并。
- `transform.ts`：基于 Babel AST + MagicString 的转换核心。
- `packages/framework/src/core/internal.ts`：编译产物运行时，包含 `_createEl` / `_createStaticEl` / `_createSvgEl` / `_createFragment` / `_createComp` / `_reactiveText` / `_tmpl` / `_cloneHoisted` 等。
- `packages/framework/src/core/mount.ts`：`materialize`、`hydrateNode` 与 SSR 模拟节点路径。

v1 已具备的能力：

1. `h()` → 专用创建函数，消除运行时类型判断。
2. attrs 预分类：事件 → `__events`、ref → `__ref`、动态组件 props → `_rp`。
3. 纯静态子树提升：
   - `hoistStatic` + `tmplStatic`：HTML 字符串 + `_tmpl()` 惰性 `<template>` 解析，使用点 `cloneNode(true)`；
   - 回退路径：VNode 常量 + `_cloneHoisted()`。
4. SSR 直接输出模板 HTML；水合时按 `roots` 游标采用 SSR DOM，不克隆。

v1 的客户端瓶颈：

| 问题 | 影响 |
| --- | --- |
| 只有整棵纯静态子树才提升 | 一个动态文本就会让整棵结构退回 `_createEl` + `materialize` |
| 静态判定只认字面量 | `'a' + 'b'`、无插值模板字符串之外的常量写法无法提升 |
| attrs 区间内的静态子树被跳过 | `h(For, { render: () => h('div', ...) })` 等回调内结构失去提升 |
| 动态叶子仍有 VNode 开销 | `_reactiveText` 需要 VNode、flatten、materialize 分支 |
| 模板根限制 | fragment 顶层只允许元素根；表格/SVG 子标签需要回退 |

## 2. 设计约束

1. **允许 `<template>.innerHTML`**。模板字符串只由编译期字面量构成，动态值永远不进入模板；文本和属性沿用与 SSR 一致的转义，因此不构成 XSS 面。
2. **模板与 DOM 中禁止出现注释节点**（播放器硬规定）。不使用 `<!--anchor-->` 之类的标记。
3. **不改变运行时语义**：组件、context、生命周期、SSR、水合行为与 v1 保持一致；v2 只改变 DOM 结构的生成方式。
4. **v1 与 v2 共存**：v1 行为与产物保持不变，v2 灰度启用、按文件白名单编译。
5. **v2 失败必须回退 v1 转换**，不能产生语义差异。

## 3. 总体架构

```
plugins/
  compiler-core/                   共享编译内核（从 transform.ts 抽出）
    transform.ts                   skeletonMode: 'static-only' | 'holes'
    static.ts                      静态判定、常量折叠、模板序列化
    skeleton.ts                    骨架 + 洞生成
  vite-plugin-lumina-compile/      v1 薄封装（static-only，产物不变）
  vite-plugin-lumina-compile-v2/   v2 薄封装（holes，默认关闭）
```

框架侧新增独立运行时入口，避免 v1 应用引入 v2 代码：

```
packages/framework/src/core/internal-dom.ts
  _tmpl(html, roots, holes?)
  _bindText / _bindAttr / _mountChild
```

通过 `package.json` 的 `./core/*` 子路径导出为 `@lumina/framework/core/internal-dom`。v2 插件默认使用该 import source，可通过选项覆盖。

## 4. 静态骨架 + 动态洞

### 4.1 编译单元

v2 以单个框架 `h()` 调用为编译单元：

1. 把调用子树切分为「静态结构」与「动态洞」；
2. 静态结构序列化为 HTML 模板；
3. 动态洞生成运行时描述（path / anchor / getter / render）；
4. 使用点返回带 `holes` 的 `__tmpl` VNode。

示例输入：

```ts
h(
  'div',
  { class: 'panel' },
  h('h3', {}, 'Title'),
  h('span', {}, () => `${count.value} 条`),
  h(Icon, { name: 'close' }),
);
```

编译产物（结构示意）：

```ts
const _tpl_1 = _tmpl(
  '<div class="panel"><h3>Title</h3><span></span></div>',
  1,
  [
    { kind: 'elementText', path: [1], get: () => `${count.value} 条` },
    { kind: 'child', parent: [], anchor: null, render: () => h(Icon, { name: 'close' }) },
  ],
);

// 使用点
_tpl_1();
```

模板只包含静态元素与静态文本，没有任何注释节点；动态内容全部由 hole 在克隆后绑定。

### 4.2 静态判定扩展

v2 的静态判定覆盖：

- 字符串、数字、布尔、null、负数字面量；
- 无插值模板字符串；
- 字面量之间的二元运算与一元运算（编译期折叠）；
- 完全由静态值构成的对象与数组；
- 同文件 `const` 常量内联：`const CLS = 'panel'`，要求 `binding.constant === true` 且初始化为静态值；跨模块 import 不折叠；
- 嵌套的框架 `h()` 调用，且自身全部为静态。

不为静态的情况：

- 任意标识符引用（常量折叠白名单除外）；
- 函数、箭头函数、调用表达式；
- 计算属性、展开元素；
- `ref`、`__providers`、`v-*` 指令、`innerHTML`、`textContent`、`svgContent` 等运行时属性。

### 4.3 child 洞：静态兄弟锚点

child 洞不使用任何占位节点，编译期记录插入位置：

- `parent`：洞所在父元素的 path；
- `anchor`：洞之后第一个静态兄弟的 path；没有静态兄弟时为 `null`；
- `render`：返回动态 VNode 的函数。

运行时：

- `anchor !== null`：`parentNode.insertBefore(dynamicNode, anchorNode)`；
- `anchor === null`：`parentNode.appendChild(dynamicNode)`。

连续多个 child 洞按声明顺序插入同一个 anchor 之前，顺序天然正确。anchor 在克隆后的固定 path 上解析，无需运行时查找兄弟节点，也不会引入注释节点。

### 4.4 text 洞

优先使用 **elementText** 形态：

- 条件：元素只有动态文本子节点，且没有其他子节点；
- 模板写成 `<span></span>`；
- 运行时对元素注册 effect，写 `textContent`；
- 没有占位节点、没有相邻合并问题，SSR 直接输出文本，水合时采用已有元素。

混合文本场景使用 **text 节点占位**：

- 模板在对应位置放一个空格文本节点，克隆后绑定该 Text 节点；
- effect 在节点插入文档之前同步执行，不会出现可见的空格闪烁；
- HTML 解析器会合并相邻字符数据，因此**相邻的纯动态文本洞必须合并为一个 getter**：`{a}{b}` → `() => String(a()) + String(b())`；
- 合并失败（被表达式或元素阻断）时，该位置回退 v1 路径；
- `textarea` / `title` / `pre` 等特殊文本上下文只允许 elementText 形态。

### 4.5 attr 洞

- 静态属性写入模板；
- 动态属性不写入模板，编译期记录 `path + name + getter`；
- 克隆后注册 effect，按既有属性语义设置（`setAttribute` 或 DOM property）；
- 属性的分类规则复用 v1 的 `DOM_PROP_TO_HTML_ATTR` / `BOOLEAN_HTML_ATTRS`，保证与 SSR 一致。

### 4.6 SSR 产物

编译期同时生成「有序片段」，静态片段与动态洞来自同一份分析结果：

```ts
type SkeletonPart = string | { hole: number };
```

- 客户端：把所有静态片段拼接为模板 HTML（text 洞写入占位文本，child 洞不产生 HTML）；
- SSR：按片段顺序输出，静态片段原样输出，洞位置求值后按 SSR 规则转义；
- 两条路径共享静态片段，保证 DOM 同构。

### 4.7 水合

不使用注释标记，依靠静态结构 + 游标：

1. 静态元素/文本：采用当前 DOM 节点，游标前进；
2. elementText 洞：采用对应元素，注册 effect；
3. text 洞：采用对应 Text 节点，注册 effect；
4. attr 洞：采用对应元素，注册 effect；
5. child 洞：调用 `hydrateNode(dynamicVNode, 当前游标, parent)`，它消费自己的节点并返回新游标，继续后续静态对齐。

多根 fragment 的 `roots` 改为按 `childNodes` 计数，文本根同样计入。

### 4.8 回退矩阵

以下情况整棵或局部回退 v1 转换：

- child 洞可能输出 0 个节点（`show(false)`、空列表、`when` 为空）：无标记时游标无法判断是否占用节点，存在误对齐风险；
- 相邻 text 洞无法合并；
- 模板根为受限标签（表格上下文标签、裸 SVG 子标签等，`<template>` 解析会丢失或无法建立命名空间）；
- 子树包含 `ref` / `__providers` / `v-*` / `innerHTML` / `textContent` / `svgContent`；
- attrs 不是对象字面量，或包含计算属性/展开/函数调用；
- 骨架标签属于安全拒绝列表（见 §6）。

## 5. 运行时改动

### 5.1 TmplData 扩展

```ts
interface SkeletonHoleBase {
  path: number[];
}

interface SkeletonTextHole extends SkeletonHoleBase {
  kind: 'text' | 'elementText';
  get: () => string;
}

interface SkeletonAttrHole extends SkeletonHoleBase {
  kind: 'attr';
  name: string;
  get: () => unknown;
}

interface SkeletonChildHole {
  kind: 'child';
  parent: number[];
  anchor: number[] | null;
  render: () => VNode;
}

type SkeletonHole = SkeletonTextHole | SkeletonAttrHole | SkeletonChildHole;

interface TmplData {
  html: string;
  roots: number;
  clone: () => Node;
  holes?: SkeletonHole[];
}
```

`_tmpl(html, roots, holes?)`：

- 纯静态调用不传 `holes`，行为与 v1 完全一致；
- 有 `holes` 时，`clone()` 之后由 `materialize` 统一绑定。

### 5.2 materialize

- 克隆模板；
- 解析静态 path；
- text / elementText / attr：注册 effect，dispose 推入 `vnode._cleanups`；
- child：解析 parent 与 anchor，`mount` 动态 VNode，destroy 时销毁并移除；
- 单根与多根保持现有 `vnode.el` / `vnode.__tmplRoots` 语义。

### 5.3 hydrateNode

- 采用静态段；
- 按洞顺序处理动态节点；
- child 洞直接复用现有动态 VNode 水合逻辑；
- 水合不匹配计数沿用现有机制。

## 6. 安全不变量

允许 `innerHTML` 的前提是以下不变量必须由编译器保证，并有测试兜底：

1. 模板字符串的每个片段必须来自字面量或常量折叠结果；标识符、调用、成员表达式不得进入模板。
2. 文本使用与 SSR 相同的 `escapeHtmlText`，属性使用 `serializeStaticAttrs`。
3. 动态值只通过 `textContent`、`setAttribute`、property 赋值、子节点插入写入，禁止拼接进模板字符串。
4. 静态骨架拒绝以下标签：`script`、`iframe`、`object`、`embed`、`base`、`meta`；命中则回退 v1。
5. 静态 URL 属性（`href` / `src` / `xlink:href` / `formaction`）以 `javascript:` 或 `data:text/html` 开头时回退并告警。
6. 静态 `on*="..."` 字符串属性一律回退。
7. 产物校验测试：`_tmpl(` 的第一个参数必须是纯字符串字面量，且不包含 `${`。
8. 生成代码中不得出现 DOM 注释节点，包括水合锚点。

## 7. 指定编译文件

### 7.1 需求

插槽模块（例如 `apps/web/src/components/home/watchlater-pip/nova-cross-slots.ts`）中的 `content: () => h(...)` 是静态结构密集区，必须能单独指定编译，才能把优化作用到插槽内容上，而不是只优化应用页面文件。

### 7.2 配置

```ts
luminaCompileV2({
  // 白名单：绝对路径、项目相对路径、glob、RegExp 混合
  compileFiles: [
    'apps/web/src/components/home/watchlater-pip/nova-cross-slots.ts',
    'packages/nova-player/packages/player/src/components/**/*.ts',
    /src\/slots\/.*\.ts$/,
  ],
  // 黑名单优先
  exclude: [/node_modules/, /\.test\./, /\.spec\./],
  // 文件内声明式开关
  pragma: '@lumina:compile',
});
```

### 7.3 匹配流程

1. `configResolved` 获取 `root`，将字符串路径解析为绝对路径或 glob；
2. `transform(code, id)` 中统一路径分隔符（Windows 反斜杠）；
3. `exclude` 命中则跳过；
4. `compileFiles` 命中则编译；
5. 未命中时检测文件首行 pragma；
6. 保留 v1 的内容过滤：文件必须真实 import 了框架的 `h` / `defineComponent` / `Fragment` 等，避免误转普通文件。

### 7.4 插槽文件用法

推荐在插槽文件首行声明，避免集中配置遗漏：

```ts
// @lumina:compile
import { h, type SlotEntry } from '@lumina/nova';
```

v2 编译后，`content` 内的静态结构只需一次模板解析与克隆，动态状态通过洞更新，PiP 反复打开时不再重建整棵 VNode。

## 8. 与 v1 共存

| 项目 | v1 | v2 |
| --- | --- | --- |
| 插件顺序 | `enforce: 'post'` | `enforce: 'pre'` |
| 文件标记 | 检测到 v2 标记后跳过 | 转换后注入 `/* @lumina-compiled:v2 */` |
| 文件范围 | `include` / `exclude` | `compileFiles` / `exclude` / pragma |
| 模板模式 | 纯静态 | 纯静态 + 动态洞 |
| 运行时入口 | `@lumina/framework/core/internal` | `@lumina/framework/core/internal-dom` |

推荐主要通过 `compileFiles` 做互斥灰度；文件标记作为兜底，防止两个插件同时转换同一文件。

v2 在调试日志中输出「已编译文件 / 跳过原因」，便于确认插槽文件是否真正命中。

## 9. 性能预期与验证

### 9.1 预期收益

- 混合结构不再整棵退回 VNode 解释；
- 动态文本与属性只保留 effect 成本，省掉 `_reactiveText` VNode 与 attrs 对象的重复分配；
- 静态提升命中率提升（常量折叠、const 内联、回调体内结构）；
- 插槽模块的按钮结构一次解析、多次克隆。

需要如实说明：纯静态树的 v1 路径已经接近最优（解析一次 + clone），v2 的增量收益主要来自混合树与覆盖率，不是替换 `_tmpl`。

### 9.2 指标

- `mount` 耗时与首帧时间；
- 每次渲染的 VNode 分配数量；
- 模板 clone 次数与模板解析次数；
- 内存占用与节点数量（确认无注释节点、无多余占位）；
- 构建产物体积；
- Playwright/真实页面的 LCP 与交互延迟（由使用者自行执行，不在自动化流程中自动打开浏览器）。

### 9.3 回归用例

- 纯静态子树：v1 与 v2 的 `outerHTML`（属性顺序无关）一致；
- 混合子树：文本洞、attr 洞、child 洞、多个连续 child 洞、末尾 child 洞；
- fragment 多根（含文本根）；
- SVG 命名空间；
- SSR 输出与客户端骨架同构；
- SSR → hydrate：mismatch 计数为 0，洞绑定正确；
- 安全不变量与产物扫描；
- 插槽文件 fixture：PiP 打开/关闭多次，DOM 与事件回调正确。

## 10. 分期实施

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0 | 抽出 `compiler-core`，新增 `skeletonMode`，v1 薄封装 | v1 产物不变，现有测试与构建通过 |
| P1 | 静态判定扩展（常量折叠、const 内联、fragment 文本根） | 纯静态 fixture 的产出与 DOM 对比通过 |
| P2 | elementText / attr 洞 | 无结构插入，DOM/水合对比通过 |
| P3 | child 洞 + 静态兄弟锚点 + 水合交错采用 | 多洞 fixture、SSR→hydrate 通过 |
| P4 | `compileFiles` / pragma 灰度 + 插槽 fixture 实测 | 插槽文件命中日志、性能对比报告 |

## 11. 风险

| 风险 | 处理 |
| --- | --- |
| 相邻文本洞被解析器合并 | 编译期强制合并 getter，失败回退 |
| 0 输出 child 洞导致水合游标错位 | 该洞不进入骨架，整棵回退 v1 |
| `insertBefore` anchor 在嵌套 fragment 下失效 | 编译期校验 anchor 属于同一 parent，否则回退 |
| 属性 property / attribute 语义差异 | 复用 v1 属性映射并做 DOM 对比 |
| SVG / 表格上下文限制 | 保留 v1 的模板根回退 |
| 插槽文件未命中白名单 | debug 日志 + pragma 双保险 |
| 产物体积增长 | 大子树使用片段描述，必要时压缩洞描述 |

---

## 附：术语

- **静态骨架**：编译期确定的元素、静态属性、静态文本组成的 DOM 结构。
- **洞（hole）**：骨架中需要在运行时绑定的动态位置，分为 text、elementText、attr、child。
- **anchor**：child 洞插入位置之后的第一个静态兄弟节点，或 `null`（追加到父元素末尾）。
- **回归回退**：v2 无法安全处理时，交由 v1 转换路径生成代码。

---

## 实施更新（2026-11-15，已落地）

1. **彻底移除注释锚点**：早期实现用 `<!--lum:child:...-->` / `<!--lum:frag:...-->` 注释节点包裹动态区域，违反「禁止注释节点」硬约束。现改为「父级静态子节点下标 + 文本内字符偏移」编码（`anchorChild` / `anchorOffset`）：锚点就是模板自带的静态节点，文本内部插入前用 `splitText` 拆分，模板 / SSR / DOM 全程零注释、零占位。
2. **SSR / 水合协议**：SSR 直出 child 洞的元素根（首屏完整）；text 洞不直出（避免与静态文本合并后无法拆回）。水合时按模板静态结构对齐，移除 SSR 直出的动态节点（保留静态节点身份），再由洞重新挂载；多根 / 根标签不一致时整段替换骨架。以上均不依赖任何注释标记。
3. **完整静态编译**：v2 插件改为两阶段——先做骨架化，再把剩余未骨架化的 `h()` 交给 v1 编译器收尾（组件调用 `_createComp` + `_rp` 响应式 props、属性 / 事件预分类、静态提升）。静态结构不再回退解释执行。
4. **响应式语义**：child 洞在渲染期求值（而非挂载期），保证 `provide/useContext`、`_rp` 依赖追踪与 Lottie `ref` / 事件时序与 v1 一致；控制流组件（For / Show / Switch / Match / Dynamic）跳过 `_rp` 包装以保留 toGetter 协议。
5. **不变量测试**：`tests/compiler-v2.test.ts` 断言产物不含 `<!--` / `lum:`，并覆盖 child / text / fragment / 水合 / 事件 / ref 行为。
6. 非字面量 attrs 或含内部协议键（`__reactiveAttrs` 等）的调用不骨架化，交给 v1 编译，避免丢失 SSR 序列化语义。
