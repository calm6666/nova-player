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

const readLog = async () => (await evaluate(`document.getElementById('log-list').textContent`)) ?? '';
const logHas = async (value) => (await readLog()).includes(value);

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
    ['ready','play','pause','timeupdate','progress','volumechange','mutechange','qualitychange','qualitycandidates','linechange','linecandidates','screenchange','danmakuvisible','danmakusetting','danmakusent','streamchange','reload'].forEach((name) => {
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
  check('控制条 9 个动作（含弹幕设置图标）与 tooltip', basics.controls === 9 && basics.labels.includes('danmaku-setting') && basics.tips >= 9, basics);
  check('控制条展示开播时长（HH:MM:SS）', /^\d{2}:\d{2}:\d{2}$/.test(basics.time), basics.time);
  check('内部面板均为根元素内部 DOM', basics.panels === 5);

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

  // 4. 音量浮层 hover 不中断
  await evaluate(`document.querySelector('.nova-live-player-control-volume-wrap')?.dispatchEvent(new MouseEvent('mouseenter'))`);
  const popupShown = await evaluate(`document.querySelector('.nova-live-player-volume').hidden === false`);
  await evaluate(`(() => {
    document.querySelector('.nova-live-player-control-volume-wrap').dispatchEvent(new MouseEvent('mouseleave'));
    document.querySelector('.nova-live-player-volume').dispatchEvent(new MouseEvent('mouseenter'));
  })()`);
  await sleep(320);
  const popupKept = await evaluate(`document.querySelector('.nova-live-player-volume').hidden === false`);
  await evaluate(`document.querySelector('.nova-live-player-volume').dispatchEvent(new MouseEvent('mouseleave'))`);
  await sleep(300);
  const popupHidden = await evaluate(`document.querySelector('.nova-live-player-volume').hidden === true`);
  check('音量浮层鼠标移入滑块不关闭', popupShown && popupKept && popupHidden, { popupShown, popupKept, popupHidden });

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

  // 9. 控制条弹幕开关
  await showBar();
  await click('[data-action="toggle-danmaku"]');
  const danmakuOff = await evaluate(`({ hidden: document.querySelector('nova-live-player-danmaku').hidden, active: document.querySelector('[data-action="toggle-danmaku"]').classList.contains('is-active') })`);
  await click('[data-action="toggle-danmaku"]');
  check('控制条弹幕开关可关闭 / 重新开启', danmakuOff.hidden === true && danmakuOff.active === false && (await evaluate(`document.querySelector('nova-live-player-danmaku').hidden`)) === false, danmakuOff);

  // 10. 信息面板（开播时长）
  await click('#btn-info');
  const info = await evaluate(`(() => {
    const panel = document.querySelector('.nova-live-player-info');
    const values = Array.from(panel.querySelectorAll('.nova-live-player-info-value')).map((el) => el.textContent);
    return { visible: panel.hidden === false, rows: panel.querySelectorAll('.nova-live-player-info-row').length, liveLabel: Array.from(panel.querySelectorAll('.nova-live-player-info-key')).pop().textContent, liveValue: values[values.length - 1], title: panel.querySelector('.nova-live-player-info-title-text').textContent };
  })()`);
  check('信息面板展示直播信息与开播时长', info.visible && info.rows === 10 && info.title === '直播信息' && info.liveLabel === '已开播' && /^\d{2}:\d{2}:\d{2}$/.test(info.liveValue), info);
  await click('.nova-live-player-info-close');

  // 11. 快捷键
  await click('#btn-hotkey');
  const hotkey = await evaluate(`(() => { const panel = document.querySelector('.nova-live-player-hotkey'); return { visible: panel.hidden === false, rows: panel.querySelectorAll('.nova-live-player-hotkey-row').length, emptyKeys: !panel.textContent.includes('livePlayer.'), text: panel.querySelector('.nova-live-player-hotkey-title-text')?.textContent }; })()`);
  check('快捷键面板打开且文案国际化正常', hotkey.visible && hotkey.rows >= 6 && hotkey.emptyKeys && hotkey.text === '快捷键说明', hotkey);
  await click('.nova-live-player-hotkey-close');

  // 12. 右键菜单
  await click('#btn-menu');
  const menuBasic = await evaluate(`(() => { const menu = document.querySelector('.nova-live-player-menu'); return { visible: menu.hidden === false, items: menu.querySelectorAll('.nova-live-player-menu-item').length, disabled: menu.querySelectorAll('[data-disabled="true"]').length }; })()`);
  check('右键菜单打开（空白处 3 项禁用）', menuBasic.visible && menuBasic.items === 5 && menuBasic.disabled === 3, menuBasic);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(200);
  check('Esc 关闭右键菜单', await evaluate(`document.querySelector('.nova-live-player-menu').hidden`));

  // 13. 命中弹幕 → 举报弹窗
  const hitTarget = await evaluate(`(async () => {
    const player = document.querySelector('nova-live-player');
    const stage = player.querySelector('.nova-live-player');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const items = Array.from(document.querySelectorAll('.danmaku-x-dm'));
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        if (rect.width <= 0) continue;
        item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: rect.left + 8, clientY: rect.top + 6 }));
        if (player.hoveredDanmaku) {
          stage.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rect.left + 8, clientY: rect.top + 6 }));
          await new Promise((resolve) => setTimeout(resolve, 160));
          return { target: player.hoveredDanmaku, menuVisible: !document.querySelector('.nova-live-player-menu').hidden };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return null;
  })()`);
  check('悬停弹幕可被识别并打开目标菜单', !!hitTarget && hitTarget.menuVisible, hitTarget);
  await sleep(160);
  const menuTarget = await evaluate(`(() => { const menu = document.querySelector('.nova-live-player-menu'); const report = menu.querySelector('[data-action="report-danmaku"]'); return { visible: menu.hidden === false, enabled: report?.dataset.disabled === 'false' }; })()`);
  check('右键命中弹幕时举报项可用', menuTarget.visible && menuTarget.enabled, menuTarget);
  await click('.nova-live-player-menu [data-action="report-danmaku"]');
  const reportOpen = await evaluate(`(() => { const report = document.querySelector('.nova-live-player-report'); return { visible: report.hidden === false, placeholder: report.querySelector('.nova-live-player-report-placeholder').hidden === false, submitDisabled: report.querySelector('.nova-live-player-report-submit').disabled }; })()`);
  check('举报弹窗打开且未选理由时提交禁用', reportOpen.visible && reportOpen.placeholder && reportOpen.submitDisabled, reportOpen);
  await click('.nova-live-player-report-reason[data-reason="2"]');
  const reportSelected = await evaluate(`(() => { const report = document.querySelector('.nova-live-player-report'); return { selected: report.querySelector('.nova-live-player-report-reason[data-reason="2"]').classList.contains('is-selected'), submitDisabled: report.querySelector('.nova-live-player-report-submit').disabled }; })()`);
  check('选择举报理由后提交可用且高亮', reportSelected.selected && reportSelected.submitDisabled === false, reportSelected);
  await click('.nova-live-player-report-cancel');
  const reportClosed = await evaluate(`({ hidden: document.querySelector('.nova-live-player-report').hidden, toast: document.querySelector('.nova-live-player-toast').hidden === false ? document.querySelector('.nova-live-player-toast').textContent : '' })`);
  check('取消按钮可关闭举报弹窗', reportClosed.hidden === true && reportClosed.toast.includes('已取消举报'), reportClosed);

  // 14. 错误面板
  await evaluate(`document.querySelector('nova-live-player').showError({ code: 'smoke', message: '冒烟测试错误面板' })`);
  const errorOpen = await evaluate(`document.querySelector('.nova-live-player-error').hidden === false && document.querySelector('.nova-live-player-error-message').textContent === '冒烟测试错误面板'`);
  await evaluate(`document.querySelector('nova-live-player').hideError()`);
  check('错误面板可打开 / 关闭', errorOpen && (await evaluate(`document.querySelector('.nova-live-player-error').hidden`)) === true);

  // 15. reload
  await showBar();
  await click('[data-action="refresh"]');
  check('刷新按钮派发 reload', await waitFor(`document.getElementById('log-list').textContent.includes('事件 reload')`, 6000));

  // 16. 事件覆盖
  await evaluate(`document.querySelector('nova-live-player').getVideoElement().dispatchEvent(new Event('progress'))`);
  await sleep(120);
  const logText = await readLog();
  const eventSet = await evaluate(`Array.from(window.__smokeEvents ?? [])`);
  const required = ['ready','play','pause','timeupdate','volumechange','mutechange','qualitychange','qualitycandidates','linechange','linecandidates','screenchange','danmakuvisible','danmakusetting','danmakusent','streamchange','reload'];
  const missing = required.filter((name) => !logText.includes(`事件 ${name}`));
  if (!eventSet.includes('progress')) missing.push('progress');
  check('事件覆盖完整（17 类已派发）', missing.length === 0, missing);

  // 17. 持久化
  const parsed = JSON.parse((await evaluate(`localStorage.getItem('lumina.live-player.settings.v1')`)) ?? '{}');
  check(
    '设置已写入 localStorage（音量 / 清晰度 / 线路 / 弹幕设置）',
    parsed.volume === 40 && typeof parsed.quality === 'string' && parsed.line === 'backup1' && parsed.danmakuVisible === true && parsed.danmakuOpacity === 0.8 && parsed.danmakuFontsize === 25,
    parsed,
  );

  await send('Page.reload', { ignoreCache: true });
  await waitFor(`document.readyState === 'complete'`);
  await waitFor(`document.getElementById('log-list').textContent.includes('恢复音量')`, 20000);
  const restored = await evaluate(`(() => {
    const player = document.querySelector('nova-live-player');
    return { volume: player.volume, fill: document.querySelector('.nova-live-player-volume-fill')?.style.height, quality: player.quality, line: player.line, log: document.getElementById('log-list').textContent.includes('恢复音量 40') };
  })()`);
  check('刷新后音量 / 清晰度 / 线路从 localStorage 恢复', restored.volume === 40 && restored.fill === '40%' && restored.quality === parsed.quality && restored.line === 'backup1' && restored.log === true, restored);

  const persistOff = await evaluate(`(() => { const player = document.querySelector('nova-live-player'); player.persist = false; player.setVolume(55); return JSON.parse(localStorage.getItem('lumina.live-player.settings.v1')).volume; })()`);
  const cleared = await evaluate(`(() => { const player = document.querySelector('nova-live-player'); player.persist = true; player.clearPersistedSettings(); return localStorage.getItem('lumina.live-player.settings.v1'); })()`);
  check('persist=false 不写入且 clearPersistedSettings() 可清空', persistOff === 40 && cleared === null, { persistOff, cleared });

  // 18. 截图（重置弹幕设置为默认值后，控制条 + 弹幕设置第一页）
  await evaluate(`document.querySelector('nova-live-player').resetDanmakuSetting()`);
  await sleep(2300);
  await showBar();
  await hoverAction('danmaku-setting');
  await sleep(500);
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const artifactDir = path.resolve(import.meta.dirname, '../artifacts');
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
