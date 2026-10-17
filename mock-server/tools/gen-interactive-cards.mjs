#!/usr/bin/env node
/**
 * ============================================================================
 * 互动卡片生成器（离线脚本 + 可被 server.js import 的库）
 * ============================================================================
 *
 * 作用：为**每个视频**（互动视频的每个 avid、以及首页第一张卡的默认视频）生成
 *       一组随机互动卡片，落盘成 JSON，供 mock 的两个接口读取：
 *
 *   node tools/gen-interactive-cards.mjs                 # 生成（同 seed 同结果）
 *   node tools/gen-interactive-cards.mjs --check          # 只校验已有文件，不写盘
 *   node tools/gen-interactive-cards.mjs --seed 12345     # 换种子
 *   node tools/gen-interactive-cards.mjs --fetch-default-mpd
 *                                                        # 联网取默认视频真实时长
 *                                                        # （默认只读本地文件/兜底常量）
 *
 * 产物：
 *   interactive/huaqiang/cards.json   互动视频每个 avid 的卡片 + 时长索引
 *   interactive/default/cards.json    默认视频（第一张卡）的卡片
 *
 * 时长从哪来（D 项要求"从该 avid 的实际媒体时长/清单里取"）：
 *   out/huaqiang/<avid>/index.mpd   → mediaPresentationDuration="PT#M#S"
 *   out/huaqiang/<avid>/index.m3u8  → 各 #EXTINF 求和（取整段时长）
 *   out/huaqiang/<avid>/dash.json | hls.json → duration 字段（转码脚本写的，兜底）
 *   默认视频：interactive/default/index.mpd（本地有就用），否则兜底常量
 *             （MinIO 上 dash2/output-segmentbase.mpd 实测 PT4M13.6S = 253.6s）。
 *
 * 生成规则（D 项硬要求，一条都不能少）：
 *   1. **随机**：一个视频可以零张、也可以多张；
 *   2. **同一时间段内不允许重叠两张卡片** —— 实现上把时长切成若干个互不相交的
 *      时间槽，每张卡只落在**自己的那一个槽**里，槽之间天然不重叠；
 *   3. **guide 每个视频最多一张**（先掷骰子决定"要不要引导卡"，再从已有卡里挑一张改）；
 *   4. **scoreSum 必须建立在同一视频已有 score 的基础上**（要求和卡就先保证有评分卡，
 *      没有评分卡时**绝不**产出 scoreSum）；
 *   5. **不得超出该视频时长**（所有 timeStart/timeEnd 都夹在 [0, duration] 内）；
 *   6. **可重复运行且结果稳定**：种子固定，且每个 avid 用**自己的**种子
 *      （hash(SEED + ':' + avid)）→ 单个视频增删不影响其它视频的卡片。
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* mock-server 根目录：本文件在 <root>/tools/ 下 */
export const MOCK_ROOT = path.resolve(__dirname, '..');
export const INTERACTIVE_ROOT = path.join(MOCK_ROOT, 'interactive');
export const HUAQIANG_OUT = path.join(INTERACTIVE_ROOT, 'videos', 'huaqiang', 'out', 'huaqiang');
export const HUAQIANG_STORY = path.join(INTERACTIVE_ROOT, 'huaqiang', 'story.json');
export const HUAQIANG_CARDS = path.join(INTERACTIVE_ROOT, 'huaqiang', 'cards.json');
export const DEFAULT_CARDS = path.join(INTERACTIVE_ROOT, 'default', 'cards.json');
export const DEFAULT_MPD_LOCAL = path.join(INTERACTIVE_ROOT, 'default', 'index.mpd');
export const DEFAULT_MPD_URL = 'http://127.0.0.1:9000/video/dash2/output-segmentbase.mpd';

/* 默认种子：写死，保证"同 seed 同结果"；--seed 可覆盖 */
export const DEFAULT_SEED = 20261015;

/* 兜底时长（MinIO dash2/output-segmentbase.mpd 实测值），单位秒 */
export const DEFAULT_VIDEO_DURATION_SEC = 253.6;

/*
 * 默认视频（首页第一张卡）用的种子偏移。
 * 为什么单独偏移一位：它是"默认卡接口"的样板视频，需要**一定有一组能看的卡片**
 * （零张虽然合法，但那样首页第一张卡点开什么都不会出现，看不出接口是否接通）。
 * 偏移是固定常量 → 依旧"同 seed 同结果"，不影响互动视频那 88 个 avid 的随机性。
 */
export const DEFAULT_VIDEO_SEED_OFFSET = 1;

/* 卡片类型（与已移植的 InteractionApiPanel.kindKeys / mock 的 INTERACTION_KINDS 一致） */
export const CARD_KINDS = ['guide', 'link', 'vote', 'score', 'scoreSum'];

/* ---- 抽帧预览图参数（与 server.js / transcode_huaqiang.py 对齐，这里只做时长换算） ---- */
const FRAME_INTERVAL_SEC = 5;

/* 单个视频最多几张卡（时长越长越可能多，但不超过这个上限） */
const MAX_CARDS = 6;
/* 一张卡占用的时间槽最短长度（秒）：太短的槽放不下"2 秒以上"的卡 */
const MIN_SLOT_SEC = 8;

/* ---------------------------------------------------------------- 随机数 */

/**
 * 字符串 → 32 位整数种子（FNV-1a）。用途：给每个 avid 一个**独立且稳定**的种子。
 * 不用 Math.random：那会导致"同一次生成里两次结果都不一样"，也做不到可重复运行。
 */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32：32 位整数种子 → [0,1) 均匀随机序列（快、无依赖、结果稳定） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 给某个 avid 造一台随机数发生器（同一个 avid + 同一个 seed → 完全相同的序列） */
export function rngFor(seed, avid) {
  return mulberry32(hashSeed(`${seed}:${avid}`));
}

/* ---------------------------------------------------------------- 时长解析 */

/** ISO8601 时长 PT#H#M#S(.fff) → 秒 */
export function parseIsoDuration(text) {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/
    .exec(String(text || '').trim());
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (Number(d || 0) * 86400) + (Number(h || 0) * 3600)
    + (Number(min || 0) * 60) + Number(s || 0);
}

/** 从 index.mpd 里取 mediaPresentationDuration（没有就退而取 Period 的 duration） */
export function durationFromMpd(text) {
  const mpd = /mediaPresentationDuration\s*=\s*"([^"]+)"/.exec(text || '');
  if (mpd) return parseIsoDuration(mpd[1]);
  const period = /<Period[^>]*\bduration\s*=\s*"([^"]+)"/.exec(text || '');
  if (period) return parseIsoDuration(period[1]);
  return 0;
}

/** index.m3u8：把媒体播放列表里的 #EXTINF 全部加起来（master 列表没有 EXTINF → 0） */
export function durationFromM3u8(text) {
  const lines = String(text || '').split(/\r?\n/);
  let total = 0;
  for (const line of lines) {
    const m = /^#EXTINF:\s*([0-9]+(?:\.[0-9]+)?)/.exec(line.trim());
    if (m) total += Number(m[1]);
  }
  return total;
}

async function readTextIfExists(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 取一个 avid 目录的时长（秒）与来源。
 * 按 D 项要求先扫 index.mpd / index.m3u8，再退回转码脚本写的 dash.json / hls.json。
 */
export async function readAvidDuration(dir) {
  const mpd = await readTextIfExists(path.join(dir, 'index.mpd'));
  if (mpd) {
    const sec = durationFromMpd(mpd);
    if (sec > 0) return { seconds: sec, source: 'index.mpd' };
  }

  const m3u8 = await readTextIfExists(path.join(dir, 'index.m3u8'));
  if (m3u8) {
    const sec = durationFromM3u8(m3u8);
    if (sec > 0) return { seconds: sec, source: 'index.m3u8' };
  }

  for (const name of ['dash.json', 'hls.json']) {
    const raw = await readTextIfExists(path.join(dir, name));
    if (!raw) continue;
    try {
      const sec = Number(JSON.parse(raw).duration);
      if (Number.isFinite(sec) && sec > 0) return { seconds: sec, source: name };
    } catch {
      /* JSON 坏了就继续找下一个 */
    }
  }

  return { seconds: 0, source: 'unknown' };
}

/** 扫描 out/huaqiang/av* 目录得到 { avid: {seconds, source} }（排序稳定 → 结果稳定） */
export async function scanAvidDurations() {
  let names = [];
  try {
    names = await fsp.readdir(HUAQIANG_OUT);
  } catch {
    return {};
  }

  const out = {};
  for (const name of names.filter((n) => /^av[0-9A-Za-z_-]+$/.test(n)).sort()) {
    const dir = path.join(HUAQIANG_OUT, name);
    const st = await fsp.stat(dir).catch(() => null);
    if (!st || !st.isDirectory()) continue;
    const info = await readAvidDuration(dir);
    if (info.seconds > 0) out[name] = info;
  }
  return out;
}

/* ---------------------------------------------------------------- 文案池 */

const GUIDE_TITLES = ['一键三连', '三连支持一下', '别忘了三连', '点赞投币收藏'];
const GUIDE_OPTIONS = ['点赞投币收藏', '已三连', '下次一定'];

const LINK_TITLES = ['跳转番外', '相关推荐', '点我看原片', '外链：名场面合集'];
const LINK_OPTIONS = ['点我跳转', '去看看', '打开链接'];

const VOTE_TITLES = ['接下来怎么走？', '你选哪条路？', '华强该怎么办？', '这一刀砍不砍？'];
const VOTE_OPTIONS = ['砍他', '算了', '先问问', '转身就走', '再等等', '给个面子', '报警', '自己上'];

const SCORE_TITLES = ['给这一段打个分', '本段评分', '这段剧情几分？', '表演打分'];
const SCORE_OPTIONS = ['演技在线', '节奏不错', '一般般', '很有味道'];

const SUM_TITLES = ['本视频评分总结', '综合评分', '大家怎么看', '总体评价'];
const SUM_OPTIONS = ['整体满意', '值得再看', '中规中矩'];

/** 从池里稳定取一个（索引由 rng 决定） */
function pick(rng, pool) {
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

/* ---------------------------------------------------------------- 卡片生成 */

/**
 * 为一个视频生成卡片数组。
 *
 * @param {string} avid          视频 id（互动节点是 av1000xxx，默认视频是 "default"）
 * @param {number} durationSec   该视频时长（秒）；<= 0 时返回空数组（不猜时长）
 * @param {number} seed          全局种子
 * @param {string[]} targetIds   可选的 targetNodeId 池（剧情树节点 id；没有就留空串）
 * @returns {object[]}           卡片数组
 */
export function generateCards(avid, durationSec, seed, targetIds = []) {
  const duration = Number(durationSec) || 0;
  /* 太短的视频放不下"2 秒以上、且不与别的卡重叠"的卡片 → 零张（合法结果） */
  if (duration < MIN_SLOT_SEC) return [];

  const rng = rngFor(seed, avid);

  /* 时间槽：把 [0, duration] 等分，卡只落在自己的槽里 —— 这是"互不重叠"的实现方式 */
  const slotCount = Math.max(1, Math.min(MAX_CARDS, Math.floor(duration / MIN_SLOT_SEC)));
  const slotLen = duration / slotCount;

  /* 一个视频可以**零张**：先掷一次"这个视频要不要卡片" */
  if (rng() < 0.12) return [];

  /* 逐槽决定要不要放卡（每个槽独立，所以 0~slotCount 张都可能） */
  const usedSlots = [];
  for (let i = 0; i < slotCount; i += 1) {
    if (rng() < 0.55) usedSlots.push(i);
  }
  /* 全都没选中也算合法（零张）；为了"多张"也能出现，这里不再强行补一张 */

  if (usedSlots.length === 0) return [];

  const wantGuide = rng() < 0.35;
  /* scoreSum 必须有 score 打底：先决定要不要求和卡，需要就至少留两个槽（一个评分、一个求和） */
  let wantSum = rng() < 0.5;
  if (wantSum && usedSlots.length < 2) wantSum = false;

  const kinds = new Array(usedSlots.length).fill('');

  if (wantSum) {
    /* 头两个槽：一个评分、一个求和；哪个在前随机（但槽本身已经保证不重叠） */
    const a = 0;
    const b = 1;
    if (rng() < 0.5) {
      kinds[a] = 'score';
      kinds[b] = 'scoreSum';
    } else {
      kinds[a] = 'scoreSum';
      kinds[b] = 'score';
    }
  }

  /* 其余槽在 link / vote / score 里挑（score 多一些，方便"总结"有数据可依） */
  for (let i = 0; i < kinds.length; i += 1) {
    if (kinds[i] !== '') continue;
    const r = rng();
    kinds[i] = r < 0.34 ? 'link' : (r < 0.72 ? 'vote' : 'score');
  }

  /* guide 最多一张：从**非 scoreSum** 的卡里挑一张改成引导卡（保证不影响求和卡的依赖） */
  if (wantGuide) {
    const candidates = [];
    for (let i = 0; i < kinds.length; i += 1) {
      if (kinds[i] !== 'scoreSum') candidates.push(i);
    }
    if (candidates.length > 0) {
      const idx = candidates[Math.floor(rng() * candidates.length) % candidates.length];
      kinds[idx] = 'guide';
    }
  }

  /* 生成卡片本体 */
  const cards = [];
  for (let i = 0; i < usedSlots.length; i += 1) {
    const slot = usedSlots[i];
    const kind = kinds[i];
    const slotStart = slot * slotLen;

    /* 窗口长度：2~10 秒，但不超过槽长的 90%（槽内一定能放下 → 与别的槽不可能相交） */
    const maxWindow = Math.max(2, slotLen * 0.9);
    const windowSec = Math.min(maxWindow, 2 + rng() * 8);
    /* 起点在槽内随机，末尾夹回 duration（浮点误差也一并挡掉） */
    const startRoom = Math.max(0, slotLen - windowSec);
    let timeStart = slotStart + rng() * startRoom;
    let timeEnd = timeStart + windowSec;
    if (timeEnd > duration) {
      timeEnd = duration;
      timeStart = Math.max(0, timeEnd - windowSec);
    }
    timeStart = round1(timeStart);
    timeEnd = round1(timeEnd);

    const top = Math.round(12 + rng() * 66);   /* 12%~78% */
    const left = Math.round(10 + rng() * 65);  /* 10%~75% */

    const card = {
      id: `${avid}-c${cards.length + 1}`,
      kind,
      avid,
      top,
      left,
      timeStart,
      timeEnd,
      question: { title: '', options: [] },
    };

    if (kind === 'guide') {
      card.question.title = pick(rng, GUIDE_TITLES);
      card.question.options = [{
        label: 'A',
        text: pick(rng, GUIDE_OPTIONS),
        targetNodeId: '',
      }];
    } else if (kind === 'link') {
      card.question.title = pick(rng, LINK_TITLES);
      card.question.options = [{
        label: 'A',
        text: pick(rng, LINK_OPTIONS),
        targetNodeId: '',
      }];
      /* link 卡片必须带 url（与 web 端 linkList[].linkContent 同义） */
      card.url = `https://www.bilibili.com/video/${avid}`;
    } else if (kind === 'vote') {
      card.question.title = pick(rng, VOTE_TITLES);
      const optCount = 2 + Math.floor(rng() * 3);          /* 2~4 个选项 */
      const labels = ['A', 'B', 'C', 'D'];
      const usedText = [];
      for (let k = 0; k < optCount; k += 1) {
        let text = pick(rng, VOTE_OPTIONS);
        /* 同一张投票卡里选项文案不重复（重复的选项在界面上没法区分） */
        let guard = 0;
        while (usedText.includes(text) && guard < VOTE_OPTIONS.length) {
          text = pick(rng, VOTE_OPTIONS);
          guard += 1;
        }
        usedText.push(text);
        card.question.options.push({
          label: labels[k] || String(k + 1),
          text,
          /* targetNodeId：从剧情树的节点 id 池里取（没有池就留空，互动层按 avid 解析） */
          targetNodeId: targetIds.length > 0
            ? targetIds[Math.floor(rng() * targetIds.length) % targetIds.length]
            : '',
          votes: 10 + Math.floor(rng() * 990),
        });
      }
    } else if (kind === 'score') {
      card.question.title = pick(rng, SCORE_TITLES);
      card.question.options = [{
        label: 'A',
        text: pick(rng, SCORE_OPTIONS),
        targetNodeId: '',
      }];
      /* score 卡片必须带 max（评分上限） */
      card.max = [5, 10, 100][Math.floor(rng() * 3) % 3];
    } else if (kind === 'scoreSum') {
      card.question.title = pick(rng, SUM_TITLES);
      card.question.options = [{
        label: 'A',
        text: pick(rng, SUM_OPTIONS),
        targetNodeId: '',
      }];
    }

    cards.push(card);
  }

  /* scoreSum 的 average / total 由**同一视频里已有的 score 卡**推出来（有据可依，不凭空随机） */
  const maxes = cards.filter((c) => c.kind === 'score').map((c) => Number(c.max) || 10);
  for (const card of cards) {
    if (card.kind !== 'scoreSum') continue;
    const meanMax = maxes.length > 0
      ? maxes.reduce((a, b) => a + b, 0) / maxes.length
      : 10;
    /* 平均分 = 满分的一个稳定比例（0.7~0.95），total = 参与评分的卡片数 */
    card.average = round1(meanMax * (0.7 + rng() * 0.25));
    card.total = maxes.length;
  }

  /* 最后一道保险：按 timeStart 升序，并断言互不重叠（不满足就丢弃后一张，绝不产出违规数据） */
  cards.sort((a, b) => a.timeStart - b.timeStart);
  const safe = [];
  for (const card of cards) {
    const last = safe[safe.length - 1];
    if (last && card.timeStart < last.timeEnd) continue;
    if (card.timeStart < 0 || card.timeEnd > duration) continue;
    safe.push(card);
  }

  /* 丢卡之后可能把 scoreSum 的依赖弄丢（极端情况）：再兜一道底 */
  if (safe.some((c) => c.kind === 'scoreSum') && !safe.some((c) => c.kind === 'score')) {
    return safe.filter((c) => c.kind !== 'scoreSum');
  }

  return safe;
}

/* ---------------------------------------------------------------- 剧情树（targetNodeId 池） */

/** 读 story.json：拿到 { avid: {nodeId, title, duration} } 与全部节点 id */
export async function loadStoryIndex() {
  const raw = await readTextIfExists(HUAQIANG_STORY);
  if (!raw) return { byAvid: {}, nodeIds: [] };
  let story;
  try {
    story = JSON.parse(raw);
  } catch {
    return { byAvid: {}, nodeIds: [] };
  }

  const byAvid = {};
  const nodeIds = [];
  for (const [nodeId, node] of Object.entries(story.nodes || {})) {
    nodeIds.push(nodeId);
    if (node && node.avid) {
      byAvid[node.avid] = {
        nodeId,
        title: node.title || '',
        duration: Number(node.duration) || 0,
      };
    }
  }
  return { byAvid, nodeIds: nodeIds.sort() };
}

/* ---------------------------------------------------------------- 默认视频（第一张卡） */

/** 默认视频时长：本地 index.mpd → （可选）联网取 MinIO 清单 → 兜底常量 */
export async function readDefaultVideoDuration({ fetchRemote = false } = {}) {
  const local = await readTextIfExists(DEFAULT_MPD_LOCAL);
  if (local) {
    const sec = durationFromMpd(local);
    if (sec > 0) return { seconds: sec, source: 'interactive/default/index.mpd' };
  }

  if (fetchRemote) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(DEFAULT_MPD_URL, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const sec = durationFromMpd(await res.text());
        if (sec > 0) return { seconds: sec, source: `fetch ${DEFAULT_MPD_URL}` };
      }
    } catch {
      /* 取不到就用兜底常量：卡片生成不依赖网络 */
    }
  }

  return {
    seconds: DEFAULT_VIDEO_DURATION_SEC,
    source: `fallback 常量（MinIO dash2/output-segmentbase.mpd 实测 PT4M13.6S）`,
  };
}

/* ---------------------------------------------------------------- 落盘 */

/** 生成互动视频的 cards.json 内容（纯函数，便于 --check 对比） */
export async function buildHuaqiangCards(seed = DEFAULT_SEED) {
  const durations = await scanAvidDurations();
  const story = await loadStoryIndex();

  const cards = {};
  const meta = {};
  for (const avid of Object.keys(durations).sort()) {
    const info = durations[avid];
    const node = story.byAvid[avid];
    /* 时长优先用清单实测值；剧情树里的 duration 只作为"清单读不出来"时的兜底 */
    const seconds = info.seconds > 0 ? info.seconds : (node ? node.duration : 0);
    cards[avid] = generateCards(avid, seconds, seed, story.nodeIds);
    meta[avid] = { seconds: round1(seconds), source: info.source, nodeId: node ? node.nodeId : '' };
  }

  return {
    interactiveId: 'huaqiang',
    seed,
    generatedBy: 'tools/gen-interactive-cards.mjs',
    rules: {
      overlap: '时间槽内不重叠（槽之间天然不相交）',
      guide: '每个视频最多一张',
      scoreSum: '必须存在 score 才生成',
      duration: '所有卡片落在 [0, 视频时长] 内',
      stable: '同 seed 同结果（每个 avid 独立种子 hash(seed:avid)）',
    },
    frameIntervalSec: FRAME_INTERVAL_SEC,
    durations: meta,
    cards,
  };
}

/** 生成默认视频（第一张卡）的 cards.json 内容 */
export async function buildDefaultCards(seed = DEFAULT_SEED, { fetchRemote = false } = {}) {
  const info = await readDefaultVideoDuration({ fetchRemote });
  const cards = generateCards('default', info.seconds, seed + DEFAULT_VIDEO_SEED_OFFSET, []);

  return {
    video: 'default',
    playUrl: DEFAULT_MPD_URL,
    seed: seed + DEFAULT_VIDEO_SEED_OFFSET,
    generatedBy: 'tools/gen-interactive-cards.mjs',
    duration: round1(info.seconds),
    durationSource: info.source,
    cards,
  };
}

async function writeJson(file, obj) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

/** 生成并写盘两份 cards.json；返回统计（供日志/接口用） */
export async function generateAll({ seed = DEFAULT_SEED, fetchDefaultMpd = false } = {}) {
  const huaqiang = await buildHuaqiangCards(seed);
  const def = await buildDefaultCards(seed, { fetchRemote: fetchDefaultMpd });

  await writeJson(HUAQIANG_CARDS, huaqiang);
  await writeJson(DEFAULT_CARDS, def);

  const total = Object.values(huaqiang.cards).reduce((n, list) => n + list.length, 0);
  const withCards = Object.values(huaqiang.cards).filter((l) => l.length > 0).length;

  return {
    seed,
    huaqiang: {
      file: HUAQIANG_CARDS,
      avids: Object.keys(huaqiang.cards).length,
      avidsWithCards: withCards,
      cards: total,
    },
    defaultVideo: { file: DEFAULT_CARDS, cards: def.cards.length, duration: def.duration },
  };
}

/**
 * 服务启动时用：文件不存在就生成一份（存在则原样返回，不覆盖用户手动改过的数据）。
 * 只做本地扫描 + 兜底时长，**不联网**（启动不能被网络拖住）。
 */
export async function ensureCardsFiles({ seed = DEFAULT_SEED } = {}) {
  const have = await Promise.all([
    fsp.access(HUAQIANG_CARDS).then(() => true).catch(() => false),
    fsp.access(DEFAULT_CARDS).then(() => true).catch(() => false),
  ]);

  if (have[0] && have[1]) return { generated: false };
  const stat = await generateAll({ seed });
  return { generated: true, stat };
}

/* ---------------------------------------------------------------- CLI */

function parseArgs(argv) {
  const out = { seed: DEFAULT_SEED, check: false, fetchDefaultMpd: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') out.check = true;
    else if (a === '--fetch-default-mpd') out.fetchDefaultMpd = true;
    else if (a === '--seed') {
      i += 1;
      out.seed = Number(argv[i]);
      if (!Number.isFinite(out.seed)) {
        console.error('--seed 需要一个数字');
        process.exit(1);
      }
    } else if (a === '-h' || a === '--help') {
      console.log('用法：node tools/gen-interactive-cards.mjs [--seed N] [--check] [--fetch-default-mpd]');
      process.exit(0);
    } else {
      console.error(`未知参数：${a}`);
      process.exit(1);
    }
  }
  return out;
}

/* 只有直接运行本文件时才走 CLI（被 server.js import 时不执行） */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMain) {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.check) {
    /* --check：不写盘，只把将要生成的结果与磁盘现状对比（同 seed 应当逐字节一致） */
    const hq = await buildHuaqiangCards(opts.seed);
    const cur = await readTextIfExists(HUAQIANG_CARDS);
    const next = `${JSON.stringify(hq, null, 2)}\n`;
    const same = cur !== null && cur === next;
    const totalCards = Object.values(hq.cards).reduce((n, l) => n + l.length, 0);
    console.log(`互动卡片：${Object.keys(hq.cards).length} 个 avid，共 ${totalCards} 张；`
      + `与 ${path.relative(MOCK_ROOT, HUAQIANG_CARDS)} ${same ? '一致（稳定）' : '不一致'}`);
    process.exit(same ? 0 : 1);
  }

  const stat = await generateAll({ seed: opts.seed, fetchDefaultMpd: opts.fetchDefaultMpd });
  console.log('互动卡片已生成：');
  console.log(`  种子：${stat.seed}`);
  console.log(`  ${path.relative(MOCK_ROOT, stat.huaqiang.file)}`
    + `：${stat.huaqiang.avids} 个 avid（其中 ${stat.huaqiang.avidsWithCards} 个有卡片）`
    + `，共 ${stat.huaqiang.cards} 张`);
  console.log(`  ${path.relative(MOCK_ROOT, stat.defaultVideo.file)}`
    + `：${stat.defaultVideo.cards} 张（时长 ${stat.defaultVideo.duration}s）`);
}
