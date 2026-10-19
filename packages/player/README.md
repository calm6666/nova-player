# @lumina/nova

> hili-player 自研框架驱动的视频播放器。插件按需渲染 + 控制栏插槽 + 完整事件回调 + 持久化 + SSR 原生支持。

完整 API 文档见 [`docs/api.md`](../../docs/api.md)。本 README 仅作索引。

## 安装

```bash
pnpm add @lumina/nova @lumina/plugins
```

播放器依赖 `hls.js`（fork 版本随仓库发布），响应式内核 signalsCore 已自研内置，无需额外安装。

## 快速开始

```ts
import { VideoPlayer } from "@lumina/nova";

const player = new VideoPlayer({
  container: "#player",
  src: "https://example.com/video.m3u8",
  playback: { autoplay: false, volume: 1 },
});

player.mount(document.querySelector("#player")!);
```

完整可运行示例见 [`demo/player-demo/`](../../demo/player-demo)。

## 配置概览

`PlayerConfig` 顶层只保留资源类三项（`container` / `src` / `poster`），其余按功能分组为命名空间，深度合并默认值。

| 命名空间 | 说明 |
| --- | --- |
| `playback` | 播放行为：autoplay / muted / volume / playbackRate / loop / playMode / preload / playsinline / startTime |
| `playlist` / `playlistIndex` | 播放列表与起始下标 |
| `ui` | 标题 `title`、控件开关 `controls`、控制栏插槽 `slots` |
| `interaction` | 快捷键：布尔或 `KeyboardStepConfig` |
| `quality` | 默认档位 / 选择模式 / 上下限 / 自定义文案 |
| `progress` | 进度条分段 `segments` |
| `danmaku` / `subtitle` | 兼容旧调用方的可选字段；运行时能力由 `DanmakuPlugin` / `SubtitlePlugin` 提供 |
| `plugins` | `list: Plugin[]` + `options` |
| `ending` | 片尾页面插槽 `content` |
| `storage` | 持久化开关与键前缀 |
| `ssr` | SSR 模式 / 占位符 / 延迟水合 |
| `advanced` | 日志级别 / 调试模式 |
| `callbacks` | 配置式事件回调，键名与 `PlayerEvents` 一致 |

字段全量表与默认值见 [`docs/api.md` §3](../../docs/api.md#3-playerconfig-全字段表)。

## 事件列表（速查）

监听两种方式：

```ts
// 1. 配置式回调（构造时传入）
new VideoPlayer({ callbacks: { play: () => {}, timeupdate: (t, d) => {} } });

// 2. 运行时订阅
player.on("wideScreenChange", (payload) => {});
player.once("ended", () => {});
const off = player.on("play", () => {}); off(); // 取消
```

常用事件：`ready` / `play` / `pause` / `ended` / `timeupdate` / `volumechange` / `ratechange` / `qualitychange` / `fullscreenchange` / `webFullscreenChange` / `wideScreenChange` / `displayModeChange` / `danmakuToggle` / `subtitleToggle` / `error` / `mounted` / `destroy`。

全事件表（payload + 触发时机）见 [`docs/api.md` §5](../../docs/api.md#5-全事件表)。

## 宽屏（外部容器驱动）

宽屏布局完全由播放器**外部容器**决定。控制栏宽屏按钮点击 / `toggleWideScreen()` 只做两件事：

1. 更新内部宽屏状态（宽屏按钮高亮、图标随状态切换）；
2. 广播 `wideScreenChange`，回调参数为是否宽屏的布尔值。

播放器不修改 `data-screen`、不搬移发送栏，由外部监听后自行调整容器布局：

```ts
player.on("wideScreenChange", ({ isWideScreen }) => {
  appContainer.classList.toggle("is-wide", isWideScreen);
});

// 也可以主动同步外部容器状态：
player.setWideScreen(true);   // 只更新状态 + 广播事件
player.isWideScreen();        // 读取当前宽屏状态
```

> `setDisplayMode("wide")` 等价于 `setWideScreen(true)`；`setDisplayMode("normal" | "web" | "mini")` 仍由播放器内部处理，并在退出宽屏时先广播 `wideScreenChange(false)`。

## API 速查表

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `mount` | `(container: HTMLElement) => void` | 挂载播放器到 DOM |
| `destroy` | `() => void` | 销毁实例，清理监听与 DOM |
| `play` / `pause` / `toggle` | `() => Promise<void>` / `() => void` | 播放控制 |
| `seek` / `seekBy` | `(time: number) => void` | 跳转 |
| `setVolume` / `getVolume` | `(v: number) => void` / `() => number` | 音量 0-1 |
| `setMuted` / `toggleMute` / `isMuted` | | 静音 |
| `setPlaybackRate` / `getPlaybackRate` | | 倍速 |
| `setQuality` / `getQuality` / `getQualities` | | 清晰度 |
| `setQualityMode` / `getQualityMode` | | auto / manual |
| `toggleFullscreen` / `enterFullscreen` / `exitFullscreen` / `isFullscreen` | | 全屏 |
| `toggleWebFullscreen` / `isWebFullscreen` | | web 全屏 |
| `toggleWideScreen` / `setWideScreen` / `isWideScreen` | | 宽屏（状态 + 回调，布局由外部容器决定） |
| `setDisplayMode` | | 显示模式（`wide` 仅广播事件，布局由外部容器决定） |
| `setDanmakuVisible` / `getDanmakuVisible` / `toggleDanmaku` | | 弹幕显隐 |
| `setDanmakuOpacity` / `setDanmakuSpeed` / `setDanmakuSource` / `clearDanmaku` / `sendDanmaku` | | 弹幕 API |
| `setSubtitleVisible` / `getSubtitleVisible` / `toggleSubtitle` / `setSubtitleLang` / `setSubtitleList` | | 字幕 API |
| `use` / `uninstallPlugin` / `getPlugin<T>` / `getPluginAPI<T>` | | 插件管理 |
| `getConfig` / `setConfig` | | 配置读写（`setConfig` 支持深层可选） |
| `getPlaylist` / `getCurrentIndex` / `switchTo` / `next` / `prev` | | 播放列表 |
| `setPoster` | | 封面 |
| `getCurrentTime` / `getDuration` / `getBuffered` / `isPaused` / `isPlaying` / `getState` | | 状态查询 |
| `resize` | | 触发 resize 事件 |
| `hydrate` | `(container: HTMLElement) => void` | SSR 水合 |
| `on` / `once` / `off` | | 事件订阅 |

全方法签名 + 示例见 [`docs/api.md` §4](../../docs/api.md#4-videoplayer-全公开方法表)。

## 插件

```ts
import { DanmakuPlugin, SubtitlePlugin, InteractionPlugin, createHlsPlugin } from "@lumina/plugins";

const player = new VideoPlayer({
  src: "video.m3u8",
  plugins: {
    list: [
      DanmakuPlugin(),
      SubtitlePlugin({ sources: [{ src: "zh.vtt", lang: "zh", label: "中文" }] }),
      InteractionPlugin({ isEdit: false }),
      createHlsPlugin(),
    ],
  },
});

// 运行时调用插件 API（插件名为小写）
player.getPlugin<DanmakuPluginAPI>("danmaku")?.loadDanmaku(list);
player.getPlugin<SubtitlePluginAPI>("subtitle")?.setStyle({ fontSize: 24 });
```

插件接口、生命周期、各内置插件配置 + API 见 [`docs/api.md` §6](../../docs/api.md#6-插件系统)。

## 插槽

控制栏插槽走「配置数组 + 位置/顺序」，片尾页面走「整页替换」：

```ts
import { h, defineComponent, useContext } from "@lumina/nova";
import { PlayerContext } from "@lumina/nova";

const MyButton = defineComponent(() => {
  const player = useContext(PlayerContext);
  return h("button", { onClick: () => player?.seek(60) }, "跳 60s");
});

new VideoPlayer({
  ui: {
    slots: [{ id: "my-btn", position: "rightStart", order: 10, vnode: h(MyButton, {}) }],
  },
  ending: { content: () => h(CustomEnding, {}) },
});
```

位置：`leftEnd` / `rightStart` / `rightEnd` / `topRight` / `bottomCenter`。详见 [`docs/api.md` §7](../../docs/api.md#7-插槽机制)。

## 持久化

默认启用，主键 `nova_player_profile`（JSON），独立键 `nova_player_codec_prefer_type` / `nova_player_pbp_*` 等，进度键 `nova-player:progress:${src}`。详见 [`docs/api.md` §9](../../docs/api.md#9-持久化机制)。

## SSR

```ts
import { createSSRPlayer, renderToString } from "@lumina/nova";

const player = createSSRPlayer({ src: "video.mp4", ssr: { enabled: true } });
const html = renderToString(player.render());
// 客户端：player.hydrate(containerEl);
```

详见 [`docs/api.md` §10](../../docs/api.md#10-ssr-用法)。
