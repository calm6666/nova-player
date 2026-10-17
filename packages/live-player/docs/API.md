# @lumina/live-player —— Web Component API 文档

## 1. 自定义元素

对外只暴露 3 个 Web Component，其余 UI 都是根元素内部 DOM：

| 标签名 | 作用 | 说明 |
| --- | --- | --- |
| `<nova-live-player>` | 播放器根元素 | 唯一对外配置入口；只通过 property 配置，不观察 attribute |
| `<nova-live-player-danmaku>` | 弹幕层 | 内部集成 `packages/plugins` 的 `DanmakuManager`（与点播播放器同一弹幕引擎） |
| `<nova-live-player-control-bar>` | 控制层 | 10 个控制动作、开播时长、图标 tooltip 与 hover 动效 |

以下面板均为根元素内部 DOM（不是自定义元素）：
清晰度 / 线路、速度、弹幕设置、直播信息、快捷键说明、右键菜单、
举报弹窗、弹幕发送条、Toast、错误面板、加载指示。

### 1.1 控制条图标

控制条共 10 个动作，顺序如下：

1. 播放 / 暂停
2. 音量（hover 打开竖向滑块，移入滑块不会关闭）
3. 刷新
4. 清晰度（文字按钮，hover 打开面板）
5. 弹幕开关
6. 发送弹幕
7. 倍速（文字按钮，hover 打开面板）
8. 弹幕设置（hover 打开面板）
9. 网页全屏
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
  locale?: string;
  room?: string;
  danmaku?: Partial<NovaDanmakuSetting>;
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

### 3.3 清晰度与线路

- `setQualityCandidates(list, current?): void`
- `setQuality(qn: string): Promise<boolean>`
- `setLineCandidates(list, current?): void`
- `setLine(line: string): boolean`（UI + 事件；真实线路切换由上层 Provider 负责）
- `getQualityCandidates(): NovaQualityCandidate[]`
- `getLineCandidates(): NovaLineCandidate[]`

清晰度面板为居中两页：

- 第一页：整行「线路」入口 + 清晰度列表 + 画质增强开关；
- 第二页：整行返回 + 线路列表。

面板不使用滚动条，点击整行 / 整行返回即可切页。

### 3.4 屏幕形态与画中画

- `enterFullscreen(): Promise<void>`
- `exitFullscreen(): Promise<void>`
- `toggleFullscreen(): Promise<void>`
- `enterWebFullscreen(): void`
- `exitWebFullscreen(): void`
- `toggleWebFullscreen(): void`
- `togglePip(): Promise<void>`

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

- `openPanel(name: 'quality' | 'speed' | 'danmaku' | 'info' | 'hotkey'): void`
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
| `screenchange` | `{ mode }` |
| `danmakuvisible` | `{ visible }` |
| `danmakusetting` | `{ setting }` |
| `danmakusent` | `{ text }` |
| `streamchange` | `{ url }` |
| `reload` / `destroy` | `undefined` |
| `error` | `{ code, message }` |

辅助函数：`onPlayerEvent(player, name, handler)`，返回取消订阅函数。

## 5. 持久化

key：`lumina.live-player.settings.v1`。

保存字段：音量、静音、清晰度、线路、弹幕开关 / 透明度 / 字号 / 速度 / 区域 /
密度 / 自动缩放 / 速度同步 / 字体 / 粗体 / 描边 / 屏蔽词、屏幕形态。

恢复优先级：localStorage 中的用户选择优先于 `options` 中的默认值。
`persist = false` 时不读不写；`clearPersistedSettings()` 清空。

## 6. DOM 约定

- 根元素不观察 attribute；配置全部走 property；
- 控制条、面板、Toast 等隐藏态统一使用 `[hidden]`；
- 选中 / 激活态使用 `.is-active` / `.is-selected`；
- 自有类名统一 `nova-live-player-*` 前缀；
- 运行期坐标、百分比、透明度、颜色使用内联样式，其余样式均在 SCSS 中；
- 布局只使用绝对定位与 flexbox，不使用 grid / aspect-ratio / display:contents；
- 不使用 RelaySlot；已删除设置面板。

## 7. i18n

初始化时注入简体中文，默认显示中文而不是键名；词典来自
`src/i18n/locales.ts`，与框架内置语言包合并。`setLocale('en-US')` 可切换语言，
`getLocale()` 返回当前语言。

## 8. 流媒体插件

- `.m3u8` → 动态导入 `@/lumina/plugins/hls`；
- `.flv` → 动态导入 `@/lumina/plugins/flv`；
- 其它 URL → 原生 `<video>`。

清晰度、线路、统计信息统一由 `src/core/stream.ts` 收敛；插件错误通过
`StreamPluginEventEnum.ERROR` 监听并转换为 `error` 事件。

## 9. Demo 与验证

```bash
# 仓库根目录
node node_modules/typescript/bin/tsc --noEmit -p packages/live-player/tsconfig.json
node node_modules/vite/bin/vite.js build --config demo/live-player-demo/vite.config.ts
node packages/live-player/scripts/cdp-smoke.mjs
```

CDP 冒烟共 40 项断言，覆盖：控制条 10 动作、自动隐藏、音量浮层、
清晰度两页、弹幕设置两页、hover 打开 / 固定、信息面板开播时长、
快捷键、右键菜单与举报、错误面板、17 类事件、持久化恢复、截图。

截图：`packages/live-player/artifacts/`（demo-overview / quality-page1 /
quality-page2 / dm-page1 / dm-page2 / tooltip）。

## 10. 已知限制

- 真实直播线路切换需上层 Provider 提供新 URL，本包只负责 UI 状态与事件；
- 清晰度面板的「画质增强」开关目前为 UI 状态，不改变流媒体请求；
- 弹幕「速度同步」目前随设置持久化，但不会反向修改视频倍速；
- 屏幕形态中的原生全屏依赖浏览器 Fullscreen API，受限环境会回退提示；
- 画中画依赖浏览器 Picture-in-Picture 支持；
- 弹幕设置中的「智能防挡」目前为 UI 状态，实际遮罩能力依赖
  plugins 引擎后续开放 API（本包不修改 plugins）；
- `setLocale()` 更新全局语言包；已挂载实例中的静态文案在重新创建实例后
  使用新语言（动态数值与列表会即时刷新）。
