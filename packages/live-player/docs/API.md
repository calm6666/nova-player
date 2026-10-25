# @lumina/live-player —— Web Component API 文档

## 1. 自定义元素

对外只暴露 3 个 Web Component，其余 UI 都是根元素内部 DOM：

| 标签名 | 作用 | 说明 |
| --- | --- | --- |
| `<nova-live-player>` | 播放器根元素 | 唯一对外配置入口；只通过 property 配置，不观察 attribute |
| `<nova-live-player-danmaku>` | 弹幕层 | 只提供插件容器与条目适配；渲染由开发者传入的 `createDanmakuPlugin()` 负责 |
| `<nova-live-player-control-bar>` | 控制层 | 10 个控制动作、开播时长、图标 tooltip 与 hover 动效 |

以下面板均为根元素内部 DOM（不是自定义元素）：
清晰度 / 线路、弹幕设置、直播信息（含缓冲 / 丢帧曲线图）、快捷键说明、
视频编码、右键菜单、弹幕发送条、Toast、错误面板、加载指示。

### 1.1 控制条图标

控制条共 10 个动作，顺序如下：

1. 播放 / 暂停
2. 音量（hover 打开竖向滑块，移入滑块不会关闭）
3. 刷新
4. 清晰度（文字按钮，hover 打开面板）
5. 弹幕开关
6. 弹幕设置（hover 打开面板；弹幕关闭 / 未装弹幕插件时置灰且不打开面板）
7. 发送弹幕
8. 网页全屏
9. 小窗模式（进入 / 退出按状态切换图标与 tooltip）
10. 全屏

控制条在无操作约 2.6s 后自动隐藏，鼠标进入播放器或移动时重新显示；
每个图标 hover 有放大回弹动效与 tooltip。

## 2. properties（无 attribute API）

通过 `player.options = {...}` 或直接设置以下 property：

| property | 类型 | 说明 |
| --- | --- | --- |
| `options` | `NovaLivePlayerOptions` | 构造配置，见下方字段 |
| `persist` | `boolean` | 是否启用 localStorage 持久化，默认 `true` |
| `streamUrl` | `string` | 当前流地址，赋值等价于 `setStream()` |
| `volume` | `number` | 音量 0-100 |
| `muted` | `boolean` | 静音 |
| `quality` | `string`（只读） | 当前清晰度 qn |
| `line` | `string`（只读） | 当前线路 id |
| `codec` | `string`（只读） | 当前视频编码 |
| `screenModeValue` | `'normal' \| 'webscreen' \| 'fullscreen'` | 当前屏幕形态 |

`NovaLivePlayerOptions`：

```ts
interface NovaLivePlayerOptions {
  streamUrl?: string;
  quality?: string;
  qualityCandidates?: NovaQualityCandidate[];
  line?: string;
  lineCandidates?: NovaLineCandidate[];
  volume?: number;
  muted?: boolean;
  autoplay?: boolean;
  persist?: boolean;
  /** 是否启用键盘快捷键（默认 true，仅在悬停 / 聚焦 / 全屏时生效） */
  keyboard?: boolean;
  /** 悬浮小窗配色主题：'dark' 深底浅字（默认）/ 'light' 浅底深字，可经 setMiniTheme() 运行时切换并持久化 */
  miniTheme?: 'dark' | 'light';
  locale?: string;
  room?: string;
  danmaku?: Partial<NovaDanmakuSetting>;
  /** 开发者传入的插件：createHlsPlugin() / createFlvPlugin() / createDanmakuPlugin() */
  plugins?: NovaLivePluginInput[];
  /** 弹幕插件（与 plugins 中的弹幕插件二选一，显式入口优先） */
  danmakuPlugin?: NovaLiveDanmakuPlugin;
}
```

## 3. 方法

### 3.1 播放与流

- `play(): Promise<void>`
- `pause(): void`
- `togglePlay(): void`
- `setStream(url: string): void`
- `reload(): void`

### 3.2 音量与倍速

- `setVolume(volume: number): void`
- `setMuted(muted: boolean): void`
- `toggleMute(): void`
- `setSpeed(rate: number): void`（0.75 / 1 / 1.25 / 1.5 / 2）
- `cycleSpeed(): void`

### 3.3 清晰度、线路与视频编码

- `setQualityCandidates(list, current?): void`
- `setQuality(qn: string): Promise<boolean>`
- `setLineCandidates(list, current?): void`
- `setLine(line: string): boolean`（UI + 事件；真实线路切换由上层 Provider 负责）
- `getQualityCandidates(): NovaQualityCandidate[]`
- `getLineCandidates(): NovaLineCandidate[]`
- `setCodecCandidates(list: NovaCodecCandidate[], current?): void`
- `setCodec(codec: string): Promise<boolean>`（UI 状态 + `codecchange` 事件 + 持久化；
  真实编码切换由上层 Provider 负责）
- `getCodecCandidates(): NovaCodecCandidate[]`

清晰度面板为居中两页：

- 第一页：整行「线路」入口 + 清晰度列表 + 画质增强开关；
- 第二页：整行返回 + 线路列表。

面板不使用滚动条，点击整行 / 整行返回即可切页。

视频编码面板（`NovaPanelName` 新增 `'codec'`）由右键菜单「视频编码」打开，
标题 + 候选列表（AVC / HEVC / AV1 等，当前项高亮），无候选时展示空态文案。

### 3.4 屏幕形态、画中画与小窗

- `enterFullscreen(): Promise<void>`
- `exitFullscreen(): Promise<void>`
- `toggleFullscreen(): Promise<void>`
- `enterWebFullscreen(): void`
- `exitWebFullscreen(): void`
- `toggleWebFullscreen(): void`
- `togglePip(): Promise<void>`
- `enterMini(): boolean`（进入悬浮小窗；窗口形态下返回 `false`）
- `exitMini(): boolean`（退出小窗，不滚动页面）
- `toggleMini(): boolean`
- `mini: boolean`（只读，当前是否处于小窗）

小窗不是浏览器 Picture-in-Picture：它与根元素共用同一个 `<video>` / 弹幕层，
只把根元素改为 `position: fixed` 并收缩到 380×248（34px 头部 + 16:9 视频区），
因此播放不中断。滚动行为由根元素内置的 `IntersectionObserver`（threshold 0）驱动：

- 播放器完全滚出视口且在播放中 → 自动进入小窗；
- 原始位置重新可见 → 自动退出小窗；
- 点击小窗关闭按钮 → 退出并 `scrollIntoView()` 回到播放器，同时抑制本次自动弹出
  （播放器重新可见后解除，再次滚出仍会自动弹出）。

小窗内拖动 header 可移动窗口（`pointerdown` / `pointermove` / `pointerup` +
`setPointerCapture`），坐标限制在视口内并写入 localStorage，下次进入小窗时恢复。

### 3.5 弹幕

- `sendDanmaku(text, options?): void`（交给 plugins 弹幕引擎渲染）
- `loadDanmaku(list: readonly NovaDanmakuItem[]): void`
- `getDanmakuSetting(): NovaDanmakuSetting`
- `updateDanmakuSetting(patch): void`
- `resetDanmakuSetting(): void`
- `setDanmakuVisible(visible: boolean): void`
- `getDanmakuElement(): HTMLElement | null`

弹幕设置面板为两页（与点播播放器 DmSetting 结构一致，仅圆角改为 8px）：

- 第一页：显示区域、弹幕密度（正常 / 较多 / 重叠）、不透明度、字体大小、
  弹幕速度、弹幕随屏幕缩放 / 智能防挡、高级设置；
- 第二页：返回、弹幕字体 + 粗体、描边类型（重量 / 描边 / 45°投影）、恢复默认。

### 3.6 面板与提示

- `openPanel(name: 'quality' | 'speed' | 'danmaku' | 'info' | 'hotkey' | 'codec'): void`
  （`danmaku` 在弹幕关闭时会被内部拦截并给出 Toast）
- `closePanel(name): void`
- `closePanels(): void`
- `openContextMenu(x?, y?): void`
- `closeContextMenu(): void`
- `showToast(message, type?, duration?): void`
- `showError(content: NovaErrorContent): void`
- `hideError(): void`
- `clearPersistedSettings(): void`
- `setLocale(locale: string): void`
- `getLocale(): string`
- `getVideoElement(): HTMLVideoElement | null`
- `getContainerElement(): HTMLElement | null`
- `destroy(): void`

面板交互约定：

- 控制条图标鼠标移入即打开对应面板；
- 鼠标离开后延迟关闭；
- 一旦点击图标或面板内部内容，面板被「固定」，鼠标移出不会关闭，
  只有点击外部、Esc 或再次点击图标才会关闭（修复面板点击后变小导致误关闭）；
- 清晰度 / 速度 / 弹幕设置面板打开时，控制条保持显示。

## 4. 事件

全部事件由根元素派发，类型为 `nova-live-player:*`，`detail` 见下：

| 事件 | detail |
| --- | --- |
| `ready` | `{ container }` |
| `play` / `pause` | `undefined` |
| `timeupdate` | `{ currentTime, duration, liveDuration }`；直播场次的 `liveDuration` 是开播至今秒数，不是视频播放进度 |
| `progress` | `{ buffered, percent }` |
| `volumechange` | `{ volume }` |
| `mutechange` | `{ muted }` |
| `qualitychange` | `{ quality, label }` |
| `qualitycandidates` | `{ candidates, current }` |
| `linechange` | `{ line, label }` |
| `linecandidates` | `{ candidates, current }` |
| `codecchange` | `{ codec, label }` |
| `screenchange` | `{ mode }` |
| `minichange` | `{ mini: boolean }` |
| `danmakuvisible` | `{ visible }` |
| `danmakusetting` | `{ setting }` |
| `danmakusent` | `{ text }` |
| `streamchange` | `{ url }` |
| `reload` / `destroy` | `undefined` |
| `error` | `{ code, message }` |

辅助函数：`onPlayerEvent(player, name, handler)`，返回取消订阅函数。

## 5. 持久化

key：`lumina.live-player.settings.v1`。

保存字段：音量、静音、清晰度、线路、视频编码、弹幕开关 / 透明度 / 字号 / 速度 /
区域 / 密度 / 自动缩放 / 速度同步 / 字体 / 粗体 / 描边 / 屏蔽词、屏幕形态。

小窗位置单独存放在 `lumina.live-player.mini-position.v1`（`{ left, top }`，
视口坐标），避免拖动小窗时反复重写整份设置；`clearPersistedSettings()` 会同时
清空两个 key。

恢复优先级：localStorage 中的用户选择优先于 `options` 中的默认值。
`persist = false` 时不读不写；`clearPersistedSettings()` 清空。

## 6. DOM 约定

- 根元素不观察 attribute；配置全部走 property；
- 控制条、面板、Toast 等隐藏态统一使用 `[hidden]`；
- 选中 / 激活态使用 `.is-active` / `.is-selected`；
- 自有类名统一 `nova-live-player-*` 前缀；
- 小窗结构照真实直播间 mini 播放器替换类名：`.nova-live-player-mini`（悬浮容器）/
  `-mini-header`（拖动区，真实为容器 `:before` 标题栏）/ `-mini-title` /
  `-mini-close`（真实 `.minimal-restore-btn`）/ `-mini-body`（视频区）/
  `-mini-watermark` / `-mini-overlay`（真实 `.minimal-control-panel`，hover 显示）/
  `-mini-play` 与 `-mini-refresh`（真实 `.control-btn`）；小窗期间额外插入
  `.nova-live-player-mini-anchor` 作为「原始位置」观测锚点；
- 运行期坐标、百分比、透明度、颜色使用内联样式，其余样式均在 SCSS 中；
- 布局只使用绝对定位与 flexbox，不使用 grid / aspect-ratio / display:contents；
- 不使用 RelaySlot；已删除设置面板。

## 7. i18n

初始化时注入简体中文，默认显示中文而不是键名；词典来自
`src/i18n/locales.ts`，与框架内置语言包合并。`setLocale('en-US')` 可切换语言，
`getLocale()` 返回当前语言。

## 8. 插件（流媒体 + 弹幕）

本包不内置 HLS / FLV 加载器，也不内置弹幕引擎，全部由开发者传入：

```ts
import { createHlsPlugin } from '@lumina/plugins/hls';
import { createFlvPlugin } from '@lumina/plugins/flv';
import { createDanmakuPlugin } from '@lumina/plugins/danmaku';

player.options = {
  plugins: [
    createHlsPlugin({ autoplay: false }),
    createFlvPlugin({ autoplay: false, isLive: true }),
    createDanmakuPlugin(),
  ],
};
```

- 生命周期插件（弹幕插件等）经与点播播放器相同的 `PluginManager` 安装；
  宿主用一个最小的 `VideoPlayer` 展示面（`events` / `state` / `props`）完成
  `mounted` 事件与弹幕设置状态键接线；
- 流媒体插件由宿主按插件声明的 `type` 匹配 `.m3u8` / `.flv` 后直接 `load()`，
  不参与 `PluginManager` 生命周期，避免未挂载视频时重复安装；
- 无匹配流插件：回退原生 `<video>` 并 Toast「未提供对应流插件」；
- 无弹幕插件：弹幕层不渲染，控制条弹幕开关 / 发送 / 设置入口禁用并 Toast
  「未提供弹幕插件」；`sendDanmaku()` / `loadDanmaku()` 走弹幕插件 API；
- 清晰度、线路、统计信息均从当前生效插件实例读取；插件不支持时返回空态；
- 插件错误通过 `StreamPluginEventEnum.ERROR` 监听并转换为 `error` 事件。

## 9. Demo 与验证

```bash
# 仓库根目录
node node_modules/typescript/bin/tsc --noEmit -p packages/live-player/tsconfig.json
pnpm --dir packages/live-player build
pnpm exec vite build --config demo/live-player-demo/vite.config.ts
node packages/live-player/scripts/cdp-smoke.mjs
```

CDP 冒烟共 72 项断言，覆盖：控制条 10 动作、自动隐藏、音量浮层 hover-intent、
清晰度两页、弹幕设置两页、弹幕关闭时禁止打开弹幕设置（hover / 点击 / 右键 /
内部 API）、hover 打开 / 固定、信息面板开播时长与缓冲 / 丢帧 polyline 曲线、
快捷键、右键菜单 4 项、视频编码面板（空态 / 高亮 / 切换 / codecchange /
持久化）、错误面板、18 类事件、持久化恢复、HLS 插件首帧、弹幕文字无
`-webkit-text-stroke`、未传插件时的禁用 / Toast / 原生回退、截图；
其中小窗专项断言覆盖：控制栏入口与图标 / tooltip 切换、小窗结构（header /
省略标题 / 关闭 / 两个 overlay 按钮 / 水印）、380×248 / 8px 圆角 / 深色底 /
阴影 / 34px 头部、复用同一 video、默认隐藏遮罩与 hover 显示、CDP 真实指针
拖动 (+120, +80) 与视口约束、位置写入 localStorage 并在刷新后恢复、关闭按钮
`minichange {mini:false}` + `scrollIntoView`、滚动自动弹出 / 滚回自动退出。

截图：`packages/live-player/artifacts/`（demo-overview / info-chart / codec-panel /
volume-popup / danmaku-text / mini-player / mini-player-idle / mini-player-dragged /
mini-player-position / mini-player-autoscroll）。

## 10. 已知限制

- 真实直播线路切换需上层 Provider 提供新 URL，本包只负责 UI 状态与事件；
- 视频编码面板只维护 UI 状态与 `codecchange` 事件，真实编码切换需上层重新拉流；
- 清晰度面板的「画质增强」开关目前为 UI 状态，不改变流媒体请求；
- 弹幕「速度同步」目前随设置持久化，但不会反向修改视频倍速；
- 屏幕形态中的原生全屏依赖浏览器 Fullscreen API，受限环境会回退提示；
- 画中画依赖浏览器 Picture-in-Picture 支持；
- 小窗依赖浏览器 IntersectionObserver / Pointer Events（无 IntersectionObserver
  时滚动自动弹出 / 自动退出不生效，手动 `enterMini()` 仍可用）；小窗期间若页面
  发生重排（非视口尺寸变化），原始位置锚点不会自动重算，滚回判定可能偏移；
- 小窗与网页全屏 / 原生全屏互斥：窗口形态下调用 `enterMini()` 返回 `false`，
  进入全屏会自动退出小窗；
- 弹幕设置中的「智能防挡」目前为 UI 状态，实际遮罩能力依赖
  plugins 引擎后续开放 API（本包不修改 plugins）；
- `setLocale()` 更新全局语言包；已挂载实例中的静态文案在重新创建实例后
  使用新语言（动态数值与列表会即时刷新）。
