# nova-player

> 极简 TypeScript 视频播放器 —— 基于自研「零 diff」框架构建，视觉与交互对齐哔哩哔哩播放器。

`nova-player` 是一个从零实现的 Web 视频播放器。它不依赖任何 UI 框架，没有虚拟 DOM diff：
挂载期把 VNode 一次性物化为真实 DOM，运行期由自研 Signals 做依赖收集与精准节点更新。
播放器本体、弹幕、字幕、HLS / DASH / FLV 流媒体与互动插件
拆分在两个包中，可以整体引入，也可以按需使用。

- 纯 TypeScript，`strict` 全开，零 `any` 债
- 核心与包代码约 **4.9 万行 TypeScript** + 约 **0.9 万行 SCSS**
- `packages/player` 导出 ESM + UMD 双格式，附带完整 `.d.ts`

---

## 特性

| 能力 | 说明 |
| --- | --- |
| **Signal 响应式运行时** | 挂载期由 `h()` 生成 VNode，一次性 `materialize` 成真实 DOM；运行期由自研 Signals 做依赖收集与精准 DOM 更新——无虚拟 DOM diff、无整树重渲染，性能关键逐帧场景保留命令式路径 |
| **编译期优化** | `vite-plugin-lumina-compile` 用 babel + MagicString 把 `h()` 改写为 `_createEl` / `_createStaticEl` / `_createSvgEl` / `_createFragment` / `_createComp`，自动包装响应式属性（`__reactiveAttrs`，class/style 支持对象与数组格式）与响应式文本（`() => expr` 显式 getter 协议 → `_reactiveText`），生产构建额外做静态子树 DOM 化（`tmplStatic`）与静态提升（`_cloneHoisted`）；dev 模式零开销 |
| **三套流媒体** | HLS（fork 版 hls.js，独立子模块仓库 `packages/plugins/hls`，支持 URL 与清单对象注入）、DASH（dashjs）、FLV（flv.js） |
| **完整画质链路** | 原生多文件 / HLS / DASH 三源统一档位模型；`auto` / `manual` 双模式、ABR、切换生命周期（requested → rendered / failed，10s 超时兜底） |
| **弹幕双引擎** | DOM 与 Canvas 可切换，含轨道管理、对象池、增量调度与预取 |
| **弹幕智能防挡** | 外部遮罩 provider 或本地语义分割（MediaPipe ImageSegmenter，Web Worker + GPU delegate，懒加载不阻塞主线程），开关持久化 |
| **字幕** | SRT / ASS / WebVTT 解析与渲染；样式语义化持久化 |
| **互动插件** | 引导 / 投票 / 评分 / 外链四个子插件，二分查找 + 增量 diff，编辑态拖拽 |
| **播放器 SSR + Hydration** | 服务端直接输出完整播放器 HTML（控制栏 / 视频区 / 状态层），客户端 `hydrate()` 复用 DOM；插件在浏览器侧增量安装 |
| **播放列表** | 换源复用同一个 `video` 元素与整棵 DOM |
| **37 个 UI 组件** | 控制栏、进度条、音量、画质菜单、弹幕设置、快捷键面板、迷你播放器等，图标走 Lottie 动画系统 |
| **持久化** | 音量 / 静音 / 倍速 / 画质偏好 / 进度条偏好（localStorage） |

---

## 环境要求

| 依赖 | 版本 |
| --- | --- |
| Node.js | 20+（开发环境实测 22.20） |
| pnpm | 9（`packageManager: pnpm@9.0.0`） |
| TypeScript | 6 |

仓库使用 pnpm workspace，请勿用 npm / yarn 安装。

---

## 目录结构

```
nova-player/
├── core/                       # 自研框架（Signal 响应式 + 零 VDOM diff）
│   ├── h.ts                    #   h() / defineComponent / Fragment / when / each
│   ├── mount.ts                #   mount / materialize / applyAttrs / destroy / hydrate
│   ├── flow.ts                 #   Show / For 控制流（生命周期补发与卸载重挂）
│   ├── signals.ts  signalsCore.ts  #   自研 Signals（依赖收集 / effect / onEffect）
│   ├── internal.ts             #   编译期改写目标（_createEl 等）
│   ├── ssr.ts                  #   renderToString
│   ├── state.ts  eventBus.ts  hooks.ts  context.ts  ref.ts  templateRef.ts
│   ├── reactiveProps.ts  i18n.ts
│   └── warning.ts  normalize.ts
├── types/                      # 全局类型契约
│   ├── index.ts                #   PlayerConfig / PlayerEvents / PlayMode / MediaItem …
│   ├── streamPlugin.ts         #   流媒体插件契约（QualityLevel / MediaManifestSource）
│   └── plugin.ts  danmaku.ts  subtitle.ts  callbacks.ts
├── utils/  directives/  events/  error/     # 工具、指令、事件、错误处理
├── locales/                    # 应用层语言包（core 不再内置 JSON）
├── packages/
│   ├── player/                 # @lumina/nova —— 播放器本体
│   │   ├── media/              #   媒体工具库参考实现（监控器 / SVG 图表 / 信息面板，不参与编译）
│   │   └── src/
│   │       ├── player/VideoPlayer.ts   # 核心类
│   │       ├── components/             # 37 个 UI 组件
│   │       ├── store/                  # PlayerStore / runtimeState / ConfigStore
│   │       ├── config/                 # defaultConfig / mergeConfig / normalizeConfig
│   │       ├── core/                   # plugin / pluginManager / hotkeys
│   │       ├── utils/                  # media 监控、浏览器能力检测、tooltip
│   │       ├── types/                  # 播放器侧类型
│   │       └── styles/                 # 25 个 SCSS
│   └── plugins/                # @lumina/plugins —— 官方插件集合
│       ├── hls/                #   fork 版 hls.js 独立仓库（git submodule，双远程独立维护）
│       └── src/
│           ├── danmaku/        #   DanmakuPlugin + DOM / Canvas 引擎
│           ├── subtitle/       #   SubtitlePlugin + SRT / ASS / VTT 解析
│           ├── hls/  dash/  flv/       # 三个流媒体插件（含 vendor 适配层）
│           ├── interaction/    #   Guide / Vote / Score / Link 子插件
│           ├── vendor/         #   清单解析（HLS / DASH）
│           └── stream/         #   流媒体插件共享类型与枚举
├── plugins/vite-plugin-lumina-compile/   # 编译期 h() 改写插件
├── demo/  demo-prod/           # SSR + Hydration 演示（含 Express 服务端）
└── docs/                       # API 参考文档（api.md 播放器 / framework-api.md 框架）
```

### 代码规模

| 模块 | 文件 | 行数 |
| --- | --- | --- |
| `core/`（框架） | 15 | 4,152 |
| `packages/player/src` | 70 | 20,520 |
| `packages/plugins/src` | 54 | 17,467 |
| `plugins/vite-plugin-lumina-compile` | 4 | 939 |
| `types` / `utils` / `error` / `events` / `directives` | 21 | 5,342 |
| `packages/player/media`（参考媒体工具库） | 5 | 2,102 |
| `packages/player/src/styles`（SCSS） | 25 | 9,113 |

---

## 快速开始

```bash
# 克隆后先拉取 hls.js 子模块（packages/plugins/hls，独立 fork 仓库）
git submodule update --init

# 安装依赖
pnpm install

# 启动 SSR demo（默认 http://localhost:5174）
pnpm demo:ssr

# 启动纯客户端 demo（默认 http://localhost:5175）
pnpm demo:csr

# 类型检查 / 代码检查 / 测试
pnpm typecheck
pnpm lint
pnpm test

# 构建两个包（player → plugins）
pnpm build
pnpm build:player
pnpm build:plugins
```

`demo/` 提供两个入口：`pnpm demo:ssr` 使用 `demo/server.mjs` 做服务端渲染 + 水合；
`pnpm demo:csr` 使用 Vite 启动纯客户端渲染。两者共用同一套页面与插件演示控制。

---

## 使用

### 基础用法

```ts
import { VideoPlayer } from '@lumina/nova';
import '@lumina/nova/style.css';

const player = new VideoPlayer({
  src: 'https://example.com/video.mp4',
  poster: 'https://example.com/poster.jpg',
  playback: {
    autoplay: false,
    muted: false,
    volume: 0.8,
    loop: false,
    playMode: PlayMode.ORDER,
  },
});

// 挂载到容器（注意：mount 接收 HTMLElement，不是选择器字符串）
player.mount(document.getElementById('player-container')!);
```

### 配置（命名空间形态）

顶层只保留**资源类三项**（`container` / `src` / `poster`），其余按功能分组，便于深度合并与运行时动态更新：

```ts
const player = new VideoPlayer({
  src, poster,

  playback:    { autoplay: true, muted: true, volume: 0.8, playbackRate: 1, loop: false, playMode: PlayMode.REPEAT_ALL },
  playlist:    [{ src: 'a.mp4', title: '第一话' }, { src: 'b.mp4', title: '第二话' }],
  playlistIndex: 0,

  ui:          { controls: { quality: true, episodes: true, pip: true, wideScreen: true } },
  interaction: { keyboard: true },
  quality:     { mode: 'auto' },
  progress:    { segments: [{ startTime: 0, endTime: 90, label: 'OP' }], shadowPermanent: true },
  subtitle:    { enabled: true, list: [{ lang: 'zh-CN', label: '中文', url: '/sub/1.vtt', isDefault: true }] },
  plugins:     { /* ... DanmakuPlugin({ source: { provider } }) ... */ },
  storage:     { /* ... */ },
  advanced:    { debug: false },
  callbacks:   { ready: () => console.log('ready') },
});
```

> 历史版本的扁平配置（`autoplay` / `volume` / `controls` / `controlBtns` …写在顶层）仍可通过内置兼容层
> `normalizeConfig()` 使用，开发环境会打印一次性迁移提示。新代码请一律使用命名空间形态。

### 国际化

`core` 只提供 i18n 机制，不再内置任何语言 JSON；语言包属于应用层，由使用方注册：

```ts
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

const player = new VideoPlayer({
  i18n: {
    enabled: true,
    locale: 'zh-CN',
    fallbackLocale: 'en-US',
    messages: { 'zh-CN': zhCN, 'en-US': enUS },
  },
});
```

仓库的语言包位于根目录 `locales/`，demo 通过 `@/locales/*.json` 引用。

### 多清晰度（仅原生 MP4 需要手填）

```ts
const player = new VideoPlayer({
  src: [
    { url: 'video-1080p.mp4', height: 1080, label: '1080P' },
    { url: 'video-720p.mp4',  height: 720,  label: '720P'  },
    { url: 'video-480p.mp4',  height: 480,  label: '480P'  },
  ],
});
```

> HLS / DASH 的档位由清单在运行时发现，**不要手填**，改用下面的插件传清单对象。

### 插件

```ts
import { VideoPlayer } from '@lumina/nova';
import {
  DanmakuPlugin, SubtitlePlugin, HlsPlugin, DashPlugin, FlvPlugin, InteractionPlugin,
} from '@lumina/plugins';

const player = new VideoPlayer({ src: 'video.m3u8' });

player.use(DanmakuPlugin({ options: { debug: false } }));
player.use(SubtitlePlugin({
  sources: [{ src: '/sub/1.vtt', lang: 'zh-CN', label: '中文', default: true }],
  defaultLang: 'zh-CN',
  position: 'bottom',
}));
player.use(HlsPlugin({ autoplay: true, startLevel: -1 }));
player.use(InteractionPlugin({ isEdit: false }));

player.mount(el);
```

插件支持运行期动态注册 / 卸载，UI 由响应式 flags 自动同步：

```ts
player.registerPlugin(DanmakuPlugin({ options: { debug: false } }));
player.unregisterPlugin('danmaku'); // 对应图层、控制栏入口自动移除
player.hasPlugin('danmaku');
```

`use()` / `uninstallPlugin()` 是等价旧 API；SSR 阶段会跳过插件 `install()`，
客户端水合后再动态注入，避免在 Node 中访问 DOM。

弹幕的字号 / 透明度 / 速度 / 区域 / 渲染模式有两种调整途径：构造时走播放器配置的 `danmaku`
命名空间，或运行时调用播放器与插件的 API（`player.setDanmakuOpacity()`、`DanmakuPluginAPI.setRenderMode()` 等）。
`DanmakuPlugin()` 自身的配置只有 `{ options, callbacks }`。

清单对象注入（跳过 URL 探测，直接把解析好的清单喂给播放器）：

```ts
import { HlsPlugin, DashPlugin } from '@lumina/plugins';

// 清单对象作为 src 传入（MediaManifestSource），插件按类型谓词自动识别
const player = new VideoPlayer({ src: parsedManifest });

player.use(HlsPlugin());   // 或 DashPlugin()
player.mount(el);
```

### 事件

`on()` / `once()` 返回**取消订阅函数**：

```ts
const off = player.on('timeupdate', (currentTime, duration) => {
  console.log(`${currentTime} / ${duration}`);
});

player.once('ready', () => console.log('ready'));

off();                          // 取消订阅
player.off('timeupdate', handler); // 或按引用取消
```

`PlayerEvents` 覆盖：`ready` `play` `pause` `ended` `timeupdate` `volumechange` `ratechange`
`qualitychange` `fullscreenchange` `pipchange` `waiting` `canplay` `progress` `error` `statechange`
`click` `dblclick`，以及 `abort` `durationchange` `emptied` `loadeddata` `loadedmetadata` `loadstart`
`playing` `seeked` `seeking` `stalled` `suspend` 等 HTML5 媒体元素标准事件。

### 动态 API

```ts
// 播放控制
await player.play();
player.pause();
player.toggle();
player.seek(120);
player.seekBy(-5);
player.reload();

// 音量 / 倍速 / 播放模式
player.setVolume(0.5);   player.getVolume();
player.toggleMute();     player.setMuted(true);   player.isMuted();
player.setPlaybackRate(1.5);  player.getPlaybackRate();
player.setLoop(true);
player.setPlayMode(PlayMode.REPEAT_ALL);   // ORDER | REPEAT_ALL | SHUFFLE

// 显示模式
await player.toggleFullscreen();   player.isFullscreen();
await player.enterFullscreen();
await player.exitFullscreen();
await player.togglePip();          player.enterPip();   player.exitPip();
player.toggleWebFullscreen();      player.isWebFullscreen();
// 宽屏：布局由外部容器决定，播放器只更新状态 + 广播 wideScreenChange
player.on('wideScreenChange', ({ isWideScreen }) => {
  appContainer.classList.toggle('is-wide', isWideScreen);
});
player.toggleWideScreen();         player.setWideScreen(true);   player.isWideScreen();
player.setDisplayMode('normal');   // 'normal' | 'web' | 'mini'；'wide' 只广播事件，布局交给外部
player.resize();

// 画质
player.setQuality('1080P');      player.getCurrentQuality();
player.getQualities();           player.setQualityMode('auto' | 'manual');
player.getQualityMode();
player.applyQualityLimits({ max: 1080, min: 360 });

// 播放列表（构造时传入 playlist，运行时复用同一 video 元素与整棵 DOM 导航）
await player.switchTo(1);
await player.next();
await player.prev();
player.getPlaylist();   player.getCurrentIndex();

// 换源
await player.load('another.mp4', { startTime: 30, autoplay: true });

// 弹幕
player.setDanmakuVisible(false);   player.toggleDanmaku();   player.isDanmakuVisible();
player.setDanmakuOpacity(0.5);     player.setDanmakuSpeed(1.5);
player.setDanmakuSource('/dm/1.xml');   player.clearDanmaku();
player.sendDanmaku('前方高能');

// 字幕
player.setSubtitleVisible(true);   player.toggleSubtitle();
player.setSubtitleLang('zh-CN');   player.setSubtitleList(tracks);

// 配置
player.getConfig();                       // Readonly<PlayerConfig>
player.setConfig({ playback: { volume: 0.3 } });   // 深层局部更新
player.setPoster('/new.jpg');

// 进度条（progress 命名空间）
player.progress.applyPermanent(true);     // 展开底部常驻影子进度条
player.progress.applyPermanent(false);    // 收起
player.progress.isPermanent();            // 当前是否常驻展开
player.progress.setSegments(segments);    // 章节 / 顶部 / 影子进度条共用
player.progress.setEnergy(energy);        // 高能进度条数据

// 状态查询
const s = player.getState();   // PlayerStateData 快照
player.getCurrentTime();  player.getDuration();  player.getBuffered();
player.isPaused();        player.isPlaying();    player.isFullscreen();   player.isMuted();

// 生命周期
player.mount(el);         // 挂载
player.render();          // 取客户端 VNode（调试 / 内嵌到自己的客户端 VNode 树）
player.use(plugin);       // 安装插件（可链式）
player.uninstallPlugin('danmaku');
player.destroy();         // 卸载并清理全部监听、插件与订阅
```

### SSR 多源测试 URL

启动 `pnpm demo:ssr` 后，可通过 `src` 查询参数切换服务端首屏与客户端水合使用的媒体源：

```text
# MP4
http://localhost:5174/?src=/sample.mp4

# HLS URL
http://localhost:5174/?src=https%3A%2F%2Fexample.com%2Fvideo.m3u8

# DASH URL
http://localhost:5174/?src=https%3A%2F%2Fexample.com%2Fvideo.mpd

# JSON 清单（URL 编码后传入）
http://localhost:5174/?src=%7B%22type%22%3A%22hls%22%2C%22url%22%3A%22...%22%7D
```

`src` 同时传给服务端 `render(query)` 与客户端水合配置；HLS / DASH 插件按 URL 后缀自动注册。
修改 `demo/server.mjs` 或入口文件后需要重启 SSR server。

### 服务端渲染

播放器支持真正的服务端渲染：`renderToString()` 在 Node 环境直接输出完整播放器 HTML，
客户端使用同一份 `PlayerConfig` 创建实例后通过 `hydrate()` 复用服务端 DOM。

```ts
// 服务端（Node）
const serverPlayer = new VideoPlayer(config);
const html = serverPlayer.renderToString();

// 客户端（浏览器）
const clientPlayer = new VideoPlayer(config);
clientPlayer.hydrate(document.getElementById('player')!);
```

插件安装、媒体源切换、弹幕/字幕等浏览器数据在客户端水合后增量接入；
`VideoPlayer.use()` 在服务端会跳过插件 `install()`，避免访问 `document` / `window`。

章节 / 分段 / 高能曲线不参与 SSR 数据请求；客户端只请求一次后注入：

```ts
player.progress.setSegments(segments); // 章节菜单、顶部/底部进度条共用
player.progress.setEnergy(energy);     // 高能进度条
```

Demo 页面由 `demo/server.mjs` 在服务端把播放器 HTML 注入 `<!--ssr-outlet-->`，
不再输出占位容器。`pnpm demo:ssr` 启动 SSR 版本，`pnpm demo:csr` 启动纯客户端版本。

> 播放器 CSS 由父应用显式 `import "@lumina/nova/style.css"`，不由 `VideoPlayer` 副作用导入。

### 自己写组件（框架用法）

组件是返回 VNode 的普通函数，用 `defineComponent` 包装以获得类型推导与生命周期：

```ts
import { h, defineComponent, when, each, useTemplateRef } from '@/core';
import type { ComponentLifecycle } from '@/types';

export const MyPanel = defineComponent<{ title: string; items: string[] }>(
  (props, lifecycle: ComponentLifecycle) => {
    // useTemplateRef(lifecycle, key) 返回 Signal，模板里用字符串 ref 绑定
    const box = useTemplateRef<HTMLDivElement>(lifecycle, 'box');

    lifecycle.onMounted = () => {
      // 挂载后直接操作真实 DOM —— 框架此后不再介入
      box.value?.classList.add('ready');
    };
    lifecycle.onBeforeDestroy = () => {
      // 清理定时器 / 监听器
    };

    return h('div', { class: 'my-panel', ref: 'box' },
      h('h3', {}, props.title),
      when(props.items.length > 0,
        h('ul', {}, each(props.items, (item) => h('li', {}, item)))
      )
    );
  }
);
```

**运行时更新的正确姿势**：框架使用自研 Signals 做响应式。VNode 属性传 Signal 会被编译期
自动包装为 `__reactiveAttrs`（class / style 支持对象与数组格式归一化）；返回字符串的函数调用
子节点用显式 getter 协议 `() => expr` 声明为响应式文本（编译期改写为 `_reactiveText`），
更新精准到单个 DOM 节点。跨组件共享状态用 `createTypedStateManager` + `useState` 订阅
（卸载自动退订，重挂后补发当前值，覆盖错过窗口期）：

```ts
import { createTypedStateManager, useState } from '@/core';

const state = createTypedStateManager();
useState(state, 'player.volume', (next) => {
  slider.style.setProperty('--vol', String(next));
}, lifecycle);
```

---

## 架构说明

### 1. Signal 响应式 + 零 VDOM diff

```
挂载期：h() → VNode（普通对象） → materialize() 递归 createElement → 真实 DOM
                            ↑
                 编译期 luminaCompile 把 h() 改写为 _createEl / _createStaticEl / …
                 响应式属性自动包装为 __reactiveAttrs，响应式文本走 _reactiveText

运行期：signal.set() → effect 精准更新对应 DOM 节点（依赖收集 + 细粒度订阅）
        （无虚拟 DOM diff、无整树重渲染；Show / For 控制流局部卸载重挂）
```

### 2. 三层协作

| 层 | 职责 |
| --- | --- |
| `core/` | 框架：VNode、挂载、SSR、自研 Signals（依赖收集 / effect）、Show / For 控制流、状态、事件总线、Context、生命周期、i18n |
| `packages/player` | 播放器：`VideoPlayer` 核心类 + 37 个组件 + store / config |
| `packages/plugins` | 插件：弹幕、字幕、三种流媒体、互动 |

### 3. 状态与事件（改动前请先读）

- **三套状态并存**：`TypedStateManager`（内存路径式）、`PlayerStore`（localStorage 持久化）、
  `ConfigStore`（可订阅配置中心，支持 `getPath` / `subscribePath`）。另有 `PluginManager` 私有的
  `state` / `events` / `hooks`。
- **两条事件通道**：内部 `events`（TypedEventBus，camelCase 键）与对外 `emitter`（EventEmitter，全小写键）。
  两者由 `VideoPlayer.bridgeEvents()` 的 24 条映射桥接，`player.on()` 监听的是 emitter 侧。
- 因此：**新增一个事件或配置项时，必须同步检查桥接表、mock 与订阅点**，否则会出现"事件收不到"这类静默故障。

### 4. 构建产物

| 包 | 产物 |
| --- | --- |
| `@lumina/nova` | `dist/index.es.js`（约 1.3 MB）、`dist/index.umd.js`（约 675 KB）、`dist/style.css`（约 393 KB）、`dist/index.d.ts`、lottie 独立 chunk（动态 import 自动分包） |
| `@lumina/plugins` | `dist/{index,danmaku,subtitle,dash,hls,flv}.js` + `interaction/`，`preserveModules` 保留模块结构，`dashjs` / `flv.js` / `@lumina/nova` 为 external |

---

## 许可证

MIT
