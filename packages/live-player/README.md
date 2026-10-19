# @lumina/live-player

零依赖的直播播放器 Web Component：根元素 + 弹幕层 + 控制层，
其余面板均为根元素内部 DOM；流媒体与弹幕能力全部由开发者传入
`packages/plugins` 的插件实例（本包不自建加载器 / 弹幕引擎）。

## 快速开始

```ts
import { registerLivePlayerElements, LivePlayerElement } from '@lumina/live-player';
import { createHlsPlugin } from '@lumina/plugins/hls';
import { createFlvPlugin } from '@lumina/plugins/flv';
import { createDanmakuPlugin } from '@lumina/plugins/danmaku';

registerLivePlayerElements();

const player = document.createElement('nova-live-player') as LivePlayerElement;
player.options = {
  streamUrl: 'https://example.com/live.m3u8',
  lineCandidates: [
    { line: 'main', label: '主线' },
    { line: 'backup', label: '备线' },
  ],
  autoplay: true,
  muted: true,
  plugins: [
    createHlsPlugin({ autoplay: false }),
    createFlvPlugin({ autoplay: false, isLive: true }),
    createDanmakuPlugin(),
  ],
};
document.querySelector('#app')!.appendChild(player);
```

配置只通过 property 传入，根元素不观察 attribute。

## 功能

- 直播流：开发者传入的 HLS / FLV 插件按声明类型匹配拉流；无匹配插件回退原生
  `<video>` 并 Toast 提示；
- 控制层：播放、音量、刷新、清晰度、弹幕开关、发送、弹幕设置、
  网页全屏、小窗、全屏；无操作自动隐藏，图标 hover 有 tooltip 与放大回弹动效；
- 小窗（悬浮 mini 播放器，不是浏览器 PiP）：与根元素共用同一个 video / 弹幕层，
  380×248、8px 圆角、34px 标题栏 + 关闭按钮、hover 显示播放 / 刷新圆形按钮、
  「bilibili 直播 + 房间号」水印；header 可拖动并记忆位置；播放器滚出视口自动
  收进小窗、滚回自动还原，关闭后 `scrollIntoView` 回到播放器；
- 清晰度面板：居中两页（清晰度 / 线路），整行可点、切页无滚动条；
- 弹幕设置面板：两页，与点播播放器 DmSetting 一致（仅圆角 8px），
  含显示区域 / 密度 / 透明度 / 字号 / 速度 / 缩放 / 防挡 / 字体 / 描边；
  弹幕关闭时控制栏按钮置灰、hover / 点击与右键菜单均无法打开该面板；
- 直播信息：开播至今时长（不是播放进度）、清晰度、线路、缓冲、分辨率、FPS，
  附带 1Hz 采样的缓冲（ms）与丢帧 SVG 曲线（最近 40 个点）；
- 视频编码面板：AVC / HEVC / AV1 候选（公开 API 注入）、当前项高亮、
  切换后派发 `codecchange` 并持久化；
- 右键菜单：弹幕开关 / 更多弹幕设置 / 视频信息 / 视频编码；
- 持久化：localStorage 保存音量、清晰度、线路、编码与全部弹幕设置，
  小窗位置单独保存在 `lumina.live-player.mini-position.v1`；
- i18n：默认简体中文，`setLocale()` 切换。

## 开发

```bash
# 仓库根目录
# 类型检查
node node_modules/typescript/bin/tsc --noEmit -p packages/live-player/tsconfig.json

# demo（仓库根目录执行）
node node_modules/vite/bin/vite.js --config demo/live-player-demo/vite.config.ts
# http://localhost:8690/

# 构建
node node_modules/vite/bin/vite.js build --config packages/live-player/vite.config.ts

# 冒烟
node packages/live-player/scripts/cdp-smoke.mjs
```

完整 API 见 [docs/API.md](./docs/API.md)。
