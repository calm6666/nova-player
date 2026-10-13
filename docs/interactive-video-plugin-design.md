# 互动视频插件 (InteractiveVideoPlugin) 设计文档

> 状态：设计阶段（本文档为后续开发的实施蓝图）
> 目录：`packages/plugins/src/interactive-video/`
> 播放器侧容器：`packages/player/src/components/InteractiveVideoLayer.ts`（已完成）

---

## 1. 背景与目标

互动视频（分支剧情视频）：观众在播放过程中通过**分支选择**决定剧情走向，
播放器在分支点弹出选项（A / B / ...），选择后跳转到对应分支视频继续播放。
主流实现（参考 B 站互动视频）包含：

- **剧情进度条（story bar）**：底部居中的半透明胶囊条，展示观众已走过的节点
  圆点；悬停圆点弹出节点标题 + 视频封面的悬停卡片
- **分支选择（question）**：分支点全屏居中的选项按钮组，用**全透明 canvas**
  绘制（选项按钮 / 文字 / 悬停态），背景图可按视频更换
- **倒计时（countdown）**：分支选择的限时进度条，超时自动选择默认分支
- **重播（replay）**：播完后从起点（或指定节点）重新播放

### 1.1 与交互卡片插件（InteractionPlugin）的区别

| 维度 | InteractiveVideoPlugin（本插件） | InteractionPlugin（既有） |
|---|---|---|
| 挂载容器 | `.nova-player-interaction-wrap` | `.nova-player-cmd-dm-inside` |
| 播放器侧组件 | `InteractiveVideoLayer`（空容器） | `InteractionLayer` |
| 功能定位 | 分支剧情视频（选择跳转播放） | 时间窗互动卡片（点赞/投票/评分） |
| 内容驱动 | 节点树 + 观看路径（有向图） | 时间轴卡片列表 |
| 样式注入 | 插件 scss `?inline` 运行时注入 | 插件 scss `?inline` 运行时注入（同模式） |

两者互不干扰，可同时挂载（不同容器）。

---

## 2. 架构设计

### 2.1 容器挂载链路

```
VideoPlayer
  └─ PlayerDocker（渲染树）
       └─ .nova-player-video-area
            ├─ ...（视频 / 弹幕 / 字幕 / 状态 / 交互卡片等既有层）
            ├─ Mini
            ├─ InteractiveVideoLayer          ← 倒数第二（控制栏之前）
            │    └─ .nova-player-interaction-wrap   【空容器，插件注入点】
            ├─ Controls（控制栏）
            └─ ErrorSign                      ← 倒数第一（错误面板）
```

- 播放器侧 `InteractiveVideoLayer` **只渲染一个空的
  `.nova-player-interaction-wrap`**，内部不写任何内容
- 组件挂载后通过 `interactiveVideoLayerMounted` 事件回传容器引用
  （`InteractiveVideoLayerAPI.wrap`），同时在播放器事件总线上广播，
  插件在 `install` 时订阅 `MOUNTED` / 容器事件获取容器并注入 DOM
- 组件销毁时清空容器内所有子节点（插件注入的内容一并移除）

### 2.2 插件注入的完整 DOM 结构

插件向 `wrap` 注入以下结构（类名与既有 Nova 播放器互动视频对齐）：

```
.nova-player-interaction-wrap                ← 播放器侧提供（空）
├─ .nova-player-interaction-story            剧情进度条（默认 display:none）
│   ├─ .nova-player-interaction-oval-wrap    圆点行挂载点
│   │   └─ .nova-player-interaction-oval     圆点行（宽度按节点数由插件设置）
│   │       └─ .nova-player-interaction-oval-item(.check | .position)
│   │           └─ .nova-player-interaction-oval-round
│   │               ├─ .small.normal         常态图标（黑底白图案）
│   │               └─ .small.hover          悬停图标（#00A1D6 蓝底白图案）
│   └─ .nova-player-interaction-hover-wrap   悬停卡片挂载点（零尺寸基准）
│       └─ .nova-player-interaction-hover-item  悬停卡片（默认 display:none）
│           ├─ .nova-player-interaction-background   标题条背景
│           ├─ .nova-player-interaction-text         节点标题（单行省略）
│           ├─ .nova-player-interaction-label        下指小三角（双层描边）
│           │   ├─ .nova-player-interaction-label-one
│           │   └─ .nova-player-interaction-label-two
│           └─ .nova-player-interaction-cover        节点视频封面
│               └─ img                                 封面图
├─ .nova-player-interaction-question        分支选择容器（默认 display:none）
│   └─ canvas                                全透明画布（插件创建与绘制）
├─ .nova-player-interaction-special          特殊节点容器（默认 display:none）
├─ .nova-player-interaction-hidden           隐藏节点容器（默认 display:none）
├─ .nova-player-interaction-countdown        倒计时进度条（默认 display:none）
└─ .nova-player-interaction-replay           重播按钮（默认 display:none）
    ├─ .nova-player-interaction-replay-icon  重播图标（环形箭头 svg）
    └─ span[data-i18n="replay"]              「重播」文案
```

### 2.3 显隐约定（核心需求）

**整个互动视频 DOM 随控制栏一起显示 / 隐藏**：

- 控制栏显隐由播放器容器的 `data-ctrl-hidden` 属性驱动
  （`PlayerDocker.showControls / hideControls` 切换）
- 插件注入样式中的联动规则（写入插件 scss，随 `?inline` 注入）：

```scss
.nova-player-container[data-ctrl-hidden="true"] {
  .nova-player-interaction-wrap {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;   // 隐藏期间禁用交互，避免误触 canvas 选项
  }
}
```

- 全屏 / 网页全屏下剧情进度条上移（控制栏更高）：

```scss
.nova-player-container[data-screen="full"],
.nova-player-container[data-screen="web"] {
  .nova-player-interaction-story { bottom: 98px; }  // 普通模式 70px
}
```

### 2.4 样式方案

- 全部样式写在 `interactive-video.scss`，以 `?inline` 导入、
  `install` 时 `injectPluginStyle` 注入（与 interaction 插件一致）
- 采用 SCSS 嵌套组织（根选择器 `.nova-player-interaction-wrap`）
- `.common-svg-icon` 全局类已由播放器提供，直接复用

---

## 3. 剧情进度条（story bar）设计

### 3.1 节点圆点（oval-item）

观看路径上每个**已观看**的节点对应一个圆点（`oval-item`）：

- **已看完的节点**：`class="check"`，圆点内注入**打勾 svg**
  （圆形底 + 对勾描边）
- **正在观看的节点**：`class="position"`（默认最后一项），圆点内注入
  **位置 svg**（圆形底 + 定位水滴图案）
- 每个圆点内叠放两份 svg（`.small.normal` 常态 / `.small.hover` 悬停态）：
  - 常态：黑底（`#000` 80% 透明度）白图案 + 白描边
  - 悬停：`#00A1D6` 蓝底白图案 + 白描边（悬停时切换显示）

### 3.2 悬停卡片（hover-item）

- 已看 N 个节点就渲染 N 个 `hover-item`（默认 `display:none`），
  与圆点**一一对应**（主流互动视频模式：观看路径是节点树上一条路径，
  中间可以有很多分支，但只显示实际走过的节点）
- 鼠标移入圆点 → 显示对应 `hover-item`（含上下文小三角指向圆点），
  圆点图标切换为 hover 态；移出恢复
- 卡片内容：
  - `text`：节点标题（如「序言」「登基」「S02争执定年号」，单行溢出省略）
  - `cover > img`：该节点视频的封面图（约 117×73）
- 卡片定位：`hover-wrap` 为零尺寸定位基准，插件按圆点位置设置
  `hover-item` 的 `left`（圆点中心对齐，`margin-left: -35px` 微调）

### 3.3 圆点行收缩动画

- `oval` 宽度由插件按节点数动态设置（每项 40px + 左右 5px margin），
  配合 `transition: 0.6s ease-out` 实现节点数变化时的平滑伸缩
- `oval-wrap` 限制 `max-width: 400px`，超出部分裁剪（溢出隐藏）

---

## 4. 分支选择（question）设计

### 4.1 容器与画布

- `question` 容器全屏居中（flex 布局），**容器自身 pointer-events: none**，
  仅 canvas 开启 `pointer-events: auto`（避免空容器挡住播放器点击）
- 画布**完全透明**（`background: transparent`），所有可视内容均由 canvas 绘制：
  - 选项按钮（描边矩形 + 半透明底）+ 选项文字（A / B / 前缀 + 文案）
  - 悬停态（鼠标移入按钮区域时高亮 / 换背景）
- 画布尺寸随容器自适应，内部按 devicePixelRatio 缩放保证清晰度

### 4.2 可更换的答案背景图

- 每个节点（视频）可配置不同的答案背景图（选项按钮的底图），
  插件按当前节点配置加载并绘制；未配置时绘制默认描边矩形
- 背景图资源配置在节点数据中（见 §5 数据结构）

### 4.3 交互流程

1. 播放到达分支点的选择时间窗 → 暂停（或继续播放由配置决定）→ 显示 question
2. 鼠标悬停选项 → 高亮 + 手型光标
3. 点击选项 → 记录选择 → 隐藏 question → `seekTo` / 切换到目标分支视频
4. 倒计时（可选）：countdown 进度条从满到空，超时自动选择默认选项

---

## 5. 数据结构设计（types.ts）

```ts
/** 互动视频节点（一个节点 = 一段可播放的视频片段） */
interface InteractiveNode {
  /** 节点唯一 id */
  id: string;
  /** 节点标题（悬停卡片显示） */
  title: string;
  /** 节点视频封面图 URL（悬停卡片显示） */
  cover: string;
  /** 节点视频源（与播放器 src 同构：字符串 / 多源数组 / 清单对象） */
  video: string | string[] | Record<string, unknown>;
  /** 视频总时长（秒，用于进度计算与倒计时窗） */
  duration: number;
  /** 分支点配置：到时间窗弹出分支选择 */
  question?: InteractiveQuestion;
}

/** 分支选择配置 */
interface InteractiveQuestion {
  /** 选择时间窗起点（秒） */
  timeStart: number;
  /** 选择时间窗终点（秒，超过后倒计时结束自动选择） */
  timeEnd: number;
  /** 题目文案（可选，绘制在选项上方） */
  title?: string;
  /** 答案背景图 URL（可选；不同节点可配不同背景） */
  background?: string;
  /** 选项列表 */
  options: InteractiveOption[];
  /** 超时自动选择的选项下标（默认 0） */
  defaultOptionIndex?: number;
}

/** 分支选项 */
interface InteractiveOption {
  /** 选项文案 */
  text: string;
  /** 选项前缀（A / B / ...，缺省按下标自动生成） */
  label?: string;
  /** 选择后跳转的目标节点 id */
  targetNodeId: string;
}

/** 观看路径上的节点快照（story bar 数据源） */
interface VisitedNode {
  /** 节点 id */
  nodeId: string;
  /** 在节点内的选择记录（-1 表示未选择 / 直线播放到底） */
  selectedOptionIndex: number;
}
```

> 数据结构与既有 HLS/交互插件约定一致：对象字段 camelCase，
> 配置对象整体注入、内部转换不影响性能。

---

## 6. 插件 API 设计（index.ts）

```ts
/** 互动视频插件配置 */
interface InteractiveVideoPluginConfig {
  /** 节点表（id → 节点） */
  nodes: Record<string, InteractiveNode>;
  /** 起始节点 id */
  startNodeId: string;
  /** 选择分支后是否自动续播（默认 true） */
  autoPlay?: boolean;
  /** 业务回调：选择了某分支 */
  onOptionSelect?: (nodeId: string, optionIndex: number) => void;
  /** 业务回调：观看路径变化（story bar 数据源） */
  onPathChange?: (path: VisitedNode[]) => void;
  /** 业务回调：点击重播 */
  onReplay?: () => void;
}

/** 工厂函数（与 InteractionPlugin 同风格） */
function InteractiveVideoPlugin(
  config: InteractiveVideoPluginConfig,
): Plugin;
```

插件实例 API（挂载后经 `player.getPluginAPI("interactiveVideo")` 获取）：

- `getPath(): VisitedNode[]` — 当前观看路径
- `jumpTo(nodeId: string)` — 外部主动跳转节点（编辑器 / 外链场景）
- `replay()` — 从起始节点重播
- `showStoryBar() / hideStoryBar()` — 手动控制剧情进度条显隐

---

## 7. 事件流设计

### 7.1 插件订阅的播放器事件

| 事件 | 用途 |
|---|---|
| `MOUNTED` | 获取 `.nova-player-interaction-wrap` 容器、注入 DOM 与样式 |
| `TIME_UPDATE` | 驱动分支时间窗判定 / 倒计时进度 |
| `SEEKED` | 跨过分支点时的路径校正（回退/前进） |
| `ENDED` | 当前节点播完：无分支 → 显示重播；有分支 → 弹出选择 |
| `DESTROY` | 清理注入的 DOM / 样式 / 监听 |

### 7.2 插件发出的播放器调用

- `player.seekTo(time)` — 分支选择后跳到目标节点视频时间点
- `player.setConfig({ src })` / `player.load()` — 切换节点视频源
- `player.play() / pause()` — 分支点暂停与选择后续播

### 7.3 私有事件（后续按需补充）

`interactiveVideoOptionSelect` / `interactiveVideoPathChange` /
`interactiveVideoReplay` 等，命名与既有 `interactionXxx` 前缀区分。

---

## 8. 模块拆分与文件规划

```
packages/plugins/src/interactive-video/
├─ index.ts                    入口：工厂函数 / install / uninstall（当前为占位）
├─ types.ts                    §5 数据结构 + 配置类型
├─ storyBar.ts                 剧情进度条：圆点行 / 双态图标 / 悬停卡片管理
├─ questionCanvas.ts           分支选择：透明 canvas 绘制 / 命中检测 / 背景图加载
├─ countdown.ts                倒计时进度条
├─ replay.ts                   重播按钮
├─ pathTracker.ts              观看路径维护（节点切换 / 回退校正 / 重播重置）
├─ icons.ts                    打勾 / 位置 / 重播 svg 图标常量（normal + hover 两态）
├─ interactive-video.scss      全部样式（?inline 注入；嵌套 + 控制栏联动显隐规则）
└─ images/                     位图资源（如有）
```

---

## 9. 关键实现要点（Lessons）

1. **容器获取时机**：`install` 时播放器可能尚未 `MOUNTED`，
   需订阅 `MOUNTED` / `interactiveVideoLayerMounted` 事件后再注入
   （参考 interaction 插件在 `MOUNTED` 时查找容器的模式）
2. **pointer-events 分层**：wrap / story / question 容器一律
   `pointer-events: none`，仅在圆点 / canvas / 重播按钮等可交互元素上
   开启 `auto`，避免遮挡播放器点击（暂停/全屏等）
3. **canvas 命中检测**：选项按钮区域自算（无 DOM），mousemove 时
   遍历选项矩形做命中，命中即换手型光标 + 高亮重绘
4. **控制栏联动**：显隐规则写在插件 scss（`data-ctrl-hidden` 选择器），
   插件自身不监听控制栏事件，纯 CSS 联动零成本
5. **节点切换的播放连续性**：切换视频源时记忆 `wasPlaying`，
   源就绪后按需自动续播（与播放器备用源切换逻辑一致）
6. **卸载清理**：`uninstall` 移除注入的样式标签与 DOM 子树、
   解绑全部事件，恢复容器为空（InteractiveVideoLayer 销毁时兜底再清一次）

---

## 10. 开发任务拆分（后续实施顺序）

1. `types.ts` 数据结构 + `index.ts` 工厂函数骨架（容器获取 / 样式注入）
2. `storyBar.ts`：静态渲染（给定路径渲染圆点 + 悬停卡片）+ 悬停交互
3. `questionCanvas.ts`：透明 canvas 选项绘制 + 命中检测 + 点击选择
4. `pathTracker.ts`：路径维护 + 视频源切换 + TIME_UPDATE 时间窗驱动
5. `countdown.ts` + `replay.ts` 收尾
6. `interaction.scss` 完整样式注入（含控制栏联动 / 全屏适配）
7. 导出接线：`packages/plugins/src/index.ts` 导出插件与类型
8. demo 验证 + 推送 CicadaPlayerNext / hili-player 双仓
