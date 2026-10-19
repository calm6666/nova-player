# EndPanel / Top 插件化抽离方案

> 目标：把片尾（EndPanel）与顶栏（Top）从 `PlayerDocker` 核心渲染中抽离为可替换的插件；互动视频插件、普通视频、外链播放器、电视剧 OGV 共用同一套宿主协议；同时保留核心的播放时序与右键菜单能力。

## 1. 现状与耦合点

当前：

- `PlayerDocker` 直接 `h(Ending)` 与 `h(Top)`，并负责：
  - `state-ended`、控制栏隐藏；
  - 自动连播 / 倒计时 / 跳过片头片尾；
  - 分享面板、互动片尾、OGV/外链变体；
  - 播放列表、`pauseAfterEnd`、全屏/宽屏/PiP。
- `Ending` 的变体已经按 `variant` 分支：`station / ogv / embedded / interactive`。
- `Top` 目前只有普通/外链形态，音乐模式还没有独立形态。
- 音频面板已经按插件门控（`hasPlugin("audioEffect")`）懒挂载，右键菜单项同样按插件出现。

直接抽离成“像弹幕一样”的插件会遇到问题：EndPanel/Top 依赖播放器行为，而不仅仅是叠加层渲染。因此建议 **核心保留编排，插件提供视图与数据适配**。

## 2. 插件协议

### 2.1 通用 Surface 插件

```ts
interface SurfacePlugin {
  name: "ending" | "top" | string;
  version: string;
  /** 核心在挂载 / 状态变化时调用，返回 VNode 或 null（不渲染） */
  render(ctx: SurfaceContext): VNode | null;
  /** 可选：命令式 API（show/hide/update） */
  createApi?(): unknown;
  /** 卸载 */
  destroy?(): void;
}
```

### 2.2 EndPanel 契约

```ts
interface EndingContext {
  scene: "station" | "embedded";
  style: "standard" | "ogv" | "interactive" | string;
  title?: string;
  up?: EndingUpInfo;
  related?: EndingRelatedItem[];
  ogv?: OgvEndingConfig;
  interactive?: InteractiveEndingConfig;
  share?: ShareInfo;
  autoNext: boolean;
  countdownSeconds: number;
  /** 核心动作，插件只调用，不自己实现切集时序 */
  next(): void;
  restart(): void;
  seek(time: number): void;
  openUrl(url?: string): void;
  /** 插件上报交互 */
  emit(event: "like" | "coin" | "favorite" | "follow" | "share" | "grade" | "backtrack", payload?: unknown): void;
}
```

核心负责：

- `ended` 判定、自动连播定时器、`next()`；
- 控制栏隐藏/恢复；
- `state-ended`、`data-select` 根节点；
- 分享面板的根层级；
- 跳过片头片尾。

插件负责：

- 视图 DOM / CSS；
- 推荐卡点击、评分、进度回溯渲染；
- 各形态的数据适配。

### 2.3 Top 契约

```ts
interface TopContext {
  scene: "station" | "embedded";
  mode: "normal" | "music";          // 音乐模式独立 Top
  title?: string;
  up?: EndingUpInfo;
  stats?: { like?: number; comment?: number };
  followed?: boolean;
  audioEffectAvailable: boolean;     // 决定是否显示音效入口
  openAudioPanel(): void;
  onFollow(): void;
  onLike(): void;
  onComment(): void;
  onShare(): void;
  onMore(): void;
}
```

Top 插件按 `mode` 返回不同 VNode；`music` 模式可以渲染歌曲信息、音质/音效入口，而不影响普通视频。

## 3. 变体矩阵

| 场景 | EndPanel 变体 | Top 变体 |
|---|---|---|
| 普通站内视频 | standard | normal |
| 电视剧 / 番剧 | ogv | normal |
| 外链 iframe | embedded | embedded |
| 互动视频 | interactive（或互动视频插件注册 renderer） | normal |
| 音乐模式 | standard / 自定义 | music |
| 无插件 | 核心内置 fallback | 核心内置 fallback |

## 4. 互动视频插件与 EndPanel 共存

关键：**EndPanel 只能有一个根渲染器**，互动视频插件不能同时再挂一个 ending 根。

约定：

1. 互动视频插件注册 `ending` 子渲染器：
   ```ts
   interactivePlugin.registerEndingVariant("interactive", (ctx) => ...);
   ```
2. `EndingHost` 按 `style` 查表：
   - 先查插件注册表；
   - 再查内置 `standard/ogv/embedded/interactive`；
   - 都没有 → fallback。
3. 插件通过 `EndingContext.emit("backtrack", payload)` 上报回溯节点，核心负责实际 seek / 回溯；插件不直接操作 video。
4. 插件卸载时只注销自己的 variant，不影响其他视频进度和核心倒计时。

这样互动视频插件与 OGV/普通视频可以同时安装，按 `endingStyle` 选择一个 renderer。

## 5. Top 与音效面板

- Top 插件可选择 `music` 模式；普通/外链仍走 `normal/embedded`。
- 音效调节面板是 **audioEffect 插件的附属面板**：
  - `hasPlugin("audioEffect") === false` → 右键菜单没有「音效调节」，面板不创建；
  - 为 true → 首次打开才懒挂载，关闭只隐藏；
  - 面板与色彩调整/统计信息/快捷键同级，属于 `ensurePanel("audio")`；
  - 面板 API 由 `getAudioEffect()` 注入，Top 插件可以在 `music` 模式增加入口按钮调用 `openAudioPanel()`。

## 6. 实施步骤

1. 新增 `SurfaceHost` 与类型（本设计中的 Context/API）。
2. 先迁 Top：把当前 `Top` 包成内置 `top` 插件，`PlayerDocker` 只保留 `h(TopHost)`。
3. 再迁 Ending：`Ending` 变成内置 `ending` 插件；核心保留 `ended/autoNext/state-ended`。
4. 抽出 interactive 为独立插件并注册 variant；增加插件卸载回退。
5. 样式迁移：插件 CSS 使用 `nova-surface-*` 前缀 + CSS 变量；禁止全局标签选择器。
6. 补回归：普通/OGV/外链/互动/音乐模式 Top 的截图与 DOM 断言；插件未安装时 fallback。

## 7. 兼容性策略

- `ui.endingStyle` / `ui.scene` 保持现有 API；插件只是 renderer 的实现层。
- 未安装插件时，核心内置 fallback 必须保持和现在相同的 DOM/行为。
- `ending.content` 插槽优先级最高，仍可整页替换。
- 任何插件异常不能阻断 `ended → next()`；core 捕获异常并使用 fallback。

## 8. 当前落地状态

已完成：

- 互动视频 EndPanel（`endingStyle: "interactive"`）。
- 音效调节右键面板（两页：组合预设 / 均衡器），按 `audioEffect` 插件门控懒挂载。
- 快捷键面板 i18n：`HOTKEYS` 增加 `nameKey/descKey`，面板统一 `t()`，不再硬编码英文。

待迁移：

- Top 的 `music` 模式与 Top/Ending 插件 Host（本设计为迁移蓝图，未直接替换现有渲染）。
