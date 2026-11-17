# `@lumina/ui`

Lumina 响应式组件库：从 B 站 nano 播放器产物中的 **nano-ui**（原类前缀 `bui-`）移植而来，
全部组件基于 `@lumina/framework`（`defineComponent` / `h` / `signal`）实现，SSR 安全。

- 类名前缀统一为 **`lui-`**（`bui-` → `lui-`）。
- 样式由原 LESS 转为 **嵌套 SCSS**，位于 `src/styles/`，入口 `src/styles/index.scss`。
- 21 个组件与 nano-ui 的 21 个组件一一对应。

## 安装 / 使用

```ts
import { Button, Checkbox, Slider, Select } from "@lumina/ui";
import "@lumina/ui/style.css"; // 或按需引入 src/styles/index.scss
```

组件都是 `defineComponent` 结果，可直接用 `h()` 组合，也可交给 `mount` / SSR 渲染：

```ts
import { h, mount } from "@lumina/framework/core";
import { Checkbox } from "@lumina/ui";

mount(h(Checkbox, { name: "接收推送", value: true, onChange: (v) => console.log(v) }), document.body);
```

### 响应式与编译器（重要）

`dist/` 产物已由 `vite-plugin-lumina-compile-v2` 编译，`signal` 驱动的 class / style / 文本会正确更新。
**如果直接 `import "../src"` 源码**（例如本包 `demo/`），必须在构建工具里启用同一个编译器：

```ts
import luminaCompileV2 from "../../plugins/vite-plugin-lumina-compile-v2";
export default { plugins: [luminaCompileV2()] };
```

没有编译器时事件能触发但 DOM 不会随 `signal` 更新，表现就是“点了没反应”。

### 主题（CSS 变量）

主题只由 **全局 CSS 变量** 驱动，不使用 context，也不靠组件 `dark` prop：

- 默认亮色 token 定义在 `src/styles/_variables.scss` 的 `:root`；
- 深色覆盖定义在同一文件的 `.lui-theme-dark` 下，只覆盖 `--nova-*` 变量；
- 切换深色：给 `html`（或任意容器）加 `lui-theme-dark` class 即可，组件不重挂；
- 自定义主题：在任意作用域覆盖 `--nova-*` 变量（支持局部覆盖）。

```css
/* 全局换品牌色 */
:root { --nova-primary-color: #ff6699; --nova-fn-color: #ff6699; }

/* 局部深色 */
.my-player { --nova-bg-color: #101010; --nova-text-color: #eee; }
```

```ts
document.documentElement.classList.toggle("lui-theme-dark");
```

可用 token 见 `src/styles/_variables.scss`（品牌色、功能色、文本/背景/边框、辅助浮层色、字号等）。


## 组件清单（21）

| 组件 | 类名 | 说明 |
|------|------|------|
| Button | `lui-button` | 按钮，`type` 对应 white/blue/blue2/gray/gray2/gray3/yellow/transparent/border/text/large/small |
| Checkbox | `lui-checkbox` | 复选（双图标 + 红点） |
| Radio | `lui-radio` | 单选组，`style: normal / button` |
| Switch | `lui-switch` | 开关（文字 + 圆点内容 + 红点） |
| DanmakuSwitch | `lui-danmaku-switch` | 弹幕开关，支持三态 |
| Input | `lui-input` | 输入框，`type: text / number / textarea`（number 带步进器） |
| Select | `lui-select` | 下拉选择（列表 + 结果态 + qualityMenu 皮肤） |
| ColorPicker | `lui-color-picker` | 颜色选择 |
| Collapse | `lui-collapse` | 折叠面板 |
| Dialog | `lui-dialog` | 对话框 |
| Menu | `lui-menu` | 菜单列表 |
| Dropdown | `lui-dropdown` | 下拉菜单 |
| Tabs | `lui-tabs` | 标签页（normal / dropdown） |
| Panel | `lui-panel` | 横向分页面板 |
| DynamicPanel | `lui-dynamic-panel` | 动态面板 |
| LongList | `lui-long-list` | 长列表 |
| Swiper | `lui-swiper` | 横向卡片轮播 |
| Slider | `lui-slider` | 滑块 / 进度轨道（竖直、分段、档位、tooltip） |
| Progress | `lui-progress` | 进度条（可带档位与数值） |
| CircleProgress | `lui-circle-progress` | 圆环进度 |
| CloseButton | `lui-circle` | 圆环关闭按钮（带进度环） |

## 目录

```
src/
  index.ts                # 统一导出
  icons.ts                # 内联 SVG 图标
  shared.ts               # 根类名 / 通用类型
  components/*.ts         # 21 个组件
  styles/
    index.scss            # 样式入口（@use 全部组件）
    _variables.scss       # nano-ui global.less 变量 → SCSS 变量
    _mixins.scss          # dotdotdot / transition
    _base.scss            # .lui / .lui-area 基础样式
    components/_*.scss    # 每个组件一个嵌套 SCSS
demo/                     # 组件测试页（模拟数据）
scripts/smoke*.mjs        # SSR / happy-dom 挂载冒烟
```

## 开发

```bash
# 组件测试页（Vite dev server，默认 8687）
pnpm --filter @lumina/ui run dev

# 构建（tsc + vite lib + sass 产物）
pnpm --filter @lumina/ui run build

# 冒烟
pnpm --filter @lumina/ui run smoke
```

## 与 nano-ui 的差异

- 全部改为 `defineComponent` 响应式组件：状态用 `signal`，卸载时清理事件监听。
- 类名 `bui-*` → `lui-*`，根节点固定为 `div.lui.lui-<name>` + `div.lui-area`（CloseButton 直接是 `div.lui-circle`）。
- 交互按 nano-ui 的 DOM/行为移植；未引入 BetterScroll：`Select.maxHeight` 用原生滚动区域近似。
- 图标使用库内最小 SVG（`icons.ts`），可替换为业务图标。
- 组件 API 为受控初始值 + `onChange` 回调；需要命令式操作时通过 `lifecycle.emit('<name>Mounted', api)` 暴露的 API（如 `setValue`）。
