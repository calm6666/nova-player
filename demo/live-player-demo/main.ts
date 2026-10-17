/**
 * 直播播放器 demo。
 *
 * 页面 HTML 里不写任何自定义元素标签：播放器元素由本文件用 JS 创建并 append，
 * 所有操作结果与 `nova-live-player:*` 事件都写入页面最下方的事件日志。
 */

import '@/live/styles/style.scss';
import { LIVE_PLAYER_EVENTS } from '@/live/core/events';
import { registerLivePlayerElements } from '@/live/elements';
import { LivePlayerElement } from '@/live/elements/LivePlayerElement';
import type { NovaQualityCandidate } from '@/live/types';

const DEMO_STREAM = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

/** demo 清晰度候选（真实插件就绪后会被插件档位替换）。 */
const DEMO_QUALITIES: NovaQualityCandidate[] = [
  { qn: '10000', label: '原画' },
  { qn: '400', label: '高清' },
  { qn: '250', label: '流畅' },
];

registerLivePlayerElements();

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const logList = $<HTMLUListElement>('log-list');

/** 写入一条事件日志。 */
const log = (message: string): void => {
  const item = document.createElement('li');
  item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logList.appendChild(item);
  const first = logList.firstElementChild;
  if (logList.childElementCount > 300 && first) logList.removeChild(first);
  logList.scrollTop = logList.scrollHeight;
};

/** 创建播放器元素（不写 HTML 标签）。 */
const player = document.createElement('nova-live-player') as LivePlayerElement;
player.options = {
  autoplay: true,
  muted: true,
  locale: 'zh-CN',
  room: '演示房间 · 10001',
  line: 'main',
  lineCandidates: [
    { line: 'main', label: '主线' },
    { line: 'backup1', label: '备线1' },
    { line: 'backup2', label: '备线2' },
  ],
  persist: true,
};
$('demo-player').appendChild(player);

/** 订阅全部播放器事件。 */
for (const type of Object.values(LIVE_PLAYER_EVENTS)) {
  player.addEventListener(type, (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    const text = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
    log(`事件 ${type.replace('nova-live-player:', '')}${text}`);
  });
}

/** 流地址输入。 */
const urlInput = $<HTMLInputElement>('stream-url');
urlInput.value = DEMO_STREAM;

/** 加载默认流。 */
player.setStream(DEMO_STREAM);
log(`播放器已创建，恢复音量 ${player.volume}，持久化 ${player.persist}`);
log('ready 后可在播放器内右键弹幕测试菜单');

/** 持续投递模拟弹幕，便于测试右键菜单。 */
const SAMPLE_DANMAKU = [
  { text: '这个直播间画质好清晰', uid: '1001', uname: '观众甲' },
  { text: '主播今天状态不错', uid: '1002', uname: '观众乙' },
  { text: '前排围观', uid: '1003', uname: '观众丙' },
  { text: '666666', uid: '1001', uname: '观众甲' },
  { text: '弹幕速度可以调慢一点', uid: '1004', uname: '观众丁' },
];
let danmakuIndex = 0;
setInterval((): void => {
  const sample = SAMPLE_DANMAKU[danmakuIndex % SAMPLE_DANMAKU.length];
  danmakuIndex += 1;
  player.sendDanmaku(sample.text, {
    uid: sample.uid,
    uname: sample.uname,
    color: danmakuIndex % 3 === 0 ? '#ffd5a2' : '#ffffff',
  });
}, 2200);

/** 操作按钮。 */
$('btn-load').addEventListener('click', (): void => {
  const url = urlInput.value.trim();
  if (!url) return;
  player.setStream(url);
  void player.play();
  log(`调用 setStream(${url})`);
});

$('btn-play').addEventListener('click', (): void => {
  void player.play();
  log('调用 play()');
});

$('btn-pause').addEventListener('click', (): void => {
  player.pause();
  log('调用 pause()');
});

$('btn-mute').addEventListener('click', (): void => {
  player.toggleMute();
  log(`调用 toggleMute() -> muted=${player.muted}`);
});

$('btn-volume').addEventListener('click', (): void => {
  const next = player.volume > 50 ? 40 : 80;
  player.setVolume(next);
  log(`调用 setVolume(${next})`);
});

$('btn-web-full').addEventListener('click', (): void => {
  player.toggleWebFullscreen();
  log(`调用 toggleWebFullscreen() -> ${player.screenModeValue}`);
});

$('btn-full').addEventListener('click', (): void => {
  void player.toggleFullscreen();
  log('调用 toggleFullscreen()');
});

let qualityIndex = 0;
$('btn-quality').addEventListener('click', (): void => {
  const current = player.getQualityCandidates();
  const list = current.length > 0 ? current : DEMO_QUALITIES;
  if (current.length === 0) player.setQualityCandidates(DEMO_QUALITIES, DEMO_QUALITIES[0].qn);
  const candidate = list[qualityIndex % list.length];
  qualityIndex += 1;
  void player.setQuality(candidate.qn).then((ok) => {
    log(`调用 setQuality(${candidate.qn}) -> ${ok ? '成功' : '失败'}`);
  });
});

$('btn-menu').addEventListener('click', (): void => {
  player.openContextMenu();
  log('调用 openContextMenu()');
});

$('btn-info').addEventListener('click', (): void => {
  player.openPanel('info');
  log('调用 openPanel(info)');
});

$('btn-hotkey').addEventListener('click', (): void => {
  player.openPanel('hotkey');
  log('调用 openPanel(hotkey)');
});

$('btn-dm-setting').addEventListener('click', (): void => {
  player.openPanel('danmaku');
  log('调用 openPanel(danmaku)');
});

$('btn-clear-log').addEventListener('click', (): void => {
  logList.replaceChildren();
});

urlInput.addEventListener('keydown', (event: KeyboardEvent): void => {
  if (event.key === 'Enter') {
    (document.getElementById('btn-load') as HTMLButtonElement).click();
  }
});
