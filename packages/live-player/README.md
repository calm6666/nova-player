# @lumina/live-player

零依赖的直播播放器 Web Component：根元素 + 弹幕层 + 控制层，
其余面板均为根元素内部 DOM；弹幕复用 `packages/plugins` 的弹幕引擎。

## 快速开始

```ts
import { registerLivePlayerElements, LivePlayerElement } from '@lumina/live-player';

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
};
document.querySelector('#app')!.appendChild(player);
```

配置只通过 property 传入，根元素不观察 attribute。

## 功能

- 直播流：HLS / FLV 插件动态加载，失败回退原生 `<video>`；
- 控制层：播放、音量、刷新、清晰度、弹幕开关、发送、倍速、弹幕设置、
  网页全屏、全屏；无操作自动隐藏，图标 hover 有 tooltip 与放大回弹动效；
- 清晰度面板：居中两页（清晰度 / 线路），整行可点、切页无滚动条；
- 弹幕设置面板：两页，与点播播放器 DmSetting 一致（仅圆角 8px），
  含显示区域 / 密度 / 透明度 / 字号 / 速度 / 缩放 / 防挡 / 字体 / 描边；
- 直播信息：开播至今时长（不是播放进度）、清晰度、线路、缓冲、分辨率、FPS；
- 右键菜单：屏蔽用户 / 复制弹幕 / 举报 / 弹幕开关 / 更多设置；
- 持久化：localStorage 保存音量、清晰度、线路与全部弹幕设置；
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
