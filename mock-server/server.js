#!/usr/bin/env node
/**
 * ============================================================================
 * hilihili 播放器（front/player）本地测试服务 —— mock-server/server.js
 * ============================================================================
 *
 * 作用：不连真实 B 站后端，也能把「进度条预览图 / 高能进度条 / 弹幕 / 进度条节点」
 *      这几条链路完整跑通。返回的数据格式刻意照抄哔哩哔哩，前端不用改代码。
 *
 * 依赖：只用 Node 内置模块（node:http / fs / path / crypto / child_process / url），
 *      Node >= 18，零 npm 依赖，不需要 npm install。
 *
 * 用法：
 *   node front/player/mock-server/server.js
 *   node front/player/mock-server/server.js --port 9101 --video D:\movies\demo.mp4 --aid 123 --cid 456
 *   node front/player/mock-server/server.js --ws-ping 1     # 心跳改成 1 秒（自测用）
 *   node front/player/mock-server/server.js --help
 *
 * 接口一览：
 *   GET  /x/player/v2?aid=&cid=     进度条节点 view_points（from/to 单位：秒）
 *   GET  /x/player/pbp?aid=&cid=    高能进度条曲线（0~1 浮点数组）
 *   GET  /x/v1/dm/list.so?oid=      弹幕 XML（B 站 list.so 格式，启动时生成 1000 条随机弹幕）
 *   GET  /v1/dm/list.so?oid=        上面那条的简写别名（返回完全相同的 XML）
 *   POST /danmaku/send              发一条弹幕 → 入库 + 广播给所有 SSE 和 WebSocket 连接
 *   GET  /danmaku/stream            SSE 实时弹幕流
 *   WS   /danmaku/ws                WebSocket 实时弹幕（手写 RFC6455，收发双向）
 *   GET  /danmaku/since?seq=N       长轮询兜底拉取
 *   GET  /videoshot/preview.bin     进度条预览图（UTF-8 文本，\u001F 分隔的 data URL）
 *
 * 【为什么要手写 WebSocket（不用 npm 的 ws）】
 *   本工程要求零 npm 依赖，而 Node 内置模块里只有 WebSocket **客户端**（且要 Node 22+），
 *   没有服务端实现。好在 RFC6455 的服务端只需要三件事：握手（sha1 + base64）、
 *   帧解析（含掩码解 unmask）、帧封装（服务端发出的帧**不能**带掩码）。
 *   全部代码不到 200 行，见下面「11. WebSocket」一节。
 *
 * 【为什么这个文件必须用 ESM 而不是 require】
 *   本文件躺在 front/player/ 目录下，而 front/player/package.json 里写着
 *   "type": "module"，mock-server 目录下又没有自己的 package.json。Node 的模块类型是
 *   按「最近的 package.json」决定的，所以这个 server.js 会被当成 ES Module 执行；
 *   一旦写成 require(...) 就会在第一行直接抛
 *   "require is not defined in ES module scope"。这里统一用 import。
 *   （也因此 __dirname 不存在，需要自己用 import.meta.url 推出来。）
 * ============================================================================
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* ---------------------------------------------------------------------------
 * 0. 基础路径
 * ------------------------------------------------------------------------- */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 抽帧结果缓存目录：mock-server/.cache/<md5>/preview.bin
// 放在 mock-server 下面（而不是系统临时目录），是为了能一眼看到、也方便手动删掉重建。
const CACHE_ROOT = path.join(__dirname, '.cache');

/* ---------------------------------------------------------------------------
 * 1. 常量
 * ------------------------------------------------------------------------- */

// 【为什么所有响应都带 CORS】
//   播放器开发时跑在 vite（front/player/vite.config.ts 里是 :5180），mock 服务在
//   :9101，二者属于跨源。浏览器对 fetch/XHR 会做同源检查，不加这个头前端只会看到
//   CORS 报错。用 * 而不是回显 Origin，是因为纯本地测试、不带 Cookie 凭证。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const DEFAULT_PORT = 9101;
// 默认只听 127.0.0.1：避免 Windows 首次启动弹防火墙授权框；要局域网/手机调试再传 --host 0.0.0.0
const DEFAULT_HOST = '127.0.0.1';

// ffprobe/ffmpeg 的位置允许用环境变量覆盖：ffmpeg 绿色解压版没进 PATH 是最常见的坑
const FFPROBE_BIN = process.env.FFPROBE_PATH || 'ffprobe';
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

// 兜底时长（秒），可用 --duration 覆盖。所有接口都依赖时长，给个固定值能保证服务照常可用。
const DEFAULT_DURATION = 600;

const VIEW_POINT_COUNT = 5;
const VIEW_POINT_TITLES = ['开场', '正片', '高能', '反转', '彩蛋'];

const PBP_STEP_SEC = 30;      // 高能进度条每 30 秒一个采样点
const LONG_POLL_MS = 25000;   // /danmaku/since 最长挂起 25 秒
const HEARTBEAT_MS = 15000;   // SSE 心跳间隔 15 秒

const FRAME_INTERVAL_SEC = 5; // 预览图抽帧间隔，必须和前端 Math.floor(t / 5) 对齐
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;
const MAX_FRAMES = 10000;     // 抽帧上限，防止误传十几个小时的视频把磁盘/CPU 打满

// 预览图接口路径。view_points[i].img_url、/videoshot/index.json 的 pvdata.img_url 和 image[0]、
// 以及下面路由里的判断都用这一个常量 —— 同一个地址在四个地方各写一遍，迟早改一处漏三处。
// 【为什么用相对路径】B 站这个字段给的是绝对 URL，但本 mock 的 image[0] 一直是相对路径，
// 客户端按 `dataBaseUrl + 路径` 拼（Main.qml 的 dataBaseUrl 默认就是 http://127.0.0.1:9101）。
// img_url 保持同一种写法，两边才能直接字符串比对、也不会有人拼出两个 host 叠在一起。
const PREVIEW_PATH = '/videoshot/preview.bin';

// 【为什么用 \u001F 当分隔符】
//   0x1F 是 ASCII 的 Unit Separator，属于控制字符，在 base64 字母表（A-Za-z0-9+/=）
//   里绝不可能出现，所以用它切分 data URL 是「无歧义」的；同时它比 JSON 数组更省体积
//   （每帧少一对引号），解析也只要一次 split。B 站真实 preview.bin 就是这么干的，
//   前端 front/player/src/api/preview.ts 也是按 split("\u001F") 写的，保持一致最省事。
const UNIT_SEP = '\u001F';

// 雪碧图（sprite）路径：把抽帧得到的 jpg 拼成一张 tile=NxM 的大图，
// 客户端按 img_x_len/img_y_len/img_x_size/img_y_size 裁切定位。
// 与 preview.bin（逐帧 data URL 列表）**同时提供**，客户端可任选一种。
const SPRITE_PATH = '/videoshot/sprite.jpg';
const SPRITE_X_LEN = 5;       // 雪碧图列数（每行 5 格，与 B 站 pvdata 的 img_x_len 一致）

// 抽帧总数（确定性公式，不需要真的抽过帧就能算出来，供 view_points / index.json 提前报出参数）
function previewFrameCount() {
  return Math.max(1, Math.min(MAX_FRAMES, Math.ceil(DURATION / FRAME_INTERVAL_SEC)));
}

// 雪碧图几何：行数按列数向上取整，末行不足时 tile 滤镜会自动补黑格
function spriteGeometry() {
  const count = previewFrameCount();
  return {
    xLen: SPRITE_X_LEN,
    yLen: Math.max(1, Math.ceil(count / SPRITE_X_LEN)),
    xSize: FRAME_WIDTH,
    ySize: FRAME_HEIGHT,
    count,
  };
}

const DM_TEXT_LIMIT = 100;    // 和 B 站一致：单条弹幕最多 100 字
const HISTORY_LIMIT = 1000;   // 内存里保留的最近弹幕条数，供 /danmaku/since 补齐

// 启动时预生成的随机弹幕条数。为什么是 1000：
//   1. list.so 的 <maxlimit> 就是 1000，真实 B 站一份弹幕池也在千条量级；
//   2. 1000 条能把整片时长铺满，播放器拉下来就能看到密度合理的一屏弹幕。
const DANMAKU_TOTAL = 1000;

// 弹幕文案池。故意塞了 'A & B <测试>' 这条：用来验证 XML 转义确实生效，
// 否则这样的文本会把 <i>...</i> 文档结构直接撑坏。
const DM_TEXTS = [
  '文本', '前方高能', '哈哈哈哈哈', 'awsl', '第一次看', '这波操作可以',
  '爷青回', '泪目了', 'BGM 神了', '一键三连', 'A & B <测试>', '都 2024 年了还有人看吗',
  '画质炸裂', '这里我看了十遍', '打卡', 'up 主加油', '笑死我了', '名场面',
  '梦开始的地方', '有生之年系列', '这剪辑绝了', '太好哭了', '我又来了',
  '第三遍', '名场面预定', '空降成功', '前方核能', '不要眨眼',
  '这波我站 up 主', '弹幕护体', '后面的兄弟等等我', '此处应有掌声', '神弹幕',
  '这 BGM 我能听一年', 'up 主是不是换设备了', '清晰度拉满', '进度条警告',
  '高能预警', '笑不活了', '第一次见这种操作', '这就是专业', '神仙打架',
  '考古打卡', '原著党路过', '配音太顶了', '细节满分', '循环播放中',
];

// 【色板照抄参考实现】hilihili-player/player/src/component/selection/index.ts:9-24 的
// colorList 就是下面这 14 个色号（B 站弹幕姬同款），随机颜色直接用它，不自己调色。
// 同时存一份十进制：list.so 的 p 属性第 4 段要的是**十进制 RGB**（B 站口径），
// 每次请求再转换纯属浪费，而且十六进制和十进制混用最容易写错。
const DM_PALETTE = [
  '#FE0302', '#FF7204', '#FFAA02', '#FFD302', '#FFFF00', '#A0EE00', '#00CD00',
  '#019899', '#4266BE', '#89D5FF', '#CC0273', '#222222', '#9B9B9B', '#FFFFFF',
];
const DM_PALETTE_DEC = DM_PALETTE.map((hex) => Number.parseInt(hex.slice(1), 16));

// 【速度档照抄参考实现】hilihili-player/player/src/component/rowdm/index.ts:109-127 的
// handleScrollDanmu 把速度分成 5 档（verySlow 50 / slow 60 / moderate 75 / fast 90 / veryFast 100 px/s）。
// 档位名和参考的 Danmaku 类型（player/src/types/danmaku.ts:9-10）里的字符串完全一致，
// 这样 WS 推过去的 speed 可以原样喂给 rowdm，不用再做一次映射。
const DM_SPEEDS = ['verySlow', 'slow', 'moderate', 'fast', 'veryFast'];
// 权重按参考素材（assets/json/danmaku.json）里的观感来：中速最多、两端稀疏，合计 100
const DM_SPEED_WEIGHTS = [10, 20, 40, 20, 10];

// 模式：1~3 滚动 / 4 底部 / 5 顶部（list.so 的 p 属性第 2 段是**数字**；
// 而参考实现里 Danmaku.mode 是 'scroll' | 'top' | 'bottom' 字符串，两边都要，
// 所以这里同时备好「数字 → 字符串」和「字符串 → 数字」两张表）
const DM_MODE_SCROLL = 1;
const DM_MODE_BOTTOM = 4;
const DM_MODE_TOP = 5;
const DM_MODE_TO_NAME = { 1: 'scroll', 2: 'scroll', 3: 'scroll', 4: 'bottom', 5: 'top' };
const DM_NAME_TO_MODE = { scroll: DM_MODE_SCROLL, bottom: DM_MODE_BOTTOM, top: DM_MODE_TOP };

// 字号档照抄参考 selection/index.ts:36-44 的「小 / 标准」两档；数值用 B 站口径 18 / 25，
// 和 player.scss 里 .danmaku-x-dm 的 font-size: var(--fontSize, 25px) 默认值对得上。
// （发送框的第三档「36 大」只出现在自测页，随机生成不发这一档，所以不给它单独定义常量。）
const DM_FONT_SMALL = 18;
const DM_FONT_NORMAL = 25;

/* ---- WebSocket（RFC6455）相关常量 ---- */

// RFC6455 §4.2.2 规定握手用的固定 GUID，写死在这里（不是配置项）
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_PATH = '/danmaku/ws';
// 单帧上限 1MB：一条弹幕最多 100 字，正常帧是几百字节；超了只可能是客户端出错或有人在打服务
const WS_MAX_PAYLOAD = 1024 * 1024;
const DEFAULT_WS_PING_SEC = 30;
// RFC6455 的 opcode（低 4 位）
const WS_OPCODE = { cont: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xA };

/* ---------------------------------------------------------------------------
 * 2. 日志
 * ------------------------------------------------------------------------- */

function log(...parts) {
  console.log(`[mock ${new Date().toISOString().slice(11, 19)}]`, ...parts);
}

function warn(...parts) {
  // 警告统一走 stderr，方便和正常访问日志分开看（也满足「打一条 stderr 警告」的要求）
  console.error('[mock warn]', ...parts);
}

/* ---------------------------------------------------------------------------
 * 3. 命令行参数
 * ------------------------------------------------------------------------- */

const USAGE = `
hilihili 播放器测试服务（mock-server）

用法：
  node front/player/mock-server/server.js [options]

参数：
  --port <n>       监听端口，默认 ${DEFAULT_PORT}
  --host <addr>    监听地址，默认 ${DEFAULT_HOST}（传 0.0.0.0 可供局域网访问）
  --video <file>   用哪个视频文件：ffprobe 取时长、ffmpeg 抽预览帧
  --aid <id>       默认 aid（请求里带 aid 时以请求为准）
  --cid <id>       默认 cid（请求里带 cid 时以请求为准）
  --duration <秒>  拿不到片长时的兜底时长，默认 ${DEFAULT_DURATION}
  --ws-ping <秒>   WebSocket 心跳间隔，默认 ${DEFAULT_WS_PING_SEC}（自测时传 1 秒，不用真等半分钟）
  -h, --help       显示本帮助

环境变量：
  FFPROBE_PATH / FFMPEG_PATH   ffprobe / ffmpeg 可执行文件路径（没进 PATH 时用）

接口：
  GET  /x/player/v2?aid=&cid=
  GET  /x/player/pbp?aid=&cid=
  GET  /x/v1/dm/list.so?oid=      （别名：/v1/dm/list.so）
  POST /danmaku/send
  GET  /danmaku/stream
  WS   /danmaku/ws
  GET  /danmaku/since?seq=N
  GET  /videoshot/preview.bin
`;

function parseArgs(argv) {
  const opts = {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    video: '',
    aid: '',
    cid: '',
    duration: DEFAULT_DURATION,
    wsPing: DEFAULT_WS_PING_SEC,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '-h' || raw === '--help') {
      opts.help = true;
      continue;
    }
    if (!raw.startsWith('--')) continue;

    // 同时支持 --port 9101 和 --port=9101 两种写法
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw : raw.slice(0, eq);
    const inlineValue = eq === -1 ? null : raw.slice(eq + 1);

    const takeValue = () => {
      if (inlineValue !== null) return inlineValue;
      const next = argv[i + 1];
      // 下一个 token 也是 -- 开头的选项（或已到末尾）时，认为这个参数没给值
      if (next === undefined || next.startsWith('--')) return '';
      i += 1;
      return next;
    };

    if (key === '--port') {
      const port = Number(takeValue());
      // 0 也放行：让操作系统随便挑一个空闲端口，便于并行起多个实例
      if (Number.isInteger(port) && port >= 0 && port < 65536) {
        opts.port = port;
      } else {
        warn(`--port 取值不合法，继续使用默认端口 ${DEFAULT_PORT}`);
      }
    } else if (key === '--host') {
      opts.host = takeValue() || DEFAULT_HOST;
    } else if (key === '--video') {
      opts.video = takeValue();
    } else if (key === '--aid') {
      opts.aid = takeValue();
    } else if (key === '--cid') {
      opts.cid = takeValue();
    } else if (key === '--duration') {
      const duration = Number(takeValue());
      if (Number.isFinite(duration) && duration > 0) {
        opts.duration = duration;
      } else {
        warn(`--duration 取值不合法，继续使用默认兜底时长 ${DEFAULT_DURATION}s`);
      }
    } else if (key === '--ws-ping') {
      const sec = Number(takeValue());
      // 【为什么要做成参数】默认 30 秒心跳是给真实播放场景用的，但自测脚本要验证「心跳确实在发」，
      // 真等 30 秒太慢；传 --ws-ping 1 就能一秒验完，不用为此在代码里塞测试专用分支。
      if (Number.isFinite(sec) && sec > 0) {
        opts.wsPing = sec;
      } else {
        warn(`--ws-ping 取值不合法，继续使用默认心跳 ${DEFAULT_WS_PING_SEC}s`);
      }
    } else {
      warn(`未知参数 ${raw}（用 --help 看支持的参数）`);
    }
  }

  return opts;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

/* ---------------------------------------------------------------------------
 * 4. 片长：优先 ffprobe，失败就用兜底值
 * ------------------------------------------------------------------------- */

function probeDuration(videoPath) {
  const fallback = opts.duration;

  if (!videoPath) {
    warn(`未提供 --video，按兜底时长 ${fallback}s 生成数据`);
    return { duration: fallback, source: '命令行兜底 / --duration' };
  }

  try {
    const out = execFileSync(
      FFPROBE_BIN,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath],
      { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const parsed = Number.parseFloat(String(out).trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return { duration: parsed, source: 'ffprobe（真实时长）' };
    }
    warn(`ffprobe 没解析出有效时长（输出 ${JSON.stringify(String(out).trim())}），改用兜底 ${fallback}s`);
  } catch (err) {
    // ffprobe 不存在 / 视频损坏 / 执行超时都落到这里。
    // 测试服务不能因为拿不到时长就起不来，所以只警告、不抛错。
    warn(`ffprobe 调用失败（${String(err.message).split('\n')[0]}），改用兜底 ${fallback}s`);
  }

  return { duration: fallback, source: 'ffprobe 探测失败，回退 --duration' };
}

const probed = probeDuration(opts.video);
const DURATION = probed.duration;

// WebSocket 心跳间隔（毫秒）。放在这里而不是常量区，是因为它依赖命令行参数 --ws-ping。
const WS_HEARTBEAT_MS = Math.round(opts.wsPing * 1000);

/* ---------------------------------------------------------------------------
 * 5. 内存状态（弹幕）
 * ------------------------------------------------------------------------- */

const sseClients = new Set();      // 每个元素：{ res }
const wsClients = new Set();       // 每个元素：{ id, socket, remote, buffer, fragments, alive }
const longPollWaiters = new Set(); // 每个元素：{ res, seq, timer }
const dmHistory = [];              // 最近若干条弹幕，供长轮询补齐

let danmakuSeq = 0; // 自增序号，前端靠它做 since 增量拉取
let wsClientSeq = 0; // WS 连接编号，只用来打日志和区分广播来源（不是弹幕 id）

// 预览图状态：抽帧是懒加载的（第一次请求 /videoshot/preview.bin 才动手），
// 所以 index.json 和自测页需要这个状态来判断「是没请求过、正在抽、还是失败了」。
const previewState = {
  status: 'idle',   // idle | ready | unavailable
  message: '',
  reason: '',
  frameCount: 0,
};

// 雪碧图状态：与 previewState 并列，供 /healthz、/videoshot/index.json、自测页共用
const spriteState = {
  status: 'idle',
  message: '',
  bytes: 0,
  file: '',
};

/* ---------------------------------------------------------------------------
 * 6. 通用响应工具
 * ------------------------------------------------------------------------- */

function sendJson(res, status, body, extraHeaders) {
  if (res.writableEnded) return;
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...(extraHeaders || {}),
  });
  res.end(text);
}

function sendText(res, status, text, contentType) {
  if (res.writableEnded) return;
  const buf = Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8');
  res.writeHead(status, {
    ...CORS,
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

function sendBinary(res, status, buf, contentType) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    ...CORS,
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

// 请求里的 aid/cid 优先，其次才是启动参数。两者不一致时只提示、不拦截：
// mock 数据和 aid/cid 无关，写死校验只会白白挡住前端调试。
function pickIds(url) {
  const aid = url.searchParams.get('aid') || opts.aid || '';
  const cid = url.searchParams.get('cid') || opts.cid || '';
  if (opts.aid && url.searchParams.get('aid') && url.searchParams.get('aid') !== opts.aid) {
    warn(`请求 aid=${url.searchParams.get('aid')} 与启动参数 --aid ${opts.aid} 不一致，仍返回 mock 数据`);
  }
  if (opts.cid && url.searchParams.get('cid') && url.searchParams.get('cid') !== opts.cid) {
    warn(`请求 cid=${url.searchParams.get('cid')} 与启动参数 --cid ${opts.cid} 不一致，仍返回 mock 数据`);
  }
  return { aid, cid };
}

function readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error(`请求体超过 ${limitBytes} 字节`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`JSON 解析失败：${String(err.message)}`));
      }
    });
    req.on('error', reject);
  });
}

/* ---------------------------------------------------------------------------
 * 7. 接口 1：进度条节点 /x/player/v2
 * ------------------------------------------------------------------------- */

function buildViewPoints(durationSec) {
  const points = [];
  const seg = durationSec / VIEW_POINT_COUNT;

  for (let i = 0; i < VIEW_POINT_COUNT; i += 1) {
    // from/to 单位是「秒」，不是毫秒：B 站就是这么返回的，前端要拿它除以总时长算百分比，
    // 写成毫秒会让整条进度条的高亮区间全部错位。
    // 用同一个边界表达式算 to 和下一段的 from，保证首尾相接、不留空隙；
    // 最后一段强制收到片尾，否则进度条最右边一小截高亮区间会缺失。
    const from = Math.round(i * seg);
    const to = i === VIEW_POINT_COUNT - 1 ? Math.round(durationSec) : Math.round((i + 1) * seg);
    points.push({
      from,
      to,
      content: VIEW_POINT_TITLES[i],
      // 下面 4 个字段是 B 站 sprite 雪碧图参数（每格 FRAME_WIDTH x FRAME_HEIGHT）。
      // img_url 指向真正的雪碧图 /videoshot/sprite.jpg（可直接当图片加载、按参数裁切）；
      // img_url_frames 是并列的第二种数据源（\u001F 分隔的逐帧 data URL 列表），
      // 客户端按能力任选一种。
      img_url: SPRITE_PATH,
      img_url_frames: PREVIEW_PATH,
      img_x_len: spriteGeometry().xLen,
      img_y_len: spriteGeometry().yLen,
      img_x_size: FRAME_WIDTH,
      img_y_size: FRAME_HEIGHT,
      // 该节点起始时间对应的雪碧图切片下标（列 = 下标 % img_x_len，行 = 下标 / img_x_len）
      img_index: Math.floor(from / FRAME_INTERVAL_SEC),
    });
  }

  return points;
}

/* ---------------------------------------------------------------------------
 * 8. 接口 2：高能进度条 /x/player/pbp
 * ------------------------------------------------------------------------- */

function buildPbpData(durationSec) {
  // 长度按 ceil(时长 / step_sec)：600s / 30 = 20 个点
  const length = Math.max(1, Math.ceil(durationSec / PBP_STEP_SEC));
  const data = new Array(length);

  for (let i = 0; i < length; i += 1) {
    // 几段不同周期的正弦叠加：既有大起伏，又有小毛刺，看起来像真实热度曲线。
    // 刻意不用 Math.random()，原因有两个：
    //   1. 随机数每次请求都不一样，播放器上看起来像闪屏，前端调试时也无法对比两次结果；
    //   2. 正弦叠加天然有「低谷—爬升—尖峰—回落」的形状，一眼就能判断 pbp 有没有被正确画出来，
    //      而「全 0」或「纯乱抖」都测不出问题。
    // 各段振幅之和是 0.26+0.13+0.05+0.03 = 0.47，加上 0.5 的基准后取值落在 0.03~0.97，
    // 既不会撞到 0/1 被夹成一条平线（那样就看不出起伏了），又能拉开明显的高低差。
    // 四个周期（4.2 / 1.8 / 0.65 / 无理数纹理）互不整除，20 个采样点内不会重复成周期波。
    const value =
      0.5 +
      0.26 * Math.sin(i / 4.2) +          // 长周期：整片的大起大落（主导起伏）
      0.13 * Math.sin(i / 1.8 + 1.1) +    // 中周期：段落级波动
      0.05 * Math.sin(i / 0.65 + 2.4) +   // 短周期：高频抖动
      0.03 * Math.sin(i * 12.9898);       // 固定纹理，避免曲线过于「数学化」

    // 兜底夹到 [0,1]：前端直接拿它当高度百分比用，越界会画出屏幕外。
    // 上面的振幅已经把值约束在 0.03~0.97，这里的夹取只是防御性的，正常不会生效。
    // 保留 4 位小数，既够精细，也不会让响应里全是浮点尾巴。
    data[i] = Number(Math.min(1, Math.max(0, value)).toFixed(4));
  }

  return data;
}

/* ---------------------------------------------------------------------------
 * 9. 接口 3：弹幕 XML /x/v1/dm/list.so（启动时生成的 1000 条随机弹幕）
 * ------------------------------------------------------------------------- */

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&apos;';
    }
  });
}

function makeDanmaku(timePoint, text, mode, fontSize, color, uid, rowId, speed) {
  return {
    timePoint: Number(Number(timePoint).toFixed(2)), // p 的第一个字段：出现时间（秒，可带小数）
    mode,          // 1 滚动 / 4 底部固定 / 5 顶部固定
    fontSize,      // 25 标准，18 小号
    color,         // 十进制 RGB
    timestamp: 1700000000 + rowId, // 发送时的 Unix 时间戳（秒）
    pool: 0,       // 弹幕池：0 普通
    uid,           // 发送者哈希
    rowId,         // 弹幕在池中的行号（同时也是这里的唯一 id）
    speed,         // 播放器 rowdm 的速度档（滚动弹幕用）；p 属性没有这一格，见 /healthz.danmakuBySpeed
    text,
  };
}

// [0, max) 的随机整数。Math.random() 已经够用：这里只需要「分布均匀」，不需要密码学强度。
function randomInt(max) {
  return Math.floor(Math.random() * max);
}

// 按权重抽一个速度档：把 0~99 的分位依次减掉各档权重，减到负数就落在哪一档。
// 比「先展开成 100 个元素的数组再随机取」省内存，也比等概率更接近真实弹幕的观感。
function pickSpeed() {
  let r = randomInt(100);
  for (let i = 0; i < DM_SPEEDS.length; i += 1) {
    r -= DM_SPEED_WEIGHTS[i];
    if (r < 0) return DM_SPEEDS[i];
  }
  return 'moderate'; // 权重合计 100 时走不到这里，纯属兜底
}

/**
 * 生成整片时长的随机弹幕（DANMAKU_TOTAL 条），供 /x/v1/dm/list.so 返回。
 *
 * 【为什么在启动时就生成、而不是每次请求现算】
 *   1. 播放器一次拉取就是 1000 条，每次请求都重新随机会让「刷新一次换一批弹幕」，
 *      排查渲染问题时根本没法对比两次结果；启动时定死一批，整个进程生命周期内稳定。
 *   2. /healthz 的 danmakuCount 必须随时等于真实条数，懒加载会让「还没请求过 list.so」
 *      这段时间报出 0，自测脚本就没法用它当断言。生成 1000 个对象只花几毫秒，不差这点启动时间。
 *
 * 【为什么是「均匀 + 抖动」而不是纯随机】
 *   纯随机（durationSec * Math.random()）会扎堆成团、留下大片空白，看起来不像真实弹幕；
 *   完全等分又整齐得一眼假。基准取等分槽 i*slot、再在槽内随机偏一点，最接近真实分布。
 */
function generateHistoryDanmaku(durationSec) {
  const items = [];
  const slot = durationSec / DANMAKU_TOTAL; // 每条弹幕占的时间槽（秒）

  for (let i = 0; i < DANMAKU_TOTAL; i += 1) {
    const jitter = (Math.random() - 0.5) * slot * 0.9;
    // 夹到 [0, 片长-0.1]：落在片尾之外的弹幕播放器永远不会显示，等于白生成
    const timePoint = Math.min(Math.max(0, i * slot + jitter), Math.max(0, durationSec - 0.1));

    // 模式比例：滚动 88%、顶部 7%、底部 5%。真实弹幕池里固定弹幕就是少数，
    // 平均分（各 1/3）会让画面上糊满顶/底弹幕，一眼就不像 B 站。
    const r = Math.random();
    const mode = r < 0.88 ? DM_MODE_SCROLL : (r < 0.95 ? DM_MODE_TOP : DM_MODE_BOTTOM);
    // 字号：小/标准两档（参考 selection 的字号选择），标准档多一倍
    const fontSize = Math.random() < 0.34 ? DM_FONT_SMALL : DM_FONT_NORMAL;
    const colorIdx = randomInt(DM_PALETTE_DEC.length);

    items.push(makeDanmaku(
      timePoint,
      DM_TEXTS[randomInt(DM_TEXTS.length)], // 内容从短语池随机取，可能重复（真实弹幕也这样）
      mode,
      fontSize,
      DM_PALETTE_DEC[colorIdx],
      `uid${randomInt(9999) + 1}`,
      i + 1,                                 // 行号从 1 开始，顺带当唯一 id 用
      pickSpeed(),
    ));
  }

  // 按时间升序：rowdm 是按时间区间过滤的，乱序会让弹幕出现顺序错乱
  items.sort((a, b) => a.timePoint - b.timePoint);
  return items;
}

// 启动即生成：见 generateHistoryDanmaku 的注释。之后这份数组只读，不再改动。
const historyDanmaku = generateHistoryDanmaku(DURATION);
log(`已生成 ${historyDanmaku.length} 条随机弹幕（覆盖 0~${Math.round(DURATION)}s；颜色取参考 selection 色板，速度档取参考 rowdm）`);

// 随机速度档的分布统计。list.so 的 p 属性只有 8 格、装不下 speed（B 站格式如此），
// 所以把统计放进 /healthz：既能让「确实随机出了 5 档」这件事可核对，也避免生成出没人看的数据。
function countBySpeed(items) {
  const counts = {};
  for (const name of DM_SPEEDS) counts[name] = 0;
  for (const item of items) {
    if (item.speed in counts) counts[item.speed] += 1;
  }
  return counts;
}

// 1000 条拼 XML 大约 100KB，每次请求都重新拼纯属浪费；这份列表在运行期不变，所以拼一次就缓存。
let danmakuXmlCache = null;

function danmakuXml() {
  if (danmakuXmlCache === null) {
    danmakuXmlCache = renderDanmakuXml(historyDanmaku);
    log(`弹幕 XML 已生成并缓存：${historyDanmaku.length} 条 / ${Buffer.byteLength(danmakuXmlCache)} 字节`);
  }
  return danmakuXmlCache;
}

function renderDanmakuXml(items) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<i>',
    '  <chatserver>chat.bilibili.com</chatserver>',
    '  <chatid>0</chatid>',
    '  <mission>0</mission>',
    '  <maxlimit>1000</maxlimit>',
    '  <state>0</state>',
    '  <real_name>0</real_name>',
    '  <source>k-v</source>',
  ];

  for (const dm of items) {
    // p 属性的 8 个字段：时间(秒),模式,字号,颜色,发送时间戳,弹幕池,用户哈希,行号
    const p = [dm.timePoint, dm.mode, dm.fontSize, dm.color, dm.timestamp, dm.pool, dm.uid, dm.rowId].join(',');
    // 文本必须转义，否则 'A & B <测试>' 这类内容会直接破坏 XML 结构，前端 DOMParser 会报错。
    // 属性值 p 也一起转义：虽然当前都是数字和逗号，但转义了以后加字段也不会踩坑。
    lines.push(`  <d p="${escapeXml(p)}">${escapeXml(dm.text)}</d>`);
  }

  lines.push('</i>');
  return lines.join('\n');
}

/* ---------------------------------------------------------------------------
 * 10. 接口 4~6：弹幕发送 / SSE / 长轮询
 * ------------------------------------------------------------------------- */

function itemsSince(seq) {
  // seq 是单调递增的：SSE 是「连上之后才有」，断线期间的消息会丢，
  // 有了 seq，客户端重连后调一次 /danmaku/since?seq=N 就能把漏掉的补齐。
  return dmHistory.filter((item) => item.seq > seq);
}

function flushLongPollWaiters() {
  for (const waiter of longPollWaiters) {
    const fresh = itemsSince(waiter.seq);
    if (fresh.length === 0) continue;
    clearTimeout(waiter.timer);
    longPollWaiters.delete(waiter); // 边遍历边删当前元素，Set 的迭代器支持这种用法
    sendJson(waiter.res, 200, { code: 0, data: fresh });
  }
}

function broadcastDanmaku(record) {
  const payload = `data: ${JSON.stringify(record)}\n\n`;

  for (const client of sseClients) {
    if (client.res.writableEnded) continue;
    // 写失败不用在这里擦屁股：连接断了会触发 req/res 的 close 事件，那里统一回收
    client.res.write(payload);
  }

  flushLongPollWaiters();
}

function appendDanmaku(record) {
  dmHistory.push(record);
  // 只留最近 HISTORY_LIMIT 条：长时间挂着发弹幕也不会把内存吃爆
  if (dmHistory.length > HISTORY_LIMIT) {
    dmHistory.splice(0, dmHistory.length - HISTORY_LIMIT);
  }
}

// ---- 入参归一化：POST 的 JSON body 和 WS 的 {"type":"send"} 共用同一套 ----

// 时间：timeMs（毫秒，旧的 POST 约定）和 timeSec（秒，参考实现 Danmaku.timePoint 的口径）都收。
// 两个都认是因为 QML 播放器手里是秒，而 HTTP 那条链路的历史约定是毫秒，
// 让调用方自己换算迟早会有人算错 1000 倍 —— 那种 bug 在时间轴上一眼看不出来。
// 顺手取整到毫秒：SSE/长轮询消费的是「毫秒数」，带一串浮点尾巴没有意义。
function normalizeTimeMs(input) {
  if (Number.isFinite(Number(input.timeMs))) return Math.round(Number(input.timeMs));
  if (Number.isFinite(Number(input.timeSec))) return Math.round(Number(input.timeSec) * 1000);
  return 0;
}

// 模式：数字（1/4/5，B 站 p 属性口径）和字符串（scroll/top/bottom，参考 Danmaku.mode 口径）都收
function normalizeMode(mode) {
  if (typeof mode === 'string') {
    const name = mode.trim().toLowerCase();
    if (DM_NAME_TO_MODE[name]) return DM_NAME_TO_MODE[name];
    const asNumber = Number(name);
    if (Number.isFinite(asNumber) && DM_MODE_TO_NAME[asNumber]) return Math.round(asNumber);
    return DM_MODE_SCROLL; // 认不出来就当滚动：这是唯一不会让弹幕「卡住不动」的档
  }
  const num = Number(mode);
  if (Number.isFinite(num) && DM_MODE_TO_NAME[num]) return Math.round(num);
  return DM_MODE_SCROLL;
}

// 颜色：'#RRGGBB'（参考 selection 的色板就是这种写法）和十进制（p 属性口径）都收。
// 内部一律存十进制，因为 SSE/长轮询那条旧链路的 color 就是十进制，改了会破坏现有消费方。
function normalizeColor(color) {
  if (typeof color === 'string') {
    const hex = color.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return Number.parseInt(hex, 16);
  }
  const num = Number(color);
  // 越界值（比如把 '#FFFFFF' 当数字解析失败后的 NaN）一律兜到白色，而不是抛错：
  // 发弹幕是「尽力而为」的操作，颜色不对远好过整条弹幕发不出去。
  if (Number.isFinite(num) && num >= 0 && num <= 0xFFFFFF) return Math.floor(num);
  return 0xFFFFFF;
}

// 字号：只兜住非法值。18 小 / 25 标准 是参考 selection 的两档，36 大 是发送框第三档；
// 其它正数照收（和改造前的行为一致），因为 rowdm 是拿字号算轨道高度的，NaN 会让整屏弹幕叠在一起。
function normalizeFontSize(size) {
  const num = Number(size);
  return Number.isFinite(num) && num > 0 ? num : DM_FONT_NORMAL;
}

// uid：字符串直接用，数字转成字符串（QML 侧的 uid 很可能是 int），其它情况兜成 '1'。
// 统一成字符串是为了广播里的字段类型稳定 —— 一会儿 number 一会儿 string 会让 QML 的绑定很难写。
// （注意别用 Number(uid) 判断：Number('') 是 0、Number(null) 也是 0，会把空值悄悄变成 "0"。）
function normalizeUid(uid) {
  if (typeof uid === 'string' && uid.trim()) return uid.trim();
  if (typeof uid === 'number' && Number.isFinite(uid)) return String(uid);
  return '1';
}

/**
 * 「入库 + 广播」的唯一入口。
 *
 * 【为什么抽成一个函数】POST /danmaku/send 和 WS 的 {"type":"send"} 必须做一模一样的事：
 * 校验 → 分配自增 seq → 截断 → 写 dmHistory（供 /danmaku/since 补齐）→ 广播给 SSE → 广播给 WS。
 * 两条路各写一份的话，日后加字段/改校验必然漏掉一条，而漏的那条只有在用另一个客户端时才暴露。
 *
 * @param {object} input  至少含 text；可选 timeMs/timeSec/mode/fontSize/color/speed/uid
 * @param {string} source 日志里标明这条从哪来（'POST /danmaku/send' / 'WS ws-3'）
 * @returns {{record?: object, error?: string}}
 */
function acceptDanmaku(input, source) {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return { error: 'text 不能为空' };

  danmakuSeq += 1; // 先校验再自增：失败不能消耗序号，否则 seq 会出现空洞
  const record = {
    seq: danmakuSeq,
    id: `dm-${danmakuSeq}`, // 字符串 id：QML 侧拿去当 key 比纯数字方便，也和 WS 消息形状对齐
    // 截断而不是报错：和 B 站上限保持一致，也防止超长文本把前端弹幕 DOM 撑爆
    text: text.slice(0, DM_TEXT_LIMIT),
    timeMs: normalizeTimeMs(input),
    mode: normalizeMode(input.mode),            // 数字：SSE 那条旧链路原样沿用
    fontSize: normalizeFontSize(input.fontSize),
    color: normalizeColor(input.color),          // 十进制：同上
    speed: DM_SPEEDS.includes(input.speed) ? input.speed : 'moderate',
    // uid 收字符串也收数字：QML 侧的 uid 很可能是个 int，直接拼进 JSON 会变成 number，
    // 而广播里统一用字符串（参考实现的 Danmaku.uid 也是 number，但字符串更好做 key/比较）
    uid: normalizeUid(input.uid),
    ts: Date.now(),
  };

  appendDanmaku(record);
  broadcastDanmaku(record);      // SSE + 唤醒挂起中的长轮询
  broadcastWsDanmaku(record);    // WebSocket（和 SSE 是同一份数据、两条传输）
  log(`${source} 弹幕 seq=${record.seq} mode=${record.mode} speed=${record.speed} "${record.text}"`
    + ` → 广播给 ${sseClients.size} 个 SSE / ${wsClients.size} 个 WS 连接`);
  return { record };
}

/* ---------------------------------------------------------------------------
 * 10b. 手动往历史弹幕池（list.so 的数据源）添加一条
 * ------------------------------------------------------------------------- */

// 手动弹幕的 rowId 从 100001 起：随机弹幕占用 1..1000，错开以后在 XML / 验证输出里一眼能认出来
let manualRowIdSeq = 100000;

/**
 * 【和 acceptDanmaku 的分工】两条链路改的是两个数据面：
 *   - acceptDanmaku：实时链路（dmHistory + SSE/WS/长轮询广播），发出去的东西**不进 list.so**；
 *   - addHistoryDanmaku：历史池（historyDanmaku → /x/v1/dm/list.so），插完清掉 XML 缓存，
 *     播放器/自测页下一次拉 list.so 就能看到 —— 这就是「实时往测试接口添加弹幕」。
 * 校验/截断/归一化全部复用 acceptDanmaku 那套（normalizeTimeMs/normalizeMode/…），
 * 两个入口对字段的宽容度保持一致，不会出现「POST 发得出去、这里加不进去」的不对称。
 *
 * @param {object} input  至少含 text；可选 timeSec/timeMs/mode/fontSize/color/uid/speed
 * @returns {{record?: object, error?: string}}
 */
function addHistoryDanmaku(input) {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) return { error: 'text 不能为空' };

  manualRowIdSeq += 1;
  // 时间夹到 [0, 片长-0.1]：落在片尾之外的弹幕播放器永远不会显示，等于白加（和随机生成同一条约束）
  const timePoint = Math.min(
    Math.max(0, normalizeTimeMs(input) / 1000),
    Math.max(0, DURATION - 0.1),
  );
  const record = makeDanmaku(
    timePoint,
    text.slice(0, DM_TEXT_LIMIT),
    normalizeMode(input.mode),
    normalizeFontSize(input.fontSize),
    normalizeColor(input.color),
    normalizeUid(input.uid),
    manualRowIdSeq,
    DM_SPEEDS.includes(input.speed) ? input.speed : 'moderate',
  );

  // 直接 push 再整体排序：千条量级 sort 是微秒级，比手写二分插入省一个易错的边界分支
  historyDanmaku.push(record);
  historyDanmaku.sort((a, b) => a.timePoint - b.timePoint);
  danmakuXmlCache = null; // list.so 的 XML 是缓存一次的（见 danmakuXml），必须清掉才会带上新弹幕
  log(`手动添加历史弹幕 rowId=${record.rowId} @${record.timePoint.toFixed(1)}s "${record.text}"（list.so 现共 ${historyDanmaku.length} 条）`);
  return { record };
}

/* ---------------------------------------------------------------------------
 * 11. WebSocket 实时弹幕 /danmaku/ws（手写 RFC6455，零依赖）
 * ---------------------------------------------------------------------------
 * 【为什么已经有 SSE 了还要 WebSocket】
 *   SSE 是单向的（服务端→客户端），客户端想发弹幕得另开一次 POST；
 *   WebSocket 建完连接就是双向的，QML 侧一个 WebSocket 对象同时搞定「收」和「发」，
 *   也不用再操心 POST 的预检/CORS。代价是协议要自己实现，就是下面这些代码。
 *
 * 【为什么不用 npm 的 ws】
 *   本工程要求零 npm 依赖；Node 内置模块只有 WebSocket 客户端（且要 Node 22+），
 *   没有服务端实现。RFC6455 服务端真正需要的东西只有三件：
 *     1) 握手：sha1(key + GUID) → base64；
 *     2) 拆帧：客户端发来的帧**一定带掩码**，要按 4 字节掩码逐字节异或还原；
 *     3) 装帧：服务端发出的帧**一定不带掩码**（这点写反了客户端会直接断连）。
 * ------------------------------------------------------------------------- */

function wsAcceptKey(key) {
  // RFC6455 §4.2.2：Sec-WebSocket-Accept = base64(sha1(Sec-WebSocket-Key + GUID))
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function wsEncodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;                    // 7 位长度
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;                    // 126 = 后面 2 字节是长度
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;                    // 127 = 后面 8 字节是长度
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  header[0] = 0x80 | opcode;            // 0x80 = FIN=1（不分片，一次发完）
  return Buffer.concat([header, data]);
}

function wsSendFrame(client, opcode, payload) {
  if (client.socket.destroyed || client.socket.writableEnded) return;
  try {
    client.socket.write(wsEncodeFrame(opcode, payload));
  } catch (err) {
    // 对端刚断开时 write 可能抛 EPIPE/ERR_STREAM_DESTROYED。
    // 这里不重试也不上报：socket 的 'close' 事件会把这个 client 从 wsClients 里摘掉。
    warn(`WS ${client.id} 写帧失败（${String(err.message)}），等 close 事件回收`);
  }
}

// 一条消息一行 JSON：末尾补 \n，QML/Qt 侧想按行切分缓冲也能直接用
//（JSON.parse 对尾部空白是宽容的，所以不影响标准解析）。
function wsSendJson(client, obj) {
  wsSendFrame(client, WS_OPCODE.text, Buffer.from(`${JSON.stringify(obj)}\n`, 'utf8'));
}

// 十进制 RGB → '#RRGGBB'：参考实现里 Danmaku.color 就是这种 hex 字符串（selection 色板同款写法）
function toHexColor(decimal) {
  return `#${(decimal & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0')}`;
}

/**
 * 组装推给浏览器的弹幕消息。
 *
 * 【字段为什么这么定】对着参考实现的 Danmaku 类型（player/src/types/danmaku.ts:1-12）来：
 *   mode 用 'scroll' | 'top' | 'bottom'（不是 B 站 p 属性里的 1/4/5 数字），
 *   color 用 '#FFFFFF'（不是十进制），timeSec 是**秒**（对应 timePoint）——
 *   这样 QML 侧拿到 JSON 不用做任何换算就能直接喂给 rowdm。
 * timeMs / seq / ts 是给「和 SSE 对齐」「去重」「排序」用的附加字段，播放器可以忽略。
 */
function buildWsDanmakuMessage(record) {
  return {
    type: 'danmaku',
    id: record.id,
    seq: record.seq,
    text: record.text,
    timeSec: Number((record.timeMs / 1000).toFixed(2)), // 秒，2 位小数，和 list.so 的 p 第 1 段同精度
    timeMs: record.timeMs,                             // 毫秒，和 SSE/长轮询同源同值，方便两边对照
    mode: DM_MODE_TO_NAME[record.mode] || 'scroll',
    fontSize: record.fontSize,
    color: toHexColor(record.color),
    uid: record.uid,
    speed: record.speed,   // verySlow/slow/moderate/fast/veryFast，直接对应 rowdm 的 5 档
    // 【为什么恒为 true】这条通道只广播「客户端刚发来的弹幕」，历史弹幕走 list.so，
    // 所以对每个接收者来说它都是「别人/自己新发的」而不是回放。留着这个字段是为了
    // 让 QML 侧区分「实时弹幕」和将来可能推送的历史/系统消息，不用改消息结构。
    isSelf: true,
    ts: record.ts,
  };
}

function broadcastWsDanmaku(record) {
  if (wsClients.size === 0) return;
  const line = `${JSON.stringify(buildWsDanmakuMessage(record))}\n`;
  for (const client of wsClients) {
    wsSendFrame(client, WS_OPCODE.text, Buffer.from(line, 'utf8'));
  }
}

// 主动关连接：先发一个 close 帧（把状态码/原因告诉对端），再断开。
// 【为什么不直接 destroy】直接 destroy 会把还没冲出去的 close 帧一起丢掉，对端只看到
// 「连接被重置」，QML/浏览器会当成异常断开。所以走 end()（冲数据 + 发 FIN），
// 再从 wsClients 里摘掉、并留一个 1 秒的兜底 destroy 防止半开连接赖着不走。
function wsClose(client, code, reason) {
  const reasonBuf = Buffer.from(reason || '', 'utf8');
  // close 帧的 payload 是「2 字节状态码 + UTF-8 原因」，原因可以省略
  const payload = Buffer.alloc(2 + reasonBuf.length);
  payload.writeUInt16BE(code, 0);
  reasonBuf.copy(payload, 2);
  wsSendFrame(client, WS_OPCODE.close, payload);
  wsClients.delete(client); // 先摘掉：后续广播不再往这条连接写
  client.socket.end();
  setTimeout(() => {
    if (!client.socket.destroyed) client.socket.destroy();
  }, 1000).unref();
}

function wsDrop(client) {
  wsClients.delete(client);
  if (!client.socket.destroyed) client.socket.destroy();
}

/**
 * 拆帧：把 TCP 流里攒到的字节切成一个个完整的 WebSocket 帧。
 *
 * 【为什么必须自己缓冲】TCP 是字节流，一次 'data' 事件可能只给半个帧、也可能给两个半帧；
 * 帧头里的长度字段（7/16/64 位三档）本身也可能被拆开。所以：不够长就 return 等下一块，
 * 够长就消费掉、把剩余字节留在 buffer 里继续循环。
 */
function wsOnData(client, chunk) {
  client.buffer = client.buffer.length === 0 ? chunk : Buffer.concat([client.buffer, chunk]);

  for (;;) {
    const buf = client.buffer;
    if (buf.length < 2) return; // 连帧头都没收全

    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;  // 客户端→服务端的帧按 RFC 必须带掩码
    let len = buf[1] & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < offset + 2) return;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return;
      const big = buf.readBigUInt64BE(offset);
      offset += 8;
      if (big > BigInt(WS_MAX_PAYLOAD)) {
        warn(`WS ${client.id} 单帧 ${big} 字节，超过上限 ${WS_MAX_PAYLOAD}（关闭 1009）`);
        wsClose(client, 1009, 'message too big');
        return;
      }
      len = Number(big);
    }

    if (len > WS_MAX_PAYLOAD) {
      warn(`WS ${client.id} 单帧 ${len} 字节，超过上限 ${WS_MAX_PAYLOAD}（关闭 1009）`);
      wsClose(client, 1009, 'message too big');
      return;
    }

    let maskKey = null;
    if (masked) {
      if (buf.length < offset + 4) return;
      maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + len) return; // 半包：payload 还没到齐

    // 必须 copy 再解掩码：subarray 是共享内存的视图，就地异或会污染还在 buffer 里的原始字节
    const payload = Buffer.from(buf.subarray(offset, offset + len));
    if (maskKey) {
      // RFC6455 §5.3：第 i 个字节与 maskKey[i % 4] 异或
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4];
    }

    client.buffer = buf.subarray(offset + len); // 余下字节留给下一轮
    wsHandleFrame(client, fin, opcode, payload);
    // handleFrame 里可能已经把这个连接关掉了（协议错误/收到 close 帧）：再解析下去没意义，
    // writableEnded 是 wsClose 里 end() 之后的状态，destroyed 是 wsDrop 之后的状态，两个都要看
    if (client.socket.destroyed || client.socket.writableEnded) return;
  }
}

function wsHandleFrame(client, fin, opcode, payload) {
  // 收到任何一帧都算「这条连接还活着」：这样即使某个客户端不实现 pong
  //（非浏览器实现里很常见），只要它还在发消息就不会被心跳误杀。
  client.alive = true;

  switch (opcode) {
    case WS_OPCODE.text:
    case WS_OPCODE.binary: {
      if (opcode === WS_OPCODE.binary) {
        // 本服务的协议全是文本 JSON，二进制帧只可能是客户端用错了接口
        warn(`WS ${client.id} 发来二进制帧（本服务只处理文本 JSON，关闭 1003）`);
        wsClose(client, 1003, 'binary not supported');
        return;
      }
      if (!fin) {
        // 分片消息的第一片：先攒着，等 FIN=1 的续帧到了再拼（RFC6455 §5.4）
        client.fragments = [payload];
        return;
      }
      wsHandleMessage(client, payload);
      return;
    }
    case WS_OPCODE.cont: {
      if (client.fragments.length === 0) {
        // 没有起始帧的续帧属于协议错误；直接忽略而不是断连，容忍度更高也更好排查
        warn(`WS ${client.id} 收到没有起始帧的续帧（忽略）`);
        return;
      }
      client.fragments.push(payload);
      if (!fin) return;
      const full = Buffer.concat(client.fragments);
      client.fragments = [];
      wsHandleMessage(client, full);
      return;
    }
    case WS_OPCODE.ping:
      // 客户端 ping：RFC6455 §5.5.3 要求回一个 payload 完全相同的 pong
      wsSendFrame(client, WS_OPCODE.pong, payload);
      return;
    case WS_OPCODE.pong:
      return; // alive 已经在函数开头标过了
    case WS_OPCODE.close: {
      // 对端主动关闭：把状态码原样回一个 close 帧（RFC6455 §5.5.1）再断开。
      // 这里复用 wsClose，省得再抄一遍「摘集合 + end + 兜底 destroy」那三行。
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
      log(`WS ${client.id} 发来 close 帧（code=${code}），回一个 close 后断开`);
      wsClose(client, code, '');
      return;
    }
    default:
      warn(`WS ${client.id} 收到未知 opcode=0x${opcode.toString(16)}（关闭 1002）`);
      wsClose(client, 1002, 'protocol error');
  }
}

function wsHandleMessage(client, payload) {
  const text = payload.toString('utf8').trim();
  if (!text) return;

  let msg = null;
  try {
    msg = JSON.parse(text);
  } catch (err) {
    // 回一条 error 而不是直接断连：客户端拼错 JSON 时能看到原因，不用去翻服务端日志
    warn(`WS ${client.id} 发来的不是合法 JSON（${String(err.message)}）：${text.slice(0, 120)}`);
    wsSendJson(client, { type: 'error', message: `JSON 解析失败：${String(err.message)}` });
    return;
  }

  if (msg && msg.type === 'send') {
    // 和 POST /danmaku/send 走同一个入口：入库 + 广播（见 acceptDanmaku 的注释）
    const result = acceptDanmaku(Object.assign({}, msg, { uid: msg.uid || client.id }), `WS ${client.id}`);
    if (result.error) {
      wsSendJson(client, { type: 'error', message: result.error });
      return;
    }
    // 【为什么这里不再单独给发送者回一条】acceptDanmaku 里已经广播过了，
    // 而发送者自己也在 wsClients 里，所以它会和别的客户端一样收到那条 danmaku 消息 ——
    // 这也正好让「自己发的弹幕」在页面上走完全相同的渲染路径，能验证广播链路没漏人。
    return;
  }

  if (msg && msg.type === 'ping') {
    // 应用层心跳：JS 看不到协议层的 ping/pong 帧，页面/QML 想测往返延迟就用这条
    wsSendJson(client, { type: 'pong', t: Date.now() });
    return;
  }

  warn(`WS ${client.id} 发来未知 type=${JSON.stringify(msg && msg.type)}（只支持 send / ping）`);
  wsSendJson(client, { type: 'error', message: `未知 type=${JSON.stringify(msg && msg.type)}，只支持 send / ping` });
}

/**
 * 心跳：每 WS_HEARTBEAT_MS 给所有连接发一个协议层 ping 帧。
 *
 * 【为什么需要】NAT/防火墙常在 30~60 秒空闲后悄悄丢掉连接映射，而 TCP 层不会报错，
 * 客户端会一直「以为还连着」。定期 ping 能把连接钉活，也能顺手发现死连接。
 * 【为什么用 ping 帧而不是文本心跳】浏览器和 Qt 的 QWebSocket 都在协议层自动回 pong，
 * 不需要 JS/QML 参与；而且 ping 帧不会被 onmessage 当成业务消息，不会干扰播放器解析。
 * 【为什么收到任何帧都算活着】见 wsHandleFrame 开头：避免误杀没实现 pong 的客户端。
 */
function wsHeartbeatTick() {
  for (const client of wsClients) {
    if (!client.alive) {
      warn(`WS ${client.id} 上一轮 ping 没有回应（超过 ${WS_HEARTBEAT_MS}ms），判定为死连接并关闭`);
      wsClose(client, 1001, 'heartbeat timeout');
      continue;
    }
    client.alive = false;                              // 先假设它下一轮不会回，收到 pong/任何帧再置回 true
    wsSendFrame(client, WS_OPCODE.ping, Buffer.alloc(0));
  }
}

/**
 * HTTP Upgrade 入口。挂在 server.on('upgrade') 上，和普通 HTTP 路由互不干扰：
 * 带 Upgrade: websocket 头的请求不会进 handleRequest，普通请求也走不到这里。
 * pathname 同样先去掉末尾斜杠，所以 /danmaku/ws 和 /danmaku/ws/ 都能连上。
 */
function handleUpgrade(req, socket, head) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();

  if (pathname !== WS_PATH || upgrade !== 'websocket' || !key) {
    // 同一个 server 上还有一堆普通 HTTP 路由：别的路径收到 Upgrade 说明客户端把地址写错了。
    // 明确回 400 而不是静默断开，否则用户只会看到「连接意外关闭」，查不出是路径写错。
    warn(`WS 握手被拒：${req.method} ${pathname}（Upgrade=${upgrade || '-'}，key=${key ? '有' : '无'}）；只支持 ${WS_PATH}`);
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }

  // 【为什么这两行必须有】
  //   setTimeout(0)：http server 给这条连接挂过 requestTimeout（Node 默认 5 分钟，收完整请求用）。
  //     升级成 WebSocket 之后这条连接是长连接，那个超时不会自动取消，到点会把好好的连接掐掉 ——
  //     表现为「连上 5 分钟后莫名断开」，非常难查。清掉它，保活交给下面的 ping 心跳。
  //   setNoDelay(true)：关掉 Nagle，弹幕是「小包 + 低延迟」，攒包只会让它晚到几十毫秒。
  socket.setTimeout(0);
  socket.setNoDelay(true);

  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${wsAcceptKey(String(key))}`,
    '',
    '',
  ].join('\r\n'));

  wsClientSeq += 1;
  const client = {
    id: `ws-${wsClientSeq}`,
    socket,
    remote: `${socket.remoteAddress || '-'}:${socket.remotePort || '-'}`,
    buffer: Buffer.alloc(0), // 半包缓冲：一次 data 事件可能只有半个帧
    fragments: [],           // 分片消息（FIN=0 的帧）的累积
    alive: true,
  };
  wsClients.add(client);
  log(`WS 连接建立 ${client.id}（${client.remote}），当前连接数 ${wsClients.size}`);

  // 打招呼：把「怎么发弹幕」和当前弹幕总数直接告诉客户端，省得对着文档猜。
  // QML/测试页都能靠它确认「握手成功且服务端认识我」。
  wsSendJson(client, {
    type: 'hello',
    wsPath: WS_PATH,
    danmakuCount: historyDanmaku.length,
    durationSec: DURATION,
    heartbeatMs: WS_HEARTBEAT_MS,
    serverTime: Date.now(),
    sendExample: '{"type":"send","text":"你好","timeSec":12.3,"mode":"scroll","color":"#FFFFFF","fontSize":25,"speed":"moderate"}',
  });

  if (head && head.length) wsOnData(client, head); // 握手时可能已经捎带了第一帧

  socket.on('data', (chunk) => wsOnData(client, chunk));
  socket.on('error', (err) => {
    warn(`WS ${client.id} 连接出错：${String(err.message)}`);
    wsDrop(client);
  });
  // 必须监听 close 回收：用户关标签页/拔网线时不会再有 data 事件，不回收的话
  // wsClients 会越积越多，每次广播都在往死连接上写。
  socket.on('close', () => {
    // 主动 wsClose 过的连接已经从集合里摘掉了，delete 会返回 false，这里照样打一条日志，
    // 免得「服务端主动关」和「对端关」在日志里分不出来
    const wasTracked = wsClients.delete(client);
    log(`WS 连接关闭 ${client.id}${wasTracked ? '' : '（此前已被服务端摘除）'}，当前连接数 ${wsClients.size}`);
  });
}

/* ---------------------------------------------------------------------------
 * 12. 接口 7：进度条预览图 /videoshot/preview.bin
 * ------------------------------------------------------------------------- */

function statSafe(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function previewCacheKey() {
  // 缓存 key = 视频绝对路径 + 体积 + mtime + 抽帧参数，取 md5 当目录名。
  // 为什么不用文件名当目录名：不同目录下的同名视频会互相覆盖缓存，
  //   而且片名里带中文/空格/emoji 时当目录名很容易踩坑（Windows 上尤其）。
  // 为什么还要带上体积和 mtime：同一个路径下的文件被替换（剪辑后重导出）时，
  //   只有路径的哈希不会变，会把上一版视频的预览图喂给新视频。
  const stat = statSafe(opts.video);
  const raw = [
    path.resolve(opts.video || '(no-video)'),
    stat ? stat.size : 0,
    stat ? Math.round(stat.mtimeMs) : 0,
    FRAME_INTERVAL_SEC,
    FRAME_WIDTH,
    FRAME_HEIGHT,
    DURATION,
  ].join('|');
  return crypto.createHash('md5').update(raw).digest('hex');
}

function hasBinary(bin, args) {
  try {
    execFileSync(bin, args, { stdio: 'ignore', timeout: 10000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(
      FFMPEG_BIN,
      args,
      { maxBuffer: 8 * 1024 * 1024, timeout: 5 * 60 * 1000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const tail = String(stderr || '').trim().split('\n').slice(-3).join(' | ');
          reject(new Error(`ffmpeg 执行失败：${String(err.message).split('\n')[0]}${tail ? ` → ${tail}` : ''}`));
          return;
        }
        resolve();
      },
    );
  });
}

async function buildPreview() {
  if (!opts.video) {
    // 没给视频就没有帧可抽。返回空文件而不是报错：前端 getPreview() 会 split 出 ['']，
    // 结果只是不显示预览缩略图，播放本身完全不受影响。
    warn('未提供 --video，返回空的 preview.bin（进度条预览图不可用，其余功能正常）');
    return Buffer.alloc(0);
  }

  const cacheDir = path.join(CACHE_ROOT, previewCacheKey());
  const cacheFile = path.join(cacheDir, 'preview.bin');

  // 命中缓存就直接返回：抽帧是整个服务里唯一的重活，第二次启动应该毫秒级完成
  try {
    const cached = await fsp.readFile(cacheFile);
    if (cached.length > 0) {
      log(`preview.bin 命中缓存：${cacheFile}（${cached.length} 字节）`);
      return cached;
    }
  } catch {
    // 缓存不存在，继续往下抽帧
  }

  const framesDir = path.join(cacheDir, 'frames');
  await fsp.mkdir(framesDir, { recursive: true });

  // 先清掉上一次的残帧：视频变短后，旧的多余帧会和本次结果混在一起，导致预览图和时间轴错位
  for (const name of await fsp.readdir(framesDir)) {
    await fsp.rm(path.join(framesDir, name), { force: true, recursive: true });
  }

  // 每 5 秒 1 帧。用一次 ffmpeg 的 fps 滤镜批量抽，而不是循环 -ss 一帧一帧抽：
  // 循环调用要起几百个进程，10 分钟的视频就要几十秒，批量抽只要几秒。
  const frameCount = Math.max(1, Math.min(MAX_FRAMES, Math.ceil(DURATION / FRAME_INTERVAL_SEC)));
  await runFfmpeg([
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', opts.video,
    '-vf', `fps=1/${FRAME_INTERVAL_SEC},scale=${FRAME_WIDTH}:${FRAME_HEIGHT}`,
    '-frames:v', String(frameCount),
    '-an',
    '-q:v', '6', // jpeg 质量：6 左右体积和清晰度平衡，base64 后不会太夸张
    '-f', 'image2',
    path.join(framesDir, '%06d.jpg'),
  ]);

  // %06d 是零填充，字典序 == 数字序，所以直接 sort() 就能保证帧顺序
  const files = (await fsp.readdir(framesDir)).filter((name) => name.endsWith('.jpg')).sort();
  const buffers = await Promise.all(files.map((name) => fsp.readFile(path.join(framesDir, name))));

  // 【为什么下标 0 必须是空字符串占位】
  //   前端 front/player/src/component/controls/index.ts:1410-1417 取图用的是：
  //     const currTime = Math.floor(this.popup.currentTime / 5);
  //     this.previewImage.src = this.videoshot[currTime + 1];
  //   注意那个 +1 —— t=0s 时它取的是下标 1，而不是下标 0。
  //   所以整个数组必须往后错一位，用空串占住下标 0，让
  //     arr[0]      = ""            ← 占位，前端永远不会用到
  //     arr[k]      = 第 5*(k-1) 秒的帧（k >= 1）
  //   这样 floor(秒/5)+1 才正好命中那一秒所属的帧：
  //     t=0/4 → 下标 1，t=5 → 下标 2，t=12 → 下标 3
  //   不这么排的话，进度条上的预览图会整体错一格。
  const parts = [''];
  for (const buf of buffers) {
    parts.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
  }

  const text = parts.join(UNIT_SEP);
  const out = Buffer.from(text, 'utf8');

  // 雪碧图：用同一次抽帧得到的 jpg 拼一张 tile=NxM 的大图（不额外抽帧）。
  // 必须在删除 framesDir 之前做，否则要再抽一遍视频。
  const geo = spriteGeometry();
  const spriteFile = path.join(cacheDir, 'sprite.jpg');
  try {
    await runFfmpeg([
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', path.join(framesDir, '%06d.jpg'),
      '-vf', `tile=${geo.xLen}x${geo.yLen}`,
      '-frames:v', '1',
      '-q:v', '6',
      spriteFile,
    ]);
    const spriteStat = statSafe(spriteFile);
    if (spriteStat && spriteStat.size > 0) {
      spriteState.status = 'ready';
      spriteState.bytes = spriteStat.size;
      spriteState.file = spriteFile;
      spriteState.message = `已生成 ${geo.xLen}x${geo.yLen} 雪碧图（每格 ${geo.xSize}x${geo.ySize}，共 ${geo.xLen * geo.yLen} 格）`;
      log(`sprite.jpg 已生成：${spriteFile}（${spriteStat.size} 字节 / ${geo.xLen}x${geo.yLen}）`);
    } else {
      spriteState.status = 'unavailable';
      spriteState.message = '雪碧图生成后为空文件';
    }
  } catch (err) {
    spriteState.status = 'unavailable';
    spriteState.message = `雪碧图生成失败：${String(err.message)}`;
    warn(spriteState.message);
  }

  try {
    await fsp.writeFile(cacheFile, out);
    log(`preview.bin 已生成并写入缓存：${cacheFile}（${files.length} 帧 / ${out.length} 字节）`);
    // 缓存文件已经落盘，抽出来的 jpg 就没必要留着占空间了
    await fsp.rm(framesDir, { recursive: true, force: true });
  } catch (err) {
    warn(`写缓存失败（不影响本次响应）：${String(err.message)}`);
  }

  return out;
}

// 并发请求共享同一次抽帧：否则几个标签页同时打开进度条，会并行拉起好几个 ffmpeg。
// 失败时把 promise 清空，让下一次请求还能重试，而不是把这个错误永久缓存下来。
let previewInFlight = null;

function getPreviewBuffer() {
  if (!previewInFlight) {
    previewInFlight = buildPreview().catch((err) => {
      previewInFlight = null;
      throw err;
    });
  }
  return previewInFlight;
}

// 雪碧图取用：命中缓存直接返回；否则触发一次 buildPreview()（它内部会顺带产出 sprite.jpg）
async function getSpriteFile() {
  const cacheDir = path.join(CACHE_ROOT, previewCacheKey());
  const spriteFile = path.join(cacheDir, 'sprite.jpg');

  const cached = statSafe(spriteFile);
  if (cached && cached.size > 0) {
    spriteState.status = 'ready';
    spriteState.bytes = cached.size;
    spriteState.file = spriteFile;
    return spriteFile;
  }

  if (!opts.video) {
    spriteState.status = 'unavailable';
    spriteState.message = '未提供 --video：雪碧图不可用（其余接口正常）';
    return null;
  }

  try {
    await getPreviewBuffer();
  } catch (err) {
    spriteState.status = 'unavailable';
    spriteState.message = `雪碧图生成失败：${String(err.message)}`;
    return null;
  }

  const after = statSafe(spriteFile);
  if (after && after.size > 0) {
    spriteState.status = 'ready';
    spriteState.bytes = after.size;
    spriteState.file = spriteFile;
    return spriteFile;
  }

  if (spriteState.status !== 'ready') {
    spriteState.status = 'unavailable';
    spriteState.message = spriteState.message || '雪碧图不可用（ffmpeg 不可用或视频无法解码）';
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * 12b. 交互卡片（guide/link/vote/score 四类，页面可增删改）
 * ------------------------------------------------------------------------- */

/*
 * 【形状必须和播放器侧对齐】QtPlayer 的 InteractionLayer / hili-player 的交互插件读的都是：
 *   { guideList: [{type, top, left, timeStart, timeEnd}],
 *     linkList:  [{top, left, linkContent, timeStart, timeEnd}],
 *     voteList:  [{top, left, question, options: [{optionText, votes}], timeStart, timeEnd}],
 *     scoreList: [{top, left, title, scoreType, timeStart, timeEnd}],
 *     scoreSumList: [{top, left, title, timeStart, timeEnd}] }
 * top/left 是百分比（相对内容区）、timeStart/timeEnd 是秒。
 * 播放器只读自己认识的字段，所以元素里多带一个 id（编辑用）不影响消费方。
 */
const INTERACTION_KINDS = ['guide', 'link', 'vote', 'score', 'scoreSum'];

// 默认数据照 hili-player demo 页的 INITIAL_INTERACTION_DATA（demo/entry-client.ts）：
// 五类各一条。左下角缩小条目上线后一次只能存在一张卡片，时间窗互斥不重叠
// （2-10 / 12-20 / 22-30 / 32-40 / 42-52），拖动进度条能依次看到五张卡。
const interactionStore = {
  guide: [
    { id: 'card-g1', type: 1, top: 30, left: 50, timeStart: 2, timeEnd: 10 },
  ],
  link: [
    { id: 'card-l1', top: 55, left: 35, linkContent: 'Demo external video', timeStart: 12, timeEnd: 20 },
  ],
  vote: [
    {
      id: 'card-v1',
      top: 70,
      left: 60,
      question: 'Pick one',
      options: [
        { optionText: 'Option A', votes: 3 },
        { optionText: 'Option B', votes: 1 },
      ],
      timeStart: 22,
      timeEnd: 30,
    },
  ],
  score: [
    { id: 'card-s1', top: 45, left: 70, title: 'Rate it', scoreType: 1, timeStart: 32, timeEnd: 40 },
  ],
  scoreSum: [
    { id: 'card-ss1', top: 40, left: 60, title: '评分总结', timeStart: 42, timeEnd: 52 },
  ],
};

/**
 * 时间窗互斥校验：待写入窗口与任何已有卡片（五类全查，排除自身 id）重叠 → true。
 * 一次只能存在一张卡片（关闭后左下角缩小条目占用同一段时间轴），
 * 页面编辑与服务端落库双保险：重叠直接 400 拒绝。
 */
function interactionWouldOverlap(kind, card) {
  const kinds = INTERACTION_KINDS;
  for (const listKind of kinds) {
    const list = interactionStore[listKind];
    for (const existing of list) {
      // 修改自身（同 kind 同 id）不计入
      if (kind === listKind && card.id && existing.id === card.id) continue;
      if (existing.timeStart === undefined || existing.timeEnd === undefined) continue;
      // 半开区间相交：边界相接（前卡 timeEnd == 后卡 timeStart）不算重叠
      if (existing.timeStart < card.timeEnd && existing.timeEnd > card.timeStart) {
        return true;
      }
    }
  }
  return false;
}

// 手动新增卡片的 id 序号。从 100 起：内置默认卡占用 card-g1/l1/v1/s1 这几个号，
// 从 0 递增会分出 card-v1 这种和默认卡同号的 id（自测时踩过），findIndex 就会命中两张。
let interactionCardSeq = 100;

function clampPercent(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.min(100, Math.max(0, num)) : fallback;
}

function clampSec(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.min(num, DURATION) : fallback;
}

function pickEnum(value, allowed, fallback) {
  const num = Number(value);
  return allowed.includes(num) ? num : fallback;
}

function sanitizeText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : fallback;
}

/**
 * 白名单清洗一张卡片：只留播放器认识的字段 + 全部数值夹到合法域。
 * 【为什么要夹】页面输入框是自由文本：top=250%、timeEnd=-5 这类值不会被播放器拒收，
 * 但会渲染到屏幕外/永远不显示，表现成「加了卡片却看不见」—— 在服务端就掐掉。
 *
 * @param {string} kind  guide | link | vote | score
 * @param {object} input 页面提交的原始对象
 * @returns {{card?: object, error?: string}}
 */
function sanitizeInteractionCard(kind, input) {
  if (!INTERACTION_KINDS.includes(kind)) return { error: `kind 必须是 ${INTERACTION_KINDS.join(' / ')}` };
  if (input === null || typeof input !== 'object') return { error: 'card 必须是对象' };

  const card = {
    id: sanitizeText(input.id, ''),
    top: clampPercent(input.top, 50),
    left: clampPercent(input.left, 50),
    timeStart: clampSec(input.timeStart, 0),
    timeEnd: clampSec(input.timeEnd, 10),
  };
  if (card.timeEnd <= card.timeStart) card.timeEnd = card.timeStart + 5; // 空窗口 = 永不显示，兜住

  if (kind === 'guide') {
    card.type = pickEnum(input.type, [1, 2, 3], 1);
  } else if (kind === 'link') {
    card.linkContent = sanitizeText(input.linkContent, '这是一个什么视频');
  } else if (kind === 'vote') {
    card.question = sanitizeText(input.question, '投一票');
    // 选项：页面按「文案|票数」一行一个提交，这里转回对象数组；
    // 空数组兜成一条占位（VoteCard 对 0 选项的高度算式会得到一张只有标题的卡，看着像 bug）
    const rawOptions = Array.isArray(input.options) ? input.options : [];
    card.options = rawOptions
      .map((opt) => ({
        optionText: sanitizeText(opt && opt.optionText, '选项'),
        votes: Math.max(0, Math.round(Number(opt && opt.votes)) || 0),
      }))
      .slice(0, 8);
    if (card.options.length === 0) card.options = [{ optionText: '选项一', votes: 0 }];
  } else if (kind === 'score') {
    card.title = sanitizeText(input.title, '给个评分吧');
    card.scoreType = pickEnum(input.scoreType, [1, 2, 3], 1);
  } else if (kind === 'scoreSum') {
    // scoreSum：仅标题可编辑（题目列表 / 平均分 / 总人数由播放器运行期从 scoreList 聚合）
    card.title = sanitizeText(input.title, '评分总结');
  }

  return { card };
}

/** GET /x/player/interaction 的响应体（播放器形状：guideList/linkList/voteList/scoreList/scoreSumList） */
function interactionResponse() {
  return {
    guideList: interactionStore.guide,
    linkList: interactionStore.link,
    voteList: interactionStore.vote,
    scoreList: interactionStore.score,
    scoreSumList: interactionStore.scoreSum,
  };
}

/* ---------------------------------------------------------------------------
 * 13. 路由
 * ------------------------------------------------------------------------- */

// 自测页文件：和 server.js 同目录。放成常量是为了「路由 / 与 /test-page.html
// 都返回它」，以及文件被删掉时能给出确切路径。
const TEST_PAGE_FILE = path.join(__dirname, 'test-page.html');

/**
 * 【为什么要有一个 HTTP 路由把 test-page.html 发出去，而不是让用户双击打开它】
 *   file:// 打开的话页面是 file:// 源，页面里 fetch('/x/player/v2') 会去请求
 *   file:///x/player/v2（根本不存在的磁盘路径），报错还是 CORS 那种让人看不懂的形式；
 *   而且 EventSource 在 file:// 下基本不可用。
 *   挂到 / 上以后，页面和接口同源，所有请求用相对路径即可，跨域问题彻底消失。
 */
function sendTestPage(res) {
  fs.readFile(TEST_PAGE_FILE, 'utf8', (err, html) => {
    if (err) {
      // 页面是可选的辅助文件：删了它服务也该照常跑，所以 404 + 一行人话，不抛异常
      sendText(res, 404, `404：没有找到自测页文件\n${TEST_PAGE_FILE}\n（这个文件是可选的，删掉它不影响其它接口；也可以直接用 /x/player/v2 等接口自测。）\n`, 'text/plain; charset=utf-8');
      return;
    }
    sendText(res, 200, html, 'text/html; charset=utf-8');
  });
}

/* ---------------------------------------------------------------------------
 * 13b. AI 字幕（双模式演示数据）
 * ------------------------------------------------------------------------- */

// 服务端字幕轨（模式 B）：原文识别轨 + 翻译轨各一条，
// 客户端 RemoteSubtitleProvider.listTracks / activateTrack / fetch 消费。
const SUBTITLE_TRACKS = [
  { trackId: 'zh-ai', lang: 'zh', label: '中文（AI 生成）', kind: 'original' },
  { trackId: 'en-ai', lang: 'en', label: 'English (AI)', kind: 'translation', originalTrackId: 'zh-ai' },
];

// 原文句库（按分段序号轮换，保证同一次运行内内容稳定）
const SUBTITLE_SENTENCES_ZH = [
  '欢迎观看本期的演示视频',
  '今天我们来聊一聊播放器的架构设计',
  '首先是媒体层的解复用与解码流程',
  '接着是渲染合成的关键路径',
  '字幕系统支持本地识别与服务端下发两种模式',
  '本地模式通过 Web Audio 采集音频流',
  '再经过语音活动检测切分出有效片段',
  '最后交给识别引擎产出实时字幕',
  '服务端模式支持多轨道与增量拉取',
  '增量窗口按播放进度向前预取',
  '两种模式共享同一套渲染管线',
  '感谢观看，我们下期再见',
];

// 译文句库（zh-ai 原文轨附带的 translation 字段，演示双语拼装）
const SUBTITLE_SENTENCES_EN = [
  'Welcome to this demo video',
  'Today we will talk about player architecture',
  'First, the demux and decode pipeline of the media layer',
  'Then the critical path of render composition',
  'Subtitles support local ASR and remote tracks',
  'Local mode captures audio via Web Audio',
  'VAD splits the stream into segments',
  'The ASR engine produces live cues',
  'Remote mode supports multi-track and incremental fetch',
  'The window prefetches ahead of playback',
  'Both modes share one render pipeline',
  'Thanks for watching, see you next time',
];

/**
 * 构造某一轨道在 [from, to] 区间内的字幕 cue（模式 B 增量协议演示）
 * 每条 cue 覆盖 4.5 秒，内容按分段序号从句库轮换取值；
 * zh-ai 轨附带 translation 字段，供客户端双语拼装演示。
 */
function buildSubtitleCues(trackId, from, to) {
  const step = 4.5;
  const startSec = Math.max(0, Number(from) || 0);
  const endSec = Math.min(DURATION, Math.max(startSec, Number(to) || DURATION));
  const cues = [];
  const first = Math.floor(startSec / step);
  const last = Math.ceil(endSec / step);
  for (let i = first; i < last; i++) {
    const s = i * step;
    const e = Math.min(s + step - 0.2, DURATION);
    if (e <= startSec || s >= endSec) continue;
    const cue = {
      start: Math.round(s * 10) / 10,
      end: Math.round(e * 10) / 10,
      text: SUBTITLE_SENTENCES_ZH[i % SUBTITLE_SENTENCES_ZH.length],
      confidence: 0.92,
    };
    if (trackId === 'zh-ai') {
      cue.translation = SUBTITLE_SENTENCES_EN[i % SUBTITLE_SENTENCES_EN.length];
    }
    cues.push(cue);
  }
  return cues;
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const isGet = req.method === 'GET' || req.method === 'HEAD';

  // POST + application/json 属于「非简单请求」，浏览器会先发 OPTIONS 预检。
  // 不处理它，前端发弹幕会直接死在预检阶段（表现为 fetch 报 CORS 错误）。
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '86400', 'Content-Length': 0 });
    res.end();
    return;
  }

  // ---- 0. 自测页 ----------------------------------------------------------
  // 三个入口都指向同一个文件：/ 最好记，/test-page.html 是文件名，/index.html 是习惯。
  // 条件是「浏览器可见的地址」——用户在浏览器里打开 http://127.0.0.1:9101/ 就能用。
  if (isGet && (pathname === '/' || pathname === '/test-page.html' || pathname === '/index.html')) {
    log(`GET ${pathname} → 自测页`);
    sendTestPage(res);
    return;
  }

  // 存活探针：自测脚本用它等待服务就绪，也能一眼看到「预览图到底能不能用」。
  // 注意它不依赖任何业务状态，永远返回 200。
  if (isGet && pathname === '/healthz') {
    sendJson(res, 200, {
      code: 0,
      message: '0',
      data: {
        ok: true,
        durationSec: DURATION,
        durationSource: probed.source,
        video: opts.video || '',
        aid: opts.aid || '',
        cid: opts.cid || '',
        danmaku: dmHistory.length,           // 运行期收到的实时弹幕条数（原有字段，保持不变）
        danmakuCount: historyDanmaku.length, // 预生成的随机弹幕条数（list.so 会返回这么多条）
        danmakuBySpeed: countBySpeed(historyDanmaku), // 5 个速度档各抽到多少条，用来核对随机结果
        sseClients: sseClients.size,
        wsClients: wsClients.size,
        wsPath: WS_PATH,
        wsHeartbeatMs: WS_HEARTBEAT_MS,
        longPollWaiters: longPollWaiters.size,
        preview: previewState.status,
        previewFrames: previewState.frameCount,
        sprite: spriteState.status,
        spriteBytes: spriteState.bytes,
        hasFfmpeg: hasBinary(FFMPEG_BIN, ['-version']),
        hasFfprobe: hasBinary(FFPROBE_BIN, ['-version']),
      },
    });
    return;
  }

  // ---- 1. 进度条节点 ------------------------------------------------------
  if (pathname === '/x/player/v2' && isGet) {
    const { aid, cid } = pickIds(url);
    const viewPoints = buildViewPoints(DURATION);
    log(`GET /x/player/v2 aid=${aid || '-'} cid=${cid || '-'} → ${viewPoints.length} 个节点`);
    sendJson(res, 200, { code: 0, message: '0', data: { view_points: viewPoints } });
    return;
  }

  // ---- 2. 高能进度条 ------------------------------------------------------
  if (pathname === '/x/player/pbp' && isGet) {
    const { aid, cid } = pickIds(url);
    const data = buildPbpData(DURATION);
    log(`GET /x/player/pbp aid=${aid || '-'} cid=${cid || '-'} → ${data.length} 个采样点`);
    sendJson(res, 200, {
      code: 0,
      message: '0',
      data: {
        step_sec: PBP_STEP_SEC,
        data,
        // 下面三个字段是给客户端的换算依据（B 站原始响应只有 step_sec + data）：
        // 采样点个数、总时长、以及「每点一个且首点对应 0 秒」的口径说明。
        count: data.length,
        duration: Math.round(DURATION),
        valueRange: [0, 1],
      },
    });
    return;
  }

  // ---- 3. 弹幕列表 XML ----------------------------------------------------
  // 返回启动时生成的那 1000 条随机弹幕（不是每次现算，所以内容在本次运行内稳定）。
  // /v1/dm/list.so 是简写别名：真实 B 站是 /x/v1/dm/list.so，两种写法都有人用，都认。
  if ((pathname === '/x/v1/dm/list.so' || pathname === '/v1/dm/list.so') && isGet) {
    const oid = url.searchParams.get('oid') || '';
    const xml = danmakuXml();
    log(`GET ${pathname} oid=${oid || '-'} → ${historyDanmaku.length} 条弹幕 / ${Buffer.byteLength(xml)} 字节 XML`);
    sendText(res, 200, xml, 'text/xml; charset=utf-8');
    return;
  }

  // ---- 4. 发送弹幕 -------------------------------------------------------
  if (pathname === '/danmaku/send') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { code: -405, message: '请用 POST 提交弹幕' });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { code: -400, message: String(err.message) });
      return;
    }

    const result = acceptDanmaku(body, 'POST /danmaku/send');
    if (result.error) {
      sendJson(res, 400, { code: -400, message: result.error });
      return;
    }
    // 响应体保持原样（code + data.seq），只多给一个 id：
    // 老客户端只读 seq，不受影响；新客户端（QML）可以拿 id 去和 WS 广播里的 id 对上，确认是自己发的。
    sendJson(res, 200, { code: 0, data: { seq: result.record.seq, id: result.record.id } });
    return;
  }

  // ---- 4c. 手动往历史弹幕池（list.so 数据源）添加一条 ----------------------
  // 和 /danmaku/send 的区别见 addHistoryDanmaku 的注释：
  // 这条改的是 list.so 那个数据面（不广播），播放器重拉 /x/v1/dm/list.so 立刻可见。
  if (pathname === '/danmaku/history') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { code: -405, message: '请用 POST 提交弹幕' });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { code: -400, message: String(err.message) });
      return;
    }

    const result = addHistoryDanmaku(body);
    if (result.error) {
      sendJson(res, 400, { code: -400, message: result.error });
      return;
    }
    sendJson(res, 200, {
      code: 0,
      data: {
        rowId: result.record.rowId,
        timePoint: result.record.timePoint,
        count: historyDanmaku.length, // /healthz 的 danmakuCount 用的同一个数组，天然同步
      },
    });
    return;
  }

  // ---- 4b. WebSocket 地址被当成普通 HTTP 访问 ---------------------------
  // 走到这里说明请求没带 Upgrade 头（带了的会被 server.on('upgrade') 接走）。
  // 最常见的两种错法：用浏览器直接打开 ws:// 地址，或者客户端把 ws:// 写成了 http://。
  // 明确回 426 + 一行提示，比回 404 让人少查半小时。
  if (pathname === WS_PATH) {
    sendJson(res, 426, {
      code: -426,
      message: `这是 WebSocket 端点，请用 ws://${req.headers.host || '127.0.0.1:9101'}${WS_PATH} 连接（不是 http://）`,
    });
    return;
  }

  // ---- 5. SSE 实时弹幕流 --------------------------------------------------
  if (pathname === '/danmaku/stream' && isGet) {
    // 【为什么已经有 WebSocket 了还留着 SSE】
    //   1. 浏览器原生 EventSource 就能用，播放器网页端/测试页接起来比手写 WS 客户端省事；
    //   2. 断线后浏览器会按 retry 字段自动重连，不用自己写重连状态机；
    //   3. 走普通 HTTP GET，天然复用上面那套 CORS 头，也不会被当成特殊协议拦掉。
    //   代价是只有服务端→客户端单向：发弹幕要么走 POST /danmaku/send，
    //   要么改用双向的 WebSocket（/danmaku/ws，见第 11 节）——两条路最终都进同一个
    //   acceptDanmaku()，所以 SSE 和 WS 收到的是同一批弹幕。
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform：禁止中间层压缩/缓冲，否则弹幕会被攒成一批才吐出来，「实时」就没了
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // 万一前面挂了 nginx，这行让它别缓冲
    });

    // 告诉浏览器断线后 1 秒重连（EventSource 收到 retry 字段就会照做）
    res.write('retry: 1000\n\n');

    const client = { res };
    sseClients.add(client);
    log(`SSE 连接建立，当前连接数 ${sseClients.size}`);

    // 心跳：以 ':' 开头的行是 SSE 注释，浏览器会忽略内容，但能防止代理/防火墙
    // 把长时间没数据的连接判成空闲然后悄悄掐断（TCP 层不会报错，前端会一直以为还连着）
    const heartbeat = setInterval(() => {
      if (res.writableEnded) return;
      res.write(': ping\n\n');
    }, HEARTBEAT_MS);
    heartbeat.unref?.(); // 心跳定时器不阻止进程退出

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      sseClients.delete(client);
      log(`SSE 连接关闭，当前连接数 ${sseClients.size}`);
    };

    // 必须监听 close：用户关标签页/刷新时不会触发任何「消息」，只有 close 事件。
    // 不在这里回收的话，sseClients 会越积越多，最后每次广播都在往死连接上写。
    req.on('close', cleanup);
    res.on('close', cleanup); // 兜底：响应流先结束时也要回收，防止连接对象泄漏
    return; // 注意：这里不能 end()，连接要保持打开
  }

  // ---- 6. 长轮询兜底 ------------------------------------------------------
  if (pathname === '/danmaku/since' && isGet) {
    const rawSeq = url.searchParams.get('seq');
    const parsedSeq = Number.parseInt(rawSeq ?? '0', 10);
    const sinceSeq = Number.isFinite(parsedSeq) ? parsedSeq : 0;

    const fresh = itemsSince(sinceSeq);
    if (fresh.length > 0) {
      log(`GET /danmaku/since seq=${sinceSeq} → 立即返回 ${fresh.length} 条`);
      sendJson(res, 200, { code: 0, data: fresh });
      return;
    }

    // 没有新弹幕就挂起，最多等 LONG_POLL_MS。
    // 之所以要挂起而不是立刻返回空数组：立刻返回会让前端变成高频空转轮询
    // （每秒好几次请求），挂起能把「没数据」这段时间的请求数压到 1 次。
    // 25 秒也小于常见网关的 30/60 秒超时，避免被中间层先掐掉。
    const waiter = { res, seq: sinceSeq, timer: null };
    waiter.timer = setTimeout(() => {
      longPollWaiters.delete(waiter);
      sendJson(res, 200, { code: 0, data: [] }); // 超时给空数组，前端据此再发下一次请求
      log(`GET /danmaku/since seq=${sinceSeq} → 等待 ${LONG_POLL_MS}ms 超时，返回空数组`);
    }, LONG_POLL_MS);

    longPollWaiters.add(waiter);
    log(`GET /danmaku/since seq=${sinceSeq} → 挂起等待新弹幕（当前 ${longPollWaiters.size} 个等待中）`);

    req.on('close', () => {
      clearTimeout(waiter.timer);
      if (longPollWaiters.delete(waiter)) {
        log(`GET /danmaku/since seq=${sinceSeq} → 客户端提前断开，取消等待`);
      }
    });
    return;
  }

  // ---- 7. 预览图 ----------------------------------------------------------
  if (pathname === PREVIEW_PATH && isGet) {
    try {
      const buf = await getPreviewBuffer();
      // 记下本次结果，供 /videoshot/index.json 和自测页显示状态
      // （空 buffer = 没视频或抽帧失败，这时页面上要明确写出来，而不是给一片空白）
      previewState.status = buf.length > 0 ? 'ready' : 'unavailable';
      previewState.frameCount = buf.length > 0 ? buf.toString('utf8').split(UNIT_SEP).length - 1 : 0;
      previewState.message = buf.length > 0
        ? `已生成 ${previewState.frameCount} 帧（每 ${FRAME_INTERVAL_SEC} 秒 1 帧）`
        : (opts.video
          ? `抽帧失败：${previewState.reason || 'ffmpeg 不可用或视频无法解码'}`
          : '未提供 --video：preview.bin 为空文件，进度条预览图不可用（其余接口正常）');
      log(`GET /videoshot/preview.bin → ${buf.length} 字节`);
      // 内容是图片 data URL，但整体按 UTF-8 文本传输，和前端 TextDecoder('utf-8') 对应
      sendText(res, 200, buf, 'text/plain; charset=utf-8');
    } catch (err) {
      // ffmpeg 不存在 / 抽帧失败：打一条警告，然后返回空文件。
      // 不能返回 500，因为前端 getPreview() 是直接 throw 的，会把进度条交互整个打断。
      previewState.status = 'unavailable';
      previewState.frameCount = 0;
      previewState.reason = String(err.message);
      previewState.message = `抽帧失败，preview.bin 返回空文件：${String(err.message)}`;
      warn(`生成 preview.bin 失败，返回空文件：${String(err.message)}`);
      sendText(res, 200, Buffer.alloc(0), 'text/plain; charset=utf-8');
    }
    return;
  }

  // ---- 7b. 雪碧图（sprite）------------------------------------------------
  // 与 preview.bin（逐帧 data URL 列表）并列的第二种预览数据源：一张真实的图片。
  if (pathname === SPRITE_PATH && isGet) {
    const file = await getSpriteFile();
    if (!file) {
      sendJson(res, 404, {
        code: -404,
        message: spriteState.message || '雪碧图不可用',
      });
      return;
    }
    try {
      const buf = await fsp.readFile(file);
      log(`GET ${SPRITE_PATH} → ${buf.length} 字节`);
      sendBinary(res, 200, buf, 'image/jpeg');
    } catch (err) {
      spriteState.status = 'unavailable';
      spriteState.message = `读取雪碧图失败：${String(err.message)}`;
      sendJson(res, 500, { code: -500, message: spriteState.message });
    }
    return;
  }

  // ---- 8. 预览图元信息（B 站 x/player/videoshot 形状，mock 自用）----------
  // 同时报出两种数据源：pvdata/image/index 走雪碧图（B 站形状），
  // frames 走 preview.bin（逐帧 data URL），客户端按能力任选。
  if (pathname === '/videoshot/index.json' && isGet) {
    const frameCount = previewState.frameCount || previewFrameCount();
    const geo = spriteGeometry();
    // 雪碧图只有真的生成成功才对外声明：否则客户端会按 pvdata.img_url 去加载
    // 一个 404 的图片，预览区整块空白（逐帧 preview.bin 反而是可用的）
    const spriteReady = spriteState.status === 'ready';
    sendJson(res, 200, {
      code: 0,
      message: '0',
      data: {
        pvdata: {
          duration: Math.round(DURATION),
          img_x_len: geo.xLen,
          img_y_len: geo.yLen,
          img_x_size: geo.xSize,
          img_y_size: geo.ySize,
          img_url: spriteReady ? SPRITE_PATH : PREVIEW_PATH,
        },
        image: [spriteReady ? SPRITE_PATH : PREVIEW_PATH],
        index: Array.from({ length: frameCount }, (_, k) => k * FRAME_INTERVAL_SEC),
        frames: {
          url: PREVIEW_PATH,
          stepSec: FRAME_INTERVAL_SEC,
          count: frameCount,
        },
        sprite: {
          url: SPRITE_PATH,
          status: spriteState.status,
          bytes: spriteState.bytes,
          xLen: geo.xLen,
          yLen: geo.yLen,
          xSize: geo.xSize,
          ySize: geo.ySize,
        },
        mock: {
          status: previewState.status,
          message: previewState.message || `尚未请求过 ${PREVIEW_PATH}`,
          stepSec: FRAME_INTERVAL_SEC,
          frameCount,
          spriteStatus: spriteState.status,
          spriteMessage: spriteState.message || `尚未请求过 ${SPRITE_PATH}`,
          img_urlNote: `pvdata.img_url 与 image[0] 指向雪碧图 ${SPRITE_PATH}（可直接当图片加载，`
            + `按 img_x_len/img_y_len/img_x_size/img_y_size 裁切）；`
            + `逐帧 data URL 列表在 ${PREVIEW_PATH}`,
          indexOf: `雪碧图切片下标 = Math.floor(秒 / ${FRAME_INTERVAL_SEC})，`
            + `列 = 下标 % ${geo.xLen}，行 = Math.floor(下标 / ${geo.xLen})；`
            + `${PREVIEW_PATH} 按 \\u001F 切分后取 arr[Math.floor(秒 / ${FRAME_INTERVAL_SEC}) + 1]（arr[0] 是空占位）`,
        },
      },
    });
    return;
  }

  // ---- 8b. 交互卡片（播放器拉取 + 页面增删改）------------------------------
  // GET /x/player/interaction：播放器形状（guideList/linkList/voteList/scoreList/scoreSumList）。
  // QtPlayer 的 Main.qml fetchProgressMetaFrom() 和 hili-player demo 都按这个约定拉。
  if (pathname === '/x/player/interaction' && isGet) {
    const { aid, cid } = pickIds(url);
    const data = interactionResponse();
    const total = data.guideList.length + data.linkList.length
      + data.voteList.length + data.scoreList.length + data.scoreSumList.length;
    log(`GET /x/player/interaction aid=${aid || '-'} cid=${cid || '-'} → ${total} 张卡片`);
    sendJson(res, 200, { code: 0, message: '0', data });
    return;
  }

  // GET /api/interaction/list：编辑 UI 用（和 /x/player/interaction 同一份数据，
  // 但按 kind 分组返回，页面渲染列表少做一次反转）
  if (pathname === '/api/interaction/list' && isGet) {
    sendJson(res, 200, { code: 0, message: '0', data: interactionStore });
    return;
  }

  // POST /api/interaction/upsert：{ kind, card }。card.id 非空且存在 → 改；否则 → 增。
  if (pathname === '/api/interaction/upsert') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { code: -405, message: '请用 POST 提交卡片' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { code: -400, message: String(err.message) });
      return;
    }

    const { card, error } = sanitizeInteractionCard(String(body.kind || ''), body.card);
    if (error) {
      sendJson(res, 400, { code: -400, message: error });
      return;
    }

    // 评分总结卡片前置条件：scoreList 至少已有一张评分卡（无可汇总的题目）
    if (body.kind === 'scoreSum' && interactionStore.score.length === 0) {
      sendJson(res, 400, { code: -400, message: '评分总结卡片需要先添加至少一张评分卡片' });
      return;
    }

    // 时间窗互斥校验：与任何已有卡片重叠 → 拒绝落库（一次只能存在一张卡片）
    if (interactionWouldOverlap(String(body.kind || ''), card)) {
      sendJson(res, 400, {
        code: -400,
        message: `时间窗 ${card.timeStart}s-${card.timeEnd}s 与其他卡片重叠，一次只能存在一张交互卡片`,
      });
      return;
    }

    const list = interactionStore[String(body.kind)];
    const at = card.id ? list.findIndex((c) => c.id === card.id) : -1;
    if (at >= 0) {
      list[at] = card; // 修改：原位替换（保持顺序，播放器里叠放次序不变）
      log(`交互卡片已修改 ${body.kind}/${card.id}`);
    } else {
      interactionCardSeq += 1;
      card.id = `card-${body.kind[0]}${interactionCardSeq}`; // 新增：服务端分配 id，页面不用自己造
      list.push(card);
      log(`交互卡片已新增 ${body.kind}/${card.id}`);
    }
    sendJson(res, 200, { code: 0, data: { card } });
    return;
  }

  // POST /api/interaction/delete：{ kind, id }
  if (pathname === '/api/interaction/delete') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { code: -405, message: '请用 POST 提交' });
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, 400, { code: -400, message: String(err.message) });
      return;
    }

    const kind = String(body.kind || '');
    if (!INTERACTION_KINDS.includes(kind)) {
      sendJson(res, 400, { code: -400, message: `kind 必须是 ${INTERACTION_KINDS.join(' / ')}` });
      return;
    }
    const list = interactionStore[kind];
    const at = list.findIndex((c) => c.id === String(body.id || ''));
    if (at < 0) {
      sendJson(res, 404, { code: -404, message: `没有 ${kind}/${body.id} 这张卡片` });
      return;
    }
    const [removed] = list.splice(at, 1);
    log(`交互卡片已删除 ${kind}/${removed.id}`);
    sendJson(res, 200, { code: 0, data: { id: removed.id } });
    return;
  }

  // ---- 9. AI 字幕（双模式演示：轨道列表 + 增量 cue 拉取）-------------------
  // /api/subtitle/tracks → 服务端轨道列表（模式 B 多轨协议）
  if (pathname === '/api/subtitle/tracks' && isGet) {
    log(`GET /api/subtitle/tracks → ${SUBTITLE_TRACKS.length} 条轨道`);
    sendJson(res, 200, { code: 0, message: '0', data: { tracks: SUBTITLE_TRACKS } });
    return;
  }

  // /api/subtitle/cues?track=zh-ai&from=0&to=60 → 该区间内的 cue（增量协议）
  if (pathname === '/api/subtitle/cues' && isGet) {
    const trackId = url.searchParams.get('track') || 'zh-ai';
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const cues = buildSubtitleCues(trackId, from, to);
    log(`GET /api/subtitle/cues track=${trackId} from=${from ?? '-'} to=${to ?? '-'} → ${cues.length} 条`);
    sendJson(res, 200, { code: 0, message: '0', data: { subtitles: cues } });
    return;
  }

  // ---- 其他 ---------------------------------------------------------------
  sendJson(res, 404, { code: -404, message: `mock-server 未实现 ${req.method} ${pathname}` });
}

/* ---------------------------------------------------------------------------
 * 14. 启动
 * ------------------------------------------------------------------------- */

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[mock error] 处理请求时异常：', err);
    if (!res.headersSent) {
      sendJson(res, 500, { code: -500, message: String(err && err.message ? err.message : err) });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
});

// WebSocket 的 Upgrade 请求不会进 handleRequest（那是普通 HTTP 请求的处理函数），
// 必须单独挂这条监听；不挂的话 Node 会直接把这个 socket 关掉，客户端只看到「连接被重置」。
server.on('upgrade', (req, socket, head) => {
  try {
    handleUpgrade(req, socket, head);
  } catch (err) {
    warn(`处理 WS 握手时异常：${String(err && err.message ? err.message : err)}`);
    socket.destroy();
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[mock] 端口 ${opts.port} 已被占用：换一个 --port，或先关掉占用该端口的进程`);
  } else {
    console.error('[mock] 服务启动失败：', err);
  }
  process.exit(1);
});

server.listen(opts.port, opts.host, () => {
  console.log('');
  console.log('  hilihili 播放器测试服务（mock-server）');
  console.log(`  地址：http://${opts.host}:${server.address().port}`);
  console.log(`  时长：${DURATION}s（来源：${probed.source}）`);
  console.log(`  视频：${opts.video || '(未提供，preview.bin 将为空文件)'}`);
  console.log(`  弹幕：${historyDanmaku.length} 条随机弹幕（/x/v1/dm/list.so）`);
  console.log(`  WS  ：ws://${opts.host}:${server.address().port}${WS_PATH}（心跳 ${WS_HEARTBEAT_MS}ms）`);
  console.log(`  缓存：${CACHE_ROOT}`);
  console.log('  接口：');
  console.log('    GET  /x/player/v2?aid=&cid=');
  console.log('    GET  /x/player/pbp?aid=&cid=');
  console.log('    GET  /x/v1/dm/list.so?oid=    （别名 /v1/dm/list.so）');
  console.log('    POST /danmaku/send');
  console.log('    GET  /danmaku/stream');
  console.log(`    WS   ${WS_PATH}`);
  console.log('    GET  /danmaku/since?seq=N');
  console.log('    GET  /videoshot/preview.bin');
  console.log('    GET  /videoshot/sprite.jpg    雪碧图（tile=NxM，可当普通图片加载）');
  console.log('');

  // 心跳定时器全局只有这一个：它遍历 wsClients，没人连接时就是空转一圈，代价可以忽略。
  // unref() 让定时器不阻止进程退出（Ctrl+C 时不用专门去 clearInterval）。
  setInterval(wsHeartbeatTick, WS_HEARTBEAT_MS).unref();

  // 提前探一次 ffmpeg，让「没有 ffmpeg」这件事在第一屏就暴露，
  // 而不是等前端去点进度条才发现预览图是空的
  if (opts.video && !hasBinary(FFMPEG_BIN, ['-version'])) {
    warn(`找不到 ffmpeg（${FFMPEG_BIN}），/videoshot/preview.bin 会返回空文件；可用环境变量 FFMPEG_PATH 指定路径`);
  }
});

// Ctrl+C 时先收尾长连接再退出：SSE、WebSocket 和挂起中的长轮询会一直拖住 server.close()
process.on('SIGINT', () => {
  log('收到 SIGINT，关闭服务');
  for (const client of sseClients) {
    try {
      client.res.end();
    } catch {
      // 连接可能已经断了，忽略
    }
  }
  sseClients.clear();
  for (const client of wsClients) {
    try {
      // 发个 close 帧告诉对端「是服务端主动关的」，QML/浏览器就不会当成异常断开去疯狂重连
      wsClose(client, 1001, 'server shutdown');
    } catch {
      // 同上，连接可能已经断了
    }
  }
  wsClients.clear();
  for (const waiter of longPollWaiters) {
    clearTimeout(waiter.timer);
    sendJson(waiter.res, 200, { code: 0, data: [] });
  }
  longPollWaiters.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref(); // 兜底强退
});
