# Nova 播放器完整 API 文档

> 本文档为 `@lumina/nova` 与 `@lumina/plugins` 的 100% 公开 API 参考。
> 简明索引见 [`packages/player/README.md`](../packages/player/README.md)。

## 目录

1. [安装与引入](#1-安装与引入)
2. [快速开始](#2-快速开始)
3. [PlayerConfig 全字段表](#3-playerconfig-全字段表)
4. [VideoPlayer 全公开方法表](#4-videoplayer-全公开方法表)
5. [全事件表](#5-全事件表)
6. [插件系统](#6-插件系统)
7. [插槽机制](#7-插槽机制)
8. [h 函数 / VNode / defineComponent 用法](#8-h-函数--vnode--definecomponent-用法)
9. [持久化机制](#9-持久化机制)
10. [SSR 用法](#10-ssr-用法)
11. [完整示例](#11-完整示例)
12. [FAQ / 常见问题](#12-faq--常见问题)

---

## 1. 安装与引入

```bash
pnpm add @lumina/nova @lumina/plugins
```

仓库为 monorepo，开发期通过路径别名引用：

```ts
// 包入口
import { VideoPlayer, h, defineComponent, useContext } from "@lumina/nova";
import {
  DanmakuPlugin,
  SubtitlePlugin,
  InteractionPlugin,
  createHlsPlugin,
  createDashPlugin,
  createFlvPlugin,
} from "@lumina/plugins";
```

类型一并从包入口导出：

```ts
import type { PlayerConfig, VNode, ControlSlotItem, EndingSlot, SlotContext, Plugin } from "@lumina/nova";
import type { DanmakuPluginAPI, SubtitlePluginAPI, InteractionPluginAPI } from "@lumina/plugins";
```

运行时原语 `h` / `defineComponent` / `Fragment` / `useTemplateRef` / `createContext` / `useContext` / `provide` / `when` / `each` 与 `PlayerContext` 均从 `@lumina/nova` 导出。

---

## 2. 快速开始

### 2.1 最小可用

```ts
import { VideoPlayer } from "@lumina/nova";

const player = new VideoPlayer({
  container: "#player",
  src: "https://example.com/video.mp4",
});

player.mount(document.querySelector("#player")!);
```

### 2.2 便捷入口

```ts
import { mountPlayer, createPlayer } from "@lumina/nova";

// 创建并挂载（SSR 环境自动跳过挂载）
const player = mountPlayer("#player", { src: "video.mp4" });

// 仅创建实例
const p = createPlayer({ src: "video.mp4" });
```

### 2.3 完整 demo 引用

仓库内置独立 demo [`demo/player-demo/`](../demo/player-demo)，演示插件注入、插槽、自定义片尾、事件回调与插件 API 调用，运行：

```bash
pnpm vite --config demo/vite.config.ts
```

---

## 3. PlayerConfig 全字段表

`PlayerConfig` 顶层只保留资源类三项，其余按功能分组为命名空间。`mergePlayerConfig` 与默认值深度合并：嵌套纯对象递归合并，数组整体替换，`undefined` 视为未提供。

| 字段 | 类型 | 默认值 | 动态 | 说明 |
| --- | --- | --- | --- | --- |
| `container` | `HTMLElement \| string` | `undefined` | 否 | 容器元素或选择器 |
| `src` | `string \| ProgressiveVariant[] \| MediaManifestSource` | `''` | 是（`setConfig`） | 视频源 |
| `poster` | `string` | `''` | 是（`setPoster`） | 封面图 URL |
| `playback` | `PlaybackConfig` | 见下 | 部分 | 播放行为 |
| `playback.autoplay` | `boolean` | `false` | 否 | 自动播放 |
| `playback.muted` | `boolean` | `false` | 是（`setMuted`） | 初始静音 |
| `playback.volume` | `number` | `1` | 是（`setVolume`） | 初始音量 0-1 |
| `playback.playbackRate` | `number` | `1` | 是（`setPlaybackRate`） | 倍速 |
| `playback.loop` | `boolean` | `false` | 是（`setLoop`） | 循环播放（单曲循环语义） |
| `playback.playMode` | `PlayMode` | `PlayMode.ORDER` | 是（`setPlayMode`） | 顺序 / 列表循环 / 随机 |
| `playback.preload` | `'none' \| 'metadata' \| 'auto'` | `'metadata'` | 否 | 预加载策略 |
| `playback.playsinline` | `boolean` | `true` | 否 | 移动端内联播放 |
| `playback.startTime` | `number` | `0` | 否 | 起播时间（秒） |
| `playlist` | `MediaItem[]` | `[]` | 是（`setConfig`） | 播放列表 |
| `playlistIndex` | `number` | `0` | 是（`switchTo`） | 起始下标 |
| `ui.title` | `string` | `'嗨哩播放器'` | 是（`setConfig`） | 播放器名称 |
| `ui.scene` | `'station' \| 'embedded'` | `'station'` | 否（挂载期读取） | 播放场景：站内完整 / 外链嵌入（见 §7.5） |
| `ui.endingStyle` | `'standard' \| 'ogv'` | `'standard'` | 否（挂载期读取） | 片尾形态：普通浮层 / 电视剧整页（见 §7.5） |
| `ui.embedded` | `EmbeddedConfig` | `undefined` | 否（挂载期读取） | 外链场景的标题 / UP / 推荐 / 跳转地址（见 §7.5） |
| `ui.ogv` | `OgvEndingConfig` | `undefined` | 否（挂载期读取） | 电视剧 / 番剧片尾：标题 / 封面 / 追剧状态 / 推荐 |
| `ui.related` | `EndingRelatedItem[]` | `undefined` | 否（挂载期读取） | 站内标准片尾的相关推荐 |
| `ui.up` | `EndingUpInfo` | `undefined` | 否（挂载期读取） | 站内标准片尾的 UP 头像 / 昵称 / 关注态 |
| `ui.share` | `ShareInfo` | `undefined` | 否（挂载期读取） | 片尾分享面板：视频地址 / 嵌入代码 / 二维码图片 |
| `ui.controls` | `ControlsConfig` | `defaultControlConfig` | 否 | 控件开关（见下） |
| `ui.slots` | `ControlSlotItem[]` | `undefined` | 否 | 控制栏插槽（见 §7） |
| `interaction.keyboard` | `boolean \| KeyboardStepConfig` | `true` | 否 | 快捷键开关或步长配置 |
| `quality.default` | `string` | `'auto'` | 是（`setQuality`） | 默认画质 |
| `quality.mode` | `'auto' \| 'manual'` | `'auto'` | 是（`setQualityMode`） | 选择模式 |
| `quality.max` / `quality.min` | `number` | `undefined` | 是（`applyQualityLimits`） | 画质上下限（像素高度） |
| `quality.labels` | `Record<string, string>` | `undefined` | 否 | 自定义画质文案 |
| `progress.segments` | `ProgressSegment[]` | `[]` | 是（`setConfig`） | 进度条分段 |
| `progress.skipPoints` | `ProgressSkipPoints` | `undefined` | 是（`setSkipPoints`） | 片头结束 / 片尾开始断点（进度条圆点 + 跳过头尾） |
| `danmaku` | `DanmakuConfigSpace` | `undefined` | 是 | 兼容旧调用方；运行时能力由 `DanmakuPlugin` 提供 |
| `subtitle` | `SubtitleConfigSpace` | `undefined` | 是 | 兼容旧调用方；运行时能力由 `SubtitlePlugin` 提供 |
| `plugins.list` | `Plugin[]` | `[]` | 是（`use` / `uninstallPlugin`） | 插件实例列表 |
| `plugins.options` | `Record<string, unknown>` | `{}` | 否 | 按插件名索引的选项 |
| `ending.content` | `VNode \| ((ctx: SlotContext) => VNode)` | `undefined` | 否 | 片尾页面插槽（见 §7） |
| `storage.enabled` | `boolean` | `true` | 否 | 持久化开关 |
| `storage.prefix` | `string` | `'nova-player:'` | 否 | 进度等键前缀 |
| `ssr.enabled` | `boolean` | `false` | 否 | SSR 模式 |
| `ssr.placeholder` | `string` | `'<div class="nova-player-placeholder">视频加载中...</div>'` | 否 | SSR 占位符 |
| `ssr.deferHydration` | `boolean` | `false` | 否 | 延迟水合 |
| `advanced.logLevel` | `LogLevel` | `LogLevel.SILENT` | 是（`setConfig`） | 日志级别 |
| `advanced.debug` | `boolean` | `false` | 是 | 调试模式（等价 `logLevel: 'debug'`） |
| `callbacks` | `EventListeners` | `{}` | 否 | 配置式事件回调，键名与 `PlayerEvents` 一致 |

### 3.1 `ControlsConfig` 控件开关

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `prev` | `boolean` | `true` | 上一个分 P |
| `next` | `boolean` | `true` | 下一个分 P |
| `viewpoint` | `boolean` | `false` | 看点 |
| `quality` | `boolean` | `true` | 清晰度菜单 |
| `episodes` | `boolean` | `false` | 选集菜单 |
| `setting` | `boolean` | `true` | 设置菜单 |
| `pip` | `boolean` | `true` | 画中画 |
| `wideScreen` | `boolean` | `true` | 宽屏 |
| `webFullscreen` | `boolean` | `true` | 网页全屏 |
| `progressSegments` | `ProgressSegment[]` | `undefined` | 进度条分段（运行时透传） |

### 3.2 `KeyboardStepConfig`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `seekStep` | `number` | 方向键快进/快退步长（秒） |
| `volumeStep` | `number` | 方向键音量步长 0-1 |
| `holdRate` | `number` | 长按加速倍率 |

---

## 4. VideoPlayer 全公开方法表

构造：`new VideoPlayer(config: PlayerConfig)`。SSR 安全（不访问 DOM），DOM 绑定在 `mount` / `hydrate` 时进行。

### 4.1 生命周期

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `mount` | `(container: HTMLElement) => void` | 渲染 VNode 并挂载到容器，触发 `mounted` 事件 |
| `hydrate` | `(container: HTMLElement) => void` | SSR 水合：与服务端输出 HTML 匹配绑定事件 |
| `destroy` | `() => void` | 暂停、取消竞态、卸载插件监听、销毁 VNode、触发 `destroy` 事件 |
| `render` | `() => VNode` | 返回播放器 VNode 树（SSR 与客户端共用） |

### 4.2 播放控制

| 方法 | 签名 | 示例 |
| --- | --- | --- |
| `play` | `() => Promise<void>` | `await player.play()` |
| `pause` | `() => void` | `player.pause()` |
| `toggle` | `() => void` | `player.toggle()` |
| `seek` | `(time: number) => void` | `player.seek(60)` |
| `seekBy` | `(delta: number) => void` | `player.seekBy(-5)` 后退 5s |
| `reload` | `() => void` | 重新加载当前源 |
| `getCurrentTime` | `() => number` | 当前时间（秒） |
| `getDuration` | `() => number` | 总时长（秒） |
| `getBuffered` | `() => number` | 已缓冲时长（秒） |
| `isPaused` | `() => boolean` | |
| `isPlaying` | `() => boolean` | |
| `getState` | `() => PlayerStateData` | 当前状态快照（含 `playerState` 枚举） |

### 4.3 音量与倍速

| 方法 | 签名 |
| --- | --- |
| `setVolume` | `(volume: number) => void`（自动 clamp 0-1） |
| `getVolume` | `() => number` |
| `setMuted` | `(muted: boolean) => void` |
| `toggleMute` | `() => void` |
| `isMuted` | `() => boolean` |
| `setPlaybackRate` | `(rate: number) => void` |
| `getPlaybackRate` | `() => number` |
| `setLoop` | `(loop: boolean) => void` |
| `setPlayMode` | `(mode: PlayMode) => void` |

### 4.4 显示模式与全屏

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `setDisplayMode` | `(mode: DisplayMode) => void` | `'normal' \| 'web' \| 'mini'` 由播放器内部处理；`'wide'` 只更新宽屏状态并广播 `wideScreenChange`，布局由外部容器决定 |
| `toggleWideScreen` | `() => void` | 切换宽屏：只更新状态 + 广播 `wideScreenChange`，不修改 `data-screen` / 布局 |
| `setWideScreen` | `(isWide: boolean) => void` | 设置宽屏状态（外部容器驱动的布局开关） |
| `isWideScreen` | `() => boolean` | 是否处于宽屏状态 |
| `toggleWebFullscreen` | `() => void` | 切换 web 全屏 |
| `isWebFullscreen` | `() => boolean` | |
| `toggleFullscreen` | `() => Promise<void>` | 切换浏览器全屏 |
| `enterFullscreen` | `() => Promise<void>` | 进入全屏 |
| `exitFullscreen` | `() => Promise<void>` | 退出全屏 |
| `isFullscreen` | `() => boolean` | |
| `togglePip` | `() => Promise<void>` | 切换画中画 |
| `enterPip` | `() => Promise<void>` | |
| `exitPip` | `() => Promise<void>` | |
| `resize` | `() => void` | 触发 `resize` 事件 |

#### 宽屏（外部容器驱动）

宽屏布局完全由播放器**外部容器**决定。控制栏宽屏按钮点击 / `toggleWideScreen()` 只做两件事：

1. 更新内部宽屏状态（宽屏按钮高亮、图标随状态切换）；
2. 广播 `wideScreenChange`，回调参数为是否宽屏的布尔值。

播放器内部不修改 `data-screen`、不搬移发送栏，外部程序监听后自行调整容器布局：

```ts
player.on("wideScreenChange", ({ isWideScreen }) => {
  appContainer.classList.toggle("is-wide", isWideScreen);
});

// 也可以主动同步：
player.setWideScreen(true); // 只更新状态 + 广播 wideScreenChange
player.isWideScreen();
```

### 4.5 清晰度

| 方法 | 签名 |
| --- | --- |
| `setQuality` | `(quality: string) => void` |
| `getQuality` | `() => string`（`getCurrentQuality` 别名） |
| `getCurrentQuality` | `() => string` |
| `getQualities` | `() => StreamQualityLevel[]` |
| `setQualityMode` | `(mode: 'auto' \| 'manual') => void` |
| `getQualityMode` | `() => QualityCapability` |
| `applyQualityLimits` | `(limits: { max?: number; min?: number }) => void` |

### 4.6 弹幕（需注册 `DanmakuPlugin`）

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `setDanmakuVisible` | `(visible: boolean) => void` | 触发 `danmakuToggle` |
| `getDanmakuVisible` | `() => boolean` | |
| `isDanmakuVisible` | `() => boolean` | 别名 |
| `toggleDanmaku` | `() => boolean` | 返回切换后状态 |
| `setDanmakuOpacity` | `(opacity: number) => void` | 0-1 |
| `setDanmakuSpeed` | `(speed: number) => void` | 倍率 |
| `setDanmakuSource` | `(url: string) => void` | 切换弹幕源 URL |
| `clearDanmaku` | `() => void` | 清空 |
| `sendDanmaku` | `(text: string, options?: Record<string, unknown>) => void` | 发送 |

> 插件级 API（`loadDanmaku` / `send` / `sendBatch` / `getManager` 等）通过 `player.getPlugin<DanmakuPluginAPI>('danmaku')` 调用，见 §6。

### 4.7 字幕（需注册 `SubtitlePlugin`）

| 方法 | 签名 |
| --- | --- |
| `setSubtitleVisible` | `(visible: boolean) => void` |
| `getSubtitleVisible` | `() => boolean` |
| `toggleSubtitle` | `() => boolean` |
| `setSubtitleLang` | `(lang: string) => void` |
| `setSubtitleList` | `(list: SubtitleConfig[]) => void` |

### 4.8 播放列表

| 方法 | 签名 |
| --- | --- |
| `getPlaylist` | `() => readonly MediaItem[]` |
| `getCurrentIndex` | `() => number` |
| `switchTo` | `(index: number) => Promise<void>` |
| `next` | `() => Promise<void>` |
| `prev` | `() => Promise<void>` |
| `setPoster` | `(url: string) => void` |

### 4.9 插件管理

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `use` | `(plugin: Plugin) => VideoPlayer` | 安装插件，返回 this 支持链式 |
| `uninstallPlugin` | `(name: string) => void` | 卸载按名 |
| `getPlugin<T>` | `<T extends Plugin>(name: string) => T \| undefined` | 取插件实例 |
| `getPluginAPI<T>` | `<T extends Plugin>(name: string) => T \| undefined` | 同上（别名） |

### 4.10 配置与事件

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `getConfig` | `() => Readonly<PlayerConfig>` | 当前完整配置 |
| `setConfig` | `(partial: DeepPartial<PlayerConfig>) => void` | 增量更新，自动 diff 应用 |
| `on` | `<K extends keyof PlayerEvents>(event: K, cb: PlayerEvents[K]) => () => void` | 订阅，返回取消函数 |
| `once` | `<K extends keyof PlayerEvents>(event: K, cb: PlayerEvents[K]) => () => void` | 只触发一次 |
| `off` | `<K extends keyof PlayerEvents>(event: K, cb: PlayerEvents[K]) => void` | 取消订阅 |

---

## 5. 全事件表

监听方式：配置式 `callbacks`（键名与下表一致）或运行时 `player.on` / `once`。

### 5.1 播放器生命周期

| 事件 | payload | 触发时机 |
| --- | --- | --- |
| `ready` | 无 | 初始化完成 |
| `mounted` | `{ container?, video?, sendingArea? }` | 挂载完成 |
| `destroy` | 无 | 销毁 |
| `restoreProgress` | `{ time: number }` | 从持久化恢复播放位置 |

### 5.2 播放状态

| 事件 | payload | 触发时机 |
| --- | --- | --- |
| `play` | 无 | 播放开始 |
| `pause` | 无 | 暂停 |
| `playing` | 无 | 实际开始播放（缓冲后） |
| `ended` | 无 | 播放结束 |
| `waiting` | 无 | 缓冲开始 |
| `canplay` | 无 | 缓冲完成可继续 |
| `canPlayThrough` | 无 | 可播完不中断 |
| `statechange` | `PlayerState` | 状态变化 |
| `timeupdate` | `(currentTime: number, duration: number)` | 进度更新 |
| `progress` | `TimeRanges` | 加载进度 |
| `seeking` | `currentTime` | 跳转开始 |
| `seeked` | `currentTime` | 跳转完成 |
| `seekStart` | `{ time, previousTime }` | 跳转开始（契约） |
| `seekEnd` | `{ time, previousTime }` | 跳转结束（契约） |
| `resize` | `(width, height)` | 播放器尺寸变化 |

### 5.3 媒体标准事件（与 video 元素一一对应）

`abort` / `durationchange: (duration)` / `emptied` / `loadeddata` / `loadedmetadata: (duration)` / `loadstart` / `stalled` / `suspend`。

### 5.4 音量/倍速

| 事件 | payload |
| --- | --- |
| `volumechange` | `(volume: number, muted: boolean)` |
| `mutedChange` | `muted: boolean` |
| `ratechange` | `rate: number` |

### 5.5 显示模式

| 事件 | payload | 触发时机 |
| --- | --- | --- |
| `displayModeChange` | `{ mode: DisplayMode }` | normal/web/mini 切换（宽屏不再走内部显示模式） |
| `wideScreenChange` | `{ isWideScreen: boolean }` | 宽屏切换（布局由外部容器决定，监听后自行调整） |
| `webFullscreenChange` | `{ isWebFullscreen: boolean }` | web 全屏切换 |
| `fullscreenchange` | `isFullscreen: boolean` | 浏览器全屏 |
| `pipchange` | `isPip: boolean` | 画中画 |

### 5.6 清晰度

| 事件 | payload |
| --- | --- |
| `qualitychange` | `quality: string` |
| `qualityListChange` | `{ qualities: QualityLevel[]; mode }` |
| `qualityChangeRequested` | `{ from, to, label? }` |
| `qualityChangeRendered` | `{ from, to, quality?, elapsed }` |
| `qualityChangeFailed` | `{ from, to, reason }` |
| `qualityModeChange` | `{ mode: 'auto' \| 'manual' }` |

### 5.7 弹幕

| 事件 | payload |
| --- | --- |
| `danmakuToggle` | `{ visible: boolean }` |
| `danmakuLoaded` | `{ count: number; url?: string }` |
| `danmakuOpacityChange` | `opacity: number` |
| `danmakuSpeedChange` | `speed: number` |
| `danmakuSend` | `{ text: string; options? }` |
| `danmakuSent` | `Record<string, unknown>` |
| `danmakuClear` | 无 |
| `sendDanmaku` | 无（用户提交，发送栏触发） |

### 5.8 字幕

| 事件 | payload |
| --- | --- |
| `subtitleToggle` | `{ visible: boolean }` |
| `subtitleLangChange` | `lang: string` |
| `subtitleSwitch` | `{ lang: string }` |
| `subtitleListChange` | `{ count: number }` |

### 5.9 播放列表/多 P

| 事件 | payload |
| --- | --- |
| `episodeChange` | `{ index, total, id?, title? }` |
| `playlistChange` | `{ index, total }` |
| `prevRequest` / `nextRequest` | 无 |

### 5.10 互动

| 事件 | payload |
| --- | --- |
| `interactionLike` / `interactionCoin` / `interactionCollect` / `interactionFollow` / `interactionLinkClick` | 无 |
| `interactionVoteSelect` | `{ voteIndex, optionIndex }` |
| `interactionScoreSelect` | `{ scoreIndex, value }` |
| `interactionCardClose` | `{ type, index }` |
| `interactionPositionChange` | `{ type, index, top, left }` |

### 5.11 流媒体

| 事件 | payload |
| --- | --- |
| `streamError` | `{ message?, error? }` |
| `streamQualityChange` | `{ width, height, bitrate? }` |
| `click` | `MouseEvent` |
| `dblclick` | `MouseEvent` |
| `error` | `MediaError` |
| `errorRecovery` | 无 |

### 5.12 监听示例

```ts
// 配置式
new VideoPlayer({
  callbacks: {
    wideScreenChange: ({ isWideScreen }) => console.log("宽屏", isWideScreen),
    timeupdate: (t, d) => console.log(`${t}/${d}`),
  },
});

// 运行时
const off = player.on("displayModeChange", ({ mode }) => console.log(mode));
off(); // 取消订阅
player.once("ended", () => console.log("播放结束"));
```

---

## 6. 插件系统

### 6.1 Plugin 接口

```ts
export interface Plugin {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly options?: PluginOptions;
  install(context: PluginContext): void | Promise<void>;
  uninstall?(): void;
}
```

### 6.2 生命周期

- `install(context)`：播放器 `MOUNTED` 前调用，`context` 提供 `player` / `events`（事件总线）/ 配置。
- `uninstall()`：`uninstallPlugin(name)` 或销毁时调用，清理监听与 DOM。

### 6.3 安装方式

```ts
// 构造期
new VideoPlayer({ plugins: { list: [DanmakuPlugin()] } });

// 运行时
player.use(DanmakuPlugin());
```

### 6.4 内置插件

工厂函数为 PascalCase，**插件名为小写**：

| 工厂 | 插件名 | 配置类型 | API 类型 |
| --- | --- | --- | --- |
| `DanmakuPlugin(config?)` | `'danmaku'` | `DanmakuPluginConfig` | `DanmakuPluginAPI` |
| `SubtitlePlugin(config?)` | `'subtitle'` | `SubtitlePluginConfig` | `SubtitlePluginAPI` |
| `InteractionPlugin(config?)` | `'interaction'` | `InteractionPluginConfig` | `InteractionPluginAPI` |
| `createHlsPlugin(config?)` | `'hls'` | `HlsPluginConfig` | `HlsPlugin` |
| `createDashPlugin(config?)` | `'dash'` | `DashPluginConfig` | `DashPlugin` |
| `createFlvPlugin(config?)` | `'flv'` | `FlvPluginConfig` | `FlvPlugin` |

### 6.5 DanmakuPlugin

```ts
import { DanmakuPlugin } from "@lumina/plugins";
import type { DanmakuPluginAPI } from "@lumina/plugins";

DanmakuPlugin({
  callbacks: {
    onSend: async (danmaku) => { /* 提交到后端 */ return true; },
    onSendSuccess: (danmaku) => {},
    onSendError: (err, danmaku) => {},
  },
});
```

`DanmakuPluginAPI`（经 `player.getPlugin<DanmakuPluginAPI>('danmaku')` 获取）：

| 方法 | 签名 |
| --- | --- |
| `getManager` | `() => DanmakuManager \| null` |
| `loadDanmaku` | `(list: DanmakuItem[]) => void` |
| `setVisible` | `(visible: boolean) => void` |
| `send` | `(danmaku: DanmakuItem) => void` |
| `sendBatch` | `(danmakus: DanmakuItem[]) => void` |
| `play` / `pause` / `stop` / `clear` | `() => void` |
| `setOpacity` | `(opacity: number) => void` |
| `setSpeed` | `(speed: DanmakuSpeed) => void` |
| `setFontSize` | `(size: DanmakuFontSize) => void` |
| `setArea` | `(area: DanmakuArea) => void` |
| `setRenderMode` | `(mode: RenderMode) => void` |
| `setScreenMode` | `(mode: ScreenMode) => void` |

#### 6.5.1 弹幕智能防挡（`danmaku.mask`）

用户在弹幕设置面板勾选「智能防挡」后生效（开关持久化于 `danmakuSettings.maskEnabled`，默认关闭）。两种模式按优先级自动选择：

```ts
new VideoPlayer({
  danmaku: {
    mask: {
      // 方式一（优先）：外部遮罩 provider —— 播放器按更新间隔调用，
      // 返回当前时间的镂空遮罩图（SVG/PNG data URL 或图片 URL）
      provider: async (currentTime) => {
        const { maskImage } = await fetch(`/api/mask?t=${currentTime}`).then(r => r.json());
        return maskImage ? { maskImage } : { maskImage: "", clearMask: true };
      },
      // 方式二：本地语义分割（未配置 provider 时启用）
      localModel: {
        // MediaPipe ImageSegmenter 模型地址（tflite）
        modelUrl: '/mediapipe/models/selfie_multiclass_256x256.tflite',
        threshold: 0.25, // 置信度阈值，默认 0.25
      },
    },
  },
});
```

**本地分割模式的行为**：

- **懒加载**：`danmakuMask` 模块经动态 import 拆为独立 chunk——开发者未配置时不会打包进主包；用户未开启时不会下载模型与 wasm
- **Worker 推理**：MediaPipe ImageSegmenter 在 Web Worker 内运行，自动检测 GPU（WebGL delegate）/ CPU 能力择优，主线程零阻塞、视频播放无卡顿
- **时钟同步**：分割结果带时间戳，stale 帧（已有更新帧在跑）被丢弃，保证遮罩与视频画面同步
- **降级**：模型下载/初始化失败（网络中断、能力不足）静默降级为无遮罩弹幕

**推荐模型**（放到 `public/` 下即可）：

| 模型 | 大小 | 说明 |
| --- | --- | --- |
| `selfie_multiclass_256x256.tflite` | ~5MB | 多分类（背景/头发/皮肤/衣服），人物轮廓最完整，推荐 |
| `selfie_segmenter.tflite` | ~250KB | 二分类（人/背景），最小但轮廓略糙 |

下载地址：`https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`

### 6.6 SubtitlePlugin

```ts
import { SubtitlePlugin } from "@lumina/plugins";

SubtitlePlugin({
  sources: [
    { src: "zh.vtt", lang: "zh", label: "中文", default: true },
    { src: "en.vtt", lang: "en", label: "English" },
  ],
  defaultLang: "zh",
  fontSize: 20,
  color: "#ffffff",
  backgroundColor: "rgba(0,0,0,0.5)",
  strokeColor: "#000000",
  strokeWidth: 1,
  position: "bottom",
  bottomOffset: 40,
});
```

`SubtitlePluginAPI`：

| 方法 | 签名 |
| --- | --- |
| `load` | `(source: SubtitleSource) => Promise<void>` |
| `unload` | `() => void` |
| `show` / `hide` / `toggle` | `() => void` / `() => boolean` |
| `setStyle` | `(style: SubtitleStyle) => void` |
| `setOffset` | `(offset: number) => void` |
| `getCurrentSubtitle` | `() => SubtitleItem \| null` |
| `seek` | `(time: number) => void` |
| `switchLanguage` | `(lang: string) => Promise<void>` |
| `setVisible` | `(visible: boolean) => void` |
| `setFontSize` / `setColor` / `setBackgroundColor` / `setStroke` | |

#### 6.6.1 字幕样式持久化（语义化存储）

字幕样式经设置面板修改后持久化到 `nova_player_profile.subtitleStyle`，**存储的是语义字段而非 CSS 字符串**（与 `SubtitlePlugin.setStyle` 消费的字段一一对应，避免双重转换偏差）：

```ts
interface SubtitleStyleSettings {
  fontSize?: number;      // 字号（px）
  fontName?: string;      // 字体（CSS font-family 字面量）
  primaryColor?: string;  // 字幕颜色
  outlineColor?: string;  // 描边颜色
  outlineWidth?: number;  // 描边宽度（px）
  bold?: boolean;         // 加粗
  bottomOffset?: number;  // 距底部偏移（px）
}
```

刷新/重建后经构造期合并恢复到 `props.subtitle.style`，由插件直读应用。

#### 6.6.2 本地 AI 语音识别（sherpa-onnx 真实引擎）

本地 ASR（`asr/` 模块）已接入 **sherpa-onnx wasm 真实流式识别引擎**（`engineKind: 'sherpa'`）：VAD 分段 + 推理全部运行在 ASR 专用 Web Worker 内，主线程零阻塞；wasm 运行时（~15MB）与模型文件在开启识别时按需 fetch，未开启零下载。

```ts
SubtitlePlugin({
  sources: [...],
  localAi: {
    engineKind: "sherpa",              // Worker 引擎：'sherpa'（真实）| 'mock'（演示）
    defaultLang: "zh",
    modelBasePath: "/asr/models/zh-14m", // 模型目录
    wasmBasePath: "/asr/wasm",           // wasm 运行时目录
  },
})
```

静态资源（随 demo `public/asr/` 提供，业务侧自建服务分发）：

| 资源 | 文件 | 大小 |
| --- | --- | --- |
| wasm 运行时（`wasmBasePath`） | `sherpa-onnx-wasm-nodejs.js/.wasm`、`sherpa-onnx-asr.js` | ~15MB |
| 中文流式模型（`modelBasePath`） | `sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23`（int8）：`encoder-epoch-99-avg-1.int8.onnx`、`decoder-epoch-99-avg-1.onnx`、`joiner-epoch-99-avg-1.int8.onnx`、`tokens.txt` | ~30MB |

模型下载（HuggingFace 或国内镜像 hf-mirror.com）：
`https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23`

引擎加载为异步（fetch wasm/模型 → MEMFS → 创建识别器），就绪/失败经 `SUBTITLE_AI_STATUS` 事件广播（`loading` → `ready` / `error`，失败自动降级服务端字幕）。备选模型：`sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16`（int8，~40MB，中英混合，需按引擎默认文件名约定放置或扩展 `SherpaAsrEngine`）。

> GPU 说明：sherpa-onnx 的 WebAssembly 运行时为 CPU（wasm SIMD）执行；
> 语义分割（弹幕防挡）的 MediaPipe 模型已支持 GPU（WebGL delegate）自动启用。

### 6.7 InteractionPlugin

```ts
import { InteractionPlugin } from "@lumina/plugins";

InteractionPlugin({
  isEdit: false,
  onLike: () => {},
  onCoin: () => {},
  onCollect: () => {},
  onFollow: () => {},
  onLinkClick: (link) => {},
  onVoteSelect: (voteIndex, optionIndex) => {},
  onScoreSelect: (scoreIndex, value) => {},
  onPositionChange: (event) => {},
  onCardClose: (type, index) => {},
});
```

`InteractionPluginAPI`：`addGuide` / `addLink` / `addVote` / `addScore` / `getContainer` / `closeCard` / `getStatus` / `updateData`。

### 6.8 流媒体插件

`createHlsPlugin` / `createDashPlugin` / `createFlvPlugin`：根据 `src` 自动接管媒体加载，触发 `streamError` / `streamQualityChange` 等事件。流媒体插件私有事件经 `getStreamEventBus()` 订阅（不经播放器总线）。

---

## 7. 插槽机制

### 7.1 控制栏插槽

`config.ui.slots: ControlSlotItem[]`，每项：

```ts
interface ControlSlotItem {
  id: string;                    // 唯一标识，用于 diff/卸载
  position: ControlSlotPosition;
  order?: number;                // 升序，默认 0；同 order 按数组顺序稳定排列
  vnode: VNode | ((ctx: SlotContext) => VNode);
}
```

位置：

| position | 说明 |
| --- | --- |
| `leftEnd` | 左侧按钮组末尾（prev/play/next/time 之后） |
| `rightStart` | 右侧按钮组开头（quality 之前） |
| `rightEnd` | 右侧按钮组末尾（full 之后） |
| `topRight` | 顶部栏右侧（与顶部进度条同层） |
| `bottomCenter` | 底部中央（LeftControls 与 RightControls 之间） |

框架无响应式：列表在挂载期读取一次，运行时变更需通过 `setConfig` 重渲染。插槽 VNode 的生命周期由播放器统一管理（mount/destroy）。

### 7.2 自定义按钮示例

```ts
import { h, defineComponent, useContext } from "@lumina/nova";
import { PlayerContext } from "@lumina/nova";

const SkipIntro = defineComponent(() => {
  const player = useContext(PlayerContext);
  return h(
    "button",
    { class: "my-skip-btn", onClick: () => player?.seekBy(90) },
    "跳过片头 +90s",
  );
});

new VideoPlayer({
  ui: {
    slots: [
      { id: "skip-intro", position: "rightStart", order: 10, vnode: h(SkipIntro, {}) },
    ],
  },
});
```

函数式 vnode（接收 SlotContext，可读取 player/state 动态渲染）：

```ts
{
  id: "current-time",
  position: "topRight",
  order: 0,
  vnode: (ctx) => h("span", {}, `当前：${ctx.player.getCurrentTime().toFixed(1)}s`),
}
```

### 7.3 片尾页面插槽

`config.ending.content?: VNode | ((ctx: SlotContext) => VNode)`，传入即整页替换默认 `Ending` 组件：

```ts
const CustomEnding = defineComponent(() => {
  const player = useContext(PlayerContext);
  return h(
    "div",
    { class: "custom-ending" },
    h("h2", {}, "播放结束"),
    h("button", { onClick: () => { player?.seek(0); void player?.play(); } }, "重新播放"),
  );
});

new VideoPlayer({ ending: { content: () => h(CustomEnding, {}) } });
```

### 7.4 SlotContext

```ts
interface SlotContext {
  player: VideoPlayer;
  state: TypedStateManager<PlayerStateMap>;
}
```

`player` / `state` 任一缺失时，函数式 vnode 跳过渲染（返回 null）。`PlayerContext` 由 `VideoPlayer.render()` 通过 `__providers` 注入，子组件 `useContext(PlayerContext)` 获取。

### 7.5 播放场景：站内 / 外链嵌入

`ui.scene` 控制整棵 UI 的形态，默认 `station`：

| 能力 | `station`（默认） | `embedded`（外链 / iframe） |
|---|---|---|
| 控制栏 | 完整（pip / 宽屏 / 网页全屏 / 设置 / 选集 / 字幕等） | 简化（播放 / 时间 / 弹幕开关+输入框 / 清晰度 / 倍速 / 音量 / 全屏） |
| 播放/暂停覆盖按钮 | ✓ | ✓（居中 50px） |
| 右上角「进入站内」按钮 | ✗ | ✓ |
| 底部悬浮相关推荐条 | ✗ | ✓（显示控制栏时浮出，最多 6 张） |
| 片尾形态 | 710×390 浮层（UP / 功能按钮 / 8 张推荐卡） | 1060×498 整页（标题 / UP / 顶部操作 / 5×2 推荐卡 / 下载与进入站内） |
| 自动连播倒计时 + 取消连播 | ✓（5s，可取消） | ✗（改为进入站内 / 下载客户端） |
| 充电 / 评分 / 稍后再看按钮 | ✓（纯 UI 占位） | ✗ |

外链场景配置：

```ts
new VideoPlayer({
  ui: {
    scene: "embedded",
    embedded: {
      title: "视频标题",
      up: { mid: 123, name: "UP 主", face: "https://...", followed: false },
      related: [
        { aid: 1, bvid: "BV...", title: "推荐标题", pic: "https://...", duration: 125, url: "https://..." },
      ],
      enterUrl: "https://www.bilibili.com/video/BV...",
      downloadUrl: "https://app.bilibili.com/",
    },
  },
});
```

- 推荐 / UP 数据由使用方注入，未提供时只渲染空容器，不臆造数据。
- `station` 场景下若 `playback.pauseAfterEnd=false` 且播放列表存在下一集，片尾第一张推荐卡会出现 5s 倒计时；用户点击「取消连播」会取消自动切集。
- 外链片尾不自动切集，推荐卡 / 「进入哔哩哔哩观看」按 `url` / `enterUrl` 跳转。

**电视剧 / 番剧（OGV）片尾**：`ui.endingStyle: "ogv"` + `ui.ogv` 数据，渲染整页片尾（68×68 封面 / 标题 / 追剧 / 重播 / 好评 / 投币 / 分享 / 5 列 112×148 竖版推荐卡），推荐卡首张同样支持 5s 倒计时与取消连播。

**跳过头尾**：`progress.skipPoints: { introEnd, outroStart }` 会在进度条渲染两个断点圆点；电视剧 / 番剧场景下设置面板显示「跳过头尾」开关，开启后到达断点自动跳过（片头跳至 `introEnd`，片尾切换下一集 / 跳到结尾）。断点可由外部数据源通过 `player.setSkipPoints()` 运行时更新。

**分享面板**：`ui.share: { url, embedCode, qrCodeUrl }`，分享面板会填充视频地址 / 嵌入代码；`qrCodeUrl` 不传时展示占位提示，不绘制假二维码。

**在线演示**：`/demo/ending-demo/index.html` 提供「标准片尾 / 电视剧 OGV / 外链片尾 / 分享面板 / 外链播放中 / 设置-跳过头尾 / 进度条断点」一键切换。

---

## 8. h 函数 / VNode / defineComponent 用法

### 8.1 h

```ts
h(tag: string | Component, attrs?: VNodeAttrs, ...children: VNodeChild[]): VNode;
```

```ts
// 原生元素
h("div", { class: "box", style: { color: "red" } }, "文本", h("span", {}, "子"));

// 事件
h("button", { onClick: (e: Event) => {}, onInput, onKeyDown }, "点击");

// 组件
h(MyComponent, { prop1: "a", onSomething: (payload) => {} });

// ref
h("input", { ref: "myInput" });                          // 字符串模板引用
h("input", { ref: { current: null } });                  // 旧 {current} 对象
h("input", { ref: someSignal });                         // Signal

// 列表
h("ul", {}, ...each(items, (item) => h("li", { key: String(item.id) }, item.text)));

// 条件
h("div", {}, when(condition, h("span", {}, "显示")));

// Fragment
h(Fragment, {}, child1, child2);
```

`VNodeAttrs` 支持 `ref` / `class` / `style` / 任意 HTML 属性与 `onXxx` 事件、`key`、`directives` 等。

### 8.2 defineComponent

```ts
interface MyProps { count: number }
interface MyEvents { changed: { value: number } }

const MyComp = defineComponent<MyProps, MyEvents>((props, lifecycle) => {
  const inputRef = useTemplateRef<HTMLInputElement>(lifecycle, "inputRef");

  lifecycle.onMounted = () => {
    // 挂载后通过 inputRef.value 访问 DOM
    lifecycle.expose?.({ focus: () => inputRef.value?.focus() });
  };

  return h("input", { ref: "inputRef", onInput: (e: Event) => {
    if (e.target instanceof HTMLInputElement) lifecycle.emit?.("changed", { value: e.target.valueAsNumber });
  } });
});
```

生命周期钩子：`onBeforeMount` / `onMounted` / `onBeforeDestroy` / `onDestroyed`。`lifecycle.el` 为组件根 DOM 元素。`expose` 暴露 API 供父组件 ref 读取。

### 8.3 Context

```ts
const ThemeCtx = createContext<Theme>({ color: "red" });

const Parent = defineComponent(() =>
  h("div", {}, provide([{ contextId: ThemeCtx.id, value: { color: "blue" } }], () => h(Child, {})))
);

const Child = defineComponent(() => {
  const theme = useContext(ThemeCtx); // { color: "blue" }
  return h("div", { style: { color: theme.color } }, "子");
});
```

### 8.4 useState（手动 DOM 更新）

框架无响应式，`useState` 订阅 `TypedStateManager` 的状态变化，回调中手动操作 DOM：

```ts
lifecycle.onMounted = () => {
  useState(stateMgr, "current_time", (time: number) => {
    if (timeRef.value) timeRef.value.textContent = time.toFixed(1);
  }, lifecycle);
};
```

---

## 9. 持久化机制

### 9.1 主键

`nova_player_profile`（JSON 对象），由 `createPlayerStore({ persist: true })` 管理：

```json
{
  "volume": 0.8,
  "isMuted": false,
  "playbackRate": 1,
  "codecPreferType": 0,
  "userPreferences": {
    "autoplay": false,
    "autoQuality": true,
    "skipOpEd": false,
    "defaultVolume": 0.8,
    "defaultPlaybackRate": 1,
    "danmaku": { "enabled": true, "opacity": 1, "fontSize": 1, "density": "normal", "blockTypes": [] },
    "subtitle": { "enabled": true, "language": "zh-CN", "fontSize": 1, "opacity": 1, "backgroundOpacity": 0.5 }
  }
}
```

### 9.2 独立键清单

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `nova_player_profile` | JSON | 主配置（见上） |
| `nova_player_codec_prefer_type` | `number` | 编解码器偏好 |
| `nova_player_codec_prefer_reset` | `number` | 编解码器重置版本 |
| `nova_player_gpu_renderer` | `string` | GPU 渲染器信息 |
| `nova_player_playback_info` | `object` | 播放信息 |
| `nova_player_version` | `string` | 播放器版本（数据迁移用） |
| `nova_player_pbp_height` | `number` | 进度条高度 |
| `nova_player_pbp_opacity` | `number` | 进度条不透明度 |
| `nova_player_pbp_pin` | `boolean` | 进度条固定 |
| `nova_player_pbp_theme` | `string` | 进度条主题 |
| `nova_player_pbp_version` | `number` | 进度条版本 |
| `nova_player_pbp_state` | `boolean` | 进度条开关 |
| `nova_player_pbp_state_clear` | `boolean` | 进度条清晰状态 |

弹幕/字幕/交互设置由各自插件管理（`nova_player_danmaku` / `nova_player_subtitle` / `nova_player_interaction`）。

### 9.3 进度记忆

按源 URL 记忆，键格式 `${storage.prefix}progress:${src}`，默认前缀 `nova-player:`，即 `nova-player:progress:https://...`。播放结束时清除该源进度，下次从头播放。

### 9.4 数据流

```
页面加载 → createPlayerStore()
  ├─ 读取 nova_player_profile → 解析 JSON → 合并默认值 → 内存
  ├─ 读取 nova_player_codec_prefer_type → 覆盖（独立 key 优先）
  └─ 不存在 → 写入默认 profile

用户操作 → store.setVolume(0.5)
  ├─ 更新内存 persistentState.volume
  ├─ 通知订阅了 'volume' 的监听器
  └─ 整个 persistentState 写回 nova_player_profile
```

### 9.5 关闭持久化

```ts
new VideoPlayer({ storage: { enabled: false } });
```

---

## 10. SSR 用法

### 10.1 服务端渲染

```ts
import { createSSRPlayer, renderToString } from "@lumina/nova";

const player = createSSRPlayer({
  src: "https://example.com/video.mp4",
  ssr: { enabled: true },
});

const html = renderToString(player.render());
// 将 html 注入到页面模板的占位符
```

`createSSRPlayer` 是 `new VideoPlayer({ ssr: { enabled: true } })` 的便捷封装；构造函数 SSR 安全，不访问 DOM。

### 10.2 客户端水合

```ts
const player = createSSRPlayer({
  src: "https://example.com/video.mp4",
  ssr: { enabled: false }, // 客户端无需 SSR 模式
});

const container = document.getElementById("player")!;
player.hydrate(container); // 与已有 DOM 匹配，绑定事件/ref/生命周期
```

### 10.3 配置占位符

`ssr.placeholder` 用于首屏占位 HTML（默认 `<div class="nova-player-placeholder">视频加载中...</div>`）；`ssr.deferHydration` 控制是否延迟水合。

完整 SSR demo 见 [`demo/`](../demo)（`main.ts` + `entry-server.ts` + `entry-client.ts` + `server.mjs`），包含 `VideoPlayer` 原生 SSR 集成与水合检测。

---

## 11. 完整示例

综合 demo 见 [`demo/player-demo/main.ts`](../demo/player-demo/main.ts)，覆盖：

1. 通过 `plugins.list` 注入 `DanmakuPlugin` / `SubtitlePlugin` / `InteractionPlugin` / `createHlsPlugin`
2. `ui.slots` 在 `rightStart` 位置注入倍速预设按钮（`useContext(PlayerContext)` 调用 `setPlaybackRate`）
3. `ending.content` 整页替换默认片尾组件
4. `callbacks` 配置式订阅 `play` / `pause` / `ended` / `timeupdate` / `wideScreenChange` / `webFullscreenChange` / `displayModeChange` / `danmakuToggle` / `subtitleToggle`
5. `player.on` 运行时订阅（与 callbacks 并存）
6. `player.getPlugin<T>('name')` 调用 `loadDanmaku` / `setStyle` 等插件 API

核心片段：

```ts
const player = new VideoPlayer({
  container: "#demo-player",
  src: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  ui: {
    controls: { ...defaultControlConfig },
    slots: [{ id: "rate-presets", position: "rightStart", order: 10, vnode: h(RatePresets, {}) }],
  },
  ending: { content: () => h(CustomEnding, {}) },
  plugins: {
    list: [DanmakuPlugin(), SubtitlePlugin({ sources: [...] }), InteractionPlugin({ isEdit: false }), createHlsPlugin()],
  },
  callbacks: {
    play: () => log("play"),
    timeupdate: (t, d) => log(`${t}/${d}`),
    wideScreenChange: ({ isWideScreen }) => log(`宽屏 ${isWideScreen}`),
  },
});

player.mount(document.getElementById("demo-player")!);
player.getPlugin<DanmakuPluginAPI>("danmaku")?.loadDanmaku(sampleList);
player.getPlugin<SubtitlePluginAPI>("subtitle")?.setStyle({ fontSize: 24 });
```

---

## 12. FAQ / 常见问题

### Q1：未注册 `DanmakuPlugin` 时弹幕 UI 会显示吗？

不会。`PlayerDocker` 通过 `props.plugins.danmaku === true` 显式 opt-in 渲染弹幕相关 UI（`SendBar` / `DmSetting` / `RowDm` / 弹幕按钮）；`VideoPlayer.render()` 计算 `!!this.pluginManager?.get('danmaku')` 注入。字幕与交互层同理。

### Q2：插件名为什么是小写？

`DanmakuPlugin.name === 'danmaku'`，`SubtitlePlugin.name === 'subtitle'`，`InteractionPlugin.name === 'interaction'`，`HlsPlugin.name === 'hls'`。工厂函数名为 PascalCase（`DanmakuPlugin()`），但 `getPlugin<T>(name)` 传入小写名。

### Q3：框架有响应式吗？

没有。状态变化后需手动操作 DOM（通过 `useState` 订阅 `TypedStateManager`，回调中更新 `lifecycle.el` 或 `useTemplateRef` 引用）。插槽列表在挂载期读取一次，运行时变更需 `setConfig` 重渲染。

### Q4：`callbacks` 与 `player.on` 有什么区别？

二者都订阅 `PlayerEvents`，键名一致（camelCase）。`callbacks` 是构造期配置式订阅；`player.on` 是运行时订阅，返回取消函数。同一事件可被两种方式同时接收。

### Q5：`as` 类型断言为什么被禁用？

项目 TypeScript 严格规范：禁止 `as` 断言（`utils/index.ts` 的 `once` / `deepMerge` 除外）。`event.target` 用 `instanceof` 收窄，类型谓词函数（`value is T`）替代 `as`，`null as Type | null` 改为 `{ current: Type | null } = { current: null }`。`as const` 与 `import { X as Y }` 重命名允许。

### Q6：如何自定义画质文案？

```ts
new VideoPlayer({
  src: "video.m3u8",
  quality: { labels: { "80": "720P", "112": "1080P" } },
});
```

### Q7：进度记忆不生效？

检查 `storage.enabled` 是否为 `true`（默认），以及 `src` 是否稳定（进度键按 `src` 索引）。播放结束会清除该源进度。

### Q8：SSR 模式下 `mount` 会执行吗？

`createSSRPlayer` 在服务端只创建实例，`mount` 不调用；客户端调用 `hydrate(container)` 与服务端输出 HTML 匹配。

### Q9：如何禁用快捷键？

```ts
new VideoPlayer({ interaction: { keyboard: false } });
// 或对象形式配置步长
new VideoPlayer({ interaction: { keyboard: { seekStep: 10, volumeStep: 0.1, holdRate: 2 } } });
```

### Q10：流媒体插件事件如何订阅？

流媒体插件私有事件经 `getStreamEventBus()` 订阅（不经播放器总线）：

```ts
const hls = player.getPlugin<HlsPlugin>("hls");
// hls.getStreamEventBus().on(StreamPluginEventEnum.STREAM_STATS_UPDATE, ...)
```

公共事件（`streamError` / `streamQualityChange`）仍走 `player.on`。

---

> 本文档与代码同步维护。如发现 API 与实际不符，以 [`packages/player/src/`](../packages/player/src) 与 [`packages/plugins/src/`](../packages/plugins/src) 源码为准。
