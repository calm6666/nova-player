# MediaCore 改造方案

> 目标：把 `<video>` 元素从播放器核心、控制栏和插件中收口到唯一的媒体访问层。
> HTML5 适配器实现现有全部行为；后续原生核心只需实现同一接口，UI 与插件不感知差异。
>
> 本方案只描述目标形态与落地顺序，确认后再改代码。

## 1. 目标与不做的事

目标：

- 媒体语义（播放、暂停、跳转、音量、倍速、循环、缓冲、错误、画中画、帧、时钟）只有一个入口。
- `<video>` 元素的创建、挂载、事件绑定和销毁全部归核心层 MediaCore，UI 只提供宿主容器。
- 运行时状态（`player.currentTime` / `volume` / `duration` 等）只有一个写入方。
- UI 与插件不再直接写 `video.currentTime` / `volume` / `playbackRate` / `src`。
- SSR 与水合不受影响：MediaCore 在 Node 端零副作用，只在客户端挂载后创建元素。
- 为原生核心保留清晰的替换位：`MediaCore` 接口 + `Html5MediaCore` / `NativeMediaCore` 两个实现。

不做的事：

- 不在组件模板里静态渲染 `<video>`。`PlayerDocker` 只渲染稳定的媒体宿主容器，元素由 MediaCore 创建。
- 不把画面比例、海报、镜像以外的布局逻辑放进 MediaCore（比例计算依赖 wrap/area 几何）。
- 不在本阶段实现原生桥。只定义接口与能力位，原生实现放到最后阶段。
- 不改公开播放器 API 的语义（`play` / `pause` / `seek` / `setVolume` / `getCurrentTime` 等保持）。

关于静态模板：UI 组件仍保持 `_createEl` 为 0。媒体元素在 `Html5MediaCore.mount()` 中通过一次集中的 `document.createElement("video")` 创建，这是媒体适配器的职责，不进入编译器模板，也不允许散落到组件与插件。

## 2. 现状盘点

核心直接访问：

- `VideoPlayer.ts` 中 `this.videoEl` 出现 88 处：
  - 媒体命令：`play` / `pause` / `currentTime` / `volume` / `muted` / `playbackRate` / `loop` / `src` / `load` / `buffered` / `paused` / `duration` / `error` / `videoWidth` / `videoHeight`
  - 原生事件绑定：`bindVideoEvents` / `addVideoListener` / `removeVideoListeners`（约 20 个事件）
  - 表现：镜像 `style.transform`、比例 `object-fit`
  - 画中画：`pip.request(video)`
- `PlayerDocker.ts` 中 `videoRef` 的媒体读写：
  - `initVideo` 设置 `src` / `volume` / `muted`
  - `togglePlayPause`、`seekTo`、`applyPlaybackRate`、`togglePip`
  - 快捷键上下文的 `getVideo` / `getPlaybackRate` / `seekBy`
  - 缓冲判断 `canContinuePlayback`、错误主机名、缓冲速度采样 URL
  - `CURRENT_TIME` 订阅里用 `video.paused` 判断是否撤缓冲指示
- `StreamMiddleware` 构造函数直接持有 `HTMLVideoElement`，原生模式代理 `play/pause/seek/src/load/buffered`。
- `<video>` 元素当前由 `PlayerDocker` 的静态模板渲染（`h("video", { ref: "videoRef" })`），创建权在 UI 层。
- `VideoInfo` 通过 `querySelector` 查找 video 元素。
- 插件直接持有 video 元素：
  - `DanmakuPlugin`：时钟与 seek
  - `SubtitlePlugin` / `audioCapture`：时钟、倍速、`createMediaElementSource`
  - `DynamicBgPlugin`：帧绘制、父节点插入、播放状态
  - `EndingPlugin` / `interactive-video`：末帧绘制
  - `ColorPlugin`：`video.style.filter`
  - `AudioEffectPlugin`：`MediaElementSource`
  - `DashPlugin` / `HlsPlugin` / `FlvPlugin`：通过 MOUNTED 拿元素

已有可复用边界：

- `PlayerPort` / `PlayerUiHost` 已经是 UI 与核心之间的契约层。
- `MOUNTED` 事件已统一携带 `{ container, video, sendingArea }`。
- 播放器事件总线已经承担状态到外部的投影。

## 3. 目标架构

```text
PlayerDocker (DOM 宿主)
  └─ .nova-player-video-wrap（稳定容器，模板只渲染到这里）
       └─ media.mount(host)  ──▶  MediaCore (interface)
                                     ├─ Html5MediaCore   创建 <video> + 事件/命令/帧/PiP
                                     └─ NativeMediaCore  创建原生画面宿主 / IPC (后续)

VideoPlayer
  ├─ 订阅 MediaCore 事件（唯一状态写入方）
  ├─ 所有媒体命令委托 MediaCore
  └─ 表现层：比例 / 海报 / 容器类名（HTML5 专属，能力位门控）

PlayerDocker / Controls / Hotkeys
  └─ 只调用 MediaCore 命令或 VideoPlayer 公开方法

Plugins
  ├─ 时钟：media.getClock()
  ├─ 帧：media.drawFrame() / media.captureFrame()
  ├─ 状态：media.getSnapshot()
  └─ HTML5 专属：media.getVideoElement()（音频采集、AudioEffect、解码字节）
```

元素所有权：

- `PlayerDocker` 不再创建 `<video>`，只渲染 `.nova-player-video-wrap` 宿主。
- `Html5MediaCore.mount(host)` 创建并追加 `<video class="nova-player-video">`，统一设置 `crossorigin` / `preload` / `playsinline`。
- `unmount()` 解绑事件、暂停、清空 `src`、移除元素。
- 原生实现 `mount(host)` 挂载自己的画面宿主，`getVideoElement()` 返回 null。

分层规则：

1. MediaCore 负责媒体语义与视频表面能力（镜像、滤镜、帧），不读写运行时状态、不发业务事件。
2. VideoPlayer 是 `PlayerStateMap`、store、事件总线的唯一写入方。
3. UI 命令走 MediaCore，状态回显走状态键，不自行维护媒体状态副本。
4. `getVideoElement()` 是 HTML5 逃生口，必须同时检查 `capabilities.hasElement`。

## 4. 接口定义

新增文件：`packages/player/src/core/media/mediaCore.ts`

```ts
export interface MediaCoreCapabilities {
  /** html5 | native */
  readonly kind: "html5" | "native";
  /** 是否暴露 <video> 元素（HTML5 逃生口） */
  readonly hasElement: boolean;
  /** 是否能承载 MSE 流媒体插件（HLS/DASH/FLV） */
  readonly mse: boolean;
  /** 是否支持画中画 */
  readonly pictureInPicture: boolean;
  /** 是否支持取帧 */
  readonly frame: boolean;
  /** 是否支持音频采集（本地 AI 字幕） */
  readonly audioTap: boolean;
}

export interface MediaBuffered {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
}

export interface MediaErrorSnapshot {
  code: number;
  message: string;
}

export interface MediaSnapshot {
  src: string;
  currentSrc: string;
  currentTime: number;
  duration: number;
  buffered: MediaBuffered;
  volume: number;
  muted: boolean;
  playbackRate: number;
  paused: boolean;
  ended: boolean;
  loop: boolean;
  readyState: number;
  networkState: number;
  videoWidth: number;
  videoHeight: number;
  error: MediaErrorSnapshot | null;
}

export interface MediaClock {
  currentTime: number;
  duration: number;
  paused: boolean;
  playbackRate: number;
  bufferedEnd: number;
}

export type MediaEventType =
  | "loadstart" | "loadedmetadata" | "loadeddata" | "canplay" | "canplaythrough"
  | "durationchange" | "progress" | "suspend" | "stalled" | "abort" | "emptied"
  | "error" | "play" | "playing" | "pause" | "ended"
  | "timeupdate" | "seeking" | "seeked" | "volumechange" | "ratechange" | "waiting"
  | "enterpictureinpicture" | "exitpictureinpicture";

export interface MediaCoreEvent {
  type: MediaEventType;
  /** 事件发生时的媒体快照，处理方不再回读元素 */
  snapshot: MediaSnapshot;
}

export interface MediaCore {
  readonly capabilities: MediaCoreCapabilities;

  /**
   * 在宿主容器内创建并挂载媒体元素（HTML5）或原生画面宿主。
   * 仅 DOM 宿主调用；SSR 无 document 时安全返回；幂等。
   */
  mount(host: HTMLElement): void;
  /** 解绑事件、断开媒体并移除元素；幂等 */
  unmount(): void;
  isMounted(): boolean;

  subscribe(listener: (event: MediaCoreEvent) => void): () => void;

  getSnapshot(): MediaSnapshot;
  getClock(): MediaClock;

  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  setSource(url: string): void;
  reload(): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setPlaybackRate(rate: number): void;
  setLoop(loop: boolean): void;

  /** 镜像画面（HTML5 写 transform；native 走壳） */
  setMirror(mirrored: boolean): void;
  /** CSS 滤镜（色彩调整插件使用） */
  setVideoFilter(filter: string): void;

  requestPictureInPicture(): Promise<void>;
  exitPictureInPicture(): Promise<void>;
  isPictureInPicture(): boolean;

  /** 同步绘制当前帧，返回是否成功（HTML5 drawImage；native 桥接帧缓冲） */
  drawFrame(
    ctx: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): boolean;
  /** 异步取帧（片尾/互动视频末帧） */
  captureFrame(): Promise<ImageBitmap | null>;

  /** HTML5 专属逃生口，native 返回 null */
  getVideoElement(): HTMLVideoElement | null;
}
```

工厂：

```ts
export interface MediaCoreOptions {
  kind?: "html5" | "native";
}

export function createMediaCore(options?: MediaCoreOptions): MediaCore;
```

默认 `html5`。`VideoPlayer` 构造时创建。原生接入阶段通过 `PlayerConfig.media?.core`（高级可选配置）注入 `NativeMediaCore`；不传时回退 `createMediaCore()`，宿主应用不感知。

## 5. Html5MediaCore 行为

新增文件：`packages/player/src/core/media/html5MediaCore.ts`

职责：

- `mount(host)` 创建 `<video class="nova-player-video">`，设置 `crossorigin="anonymous"` / `preload="auto"` / `playsinline`，追加到宿主后绑定原生事件。
- 绑定事件时统一构造 `MediaSnapshot` 后 emit；`unmount()` 解绑、暂停、清 `src`、`load()`、从宿主移除元素。
- mount 只创建元素与监听，不设置 source、不自动播放；首帧加载仍由 VideoPlayer 在挂载后驱动。
- 命令直接写元素，不做状态与业务事件。
- 所有方法在未 mount、无 document 或已销毁后安全返回。
- `getSnapshot()` 实时读取元素；未 mount 时返回默认快照。
- `buffered` 直接暴露原生 `TimeRanges`（结构满足 `MediaBuffered`），避免每帧分配。
- `drawFrame` 检查 `readyState >= 2` 与 `videoWidth > 0`，捕获 CORS 污染异常返回 false。
- `captureFrame` 使用 `createImageBitmap(video)`，失败返回 null。
- PiP 封装 `requestPictureInPicture` / `exitPictureInPicture` / `document.pictureInPictureElement`，并转发 `enterpictureinpicture` / `exitpictureinpicture` 事件。
- `capabilities = { kind: "html5", hasElement: true, mse: true, pictureInPicture: true, frame: true, audioTap: true }`。

SSR 与水合：

- `renderToString` 只输出空的 `.nova-player-video-wrap`，不包含 `<video>`。
- 客户端首次渲染同样输出空宿主，水合结构与服务端一致。
- 水合完成后 `PlayerDocker` 的挂载钩子调用 `media.mount(wrap)`，元素在此时创建；不参与水合复用，也不会产生 mismatch。
- 海报是独立兄弟节点，首屏展示不受影响。

事件到快照的映射：

| 原生事件 | VideoPlayer 现有处理 | 快照字段 |
| --- | --- | --- |
| loadstart | loading / LOADING | readyState |
| loadedmetadata | duration / 宽高 / pendingSeek | duration, videoWidth, videoHeight |
| loadeddata / canplay / canplaythrough | 事件转发 | readyState |
| durationchange | HIRES_AUDIO_AVAILABLE | duration |
| progress | BUFFERED / callbacks.progress | buffered |
| suspend / stalled / abort / emptied | 事件转发 / 清 guard | loading |
| error | 备用源切换 | error, src |
| play / playing / pause / ended | 播放状态 | paused, ended |
| timeupdate | CURRENT_TIME / 跳过头尾 / 进度记忆 | currentTime, duration |
| seeking / seeked | SEEKING / SEEKED | currentTime |
| volumechange | VOLUME / MUTED / 持久化 | volume, muted |
| ratechange | PLAYBACK_RATE / 持久化 | playbackRate |
| waiting | 缓冲守卫 | readyState |
| enter/exitpictureinpicture | IS_PIP | 无 |

## 6. 核心层改造

### 6.1 VideoPlayer

删除：

- `private videoEl`
- `videoListeners` / `videoEventsBound`
- `addVideoListener` / `bindVideoEvents` / `removeVideoListeners`
- 各处对 `this.videoEl.*` 的媒体读写

新增：

- `readonly media: MediaCore`（构造期创建）
- `private unsubscribeMedia: (() => void) | null`
- `private handleMediaEvent(event: MediaCoreEvent)`：原 `bindVideoEvents` 内各事件体迁移到这里，读取 `event.snapshot`，继续写 state/store/事件总线。
- `getMediaCore(): MediaCore`
- `isMediaReady(): boolean`（`readyState >= 1`）
- `getVideoElement()` 改为 `this.media.getVideoElement()`

改造点：

- `use()` / SSR：MediaCore 构造无副作用，SSR 不 mount；`getVideoElement()` 返回 null。
- `onMounted`：PlayerDocker 已在自身挂载钩子内调用 `media.mount(wrap)`；这里先订阅事件，再创建 StreamMiddleware、应用播放偏好、比例与镜像、绑定 ResizeObserver，最后驱动首帧加载。
- `applyPlaybackToMedia`：改用 `media.setVolume` / `setMuted` / `setPlaybackRate` / `setLoop`。
- `setMirror`：`media.setMirror` + 持久化。
- `setAspectRatio`：保留 DOM 计算，入口先判 `media.getVideoElement()`；native 模式由壳处理。
- `play` / `pause` / `seek` / `setVolume` / `setMuted` / `setPlaybackRate` / `reload` / 备用源切换：全部委托 MediaCore。
- `enterPip` / `exitPip`：委托 MediaCore。
- `hasHiResAudio` / `setupStreamMiddleware`：仅当 `media.capabilities.mse` 创建中间件。
- 错误处理：`handleVideoError` 读 `snapshot.error` 与 `snapshot.src`。
- `destroy`：顺序保持 `teardownComponentTree` → `streamMiddleware.destroy` → `media.unmount()`，然后清理引用。

### 6.2 PlayerDocker

模板与挂载：

- 删除 `h("video", { ref: "videoRef" })`，`.nova-player-video-wrap` 作为媒体宿主保留。
- `initVideo` 改为 `initMedia`：
  - `const media = resolvedPlayer?.getMediaCore?.() ?? localMediaCore`
  - `media.mount(videoWrapRef.value)`
  - `props.src` 可直接播放时调用 `media.setSource(props.src)`
  - 不再设置 `volume` / `muted`，初始值由 VideoPlayer 的 `applyPlaybackToMedia` 统一应用
- `mounted` 事件 payload 的 `video` 取值改为 `media.getVideoElement()`（HTML5 必为元素）。
- `localMediaCore` 仅在独立使用 `PlayerDocker`（没有 `PlayerContext`）时创建，随组件卸载 `unmount()`；有播放器实例时始终复用播放器的 MediaCore，不创建第二份。

命令与状态：

- `togglePlayPause`：`media.play()` / `media.pause()`，保留 `showControls`。
- `seekTo`：`media.seek(target)`，删除 `stateMgr.set(CURRENT_TIME)`；UI 立即更新保留。
- `applyPlaybackRate`：`media.setPlaybackRate(rate)`，删除 state / bus 重复写入。
- `setVolume`：`media.setVolume(clamped)` + 静音联动，删除 state 重复写入。
- `togglePip`：改为 `resolvedPlayer.enterPip()` / `exitPip()`。
- `canContinuePlayback`：`media.getSnapshot()`。
- 错误主机名、缓冲速度采样：`media.getSnapshot().currentSrc`。
- `CURRENT_TIME` 订阅：`media.getSnapshot().paused`。
- `seekBy` 快捷键：`media.seek(snapshot.currentTime + seconds)`。
- `setPlaybackRate` 快捷键：`media.setPlaybackRate`。
- `getVideo` 快捷键：替换为 `isMediaReady`；`core/hotkeys.ts` 的 `HotkeyContext` 同步改名。
- 片尾重播：`resolvedPlayer.seek(0)` + `media.play()`。
- `videoRef` 完全移除，只保留 `videoWrapRef` 作为 mount 宿主与 CSS 布局容器。

### 6.3 StreamMiddleware

- 构造函数改为 `new StreamMiddleware(media: MediaCore)`。
- 原生代理方法改调 MediaCore 命令与快照。
- 增加能力判断：`capabilities.mse === false` 时不创建中间件，流媒体插件按原生管线处理。
- 流媒体插件仍通过 MOUNTED 的 `video` 元素工作；native 阶段改为 `media` 能力。

### 6.4 端口与事件类型

`types/playerPort.ts`：

```ts
getMediaCore?(): MediaCore;
isMediaReady?(): boolean;
/** @deprecated HTML5 专属逃生口，优先使用 getMediaCore() */
getVideoElement?(): HTMLVideoElement | null;
```

`MOUNTED` payload（`types/player.ts` 与 `types/events.ts` 两处同步）：

```ts
{
  container: HTMLElement;
  sendingArea: HTMLElement | null;
  media: MediaCore;
  /** HTML5 模式为元素；native 阶段为 null */
  video: HTMLVideoElement | null;
}
```

第一阶段保持 `video` 非空，避免插件连锁改动；native 接入时再改为可空并在类型上强制处理。

公开类型不变：`MediaBuffered` 与原生 `TimeRanges` 结构一致（`length` / `start` / `end`），`callbacks.progress`、`ProgressBarProps.buffered` 继续使用 `TimeRanges`。

### 6.5 VideoInfo

- 删除 `findVideo()` 的 DOM 查询。
- 通过 `PlayerContext` 取 `getMediaCore()` 的快照（缓冲、当前时间、src）。
- 解码字节继续走 `getVideoElement()`，`hasElement` 为 false 时隐藏对应行。

## 7. 插件迁移

按优先级：

1. `DanmakuPlugin`
   - `video.currentTime` → `media.getClock().currentTime`
   - 外部 seek → `media.seek`
   - MOUNTED 继续使用 `video` 做尺寸与容器定位，时钟改走 MediaCore。
2. `SubtitlePlugin`
   - 字幕时间读取 → `media.getClock()`
   - 外部 seek → `media.seek`
   - `audioCapture` 依赖音频采集，保留 `getVideoElement()`，以 `capabilities.audioTap` 门控。
3. `ColorPlugin`
   - `video.style.filter` → `media.setVideoFilter`。
4. `DynamicBgPlugin`
   - `drawImage(video)` → `media.drawFrame`
   - 播放状态 → `media.getClock().paused`
   - 容器插入从 `video.parentElement` 改为 MOUNTED 提供的稳定容器（`.nova-player-video-wrap`）。
5. `EndingPlugin` / `interactive-video`
   - 末帧绘制 → `media.drawFrame` / `captureFrame`。
6. `AudioEffectPlugin` / `DashPlugin` / `HlsPlugin` / `FlvPlugin`
   - 继续使用元素（MSE / MediaElementSource 本质依赖元素），以能力位门控。

## 8. 单真源规则

| 数据 | 唯一来源 | 唯一写入方 | 读取方 |
| --- | --- | --- | --- |
| currentTime / duration / buffered | MediaCore snapshot | VideoPlayer 事件处理 | state / UI / 插件 |
| volume / muted / rate / loop | MediaCore snapshot | VideoPlayer 事件处理 | state / UI / 插件 |
| paused / ended / readyState | MediaCore snapshot | VideoPlayer 事件处理 | state / UI / 插件 |
| video src / error | MediaCore snapshot | MediaCore 命令 + 原生事件 | VideoPlayer / 错误面板 |
| 比例 / 海报 / 镜像布局 | props + DOM | VideoPlayer 表现层 | 组件树 |
| 清晰度 / 流媒体 | StreamMiddleware | StreamMiddleware | VideoPlayer / UI |

UI 不允许：

- 直接写 `video.currentTime` / `volume` / `muted` / `playbackRate` / `src` / `load()`。
- 维护第二份媒体状态（例如本地 paused 副本）。

允许的例外：

- `getVideoElement()` 的 HTML5 专属消费：AudioEffect 的 `createMediaElementSource`、本地 AI 字幕的 `audioCapture`、解码字节读取。
- 表现层样式：镜像 transform、比例 object-fit、海报背景。

## 9. 分阶段落地

### 阶段 A：接口与适配器（不改行为）

- 新增 `mediaCore.ts` / `html5MediaCore.ts` / `index.ts`。
- VideoPlayer 创建 MediaCore，PlayerDocker 渲染空宿主并在挂载钩子 `media.mount(wrap)`。
- MediaCore 负责创建 `<video>`、设置基础属性并接管现有 `bindVideoEvents` 的所有监听。
- VideoPlayer 的媒体命令改为委托，但保留原有 state / 业务事件写入。
- StreamMiddleware 接受 MediaCore。
- 验收：typecheck / build；事件处理表逐项对齐；SSR 只输出媒体宿主容器，水合前后结构一致，挂载后由 MediaCore 补入 `<video>`。

### 阶段 B：控制栏与快捷键去直连

- PlayerDocker 的媒体读写全部改走 MediaCore。
- `HotkeyContext.getVideo` 改为 `isMediaReady`。
- `togglePip` / `seekTo` / `applyPlaybackRate` / `setVolume` 去掉重复 state 写入。
- `VideoInfo` 去掉 DOM 查询。
- 验收：`videoRef.value` 的媒体写操作清零；SSR 只输出空宿主且水合无 mismatch；typecheck / demo / demo-prod 构建通过。

### 阶段 C：插件时钟与帧

- Danmaku / Subtitle / Color / DynamicBg / Ending / Interactive 改为 MediaCore。
- 保留 AudioEffect、流媒体插件、AI 字幕采集的元素路径。
- 验收：插件包 typecheck / build；`getVideoElement` 调用点只剩白名单。

### 阶段 D：原生核心契约

- 新增 `nativeMediaCore.ts` 骨架与 `MediaCoreTransport`：
  ```ts
  interface MediaCoreTransport {
    invoke(method: string, args: unknown): Promise<unknown>;
    on(event: string, handler: (payload: unknown) => void): () => void;
  }
  ```
- 快照由原生推送，事件名与 HTML5 保持一致。
- 能力位：`mse: false`、`hasElement: false`、`audioTap: false`，帧走桥接。
- 不在本阶段接 C++，只保证接口可替换、UI 无元素依赖。

## 10. 验证与验收

静态与构建：

- `packages/player` / `packages/plugins` typecheck + build。
- `demo` / `demo-prod` typecheck + build（含 SSR 构建）。
- 产物扫描：`_createEl` / `_createSvgEl` 为 0 不回归。

代码约束：

- `VideoPlayer.ts` 中 `this.videoEl` 清零。
- `PlayerDocker.ts` 中视频媒体写操作清零（`media.mount` 宿主与表现层除外）。
- `PlayerStateMap` 媒体键只有一个写入方（VideoPlayer 的 `handleMediaEvent`）。
- `getVideoElement()` 调用点与白名单一致。

行为回归（无浏览器时按代码路径核对，后续浏览器阶段再实测）：

- 播放 / 暂停 / 结束 / 循环。
- 点击与拖拽跳转、跳过头尾、进度记忆。
- 音量 / 静音 / 倍速 / 持久化。
- HLS / DASH / FLV 加载、切档、错误备用源。
- 画中画、全屏、宽屏。
- 弹幕时钟、字幕时钟、动态背景帧、片尾末帧、色彩滤镜。
- SSR 首帧与客户端水合结构一致。

## 11. 风险与应对

| 风险 | 应对 |
| --- | --- |
| 事件重复处理导致状态双写 | 一次提交内删除旧监听，事件表逐项核对；state 写入只保留在 VideoPlayer |
| pendingSeek / 换源时序变化 | loadedmetadata 仍由 VideoPlayer 处理，MediaCore 只提供快照 |
| 流媒体销毁顺序 | 保持 `streamMiddleware.destroy` → `media.unmount`，先摘插件再断媒体 |
| SSR 触碰 window | MediaCore 构造零副作用，mount 只在客户端挂载钩子；Node 端 `getVideoElement()` 返回 null |
| SSR 标记变化 | SSR 不再包含 `<video>`，验收需覆盖「空宿主 + 水合后由 MediaCore 创建」的路径 |
| 元素创建绕过模板 | 只允许 `Html5MediaCore.mount` 内一处 `createElement("video")`，UI 与插件禁止自行创建 |
| 表现层在 native 下失效 | 比例/海报留在壳层；镜像与滤镜提供 MediaCore 命令 |
| 插件继续直接拿元素 | `getVideoElement` 标记 deprecated，白名单 + 阶段 C 迁移 |
| `TimeRanges` 结构差异 | `MediaBuffered` 与 `TimeRanges` 结构一致，公开回调类型不改 |
| 缓冲区采样与错误主机名依赖元素 | 统一改读 `snapshot.currentSrc` |

## 12. 文件清单

新增：

- `packages/player/src/core/media/mediaCore.ts`
- `packages/player/src/core/media/html5MediaCore.ts`
- `packages/player/src/core/media/index.ts`
- `docs/mediacore-refactor.md`（本文）

修改：

- `packages/player/src/player/VideoPlayer.ts`
- `packages/player/src/components/PlayerDocker.ts`
- `packages/player/src/components/VideoInfo.ts`
- `packages/player/src/utils/media/streamMiddleware.ts`
- `packages/player/src/types/playerPort.ts`
- `packages/player/src/types/player.ts`（MOUNTED 与 callbacks 类型）
- `packages/player/src/types/events.ts`（`PlayerEventMap.mounted` / `player:mounted`）
- `packages/player/src/core/hotkeys.ts`
- `packages/player/src/index.ts`
- `packages/plugins/src/danmaku/DanmakuPlugin.ts`
- `packages/plugins/src/subtitle/SubtitlePlugin.ts`
- `packages/plugins/src/subtitle/asr/audioCapture.ts`（能力门控）
- `packages/plugins/src/color/ColorPlugin.ts`
- `packages/plugins/src/dynamicbg/DynamicBgPlugin.ts`
- `packages/plugins/src/ending/EndingPlugin.ts` / `EndingView.ts`
- `packages/plugins/src/interactive-video/questionCanvas.ts`

删除：

- `VideoPlayer.ts` 中的 `bindVideoEvents` / `addVideoListener` / `removeVideoListeners` / `videoListeners` / `videoEventsBound`。

## 13. 提交拆分

1. `feat(player): add MediaCore abstraction over the video element`
2. `refactor(player): route media state and commands through MediaCore`
3. `refactor(controls): stop writing the video element directly`
4. `refactor(plugins): consume MediaCore clock and frames`
5. `feat(player): define native MediaCore transport contract`（仅类型与骨架）
