/**
 * CDP 冒烟测试。
 *
 * 前置：demo dev server 已在 http://localhost:8690/ 运行。
 * 用法：node packages/live-player/scripts/cdp-smoke.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const PAGE_URL = 'http://localhost:8690/';
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-live-smoke-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let socket = null;
let messageId = 0;
const pending = new Map();
const results = [];

const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`);
};

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) {
    throw new Error(
      `evaluate failed: ${response.exceptionDetails.text} ${response.exceptionDetails.exception?.description ?? ''}`,
    );
  }
  return response.result?.value;
};

const waitFor = async (expression, timeout = 15000, interval = 150) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return true;
    } catch {
      // 导航中忽略。
    }
    await sleep(interval);
  }
  return false;
};

const click = async (selector) => {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  await sleep(200);
  return ok;
};

const showBar = async () => {
  await evaluate(`document.querySelector('.nova-live-player')?.dispatchEvent(new PointerEvent('pointerenter'))`);
  await sleep(120);
};

const hoverAction = async (action) => {
  const ok = await evaluate(`(() => {
    const button = document.querySelector('[data-action="${action}"]');
    if (!button) return false;
    (button.parentElement ?? button).dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    return true;
  })()`);
  await sleep(250);
  return ok;
};

/** 小窗 header 中心（header 不可见时返回 null）。 */
const miniHeaderCenter = async () =>
  evaluate(`(() => {
    const el = document.querySelector('.nova-live-player-mini-header');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);

/**
 * 用 CDP 真实指针拖动小窗 header。
 * CDP Input 产生的 pointerdown / pointermove / pointerup 带有效 pointerId，
 * 才能覆盖 `setPointerCapture` 路径。
 */
const dragMiniHeader = async (dx, dy) => {
  const center = await miniHeaderCenter();
  if (!center) return null;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: center.x,
    y: center.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await sleep(70);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: center.x + dx,
    y: center.y + dy,
    button: 'left',
    buttons: 1,
  });
  await sleep(160);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: center.x + dx,
    y: center.y + dy,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await sleep(240);
  return { x: center.x + dx, y: center.y + dy };
};

/** 鼠标移入小窗中心，触发 CSS :hover。 */
const hoverMini = async () => {
  const center = await evaluate(`(() => {
    const el = document.querySelector('nova-live-player');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  if (!center) return false;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y, button: 'none', buttons: 0 });
  await sleep(260);
  return true;
};

/** 鼠标移到视口左上角，取消 hover。 */
const leaveMini = async () => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, button: 'none', buttons: 0 });
  await sleep(220);
};

const readLog = async () => (await evaluate(`document.getElementById('log-list').textContent`)) ?? '';
const logHas = async (value) => (await readLog()).includes(value);

const artifactDir = path.resolve(import.meta.dirname, '../artifacts');

/** 截取某个元素（带 8px 边距）到 artifacts/<name>。 */
const captureElement = async (selector, name) => {
  const rect = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  })()`);
  if (!rect) return false;
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: Math.max(0, rect.x - 8),
      y: Math.max(0, rect.y - 8),
      width: rect.width + 16,
      height: rect.height + 16,
      scale: 1,
    },
  });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, name), Buffer.from(screenshot.data, 'base64'));
  return fs.existsSync(path.join(artifactDir, name));
};

const run = async () => {
  let target = null;
  for (let index = 0; index < 100; index += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((res) => res.json());
      target = list.find((item) => item.type === 'page');
      if (target) break;
    } catch {
      // 浏览器未就绪。
    }
    await sleep(150);
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('cannot find Chrome page target');

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result ?? {});
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: PAGE_URL });
  await waitFor(`document.readyState === 'complete'`);

  // 1. 基础结构
  const loaded = await waitFor(
    `!!document.querySelector('nova-live-player') && document.querySelectorAll('.danmaku-x-dm').length > 0`,
    25000,
  );
  check('播放器与 plugins 弹幕引擎已渲染', loaded);
  await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    window.__smokeEvents = new Set();
    ['ready','play','pause','timeupdate','progress','volumechange','mutechange','qualitychange','qualitycandidates','linechange','linecandidates','codecchange','screenchange','danmakuvisible','danmakusetting','danmakusent','streamchange','reload'].forEach((name) => {
      player.addEventListener('nova-live-player:' + name, () => window.__smokeEvents.add(name));
    });
  })()`);

  await showBar();
  const basics = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    return {
      root: document.querySelectorAll('nova-live-player').length,
      custom: ['nova-live-player-danmaku','nova-live-player-control-bar'].filter((tag) => !!document.querySelector(tag)).length,
      dmSettingTag: !!document.querySelector('nova-live-player-dm-setting'),
      attrs: Array.from(player.attributes).map((attr) => attr.name),
      controls: player.querySelectorAll('.nova-live-player-control-button').length,
      labels: Array.from(player.querySelectorAll('.nova-live-player-control-button')).map((el) => el.dataset.action),
      tips: Array.from(player.querySelectorAll('.nova-live-player-control-tip')).length,
      time: player.querySelector('.nova-live-player-control-time-value')?.textContent ?? '',
      panels: player.querySelectorAll('[data-panel]').length,
    };
  })()`);
  check('根元素唯一且无 src/autoplay/muted attribute', basics.root === 1 && !basics.attrs.includes('src') && !basics.attrs.includes('autoplay') && !basics.attrs.includes('muted'), basics.attrs);
  check('仅弹幕层 / 控制层为独立 Web Component', basics.custom === 2 && basics.dmSettingTag === false);
  check('控制条 10 个动作（含弹幕设置图标、小窗按钮）与 tooltip', basics.controls === 10 && basics.labels.includes('danmaku-setting') && basics.labels.includes('mini') && basics.tips >= 10, basics);
  check('控制条展示开播时长（HH:MM:SS）', /^\d{2}:\d{2}:\d{2}$/.test(basics.time), basics.time);
  check('内部面板均为根元素内部 DOM', basics.panels === 6, { panels: basics.panels });

  // 1.1 传入 hls 插件后 setStream 正常首帧（插件负责拉流，live-player 不建加载器）
  await waitFor(`document.querySelector('nova-live-player').getVideoElement().videoWidth > 0`, 15000);
  const hlsFrame = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    const video = player.getVideoElement();
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      readyState: video.readyState,
      src: video.src.slice(0, 24),
      candidates: player.getQualityCandidates().length,
    };
  })()`);
  check(
    '传入 hls 插件后 setStream 能正常首帧并读到插件清晰度',
    hlsFrame.width > 0 && hlsFrame.readyState >= 2 && hlsFrame.candidates > 0,
    hlsFrame,
  );

  // 2. 播放 / 暂停 + 控制条自动隐藏
  await click('#btn-pause');
  const pausedState = await evaluate(`({ paused: document.querySelector('nova-live-player').getVideoElement().paused, barHidden: document.querySelector('.nova-live-player-control').getAttribute('data-visible') === 'false' })`);
  check('暂停生效并派发 pause', pausedState.paused === true && (await logHas('事件 pause')), pausedState);
  await click('#btn-play');
  check('播放生效并派发 play', (await evaluate(`document.querySelector('nova-live-player').getVideoElement().paused`)) === false && (await logHas('事件 play')));
  await sleep(3000);
  const barVisibleState = `document.querySelector('.nova-live-player-control').getAttribute('data-visible')`;
  const hiddenAfterIdle = (await evaluate(barVisibleState)) === 'false';
  await showBar();
  const shownAgain = (await evaluate(barVisibleState)) === 'false';
  check('控制条无操作自动隐藏、鼠标进入重新显示', hiddenAfterIdle === true && shownAgain === false, { hiddenAfterIdle, shownAgain });

  // 3. 静音 / 音量
  const muteBefore = await evaluate(`document.querySelector('nova-live-player').muted`);
  await click('#btn-mute');
  const muteState = await evaluate(`document.querySelector('nova-live-player').muted`);
  check('静音切换生效并派发 mutechange', muteState === !muteBefore && (await logHas('事件 mutechange')), { muteBefore, muteState });
  await click('#btn-mute');
  await click('#btn-volume');
  const volumeState = await evaluate(`({ volume: document.querySelector('nova-live-player').volume, fill: document.querySelector('.nova-live-player-volume-fill').style.height })`);
  check('音量按钮生效且竖向滑块同步', volumeState.volume === 40 && volumeState.fill === '40%' && (await logHas('事件 volumechange')), volumeState);

  // 4. 音量浮层 hover-intent：显示后不能被隐藏计时器立刻关掉
  await evaluate(`document.querySelector('.nova-live-player-control-volume-wrap')?.dispatchEvent(new MouseEvent('mouseenter'))`);
  const popupShown = await evaluate(`document.querySelector('.nova-live-player-volume').hidden === false`);
  await sleep(420);
  const popupStable = await evaluate(`document.querySelector('.nova-live-player-volume').hidden === false`);
  const volumeShot = await captureElement('.nova-live-player-volume', 'volume-popup.png');
  await evaluate(`(() => {
    document.querySelector('.nova-live-player-control-volume-wrap').dispatchEvent(new MouseEvent('mouseleave'));
    document.querySelector('.nova-live-player-volume').dispatchEvent(new MouseEvent('mouseenter'));
  })()`);
  await sleep(320);
  const popupKept = await evaluate(`document.querySelector('.nova-live-player-volume').hidden === false`);
  await evaluate(`document.querySelector('.nova-live-player-volume').dispatchEvent(new MouseEvent('mouseleave'))`);
  await sleep(300);
  const popupHidden = await evaluate(`document.querySelector('.nova-live-player-volume').hidden === true`);
  check(
    '音量浮层 hover 显示后不立即隐藏、移入浮层保持、移出后隐藏',
    popupShown && popupStable && popupKept && popupHidden,
    { popupShown, popupStable, popupKept, popupHidden },
  );
  check('已保存音量浮层截图 artifacts/volume-popup.png', volumeShot);

  // 5. 网页全屏
  await click('#btn-web-full');
  const webOn = await evaluate(`document.querySelector('nova-live-player').dataset.screen`);
  await click('#btn-web-full');
  const webOff = await evaluate(`document.querySelector('nova-live-player').dataset.screen`);
  check('网页全屏进入 / 退出并派发 screenchange', webOn === 'webscreen' && webOff === 'normal' && (await logHas('事件 screenchange')), { webOn, webOff });

  // 6. 清晰度 / 线路：hover 打开 + 两页（整行可点）
  await waitFor(`document.querySelectorAll('.nova-live-player-quality-option').length > 1`, 15000);
  await hoverAction('quality');
  const qualityPage0 = await evaluate(`(() => {
    const panel = document.querySelector('.nova-live-player-quality-panel');
    const pages = panel.querySelectorAll('.nova-live-player-quality-page');
    const entry = panel.querySelector('.nova-live-player-quality-line-entry');
    return {
      visible: panel.hidden === false,
      options: panel.querySelectorAll('.nova-live-player-quality-option').length,
      selected: panel.querySelectorAll('.nova-live-player-quality-option.is-selected').length,
      page0: !pages[0].classList.contains('is-hidden'),
      page1: pages[1].classList.contains('is-hidden'),
      entry: entry?.textContent?.trim(),
      entryWidth: entry ? entry.getBoundingClientRect().width : 0,
      anchored: (() => {
        const btn = document.querySelector('[data-action="quality"]');
        if (!btn) return false;
        const p = panel.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        return Math.abs((p.left + p.right) / 2 - (b.left + b.right) / 2) < 24;
      })(),
    };
  })()`);
  check('清晰度面板 hover 打开、贴图标上方、第一页含整行线路入口', qualityPage0.visible && qualityPage0.options > 1 && qualityPage0.selected === 1 && qualityPage0.page0 && qualityPage0.page1 && qualityPage0.anchored && qualityPage0.entryWidth > 150, qualityPage0);
  await click('.nova-live-player-quality-line-entry');
  const linePage = await evaluate(`(() => {
    const panel = document.querySelector('.nova-live-player-quality-panel');
    return { lines: panel.querySelectorAll('.nova-live-player-line-option').length, page1: panel.querySelectorAll('.nova-live-player-quality-page')[1].hidden === false, back: panel.querySelector('.nova-live-player-quality-back')?.textContent?.trim() };
  })()`);
  check('第二页为线路列表（返回行整行可点）', linePage.lines === 3 && linePage.page1 && linePage.back?.includes('主线'), linePage);
  await click('.nova-live-player-line-option[data-line="backup1"]');
  check('切换线路派发 linechange', (await logHas('事件 linechange')) && (await evaluate(`document.querySelector('nova-live-player').line`)) === 'backup1');
  await hoverAction('quality');
  await click('.nova-live-player-quality-option');
  check('切换清晰度派发 qualitychange 并关闭面板', (await logHas('事件 qualitychange')) && (await evaluate(`document.querySelector('.nova-live-player-quality-panel').hidden`)) === true);

  // 7. 倍速已移除：控制栏不应存在倍速按钮
  const speedRemoved = await evaluate(`document.querySelectorAll('[data-action="speed"]').length === 0`);
  check('直播控制栏已移除倍速', speedRemoved === true, { speedRemoved });

  // 8. 弹幕设置面板（第一页 / 第二页，非 Web Component）
  await hoverAction('danmaku-setting');
  const dmMain = await evaluate(`(() => {
    const panel = document.querySelector('.nova-live-player-dm-setting-panel');
    const box = panel.querySelector('.nova-live-player-dm-setting-box');
    return {
      visible: panel.hidden === false,
      tag: panel.tagName.toLowerCase(),
      sliders: panel.querySelectorAll('.nova-live-player-slider-row').length,
      segments: panel.querySelectorAll('.nova-live-player-segmented-item').length,
      checks: panel.querySelectorAll('.nova-live-player-dm-setting-page-main .nova-live-player-checkbox').length,
      advanced: !!panel.querySelector('.nova-live-player-dm-setting-advanced'),
      radius: getComputedStyle(box).borderRadius,
      width: getComputedStyle(box).width,
      label: panel.querySelector('.nova-live-player-slider-label')?.textContent,
    };
  })()`);
  check('弹幕设置第一页：显示区域 / 密度 / 透明度 / 字号 / 速度 / 两个复选 / 高级设置', dmMain.visible && dmMain.tag === 'div' && dmMain.sliders === 4 && dmMain.segments === 3 && dmMain.checks === 2 && dmMain.advanced && dmMain.label === '显示区域', dmMain);
  check('弹幕设置面板圆角为 8px', dmMain.radius === '8px' && dmMain.width === '320px', { radius: dmMain.radius, width: dmMain.width });
  await click('.nova-live-player-dm-setting-advanced');
  const dmMore = await evaluate(`(() => { const panel = document.querySelector('.nova-live-player-dm-setting-panel'); return { back: !!panel.querySelector('.nova-live-player-dm-setting-back'), selects: panel.querySelectorAll('select').length, strokes: panel.querySelectorAll('.nova-live-player-dm-setting-stroke').length, reset: !!panel.querySelector('.nova-live-player-dm-setting-reset'), width: getComputedStyle(panel.querySelector('.nova-live-player-dm-setting-box')).width, hidden: panel.querySelectorAll('.nova-live-player-dm-setting-page')[1].hidden }; })()`);
  check('弹幕设置第二页：返回 / 字体 / 粗体 / 描边 / 恢复默认', dmMore.back && dmMore.selects === 1 && dmMore.strokes === 3 && dmMore.reset && dmMore.width === '300px' && dmMore.hidden === false, dmMore);
  await click('.nova-live-player-dm-setting-back');
  const beforeSetting = await evaluate(`JSON.stringify(document.querySelector('nova-live-player').getDanmakuSetting())`);
  await click('.nova-live-player-checkbox');
  const afterSetting = await evaluate(`JSON.stringify(document.querySelector('nova-live-player').getDanmakuSetting())`);
  check('弹幕设置改动即时生效并派发 danmakusetting', beforeSetting !== afterSetting && (await logHas('事件 danmakusetting')));
  await evaluate(`document.querySelector('.nova-live-player-video')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await sleep(250);
  check('点击面板外部关闭弹幕设置面板', await evaluate(`document.querySelector('.nova-live-player-dm-setting-panel').hidden`));

  // 9. 控制条弹幕开关 + 关闭后禁止打开弹幕设置
  await showBar();
  await click('[data-action="toggle-danmaku"]');
  const danmakuOff = await evaluate(`(() => {
    const button = document.querySelector('[data-action="danmaku-setting"]');
    const style = getComputedStyle(button);
    return {
      hidden: document.querySelector('nova-live-player-danmaku').hidden,
      active: document.querySelector('[data-action="toggle-danmaku"]').classList.contains('is-active'),
      disabledClass: button.classList.contains('is-disabled'),
      opacity: style.opacity,
      ariaDisabled: button.getAttribute('aria-disabled'),
      pointerEvents: style.pointerEvents,
    };
  })()`);
  check('弹幕关闭后「弹幕设置」按钮 is-disabled 且透明度降低', danmakuOff.hidden === true && danmakuOff.active === false && danmakuOff.disabledClass === true && Number(danmakuOff.opacity) < 1 && danmakuOff.ariaDisabled === 'true' && danmakuOff.pointerEvents !== 'none', danmakuOff);

  await hoverAction('danmaku-setting');
  await sleep(650);
  const blockedHover = await evaluate(`document.querySelector('.nova-live-player-dm-setting-panel').hidden`);
  check('弹幕关闭时 hover 弹幕设置不打开面板', blockedHover === true, { blockedHover });

  await click('[data-action="danmaku-setting"]');
  const blockedClick = await evaluate(`({ hidden: document.querySelector('.nova-live-player-dm-setting-panel').hidden, toast: document.querySelector('.nova-live-player-toast').hidden === false ? document.querySelector('.nova-live-player-toast').textContent : '' })`);
  check('弹幕关闭时点击弹幕设置不打开面板并 Toast 提示', blockedClick.hidden === true && blockedClick.toast.includes('弹幕已关闭，无法打开弹幕设置'), blockedClick);

  const blockedDirect = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    player.openPanel('danmaku');
    return { hidden: document.querySelector('.nova-live-player-dm-setting-panel').hidden, toast: document.querySelector('.nova-live-player-toast').textContent };
  })()`);
  check('openPanel(danmaku) 内部拦截（任何路径都打不开）', blockedDirect.hidden === true && blockedDirect.toast.includes('弹幕已关闭'), blockedDirect);

  await click('#btn-menu');
  const menuBlocked = await evaluate(`(() => {
    const item = document.querySelector('.nova-live-player-menu [data-action="more-danmaku-setting"]');
    return { disabled: item?.dataset.disabled, label: item?.textContent };
  })()`);
  await click('.nova-live-player-menu [data-action="more-danmaku-setting"]');
  const menuBlockedResult = await evaluate(`document.querySelector('.nova-live-player-dm-setting-panel').hidden`);
  check('弹幕关闭时右键「更多弹幕设置」置灰且点击无效', menuBlocked.disabled === 'true' && menuBlockedResult === true, { menuBlocked, menuBlockedResult });
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(200);

  await showBar();
  await click('[data-action="toggle-danmaku"]');
  const danmakuOnBack = await evaluate(`({ hidden: document.querySelector('nova-live-player-danmaku').hidden, disabledClass: document.querySelector('[data-action="danmaku-setting"]').classList.contains('is-disabled') })`);
  check('重新开启弹幕后弹幕设置按钮恢复可用', danmakuOnBack.hidden === false && danmakuOnBack.disabledClass === false, danmakuOnBack);

  // 10. 信息面板（开播时长 + 1Hz 曲线）
  await click('#btn-info');
  const info = await evaluate(`(() => {
    const panel = document.querySelector('.nova-live-player-info');
    const values = Array.from(panel.querySelectorAll('.nova-live-player-info-value')).map((el) => el.textContent);
    return { visible: panel.hidden === false, rows: panel.querySelectorAll('.nova-live-player-info-row').length, liveLabel: Array.from(panel.querySelectorAll('.nova-live-player-info-key')).pop().textContent, liveValue: values[values.length - 1], title: panel.querySelector('.nova-live-player-info-title-text').textContent };
  })()`);
  check('信息面板展示直播信息与开播时长', info.visible && info.rows === 10 && info.title === '直播信息' && info.liveLabel === '已开播' && /^\d{2}:\d{2}:\d{2}$/.test(info.liveValue), info);

  const chartStateExpression = `(() => {
    const panel = document.querySelector('.nova-live-player-info');
    const lines = Array.from(panel.querySelectorAll('polyline'));
    const count = (el) => {
      const points = (el.getAttribute('points') || '').trim();
      return points === '' ? 0 : points.split(' ').length;
    };
    return {
      svgs: panel.querySelectorAll('svg.nova-live-player-info-chart-svg').length,
      lines: lines.length,
      bufferClass: lines[0]?.getAttribute('class') || '',
      droppedClass: lines[1]?.getAttribute('class') || '',
      bufferPoints: count(lines[0]),
      droppedPoints: count(lines[1]),
      titles: Array.from(panel.querySelectorAll('.nova-live-player-info-chart-title')).map((el) => el.textContent),
      canvas: panel.querySelectorAll('canvas').length,
      inlinePoints: lines.some((el) => (el.getAttribute('style') || '').includes('points')),
      panelRect: panel.getBoundingClientRect().height,
      clientHeight: panel.clientHeight,
      scrollHeight: panel.scrollHeight,
      chartHeights: Array.from(panel.querySelectorAll('.nova-live-player-info-chart-body')).map((el) => el.getBoundingClientRect().height),
    };
  })()`;
  const chartInitial = await evaluate(chartStateExpression);
  await sleep(3200);
  const chartLater = await evaluate(chartStateExpression);
  check(
    '信息面板两条 SVG polyline 曲线（缓冲 / 丢帧）且点数随采样增加',
    chartInitial.lines === 2 &&
      chartInitial.svgs === 2 &&
      chartInitial.canvas === 0 &&
      chartInitial.bufferClass.includes('nova-live-player-info-chart-line-buffer') &&
      chartInitial.droppedClass.includes('nova-live-player-info-chart-line-dropped') &&
      chartInitial.titles.join(',') === '缓冲 (ms),丢帧' &&
      chartLater.bufferPoints > chartInitial.bufferPoints &&
      chartLater.droppedPoints > chartInitial.droppedPoints &&
      chartLater.bufferPoints >= 2,
    { chartInitial, chartLater },
  );
  const infoShot = await captureElement('.nova-live-player-info', 'info-chart.png');
  check('已保存 info 曲线图截图 artifacts/info-chart.png', infoShot);
  await click('.nova-live-player-info-close');

  // 11. 快捷键
  await click('#btn-hotkey');
  const hotkey = await evaluate(`(() => { const panel = document.querySelector('.nova-live-player-hotkey'); return { visible: panel.hidden === false, rows: panel.querySelectorAll('.nova-live-player-hotkey-row').length, emptyKeys: !panel.textContent.includes('livePlayer.'), text: panel.querySelector('.nova-live-player-hotkey-title-text')?.textContent }; })()`);
  check('快捷键面板打开且文案国际化正常', hotkey.visible && hotkey.rows >= 6 && hotkey.emptyKeys && hotkey.text === '快捷键说明', hotkey);
  await click('.nova-live-player-hotkey-close');

  // 12. 右键菜单：只剩 4 项（弹幕开关 / 更多弹幕设置 / 视频信息 / 视频编码）
  await click('#btn-menu');
  const menuBasic = await evaluate(`(() => {
    const menu = document.querySelector('.nova-live-player-menu');
    const items = Array.from(menu.querySelectorAll('.nova-live-player-menu-item'));
    return {
      visible: menu.hidden === false,
      items: items.length,
      actions: items.map((el) => el.dataset.action),
      labels: items.map((el) => el.textContent),
      disabled: items.filter((el) => el.dataset.disabled === 'true').length,
    };
  })()`);
  check(
    '右键菜单仅 4 项且含「视频信息」「视频编码」',
    menuBasic.visible &&
      menuBasic.items === 4 &&
      menuBasic.disabled === 0 &&
      menuBasic.actions.join(',') === 'toggle-danmaku,more-danmaku-setting,video-info,video-codec' &&
      menuBasic.labels.includes('视频信息') &&
      menuBasic.labels.includes('视频编码') &&
      !menuBasic.actions.includes('block-user') &&
      !menuBasic.actions.includes('copy-danmaku') &&
      !menuBasic.actions.includes('report-danmaku'),
    menuBasic,
  );
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(200);
  check('Esc 关闭右键菜单', await evaluate(`document.querySelector('.nova-live-player-menu').hidden`));

  // 13. 右键「视频信息」打开信息面板
  await click('#btn-menu');
  await click('.nova-live-player-menu [data-action="video-info"]');
  const menuInfo = await evaluate(`({ infoVisible: document.querySelector('.nova-live-player-info').hidden === false, menuHidden: document.querySelector('.nova-live-player-menu').hidden })`);
  check('右键「视频信息」打开 info 面板', menuInfo.infoVisible && menuInfo.menuHidden, menuInfo);
  await click('.nova-live-player-info-close');

  // 14. 视频编码面板：空态 / 高亮 / 切换 / 事件 / 持久化
  await click('#btn-menu');
  await click('.nova-live-player-menu [data-action="video-codec"]');
  const codecEmpty = await evaluate(`(() => {
    const panel = document.querySelector('.nova-live-player-codec-panel');
    return {
      visible: panel.hidden === false,
      options: panel.querySelectorAll('.nova-live-player-codec-option').length,
      emptyVisible: panel.querySelector('.nova-live-player-codec-empty').hidden === false,
      emptyText: panel.querySelector('.nova-live-player-codec-empty').textContent,
      title: panel.querySelector('.nova-live-player-codec-title-text').textContent,
    };
  })()`);
  check('无候选时编码面板展示空态文案', codecEmpty.visible && codecEmpty.options === 0 && codecEmpty.emptyVisible && codecEmpty.emptyText.includes('暂无可切换') && codecEmpty.title === '视频编码', codecEmpty);
  await click('.nova-live-player-codec-close');

  await evaluate(`document.querySelector('nova-live-player').setCodecCandidates([
    { codec: 'avc', label: 'AVC', hint: 'H.264' },
    { codec: 'hevc', label: 'HEVC', hint: 'H.265' },
    { codec: 'av1', label: 'AV1' }
  ], 'avc')`);
  await click('#btn-menu');
  await click('.nova-live-player-menu [data-action="video-codec"]');
  const codecOpen = await evaluate(`(() => {
    const panel = document.querySelector('.nova-live-player-codec-panel');
    const options = Array.from(panel.querySelectorAll('.nova-live-player-codec-option'));
    return {
      visible: panel.hidden === false,
      options: options.length,
      selected: options.filter((el) => el.classList.contains('is-selected')).map((el) => el.dataset.codec),
      labels: options.map((el) => el.querySelector('.nova-live-player-codec-label')?.textContent),
      title: panel.querySelector('.nova-live-player-codec-title-text').textContent,
    };
  })()`);
  check('编码面板列出 AVC / HEVC / AV1 且当前项高亮', codecOpen.visible && codecOpen.options === 3 && codecOpen.selected.length === 1 && codecOpen.selected[0] === 'avc' && codecOpen.labels.join(',') === 'AVC,HEVC,AV1' && codecOpen.title === '视频编码', codecOpen);

  await click('.nova-live-player-codec-option[data-codec="hevc"]');
  const codecSwitched = await evaluate(`(() => {
    const stored = JSON.parse(localStorage.getItem('lumina.live-player.settings.v1') || '{}');
    const log = document.getElementById('log-list').textContent;
    return {
      closed: document.querySelector('.nova-live-player-codec-panel').hidden,
      codec: document.querySelector('nova-live-player').codec,
      stored: stored.codec,
      event: log.includes('事件 codecchange'),
      detail: log.includes('"codec":"hevc"') && log.includes('"label":"HEVC"'),
      toast: document.querySelector('.nova-live-player-toast').textContent,
    };
  })()`);
  check('切换编码派发 codecchange、关闭面板并持久化', codecSwitched.closed === true && codecSwitched.codec === 'hevc' && codecSwitched.stored === 'hevc' && codecSwitched.event && codecSwitched.detail && codecSwitched.toast.includes('视频编码已切换至 HEVC'), codecSwitched);

  await click('#btn-menu');
  await click('.nova-live-player-menu [data-action="video-codec"]');
  const codecReopen = await evaluate(`(() => {
    const panel = document.querySelector('.nova-live-player-codec-panel');
    const selected = panel.querySelector('.nova-live-player-codec-option.is-selected');
    return { visible: panel.hidden === false, selected: selected?.dataset.codec, emptyHidden: panel.querySelector('.nova-live-player-codec-empty').hidden };
  })()`);
  check('重新打开编码面板时高亮当前编码', codecReopen.visible && codecReopen.selected === 'hevc' && codecReopen.emptyHidden === true, codecReopen);
  const codecShot = await captureElement('.nova-live-player-codec-panel', 'codec-panel.png');
  check('已保存编码面板截图 artifacts/codec-panel.png', codecShot);
  await click('.nova-live-player-codec-close');

  // 15. 错误面板
  await evaluate(`document.querySelector('nova-live-player').showError({ code: 'smoke', message: '冒烟测试错误面板' })`);
  const errorOpen = await evaluate(`document.querySelector('.nova-live-player-error').hidden === false && document.querySelector('.nova-live-player-error-message').textContent === '冒烟测试错误面板'`);
  await evaluate(`document.querySelector('nova-live-player').hideError()`);
  check('错误面板可打开 / 关闭', errorOpen && (await evaluate(`document.querySelector('.nova-live-player-error').hidden`)) === true);

  // 16. reload
  await showBar();
  await click('[data-action="refresh"]');
  check('刷新按钮派发 reload', await waitFor(`document.getElementById('log-list').textContent.includes('事件 reload')`, 6000));

  // 17. 事件覆盖（启动阶段事件早于监听注册，用 demo 日志兜底）
  await evaluate(`document.querySelector('nova-live-player').getVideoElement().dispatchEvent(new Event('progress'))`);
  await sleep(120);
  const logText = await readLog();
  const eventSet = await evaluate(`Array.from(window.__smokeEvents ?? [])`);
  const required = ['ready','play','pause','timeupdate','volumechange','mutechange','qualitychange','qualitycandidates','linechange','linecandidates','codecchange','screenchange','danmakuvisible','danmakusetting','danmakusent','streamchange','reload'];
  const dispatched = (name) => eventSet.includes(name) || logText.includes(`事件 ${name}`);
  const missing = required.filter((name) => !dispatched(name));
  const progressSeen = eventSet.includes('progress') || logText.includes('事件 progress');
  if (!progressSeen) missing.push('progress');
  check('事件覆盖完整（18 类已派发）', missing.length === 0, missing);

  // 18. 持久化
  const parsed = JSON.parse((await evaluate(`localStorage.getItem('lumina.live-player.settings.v1')`)) ?? '{}');
  check(
    '设置已写入 localStorage（音量 / 清晰度 / 线路 / 编码 / 弹幕设置）',
    parsed.volume === 40 && typeof parsed.quality === 'string' && parsed.line === 'backup1' && parsed.codec === 'hevc' && parsed.danmakuVisible === true && parsed.danmakuOpacity === 0.8 && parsed.danmakuFontsize === 25,
    parsed,
  );

  await send('Page.reload', { ignoreCache: true });
  await waitFor(`document.readyState === 'complete'`);
  await waitFor(`document.getElementById('log-list').textContent.includes('恢复音量')`, 20000);
  const restored = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    return { volume: player.volume, fill: document.querySelector('.nova-live-player-volume-fill')?.style.height, quality: player.quality, line: player.line, codec: player.codec, log: document.getElementById('log-list').textContent.includes('恢复音量 40') };
  })()`);
  check('刷新后音量 / 清晰度 / 线路 / 编码从 localStorage 恢复', restored.volume === 40 && restored.fill === '40%' && restored.quality === parsed.quality && restored.line === 'backup1' && restored.codec === 'hevc' && restored.log === true, restored);

  const persistOff = await evaluate(`(() => { const player = document.querySelector('nova-live-player'); player.persist = false; player.setVolume(55); return JSON.parse(localStorage.getItem('lumina.live-player.settings.v1')).volume; })()`);
  const cleared = await evaluate(`(() => { const player = document.querySelector('nova-live-player'); player.persist = true; player.clearPersistedSettings(); return localStorage.getItem('lumina.live-player.settings.v1'); })()`);
  check('persist=false 不写入且 clearPersistedSettings() 可清空', persistOff === 40 && cleared === null, { persistOff, cleared });

  // 18.1 小窗（悬浮 mini 播放器）：入口 / 结构 / 样式 / 拖动 / 持久化 / 关闭 / 滚动联动
  await evaluate(`(async () => {
    const player = document.querySelector('nova-live-player');
    await player.play().catch(() => {});
    return player.getVideoElement().paused === false;
  })()`);
  await sleep(400);
  const miniBase = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    const button = player.querySelector('[data-action="mini"]');
    return {
      button: !!button,
      label: button?.getAttribute('aria-label') ?? null,
      tip: button?.parentElement?.querySelector('.nova-live-player-control-tip')?.textContent ?? null,
      mini: player.mini,
      layer: !!player.querySelector('.nova-live-player-mini'),
      layerHidden: player.querySelector('.nova-live-player-mini')?.hidden ?? null,
    };
  })()`);
  check(
    '控制条存在「小窗」按钮（默认小窗模式，小窗层默认隐藏）',
    miniBase.button &&
      miniBase.label === '小窗模式' &&
      miniBase.tip === '小窗模式' &&
      miniBase.mini === false &&
      miniBase.layer === true &&
      miniBase.layerHidden === true,
    miniBase,
  );

  await click('[data-action="mini"]');
  await sleep(350);
  const miniEntered = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    const header = player.querySelector('.nova-live-player-mini-header');
    const close = player.querySelector('.nova-live-player-mini-close');
    const overlay = player.querySelector('.nova-live-player-mini-overlay');
    const play = player.querySelector('.nova-live-player-mini-play');
    const refresh = player.querySelector('.nova-live-player-mini-refresh');
    const title = player.querySelector('.nova-live-player-mini-title');
    const room = player.querySelector('.nova-live-player-mini-room');
    const button = player.querySelector('[data-action="mini"]');
    const iconWrap = button?.querySelector('.nova-live-player-control-icon');
    const iconHidden = iconWrap ? Array.from(iconWrap.children).map((el) => el.hidden) : [];
    const r = player.getBoundingClientRect();
    const cs = getComputedStyle(player);
    const bar = player.querySelector('nova-live-player-control-bar');
    return {
      mini: player.mini,
      dataMini: player.dataset.mini ?? null,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      position: cs.position,
      radius: cs.borderRadius,
      shadow: cs.boxShadow,
      background: cs.backgroundColor,
      header: !!header,
      headerHeight: header ? getComputedStyle(header).height : null,
      headerCursor: header ? getComputedStyle(header).cursor : null,
      title: title ? title.textContent : null,
      titleOverflow: title ? getComputedStyle(title).textOverflow : null,
      titleWhiteSpace: title ? getComputedStyle(title).whiteSpace : null,
      close: !!close,
      closeTitle: close ? close.getAttribute('title') : null,
      overlay: !!overlay,
      overlayDisplay: overlay ? getComputedStyle(overlay).display : null,
      overlayBackground: overlay ? getComputedStyle(overlay).backgroundColor : null,
      play: !!play,
      playRadius: play ? getComputedStyle(play).borderRadius : null,
      refresh: !!refresh,
      watermark: player.querySelector('.nova-live-player-mini-watermark')?.textContent ?? '',
      room: room ? room.textContent : '',
      buttonLabel: button ? button.getAttribute('aria-label') : null,
      tip: button?.parentElement?.querySelector('.nova-live-player-control-tip')?.textContent ?? null,
      iconHidden,
      controlBar: bar ? getComputedStyle(bar).display : null,
      sameVideo: player.getVideoElement() === player.querySelector('video'),
      playing: player.getVideoElement().paused === false,
      eventLogged: document.getElementById('log-list').textContent.includes('事件 minichange {"mini":true}'),
    };
  })()`);
  check(
    '点击控制栏小窗按钮进入 mini，图标 / tooltip 切换为「退出小窗模式」',
    miniEntered.mini === true &&
      miniEntered.dataMini === 'true' &&
      miniEntered.buttonLabel === '退出小窗模式' &&
      miniEntered.tip === '退出小窗模式' &&
      miniEntered.iconHidden.join(',') === 'true,false' &&
      miniEntered.eventLogged === true,
    {
      mini: miniEntered.mini,
      dataMini: miniEntered.dataMini,
      buttonLabel: miniEntered.buttonLabel,
      tip: miniEntered.tip,
      iconHidden: miniEntered.iconHidden,
      eventLogged: miniEntered.eventLogged,
    },
  );
  check(
    '小窗结构完整：header / 单行省略标题 / 关闭按钮 / 播放+刷新两个 overlay 按钮 / 水印',
    miniEntered.header &&
      miniEntered.title === '演示房间 · 10001' &&
      miniEntered.titleOverflow === 'ellipsis' &&
      miniEntered.titleWhiteSpace === 'nowrap' &&
      miniEntered.close &&
      miniEntered.closeTitle === '关闭悬浮播放器' &&
      miniEntered.play &&
      miniEntered.refresh &&
      miniEntered.watermark.includes('bilibili 直播') &&
      miniEntered.room === '演示房间 · 10001',
    {
      header: miniEntered.header,
      title: miniEntered.title,
      overflow: miniEntered.titleOverflow,
      close: miniEntered.close,
      closeTitle: miniEntered.closeTitle,
      play: miniEntered.play,
      refresh: miniEntered.refresh,
      watermark: miniEntered.watermark,
    },
  );
  check(
    '小窗 380×248、圆角 8px、深色底 + 阴影、头部 34px、可拖动、不显示完整控制条',
    Math.abs(miniEntered.rect.width - 380) <= 1 &&
      Math.abs(miniEntered.rect.height - 248) <= 1.5 &&
      miniEntered.position === 'fixed' &&
      miniEntered.radius === '8px' &&
      miniEntered.background === 'rgb(24, 25, 28)' &&
      miniEntered.shadow !== 'none' &&
      miniEntered.headerHeight === '34px' &&
      miniEntered.headerCursor === 'move' &&
      miniEntered.controlBar === 'none',
    {
      rect: miniEntered.rect,
      position: miniEntered.position,
      radius: miniEntered.radius,
      background: miniEntered.background,
      shadow: miniEntered.shadow,
      headerHeight: miniEntered.headerHeight,
      headerCursor: miniEntered.headerCursor,
      controlBar: miniEntered.controlBar,
    },
  );
  check(
    '小窗与播放器共用同一个 video（不新建元素）且播放不中断',
    miniEntered.sameVideo && miniEntered.playing,
    { sameVideo: miniEntered.sameVideo, playing: miniEntered.playing },
  );
  check(
    '小窗悬停前遮罩隐藏（半透明黑底），播放按钮为白色圆形',
    miniEntered.overlayDisplay === 'none' &&
      miniEntered.overlayBackground === 'rgba(0, 0, 0, 0.5)' &&
      miniEntered.playRadius === '50%',
    {
      overlayDisplay: miniEntered.overlayDisplay,
      overlayBackground: miniEntered.overlayBackground,
      playRadius: miniEntered.playRadius,
    },
  );
  await hoverMini();
  const miniHover = await evaluate(`(() => {
    const overlay = document.querySelector('.nova-live-player-mini-overlay');
    return {
      display: getComputedStyle(overlay).display,
      buttons: Array.from(overlay.querySelectorAll('button')).map((el) => el.className),
    };
  })()`);
  check(
    '小窗 hover 显示半透明遮罩与播放 / 刷新按钮',
    miniHover.display === 'block' && miniHover.buttons.length === 2,
    miniHover,
  );

  // 先拖到视口中部，再按 +120/+80 精确验证拖动；避免默认贴右下角时被视口约束截断。
  await dragMiniHeader(-240, -160);
  const miniCentered = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    const r = player.getBoundingClientRect();
    return { left: r.x, top: r.y };
  })()`);
  const miniShotHover = await captureElement('nova-live-player', 'mini-player.png');
  check('已保存小窗（hover 控制按钮）截图 artifacts/mini-player.png', miniShotHover);
  await leaveMini();
  const miniShotIdle = await captureElement('nova-live-player', 'mini-player-idle.png');
  check('已保存小窗（静置）截图 artifacts/mini-player-idle.png', miniShotIdle);
  await dragMiniHeader(120, 80);
  const miniDragged = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    const r = player.getBoundingClientRect();
    return {
      left: r.x,
      top: r.y,
      width: r.width,
      height: r.height,
      styleLeft: player.style.left,
      styleTop: player.style.top,
      stored: JSON.parse(localStorage.getItem('lumina.live-player.mini-position.v1') || 'null'),
      inViewport:
        r.x >= 0 && r.y >= 0 && r.x + r.width <= innerWidth + 0.5 && r.y + r.height <= innerHeight + 0.5,
    };
  })()`);
  check(
    '按住 header 拖动 (+120, +80)：位置同步变化且不越界',
    Math.abs(miniDragged.left - (miniCentered.left + 120)) <= 2 &&
      Math.abs(miniDragged.top - (miniCentered.top + 80)) <= 2 &&
      miniDragged.inViewport === true &&
      miniDragged.styleLeft === `${Math.round(miniDragged.left)}px` &&
      miniDragged.styleTop === `${Math.round(miniDragged.top)}px`,
    { miniCentered, miniDragged },
  );
  check(
    '拖动后小窗位置写入 localStorage 新键',
    miniDragged.stored !== null &&
      miniDragged.stored.left === Math.round(miniDragged.left) &&
      miniDragged.stored.top === Math.round(miniDragged.top),
    { stored: miniDragged.stored },
  );
  const miniShotDragged = await captureElement('nova-live-player', 'mini-player-dragged.png');
  check('已保存拖动后位置截图 artifacts/mini-player-dragged.png', miniShotDragged);
  // 整页截图：能看到小窗相对视口的位置（拖动后不在默认右下角）。
  const miniViewport = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'mini-player-position.png'), Buffer.from(miniViewport.data, 'base64'));
  check(
    '已保存拖动后整页截图 artifacts/mini-player-position.png',
    fs.existsSync(path.join(artifactDir, 'mini-player-position.png')),
  );

  // 位置持久化：刷新页面后再次进入小窗应恢复到拖动后的坐标。
  await send('Page.reload', { ignoreCache: true });
  await waitFor(`document.readyState === 'complete'`);
  await waitFor(
    `!!document.querySelector('nova-live-player') && document.querySelector('nova-live-player').getVideoElement().videoWidth > 0`,
    30000,
  );
  await sleep(600);
  const miniRestored = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    player.enterMini();
    const r = player.getBoundingClientRect();
    return { mini: player.mini, left: Math.round(r.x), top: Math.round(r.y), stored: JSON.parse(localStorage.getItem('lumina.live-player.mini-position.v1') || 'null') };
  })()`);
  check(
    '刷新后再次进入小窗，位置从 localStorage 恢复',
    miniRestored.mini === true &&
      miniRestored.stored !== null &&
      miniRestored.left === miniRestored.stored.left &&
      miniRestored.top === miniRestored.stored.top,
    miniRestored,
  );

  // 关闭按钮：退出 mini + 派发 minichange {mini:false} + scrollIntoView 回原位置
  await leaveMini();
  await evaluate(`document.querySelector('.nova-live-player-mini-close').click()`);
  const miniClosed = await waitFor(`document.querySelector('nova-live-player').dataset.mini !== 'true'`, 5000);
  await sleep(800);
  const miniClosedState = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    const r = player.getBoundingClientRect();
    const log = document.getElementById('log-list').textContent;
    return {
      mini: player.mini,
      dataMini: player.dataset.mini ?? null,
      styleLeft: player.style.left,
      top: Math.round(r.top),
      visible: r.top < innerHeight && r.bottom > 0,
      event: log.includes('事件 minichange {"mini":false}'),
    };
  })()`);
  check(
    '关闭按钮退出 mini、派发 minichange {mini:false} 并 scrollIntoView 回到播放器',
    miniClosed &&
      miniClosedState.mini === false &&
      miniClosedState.event === true &&
      miniClosedState.visible === true &&
      miniClosedState.styleLeft === '',
    miniClosedState,
  );

  // 滚动自动弹出 / 滚回自动退出
  await evaluate(`(async () => {
    const player = document.querySelector('nova-live-player');
    await player.play().catch(() => {});
    window.scrollTo(0, document.documentElement.scrollHeight);
    return true;
  })()`);
  const miniAutoOpen = await waitFor(`document.querySelector('nova-live-player').dataset.mini === 'true'`, 7000);
  const miniAutoOpenState = await evaluate(`(() => ({
    mini: document.querySelector('nova-live-player').mini,
    scrollY: Math.round(window.scrollY),
    anchor: !!document.querySelector('.nova-live-player-mini-anchor'),
  }))()`);
  check(
    '播放器完全滚出视口后自动进入 mini（IntersectionObserver threshold 0）',
    miniAutoOpen && miniAutoOpenState.mini === true && miniAutoOpenState.anchor === true,
    miniAutoOpenState,
  );
  const miniScrollShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, 'mini-player-autoscroll.png'),
    Buffer.from(miniScrollShot.data, 'base64'),
  );
  check(
    '已保存滚动自动弹出整页截图 artifacts/mini-player-autoscroll.png',
    fs.existsSync(path.join(artifactDir, 'mini-player-autoscroll.png')),
  );
  await evaluate(`window.scrollTo(0, 0)`);
  const miniAutoClose = await waitFor(`document.querySelector('nova-live-player').dataset.mini !== 'true'`, 7000);
  const miniAutoCloseState = await evaluate(`(() => ({
    mini: document.querySelector('nova-live-player').mini,
    scrollY: Math.round(window.scrollY),
    controlBar: getComputedStyle(document.querySelector('nova-live-player-control-bar')).display,
  }))()`);
  check(
    '滚回可见后自动退出 mini 并恢复控制条',
    miniAutoClose && miniAutoCloseState.mini === false && miniAutoCloseState.controlBar !== 'none',
    miniAutoCloseState,
  );

  // 19. 弹幕文字：无 -webkit-text-stroke，描边只由多层 text-shadow 承担
  await evaluate(`document.querySelector('nova-live-player').resetDanmakuSetting()`);
  await sleep(2300);
  // 通过插件 API 补几条在飞弹幕，保证截图能看清文字宽度与描边。
  await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    ['弹幕宽度恢复正常', '描边只走 text-shadow', '文字不再被压窄 123', 'Nova live player'].forEach((text, index) => {
      player.sendDanmaku(text, { color: index % 2 === 0 ? '#FFFFFF' : '#FFD5A2' });
    });
    return true;
  })()`);
  await sleep(1400);
  const dmStyle = await evaluate(`(() => {
    const el = document.querySelector('.danmaku-x-dm');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      strokeWidth: cs.webkitTextStrokeWidth || cs.getPropertyValue('-webkit-text-stroke-width') || '0px',
      strokeShorthand: cs.getPropertyValue('-webkit-text-stroke'),
      textShadow: cs.textShadow,
      width: el.getBoundingClientRect().width,
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily,
      fontWeight: cs.fontWeight,
    };
  })()`);
  const shadowLayerCount =
    typeof dmStyle?.textShadow === 'string' && dmStyle.textShadow !== 'none'
      ? dmStyle.textShadow.split(/,(?![^()]*\))/).length
      : 0;
  check(
    '弹幕文字无 -webkit-text-stroke，描边由多层 text-shadow 承担（宽度正常）',
    !!dmStyle &&
      dmStyle.strokeWidth === '0px' &&
      /^0px\b/.test(dmStyle.strokeShorthand ?? '0px') &&
      shadowLayerCount >= 4 &&
      dmStyle.width > 0 &&
      dmStyle.width >= parseFloat(dmStyle.fontSize) &&
      dmStyle.fontFamily.includes('SimHei'),
    { ...dmStyle, shadowLayerCount },
  );
  const danmakuShot = await captureElement('.nova-live-player-danmaku-layer', 'danmaku-text.png');
  check('已保存弹幕文字截图 artifacts/danmaku-text.png', danmakuShot);

  // 20. 未传插件：弹幕层不渲染 + 入口禁用 Toast；流插件缺失回退原生 + Toast
  const noPlugin = await evaluate(`(async () => {
    const old = document.getElementById('smoke-no-plugin');
    if (old) old.remove();
    const el = document.createElement('nova-live-player');
    el.id = 'smoke-no-plugin';
    el.options = { locale: 'zh-CN', persist: false, muted: true };
    el.dataset.test = 'no-plugin';
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.top = '0';
    el.style.width = '640px';
    el.style.height = '360px';
    el.style.zIndex = '9999';
    document.body.appendChild(el);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const toggle = el.querySelector('[data-action="toggle-danmaku"]');
    const setting = el.querySelector('[data-action="danmaku-setting"]');
    const info = {
      danmakuLayer: !!el.querySelector('nova-live-player-danmaku'),
      toggleDisabled: !!toggle?.classList.contains('is-disabled'),
      settingDisabled: !!setting?.classList.contains('is-disabled'),
      toggleAria: toggle?.getAttribute('aria-disabled'),
    };
    toggle?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    info.toast = el.querySelector('.nova-live-player-toast')?.textContent ?? '';
    el.setStream('http://127.0.0.1:9000/video/dash2/master-segmentbase.m3u8');
    await new Promise((resolve) => setTimeout(resolve, 120));
    info.streamToast = el.querySelector('.nova-live-player-toast')?.textContent ?? '';
    info.nativeSrc = el.getVideoElement()?.src ?? '';
    return info;
  })()`);
  check(
    '未传弹幕插件：弹幕层不渲染 + 控制条入口禁用 + Toast 提示',
    noPlugin.danmakuLayer === false &&
      noPlugin.toggleDisabled === true &&
      noPlugin.settingDisabled === true &&
      noPlugin.toggleAria === 'true' &&
      noPlugin.toast.includes('未提供弹幕插件'),
    noPlugin,
  );
  check(
    '未传流插件：.m3u8 回退原生 video 并 Toast 提示',
    noPlugin.streamToast.includes('未提供对应流插件') && noPlugin.nativeSrc.includes('.m3u8'),
    noPlugin,
  );
  await evaluate(`(() => {
    const el = document.getElementById('smoke-no-plugin');
    el?.destroy?.();
    el?.remove();
    return true;
  })()`);

  // 21. 截图（控制条 + 弹幕设置第一页）
  await showBar();
  await hoverAction('danmaku-setting');
  await sleep(500);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'demo-overview.png'), Buffer.from(screenshot.data, 'base64'));
  check('已保存 demo 截图 artifacts/demo-overview.png', fs.existsSync(path.join(artifactDir, 'demo-overview.png')));

  const failures = results.filter((item) => !item.ok);
  console.log(`SUMMARY ${results.length - failures.length}/${results.length} passed, ${failures.length} failed`);
  if (failures.length > 0) console.log(`FAILED: ${failures.map((item) => item.name).join(' | ')}`);
  return failures.length === 0;
};

let success = false;
try {
  success = await run();
} catch (error) {
  console.error('SMOKE ERROR', error);
} finally {
  try {
    socket?.close();
  } catch {
    // 忽略。
  }
  chrome.kill();
  await sleep(500);
}

process.exit(success ? 0 : 1);
