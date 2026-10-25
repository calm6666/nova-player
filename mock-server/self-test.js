#!/usr/bin/env node
/**
 * ============================================================================
 * mock-server 自测脚本：把每一类接口各打一遍，并打印实测输出片段
 * ============================================================================
 *
 * 【为什么这个文件必须用 ESM 而不是 require】
 *   front/player/package.json 里写着 "type": "module"，mock-server 目录下没有自己的
 *   package.json，所以这个 self-test.js 和 server.js 一样会被 Node 当成 ES Module 执行；
 *   写成 require(...) 会直接抛 "require is not defined in ES module scope"。
 *   同理 __dirname 也不存在，要用 import.meta.url 推。
 *
 * 为什么单独写脚本而不是手敲一堆 curl：
 *   1. 长轮询 /danmaku/since 要等最多 25 秒、SSE 要挂住连接读几帧，curl 写起来又长又易错
 *      （Windows 上 curl 还常被别名成 Invoke-WebRequest，行为完全不同）；
 *   2. 脚本会自己把服务起起来（用 --port 0 让系统挑空闲端口，不占用你正在用的 9101），
 *      测完自己关掉，不必开两个终端；
 *   3. 输出就是「实测记录」，可以直接贴进 README。
 *
 * 用法：
 *   node self-test.js                       # 自动起服务（无 --video）并跑完全部用例
 *   node self-test.js --video "D:\a.mp4"    # 带视频测（首次要抽帧，比较慢）
 *   node self-test.js --base http://127.0.0.1:9101   # 只测一个已经跑着的服务
 *
 * 只用 Node 内置模块，和 server.js 一样零依赖。
 * 注意：WebSocket 那组用例里的客户端也是手写的（Node 18 没有内置 WebSocket），
 * 只实现自测需要的握手 / 掩码文本帧 / ping-pong / close，见下面 WsTestClient。
 */

import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 自动起服务时把 WS 心跳压到 1 秒：默认 30 秒的话「验证心跳确实在发」这条用例要等半分钟。
// （server.js 的 --ws-ping 就是为这个存在的，不是测试专用分支。）
const WS_PING_SEC = '1';

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------
function parseSelfArgs(argv) {
  // 默认 --port 0：让系统挑一个空闲端口，不会和正在跑的 9101 撞车
  const opts = { port: 0, video: '', base: '', duration: '600' };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    const eq = raw.indexOf('=');
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? null : raw.slice(eq + 1);
    const next = () => (inline !== null ? inline : argv[++i]);
    if (flag === '--port') opts.port = Number(next());
    else if (flag === '--video') opts.video = next();
    else if (flag === '--base') opts.base = next();
    else if (flag === '--duration') opts.duration = next();
    else if (flag === '--help' || flag === '-h') {
      console.log('用法：node self-test.js [--port 0] [--video <文件>] [--duration 600] [--base <已运行的服务地址>]');
      process.exit(0);
    } else throw new Error(`未知参数：${raw}`);
  }
  return opts;
}

const args = parseSelfArgs(process.argv.slice(2));
let BASE = args.base || '';

const C = {
  title: (s) => `\n\x1b[1m\x1b[36m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
};
const line = (s) => console.log(s);
const clip = (s, n = 400) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)} …（共 ${t.length} 字符，已截断）` : t;
};

let passCount = 0;
let failCount = 0;
function check(name, condition, detail) {
  if (condition) { passCount += 1; line(`  ${C.ok('✔')} ${name}${detail ? C.dim(`　${detail}`) : ''}`); }
  else { failCount += 1; line(`  ${C.bad('✘')} ${name}${detail ? C.dim(`　${detail}`) : ''}`); }
}

// ---------------------------------------------------------------------------
// HTTP 小工具（原生 http，能拿到原始 buffer 和响应头 —— 验证雪碧图二进制需要它）
// ---------------------------------------------------------------------------
function request(method, urlPath, { body, headers, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8') });
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`请求超时（${timeoutMs}ms）`)); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitReady(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await request('GET', '/healthz', { timeoutMs: 2000 });
      if (r.status === 200) return JSON.parse(r.text).data;
    } catch { /* 还没起来，继续等 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('服务在 20 秒内没有就绪');
}

/* ---------------------------------------------------------------------------
 * WebSocket 客户端（手写，理由和 server.js 里一样：零依赖，Node 18 没有内置 WS）
 * 只实现自测需要的那几件事：握手校验、掩码文本帧的收发、ping/pong、close。
 * ------------------------------------------------------------------------- */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsEncodeMasked(opcode, payload) {
  // 客户端 → 服务端**必须加掩码**（RFC6455 §5.3），这点和服务端刚好相反
  const data = Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  let header;
  if (data.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | data.length;
  } else {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  }
  header[0] = 0x80 | opcode; // FIN=1
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

class WsTestClient {
  constructor(socket, headers, acceptOk, acceptActual) {
    this.socket = socket;
    this.headers = headers;
    this.acceptOk = acceptOk;
    this.acceptActual = acceptActual;
    this.buffer = Buffer.alloc(0);
    this.messages = [];      // 收到的 JSON 消息（解析失败的放 {type:'(非 JSON)'}）
    this.pings = [];         // 收到的协议层 ping 帧时刻
    this.pongs = 0;          // 收到的协议层 pong 帧个数
    this.serverMasked = false; // 服务端帧是否带了掩码（带了就是违反 RFC，专门断言这一点）
    this.closed = false;

    socket.on('data', (chunk) => this.feed(chunk));
    socket.on('close', () => { this.closed = true; });
    socket.on('error', () => { this.closed = true; });
  }

  // 轮询式等待：比给每个断言写一套事件回调简单，50ms 粒度对自测完全够用
  async waitFor(pred, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (pred()) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  send(obj) {
    this.socket.write(wsEncodeMasked(0x1, Buffer.from(JSON.stringify(obj), 'utf8')));
  }

  close() {
    try {
      this.socket.write(wsEncodeMasked(0x8, Buffer.from([0x03, 0xe8]))); // 1000 = normal closure
      this.socket.end();
    } catch { /* 已经断了 */ }
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const buf = this.buffer;
      if (buf.length < 2) return;
      // 说明：服务端只发 FIN=1 的单帧（server.js 的 wsEncodeFrame），所以这里不读 FIN 位、
      // 也不做分片重组。真要收到分片，说明服务端装帧写错了，那属于被测对象的 bug，
      // 不该由自测客户端悄悄兜住（现在收到分片会被当成完整帧解析，JSON 解析失败会显式报出来）。
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }

      let maskKey = null;
      if (masked) {
        if (buf.length < offset + 4) return;
        maskKey = buf.subarray(offset, offset + 4);
        offset += 4;
        this.serverMasked = true; // 服务端不该加掩码，记下来给断言用
      }
      if (buf.length < offset + len) return; // 半包

      const payload = Buffer.from(buf.subarray(offset, offset + len));
      if (maskKey) for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4];
      this.buffer = buf.subarray(offset + len);
      this.handle(opcode, payload);
      if (this.closed) return;
    }
  }

  handle(opcode, payload) {
    if (opcode === 0x9) {
      // 服务端 ping：必须回 pong（不回的话心跳逻辑会把这条连接当死连接关掉）
      this.pings.push(Date.now());
      this.socket.write(wsEncodeMasked(0xa, payload));
      return;
    }
    if (opcode === 0xa) { this.pongs += 1; return; }
    if (opcode === 0x8) { this.closed = true; this.socket.end(); return; }
    if (opcode === 0x1) {
      // 服务端每条消息都是一行 JSON，末尾有 \n（trim 掉不影响解析）
      const text = payload.toString('utf8').trim();
      try {
        this.messages.push(JSON.parse(text));
      } catch (err) {
        this.messages.push({ type: '(非 JSON)', raw: text, error: String(err.message) });
      }
      return;
    }
    // 0x2 二进制 / 0x0 续帧：本服务不会发，自测也不构造
  }
}

function wsConnect() {
  return new Promise((resolve, reject) => {
    const url = new URL('/danmaku/ws', BASE);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });

    req.on('upgrade', (res, socket, head) => {
      // 【必须关掉 socket 上的超时】上面为「建连」设了 5 秒超时，升级之后这条 socket 归我们用了，
      // 不关掉的话心跳等待期间一旦 5 秒没数据，socket 会被超时逻辑干掉，用例就会莫名其妙失败。
      socket.setTimeout(0);
      const expect = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
      const client = new WsTestClient(socket, res.headers, res.headers['sec-websocket-accept'] === expect, res.headers['sec-websocket-accept']);
      if (head && head.length) client.feed(head); // 握手响应可能已经捎带了第一帧（hello）
      resolve(client);
    });
    // 服务端没升级协议时会走普通 HTTP 响应：这里必须 reject，否则自测会卡到超时
    req.on('response', (res) => reject(new Error(`服务端没有升级协议：HTTP ${res.statusCode}`)));
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('WS 建连超时')));
    req.end();
  });
}

let health = null;
let child = null;

// ---------------------------------------------------------------------------
// 各项用例
// ---------------------------------------------------------------------------
async function testTestPage() {
  line(C.title('【0】GET /　自测页（浏览器里直接能用的那个页面）'));
  const r = await request('GET', '/');
  line(`  Content-Type：${r.headers['content-type']}，${r.buf.length} 字节`);
  line(`  前 200 字符：${clip(r.text, 200)}`);
  check('HTTP 200 且 Content-Type 是 HTML', r.status === 200 && String(r.headers['content-type']).includes('text/html'));
  check('返回的是自测页（含「怎么用」说明）', r.text.includes('怎么用'));
  const alias = await request('GET', '/test-page.html');
  check('GET /test-page.html 返回同一页面', alias.status === 200 && alias.buf.length === r.buf.length, `${alias.buf.length} 字节`);
  check('页面里的请求都是相对路径（没有写死 http://127.0.0.1:端口）',
    !/fetch\(\s*['"`]https?:\/\//.test(r.text) && !r.text.includes('__MOCK_CONFIG__'));
  // WebSocket 面板是这次新增的主要验证入口：状态徽标 + 上行发送按钮 + 独立的消息窗口
  check('页面里有 WebSocket 面板（连接状态 / 通过 WS 发送 / 消息窗口）',
    r.text.includes('/danmaku/ws') && r.text.includes('id="wsSend"')
    && r.text.includes('id="wsState"') && r.text.includes('id="wsStream"'));
  check('页面自己拼 WS 地址（location.host + /healthz.wsPath，换端口不用改代码）',
    r.text.includes('location.host') && r.text.includes('CFG.wsPath'));
}

async function testHealth() {
  line(C.title('【1】GET /healthz　运行状态（顺带确认 CORS 头）'));
  const r = await request('GET', '/healthz');
  health = JSON.parse(r.text).data;
  line(`  ${clip(r.text, 500)}`);
  check('HTTP 200 且 code=0', r.status === 200 && JSON.parse(r.text).code === 0);
  check('Access-Control-Allow-Origin: *', r.headers['access-control-allow-origin'] === '*',
    `实际：${r.headers['access-control-allow-origin']}`);
  check('带片长信息', typeof health.durationSec === 'number' && health.durationSec > 0,
    `durationSec=${health.durationSec}（${health.durationSource}）`);
  // 预生成的随机弹幕条数：list.so 会返回这么多条，所以这个字段必须恒等于 1000
  check('danmakuCount = 1000（启动时生成的随机弹幕）', health.danmakuCount === 1000,
    `danmakuCount=${health.danmakuCount}`);
  // 速度档是随机抽的，但必须 5 档都出现过、且合计等于总条数（否则说明抽样逻辑写漏了某一档）
  const speedCounts = health.danmakuBySpeed || {};
  check('danmakuBySpeed 覆盖 5 档且合计 1000',
    Object.keys(speedCounts).length === 5
    && ['verySlow', 'slow', 'moderate', 'fast', 'veryFast'].every((k) => speedCounts[k] > 0)
    && Object.values(speedCounts).reduce((a, b) => a + b, 0) === 1000,
    JSON.stringify(speedCounts));
  check('带 WebSocket 状态字段（wsClients / wsPath / wsHeartbeatMs）',
    Number.isInteger(health.wsClients) && health.wsPath === '/danmaku/ws' && Number.isFinite(health.wsHeartbeatMs),
    `wsClients=${health.wsClients} wsPath=${health.wsPath} wsHeartbeatMs=${health.wsHeartbeatMs}`);
  // 雪碧图状态：status 取值 idle（还没人请求）/ ready / unavailable；帧数与拼版数只有 ready 后才有值
  check('带雪碧图状态字段（sprite / spriteFrames / spriteSheets / spriteBytes）',
    typeof health.sprite === 'string' && Number.isInteger(health.spriteFrames)
    && Number.isInteger(health.spriteSheets) && Number.isInteger(health.spriteBytes),
    `sprite=${health.sprite}，frames=${health.spriteFrames}，sheets=${health.spriteSheets}`);
}

async function testViewPoints() {
  line(C.title('【2】GET /x/player/v2?aid=&cid=　进度条节点（view_points）'));
  const r = await request('GET', '/x/player/v2?aid=123&cid=456');
  const json = JSON.parse(r.text);
  const vp = json.data.view_points;
  line(`  ${clip(r.text, 500)}`);
  check('HTTP 200 且 code=0', r.status === 200 && json.code === 0, `message=${json.message}`);
  check('view_points 是数组且有 4~6 段', Array.isArray(vp) && vp.length >= 4 && vp.length <= 6, `实际 ${vp.length} 段`);
  check('第一段 from=0', vp[0].from === 0, `首段：${JSON.stringify(vp[0])}`);
  check('最后一段 to=片长（覆盖整片）', Math.abs(vp[vp.length - 1].to - health.durationSec) <= 1,
    `末段 to=${vp[vp.length - 1].to}，片长=${health.durationSec}`);
  check('段与段首尾相接（无缝隙）', vp.every((p, i) => i === 0 || p.from === vp[i - 1].to));
  check('to 恒大于 from', vp.every((p) => p.to > p.from));
  check('每段都带 img_url / img_x_len / img_y_len / img_x_size / img_y_size',
    vp.every((p) => p.img_url && p.img_x_len && p.img_y_len && p.img_x_size && p.img_y_size),
    `img_url 示例：${vp[0].img_url}`);
  // img_url 指向雪碧图第一张拼版 /videoshot/sprite.jpg（可直接当图片加载、按参数裁切）；
  // 全部拼版（多张）以 /x/player/videoshot 的 data.image 数组为准
  check('每段 img_url 都指向 /videoshot/sprite.jpg（雪碧图第一张拼版）',
    vp.every((p) => typeof p.img_url === 'string' && p.img_url.endsWith('/videoshot/sprite.jpg')),
    `实际：${JSON.stringify(vp.map((p) => p.img_url).slice(0, 2))}`);
}

async function testPbp() {
  line(C.title('【3】GET /x/player/pbp?aid=&cid=　高能进度条'));
  const r = await request('GET', '/x/player/pbp?aid=123&cid=456');
  const d = JSON.parse(r.text).data;
  line(`  头部：${clip(r.text, 200)}`);
  line(`  step_sec=${d.step_sec}，点数=${d.data.length}，min=${Math.min(...d.data)}，max=${Math.max(...d.data)}`);
  check('HTTP 200 且 code=0', r.status === 200);
  check('step_sec 存在且为正', Number.isFinite(d.step_sec) && d.step_sec > 0, `step_sec=${d.step_sec}`);
  check('data 长度 = ceil(片长 / step_sec)',
    d.data.length === Math.ceil(health.durationSec / d.step_sec),
    `期望 ${Math.ceil(health.durationSec / d.step_sec)}，实际 ${d.data.length}`);
  check('所有值都在 [0,1] 内', d.data.every((v) => v >= 0 && v <= 1));
  check('不是全 0（曲线有起伏）', d.data.some((v) => v > 0.05), `max=${Math.max(...d.data)}`);
  check('相邻点差值有界（是平滑曲线而不是乱抖）',
    d.data.every((v, i) => i === 0 || Math.abs(v - d.data[i - 1]) < 0.5));
}

async function testDmList() {
  line(C.title('【4】GET /x/v1/dm/list.so?oid=　历史弹幕 XML（B 站 p 字段顺序）'));
  const r = await request('GET', '/x/v1/dm/list.so?oid=456');
  line(`  Content-Type：${r.headers['content-type']}`);
  line(`  ${clip(r.text, 600)}`);
  const first = (r.text.match(/<d p="([^"]+)"/) || [])[1] || '';
  check('HTTP 200 且是 XML', r.status === 200 && String(r.headers['content-type']).includes('xml'));
  check('根节点是 <i>', /<i>[\s\S]*<\/i>/.test(r.text));
  check('有 <d p="..."> 条目', /<d p="/.test(r.text));
  check('p 字段是 8 段逗号分隔（时间,模式,字号,颜色,时间戳,池,uid,行号）',
    first.split(',').length === 8, `实际：${first}`);
  check('第 1 段是「秒」（带小数，不是毫秒）', /^\d+(\.\d+)?$/.test(first.split(',')[0] || ''),
    `第一段=${first.split(',')[0]}`);
  check('第 4 段是十进制颜色', /^\d+$/.test(first.split(',')[3] || ''), `颜色=${first.split(',')[3]}`);

  // ---- 随机生成的 1000 条：条数、排序、覆盖度、色板、模式/字号分布 ----
  const pList = [...r.text.matchAll(/<d p="([^"]+)"/g)].map((m) => m[1].split(','));
  const times = pList.map((p) => Number(p[0]));
  const modes = pList.map((p) => Number(p[1]));
  const sizes = [...new Set(pList.map((p) => Number(p[2])))].sort((a, b) => a - b);
  const colors = [...new Set(pList.map((p) => Number(p[3])))];
  const scrollRatio = modes.filter((m) => m === 1).length / pList.length;

  line(`  条目数 ${pList.length}；时间 ${times[0]}s ~ ${times[times.length - 1]}s；`
    + `模式分布 滚动=${modes.filter((m) => m === 1).length} 顶部=${modes.filter((m) => m === 5).length} 底部=${modes.filter((m) => m === 4).length}；`
    + `字号档=${JSON.stringify(sizes)}；颜色种类=${colors.length}`);

  check('恰好 1000 条（对应 /healthz.danmakuCount）', pList.length === 1000 && pList.length === health.danmakuCount,
    `实际 ${pList.length} 条`);
  check('按时间升序排列', times.every((t, i) => i === 0 || t >= times[i - 1]),
    `首条 ${times[0]}s，末条 ${times[times.length - 1]}s`);
  check('时间点覆盖整片（首条接近 0s、末条接近片长）',
    times[0] < health.durationSec * 0.05 && times[times.length - 1] > health.durationSec * 0.9,
    `片长 ${health.durationSec}s，实际 ${times[0]}s ~ ${times[times.length - 1]}s`);
  check('没有超出片长的时间点', times.every((t) => t >= 0 && t <= health.durationSec),
    `max=${Math.max(...times)}`);
  check('绝大多数是滚动弹幕（>80%），但顶/底也存在',
    scrollRatio > 0.8 && modes.includes(5) && modes.includes(4),
    `滚动占 ${(scrollRatio * 100).toFixed(1)}%`);
  check('字号只取 18（小）/ 25（标准）两档',
    sizes.every((s) => s === 18 || s === 25), JSON.stringify(sizes));
  // 颜色必须全部落在参考 selection 的 14 色板里（十进制比较，避免 hex/dec 写混）
  const paletteDec = ['FE0302', 'FF7204', 'FFAA02', 'FFD302', 'FFFF00', 'A0EE00', '00CD00',
    '019899', '4266BE', '89D5FF', 'CC0273', '222222', '9B9B9B', 'FFFFFF'].map((h) => Number.parseInt(h, 16));
  const outside = colors.filter((c) => !paletteDec.includes(c));
  check('颜色全部来自参考色板（selection/index.ts:9-24）', outside.length === 0,
    outside.length ? `色板外的颜色：${outside.join(',')}` : `用到 ${colors.length} 种`);
  // 特殊字符必须转义，否则整份 XML 会被 DOMParser 判为损坏
  check('文本里的 & < > 已转义（没有裸的 & 或 <）',
    !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(r.text) && !/<d p="[^"]*">[^<]*<[^/]/.test(r.text));

  // ---- 别名：需求里写的是 /v1/dm/list.so，服务端两种路径都认，内容必须完全一致 ----
  const alias = await request('GET', '/v1/dm/list.so?oid=456');
  check('别名 /v1/dm/list.so 返回与 /x/v1/dm/list.so 完全相同的内容',
    alias.status === 200 && alias.text === r.text, `HTTP ${alias.status}，${alias.buf.length} 字节`);
}

async function testSendAndSse() {
  line(C.title('【5】POST /danmaku/send + GET /danmaku/stream　推送弹幕与 SSE'));
  const payload = JSON.stringify({ text: '自测脚本：带 <转义> & "引号" 的弹幕', timeMs: 12500, mode: 1, fontSize: 25, color: 16777215 });
  const sent = await request('POST', '/danmaku/send', { body: payload });
  const seq = JSON.parse(sent.text).data.seq;
  line(`  → ${clip(payload)}`);
  line(`  ← ${clip(sent.text, 200)}`);
  check('POST 成功且返回自增 seq', sent.status === 200 && Number.isInteger(seq) && seq > 0, `seq=${seq}`);

  const empty = await request('POST', '/danmaku/send', { body: JSON.stringify({ text: '   ' }) });
  check('空文本被拒（400）', empty.status === 400, `实际 HTTP ${empty.status} ${clip(empty.text, 120)}`);

  // SSE：**连上之后**发的弹幕才可能被推到，所以拿「连上之后那条 POST 的响应 seq」去比对。
  // 【为什么不能用上面那条 seq】上面那条是在建 SSE 连接**之前**发的：SSE 不做历史回放
  //（时序上也不可能收到），拿它当期望值必然失败 —— 这是用例本身的 bug，不是服务端的。
  const sseText = 'SSE 联调：这条应实时出现在流里';
  await new Promise((resolve) => {
    const url = new URL('/danmaku/stream', BASE);
    const received = [];
    let raw = '';
    let done = false;
    let req = null;
    let expectSeq = null; // 连上之后 POST 的那条的 seq，由 POST 响应给出（不靠猜、也不放宽成「随便收到一条」）

    const finish = () => {
      if (done) return;
      done = true;
      check('SSE 收到的就是连上之后 POST 的那条（拿 POST 响应的 seq 比对，且 text 一致）',
        expectSeq !== null && received.some((d) => d.seq === expectSeq && d.text === sseText),
        `期望 seq=${expectSeq} text="${sseText}"；实收 ${received.map((d) => `#${d.seq}"${d.text}"`).join('、') || '(一条都没收到)'}`);
      check('弹幕字段完整（seq/timeMs/mode/fontSize/color/text）',
        received.length > 0 && received.every((d) => ['seq', 'timeMs', 'mode', 'fontSize', 'color', 'text'].every((k) => k in d)),
        received.length ? JSON.stringify(received[0]) : '(一条都没收到)');
      resolve();
    };

    // 命中期望的那条就收工。抽成函数是因为要在两个地方调：收到 data 帧时、
    // 以及 POST 响应回来时 —— 服务端是「先广播、后回 POST 响应」，所以 data 帧很可能先到，
    // 那时候 expectSeq 还没赋上值，只判一次会白等到 8 秒超时。
    const maybeFinish = () => {
      if (expectSeq === null) return;
      if (!received.some((d) => d.seq === expectSeq)) return;
      try { req.destroy(); } catch { /* 已经断了 */ }
      finish();
    };

    req = http.request({ method: 'GET', hostname: url.hostname, port: url.port, path: url.pathname },
      (res) => {
        line(`  Content-Type：${res.headers['content-type']}`);
        line(`  Cache-Control：${res.headers['cache-control']}`);
        check('Content-Type 是 text/event-stream', String(res.headers['content-type']).includes('text/event-stream'));
        check('禁用了缓存（no-cache）', String(res.headers['cache-control']).includes('no-cache'));
        res.on('data', (chunk) => {
          raw += chunk.toString('utf8');
          const frames = raw.split('\n\n');
          raw = frames.pop();
          for (const frame of frames) {
            if (frame.startsWith(':')) { line(`  ← ${C.dim(`${frame.trim()}　（注释行：握手/心跳，EventSource 会忽略）`)}`); continue; }
            const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            line(`  ← data: ${clip(dataLine.slice(6), 200)}`);
            const item = JSON.parse(dataLine.slice(6));
            received.push(item);
            maybeFinish();
            if (done) return;
          }
        });
        res.on('end', finish);
      });
    req.on('error', finish);
    req.end();
    setTimeout(async () => {
      try {
        const r = await request('POST', '/danmaku/send', { body: JSON.stringify({ text: sseText, timeMs: 30000 }) });
        expectSeq = JSON.parse(r.text).data.seq;
        line(`  （连上之后 POST 了一条：seq=${expectSeq}　${clip(r.text, 120)}）`);
        maybeFinish();
      } catch (err) {
        line(C.bad(`  （连上之后 POST 失败：${err.message}）`));
      }
    }, 400);
    setTimeout(() => { try { req.destroy(); } catch { /* 已断开 */ } finish(); }, 8000);
  });
}

/**
 * WebSocket：握手 → hello → 上行 send 收到广播 → POST 也广播过来 →
 * 入库共用（since 能补到）→ 应用层 ping/pong → 协议层心跳帧 → close 与连接回收。
 *
 * 【为什么要 assert 这些】QML 侧只用一个 QWebSocket 连这个端点，握手/掩码/帧格式
 * 任何一条不对，Qt 那边表现为「连不上」或「收到乱码」，很难定位；在服务端自测里钉死，
 * 上游改协议时才不会悄悄把播放器弄坏。
 */
async function testWebSocket() {
  line(C.title('【6】WS /danmaku/ws　握手 + 双向收发 + 心跳 + 回收'));
  const wsBefore = health.wsClients; // 基线：可能已经有别的客户端（比如浏览器开着自测页）连着

  let ws;
  try {
    ws = await wsConnect();
  } catch (err) {
    check('WS 建连（GET /danmaku/ws + Upgrade）', false, String(err.message));
    return;
  }

  try {
    line(`  升级响应：HTTP 101，Upgrade=${ws.headers.upgrade}，`
      + `Sec-WebSocket-Accept=${ws.acceptActual}`);
    check('握手成功且 Sec-WebSocket-Accept = base64(sha1(key + GUID))',
      ws.acceptOk && String(ws.headers.upgrade).toLowerCase() === 'websocket',
      ws.acceptOk ? 'accept 校验通过' : `accept 不对：${ws.acceptActual}`);

    // ---- hello：连上就该收到，用来确认握手后业务通道是通的 ----
    const gotHello = await ws.waitFor(() => ws.messages.some((m) => m.type === 'hello'), 3000);
    const hello = ws.messages.find((m) => m.type === 'hello') || {};
    line(`  ← hello：${clip(JSON.stringify(hello), 300)}`);
    check('连上后收到 hello（含 danmakuCount / heartbeatMs / sendExample）',
      gotHello && hello.danmakuCount === health.danmakuCount && Number.isFinite(hello.heartbeatMs)
      && typeof hello.sendExample === 'string',
      `danmakuCount=${hello.danmakuCount} heartbeatMs=${hello.heartbeatMs}`);

    // ---- 上行 send → 下行 danmaku 广播（同一连接双向验证）----
    const marker = `WS 自测 ${Date.now()}`;
    ws.send({
      type: 'send', text: marker, timeSec: 12.34, mode: 'top',
      color: '#FF7204', fontSize: 18, speed: 'fast', uid: 'ws-tester',
    });
    const gotBroadcast = await ws.waitFor(
      () => ws.messages.some((m) => m.type === 'danmaku' && m.text === marker), 3000,
    );
    const dm = ws.messages.find((m) => m.type === 'danmaku' && m.text === marker) || {};
    line(`  ← 广播：${clip(JSON.stringify(dm), 300)}`);
    check('WS 上行 {"type":"send"} 后收到广播回来的 danmaku', gotBroadcast, `text=${marker}`);
    check('广播字段是播放器口径（mode 字符串 / color #RRGGBB / timeSec 秒 / speed 档位名）',
      dm.mode === 'top' && dm.color === '#FF7204' && Math.abs(dm.timeSec - 12.34) < 0.01
      && dm.fontSize === 18 && dm.speed === 'fast',
      `mode=${dm.mode} color=${dm.color} timeSec=${dm.timeSec} fontSize=${dm.fontSize} speed=${dm.speed}`);
    check('广播带 id / seq / uid / isSelf / ts',
      typeof dm.id === 'string' && Number.isInteger(dm.seq) && dm.uid === 'ws-tester'
      && dm.isSelf === true && Number.isFinite(dm.ts),
      `id=${dm.id} seq=${dm.seq} uid=${dm.uid} isSelf=${dm.isSelf}`);
    check('服务端发出的帧不带掩码（RFC6455 §5.1，带掩码浏览器/Qt 会直接断连）',
      ws.serverMasked === false, `serverMasked=${ws.serverMasked}`);

    // ---- 入库共用：WS 发的那条必须能从 /danmaku/since 补齐 ----
    const since = JSON.parse((await request('GET', `/danmaku/since?seq=${dm.seq - 1}`)).text);
    check('WS 发的那条也进了 dmHistory（/danmaku/since 能补到，说明两条发送路径共用入库逻辑）',
      Array.isArray(since.data) && since.data.some((x) => x.text === marker),
      `since 返回 ${Array.isArray(since.data) ? since.data.length : '?'} 条`);

    // ---- POST 发的弹幕也要广播到 WS 连接（HTTP 与 WS 是同一批广播）----
    const postMarker = `POST 转 WS 广播 ${Date.now()}`;
    const posted = await request('POST', '/danmaku/send', {
      body: JSON.stringify({ text: postMarker, timeMs: 3000, mode: 4, color: '89D5FF', fontSize: 25, speed: 'verySlow' }),
    });
    const postSeq = JSON.parse(posted.text).data.seq;
    const gotPost = await ws.waitFor(
      () => ws.messages.some((m) => m.type === 'danmaku' && m.text === postMarker), 3000,
    );
    const postDm = ws.messages.find((m) => m.type === 'danmaku' && m.text === postMarker) || {};
    line(`  ← POST 之后 WS 收到：${clip(JSON.stringify(postDm), 260)}`);
    check('POST /danmaku/send 的弹幕同样广播到 WS 连接', gotPost, `seq=${postSeq}`);
    check('POST 的 timeMs / 十进制颜色 在广播里换算成 timeSec / #RRGGBB',
      postDm.timeSec === 3 && postDm.color === '#89D5FF' && postDm.mode === 'bottom',
      `timeSec=${postDm.timeSec} color=${postDm.color} mode=${postDm.mode}`);
    check('POST 响应里带 id（和广播的 id 对得上）',
      JSON.parse(posted.text).data.id === postDm.id, `响应 id=${JSON.parse(posted.text).data.id}，广播 id=${postDm.id}`);

    // ---- 应用层 ping/pong ----
    ws.send({ type: 'ping' });
    const gotPong = await ws.waitFor(() => ws.messages.some((m) => m.type === 'pong'), 3000);
    check('上行 {"type":"ping"} 收到 {"type":"pong"}（页面/QML 量往返延迟用）', gotPong);

    // ---- 协议层心跳：自动起服务时带了 --ws-ping 1，所以几秒内必然收到 ping 帧 ----
    if (args.base) {
      line(C.dim(`  （--base 模式：外部服务的 --ws-ping 未知，跳过心跳帧检查；要验心跳请用 node self-test.js 自动起服务）`));
    } else {
      const gotPing = await ws.waitFor(() => ws.pings.length > 0, 8000);
      check(`服务端按 --ws-ping ${WS_PING_SEC}s 周期发协议层 ping 帧`, gotPing,
        `收到 ${ws.pings.length} 个 ping 帧（客户端已自动回 pong ${ws.pongs} 个）`);
    }

    // ---- close 与连接回收 ----
    ws.close();
    const closed = await ws.waitFor(() => ws.closed, 3000);
    check('客户端发 close 帧后连接正常关闭', closed, `closed=${ws.closed}`);
    await new Promise((r) => setTimeout(r, 800)); // 留点时间让服务端跑 close 事件里的回收
    const after = JSON.parse((await request('GET', '/healthz')).text).data;
    check('断开后服务端回收连接（wsClients 回到基线）', after.wsClients === wsBefore,
      `基线 ${wsBefore}，现在 ${after.wsClients}`);
  } finally {
    try { ws.close(); } catch { /* 已经断了 */ }
  }
}

async function testSince() {
  line(C.title('【7】GET /danmaku/since?seq=N　长轮询兜底'));
  const immediate = await request('GET', '/danmaku/since?seq=0');
  const ij = JSON.parse(immediate.text);
  line(`  已有数据场景：${clip(immediate.text, 260)}`);
  check('seq=0 时立刻返回已有弹幕', ij.code === 0 && Array.isArray(ij.data) && ij.data.length > 0, `返回 ${ij.data.length} 条`);

  const head = ij.data[ij.data.length - 1].seq;
  line(C.dim(`  用最新 seq=${head} 请求：服务端会挂起等待，最多 25 秒，这里等它超时……`));
  const t0 = Date.now();
  const parked = JSON.parse((await request('GET', `/danmaku/since?seq=${head}`, { timeoutMs: 32000 })).text);
  const elapsed = (Date.now() - t0) / 1000;
  line(`  ← 等待 ${elapsed.toFixed(1)}s 后：${clip(JSON.stringify(parked), 200)}`);
  check('无新弹幕时超时返回空数组', parked.code === 0 && Array.isArray(parked.data) && parked.data.length === 0);
  check('等待时长接近 25 秒', elapsed >= 24 && elapsed <= 29, `实际 ${elapsed.toFixed(1)}s`);

  line(C.dim('  再测一次：挂起期间发一条新弹幕，应当立刻被唤醒……'));
  const t1 = Date.now();
  const pending = request('GET', `/danmaku/since?seq=${head}`, { timeoutMs: 32000 });
  setTimeout(() => {
    request('POST', '/danmaku/send', { body: JSON.stringify({ text: '长轮询唤醒测试', timeMs: 60000 }) })
      .then((r) => line(`  （挂起期间 POST：${clip(r.text, 120)}）`));
  }, 500);
  const woken = JSON.parse((await pending).text);
  const wokeMs = Date.now() - t1;
  line(`  ← 等待 ${(wokeMs / 1000).toFixed(1)}s 后：${clip(JSON.stringify(woken), 240)}`);
  check('挂起期间有新弹幕会提前唤醒（不等到 25 秒）', woken.data.length > 0 && wokeMs < 20000,
    `返回 ${woken.data.length} 条，耗时 ${(wokeMs / 1000).toFixed(1)}s`);
}

/**
 * 预览图：验证 B 站 /x/player/videoshot 口径（雪碧图 + pvdata bin 时间表）。
 *
 * B 站形状（bilibili-API-collect「视频快照」）：
 *   data = { pvdata: '<bin url>', img_x_len: 10, img_y_len: 10, img_x_size: 160,
 *            img_y_size: 90, image: ['<hash>.jpg', '<hash>-1.jpg', …], index: [] }
 *   - 带 index=1 参数时 index 给 JSON 时间表，否则空数组；
 *   - index/bin 内容：第 0 项恒为 0（占位），第 k 项 = 第 k 张截图的秒数，
 *     时间按画面变化程度决定（不均匀），前端用它定位「第 N 秒该用哪张拼版的哪个格子」；
 *   - bin 是 uint16 小端数组（2 字节对齐），与 index 一一对应。
 * 本 mock 等间隔抽帧（FRAME_INTERVAL_SEC=5），时间表是等差数列，格式与 B 站一致。
 */
async function testVideoshot() {
  line(C.title('【8】GET /x/player/videoshot + /videoshot/sprite.jpg + /videoshot/pvdata.bin　进度条预览'));

  const r = await request('GET', '/x/player/videoshot?aid=123&cid=456');
  line(`  videoshot：HTTP ${r.status}，${clip(r.text, 400)}`);

  const hasSprite = health.sprite === 'ready';
  if (!hasSprite) {
    check('没视频/没 ffmpeg 时接口 404（B 站「无快照」口径，不能 500）', r.status === 404,
      `HTTP ${r.status}，health.sprite=${health.sprite}`);
    const img = await request('GET', '/videoshot/sprite.jpg');
    check('无快照时雪碧图也是 404', img.status === 404, `HTTP ${img.status}`);
    const bin = await request('GET', '/videoshot/pvdata.bin');
    check('无快照时 bin 时间表也是 404', bin.status === 404, `HTTP ${bin.status}`);
    line(C.dim('  （未提供 --video 或 ffmpeg 不可用：预览链路整体降级，其余接口正常）'));
    return;
  }

  const json = JSON.parse(r.text);
  const d = json.data;
  check('HTTP 200 且 code=0、ttl=1', r.status === 200 && json.code === 0 && json.ttl === 1);
  check('data 字段齐全（pvdata/img_x_len/img_y_len/img_x_size/img_y_size/image/index）',
    ['pvdata', 'img_x_len', 'img_y_len', 'img_x_size', 'img_y_size', 'image', 'index'].every((k) => k in d),
    `pvdata=${d.pvdata}，每格 ${d.img_x_size}x${d.img_y_size}`);
  check('B 站口径：每张拼版 10x10=100 格', d.img_x_len === 10 && d.img_y_len === 10);
  check('pvdata 指向 bin 时间表（/videoshot/pvdata.bin）',
    typeof d.pvdata === 'string' && d.pvdata.endsWith('/videoshot/pvdata.bin'));
  check('不带 index=1 时 index 是空数组（B 站「无为空」口径）',
    Array.isArray(d.index) && d.index.length === 0, `实际 ${JSON.stringify(d.index)}`);
  check('image 是非空数组且第一项是 /videoshot/sprite.jpg',
    Array.isArray(d.image) && d.image.length > 0 && d.image[0].endsWith('/videoshot/sprite.jpg'),
    `image=${JSON.stringify(d.image)}`);
  check('拼版张数 = ceil(帧数 / 100)',
    d.image.length === Math.ceil(health.spriteFrames / 100),
    `张数=${d.image.length}，帧数=${health.spriteFrames}`);
  check('多拼版命名规律（sprite-1.jpg、sprite-2.jpg…）',
    d.image.every((u, k) => (k === 0 ? u.endsWith('/videoshot/sprite.jpg') : u.endsWith(`/videoshot/sprite-${k}.jpg`))));

  // ---- 带 index=1：JSON 时间表 ----
  const withIdx = JSON.parse((await request('GET', '/x/player/videoshot?aid=123&cid=456&index=1')).text);
  const idxList = withIdx.data.index;
  line(`  index=1 时间表：${idxList.length} 项（首 6 项 ${JSON.stringify(idxList.slice(0, 6))}…）`);
  check('带 index=1 时 index 是非空 JSON 时间表', Array.isArray(idxList) && idxList.length > 1);
  check('第 0 项恒为 0（占位）', idxList[0] === 0);
  check('时间表长度 = 帧数 + 1（第 k 项是第 k 张截图的秒数）',
    idxList.length === health.spriteFrames + 1,
    `时间表 ${idxList.length}，帧数 ${health.spriteFrames}`);
  // 本 mock 等间隔抽帧：第 k 项 = (k-1) * 5 秒（B 站是不均匀的，格式一致、数值规律不同）
  check('等间隔抽帧口径：第 k 项 = (k-1) * 5 秒',
    idxList.every((v, k) => k === 0 || v === (k - 1) * 5),
    `首 6 项 ${JSON.stringify(idxList.slice(0, 6))}`);

  // ---- bin 文件：uint16 小端数组，与 index 一一对应 ----
  const bin = await request('GET', d.pvdata);
  const binTimes = [];
  for (let off = 0; off + 1 < bin.buf.length; off += 2) binTimes.push(bin.buf.readUInt16LE(off));
  check('GET pvdata 返回 200 且是二进制流',
    bin.status === 200 && String(bin.headers['content-type']).includes('octet-stream'),
    `${bin.buf.length} 字节`);
  check('bin 字节数 = 时间表长度 × 2（uint16 对齐）',
    bin.buf.length === idxList.length * 2 && bin.buf.length % 2 === 0,
    `字节 ${bin.buf.length}，期望 ${idxList.length * 2}`);
  check('bin 内容与 index JSON 数组一一对应（uint16 小端）',
    binTimes.length === idxList.length && binTimes.every((v, k) => v === idxList[k]));
  check('bin 第 0 项恒为 0（占位）', binTimes[0] === 0);

  // ---- 验证取图算法：悬停时间 → 时间表二分 → 拼版 + 格内坐标 ----
  line(C.dim('  验证取图算法（时间表二分，B 站写法）：'));
  const tilesPerSheet = d.img_x_len * d.img_y_len;
  const cases = [0, 7, 30, health.durationSec];
  for (const t of cases) {
    // 找最后一个 ≤ t 的项（i ≥ 1），帧 k = i - 1
    let hit = 1;
    for (let i = 1; i < idxList.length; i += 1) {
      if (idxList[i] <= t) hit = i; else break;
    }
    const frame = hit - 1;
    const sheet = Math.floor(frame / tilesPerSheet);
    const local = frame % tilesPerSheet;
    const col = local % d.img_x_len;
    const row = Math.floor(local / d.img_x_len);
    line(`    t=${String(Math.round(t)).padStart(3)}s → 帧 ${frame}（第 ${sheet} 张拼版，列 ${col} 行 ${row}）`);
    check(`t=${Math.round(t)}s 定位到的拼版在 [0, ${d.image.length})`, sheet >= 0 && sheet < d.image.length);
  }

  // ---- 雪碧图文件本身可访问 ----
  const img = await request('GET', d.image[0]);
  check(`GET ${d.image[0]} 返回 200 且是 jpeg`, img.status === 200
    && String(img.headers['content-type']).includes('image/jpeg'), `${img.buf.length} 字节`);
  if (d.image.length > 1) {
    const img2 = await request('GET', d.image[1]);
    check(`多拼版第 2 张 ${d.image[1]} 也返回 200`, img2.status === 200
      && String(img2.headers['content-type']).includes('image/jpeg'), `${img2.buf.length} 字节`);
    const over = await request('GET', `/videoshot/sprite-${d.image.length}.jpg`);
    check('超出张数的拼版返回 404', over.status === 404, `HTTP ${over.status}`);
  }
}

/**
 * 互动视频 perVideo 预览：验证带 avid 的 /x/player/videoshot 与默认视频
 * **完全同一套 B 站口径**（10x10 多拼版 + pvdata bin + index 时间表），
 * 不再是转码脚本时代的 5 列单拼版旧口径。
 */
async function testInteractiveVideoshot() {
  line(C.title('【8b】带 avid 的预览三接口　互动视频 perVideo 与默认视频同口径'));

  // ffmpeg 不可用时互动预览也会整体 404（与默认分支同降级），先探一下：
  // 用一个真实 avid 请求，404 且带 message 就跳过本节（不误报失败）。
  const probe = await request('GET', '/x/player/videoshot?avid=av1000001&index=1');
  if (probe.status !== 200) {
    check('无 ffmpeg 时互动预览按 404 降级（不 500）', probe.status === 404
      && JSON.parse(probe.text).message, `HTTP ${probe.status}`);
    line(C.dim('  （ffmpeg 不可用：互动预览链路整体降级，跳过详细断言）'));
    return;
  }

  // ---- av1000001：正常时长节点，B 站 10x10 多拼版口径 ----
  const json = JSON.parse(probe.text);
  const d = json.data;
  line(`  av1000001 videoshot：${d.image.length} 张拼版（${d.img_x_len}x${d.img_y_len}），每格 ${d.img_x_size}x${d.img_y_size}`);
  check('HTTP 200 且 code=0', probe.status === 200 && json.code === 0);
  check('B 站口径：每张拼版 10x10=100 格（与默认视频同几何）',
    d.img_x_len === 10 && d.img_y_len === 10);
  check('每格 160x90（与默认视频同尺寸）', d.img_x_size === 160 && d.img_y_size === 90);
  check('pvdata 带 avid 指向 bin 时间表',
    typeof d.pvdata === 'string' && d.pvdata.includes('/videoshot/pvdata.bin') && d.pvdata.includes('avid='));
  check('image 数组每项都带同一 avid 参数',
    Array.isArray(d.image) && d.image.length > 0
    && d.image.every((u) => u.includes('avid=av1000001')),
    `image=${JSON.stringify(d.image)}`);

  // ---- index=1 时间表 + bin 一致性（与默认分支同校验口径）----
  const idxList = d.index;
  check('带 index=1 时 index 是非空时间表且首项为 0',
    Array.isArray(idxList) && idxList.length > 1 && idxList[0] === 0);
  check('等间隔抽帧口径：第 k 项 = (k-1) * 5 秒',
    idxList.every((v, k) => k === 0 || v === (k - 1) * 5),
    `首 6 项 ${JSON.stringify(idxList.slice(0, 6))}`);
  check('拼版张数 = ceil((时间表长度-1) / 100)',
    d.image.length === Math.ceil((idxList.length - 1) / 100),
    `张数=${d.image.length}，帧数=${idxList.length - 1}`);

  const bin = await request('GET', d.pvdata);
  const binTimes = [];
  for (let off = 0; off + 1 < bin.buf.length; off += 2) binTimes.push(bin.buf.readUInt16LE(off));
  check('GET pvdata 返回 200 且与 index 一一对应（uint16 小端）',
    bin.status === 200 && binTimes.length === idxList.length
    && binTimes.every((v, k) => v === idxList[k]), `${bin.buf.length} 字节`);

  // ---- 拼版文件可访问、越界 404 ----
  const img = await request('GET', d.image[0]);
  check(`GET 拼版图返回 200 且是 jpeg`, img.status === 200
    && String(img.headers['content-type']).includes('image/jpeg'), `${img.buf.length} 字节`);
  if (d.image.length > 1) {
    const img2 = await request('GET', d.image[1]);
    check('多拼版第 2 张也返回 200', img2.status === 200, `HTTP ${img2.status}`);
  }
  const over = await request('GET', `/videoshot/sprite-${d.image.length}.jpg?avid=av1000001`);
  check('超出张数的拼版返回 404（多拼版语义）', over.status === 404, `HTTP ${over.status}`);

  // ---- av1000009：时长不足一个抽帧间隔的短节点，首帧兜底后仍可用 ----
  const shortR = await request('GET', '/x/player/videoshot?avid=av1000009&index=1');
  if (shortR.status === 200) {
    const sd = JSON.parse(shortR.text).data;
    check('短节点（<5s）首帧兜底：仍返回 B 站口径数据',
      sd.img_x_len === 10 && sd.img_y_len === 10 && sd.index.length === 2,
      `时间表 ${sd.index.length} 项（1 帧）`);
    const shortImg = await request('GET', sd.image[0]);
    check('短节点拼版图可访问', shortImg.status === 200
      && String(shortImg.headers['content-type']).includes('image/jpeg'));
  } else {
    line(C.dim(`  （av1000009 返回 HTTP ${shortR.status}：本机源视频缺失时允许 404）`));
  }

  // ---- 不存在的 avid：404「无快照」口径 ----
  const missing = await request('GET', '/x/player/videoshot?avid=av9999999');
  check('不存在的 avid 返回 404（不 500）', missing.status === 404, `HTTP ${missing.status}`);
}

async function testCorsAnd404() {
  line(C.title('【9】CORS 预检与 404 形状'));
  const pre = await request('OPTIONS', '/x/player/v2', { headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' } });
  check('OPTIONS 预检返回 204 且带 CORS 头',
    pre.status === 204 && pre.headers['access-control-allow-origin'] === '*', `HTTP ${pre.status}`);
  const nf = await request('GET', '/no/such/api');
  check('未知路径返回 404 + JSON 错误体', nf.status === 404 && JSON.parse(nf.text).code !== 0, clip(nf.text, 120));
  // 用普通 HTTP GET 打 WS 端点（常见错法：把 ws:// 写成 http://）应当得到 426 + 明确提示，而不是 404
  const wrong = await request('GET', '/danmaku/ws');
  check('用 HTTP 访问 WS 端点返回 426（提示改用 ws://）',
    wrong.status === 426 && /ws:\/\//.test(wrong.text), `HTTP ${wrong.status} ${clip(wrong.text, 120)}`);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  if (!args.base) {
    line(C.dim(`启动被测服务：node server.js --port ${args.port}（0 = 系统挑空闲端口）`
      + (args.video ? ` --video "${args.video}"` : '')
      + ` --duration ${args.duration} --ws-ping ${WS_PING_SEC}`));
    const childArgs = [
      path.join(__dirname, 'server.js'),
      '--port', String(args.port),
      '--duration', String(args.duration),
      // 心跳压到 1 秒，否则「服务端确实在发 ping」这条断言要等 30 秒
      '--ws-ping', WS_PING_SEC,
    ];
    if (args.video) childArgs.push('--video', args.video);

    // 必须读 stdout 才能知道 --port 0 时系统分了哪个端口，所以用 pipe 而不是 inherit；
    // 服务端会打印一行「地址：http://127.0.0.1:<端口>」，从中解析。
    child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buffered = '';
    const onOutput = (chunk) => {
      const text = chunk.toString('utf8');
      buffered += text;
      process.stdout.write(text.replace(/^/gm, '  [server] '));
      const m = buffered.match(/https?:\/\/[\d.]+:(\d+)/);
      if (m && !BASE) BASE = `http://127.0.0.1:${m[1]}`;
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) line(C.bad(`[自测] 被测服务退出，code=${code}`));
    });

    const deadline = Date.now() + 10000;
    while (!BASE && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    if (!BASE) throw new Error('没能从服务日志里解析出监听地址，请用 --base 手动指定');
  } else {
    line(C.dim(`测试已在运行的服务：${BASE}`));
  }

  health = await waitReady();
  line(C.dim(`服务就绪：${JSON.stringify(health)}`));

  await testTestPage();
  await testHealth();
  await testViewPoints();
  await testPbp();
  await testDmList();
  await testSendAndSse();
  await testWebSocket();
  await testSince();
  await testVideoshot();
  await testInteractiveVideoshot();
  await testCorsAnd404();

  line(C.title('自测汇总'));
  line(`  通过 ${C.ok(passCount)} 项，失败 ${failCount ? C.bad(failCount) : 0} 项`);
  return failCount === 0 ? 0 : 1;
}

main()
  .then((code) => {
    if (child) child.kill();
    setTimeout(() => process.exit(code), 300); // 留点时间把子进程日志刷完
  })
  .catch((err) => {
    line(C.bad(`自测失败：${err && err.stack ? err.stack : err}`));
    if (child) child.kill();
    setTimeout(() => process.exit(1), 300);
  });
