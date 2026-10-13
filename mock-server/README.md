# mock-server —— 播放器本地测试服务（纯 Node.js，零第三方依赖）

给 `front/player` 用的**假接口服务端**：把 B 站那套接口的形状在本地复刻一遍，
让播放器在离线、没有真实 aid/cid 的情况下也能把「进度条节点、高能进度条、弹幕、进度条预览图」四条链路跑通。

- 零依赖：只用 `node:http` / `node:fs` / `node:fs/promises` / `node:path` / `node:crypto` / `node:child_process` / `node:url`
- 不动 `front/player` 里的任何已有文件，本目录是纯新增
- 全部接口带 `Access-Control-Allow-Origin: *`，播放器跑在 vite（5180）也能直接跨域请求
- **弹幕**：启动时生成 **1000 条随机弹幕**（覆盖整片时长，颜色/模式/字号/速度档都随机），
  历史走 `GET /x/v1/dm/list.so`（B 站 XML），实时走 **SSE** 和 **WebSocket** 两条推送（同一批数据）
- **WebSocket 是手写的 RFC6455**（不引 `ws` 之类的 npm 包）：`ws://127.0.0.1:9101/danmaku/ws`，
  双向 —— 既能收广播，也能直接发弹幕；消息格式见下面「二、接口文档」的 **4d** 小节
- 只用 ESM（`import`）：`front/player/package.json` 里是 `"type": "module"`，
  本目录没有自己的 `package.json`，所以 `server.js` / `self-test.js` 会被 Node 当成 ES Module 执行，
  写成 `require(...)` 会直接抛 `require is not defined in ES module scope`

```
front/player/mock-server/
├── server.js        主程序（接口实现 + 1000 条随机弹幕 + WebSocket + 缩略图抽帧）
├── self-test.js     自测脚本：自动起服务 → 把每类接口各打一遍（含手写 WS 客户端）→ 打印实测记录
├── test-page.html   自测页：接口一览、发弹幕、SSE 流、WS 流（可发可收）、缩略图网格、pbp 曲线
├── README.md        本文件
└── .cache/          缩略图缓存（首次跑完自动生成，可安全删除）
```

---

## 〇、最快开始

```bash
cd front/player/mock-server
node server.js --port 9101 --video "D:\你的片子.mp4"
```

然后**用浏览器打开 <http://127.0.0.1:9101/>** —— 这就是自测页，页面上有「怎么用」说明，
以及每一块接口的请求 URL 和返回片段。

> ⚠️ 两件事必须注意：
> 1. **不要双击打开 `test-page.html`**（那样是 `file://` 源，页面里的请求会变成 `file:///x/player/v2` 这种不存在的磁盘路径，
>    而且 `EventSource` 在 `file://` 下不可用）。必须通过 `http://127.0.0.1:9101/` 访问。
> 2. 不给 `--video` 也能起：只是 `preview.bin` 是空文件、片长按 600 秒算，其余接口全部正常。

**QML/客户端只要两个地址**（起完服务就能连）：

```
历史弹幕：http://127.0.0.1:9101/x/v1/dm/list.so?oid=456      → 1000 条 XML
实时弹幕：ws://127.0.0.1:9101/danmaku/ws                     → 收 {"type":"danmaku",…}，发 {"type":"send",…}
```

**播放器侧对应关系**（本服务不改动播放器任何文件，所以需要你确认地址对得上）：

| 播放器侧 | 本服务 |
| --- | --- |
| `Main.qml` 的 `dataBaseUrl` 默认 `http://127.0.0.1:9101` | 服务默认端口就是 **9101**（`DEFAULT_PORT`），开箱即用，不用改 |
| 片源开始播放时拉一次 `/x/player/v2` | `GET /x/player/v2?aid=&cid=` → `view_points`（from/to 单位**秒**） |
| 片源开始播放时拉一次 `/x/player/pbp` | `GET /x/player/pbp?aid=&cid=` → `step_sec` + 0~1 曲线 |
| 进度条悬浮取预览图 | `GET /videoshot/preview.bin` → `\u001F` 分隔，`arr[floor(秒/5)+1]` |
| 加载历史弹幕 | `GET /x/v1/dm/list.so?oid=` → 1000 条随机弹幕（B 站 XML，`p` 8 段） |
| 实时弹幕（推荐，双向） | `ws://127.0.0.1:9101/danmaku/ws` → 收 `{"type":"danmaku",…}`，发 `{"type":"send",…}` |
| 实时弹幕（网页端） | `GET /danmaku/stream`（SSE）+ `POST /danmaku/send` |

> 前端 `front/player/src/api/preview.ts` 里的预览图地址目前写死成线上地址，
> 联调时把它换成 `http://127.0.0.1:9101/videoshot/preview.bin`（或用 vite 的 `server.proxy` 转发）。

---

## 一、启动参数

```bash
node server.js                          # 默认监听 127.0.0.1:9101，片长 600s
node server.js --port 9101 --video "D:\some\video.mp4"
node server.js --host 0.0.0.0           # 局域网/手机调试（会弹 Windows 防火墙授权框）
node server.js --ws-ping 1              # WS 心跳改成 1 秒（自测/调试用，默认 30 秒）
node server.js --help
```

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--port <端口>` | `9101` | 监听端口；`0` = 让系统分配空闲端口（自测脚本用的就是这个） |
| `--host <地址>` | `127.0.0.1` | 默认只监听本机，避免 Windows 首次启动弹防火墙授权框 |
| `--video <文件>` | 空 | 本地视频：ffprobe 取真实时长 + ffmpeg 抽预览帧 |
| `--aid <id>` | 空 | 默认 aid（请求带 aid 时以请求为准） |
| `--cid <id>` | 空 | 默认 cid（请求带 cid 时以请求为准） |
| `--duration <秒>` | `600` | 拿不到片长时的兜底时长（也决定 1000 条弹幕铺在 0~多少秒上） |
| `--ws-ping <秒>` | `30` | WebSocket 心跳间隔。做成参数是因为自测要验证「心跳确实在发」，真等 30 秒太慢 |
| `-h, --help` | — | 打印帮助 |

环境变量：`FFPROBE_PATH` / `FFMPEG_PATH` —— ffprobe / ffmpeg 可执行文件路径（绿色解压版没进 PATH 时用）。

### 自测

```bash
node self-test.js                                  # 自动起服务（--port 0 挑空闲端口 + --ws-ping 1）并跑完全部用例
node self-test.js --video "D:\a.mp4"               # 带视频测（首次会抽帧，比较慢）
node self-test.js --base http://127.0.0.1:9101     # 只测一个已经在跑的服务
```

> `--base` 模式下**心跳帧检查会被跳过**：外部服务的 `--ws-ping` 是多少自测脚本不知道，
> 默认 30 秒等起来太久。要验心跳就用不带 `--base` 的自动起服务模式（它会给服务传 `--ws-ping 1`）。

---

## 二、接口文档

所有 JSON 响应都是 B 站的业务外壳：`code=0` 表示成功。全部允许跨域。

### 1. 进度条节点 `GET /x/player/v2?aid=&cid=`

```
GET http://127.0.0.1:9101/x/player/v2?aid=123&cid=456
```

```json
{
  "code": 0,
  "message": "0",
  "data": {
    "view_points": [
      {
        "from": 0,
        "to": 150,
        "content": "开场",
        "img_url": "/videoshot/preview.bin",
        "img_x_len": 5,
        "img_y_len": 5,
        "img_x_size": 160,
        "img_y_size": 90
      }
    ]
  }
}
```

- **`from` / `to` 的单位是秒**（不是毫秒）。播放器拿它算进度条宽度：`(to - from) / duration * 100`；用毫秒会让整条进度条算错。
- 默认造 **4~6 段**，首段 `from=0`、末段 `to=片长`，段与段**首尾相接不留缝**。
- 段名依次为：开场 / 第一部分 / 第二部分 / 高能片段 / 结尾 / 彩蛋。
- `img_url` 指向 `/videoshot/preview.bin`（**相对路径**，和 `index.json` 的 `image[0]`/`pvdata.img_url` 是同一个字符串）。
  B 站这个字段原本指向一张雪碧图，本服务不做雪碧图、所有帧都在 `preview.bin` 里，所以直接指向真实存在的那个文件；
  客户端按 `dataBaseUrl + img_url` 拼即可。注意它**不是一张可以直接加载的图片**，而是 `\u001F` 分隔的 jpeg data URL 列表。

**播放器侧怎么用**：映射成 `progressViewPoints[i].startTime / endTime`（见 `src/types/player.ts` 的 `ProgressViewPoint`），
渲染时 `left = startTime / duration * 100`、`width = (endTime - startTime) / duration * 100`。

### 2. 高能进度条 `GET /x/player/pbp?aid=&cid=`

```
GET http://127.0.0.1:9101/x/player/pbp?aid=123&cid=456
```

```json
{
  "code": 0,
  "message": "0",
  "data": {
    "step_sec": 30,
    "data": [0.108, 0.196, 0.302, 0.418, 0.529, 0.62, 0.681, 0.704]
  }
}
```

- `data` 是 **0~1 的浮点数组**，长度 = `ceil(片长 / step_sec)`（600s / 30 = 20 个点）。
- **`step_sec` 是横轴刻度**：第 `i` 个点代表视频第 `i * step_sec` 秒。把 `data[i]` 当高度百分比画折线，就是进度条上那条起伏曲线。
- 曲线由几个正弦叠加生成，**不用随机数**：随机会让每次刷新都变样，看不出对错；正弦叠加既有形状又可复现。

**播放器侧怎么用**：按 `step_sec` 把数组画成曲线（自测页底部有一个 canvas 示例实现），
`data[i]` → 高度 `data[i] * 100%`；找高能点就取局部极大值。

### 3. 历史弹幕 XML `GET /x/v1/dm/list.so?oid=`

```
GET http://127.0.0.1:9101/x/v1/dm/list.so?oid=456
GET http://127.0.0.1:9101/v1/dm/list.so?oid=456      # 简写别名，返回完全相同的内容
```

```xml
<i>
  <chatserver>chat.bilibili.com</chatserver>
  <maxlimit>1000</maxlimit>
  <source>k-v</source>
  <d p="0.34,1,25,16777215,1700000001,0,uid4821,1">前方高能</d>
  <d p="0.91,5,18,16711680,1700000002,0,uid913,2">A &amp; B &lt;测试&gt;</d>
  <!-- …共 1000 条，按时间升序铺满整片 -->
</i>
```

**这一份是服务启动时生成的 1000 条随机弹幕**（`DANMAKU_TOTAL = 1000`，条数也会在 `/healthz.danmakuCount` 里报出来）：

| 维度 | 取值 |
| --- | --- |
| 时间点 | `[0, 片长-0.1]`，**均匀打底 + 槽内抖动**，生成后按时间升序排序 |
| 文本 | 从 47 条中文短语池（`DM_TEXTS`）随机取（允许重复，真实弹幕也这样），单条最多 100 字 |
| 颜色 | 参考 `selection/index.ts:9-24` 的 **14 色板**：`#FE0302 #FF7204 #FFAA02 #FFD302 #FFFF00 #A0EE00 #00CD00 #019899 #4266BE #89D5FF #CC0273 #222222 #9B9B9B #FFFFFF` |
| 模式 | 滚动（1）约 88%、顶部（5）约 7%、底部（4）约 5% |
| 字号 | `18`（小）/ `25`（标准）两档，对应参考 `selection/index.ts:36-44` 的「小 / 标准」 |
| 速度档 | `verySlow` / `slow` / `moderate` / `fast` / `veryFast` 五档按权重 10/20/40/20/10 随机（取值照抄参考 `rowdm/index.ts:109-127`） |

> `p` 属性只有 8 段、装不下速度档（B 站格式就是这样），所以速度档的分布统计放在
> `/healthz.danmakuBySpeed` 里，5 档各多少条一眼可见（自测脚本也会断言 5 档都出现过、合计 1000）。

`p` 属性是 **8 段逗号分隔**，顺序与 B 站一致：

| 位置 | 含义 | 本服务取值 |
| --- | --- | --- |
| 1 | 出现时间，**秒**（可带小数） | `timePoint`（由片长均匀+抖动生成） |
| 2 | 模式 `1~3` 滚动 / `4` 底部 / `5` 顶部 | 随机，绝大多数是 1 |
| 3 | 字号 | `18` 或 `25` |
| 4 | **十进制**颜色（`16777215` = 白） | 14 色板里随机一个的十进制值 |
| 5 | Unix 时间戳（秒） | `1700000000 + 行号`（固定基准，便于肉眼核对） |
| 6 | 弹幕池 | `0` |
| 7 | 发送者 uid | `uid<1~9999>` |
| 8 | 行号 | `1..1000`（同时也是唯一 id） |

- 内容里的 `< > & " '` 一定会转义，否则整份 XML 解析失败（短语池里专门放了 `A & B <测试>` 来验这一点）。
- **注意第 1 段是秒、第 4 段是十进制颜色**，这两处最容易写错。
- 整份 XML 约 100KB，只拼一次就缓存起来（列表在运行期不变），不是每次请求重新生成。
- 1000 条在**启动时**生成，所以同一次运行里多次请求结果完全一致（刷新不会换一批弹幕）。

### 4. 推送弹幕（四条路，同一批数据）

推送拆成几个接口，因为它们解决几个不同的问题：**发**、**实时收**、**断线补齐**、**双向**。
不管从哪条路进来（POST 或 WS），最终都走服务端同一个 `acceptDanmaku()`：
校验 → 分配自增 `seq` → 截断 → 写进内存历史 → 同时广播给**所有 SSE 和所有 WS 连接**。
所以「POST 发的弹幕能在 WS 里收到、WS 发的弹幕能从 `/danmaku/since` 补齐」——这是设计如此。

#### 4a. `POST /danmaku/send` —— 发一条

```http
POST http://127.0.0.1:9101/danmaku/send
Content-Type: application/json

{ "text": "这画面绝了", "timeMs": 12500, "mode": 1, "fontSize": 25, "color": 16777215 }
```

```json
{ "code": 0, "data": { "seq": 7, "id": "dm-7" } }
```

- 服务端记一条（`seq` 全局自增、永不复用），**广播给所有在线 SSE + WebSocket 连接**，
  同时唤醒所有挂起的长轮询。
- `text` 为空 → `400` + `code=-400`；超长会被截断（`DM_TEXT_LIMIT = 100`）。
- 非 POST 请求 → `405`。
- 字段宽容：`mode` 收数字（`1/4/5`）也收字符串（`scroll/top/bottom`）；
  `color` 收十进制也收 `#RRGGBB`；时间收 `timeMs`（毫秒）也收 `timeSec`（秒）。
  这样 QML 侧可以直接把 WS 用的那份 JSON 原样 POST 过来，不用换算。

#### 4b. `GET /danmaku/stream` —— SSE 实时流

```
GET http://127.0.0.1:9101/danmaku/stream
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
```

响应体：

```
retry: 1000

data: {"seq":7,"id":"dm-7","timeMs":12500,"mode":1,"fontSize":25,"color":16777215,"speed":"moderate","uid":"1","ts":1767225600000,"text":"这画面绝了"}

: ping

```

- 每条弹幕一帧 `data: <JSON>\n\n`；每 **15 秒**发一次 `: ping` 心跳（以 `:` 开头的注释行，`EventSource` 会忽略）。
- 为什么需要心跳：代理/防火墙常在 30~60 秒空闲后**悄悄**掐断连接，而 TCP 层不报错，浏览器会一直「以为还连着」。
- 服务端在 `req.on('close')` / `res.on('close')` 里回收连接并清掉心跳定时器，否则连接池越积越多。
- 注意 SSE 这条链路用的是 **B 站口径**：`mode` 是数字（`1/4/5`）、`color` 是十进制、时间是 `timeMs`；
  WebSocket 那条用的是**播放器口径**（`mode` 字符串、`color` `#RRGGBB`、`timeSec`）。同一批数据，两种封装。

**为什么已经有 WebSocket 了还留着 SSE**（代码里也写了同样的理由）：

1. 浏览器端原生 `EventSource` 就能用，接起来比手写 WS 客户端省事；
2. 就是一个普通 HTTP GET，复用同一套 CORS 头，不会被代理当成特殊协议拦掉；
3. 断线后浏览器按 `retry` 自动重连，省掉手写心跳 + 重连状态机。

代价是**单向**（服务端 → 客户端）：要发弹幕得另走 `POST /danmaku/send`，
或者直接用双向的 WebSocket（4d）。

#### 4c. `GET /danmaku/since?seq=N` —— 长轮询兜底

有新弹幕（立刻返回）：

```json
{ "code": 0, "data": [ { "seq": 7, "timeMs": 12500, "mode": 1, "fontSize": 25, "color": 16777215, "text": "这画面绝了" } ] }
```

没有新弹幕（挂起最多 **25 秒**后超时）：

```json
{ "code": 0, "data": [] }
```

- 语义是「给我 `seq > N` 的全部弹幕」：有就立刻回，没有就挂着等，等到 25 秒或期间来了新弹幕。
- 为什么挂起而不是立刻返回空：立刻返回会让前端变成每秒好几次的高频空转轮询。
- 25 秒 < 常见的 30/60 秒网关超时，留了余量。
- **`seq` 的意义**：SSE 是「连上之后才收得到」，断线期间的消息会丢；客户端记住最后一条的 `seq`，
  重连后调一次 `/danmaku/since?seq=N` 就能补齐——这也是 B 站那套增量拉取的思路。
- WS 发来的弹幕同样进历史，所以 WS 断线后用同一个 `seq` 也能补齐。

#### 4d. `WS /danmaku/ws` —— WebSocket 实时弹幕（双向，推荐 QML 用）

```
ws://127.0.0.1:9101/danmaku/ws
ws://127.0.0.1:9101/danmaku/ws/     # 末尾斜杠也兼容
```

- 同一个 HTTP server 上处理 `Upgrade: websocket`，**协议是手写的 RFC6455**（零 npm 依赖，见 server.js 第 11 节）。
- 握手：`Sec-WebSocket-Accept = base64(sha1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`。
- 收发都是**文本帧**，一条消息一行 JSON（末尾带 `\n`，按行切分也能用）。
- 心跳：服务端每 **30 秒**发一个**协议层 ping 帧**（`--ws-ping <秒>` 可改）。
  浏览器和 Qt 的 `QWebSocket` 都会在协议层自动回 pong，**不需要 QML 里写任何代码**；
  服务端连续两轮收不到任何回应才判定死连接并关闭（收到任何帧都算活着，避免误杀）。
- 用普通 HTTP GET 打这个地址会得到 **426** + 一行「请用 ws:// 连接」的提示（专门为「把 ws:// 写成 http://」这种坑准备的）。
- 连接/断开/协议错误/超大帧都会打到服务端日志（`[mock ...]` / `[mock warn]`）。

**上行（客户端 → 服务端）**

| 消息 | 作用 |
| --- | --- |
| `{"type":"send","text":"你好","timeSec":12.3,"mode":"scroll","color":"#FFFFFF","fontSize":25,"speed":"moderate","uid":"1"}` | 发一条弹幕。服务端入库（能进 `/danmaku/since`）+ 广播给所有 SSE 和 WS 连接，**发送者自己也会收到那条广播**（走完全相同的渲染路径） |
| `{"type":"ping"}` | 应用层心跳（协议层 ping 帧 JS/QML 看不到，想量往返延迟用这个），服务端回 `{"type":"pong","t":<服务端毫秒时间戳>}` |

- `text` 必填（空 → 回 `{"type":"error","message":"text 不能为空"}`）；`timeSec` / `mode` / `color` / `fontSize` / `speed` / `uid` 都可省略。
- `mode` 支持 `scroll` / `top` / `bottom`，也兼容 `1` / `4` / `5`；`color` 支持 `#RRGGBB`，也兼容十进制。
- 认不出来的 `type`、以及不是合法 JSON 的文本，都会回一条 `{"type":"error","message":"…"}`（不会直接掐断连接）。

**下行（服务端 → 客户端，每行一条 JSON）**

```json
// 1) 连上就发：确认握手成功 + 告诉你怎么发
{"type":"hello","wsPath":"/danmaku/ws","danmakuCount":1000,"durationSec":600,"heartbeatMs":30000,"serverTime":1767225600000,"sendExample":"{\"type\":\"send\",\"text\":\"你好\",\"timeSec\":12.3,\"mode\":\"scroll\",\"color\":\"#FFFFFF\",\"fontSize\":25,\"speed\":\"moderate\"}"}

// 2) 弹幕广播（不管是 POST 发的还是别的 WS 客户端发的，都会走到这里）
{"type":"danmaku","id":"dm-7","seq":7,"text":"这画面绝了","timeSec":12.34,"timeMs":12340,"mode":"scroll","fontSize":25,"color":"#FFFFFF","uid":"1","speed":"moderate","isSelf":true,"ts":1767225600000}

// 3) 回客户端的应用层 ping
{"type":"pong","t":1767225600000}

// 4) 上行消息有问题
{"type":"error","message":"text 不能为空"}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | `hello` / `danmaku` / `pong` / `error` |
| `id` | string | 弹幕唯一 id（`dm-<seq>`），拿去当 QML 的 key 或去重 |
| `seq` | number | 全局自增序号；断线重连后带 `seq` 调 `/danmaku/since` 补齐 |
| `text` | string | 弹幕内容（最多 100 字） |
| `timeSec` | number | **秒**，出现时间（对应参考实现 `Danmaku.timePoint`）——播放器直接用这个 |
| `timeMs` | number | 毫秒，和 SSE/长轮询那条链路同源同值（两个字段永远相等） |
| `mode` | string | `scroll` / `top` / `bottom`（对应参考实现 `Danmaku.mode`；B 站 XML 里是数字 `1/4/5`） |
| `fontSize` | number | 字号，`18` 小 / `25` 标准 |
| `color` | string | `#RRGGBB`（对应参考实现 `Danmaku.color`；XML 里是十进制） |
| `uid` | string | 发送者（POST 默认 `"1"`；WS 没带 `uid` 时用连接 id） |
| `speed` | string | `verySlow`/`slow`/`moderate`/`fast`/`veryFast`，对应参考 `rowdm/index.ts:109-127` 的 5 档 |
| `isSelf` | boolean | 恒为 `true`：这条通道只广播「刚发来的弹幕」，历史弹幕走 `list.so` |
| `ts` | number | 服务端接收时刻（毫秒时间戳） |

> 连接建立后**不会**补发历史弹幕（避免播放器突然糊一屏旧弹幕）：历史请走 `GET /x/v1/dm/list.so`，
> 断线补齐请走 `GET /danmaku/since?seq=N`。

### 5. 进度条预览图 `GET /videoshot/preview.bin`

```
GET http://127.0.0.1:9101/videoshot/preview.bin
Content-Type: text/plain; charset=utf-8
```

文件内容是 **UTF-8 纯文本**，一串图片 data URL 用 `\u001F`（ASCII 0x1F）分隔：

```
\u001Fdata:image/jpeg;base64,/9j/4AAQ...\u001Fdata:image/jpeg;base64,/9j/4AAQ...\u001F...
```

#### ⚠️ 索引约定：每 5 秒 1 帧，下标 0 是空占位

取图算法在播放器里是写死的（`front/player/src/component/controls/index.ts:1410-1417`）：

```ts
const currTime = Math.floor(this.popup.currentTime / 5);
if (currTime === this.popup.prevTime) return;   // 同一格不重复换图
this.previewImage.src = this.videoshot[currTime + 1];
```

这段代码同时定死了两件事：

1. **粒度是 5 秒** —— 它把 `currentTime` 除以 5 取整，5 秒内共用一张图，所以服务端每 5 秒抽一帧正好够用（每秒抽只会让文件大 5 倍却看不出区别）；
2. **下标 0 是空占位** —— 它取的是 `[currTime + 1]`，那个 `+1` 就是跳过下标 0。

所以本服务的排布是：

| `split("\u001F")` 后的下标 | 内容 |
| --- | --- |
| `arr[0]` | `""`（空占位，播放器永远用不到） |
| `arr[k]`（k ≥ 1） | 第 `5*(k-1)` 秒的帧 |

**反查公式：`下标 = floor(秒 / 5) + 1`**

| 当前秒 t | `floor(t/5)` | 下标 | 取到的帧 |
| --- | --- | --- | --- |
| 0 | 0 | 1 | 第 0 秒 |
| 4 | 0 | 1 | 第 0 秒 |
| 5 | 1 | 2 | 第 5 秒 |
| 12 | 2 | 3 | 第 10 秒 |

以 600 秒的片子为例：抽 120 帧，`preview.bin` 切分后是 **121 项**（1 个占位 + 120 帧），
`index.json` 的 `index` 是 `[0,5,10,…,595]`（120 项，单位秒）。

**为什么用 `\u001F` 当分隔符**：

1. `\u001F` 是 ASCII 的 Unit Separator，**非打印控制字符**，data URL 的字符集（`data:image/jpeg;base64,` 前缀 + base64 字母表）里不可能出现，天然不冲突；
2. 换行、逗号、`|` 这些可打印字符都可能和 base64 或未来的字段打架；
3. **B 站自己就是这么干的**，播放器 `src/api/preview.ts` 已按 `split("\u001F")` 写好，保持一致最省事。

**怎么生成的**：一次 `ffmpeg -i <video> -vf fps=1/5,scale=160:90 -frames:v <帧数> -q:v 6` 批量抽帧
（循环 `-ss` 一帧一帧抽要起几百个进程，10 分钟的片子要几十秒；批量抽只要几秒），
再把每帧转成 `data:image/jpeg;base64,...`、用 `\u001F` 连接，写入
`.cache/<视频路径+参数 的 md5>/preview.bin`；**第二次启动直接读缓存**。

**没给 `--video` / ffmpeg 不存在 / 抽帧失败时**：往 stderr 打一条**带修复建议**的警告，
`preview.bin` 返回**空文件（HTTP 200，不是 404）**，服务绝不崩。

> 为什么用空文件而不是 404：播放器拿到空 body 后 `split("\u001F")` 得到 `[""]`，
> 只会安静地不显示预览图，不会刷一屏红色报错，其它接口照常能用。

### 6. `GET /videoshot/index.json` —— 预览图元信息

```json
{
  "code": 0,
  "message": "0",
  "data": {
    "pvdata": { "duration": 600, "img_x_len": 5, "img_y_len": 5, "img_x_size": 160, "img_y_size": 90, "img_url": "/videoshot/preview.bin" },
    "image": ["/videoshot/preview.bin"],
    "index": [0, 5, 10, 15, "…共 120 项"],
    "mock": {
      "status": "ready",
      "message": "已生成 120 帧（每 5 秒 1 帧）",
      "stepSec": 5,
      "frameCount": 120,
      "img_urlNote": "pvdata.img_url 与 image[0] 是同一个地址（/videoshot/preview.bin）：本 mock 没有独立雪碧图，该文件是 \\u001F 分隔的 jpeg data URL 列表，不是一张可直接加载的图片",
      "indexOf": "preview.bin 按 \\u001F 切分后取 arr[Math.floor(秒 / 5) + 1]（arr[0] 是空占位）"
    }
  }
}
```

- `pvdata.img_url` / `image[0]` / `view_points[i].img_url` **三处是同一个相对路径** `/videoshot/preview.bin`：
  B 站的 `pvdata.img_url` 原本指向雪碧图，本服务没有雪碧图（所有帧都在这一个文件里），所以指向真实存在的文件而不是编一个 `sprite_*.jpg`（那样只会 404）。
- `index` 给的是**秒**（0,5,10,…），和 `image` 一一对应，方便核对「第 12 秒该看到哪张图」。
- `mock` 是本服务多给的字段（B 站没有），自测页用它显示状态；按 B 站格式解析的代码会直接忽略它。
  `img_urlNote` 专门提醒「img_url 指向的不是图片而是数据文件」，省得对接的人拿它当图片资源去加载然后一头雾水。

### 7. `GET /healthz` —— 运行状态

```json
{
  "code": 0,
  "message": "0",
  "data": {
    "ok": true,
    "durationSec": 600,
    "durationSource": "命令行兜底 / --duration",
    "video": "", "aid": "", "cid": "",
    "danmaku": 3,
    "danmakuCount": 1000,
    "danmakuBySpeed": { "verySlow": 97, "slow": 203, "moderate": 401, "fast": 200, "veryFast": 99 },
    "sseClients": 0,
    "wsClients": 0,
    "wsPath": "/danmaku/ws",
    "wsHeartbeatMs": 30000,
    "longPollWaiters": 0,
    "preview": "ready",
    "previewFrames": 120,
    "hasFfmpeg": true,
    "hasFfprobe": true
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `durationSec` / `durationSource` | 片长与来源（ffprobe 或 `--duration` 兜底） |
| `danmaku` | 运行期收到的实时弹幕条数（原有字段） |
| `danmakuCount` | **启动时生成的随机弹幕条数，恒为 1000**（= `list.so` 返回的条数） |
| `danmakuBySpeed` | 那 1000 条在 5 个速度档上的分布（合计 1000） |
| `sseClients` / `wsClients` | 当前在线的 SSE / WebSocket 连接数 |
| `wsPath` / `wsHeartbeatMs` | WS 路径与心跳间隔（自测页用它拼 `ws://` 地址、显示心跳） |
| `longPollWaiters` | 当前挂起中的 `/danmaku/since` 请求数 |
| `preview` / `previewFrames` | 预览图状态（`idle`/`ready`/`unavailable`）与帧数 |
| `hasFfmpeg` / `hasFfprobe` | 两个外部程序能不能调用 |

自测脚本靠它等服务就绪、取片长，并断言 `danmakuCount === 1000`。

### 7b. 互动视频（分支剧情）

三个静态资源路由 + 一个数据路由，全部从 `mock-server/interactive/` 目录出：

| 路由 | 说明 |
| --- | --- |
| `GET /interactive/data.json` | 互动视频结构（每次请求重读文件，**改完保存即生效，不用重启服务**） |
| `GET /interactive/videos/<文件名>` | 节点视频（mp4/webm/m3u8/mpd，支持 HTTP Range，seek 必需） |
| `GET /interactive/covers/<文件名>` | 节点封面（jpg/png/webp） |
| `GET /interactive/images/<文件名>` | 分支选择答案背景图（jpg/png/webp） |

目录结构与数据文件：

```
mock-server/interactive/
  data.json      ← 剧情结构（节点 / 分支 / 时间窗），改这个文件换剧情
  videos/        ← 节点视频（n1.mp4、n2a.mp4 …… 与 data.json 里 video 字段对应）
  covers/        ← 节点封面（n1.jpg …… 与 cover 字段对应）
  images/        ← 答案背景图（bg-default.png 已内置，question.background 可换）
```

`data.json` 字段（形状与互动视频插件 `InteractiveVideoPluginConfig` 对齐）：

```jsonc
{
  "code": 0, "message": "0",
  "data": {
    "startNodeId": "n1",        // 入口节点 id
    "autoPlay": true,           // 分支切换后是否自动续播
    "nodes": {
      "n1": {
        "title": "第一章 深夜的岔路",          // 剧情进度条悬停卡片标题
        "cover": "/interactive/covers/n1.jpg", // 悬停卡片封面
        "video": "/interactive/videos/n1.mp4", // 节点视频（相对本服务）
        "duration": 30,                        // 视频时长（秒，与实际一致）
        "question": {                          // 缺省 = 终点节点，播完出重播按钮
          "timeStart": 26, "timeEnd": 31,      // 分支选择时间窗（秒）
          "title": "往哪边走？",                // 可选：题目文案
          "background": "/interactive/images/bg-default.png", // 可选：答案按钮背景图
          "defaultOptionIndex": 0,             // 倒计时归零自动选的项
          "options": [
            { "label": "A", "text": "进入森林", "targetNodeId": "n2a" },
            { "label": "B", "text": "沿河前进", "targetNodeId": "n2b" }
          ]
        }
      }
    }
  }
}
```

#### 用 ffmpeg 准备自己的视频

一段长视频切成多段（每个节点一段，`-c copy` 无损且秒级完成）：

```bash
# 1. 切段：按剧情分支点切（起止时间按自己的素材改）
ffmpeg -ss 00:00:00 -to 00:00:30 -i source.mp4 -c copy interactive/videos/n1.mp4
ffmpeg -ss 00:00:30 -to 00:01:00 -i source.mp4 -c copy interactive/videos/n2a.mp4
ffmpeg -ss 00:01:00 -to 00:01:25 -i source.mp4 -c copy interactive/videos/n2b.mp4
ffmpeg -ss 00:01:25 -to 00:01:40 -i source.mp4 -c copy interactive/videos/n3.mp4

# 2. 每段取第 2 秒画面当封面（宽 234 与悬停卡片一致）
ffmpeg -i interactive/videos/n1.mp4 -ss 2 -vframes 1 -vf scale=234:-1 interactive/covers/n1.jpg

# 3. 查每段实际时长（填进 data.json 的 duration）
ffprobe -v error -show_entries format=duration -of csv=p=0 interactive/videos/n1.mp4
```

#### DASH（.mpd）与多清晰度的 video 字段写法

`video` 字段与播放器 `PlayerSource` 同构，三种形态按场景选：

**① DASH / HLS（推荐，多清晰度场景）—— 一个清单 URL 字符串：**

```jsonc
{ "video": "/interactive/videos/n1.mpd" }   // DASH：.mpd 后缀自动识别
{ "video": "/interactive/videos/n1.m3u8" }  // HLS：.m3u8 后缀自动识别
```

⚠️ **DASH/HLS 不要在 JSON 里列举清晰度**：多清晰度由 MPD/m3u8 清单里的
Representation/Variant 描述，播放器加载清单后**运行时自动发现全部档位**
并走 ABR 自适应。JSON 里只需要给清单地址，给多了反而会被忽略。

**② MP4 多文件多清晰度 —— 渐进式变体数组（仅 MP4 场景）：**

```jsonc
{
  "video": [
    { "url": "/interactive/videos/n1_1080p.mp4", "label": "1080P 高清", "height": 1080, "bitrate": 5000000 },
    { "url": "/interactive/videos/n1_720p.mp4",  "label": "720P 高清",  "height": 720,  "bitrate": 2800000 },
    { "url": "/interactive/videos/n1_480p.mp4",  "label": "480P 清晰",  "height": 480,  "bitrate": 1400000 }
  ]
}
```

**③ MP4 单文件 —— 字符串**（即上文 data.json 的默认示例）。

**用 ffmpeg 打包多清晰度 DASH**（一次输出 3 档 + 1 音轨，产物是
`n1.mpd` + `init-stream*.m4s` + `chunk-stream*.m4s`，全部放
`interactive/videos/` 同目录即可，分片路由已覆盖 `.m4s`/`.ts`）：

```bash
ffmpeg -i source.mp4 ^
  -filter_complex "[0:v]split=3[v1][v2][v3];[v1]scale=1920:1080[o1];[v2]scale=1280:720[o2];[v3]scale=854:480[o3]" ^
  -map "[o1]" -c:v:0 libx264 -b:v:0 5000k ^
  -map "[o2]" -c:v:1 libx264 -b:v:1 2800k ^
  -map "[o3]" -c:v:2 libx264 -b:v:2 1400k ^
  -map a:0 -c:a aac -b:a 128k ^
  -f dash -use_template 1 -use_timeline 1 ^
  -adaptation_sets "id=0,streams=0,1,2 id=1,streams=a" ^
  interactive/videos/n1.mpd
```

（Linux/macOS 把行尾 `^` 换成 `\`。）
产物里 MPD 引用同目录的 init/chunk 分片，播放器请求
`/interactive/videos/chunk-stream0-00001.m4s` 时命中媒体路由，无需改任何配置。

多清晰度 DASH 的 `data.json` 节点示例：

```jsonc
"n1": {
  "title": "第一章 深夜的岔路",
  "cover": "/interactive/covers/n1.jpg",
  "video": "/interactive/videos/n1.mpd",
  "duration": 30,
  "question": { ... }
}
```

改数据的三个要点：
1. `duration` 填 ffprobe 查到的真实时长；
2. `question.timeStart / timeEnd` 必须落在该节点视频时长内
   （一般 `timeEnd` 略大于视频时长，让问题在结尾弹出；播放器播完
   ENDED 后也会弹出问题并定格最后一帧）；
3. `options[].targetNodeId` 必须指向 `nodes` 里存在的节点 id，
   没选中的分支节点可以继续带自己的 `question` 形成多级分支。


### 8. `GET /` —— 自测页

原生 HTML/CSS/JS（无框架），包含：**怎么用**说明、运行环境（片长、弹幕条数与速度档分布、WS 连接数、ffmpeg 状态）、
接口一览（逐个点开看 URL 与返回前 200 字符）、发弹幕（POST）、SSE 实时弹幕窗口、
**WebSocket 面板**（连接状态徽标 + 失败提示 + 实时弹幕窗口 + 走 WS 发送 + 发送 ping 量往返）、
分段 + 高能曲线、前 20 张缩略图网格。
`GET /test-page.html` 和 `GET /index.html` 返回同一页面；页面里的请求全是**相对路径**（同源），换端口不用改代码；
WS 地址由 `location.host` + `/healthz` 报的 `wsPath` 拼出来，所以换端口也不用改。

> WebSocket 面板的「通过 WS 发送」在连接正常时走 WS（验证双向），
> 连接断开时自动降级成 `POST /danmaku/send`，并把用的是哪条路写在输出框里。

---

## 三、播放器侧对接要点（速查）

| 数据 | 播放器怎么用 |
| --- | --- |
| `view_points[i].from / to` | **单位秒** → `progressViewPoints[i].startTime / endTime`；宽度 = `(to-from)/duration*100` |
| `pbp.data` + `pbp.step_sec` | 曲线：第 `i` 点横坐标 `i*step_sec` 秒，纵坐标 `data[i]`（0~1 → 高度百分比） |
| `preview.bin` | `split("\u001F")` 后取 **`videoshot[Math.floor(当前秒 / 5) + 1]`**（下标 0 是空占位） |
| `preview.bin` 的每一帧 | 都是可直接塞进 `<img src>` 的 jpeg data URL，不需要再解 sprite 图 |
| `view_points[i].img_url` / `pvdata.img_url` | 都是相对路径 `/videoshot/preview.bin`（按 `dataBaseUrl + 该值` 拼）；**这个地址不是图片**，是 `\u001F` 分隔的数据文件，别拿它当 Image 源 |
| `dm/list.so` 的 `p` | 逗号切 8 段：第 1 段是**秒**，第 4 段是十进制颜色；共 1000 条 |
| `ws://…/danmaku/ws` | QML `WebSocket`：`onTextMessage` → `JSON.parse` → `type === "danmaku"` 时按 `timeSec`/`mode`/`color`/`fontSize`/`speed` 渲染 |
| WS 上行 `{"type":"send",…}` | 发弹幕（`timeSec` 用秒）；同一连接也会收到自己发的那条广播 |
| `/danmaku/stream` | `new EventSource(url)`，`onmessage` 里 `JSON.parse(ev.data)` |
| `/danmaku/since?seq=N` | 断线重连后补齐漏掉的弹幕，记住最后一条的 `seq`（SSE 和 WS 通用） |

---

## 四、实现说明（为什么这么写）

- **零依赖**：只 require/import 七个 `node:` 内置模块，拷到任何装了 Node（≥18）的机器上都能跑。
- **必须 ESM**：`front/player/package.json` 是 `"type": "module"`，本目录没有自己的 `package.json`，
  所以这两个 `.js` 都是 ES Module；同时 `__dirname` 不存在，要用 `import.meta.url` 推。
- **注释写「为什么」**：为什么用 `\u001F`、为什么两条推送通道都留着、为什么下标 0 是空占位、
  为什么没视频时返回空文件而不是 404、为什么服务端帧不能带掩码 —— 代码里都就地写了原因，本 README 不重复。
- **`seq` 自增而不是时间戳做 id**：时间戳会重复（同一毫秒发两条），而增量拉取需要一个严格单调、能比较「大于 N」的游标。
- **1000 条弹幕在启动时生成一次**：同一次运行里多次请求 `list.so` 内容完全一致（刷新不换一批），
  `/healthz.danmakuCount` 也才能随时等于真实条数；XML 只拼一次就缓存（约 100KB，没必要每次重拼）。
- **随机弹幕用 `Math.random()`，pbp 曲线却刻意不用**：pbp 要的是「可复现、能对比两次结果」，
  所以用正弦叠加；而弹幕要的就是「每次启动换一批」，随机才对。两处的取舍不同，是有意的。
- **手写 WebSocket 而不是引 `ws`**：需求禁止 npm 依赖，而 Node 内置模块没有 WebSocket 服务端
  （只有 Node 22+ 的客户端实现）。RFC6455 服务端需要的只有握手、拆帧（解掩码）、装帧（不带掩码）三件事。
  自己实现还有个额外好处：帧格式的每条约定都能在自测脚本里断言（比如「服务端帧不带掩码」）。
- **两条发送路径共用一个 `acceptDanmaku()`**：POST 和 WS 的入库、截断、seq 分配、广播逻辑只有一份，
  否则日后加字段必然漏掉其中一条，而漏的那条只在用另一个客户端时才暴露。
- **抽帧结果放 `.cache`**：整个服务里唯一的重活，第二次启动必须毫秒级完成；缓存 key 由视频路径和抽帧参数算出，
  换了视频或参数就会自动重抽。
- **抽帧是懒加载的**：第一次请求 `/videoshot/preview.bin` 才动手，并用一个共享 Promise 合并并发请求，
  避免几个标签页同时打开进度条时并行拉起好几个 ffmpeg。

---

## 五、自测记录

> ⚠️ **本节待填：本次会话的 shell 工具不可用，未能实机运行。**
>
> 会话里的 `pwsh` 工具在**进程创建阶段**就失败了，所有命令（包括 `echo probe`、`node --version`）
> 一律返回同一个错误，属于沙箱 ACL 授权失败，与代码本身无关：
>
> ```
> Error: SetNamedSecurityInfoW failed (Win32 5): grantWrite(D:\hilihili)
> ```
>
> 因此 `node --check`、启动服务、curl 各接口这些**必须由你在本地跑一次**：
>
> ```bash
> cd D:\hilihili\front\player\mock-server
> node --check server.js          # 语法检查（注意：ESM 语法用 --check 校验没问题）
> node --check self-test.js
> node server.js --port 9101      # 无 --video 也必须能起
> # 另开一个终端：
> curl -s http://127.0.0.1:9101/ | head -c 200
> node self-test.js               # 推荐：自动起服务（--ws-ping 1），WS 那组用例也能跑全
> node self-test.js --base http://127.0.0.1:9101
> ```
>
> 浏览器里 `http://127.0.0.1:9101/` 的 **WebSocket 面板**是最直观的一条验证路径：
> 连上应当立刻显示「已连接」并把 `hello` 打进窗口，点「通过 WS 发送」应在 1 秒内看到广播回来的自己那条。
>
> `self-test.js` 会把每一项的**实际输出片段**打印出来（HTTP 状态、响应头、返回体截断片段、
> SSE 收到的帧、WS 的握手 accept、hello、广播 JSON、ping/pong、长轮询等待了多少秒、
> preview.bin 的字节数和切分项数、t=0/4/5/12 → 下标 1/1/2/3 的核对结果），
> 把最后的「通过 N 项 / 失败 M 项」整段贴到本小节即可。

### 待确认清单（本地跑完请逐项核对）

| # | 待确认项 | 期望结果 |
| --- | --- | --- |
| 1 | `node --check server.js`、`node --check self-test.js` | 无输出、退出码 0 |
| 2 | `node server.js --port 9101`（无 `--video`） | 正常起服务，stderr 有「未提供 --video」警告，首屏有「弹幕：1000 条」「WS：ws://…/danmaku/ws」，不崩 |
| 3 | `node server.js --help` | 打印中文帮助（含 `--ws-ping`）并退出码 0 |
| 4 | 浏览器打开 `http://127.0.0.1:9101/` | 自测页正常显示，各面板都能拉到数据；WebSocket 面板显示「已连接」 |
| 5 | `/x/player/v2` | `code=0`，4~6 段，首段 `from=0`，末段 `to=片长`，段间首尾相接 |
| 6 | `/x/player/pbp` | `step_sec=30`，点数 = `ceil(片长/30)`，值都在 [0,1] 且有起伏 |
| 7 | `/x/v1/dm/list.so` | XML，**恰好 1000 条 `<d>`**，按时间升序，`p` 是 8 段，第 1 段是**秒**，第 4 段是色板里的十进制颜色，特殊字符已转义 |
| 8 | `/v1/dm/list.so` | 别名，内容与 `/x/v1/dm/list.so` 完全一致 |
| 9 | `/healthz` | 有 `danmakuCount: 1000`、`danmakuBySpeed`（5 档、合计 1000）、`wsClients`/`wsPath`/`wsHeartbeatMs` |
| 10 | `POST /danmaku/send` | `{"code":0,"data":{"seq":N,"id":"dm-N"}}`；空文本 400；非 POST 405 |
| 11 | `GET /danmaku/stream` | `text/event-stream`，先收 `retry: 1000`；**连上之后** POST 的弹幕能实时到达（收到的 seq 与那条 POST 响应里的 seq 一致） |
| 12 | `GET /danmaku/since?seq=<最新>` | 挂起约 25 秒后返回空数组；挂起期间发弹幕则提前唤醒；WS 发的弹幕也能补到 |
| 13 | WS 握手 | `Sec-WebSocket-Accept = base64(sha1(key + GUID))`，连上立刻收到 `hello` |
| 14 | WS 双向 | 上行 `{"type":"send"}` → 收到 `{"type":"danmaku"}`（`mode` 字符串、`color` `#RRGGBB`、`timeSec` 秒）；POST 发的也会广播到 WS |
| 15 | WS 心跳 | 自动起服务（`--ws-ping 1`）时，8 秒内能收到服务端协议层 ping 帧；连上后 `/healthz.wsClients` +1，断开回落到基线 |
| 16 | 用 HTTP GET 打 `/danmaku/ws` | 返回 426 + 「请用 ws:// 连接」提示（不是 404，也不是静默断开） |
| 17 | `/x/player/v2` 的 `img_url`、`/videoshot/index.json` 的 `pvdata.img_url` 与 `image[0]` | 三处都是同一个相对路径 `/videoshot/preview.bin`（不再是空串、也不是不存在的 `sprite_*.jpg`） |
| 18 | `preview.bin`（无视频） | HTTP 200 + 0 字节（**不是 404**） |
| 19 | `preview.bin`（带视频，首跑） | 日志显示抽帧完成，`split("\u001F")[0] === ""`，帧数 = `ceil(片长/5)` |
| 20 | 再启动一次（同样的视频） | 日志出现「preview.bin 命中缓存」，秒级完成 |
| 21 | `t=0/4/5/12` 秒 → 下标 | 分别是 1/1/2/3，且对应项是 jpeg 帧 |
