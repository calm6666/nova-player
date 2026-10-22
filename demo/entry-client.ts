/**
 * ============================================
 * 客户端水合(Hydration)入口
 * ============================================
 * 此文件在浏览器环境中运行
 *
 */

import "@/styles/style.scss";
import { hydrate, mount } from "@/core";
import { PlayerEventEnum } from "@/core/events";
// 内置语言包：随 i18n 配置注入播放器（core/index.ts 已自动注册，这里显式传入保证配置完整）
import zhCN from "@/locales/zh-CN.json";
import enUS from "@/locales/en-US.json";
import {
  RootLayout,
  appEventBus,
  playerInstance,
  setPlayerInstance,
} from "./main";
import { DEMO_SSR_PLAYER_CONFIG } from "./ssr-player";
import { VideoPlayer } from "@/nova/player";
import { createHlsPlugin } from "@/lumina/plugins/hls";
import { createDashPlugin } from "@/lumina/plugins/dash";
import { TopPlugin, EndingPlugin } from "@/lumina/plugins/index";
import { DanmakuPlugin } from "@/lumina/plugins/danmaku";
import type { DanmakuPluginAPI } from "@/lumina/plugins/danmaku";
import { InteractionPlugin } from "@/lumina/plugins/interaction";
import { SubtitlePlugin } from "@/lumina/plugins/subtitle";
import type { SubtitlePluginAPI } from "@/lumina/plugins/subtitle";
import { AudioEffectPlugin } from "@/lumina/plugins/audioeffect";
import type {
  AudioEffectPluginAPI,
  CombinationPresetName,
  EQPresetName,
  ReverbPresetName,
} from "@/lumina/plugins/audioeffect";
import { InteractiveVideoPlugin } from "@/lumina/plugins/interactive-video";
import type {
  InteractiveNode,
  InteractiveVideoPluginConfig,
} from "@/lumina/plugins/interactive-video";
import type { MediaManifestSource } from "@/types/streamPlugin";
import type {
  InteractionPluginAPI,
  InteractionPluginConfig,
  InteractionPluginMode,
  InteractionCard,
  InteractionGuideThree,
  InteractionLink,
  InteractionVote,
  InteractionScore,
  InteractionScoreSum,
  CardType,
} from "@/lumina/plugins/interaction";
import type { AiSubtitleEntry, RemoteSubtitleTrack } from "@/types/subtitle";
import type { DanmakuItem, DanmakuFilter } from "@/types/danmaku";
import {
  DanmakuType,
  RenderMode,
  DanmakuSpeed,
  DanmakuFontSize,
  DanmakuArea,
  ScreenMode,
} from "@/types/danmaku";
import type {
  MediaItem,
  PlayerConfig,
  PlayerSource,
  ProgressSegment,
  DisplayMode,
} from "@/types";
// PlayMode 为运行时枚举（设置播放模式轮换用），须按值导入
import { PlayMode } from "@/types";
import type { Plugin } from "@/nova/core/plugin";
import {
  normalizeEnergyProgress,
  type EnergyProgressData,
} from "@/nova/utils/media/energyProgress";
import {
  createMutablePreviewProvider,
  type DemoPreviewSource,
  type MutablePreviewProvider,
} from "./preview-provider";

/**
 * mock-server 基地址（默认端口 9101；响应带 Access-Control-Allow-Origin: *，
 * 开发时 demo 页面可直接跨端口请求，无需额外代理）
 */
const MOCK_SERVER_BASE = "http://127.0.0.1:9101";

/** mock-server 的进度条节点响应 */
interface MockViewPoint {
  from: number;
  to: number;
  content: string;
}

/**
 * 拉取分段点（进度条章节）
 *
 * 接口：GET http://127.0.0.1:9101/x/player/v2
 * 响应：{ code, message, data: { view_points: [{ from, to, content, ... }] } }
 * from/to 单位为秒，直接映射为 ProgressSegment 的 startTime/endTime。
 *
 * @returns 分段列表；请求失败返回空数组
 */
async function fetchProgressSegments(): Promise<ProgressSegment[]> {
  try {
    const response = await fetch(`${MOCK_SERVER_BASE}/x/player/v2`);
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      data?: { view_points?: MockViewPoint[] };
    };
    const points = payload.data?.view_points;
    if (!Array.isArray(points)) return [];
    return points.map((point) => ({
      startTime: Number(point.from) || 0,
      endTime: Number(point.to) || 0,
      label: String(point.content ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * 十进制颜色值 → #RRGGBB
 *
 * B 站弹幕 XML 协议中颜色为十进制整数（如 16777215 = #FFFFFF），
 * 引擎渲染与发送栏取色均使用 #RRGGBB 字符串，此处完成协议转换。
 */
function decimalColorToHex(value: number): string {
  const clamped = Math.max(0, Math.min(0xffffff, Math.round(value)));
  const hex = clamped.toString(16).padStart(6, "0");
  return `#${hex}`;
}

/**
 * B 站弹幕模式 → 引擎弹幕类型
 *
 * XML 协议模式值：1 滚动 / 4 底部 / 5 顶部，其余值一律按滚动处理
 * （与插件内 danmakuModeToType 的映射规则保持一致）。
 */
function mockModeToType(mode: number): DanmakuType {
  if (mode === 5) return DanmakuType.TOP;
  if (mode === 4) return DanmakuType.BOTTOM;
  return DanmakuType.SCROLL;
}

/**
 * 拉取 mock 弹幕列表
 *
 * 接口：GET http://127.0.0.1:9101/x/v1/dm/list.so?oid=1
 * 响应：B 站弹幕 XML 协议（<i> 根节点，<d> 子节点）：
 *   <d p="出现时间,模式,字号,十进制颜色,发送时间戳,pool,uid,行号">弹幕内容</d>
 *
 * 字段映射：p[0]→time、p[1]→type、p[3]→color、p[6]→uid；
 * fontSize 不映射（保持引擎基准字号，避免不同字号弹幕轨道测量偏差）。
 *
 * @returns 弹幕列表；请求失败或解析失败静默返回空数组
 */
async function fetchDanmakuList(): Promise<DanmakuItem[]> {
  try {
    const response = await fetch(`${MOCK_SERVER_BASE}/x/v1/dm/list.so?oid=1`);
    if (!response.ok) return [];
    const xmlText = await response.text();
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const nodes = doc.querySelectorAll("d");
    const list: DanmakuItem[] = [];
    nodes.forEach((node, index) => {
      const text = node.textContent ?? "";
      const raw = node.getAttribute("p") ?? "";
      const parts = raw.split(",");
      const time = Number(parts[0]);
      // 内容为空或时间非法（缺字段/NaN/负数）的条目直接跳过
      if (!text || !Number.isFinite(time) || time < 0) return;
      const item: DanmakuItem = {
        id: `mock-${index}`,
        text,
        time,
        type: mockModeToType(Number(parts[1])),
        color: decimalColorToHex(Number(parts[3])),
        uid: parts[6] ?? "",
      };
      list.push(item);
    });
    return list;
  } catch {
    // 弹幕属于增强功能：网络异常 / XML 解析失败静默降级为空列表
    return [];
  }
}

// ============================================
// 弹幕列表面板（mock 拉取 + 本地发送）
// ============================================

/**
 * 弹幕列表面板数据源
 *
 * rebuildPlayer 时由 mock 拉取结果整体替换，
 * 本地发送的弹幕经 onSendSuccess 回调追加进来；
 * 同时作为播放器 danmaku.provider 的查询底表（已发射弹幕由
 * 调度器 markEmitted 集合去重，本地条目混入不会二次发射）。
 */
let danmakuPanelList: DanmakuItem[] = [];

/** 秒 → mm:ss 时间点文本（小时级视频按 h:mm:ss 展开） */
function formatDanmakuTime(time: number): string {
  const total = Math.max(0, Math.floor(time));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 全量重建弹幕列表面板
 *
 * 列表结构：时间徽标 + 弹幕内容（本人弹幕额外挂「我」徽标），
 * 按 time 升序排列；mock 数据天然有序，本地发送经 sort 维持顺序。
 */
function renderDanmakuList(): void {
  const list = document.getElementById("danmaku-list");
  if (!list) return;
  list.innerHTML = "";
  if (danmakuPanelList.length === 0) {
    const empty = document.createElement("li");
    empty.className = "danmaku-empty";
    empty.textContent = "暂无弹幕";
    list.appendChild(empty);
    return;
  }
  danmakuPanelList.forEach((item) => {
    const li = document.createElement("li");
    li.className = "danmaku-item";

    const time = document.createElement("span");
    time.className = "danmaku-item-time";
    time.textContent = formatDanmakuTime(item.time);

    const text = document.createElement("span");
    text.className = "danmaku-item-text";
    text.textContent = item.text;

    li.appendChild(time);
    li.appendChild(text);

    // 本人弹幕徽标（uid=1 与引擎 danmaku-x-self 白框同一判定）
    if (item.uid === 1 || item.uid === "1") {
      const self = document.createElement("span");
      self.className = "danmaku-item-self";
      self.textContent = "我";
      li.appendChild(self);
    }

    list.appendChild(li);
  });
}

/**
 * 追加弹幕到列表面板（本地发送成功回调入口）
 *
 * 插入后按 time 重排序并全量重建（发送为低频操作，全量重建开销可忽略）。
 */
function appendDanmakuToList(item: DanmakuItem): void {
  danmakuPanelList.push(item);
  danmakuPanelList.sort((a, b) => a.time - b.time);
  renderDanmakuList();
}

// ============================================
// 分段进度条列表面板（mock 拉取 + 运行时编辑）
// ============================================

/**
 * 分段数据源（模块级，跨播放器重建保留）
 *
 * 首次 rebuildPlayer 由 mock 拉取结果填充；运行时编辑
 * （追加 / 改标题 / 删除）直接改写此数组，再经 applyDemoSegments
 * 调 player.setConfig({ progress: { segments } }) 深合并生效。
 */
let demoSegments: ProgressSegment[] = [];

/**
 * 把当前 demoSegments 应用到播放器（仅 setConfig 深合并，不重建列表面板）
 *
 * 只拷贝 startTime / endTime / label 三个数据字段构造纯净对象，
 * 不把 element 等控件内部 DOM 字段带进新配置（由控件按新数据重建）。
 * 行内编辑（改标题 / 起止时间）提交时调用：输入框已是最新显示，
 * 无需重建面板，避免焦点丢失。
 */
function applyDemoSegmentsToPlayer(): void {
  playerInstance?.setConfig({
    progress: {
      segments: demoSegments.map((segment) => ({
        startTime: segment.startTime,
        endTime: segment.endTime,
        label: segment.label,
      })),
    },
  });
}

/**
 * 结构操作（增删分段）后的完整应用：应用到播放器 + 全量重建列表面板
 */
function applyDemoSegments(): void {
  applyDemoSegmentsToPlayer();
  renderSegmentList();
}

/**
 * 行内时间输入的解析与校验
 *
 * @returns 合法时返回数值；空输入返回 null（表示未修改）；非法返回 NaN
 */
function parseSegTimeInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

/**
 * 全量重建分段列表面板（行内可编辑）
 *
 * 每段渲染一行：标题输入 + 起始/结束秒数输入（change 提交，
 * 校验失败回显原值并提示）+ 删除按钮；
 * 结构操作（删除 / 添加）后调用本函数重建。
 */
function renderSegmentList(): void {
  const panel = document.getElementById("segment-list");
  if (!panel) return;
  panel.replaceChildren();
  if (demoSegments.length === 0) {
    const empty = document.createElement("p");
    empty.className = "seg-empty";
    empty.textContent = "暂无分段（添加来源后自动拉取，或在上方表单添加）";
    panel.appendChild(empty);
    refreshSegPositionOptions();
    return;
  }
  demoSegments.forEach((segment, index) => {
    const row = document.createElement("div");
    row.className = "seg-item";

    // 标题输入：change 提交（避免逐键重建），实时应用到播放器
    const label = document.createElement("input");
    label.className = "ice-input seg-item-label";
    label.type = "text";
    label.value = segment.label || `分段 ${index + 1}`;
    label.addEventListener("change", () => {
      const next = label.value.trim();
      if (next === "") {
        label.value = segment.label;
        logAction("分段标题不能为空，已保留原值");
        return;
      }
      segment.label = next;
      logAction(`分段 #${index + 1} 标题 → "${next}"`);
      applyDemoSegmentsToPlayer();
      refreshSegPositionOptions();
    });

    // 起始时间输入：change 提交，校验 0 ≤ start < end
    const start = document.createElement("input");
    start.className = "ice-input ice-num";
    start.type = "number";
    start.step = "0.1";
    start.min = "0";
    start.value = String(segment.startTime);
    start.addEventListener("change", () => {
      const next = parseSegTimeInput(start.value);
      if (next === null) {
        start.value = String(segment.startTime);
        return;
      }
      if (Number.isNaN(next) || next >= segment.endTime) {
        start.value = String(segment.startTime);
        logAction(
          `起始时间非法（需 0 ≤ 起 < 终 ${segment.endTime}s），已保留原值`,
        );
        return;
      }
      segment.startTime = next;
      logAction(`分段 #${index + 1} 起始 → ${next}s`);
      applyDemoSegmentsToPlayer();
    });

    // 结束时间输入：change 提交，校验 end > start
    const end = document.createElement("input");
    end.className = "ice-input ice-num";
    end.type = "number";
    end.step = "0.1";
    end.min = "0";
    end.value = String(segment.endTime);
    end.addEventListener("change", () => {
      const next = parseSegTimeInput(end.value);
      if (next === null) {
        end.value = String(segment.endTime);
        return;
      }
      if (Number.isNaN(next) || next <= segment.startTime) {
        end.value = String(segment.endTime);
        logAction(`结束时间非法（需 > 起 ${segment.startTime}s），已保留原值`);
        return;
      }
      segment.endTime = next;
      logAction(`分段 #${index + 1} 结束 → ${next}s`);
      applyDemoSegmentsToPlayer();
    });

    const remove = document.createElement("button");
    remove.className = "seg-item-remove";
    remove.type = "button";
    remove.textContent = "删除";
    remove.addEventListener("click", () => {
      demoSegments.splice(index, 1);
      logAction(`删除分段 #${index + 1}（剩 ${demoSegments.length} 段）`);
      applyDemoSegments();
    });

    row.appendChild(label);
    row.appendChild(start);
    row.appendChild(end);
    row.appendChild(remove);
    panel.appendChild(row);
  });
  refreshSegPositionOptions();
}

/**
 * 刷新添加表单的「插入位置」下拉选项
 *
 * 选项：末尾追加 / 插入到最前 / 在每一段之前插入；
 * 重建后尽量保留原有选择（失效则回落到末尾追加）。
 */
function refreshSegPositionOptions(): void {
  const select = document.getElementById("seg-add-pos");
  if (!(select instanceof HTMLSelectElement)) return;
  const previous = select.value;
  select.replaceChildren();

  const appendOption = (value: string, text: string): void => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  };

  // "end" 表示追加到末尾；数字表示插入到该下标之前（0 = 最前）
  appendOption("end", "追加到末尾");
  appendOption("0", "插入到最前");
  demoSegments.forEach((segment, index) => {
    const title = segment.label || `分段 ${index + 1}`;
    appendOption(String(index), `在「${title}」之前`);
  });

  // 保留原选择（仍存在时），否则回落到末尾追加
  const stillValid =
    previous === "end" ||
    (previous !== "" &&
      Number.isInteger(Number(previous)) &&
      Number(previous) >= 0 &&
      Number(previous) <= demoSegments.length);
  select.value = stillValid ? previous : "end";
}

/**
 * ============================================
 * 字幕双模式
 * ============================================
 * 模式 A：本地 AI 实时识别（sherpa-onnx 真实流式引擎，Worker 内加载模型）
 * 模式 B：服务端字幕轨（mock-server 多轨 + 增量拉取）
 */

/** 判定是否为合法的服务端轨道条目（类型谓词窄化，替代 as 断言） */
function isMockSubtitleTrack(value: unknown): value is RemoteSubtitleTrack {
  if (typeof value !== "object" || value === null) return false;
  if (
    !("trackId" in value) ||
    !("lang" in value) ||
    !("label" in value) ||
    !("kind" in value)
  ) {
    return false;
  }
  return (
    typeof value.trackId === "string" &&
    typeof value.lang === "string" &&
    typeof value.label === "string" &&
    (value.kind === "original" || value.kind === "translation")
  );
}

/** 判定是否为合法的 cue 条目（start/end/text 必备，translation/confidence 可选） */
function isMockSubtitleCue(value: unknown): value is AiSubtitleEntry {
  if (typeof value !== "object" || value === null) return false;
  if (!("start" in value) || !("end" in value) || !("text" in value)) {
    return false;
  }
  return (
    typeof value.start === "number" &&
    typeof value.end === "number" &&
    typeof value.text === "string"
  );
}

/**
 * 从 mock-server 响应体中提取 cue 数组
 * 响应形态：{ code, data: { subtitles: [{ start, end, text, translation?, confidence? }] } }
 * 非法条目静默过滤，保证 Provider 拿到的是干净数据
 */
function extractMockCues(payload: unknown): AiSubtitleEntry[] {
  if (typeof payload !== "object" || payload === null || !("data" in payload)) {
    return [];
  }
  const data: unknown = payload.data;
  if (typeof data !== "object" || data === null || !("subtitles" in data)) {
    return [];
  }
  const list: unknown = data.subtitles;
  if (!Array.isArray(list)) return [];
  return list.filter(isMockSubtitleCue);
}

/**
 * 拉取服务端字幕轨道列表（模式 B 多轨协议）
 *
 * 接口：GET http://127.0.0.1:9101/api/subtitle/tracks
 * 响应：{ code, data: { tracks: [{ trackId, lang, label, kind, ... }] } }
 *
 * @returns 轨道列表；请求失败返回空数组（插件会维持单轨/无轨道语义）
 */
async function fetchSubtitleTracks(): Promise<RemoteSubtitleTrack[]> {
  try {
    const response = await fetch(`${MOCK_SERVER_BASE}/api/subtitle/tracks`);
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload)
    ) {
      return [];
    }
    const data: unknown = payload.data;
    if (
      typeof data !== "object" ||
      data === null ||
      !("tracks" in data) ||
      !Array.isArray(data.tracks)
    ) {
      return [];
    }
    return data.tracks.filter(isMockSubtitleTrack);
  } catch {
    return [];
  }
}

/**
 * 拉取服务端字幕 cue（模式 B 增量协议：按播放进度向前预取）
 *
 * 接口：GET http://127.0.0.1:9101/api/subtitle/cues?track=zh-ai&from=0&to=60
 * 响应：{ code, data: { subtitles: [...] } }
 *
 * @param trackId - 服务端轨道 id
 * @param range - 增量区间（秒）；整段拉取时省略
 * @returns cue 列表；请求失败返回空数组
 */
async function fetchSubtitleCues(
  trackId: string,
  range?: { from: number; to: number },
): Promise<AiSubtitleEntry[]> {
  try {
    const params = new URLSearchParams({ track: trackId });
    if (range) {
      params.set("from", String(Math.max(0, Math.floor(range.from))));
      params.set("to", String(Math.ceil(range.to)));
    }
    const response = await fetch(
      `${MOCK_SERVER_BASE}/api/subtitle/cues?${params.toString()}`,
    );
    if (!response.ok) return [];
    return extractMockCues(await response.json());
  } catch {
    return [];
  }
}

/**
 * 拉取逐帧预览图
 *
 * 接口：GET http://127.0.0.1:9101/videoshot/preview.bin
 * 响应：UTF-8 文本，逐帧 data URL，以 \u001f 分隔。
 *
 * @returns 预览帧数组；请求失败返回空数组
 */
async function fetchPreviewFrames(): Promise<string[]> {
  try {
    const response = await fetch(`${MOCK_SERVER_BASE}/videoshot/preview.bin`);
    if (!response.ok) return [];
    const text = await response.text();
    return text
      .split("\u001f")
      .map((frame) => frame.trim())
      .filter((frame) => frame.startsWith("data:"));
  } catch {
    return [];
  }
}

/**
 * ============================================
 * 预览图模式（雪碧图 ↔ 逐帧 bin）运行期切换
 * ============================================
 * 模式状态与数据拉取分离：
 * - previewMode 是页面级状态（URL `?preview=frames` 定初值，点击切换按钮修改）；
 * - 拉取按模式走对应接口，所选形态不可用时自动回退到另一形态
 *   （回退结果同步到按钮高亮，用户能看出实际生效的是哪条路径）；
 * - 数据源经可变 provider 注入播放器，切换模式不重建播放器实例。
 */

/** 预览图模式：雪碧图（sprite.jpg + pvdata 裁切）或逐帧（preview.bin data URL） */
type PreviewMode = "sprite" | "frames";

/** 预览图拉取结果：source 为最终可用的数据源，effective 为实际生效的形态 */
interface PreviewFetchResult {
  source: DemoPreviewSource | string[] | null;
  effective: PreviewMode | "none";
}

/** 当前预览图模式（URL 参数定初值：`?preview=frames` 强制逐帧，默认雪碧图） */
let previewMode: PreviewMode =
  new URLSearchParams(location.search).get("preview") === "frames"
    ? "frames"
    : "sprite";

/** 可变预览 provider：数据源运行期可替换（模式切换 / 播放器重建共用） */
const previewProviderHandle: MutablePreviewProvider =
  createMutablePreviewProvider(null);

/**
 * 预览资源懒加载状态。
 * 进入页面 / 重建播放器时不请求 /videoshot/*；只有用户实际悬停进度条或
 * 点击预览模式时才加载一次，并按模式缓存，避免重复下载 preview.bin。
 */
let previewLoadPromise: Promise<void> | null = null;
let previewReadyMode: PreviewMode | "none" | null = null;

/** 懒加载预览资源（同一模式只请求一次；force 用于用户点击重试） */
function ensurePreviewLoaded(mode: PreviewMode, force = false): void {
  if (!force) {
    if (previewLoadPromise !== null) return;
    if (previewReadyMode === mode || previewReadyMode === "none") return;
  }
  const requestMode = mode;
  previewLoadPromise = fetchProgressPreview(requestMode)
    .then((result) => {
      previewProviderHandle.setSource(result.source);
      previewReadyMode = result.effective;
      syncPreviewModeButtons(result.effective);
      appEventBus.emit("ACTION_LOG", {
        action:
          result.effective === "none"
            ? "预览图无可用数据（雪碧图未就绪且 preview.bin 为空）"
            : "预览图已加载：" +
              (result.effective === "sprite" ? "雪碧图模式" : "逐帧 bin 模式") +
              (result.effective !== requestMode
                ? "（所选形态不可用，已回退）"
                : ""),
        timestamp: Date.now(),
      });
    })
    .finally(() => {
      previewLoadPromise = null;
    });
}

/** index.json 的 data 载荷（雪碧图切片参数 + 就绪状态，B 站形状） */
interface SpriteIndexData {
  pvdata?: {
    img_url?: string;
    img_x_len?: number;
    img_y_len?: number;
    img_x_size?: number;
    img_y_size?: number;
  };
  index?: number[];
  sprite?: { status?: string };
}

/** 判定是否为 index.json 的 data 载荷（类型谓词窄化，替代 as 断言） */
function isSpriteIndexData(value: unknown): value is SpriteIndexData {
  return typeof value === "object" && value !== null;
}

/**
 * 拉取雪碧图数据源
 *
 * 接口：GET http://127.0.0.1:9101/videoshot/index.json
 * 取 pvdata 的 img_url + img_x_len/img_y_len/img_x_size/img_y_size；
 * 只在服务端确认雪碧图可用（sprite.status === "ready"）时才返回数据源，
 * 否则 img_url 可能指向 404，预览区会整块空白。
 *
 * @returns 雪碧图数据源；不可用返回 null
 */
async function fetchSpritePreviewSource(): Promise<DemoPreviewSource | null> {
  try {
    const response = await fetch(`${MOCK_SERVER_BASE}/videoshot/index.json`);
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("data" in payload) ||
      !isSpriteIndexData(payload.data)
    ) {
      return null;
    }
    const pv = payload.data.pvdata;
    const spriteReady =
      payload.data.sprite?.status === "ready" &&
      pv?.img_url?.includes("sprite") === true;
    if (spriteReady && pv?.img_url && pv.img_x_len && pv.img_y_len) {
      return {
        imgUrl: `${MOCK_SERVER_BASE}${pv.img_url}`,
        imgXLen: pv.img_x_len,
        imgYLen: pv.img_y_len,
        imgXSize: pv.img_x_size,
        imgYSize: pv.img_y_size,
        sliceCount: payload.data.index?.length,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 按模式拉取预览数据源（另一形态自动回退）
 *
 * - sprite 模式：优先雪碧图；雪碧图未就绪时回退逐帧 preview.bin；
 * - frames 模式：优先逐帧 preview.bin；空（mock 未带 --video）时回退雪碧图。
 *
 * @param mode - 想要的预览形态
 * @returns 实际生效的数据源与形态（供按钮高亮同步 / 日志提示）
 */
async function fetchProgressPreview(
  mode: PreviewMode,
): Promise<PreviewFetchResult> {
  // 预览图默认关闭：/videoshot/preview.bin 会触发浏览器下载与 IDM 弹窗。
  // 需要预览时显式改为 false，并自行承担网络开销。
  if (mode === "sprite") {
    const sprite = await fetchSpritePreviewSource();
    if (sprite) return { source: sprite, effective: "sprite" };
    const frames = await fetchPreviewFrames();
    return frames.length > 0
      ? { source: frames, effective: "frames" }
      : { source: null, effective: "none" };
  }

  const frames = await fetchPreviewFrames();
  if (frames.length > 0) return { source: frames, effective: "frames" };
  const sprite = await fetchSpritePreviewSource();
  return sprite
    ? { source: sprite, effective: "sprite" }
    : { source: null, effective: "none" };
}

/**
 * 拉取高能进度条数据
 *
 * 接口：GET http://127.0.0.1:9101/x/player/pbp
 * 响应：{ code, message, data: { step_sec, data: number[], count, duration } }
 *
 * @returns 归一后的高能数据；请求失败返回 null
 */
async function fetchEnergyProgress(): Promise<EnergyProgressData | null> {
  try {
    const response = await fetch(`${MOCK_SERVER_BASE}/x/player/pbp`);
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: unknown };
    return normalizeEnergyProgress(payload.data);
  } catch {
    return null;
  }
}

/**
 * HTML 转义工具
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================
// 步骤1：监听 ACTION_LOG 事件，实时填充事件日志
// ============================================

let logCount = 0;

appEventBus.on("ACTION_LOG", (data) => {
  const logContent = document.querySelector(".log-content");
  if (logContent) {
    const entry = document.createElement("div");
    entry.className = "log-entry";
    const time = new Date(data.timestamp).toLocaleTimeString("zh-CN", {
      hour12: false,
    });
    entry.innerHTML =
      '<span class="time">[' +
      time +
      "]</span>" +
      '<span class="msg">' +
      escapeHtml(data.action) +
      "</span>";
    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;

    logCount++;
    if (logCount > 200 && logContent.firstChild) {
      logContent.removeChild(logContent.firstChild);
      logCount--;
    }

    updateLogCount();
  }
});

function updateLogCount(): void {
  const allSpans = document.querySelectorAll(".event-log span");
  for (const span of allSpans) {
    if (span.textContent && span.textContent.includes("条")) {
      span.textContent = logCount + " 条";
      break;
    }
  }
}

// ============================================
// 步骤2：执行水合
// ============================================

const root = document.getElementById("root");

if (root) {
  try {
    // 创建与服务端相同的 VNode 树
    // PlayerSection 内部会创建 VideoPlayer 实例并调用 render()
    // 返回的 VNode 树包含完整播放器 UI 结构
    // 水合前应用 URL 参数：用于服务端渲染 / 客户端水合的多格式测试
    const querySrc = new URLSearchParams(location.search).get("src");
    if (querySrc) {
      DEMO_SSR_PLAYER_CONFIG.src = querySrc;
    }

    // 水合前挂上预览 provider：DOM 结构不变，只影响进度条悬停预览
    const initialSegments = await fetchProgressSegments();
    if (demoSegments.length === 0) demoSegments = initialSegments;
    const initialEnergy = await fetchEnergyProgress();
    const initialPreview = await fetchProgressPreview(previewMode);
    previewProviderHandle.setSource(initialPreview.source);
    previewReadyMode = initialPreview.effective;
    DEMO_SSR_PLAYER_CONFIG.progress = {
      ...(DEMO_SSR_PLAYER_CONFIG.progress ?? {}),
      segments: initialSegments,
      energyProvider: () => initialEnergy,
      previewProvider: (time: number, duration: number) => {
        ensurePreviewLoaded(previewMode);
        return previewProviderHandle.provider(time, duration);
      },
    };
    const vnode = RootLayout({});
    const isSSR = root.firstElementChild !== null;

    // SSR 页面执行水合；纯客户端页面直接 mount
    // hydrate() 会：
    // 1. 遍历 VNode 树，匹配已有 DOM 元素
    // 2. 绑定 ref（videoRef, playerDockerRef 等）
    // 3. 调用 onMounted 生命周期
    //    - PlayerDocker.onMounted → initVideo() + initEvent()
    //    - VideoPlayer 通过回调获取 DOM 引用，绑定视频事件
    if (isSSR) hydrate(vnode, root);
    else mount(vnode, root);

    // 更新徽章状态
    updateBadgeToHydrated(isSSR ? "Hydrated" : "CSR Mounted");

    // PlayerSection 在 SSR / hydration 阶段创建的播放器实例
    const ssrPlayer = (window as unknown as { __ssrPlayer?: VideoPlayer })
      .__ssrPlayer;
    if (ssrPlayer && !playerInstance) setPlayerInstance(ssrPlayer);

    // playerInstance 由 PlayerSection 组件创建，水合后应已就绪
    if (playerInstance) {
      // 监听播放器关键事件并写入日志
      const playerEvents = [
        "ready",
        "play",
        "pause",
        "ended",
        "error",
        "destroy",
      ];
      playerEvents.forEach((evt) => {
        try {
          (
            playerInstance as unknown as {
              on: (e: string, cb: (...args: unknown[]) => void) => void;
            }
          ).on(evt, (...args: unknown[]) => {
            appEventBus.emit("ACTION_LOG", {
              action:
                "Player:" +
                evt +
                (args.length ? " " + JSON.stringify(args[0]).slice(0, 80) : ""),
              timestamp: Date.now(),
            });
          });
        } catch {
          // 忽略不支持的事件
        }
      });

      setTimeout(() => attachAllPlayerEvents(playerInstance!), 0);

      // 暴露到全局便于调试
      (window as unknown as { player: VideoPlayer }).player = playerInstance;

      // 订阅语言变化（subscribeLocale）：localeSignal 为全局单例，
      // 与播放器实例生命周期无关，此处订阅一次即可覆盖后续所有切换
      playerInstance.subscribeLocale((locale) => {
        appEventBus.emit("ACTION_LOG", {
          action: "subscribeLocale 回调: locale → " + locale,
          timestamp: Date.now(),
        });
      });

      appEventBus.emit("ACTION_LOG", {
        action: "VideoPlayer SSR 水合完成（无需客户端挂载）",
        timestamp: Date.now(),
      });
    }
  } catch (e) {
    console.error("[Hydration Error]", e);
    updateBadgeToFailed(e instanceof Error ? e.message : String(e));
  }
} else {
  updateBadgeToFailed("#root 元素未找到");
}

// ============================================
// 步骤3：「切换视频源」「销毁播放器」按钮事件
// ============================================

/**
 * 渲染「播放器已销毁」占位内容
 *
 * 全部用 DOM API 构建，不再用 innerHTML 清空 / 覆盖容器：
 * 容器清理由 VideoPlayer.destroy() 移除自己的根节点完成。
 * @param wrapper - 播放器容器
 */
function renderDestroyedPlaceholder(wrapper: HTMLElement): void {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const box = document.createElement("div");
  box.className = "player-destroyed-placeholder";
  box.setAttribute(
    "style",
    "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:rgba(255,255,255,0.4);font-size:13px;",
  );

  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("width", "48");
  icon.setAttribute("height", "48");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "rgba(255,255,255,0.3)");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");

  const polygon = document.createElementNS(SVG_NS, "polygon");
  polygon.setAttribute("points", "23 7 16 12 23 17 23 7");
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "1");
  rect.setAttribute("y", "5");
  rect.setAttribute("width", "15");
  rect.setAttribute("height", "14");
  rect.setAttribute("rx", "2");
  rect.setAttribute("ry", "2");
  icon.appendChild(polygon);
  icon.appendChild(rect);

  const text = document.createElement("span");
  text.textContent = "播放器已销毁";

  box.appendChild(icon);
  box.appendChild(text);
  wrapper.appendChild(box);
}

/** 向事件日志面板追加一条记录（统一 ACTION_LOG 通道） */
function logAction(action: string): void {
  appEventBus.emit("ACTION_LOG", { action, timestamp: Date.now() });
}

/** 抓取交互插件当前数据快照（播放器销毁 / 卸载插件前调用，编辑改动保留） */
function snapshotInteraction(): void {
  const api = playerInstance?.getPlugin<InteractionPluginAPI>("interaction");
  if (api) {
    interactionSnapshot = api.getStatus();
  }
}

/**
 * 销毁当前播放器实例
 *
 * 只调用播放器公开的销毁 API（`VideoPlayer.destroy()`）：组件树卸载、
 * 插件与流中间件销毁、媒体断开、根节点移除全部由播放器内部按序完成，
 * demo 侧不再直接操作播放器 DOM。
 */
function destroyCurrentPlayer(): void {
  // 销毁前抓取交互数据快照：编辑模式新增的卡片 / 拖拽后的位置
  // 随快照保留，切换源 / 重建播放器后经 collectPlugins 注回新实例
  snapshotInteraction();
  if (playerInstance) {
    try {
      playerInstance.destroy();
    } catch {
      // 忽略销毁错误
    }
    setPlayerInstance(null);

    const wrapper = document.getElementById("player-wrapper");
    if (wrapper) {
      // destroy() 已移除播放器根节点；这里只兜底清掉残余子节点（SSR 首屏内容）
      while (wrapper.firstChild) {
        wrapper.removeChild(wrapper.firstChild);
      }
      renderDestroyedPlaceholder(wrapper);
    }

    appEventBus.emit("ACTION_LOG", {
      action: "VideoPlayer 已销毁",
      timestamp: Date.now(),
    });
    // 播放器销毁后同步交互 UI：模式按钮态保持，内容面板刷新为「未注册」提示
    syncInteractionUi();
  }
}

// 绑定按钮事件
const btnDestroyPlayer = document.getElementById("btn-destroy-player");
if (btnDestroyPlayer) {
  btnDestroyPlayer.addEventListener("click", destroyCurrentPlayer);
}

// ============================================
// 语言切换按钮（测试 i18n 动态切换）
// ============================================

/**
 * ja-JP 演示语言包（运行期 registerLocale 注册）
 *
 * 内置语言包仅含 zh-CN / en-US，日本语走「点击时注册 → 切换」流程，
 * 覆盖少量常见 key 演示能力；未覆盖 key 按 fallback 链回落到 en-US。
 */
const JA_MESSAGES: Record<string, string> = {
  "player.ui.controls.play": "再生",
  "player.ui.controls.pause": "一時停止",
  "player.ui.controls.mute": "ミュート",
  "player.ui.controls.fullscreen": "全画面",
  "player.ui.controls.widescreen": "ワイド",
  "player.ui.controls.webFullscreen": "ページ全画面",
  "player.ui.controls.pip": "ピクチャーインピクチャー",
  "player.ui.settings.title": "設定",
  "player.ui.settings.autostart": "自動再生",
  "player.ui.settings.subtitle": "字幕",
  "player.ui.settings.danmaku": "コメント",
  "player.ui.sendbar.placeholder": "コメントを送信…",
  "player.ui.sendbar.send": "送信",
  "player.ui.videoinfo.title": "動画情報",
  "player.ui.state.buffering": "バッファリング中…",
};

/**
 * 语言切换按钮到语言代码的映射
 *
 * 按钮为 SSR 静态输出，点击时由播放器公开的 setLocale API 切换语言；
 * 切换后所有 t() 文案经编译期 _reactiveText 包装精准更新 DOM
 * （无需重建播放器，控制栏/设置面板/提示等全量跟随）。
 * ja-JP 非内置语言：点击时先 registerLocale 注册语言包再切换。
 */
const LOCALE_BUTTONS: ReadonlyMap<string, string> = new Map([
  ["btn-locale-zh", "zh-CN"],
  ["btn-locale-en", "en-US"],
  ["btn-locale-ja", "ja-JP"],
]);

for (const [buttonId, locale] of LOCALE_BUTTONS) {
  const button = document.getElementById(buttonId);
  if (!button) continue;
  button.addEventListener("click", () => {
    if (!playerInstance) {
      appEventBus.emit("ACTION_LOG", {
        action: "No player instance, cannot switch locale",
        timestamp: Date.now(),
      });
      return;
    }
    // 运行期注册语言包演示：日本语包非内置，切换前先注册
    if (locale === "ja-JP") {
      playerInstance.registerLocale("ja-JP", JA_MESSAGES);
    }
    playerInstance.setLocale(locale);
    // 同步按钮高亮态：当前语言的按钮标记 active
    for (const [otherId] of LOCALE_BUTTONS) {
      const other = document.getElementById(otherId);
      if (other) other.classList.toggle("active", otherId === buttonId);
    }
    appEventBus.emit("ACTION_LOG", {
      action: "Locale switched to " + locale,
      timestamp: Date.now(),
    });
  });
}

const MEDIA_LIST: MediaItem[] = [
  { src: "/sample.mp4", title: "赶集买了几只牛蛙，好久没吃了，立马安排..." },
];
const OBJECT_URLS: string[] = [];

/** 片尾卡片模拟封面（本地 SVG Data URI，避免依赖网络） */
const demoPic = (label: string, from: string, to: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><text x="50%" y="50%" fill="#fff" font-size="20" font-family="sans-serif" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`,
  )}`;

const DEMO_COVER = demoPic("示例视频", "#00b4d8", "#1a1a2e");

/** 互动视频片尾：回溯节点模拟数据 */
const DEMO_BACKTRACK = [
  { title: "开场", pic: demoPic("回溯 01", "#00b4d8", "#0f172a") },
  { title: "第一次选择", pic: demoPic("回溯 02", "#7c3aed", "#1a1a2e") },
  { title: "关键分支", pic: demoPic("回溯 03", "#fb7299", "#111827") },
  { title: "隐藏剧情", pic: demoPic("回溯 04", "#f59e0b", "#1f2937") },
  { title: "真结局", pic: demoPic("回溯 05", "#10b981", "#0f172a") },
  { title: "彩蛋", pic: demoPic("回溯 06", "#ef4444", "#1a1a2e") },
];

const DEMO_RELATED = [
  {
    title: "模拟推荐 01",
    pic: demoPic("推荐 01", "#fb7299", "#1a1a2e"),
    duration: 128,
    url: "https://www.bilibili.com/",
  },
  {
    title: "模拟推荐 02",
    pic: demoPic("推荐 02", "#00b4d8", "#22223b"),
    duration: "03:20",
    url: "https://www.bilibili.com/",
  },
  {
    title: "模拟推荐 03",
    pic: demoPic("推荐 03", "#7c3aed", "#111827"),
    duration: 245,
    url: "https://www.bilibili.com/",
  },
  {
    title: "模拟推荐 04",
    pic: demoPic("推荐 04", "#f59e0b", "#1f2937"),
    duration: "02:08",
    url: "https://www.bilibili.com/",
  },
  {
    title: "模拟推荐 05",
    pic: demoPic("推荐 05", "#10b981", "#111827"),
    duration: "06:34",
    url: "https://www.bilibili.com/",
  },
  {
    title: "模拟推荐 06",
    pic: demoPic("推荐 06", "#ef4444", "#1f2937"),
    duration: "00:16",
    url: "https://www.bilibili.com/",
  },
  {
    title: "模拟推荐 07",
    pic: demoPic("推荐 07", "#3b82f6", "#0f172a"),
    duration: "04:15",
    url: "https://www.bilibili.com/",
  },
  {
    title: "模拟推荐 08",
    pic: demoPic("推荐 08", "#a855f7", "#1a1a2e"),
    duration: "06:08",
    url: "https://www.bilibili.com/",
  },
];

/** 外链尾页 5×2 推荐卡片（10 条独立模拟数据） */
const DEMO_EMBEDDED_RELATED = [
  {
    title: "外链推荐 01",
    pic: demoPic("外链 01", "#fb7299", "#111827"),
    duration: "12:08",
    url: "https://www.bilibili.com/",
  },
  {
    title: "外链推荐 02",
    pic: demoPic("外链 02", "#00b4d8", "#1f2937"),
    duration: "08:42",
    url: "https://www.bilibili.com/",
  },
  {
    title: "外链推荐 03",
    pic: demoPic("外链 03", "#7c3aed", "#0f172a"),
    duration: "05:16",
    url: "https://www.bilibili.com/",
  },
  {
    title: "外链推荐 04",
    pic: demoPic("外链 04", "#f59e0b", "#1a1a2e"),
    duration: "21:30",
    url: "https://www.bilibili.com/",
  },
  {
    title: "外链推荐 05",
    pic: demoPic("外链 05", "#10b981", "#111827"),
    duration: "03:55",
    url: "https://www.bilibili.com/",
  },
  {
    title: "外链推荐 06",
    pic: demoPic("外链 06", "#ef4444", "#1f2937"),
    duration: "16:24",
    url: "https://www.bilibili.com/",
  },
  {
    title: "外链推荐 07",
    pic: demoPic("外链 07", "#3b82f6", "#0f172a"),
    duration: "09:12",
    url: "https://www.bilibili.com/",
  },
  {
    title: "外链推荐 08",
    pic: demoPic("外链 08", "#a855f7", "#1a1a2e"),
    duration: "27:06",
    url: "https://www.bilibili.com/",
  },
  {
    title: "外链推荐 09",
    pic: demoPic("外链 09", "#eab308", "#111827"),
    duration: "06:48",
    url: "https://www.bilibili.com/",
  },
  {
    title: "外链推荐 10",
    pic: demoPic("外链 10", "#14b8a6", "#1f2937"),
    duration: "11:36",
    url: "https://www.bilibili.com/",
  },
];

// ============================================
// 预览图模式切换按钮（雪碧图 ↔ 逐帧 bin）
// ============================================

/** 预览模式按钮 id → 模式值映射（按钮为 SSR 静态输出，水合后绑定事件） */
const PREVIEW_MODE_BUTTONS: ReadonlyMap<string, PreviewMode> = new Map([
  ["btn-preview-sprite", "sprite"],
  ["btn-preview-frames", "frames"],
]);

/**
 * 同步预览模式按钮高亮态
 *
 * @param effective - 实际生效的形态（拉取回退后可能不同于所选模式）；"none" 时全部熄灭
 */
function syncPreviewModeButtons(effective: PreviewMode | "none"): void {
  for (const [buttonId, mode] of PREVIEW_MODE_BUTTONS) {
    const button = document.getElementById(buttonId);
    if (button) button.classList.toggle("active", mode === effective);
  }
}

// 水合后先按所选模式同步一次高亮（纠正 SSR 的默认输出；
// 拉取完成 / 播放器重建后由 effective 再纠正回退场景）
syncPreviewModeButtons(previewMode);

for (const [buttonId, mode] of PREVIEW_MODE_BUTTONS) {
  const button = document.getElementById(buttonId);
  if (!button) continue;
  button.addEventListener("click", () => {
    previewMode = mode;
    // 用户主动切换 / 重试时才加载，避免页面加载即下载 videoshot 资源
    void fetchProgressPreview(mode).then((result) => {
      previewProviderHandle.setSource(result.source);
      previewReadyMode = result.effective;
      syncPreviewModeButtons(result.effective);
    });
  });
}

// ============================================
// 交互卡片：展示 / 编辑双模式状态与配置组装
// ============================================

/**
 * 初始交互卡片数据
 *
 * 覆盖 guide（三连+关注）/ link / vote / score / scoreSum 五类卡片各 1 条；
 * 左下角缩小条目上线后一次只能存在一张卡片，各时间窗互斥不重叠：
 * 2-10 引导 → 12-20 外链 → 22-30 投票 → 32-40 评分 → 42-52 评分总结，
 * 作为模式切换与播放器重建的数据快照初值。
 */
const INITIAL_INTERACTION_DATA: InteractionCard = {
  guideList: [{ type: 1, top: 30, left: 50, timeStart: 2, timeEnd: 10 }],
  linkList: [
    {
      top: 60,
      left: 30,
      linkContent: "Demo external video",
      timeStart: 12,
      timeEnd: 20,
      isClose: true,
    },
  ],
  voteList: [
    {
      top: 45,
      left: 70,
      question: "Pick one",
      options: [{ optionText: "Option A" }, { optionText: "Option B" }],
      timeStart: 22,
      timeEnd: 30,
      isClose: true,
    },
  ],
  scoreList: [
    {
      top: 25,
      left: 75,
      title: "Rate it",
      scoreType: 1,
      timeStart: 32,
      timeEnd: 40,
      isClose: true,
    },
  ],
  scoreSumList: [
    {
      top: 40,
      left: 60,
      timeStart: 42,
      timeEnd: 52,
      isClose: true,
    },
  ],
};

// 当前交互模式：mode 为插件构造期配置，运行期切换 =
// 卸载旧实例 + 携带数据快照重建（见 setInteractionMode）
let interactionMode: InteractionPluginMode = "interactive";

// 数据快照：卸载/销毁插件前经 getStatus() 抓取（浅拷贝但数组引用相同，
// 编辑模式新增卡片 / 拖拽落点自动随快照带出，跨切换与跨播放器重建不丢失）
let interactionSnapshot: InteractionCard = INITIAL_INTERACTION_DATA;

/**
 * 按当前模式组装交互插件配置
 *
 * - 展示模式（interactive）：注册全部业务回调
 *   （点赞 / 投币 / 收藏 / 关注 / 跳链 / 投票 / 评分 / 关闭），
 *   卡片由时间窗口驱动显隐
 * - 编辑模式（edit）：仅注册位置回调（拖拽落点回传），
 *   点击类监听一律不注册，卡片常驻显示供拖拽定位
 */
const makeInteractionConfig = (): InteractionPluginConfig => {
  const config: InteractionPluginConfig = {
    mode: interactionMode,
    data: interactionSnapshot,
  };
  if (interactionMode === "edit") {
    config.onPositionChange = (event) =>
      logAction(
        `位置变更 (onPositionChange): ${event.type}#${event.index} → top ${event.top}% / left ${event.left}%`,
      );
    return config;
  }
  config.onLike = () => logAction("交互回调 (onLike): 点赞");
  config.onCoin = () => logAction("交互回调 (onCoin): 投币");
  config.onCollect = () => logAction("交互回调 (onCollect): 收藏");
  config.onFollow = () => logAction("交互回调 (onFollow): 关注");
  config.onLinkClick = (link) =>
    logAction(`交互回调 (onLinkClick): ${link.linkContent ?? "(无文案)"}`);
  config.onVoteSelect = (voteIndex, optionIndex) =>
    logAction(`交互回调 (onVoteSelect): 投票#${voteIndex} 选项#${optionIndex}`);
  config.onScoreSelect = (scoreIndex, value) =>
    logAction(`交互回调 (onScoreSelect): 评分#${scoreIndex} 值 ${value}`);
  config.onCardClose = (type, index) =>
    logAction(`交互回调 (onCardClose): ${type}#${index}`);
  return config;
};

// ==================== 互动视频（华强买瓜）====================
// 数据链路（对齐 B 站互动视频标准做法）：
//   1. GET /api/interactive/story → 剧情树（88 节点，节点只带 avid 引用）
//   2. 起始节点播放源经 /api/interactive/playurl 解析，作为播放列表条目
//      的 src 起播（播放器按 URL 后缀 / 清单对象自动分发 HLS/DASH 插件）
//   3. 分支切换由互动视频插件驱动：switchToNode → resolveVideo 回调
//      → playurl 接口按（avid + 协议 + 格式）按需解析（插件内按 avid 缓存）
// playurl 的两种返回格式：
//   - format=url  → data.playUrl 是 MinIO 上的 index.m3u8 / index.mpd 地址
//   - format=json → data.manifest 是 SegmentBase 单文件模式清单对象，
//     直接喂给播放器即可播放（对象注入模式，零网络清单请求）

/** 互动视频协议选择（HLS / DASH，按钮切换） */
let hqProtocol: "hls" | "dash" = "hls";

/** 互动视频 playurl 格式选择（URL / JSON，按钮切换） */
let hqFormat: "url" | "json" = "url";

/**
 * 互动视频插件配置（拉取剧情树后写入；rebuildPlayer → collectPlugins
 * 读取非空时把互动视频插件挂进新播放器实例）
 */
let interactiveVideoConfig: InteractiveVideoPluginConfig | null = null;

/** 剧情树接口响应 data 的节点形状（与 InteractiveNode 对齐，cover 已由服务端补全为完整 URL） */
interface HuaqiangStoryNode {
  id: string;
  avid: string;
  title: string;
  cover: string;
  duration: number;
  question?: InteractiveNode["question"];
}

/** 剧情树接口响应 data 形状 */
interface HuaqiangStoryData {
  interactiveId: string;
  title: string;
  desc: string;
  version: number;
  startNodeId: string;
  autoPlay: boolean;
  nodes: Record<string, HuaqiangStoryNode>;
}

/** playurl 接口响应 data 形状（format=json 时 manifest 为清单对象） */
interface HuaqiangPlayUrlData {
  avid: string;
  protocol: string;
  format: string;
  playUrl: string;
  manifest?: MediaManifestSource;
  /** 清晰度表（每清晰度一个 representation id，展示用） */
  qualities?: Array<{ id: string | number; text: string; height: number }>;
}

/** 写互动视频状态行（剧情树加载进度 / 生效组合 / 接口报错信息） */
function setHuaqiangStatus(text: string): void {
  const el = document.getElementById("hq-status");
  if (el) el.textContent = text;
}

/** 同步协议 / 格式按钮选中态高亮（mode-active 与交互卡片模式按钮同风格） */
function syncHuaqiangButtons(): void {
  const pairs: Array<[string, boolean]> = [
    ["btn-hq-protocol-hls", hqProtocol === "hls"],
    ["btn-hq-protocol-dash", hqProtocol === "dash"],
    ["btn-hq-format-url", hqFormat === "url"],
    ["btn-hq-format-json", hqFormat === "json"],
  ];
  pairs.forEach(([id, active]) => {
    document.getElementById(id)?.classList.toggle("mode-active", active);
  });
  setHuaqiangStatus(
    `当前组合：${hqProtocol.toUpperCase()} × ${hqFormat.toUpperCase()}` +
      `（${hqFormat === "json" ? "清单对象直接注入播放器" : "m3u8/mpd 地址播放"}）`,
  );
}

/**
 * 拉取剧情树（mock-server /api/interactive/story）
 *
 * @returns 剧情树 data（88 节点 + 起始节点 id）
 */
async function fetchHuaqiangStory(): Promise<HuaqiangStoryData> {
  const response = await fetch(
    `${MOCK_SERVER_BASE}/api/interactive/story?interactiveId=huaqiang`,
  );
  const payload = (await response.json()) as {
    code: number;
    message: string;
    data?: HuaqiangStoryData;
  };
  if (payload.code !== 0 || !payload.data) {
    throw new Error(payload.message || `HTTP ${response.status}`);
  }
  return payload.data;
}

/**
 * playurl 解析器（互动视频插件 resolveVideo 回调）：
 * 按节点 avid + 当前协议 / 格式选择请求 /api/interactive/playurl
 * - format=url  → 返回 m3u8 / mpd 地址（字符串源）
 * - format=json → 返回 SegmentBase 清单对象（对象注入模式）
 *
 * @param node - 分支目标节点（带 avid 引用）
 * @returns 可直接交给 player.load 的播放源
 */
async function resolveHuaqiangVideo(
  node: InteractiveNode,
): Promise<PlayerSource> {
  const avid = node.avid ?? "";
  const params = new URLSearchParams({
    avid,
    protocol: hqProtocol,
    format: hqFormat,
  });
  const response = await fetch(
    `${MOCK_SERVER_BASE}/api/interactive/playurl?${params.toString()}`,
  );
  const payload = (await response.json()) as {
    code: number;
    message: string;
    data?: HuaqiangPlayUrlData;
  };
  if (payload.code !== 0 || !payload.data) {
    throw new Error(
      `avid=${avid} playurl 解析失败：${payload.message || `HTTP ${response.status}`}`,
    );
  }
  if (hqFormat === "json") {
    if (!payload.data.manifest) {
      throw new Error(`avid=${avid} playurl 未返回清单对象`);
    }
    logAction(
      `互动分支 playurl(json·${hqProtocol}): ${payload.data.qualities?.length ?? 0} 档清晰度`,
    );
    return payload.data.manifest;
  }
  logAction(`互动分支 playurl(url·${hqProtocol}): ${payload.data.playUrl}`);
  return payload.data.playUrl;
}

/**
 * 播放互动视频（协议 × 格式组合生效）：
 * 拉剧情树 → 组装插件配置（resolveVideo 闭包捕获当前组合）→ 解析起始
 * 节点播放源 → 加入播放列表并重建播放器（collectPlugins 挂互动插件）
 */
async function playHuaqiangInteractive(): Promise<void> {
  try {
    setHuaqiangStatus("正在拉取剧情树…");
    const story = await fetchHuaqiangStory();

    // 组装互动视频插件配置：节点带 avid 引用，分支切换按需解析播放地址；
    // 缓存由插件内部按 avid 记账（同一节点回看不重复请求 playurl）
    interactiveVideoConfig = {
      nodes: story.nodes,
      startNodeId: story.startNodeId,
      autoPlay: true,
      resolveVideo: resolveHuaqiangVideo,
      onOptionSelect: (nodeId, index) => {
        const node = story.nodes[nodeId];
        logAction(
          `互动分支选择: ${node?.title ?? nodeId} → ${story.nodes[node.question?.options[index]?.targetNodeId ?? ""]?.title ?? "?"}`,
        );
      },
    };

    // 起始节点播放源先解析一次，作为播放列表条目的 src 起播
    //（播放器按 URL 后缀 / 清单对象内容自动分发 HLS/DASH 插件）
    const startNode = story.nodes[story.startNodeId];
    if (!startNode) {
      throw new Error(`剧情树缺少起始节点 ${story.startNodeId}`);
    }
    setHuaqiangStatus(
      `剧情树就绪（${Object.keys(story.nodes).length} 节点），正在解析起始节点播放源…`,
    );
    const startSource = await resolveHuaqiangVideo(startNode);

    // 加入播放列表并重建播放器（rebuildPlayer → collectPlugins 读取
    // interactiveVideoConfig 挂载互动视频插件）
    MEDIA_LIST.push({
      title: `互动视频 · ${story.title}（${hqProtocol.toUpperCase()}×${hqFormat.toUpperCase()}）`,
      src: startSource,
    });
    renderSourceList();
    await rebuildPlayer(MEDIA_LIST.length - 1);

    setHuaqiangStatus(
      `正在播放互动视频「${story.title}」：${Object.keys(story.nodes).length} 节点 · ` +
        `${hqProtocol.toUpperCase()} × ${hqFormat.toUpperCase()}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setHuaqiangStatus(`互动视频加载失败：${msg}`);
    logAction(`互动视频加载失败: ${msg}`);
  }
}

let demoTopStyle: "default" | "tv" | "music" = "default";
let demoEndingStyle: "standard" | "ogv" | "interactive" = "standard";
let demoScene: "station" | "embedded" = "station";

/** Top 数据由插件持有，播放器 ui 不再承载 */
function createTopPlugin(source?: PlayerSource): Plugin {
  return TopPlugin({
    data: {
      title:
        (source as unknown as { title?: string } | undefined)?.title ??
        "Lumina Demo",
      musicTitle: "发现《雨爱》",
      followed: false,
      upName: "模拟 UP 主",
      avatar: demoPic("UP", "#00b4d8", "#1a1a2e"),
    },
  });
}

/** Ending 数据由插件持有，播放器 ui 不再承载 */
function createEndingPlugin(source?: PlayerSource): Plugin {
  const title =
    (source as unknown as { title?: string } | undefined)?.title ??
    "Lumina Demo";
  if (demoScene === "embedded") {
    return EndingPlugin({
      data: {
        title,
        related: DEMO_EMBEDDED_RELATED,
        upInfo: {
          name: "小梅vlog",
          face: demoPic("UP", "#00b4d8", "#1a1a2e"),
          followed: true,
        },
        likeCount: 3537,
        shareCount: 19,
      },
    });
  }
  if (demoEndingStyle === "interactive") {
    return EndingPlugin({
      data: {
        title,
        followers: "6.3万",
        backtrack: DEMO_BACKTRACK,
        activeBacktrackIndex: 2,
        upInfo: {
          name: "模拟 UP 主",
          face: demoPic("UP", "#00b4d8", "#1a1a2e"),
          followed: false,
        },
      },
    });
  }
  if (demoEndingStyle === "ogv") {
    return EndingPlugin({
      data: {
        title,
        related: DEMO_RELATED,
        cover: DEMO_COVER,
        followed: false,
        upInfo: {
          name: "模拟 UP 主",
          face: demoPic("UP", "#00b4d8", "#1a1a2e"),
          followed: false,
        },
      },
    });
  }
  return EndingPlugin({
    data: {
      title,
      related: DEMO_RELATED,
      upInfo: {
        name: "模拟 UP 主",
        face: demoPic("UP", "#00b4d8", "#1a1a2e"),
        followed: false,
      },
    },
  });
}

function collectPlugins(source?: PlayerSource): Plugin[] {
  // 模式 B 当前激活的服务端轨 id（activateTrack 写入，fetch 读取）
  let activeRemoteTrack = "zh-ai";
  const list: Plugin[] = [
    createTopPlugin(source),
    createEndingPlugin(source),
    // 弹幕插件：Tip 操作回调接线 + 本地发送汇入页面弹幕列表
    // （onSendSuccess 对本地直发与服务端确认两条链路均触发）
    DanmakuPlugin({
      source: {
        // 弹幕数据由插件自己持有，播放器不再提供 danmaku 配置入口
        provider: (startTime, endTime) =>
          danmakuPanelList.filter(
            (item) => item.time >= startTime && item.time < endTime,
          ),
      },
      callbacks: {
        onSendSuccess: (danmaku) => {
          appendDanmakuToList(danmaku);
          logAction(`弹幕发送成功: ${danmaku.text}`);
        },
        onDanmakuLike: (danmaku, liked) => {
          logAction(
            `弹幕回调 (onDanmakuLike): ${liked ? "点赞" : "取消点赞"} - ${danmaku.text}`,
          );
        },
        onDanmakuCopy: (danmaku) => {
          logAction(`弹幕回调 (onDanmakuCopy): ${danmaku.text}`);
        },
        onDanmakuRecall: (danmaku) => {
          logAction(`弹幕回调 (onDanmakuRecall): ${danmaku.text}`);
        },
        onDanmakuReport: (danmaku) => {
          logAction(`弹幕回调 (onDanmakuReport): ${danmaku.text}`);
        },
      },
    }),
    // 字幕插件：双模式演示
    // - 模式 A（localAi）：sherpa-onnx 真实流式引擎跑通「采集→VAD→ASR→字幕」
    //   全链路（重计算全在 ASR 专用 Worker，模型加载零主线程阻塞），
    //   播放中实时产出灰显 partial 与 final 字幕，菜单出现「实时识别」轨；
    //   资源位于 demo/public/asr（缺省 /asr/wasm、/asr/models/zh-14m）
    // - 模式 B（remoteProvider）：mock-server 提供多轨（原文 + 翻译）与增量拉取
    SubtitlePlugin({
      localAi: {
        engineKind: "sherpa",
        defaultLang: "zh",
      },
      remoteProvider: {
        type: "remote",
        incremental: true,
        listTracks: fetchSubtitleTracks,
        activateTrack: async (trackId: string): Promise<void> => {
          activeRemoteTrack = trackId;
        },
        fetch: (range?: { from: number; to: number }) =>
          fetchSubtitleCues(activeRemoteTrack, range),
      },
    }),
    // 交互插件：双模式配置由 makeInteractionConfig 组装
    // （展示模式注册全部业务回调 / 编辑模式仅注册位置回调），
    // 数据快照跨模式切换与跨播放器重建保留；
    // install 时运行时注入插件样式（style[data-lumina-plugin="interaction"]），
    // 与播放器样式包彻底解耦
    InteractionPlugin(makeInteractionConfig()),
    // 音效插件：Web Audio 音效链（EQ / 混响 / A3D / 电话 / 压缩器），
    // 订阅 MOUNTED 事件待 video 元素就绪后构建 AudioContext，
    // 运行时 API 经 getPluginAPI("audioEffect") 获取
    AudioEffectPlugin(),
  ];
  // 互动视频插件：剧情树已拉取时挂载（华强买瓜 demo）。节点带 avid 引用，
  // 分支切换由插件经 resolveVideo → playurl 接口按需解析播放地址
  if (interactiveVideoConfig) {
    list.push(InteractiveVideoPlugin(interactiveVideoConfig));
  }
  const text =
    typeof source === "string" ? source : JSON.stringify(source ?? "");
  if (/\.m3u8(\?|$)/i.test(text)) {
    list.unshift(createHlsPlugin({ autoplay: false }));
  } else if (/\.mpd(\?|$)/i.test(text)) {
    list.unshift(createDashPlugin({ autoplay: false }));
  } else if (/\.json(\?|$)/i.test(text) || typeof source !== "string") {
    list.unshift(createDashPlugin({ autoplay: false }));
    list.unshift(createHlsPlugin({ autoplay: false }));
  }
  return list;
}

function parseSource(text: string): PlayerSource | null {
  const value = text.trim();
  if (!value) return null;
  if (value.startsWith("{") || value.startsWith("[")) {
    try {
      return JSON.parse(value) as unknown as PlayerSource;
    } catch {
      return null;
    }
  }
  return value;
}

function sourceKind(item: MediaItem): string {
  const src = item.src;
  if (typeof src === "string") {
    if (src.startsWith("blob:")) return "本地";
    if (/\.mpd(\?|$)/i.test(src)) return "DASH";
    if (/\.m3u8(\?|$)/i.test(src)) return "HLS";
    if (/\.json(\?|$)/i.test(src)) return "JSON";
    return "MP4";
  }
  if (Array.isArray(src)) return "MP4";
  const text = JSON.stringify(src).slice(0, 2000);
  if (/mpd|SegmentTemplate|Period/i.test(text)) return "DASH";
  if (/m3u8|EXT-X|playlist/i.test(text)) return "HLS";
  return "JSON";
}

function sourceTitle(item: MediaItem, index: number): string {
  if (item.title) return `${index + 1}. ${item.title}`;
  if (typeof item.src === "string")
    return `${index + 1}. ${item.src.slice(0, 64)}`;
  return `${index + 1}. JSON 视频源`;
}

function removeSourceAt(index: number): void {
  const removed = MEDIA_LIST[index];
  if (!removed) return;
  const current = playerInstance?.getCurrentIndex() ?? 0;
  const wasCurrent = current === index;
  if (typeof removed.src === "string" && removed.src.startsWith("blob:")) {
    URL.revokeObjectURL(removed.src);
    const urlIndex = OBJECT_URLS.indexOf(removed.src);
    if (urlIndex >= 0) OBJECT_URLS.splice(urlIndex, 1);
  }
  MEDIA_LIST.splice(index, 1);
  if (MEDIA_LIST.length === 0) {
    destroyCurrentPlayer();
    renderSourceList();
    return;
  }
  if (wasCurrent) {
    syncPlayerSource(Math.min(index, MEDIA_LIST.length - 1));
    return;
  }
  if (index < current) {
    syncPlayerSource(current - 1);
    return;
  }
  playerInstance?.setConfig({ playlist: MEDIA_LIST });
  renderSourceList();
}

function renderSourceList(): void {
  const list = document.getElementById("source-list");
  if (!list) return;
  list.innerHTML = "";
  if (MEDIA_LIST.length === 0) {
    const empty = document.createElement("li");
    empty.className = "source-empty";
    empty.textContent = "暂无来源";
    list.appendChild(empty);
    return;
  }
  const current = playerInstance?.getCurrentIndex() ?? 0;
  MEDIA_LIST.forEach((item, index) => {
    const li = document.createElement("li");
    li.className =
      index === current ? "source-item player-state-active" : "source-item";
    li.dataset.index = String(index);

    const main = document.createElement("span");
    main.className = "source-item-main";

    const title = document.createElement("span");
    title.className = "source-item-title";
    title.textContent = sourceTitle(item, index);

    const badge = document.createElement("span");
    badge.className = "source-item-badge";
    badge.textContent = sourceKind(item);

    main.appendChild(title);
    main.appendChild(badge);

    const remove = document.createElement("button");
    remove.className = "source-item-remove";
    remove.type = "button";
    remove.textContent = "✕";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeSourceAt(index);
    });

    li.appendChild(main);
    li.appendChild(remove);

    li.addEventListener("click", () => {
      syncPlayerSource(index);
      renderSourceList();
    });

    list.appendChild(li);
  });
}

/**
 * 重建播放器（切换源 / 列表变化时）
 *
 * 销毁与清理由播放器公开的 destroy API 负责：
 * - 组件卸载顺序为「最深子组件 → 根」；
 * - 媒体断开（pause → 清 src → load）由 VideoPlayer.destroy 在流媒体插件销毁之后执行，
 *   不再需要 demo 侧提前摘 src（提前摘会把 MediaSource 从 video 元素上摘掉，
 *   使仍在运行的 dash.js 抛 SourceBuffer 已移除的异常）。
 *
 * @param targetIndex - 目标源下标
 */
const loggedEventPlayers = new WeakSet<object>();
/** 订阅全部播放器事件并写日志（demo 展示 on 回调） */
function attachAllPlayerEvents(player: VideoPlayer): void {
  if (loggedEventPlayers.has(player)) return;
  loggedEventPlayers.add(player);
  const events = Object.values(PlayerEventEnum) as string[];
  for (const event of events) {
    try {
      player.on(
        event as never,
        ((...args: unknown[]) => {
          const payload = args.length
            ? JSON.stringify(args[0])?.slice(0, 120)
            : "";
          appEventBus.emit("ACTION_LOG", {
            action: "Player.on(" + event + ")" + (payload ? " " + payload : ""),
            timestamp: Date.now(),
          });
        }) as never,
      );
    } catch {
      // 事件不存在时忽略
    }
  }
}

async function rebuildPlayer(
  targetIndex: number,
  hydrateExisting = false,
): Promise<void> {
  const wrapper = document.getElementById("player-wrapper");
  const existing = hydrateExisting ? playerInstance : null;

  if (!existing) destroyCurrentPlayer();

  if (!existing && !wrapper) return;

  // 清掉销毁占位（destroy 已移除播放器根节点，这里只移除占位节点，不再用 innerHTML）
  wrapper
    ?.querySelectorAll(".player-destroyed-placeholder")
    .forEach((node) => node.remove());

  // 测试期每个视频默认加载：分段点 + 预览数据（雪碧图/逐帧）+ 高能进度条 + 弹幕列表
  // 分段数据跨播放器重建保留（demoSegments 模块级）：仅首次拉取 mock，
  // 运行时编辑结果随 demoSegments 带入新实例
  if (demoSegments.length === 0) {
    demoSegments = await fetchProgressSegments();
  }
  const [energy, danmakuList] = await Promise.all([
    fetchEnergyProgress(),
    fetchDanmakuList(),
  ]);

  // mock 弹幕汇入页面弹幕列表面板（本地发送的经 onSendSuccess 追加）
  danmakuPanelList = danmakuList;
  renderDanmakuList();

  // 预览图默认关闭：不请求 /videoshot/*（避免触发浏览器下载与 IDM 弹窗）
  previewProviderHandle.setSource(null);
  syncPreviewModeButtons("none");

  const urlSrc = new URLSearchParams(location.search).get("src");
  const current = urlSrc
    ? { ...MEDIA_LIST[targetIndex], src: urlSrc }
    : MEDIA_LIST[targetIndex];
  const config: PlayerConfig = {
    src: current ? current.src : undefined,
    playlist: MEDIA_LIST,
    playlistIndex: targetIndex,
    progress: {
      // 跳片头/片尾点：与真实播放器一致，在进度条上渲染 6px 白色断点
      skipPoints: { introEnd: 2, outroStart: 4 },
      // 分段进度条常驻展开：仅 segments 多段且显式开启时生效
      shadowPermanent: false,
      // 拷贝数据三字段构造纯净对象：控件会给分段挂 element 等内部 DOM 引用，
      // 直接透传原数组会把上一实例的 DOM 引用带进新播放器
      segments: demoSegments.map((segment) => ({
        startTime: segment.startTime,
        endTime: segment.endTime,
        label: segment.label,
      })),
      // 预览图 Provider：demo 侧自行实现获取逻辑（雪碧图裁切 / 逐帧 URL），
      // 播放器只在进度条悬停时按时间调用（ProgressPreview API，解耦数据来源）。
      // 用可变 provider：数据源已在上面拉好写入 handle，模式切换按钮
      // 运行期 setSource 即可换源，无需重建播放器实例
      previewProvider: (time: number, duration: number) => {
        // 首次悬停进度条时才懒加载预览资源
        ensurePreviewLoaded(previewMode);
        return previewProviderHandle.provider(time, duration);
      },
      // 高能进度条数据 Provider：demo 侧拉取 /x/player/pbp 并归一化后注入，
      // 播放器只负责绘制曲线（数据获取与绘制彻底解耦）
      energyProvider: () => energy,
    },
    playback: {
      autoplay: true,
      muted: true,
      volume: 0.3,
    },
    interaction: {
      keyboard: true,
    },
    ui: {
      title: current?.title ?? "Lumina Demo",
      scene: demoScene,
      topStyle: demoTopStyle,
      endingStyle: demoEndingStyle,
      embedded: {
        title: current?.title ?? "Lumina Demo",
        stats: { like: 3537, comment: 19 },
        up: {
          name: "小梅vlog",
          face: demoPic("UP", "#00b4d8", "#1a1a2e"),
          followed: true,
        },
        related: DEMO_EMBEDDED_RELATED,
        enterUrl: "https://www.bilibili.com/",
        downloadUrl: "https://www.bilibili.com/",
      },
    },
    plugins: {
      list: collectPlugins(current ? current.src : undefined),
    },
    advanced: {
      debug: false,
    },
    i18n: {
      enabled: true,
      locale: "zh-CN",
      fallbackLocale: "en-US",
      messages: {
        "zh-CN": zhCN,
        "en-US": enUS,
      },
    },
  };

  try {
    if (existing) {
      // 水合实例的初始 config 已与 SSR 完全一致；这里只动态注入运行期数据与插件，
      // 不再 setConfig，避免配置快照导致设置 / 自动播放 / 进度条 UI 失效。
      for (const plugin of config.plugins?.list ?? []) {
        existing.registerPlugin(plugin);
      }
      const applyProgressData = (): void => {
        existing.progress.setSegments(config.progress?.segments ?? []);
        existing.progress.setEnergy(energy);
      };
      requestAnimationFrame(() => {
        applyProgressData();
        setTimeout(applyProgressData, 500);
      });
      attachAllPlayerEvents(existing);
      existing
        .getPluginAPI<DanmakuPluginAPI>("danmaku")
        ?.loadDanmaku(danmakuPanelList);
      (window as unknown as { player: VideoPlayer }).player = existing;
      if (targetIndex > 0) {
        void existing.switchTo(targetIndex).catch(() => undefined);
      }
    } else {
      const next = new VideoPlayer(config);
      setPlayerInstance(next);
      if (wrapper) wrapper.replaceChildren();
      next.mount(wrapper as HTMLElement);
      next.progress.setSegments(config.progress?.segments ?? []);
      next.progress.setEnergy(energy);
      attachAllPlayerEvents(next);
      next
        .getPluginAPI<DanmakuPluginAPI>("danmaku")
        ?.loadDanmaku(danmakuPanelList);
      for (const [otherId] of LOCALE_BUTTONS) {
        const other = document.getElementById(otherId);
        if (other) other.classList.toggle("active", otherId === "btn-locale-zh");
      }
      (window as unknown as { player: VideoPlayer }).player = next;
      if (targetIndex > 0) {
        void next.switchTo(targetIndex).catch(() => undefined);
      }
    }
    appEventBus.emit("ACTION_LOG", {
      action:
        "视频列表 " +
        MEDIA_LIST.length +
        " 项，当前第 " +
        (targetIndex + 1) +
        " 项",
      timestamp: Date.now(),
    });
  } catch (e) {
    console.error("[VideoPlayer Playlist Error]", e);
  }

  renderSourceList();
  // 播放器重建后同步交互 UI：编辑模式的内容面板按新实例数据重新渲染
  syncInteractionUi();
  // 播放器重建后同步分段列表（编辑态数据随 demoSegments 保留）
  renderSegmentList();
}

/** 不重建播放器：同步 playlist / 当前标题 / 插件视图 */
function syncPlayerSource(index: number): void {
  const player = playerInstance;
  if (!player) {
    void rebuildPlayer(index);
    return;
  }
  player.setConfig({
    playlist: MEDIA_LIST,
    ui: { title: MEDIA_LIST[index]?.title ?? "Lumina Demo" },
  });
  void player.switchTo(index).catch(() => undefined);
  player.refreshTop();
  player.refreshEnding();
  renderSourceList();
}

function addSource(source: PlayerSource, title: string): void {
  MEDIA_LIST.push({ src: source, title });
  syncPlayerSource(MEDIA_LIST.length - 1);
}

function handleAddSource(): void {
  const input = document.getElementById("input-source-url");
  if (!(input instanceof HTMLInputElement)) return;
  const source = parseSource(input.value);
  if (!source) {
    appEventBus.emit("ACTION_LOG", {
      action: "视频链接为空或 JSON 解析失败",
      timestamp: Date.now(),
    });
    return;
  }
  input.value = "";
  addSource(
    source,
    typeof source === "string" ? source.slice(0, 64) : "JSON 视频源",
  );
}

function handleLocalFile(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const file = target.files?.item(0);
  if (!file) return;
  const url = URL.createObjectURL(file);
  OBJECT_URLS.push(url);
  target.value = "";
  addSource(url, file.name);
}

const inputSourceUrl = document.getElementById("input-source-url");
if (inputSourceUrl) {
  inputSourceUrl.addEventListener("keydown", (event) => {
    if (event instanceof KeyboardEvent && event.key === "Enter") {
      handleAddSource();
    }
  });
}

const btnAddSource = document.getElementById("btn-add-source");
if (btnAddSource) {
  btnAddSource.addEventListener("click", handleAddSource);
}

function handleJsonFile(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const file = target.files?.item(0);
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === "string" ? reader.result : "";
    const source = parseSource(text);
    if (!source) {
      appEventBus.emit("ACTION_LOG", {
        action: "JSON 文件解析失败: " + file.name,
        timestamp: Date.now(),
      });
      console.error("[Demo] JSON 文件解析失败", file.name);
      return;
    }
    addSource(source, file.name);
  };
  reader.onerror = () => {
    appEventBus.emit("ACTION_LOG", {
      action: "JSON 文件读取失败: " + file.name,
      timestamp: Date.now(),
    });
    console.error("[Demo] JSON 文件读取失败", file.name);
  };
  reader.readAsText(file);
  target.value = "";
}

const inputLocalFile = document.getElementById("input-local-file");
if (inputLocalFile) {
  inputLocalFile.addEventListener("change", handleLocalFile);
}

const inputJsonFile = document.getElementById("input-json-file");
if (inputJsonFile) {
  inputJsonFile.addEventListener("change", handleJsonFile);
}

const btnDestroyWithCleanup = document.getElementById("btn-destroy-player");
if (btnDestroyWithCleanup) {
  btnDestroyWithCleanup.addEventListener("click", () => {
    OBJECT_URLS.forEach((url) => URL.revokeObjectURL(url));
    OBJECT_URLS.length = 0;
  });
}

renderSourceList();

// ============================================
// 插件 API 演示按钮：调用 player 公开方法 / 插件运行时 API
// ============================================

/**
 * 播放器存在性守卫
 *
 * 播放器销毁后（未添加来源）按钮仍可点击：
 * 返回局部收窄后的实例引用，无实例时记日志并返回 null。
 */
const currentPlayer = (): VideoPlayer | null => {
  if (playerInstance) return playerInstance;
  logAction("No player instance (请先添加视频来源)");
  return null;
};

/** 绑定演示按钮（SSR 输出的静态结构，水合后在此统一绑定） */
const wireDemoButton = (id: string, handler: () => void): void => {
  const button = document.getElementById(id);
  if (button) button.addEventListener("click", handler);
};

// ============================================
// 互动视频（华强买瓜）按钮绑定：协议 / 格式切换 + 播放
// ============================================

// 协议切换：HLS / DASH（切换后仅更新选中态，下次播放生效）
wireDemoButton("btn-hq-protocol-hls", () => {
  hqProtocol = "hls";
  syncHuaqiangButtons();
});

wireDemoButton("btn-hq-protocol-dash", () => {
  hqProtocol = "dash";
  syncHuaqiangButtons();
});

// playurl 格式切换：URL（m3u8/mpd 地址）/ JSON（清单对象直接注入播放器）
wireDemoButton("btn-hq-format-url", () => {
  hqFormat = "url";
  syncHuaqiangButtons();
});

wireDemoButton("btn-hq-format-json", () => {
  hqFormat = "json";
  syncHuaqiangButtons();
});

// 播放互动视频：拉剧情树 → 解析起始节点源 → 重建播放器（挂互动视频插件）
wireDemoButton("btn-hq-play", () => {
  void playHuaqiangInteractive();
});

// 水合后设置按钮初始选中态与状态行文案（默认 HLS × URL）
syncHuaqiangButtons();

wireDemoButton("btn-danmaku-toggle", () => {
  const player = currentPlayer();
  if (!player) return;
  const next = !player.getDanmakuVisible();
  player.setDanmakuVisible(next);
  logAction(`调用 setDanmakuVisible(${next})`);
});

wireDemoButton("btn-danmaku-opacity", () => {
  const player = currentPlayer();
  if (!player) return;
  player.setDanmakuOpacity(0.5);
  logAction("调用 setDanmakuOpacity(0.5)");
});

wireDemoButton("btn-subtitle-style", () => {
  const player = currentPlayer();
  if (!player) return;
  const api = player.getPlugin<SubtitlePluginAPI>("subtitle");
  if (!api) {
    logAction("SubtitlePlugin 未注册（字幕相关 UI 不渲染）");
    return;
  }
  api.setStyle({ fontSize: 24, primaryColor: "#ffd700" });
  logAction("调用 subtitle.setStyle({ fontSize: 24, primaryColor: #ffd700 })");
});

wireDemoButton("btn-subtitle-toggle", () => {
  const player = currentPlayer();
  if (!player) return;
  const next = !player.getSubtitleVisible();
  player.setSubtitleVisible(next);
  logAction(`调用 setSubtitleVisible(${next})`);
});

wireDemoButton("btn-quality-auto", () => {
  const player = currentPlayer();
  if (!player) return;
  player.setQuality("auto");
  logAction('调用 setQuality("auto")');
});

wireDemoButton("btn-display-wide", () => {
  const player = currentPlayer();
  if (!player) return;
  player.setDisplayMode("wide");
  logAction('调用 setDisplayMode("wide")');
});

wireDemoButton("btn-display-normal", () => {
  const player = currentPlayer();
  if (!player) return;
  player.setDisplayMode("normal");
  logAction('调用 setDisplayMode("normal")');
});

// i18n 状态查询：getLocale() 与 getLocaleSignal().value 当前值对照
// （Signal 与方法读值应始终一致，读取 .value 不建立依赖）
wireDemoButton("btn-locale-info", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(
    `i18n 状态: getLocale()=${player.getLocale()} / getLocaleSignal().value=${player.getLocaleSignal().value}`,
  );
});

// ============================================
// 弹幕插件 API 演示按钮（DanmakuPluginAPI 全量）
// ============================================

/** 获取弹幕插件运行时 API（未注册时记日志返回 null） */
const getDanmakuApi = (): DanmakuPluginAPI | null => {
  const player = currentPlayer();
  if (!player) return null;
  const api = player.getPlugin<DanmakuPluginAPI>("danmaku");
  if (!api) {
    logAction("DanmakuPlugin 未注册（弹幕相关 UI 不渲染）");
    return null;
  }
  return api;
};

// 插件级发送：send 自动取当前播放时间，类型/颜色跟随发送栏设置
let dmSendCount = 0;
wireDemoButton("btn-dm-send", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmSendCount += 1;
  const text = `demo 插件弹幕 #${dmSendCount}`;
  api.send(text);
  logAction(`danmaku.send(): "${text}"`);
});

// 批量发送：以当前时间为基准 +2s/+4s/+6s 三条滚动弹幕
wireDemoButton("btn-dm-sendbatch", () => {
  const player = currentPlayer();
  const api = getDanmakuApi();
  if (!player || !api) return;
  const base = player.getCurrentTime();
  const batch: DanmakuItem[] = [2, 4, 6].map((offset, idx) => ({
    id: `batch-${Date.now()}-${idx}`,
    text: `批量弹幕 +${offset}s`,
    time: base + offset,
    type: DanmakuType.SCROLL,
  }));
  api.sendBatch(batch);
  logAction(`danmaku.sendBatch(): ${batch.length} 条（当前时间 +2/+4/+6s）`);
});

wireDemoButton("btn-dm-pause", () => {
  const api = getDanmakuApi();
  if (!api) return;
  api.pause();
  logAction("danmaku.pause(): 弹幕动画暂停");
});

wireDemoButton("btn-dm-play", () => {
  const api = getDanmakuApi();
  if (!api) return;
  api.play();
  logAction("danmaku.play(): 弹幕动画恢复");
});

wireDemoButton("btn-dm-stop", () => {
  const api = getDanmakuApi();
  if (!api) return;
  api.stop();
  logAction("danmaku.stop(): 停止弹幕（清空所有弹幕）");
});

wireDemoButton("btn-dm-clear", () => {
  const api = getDanmakuApi();
  if (!api) return;
  api.clear();
  logAction("danmaku.clear(): 清空屏幕弹幕");
});

wireDemoButton("btn-dm-seek", () => {
  const player = currentPlayer();
  const api = getDanmakuApi();
  if (!player || !api) return;
  const time = player.getCurrentTime();
  api.seek(time);
  logAction(`danmaku.seek(${time.toFixed(1)}): 按当前时间重置调度`);
});

// 性能统计 + getManager：两者为弹幕插件运行时的入口级查询
wireDemoButton("btn-dm-stats", () => {
  const api = getDanmakuApi();
  if (!api) return;
  const stats = api.getStats();
  logAction(
    `danmaku.getManager(): ${api.getManager() ? "已就绪" : "null"} / getStats(): ${
      stats ? JSON.stringify(stats) : "null"
    }`,
  );
});

// 渲染引擎循环：DOM ↔ Canvas（RenderMode 枚举）
let dmRenderCanvas = false;
wireDemoButton("btn-dm-render", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmRenderCanvas = !dmRenderCanvas;
  const mode = dmRenderCanvas ? RenderMode.CANVAS : RenderMode.DOM;
  api.setRenderMode(mode);
  logAction(`danmaku.setRenderMode("${mode}")`);
});

// 字号档位循环：SMALL(0.8) ↔ NORMAL(1.0)
let dmFontSmall = false;
wireDemoButton("btn-dm-font", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmFontSmall = !dmFontSmall;
  const gear = dmFontSmall ? DanmakuFontSize.SMALL : DanmakuFontSize.NORMAL;
  api.setFontSize(gear);
  logAction(
    `danmaku.setFontSize(DanmakuFontSize.${dmFontSmall ? "SMALL" : "NORMAL"})`,
  );
});

// 随屏缩放开关（默认开启，与引擎默认对齐）
let dmAutoScale = true;
wireDemoButton("btn-dm-autoscale", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmAutoScale = !dmAutoScale;
  api.setAutoScale(dmAutoScale);
  logAction(`danmaku.setAutoScale(${dmAutoScale})`);
});

// 智能防挡开关：开启时注入 canvas 生成的「中央镂空」演示遮罩，
// 直观演示 maskLoader 接口（真实场景由外部按时间返回人形遮罩）
let dmMaskOn = false;
wireDemoButton("btn-dm-mask", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmMaskOn = !dmMaskOn;
  api.setMaskConfig(
    dmMaskOn
      ? {
          enabled: true,
          updateInterval: 1000,
          maskLoader: async () => {
            // 生成 640x360 遮罩：四周黑色（可显示弹幕）、中央透明（避让区）
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 360;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.fillStyle = "#000";
              ctx.fillRect(0, 0, 640, 360);
              ctx.clearRect(140, 80, 360, 220);
            }
            return {
              maskImage: canvas.toDataURL("image/png"),
              originalWidth: 640,
              originalHeight: 360,
            };
          },
        }
      : { enabled: false },
  );
  logAction(
    `danmaku.setMaskConfig({ enabled: ${dmMaskOn}${
      dmMaskOn ? ", maskLoader: 中央镂空演示遮罩" : ""
    } })`,
  );
});

// 类型过滤循环：无 → 滚动 → 顶部底部 → 彩色 → 无
const dmFilterCycle: readonly DanmakuFilter[] = [
  {},
  { scroll: true },
  { fixed: true },
  { colorful: true },
];
let dmFilterIdx = 0;
wireDemoButton("btn-dm-filter", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmFilterIdx = (dmFilterIdx + 1) % dmFilterCycle.length;
  const filter = dmFilterCycle[dmFilterIdx];
  api.setFilter({ ...filter });
  const desc =
    Object.keys(filter).length === 0 ? "不过滤" : JSON.stringify(filter);
  logAction(`danmaku.setFilter(${desc})`);
});

// 弹幕屏幕模式循环：NORMAL → FULLSCREEN → WEB_FULLSCREEN
// （仅影响弹幕引擎内部布局参数，不触发浏览器全屏 API）
const dmScreenCycle: readonly ScreenMode[] = [
  ScreenMode.NORMAL,
  ScreenMode.FULLSCREEN,
  ScreenMode.WEB_FULLSCREEN,
];
let dmScreenIdx = 0;
wireDemoButton("btn-dm-screen", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmScreenIdx = (dmScreenIdx + 1) % dmScreenCycle.length;
  api.setScreenMode(dmScreenCycle[dmScreenIdx]);
  logAction(`danmaku.setScreenMode("${dmScreenCycle[dmScreenIdx]}")`);
});

// 速度档位循环（DanmakuSpeed 5 档，默认 NORMAL）
const dmSpeedCycle: readonly DanmakuSpeed[] = [
  DanmakuSpeed.VERY_SLOW,
  DanmakuSpeed.SLOW,
  DanmakuSpeed.NORMAL,
  DanmakuSpeed.FAST,
  DanmakuSpeed.VERY_FAST,
];
let dmSpeedIdx = 2;
wireDemoButton("btn-dm-speedgear", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmSpeedIdx = (dmSpeedIdx + 1) % dmSpeedCycle.length;
  api.setSpeed(dmSpeedCycle[dmSpeedIdx]);
  logAction(`danmaku.setSpeed(DanmakuSpeed 档位 ${dmSpeedIdx + 1}/5)`);
});

// 速度倍率循环：1.0 → 1.5 → 0.5（连续值，优先于档位）
const dmMultiplierCycle: readonly number[] = [1, 1.5, 0.5];
let dmMultiplierIdx = 0;
wireDemoButton("btn-dm-speedmul", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmMultiplierIdx = (dmMultiplierIdx + 1) % dmMultiplierCycle.length;
  api.setSpeedMultiplier(dmMultiplierCycle[dmMultiplierIdx]);
  logAction(
    `danmaku.setSpeedMultiplier(${dmMultiplierCycle[dmMultiplierIdx]})`,
  );
});

// 显示区域循环：交替演示 setArea（档位枚举）与 setAreaRatio（连续值）
// 0.25 → 0.5 → 0.75 → 1，两种 API 语义等价、覆盖同一配置位
const dmAreaValues: readonly number[] = [0.25, 0.5, 0.75, 1];
const dmAreaGears: readonly DanmakuArea[] = [
  DanmakuArea.QUARTER,
  DanmakuArea.HALF,
  DanmakuArea.THREE_QUARTERS,
  DanmakuArea.FULL,
];
let dmAreaIdx = 3;
let dmAreaUseGear = true;
wireDemoButton("btn-dm-area", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmAreaIdx = (dmAreaIdx + 1) % dmAreaValues.length;
  if (dmAreaUseGear) {
    api.setArea(dmAreaGears[dmAreaIdx]);
    logAction(`danmaku.setArea(DanmakuArea) → 区域 ${dmAreaValues[dmAreaIdx]}`);
  } else {
    api.setAreaRatio(dmAreaValues[dmAreaIdx]);
    logAction(`danmaku.setAreaRatio(${dmAreaValues[dmAreaIdx]})`);
  }
  dmAreaUseGear = !dmAreaUseGear;
});

// 弹幕密度循环：1.0 → 0.7 → 0.4（越大越多）
const dmDensityCycle: readonly number[] = [1, 0.7, 0.4];
let dmDensityIdx = 0;
wireDemoButton("btn-dm-density", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmDensityIdx = (dmDensityIdx + 1) % dmDensityCycle.length;
  api.setDensity(dmDensityCycle[dmDensityIdx]);
  logAction(`danmaku.setDensity(${dmDensityCycle[dmDensityIdx]})`);
});

// 字号缩放系数循环（连续值，区别于 setFontSize 档位）：1.0 → 1.25 → 0.8
const dmFontScaleCycle: readonly number[] = [1, 1.25, 0.8];
let dmFontScaleIdx = 0;
wireDemoButton("btn-dm-fontscale", () => {
  const api = getDanmakuApi();
  if (!api) return;
  dmFontScaleIdx = (dmFontScaleIdx + 1) % dmFontScaleCycle.length;
  api.setFontSizeScale(dmFontScaleCycle[dmFontScaleIdx]);
  logAction(`danmaku.setFontSizeScale(${dmFontScaleCycle[dmFontScaleIdx]})`);
});

// 重算弹幕布局：容器尺寸变化后手动触发 resize 的运行期入口
wireDemoButton("btn-dm-resize", () => {
  const api = getDanmakuApi();
  if (!api) return;
  api.resize();
  logAction("danmaku.resize(): 弹幕布局已重算");
});

// 运行期重装弹幕数据源：底表为页面弹幕列表面板数据
// （等价于 rebuildPlayer 里 config.danmaku.provider 的运行期版本）
wireDemoButton("btn-dm-load", () => {
  const api = getDanmakuApi();
  if (!api) return;
  api.load({
    provider: (startTime, endTime) =>
      danmakuPanelList.filter(
        (item) => item.time >= startTime && item.time < endTime,
      ),
  });
  logAction("danmaku.load({ provider }): 运行期重装弹幕数据源");
});

// 直接装填弹幕列表（loadDanmaku 全量入调度器）
wireDemoButton("btn-dm-loaddanmaku", () => {
  const api = getDanmakuApi();
  if (!api) return;
  api.loadDanmaku(danmakuPanelList);
  logAction(`danmaku.loadDanmaku(): 装填 ${danmakuPanelList.length} 条`);
});

// ============================================
// 字幕插件 API 演示按钮（SubtitlePluginAPI 全量）
// ============================================

/** 获取字幕插件运行时 API（未注册时记日志返回 null） */
const getSubtitleApi = (): SubtitlePluginAPI | null => {
  const player = currentPlayer();
  if (!player) return null;
  const api = player.getPlugin<SubtitlePluginAPI>("subtitle");
  if (!api) {
    logAction("SubtitlePlugin 未注册（字幕相关 UI 不渲染）");
    return null;
  }
  return api;
};

// AI 字幕总开关：按 isAiEnabled 当前状态取反
wireDemoButton("btn-sub-ai", () => {
  const api = getSubtitleApi();
  if (!api) return;
  const next = !api.isAiEnabled();
  if (next) api.enableAi();
  else api.disableAi();
  logAction(
    `subtitle.${next ? "enableAi()" : "disableAi()"}: AI 字幕${next ? "开启" : "关闭"}`,
  );
});

// 启动本地实时识别（sherpa-onnx 真实引擎全链路：采集→VAD→ASR→字幕）
wireDemoButton("btn-sub-localai-start", () => {
  const api = getSubtitleApi();
  if (!api) return;
  void api
    .startLocalAi("zh")
    .then(() => logAction('subtitle.startLocalAi("zh"): 本地识别已启动'))
    .catch(() => logAction("subtitle.startLocalAi(): 启动失败"));
});

// 停止本地实时识别
wireDemoButton("btn-sub-localai-stop", () => {
  const api = getSubtitleApi();
  if (!api) return;
  api.stopLocalAi();
  logAction("subtitle.stopLocalAi(): 本地识别已停止");
});

// 切换本地识别语言：zh ↔ en
let subAiLang = "zh";
wireDemoButton("btn-sub-localai-lang", () => {
  const api = getSubtitleApi();
  if (!api) return;
  subAiLang = subAiLang === "zh" ? "en" : "zh";
  void api
    .switchLocalAiLanguage(subAiLang)
    .then(() => logAction(`subtitle.switchLocalAiLanguage("${subAiLang}")`));
});

// 刷新 AI 字幕 + 重拉 0-60 秒区间（模式 B 增量拉取演示）
wireDemoButton("btn-sub-refresh", () => {
  const api = getSubtitleApi();
  if (!api) return;
  void api.refreshAiSubtitle();
  void api.refreshRange(0, 60);
  logAction("subtitle.refreshAiSubtitle() + subtitle.refreshRange(0, 60)");
});

// 当前时间命中的字幕
wireDemoButton("btn-sub-current", () => {
  const api = getSubtitleApi();
  if (!api) return;
  const current = api.getCurrentSubtitle();
  logAction(
    `subtitle.getCurrentSubtitle(): ${
      current
        ? `${current.startTime}s ${current.text}`
        : "null（当前时间无字幕）"
    }`,
  );
});

// 完整字幕稿：总条数 + 前 3 条预览
wireDemoButton("btn-sub-transcript", () => {
  const api = getSubtitleApi();
  if (!api) return;
  const transcript = api.getFullTranscript();
  const head = transcript
    .slice(0, 3)
    .map((item) => item.text)
    .join(" / ");
  logAction(
    `subtitle.getFullTranscript(): 共 ${transcript.length} 条${head ? `，前 3 条: ${head}` : ""}`,
  );
});

// 字幕轨列表
wireDemoButton("btn-sub-tracks", () => {
  const api = getSubtitleApi();
  if (!api) return;
  const tracks = api.listTracks();
  const desc = tracks.map((t) => `${t.trackId}(${t.label})`).join(", ");
  logAction(`subtitle.listTracks(): ${tracks.length} 轨 [${desc}]`);
});

// 轮换激活轨：按 listTracks 顺序循环 activateTrack
let subTrackIdx = 0;
wireDemoButton("btn-sub-track-next", () => {
  const api = getSubtitleApi();
  if (!api) return;
  const tracks = api.listTracks();
  if (tracks.length === 0) {
    logAction("subtitle.activateTrack(): 暂无可激活字幕轨");
    return;
  }
  subTrackIdx = (subTrackIdx + 1) % tracks.length;
  const track = tracks[subTrackIdx];
  void api.activateTrack(track.trackId);
  logAction(`subtitle.activateTrack("${track.trackId}")`);
});

// 翻译轨开关：首个 kind=translation 轨 ↔ null
let subTranslationOn = false;
wireDemoButton("btn-sub-translation", () => {
  const api = getSubtitleApi();
  if (!api) return;
  if (!subTranslationOn) {
    const translation = api
      .listTracks()
      .find((track) => track.kind === "translation");
    if (!translation) {
      logAction("subtitle.setTranslationTrack(): 暂无翻译轨可激活");
      return;
    }
    subTranslationOn = true;
    void api.setTranslationTrack(translation.trackId);
    logAction(`subtitle.setTranslationTrack("${translation.trackId}")`);
  } else {
    subTranslationOn = false;
    void api.setTranslationTrack(null);
    logAction("subtitle.setTranslationTrack(null): 翻译轨已关闭");
  }
});

// 插件状态总览
wireDemoButton("btn-sub-status", () => {
  const api = getSubtitleApi();
  if (!api) return;
  logAction(`subtitle.getStatus(): ${JSON.stringify(api.getStatus())}`);
});

// 字幕配色组合循环：白 → 金 → 青
// （一次覆盖 setFontSize/setColor/setBackgroundColor/setStroke 四个 API；
//   setStyle 整体样式接口已由上方「字幕字号 24px」按钮覆盖）
const subColorCycle: readonly {
  name: string;
  fontSize: number;
  color: string;
  bg: string;
  stroke: string;
  width: number;
}[] = [
  {
    name: "白 20px",
    fontSize: 20,
    color: "#ffffff",
    bg: "rgba(0,0,0,0.4)",
    stroke: "#000000",
    width: 2,
  },
  {
    name: "金 24px",
    fontSize: 24,
    color: "#ffd700",
    bg: "rgba(0,0,0,0.5)",
    stroke: "#8b6914",
    width: 2,
  },
  {
    name: "青 16px",
    fontSize: 16,
    color: "#00e5ff",
    bg: "transparent",
    stroke: "#003a4d",
    width: 1,
  },
];
let subColorIdx = 0;
wireDemoButton("btn-sub-style", () => {
  const api = getSubtitleApi();
  if (!api) return;
  subColorIdx = (subColorIdx + 1) % subColorCycle.length;
  const preset = subColorCycle[subColorIdx];
  api.setFontSize(preset.fontSize);
  api.setColor(preset.color);
  api.setBackgroundColor(preset.bg);
  api.setStroke(preset.stroke, preset.width);
  logAction(
    `subtitle 配色 "${preset.name}": setFontSize(${preset.fontSize}) + setColor(${preset.color}) + setBackgroundColor + setStroke`,
  );
});

// 字幕位置循环：bottom → top → middle
const subPosCycle: readonly ("bottom" | "top" | "middle")[] = [
  "bottom",
  "top",
  "middle",
];
let subPosIdx = 0;
wireDemoButton("btn-sub-pos", () => {
  const api = getSubtitleApi();
  if (!api) return;
  subPosIdx = (subPosIdx + 1) % subPosCycle.length;
  api.setPosition(subPosCycle[subPosIdx], 24);
  logAction(`subtitle.setPosition("${subPosCycle[subPosIdx]}", 24)`);
});

// 时间偏移循环：0 → 8 → -8 秒
const subOffsetCycle: readonly number[] = [0, 8, -8];
let subOffsetIdx = 0;
wireDemoButton("btn-sub-offset", () => {
  const api = getSubtitleApi();
  if (!api) return;
  subOffsetIdx = (subOffsetIdx + 1) % subOffsetCycle.length;
  api.setOffset(subOffsetCycle[subOffsetIdx]);
  logAction(`subtitle.setOffset(${subOffsetCycle[subOffsetIdx]})`);
});

// 语言轨切换：zh ↔ en
let subLang = "zh";
wireDemoButton("btn-sub-langswitch", () => {
  const api = getSubtitleApi();
  if (!api) return;
  subLang = subLang === "zh" ? "en" : "zh";
  void api.switchLanguage(subLang);
  logAction(`subtitle.switchLanguage("${subLang}")`);
});

// 插件级显隐切换：交替演示 toggle() 与 show()/hide() 两条等价路径
// （toggle() 翻转返回新状态；show()/hide() 按 getStatus().visible 定向调用）
let subToggleUseToggle = true;
wireDemoButton("btn-sub-toggle", () => {
  const api = getSubtitleApi();
  if (!api) return;
  if (subToggleUseToggle) {
    const visible = api.toggle();
    logAction(`subtitle.toggle(): 字幕${visible ? "显示" : "隐藏"}`);
  } else {
    const visible = api.getStatus().visible;
    if (visible) {
      api.hide();
      logAction("subtitle.hide(): 字幕隐藏");
    } else {
      api.show();
      logAction("subtitle.show(): 字幕显示");
    }
  }
  subToggleUseToggle = !subToggleUseToggle;
});

// 装填内联字幕：SRT 经 data URL 注入（无需网络 / mock-server）
wireDemoButton("btn-sub-load", () => {
  const api = getSubtitleApi();
  if (!api) return;
  const srt = [
    "1",
    "00:00:01,000 --> 00:00:04,000",
    "Demo 内联字幕第一条（SRT via data URL）",
    "",
    "2",
    "00:00:05,000 --> 00:00:08,000",
    "subtitle.load() 运行期装填演示",
    "",
    "3",
    "00:00:09,000 --> 00:00:12,000",
    "拖动进度条到此区间可见",
    "",
  ].join("\n");
  const src = `data:text/plain;charset=utf-8,${encodeURIComponent(srt)}`;
  void api
    .load({ src, lang: "zh", label: "内联演示轨" })
    .then(() => logAction('subtitle.load({ src: dataURL, lang: "zh" })'));
});

// 卸载字幕（清空当前字幕数据源）
wireDemoButton("btn-sub-unload", () => {
  const api = getSubtitleApi();
  if (!api) return;
  api.unload();
  logAction("subtitle.unload(): 字幕已卸载");
});

// 字幕重定位：按当前播放时间重建字幕索引
wireDemoButton("btn-sub-seek", () => {
  const player = currentPlayer();
  const api = getSubtitleApi();
  if (!player || !api) return;
  const time = player.getCurrentTime();
  api.seek(time);
  logAction(`subtitle.seek(${time.toFixed(1)}): 按当前时间重定位`);
});

// ============================================
// 分段进度条 API（progress.segments 运行时增删改）
// ============================================

/**
 * 一键取当前播放时间填入指定输入框
 *
 * @param inputId - 目标 number 输入框 id
 * @param fieldLabel - 日志里的字段名（起始 / 结束）
 */
const fillCurrentTime = (inputId: string, fieldLabel: string): void => {
  const player = currentPlayer();
  if (!player) return;
  const input = document.getElementById(inputId);
  if (!(input instanceof HTMLInputElement)) return;
  const time = player.getCurrentTime();
  input.value = time.toFixed(1);
  logAction(`${fieldLabel}时间已取当前播放时间: ${time.toFixed(1)}s`);
};

// 起始 / 结束时间「取当前」按钮
wireDemoButton("btn-seg-start-now", () =>
  fillCurrentTime("seg-add-start", "起始"),
);
wireDemoButton("btn-seg-end-now", () => fillCurrentTime("seg-add-end", "结束"));

// 添加分段：读取表单（文字 / 起止 / 插入位置），校验后按位置插入
wireDemoButton("btn-seg-add-form", () => {
  const labelInput = document.getElementById("seg-add-label");
  const startInput = document.getElementById("seg-add-start");
  const endInput = document.getElementById("seg-add-end");
  const posSelect = document.getElementById("seg-add-pos");
  if (
    !(labelInput instanceof HTMLInputElement) ||
    !(startInput instanceof HTMLInputElement) ||
    !(endInput instanceof HTMLInputElement) ||
    !(posSelect instanceof HTMLSelectElement)
  ) {
    return;
  }

  // 默认值：起始 = 当前播放时间，结束 = 起始 + 30
  const player = currentPlayer();
  const startParsed = parseSegTimeInput(startInput.value);
  const startTime =
    startParsed !== null && !Number.isNaN(startParsed)
      ? startParsed
      : (player?.getCurrentTime() ?? 0);
  const endParsed = parseSegTimeInput(endInput.value);
  const endTime =
    endParsed !== null && !Number.isNaN(endParsed) ? endParsed : startTime + 30;

  // 校验：0 ≤ 起 < 终
  if (startTime < 0 || endTime <= startTime) {
    logAction(
      `添加失败：时间非法（起 ${startTime}s / 终 ${endTime}s，需 0 ≤ 起 < 终）`,
    );
    return;
  }

  // 插入位置："end" 追加到末尾；数字为插入到该下标之前（0 = 最前）
  const posValue = posSelect.value;
  const insertIndex =
    posValue === "end"
      ? demoSegments.length
      : Math.min(Math.max(Number(posValue) || 0, 0), demoSegments.length);

  const label = labelInput.value.trim() || `分段 ${demoSegments.length + 1}`;
  demoSegments.splice(insertIndex, 0, { startTime, endTime, label });
  logAction(
    `插入分段 "${label}": ${startTime}s - ${endTime}s（位置 #${insertIndex + 1}，共 ${demoSegments.length} 段）`,
  );
  // 清空文字便于连续添加；时间保留（常用于在同一时间点附近连续微调）
  labelInput.value = "";
  applyDemoSegments();
});

// 重新拉取：mock 分段整体替换 demoSegments 后应用
wireDemoButton("btn-seg-reset", () => {
  void fetchProgressSegments().then((fresh) => {
    demoSegments = fresh;
    logAction(`重新拉取分段: ${demoSegments.length} 段`);
    applyDemoSegments();
  });
});

// 直接应用：演示 setConfig 运行时替换分段（无需重建播放器）
wireDemoButton("btn-seg-apply", () => {
  logAction(`setConfig 运行时应用 ${demoSegments.length} 段分段`);
  applyDemoSegments();
});

// 初始渲染一次：未创建播放器时列表与「插入位置」下拉也有可用状态
// （此时添加的分段存于 demoSegments，随首次 rebuildPlayer 注入配置）
renderSegmentList();

// ============================================
// 播放器核心 API 演示按钮（VideoPlayer 公开方法全量）
// ============================================

// ── 播放控制 ──
wireDemoButton("btn-api-play", () => {
  const player = currentPlayer();
  if (!player) return;
  void player.play();
  logAction("play(): 开始播放");
});

wireDemoButton("btn-api-pause", () => {
  const player = currentPlayer();
  if (!player) return;
  player.pause();
  logAction("pause(): 已暂停");
});

wireDemoButton("btn-api-toggle", () => {
  const player = currentPlayer();
  if (!player) return;
  player.toggle();
  logAction("toggle(): 播放/暂停已切换");
});

wireDemoButton("btn-api-seek", () => {
  const player = currentPlayer();
  if (!player) return;
  const target = player.getCurrentTime() + 30;
  player.seek(target);
  logAction(`seek(${target.toFixed(1)}): 跳到当前时间 +30s`);
});

wireDemoButton("btn-api-seekby", () => {
  const player = currentPlayer();
  if (!player) return;
  player.seekBy(10);
  logAction("seekBy(10): 相对前进 10 秒");
});

wireDemoButton("btn-api-reload", () => {
  const player = currentPlayer();
  if (!player) return;
  player.reload();
  logAction("reload(): 重新加载视频");
});

wireDemoButton("btn-api-autoplay", () => {
  const player = currentPlayer();
  if (!player) return;
  void player
    .attemptAutoplay()
    .then(() =>
      logAction("attemptAutoplay(): 自动播放尝试完成（被拦截时静音重试）"),
    );
});

// ── 音量 ──
// 音量轮换：0.2 → 0.5 → 0.8 → 1
const apiVolumeCycle: readonly number[] = [0.2, 0.5, 0.8, 1];
let apiVolumeIdx = 0;
wireDemoButton("btn-api-volume", () => {
  const player = currentPlayer();
  if (!player) return;
  apiVolumeIdx = (apiVolumeIdx + 1) % apiVolumeCycle.length;
  player.setVolume(apiVolumeCycle[apiVolumeIdx]);
  logAction(`setVolume(${apiVolumeCycle[apiVolumeIdx]})`);
});

wireDemoButton("btn-api-getvolume", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`getVolume() = ${player.getVolume()}`);
});

wireDemoButton("btn-api-mute", () => {
  const player = currentPlayer();
  if (!player) return;
  player.toggleMute();
  logAction(`toggleMute(): 静音已切换 → isMuted() = ${player.isMuted()}`);
});

// setMuted 轮换：true ↔ false
let apiMutedFlag = false;
wireDemoButton("btn-api-setmuted", () => {
  const player = currentPlayer();
  if (!player) return;
  apiMutedFlag = !apiMutedFlag;
  player.setMuted(apiMutedFlag);
  logAction(`setMuted(${apiMutedFlag})`);
});

wireDemoButton("btn-api-ismuted", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`isMuted() = ${player.isMuted()}`);
});

// ── 倍速 / 循环 / 播放模式 ──
// 倍速轮换：0.5 → 1 → 1.25 → 1.5 → 2
const apiRateCycle: readonly number[] = [0.5, 1, 1.25, 1.5, 2];
let apiRateIdx = 0;
wireDemoButton("btn-api-rate", () => {
  const player = currentPlayer();
  if (!player) return;
  apiRateIdx = (apiRateIdx + 1) % apiRateCycle.length;
  player.setPlaybackRate(apiRateCycle[apiRateIdx]);
  logAction(`setPlaybackRate(${apiRateCycle[apiRateIdx]})`);
});

wireDemoButton("btn-api-getrate", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`getPlaybackRate() = ${player.getPlaybackRate()}`);
});

// 循环开关（单曲循环语义）
let apiLoopFlag = false;
wireDemoButton("btn-api-loop", () => {
  const player = currentPlayer();
  if (!player) return;
  apiLoopFlag = !apiLoopFlag;
  player.setLoop(apiLoopFlag);
  logAction(`setLoop(${apiLoopFlag})`);
});

// 播放模式轮换：顺序 → 列表循环 → 随机（PlayMode 枚举与 PlayerConfig 同源导出自 @/types）
const apiPlayModeCycle: readonly PlayMode[] = [
  PlayMode.ORDER,
  PlayMode.REPEAT_ALL,
  PlayMode.SHUFFLE,
];
let apiPlayModeIdx = 0;
wireDemoButton("btn-api-playmode", () => {
  const player = currentPlayer();
  if (!player) return;
  apiPlayModeIdx = (apiPlayModeIdx + 1) % apiPlayModeCycle.length;
  const mode = apiPlayModeCycle[apiPlayModeIdx];
  player.setPlayMode(mode);
  logAction(`setPlayMode(PlayMode 值 "${mode}")`);
});

// ── 画面：全屏 / 网页全屏 / 画中画 / 显示模式 ──
wireDemoButton("btn-api-fullscreen", () => {
  const player = currentPlayer();
  if (!player) return;
  void player.toggleFullscreen();
  logAction("toggleFullscreen(): 全屏切换已请求");
});

wireDemoButton("btn-api-isfullscreen", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`isFullscreen() = ${player.isFullscreen()}`);
});

wireDemoButton("btn-api-webfs", () => {
  const player = currentPlayer();
  if (!player) return;
  player.toggleWebFullscreen();
  logAction("toggleWebFullscreen(): 网页全屏已切换");
});

wireDemoButton("btn-api-iswebfs", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`isWebFullscreen() = ${player.isWebFullscreen()}`);
});

wireDemoButton("btn-api-pip", () => {
  const player = currentPlayer();
  if (!player) return;
  void player
    .togglePip()
    .then(() => logAction("togglePip(): 画中画切换完成"))
    .catch(() => logAction("togglePip(): 画中画不可用"));
});

wireDemoButton("btn-api-enterpip", () => {
  const player = currentPlayer();
  if (!player) return;
  void player
    .enterPip()
    .then(() => logAction("enterPip(): 已进入画中画"))
    .catch(() =>
      logAction("enterPip(): 进入画中画失败（浏览器不支持或被拒绝）"),
    );
});

wireDemoButton("btn-api-exitpip", () => {
  const player = currentPlayer();
  if (!player) return;
  void player
    .exitPip()
    .then(() => logAction("exitPip(): 已退出画中画"))
    .catch(() => logAction("exitPip(): 退出画中画失败"));
});

// 显示模式轮换：normal → wide → web → mini（DisplayMode 联合字符串类型）
const apiDisplayModeCycle: readonly DisplayMode[] = [
  "normal",
  "wide",
  "web",
  "mini",
];
let apiDisplayModeIdx = 0;
wireDemoButton("btn-api-displaymode", () => {
  const player = currentPlayer();
  if (!player) return;
  apiDisplayModeIdx = (apiDisplayModeIdx + 1) % apiDisplayModeCycle.length;
  const mode = apiDisplayModeCycle[apiDisplayModeIdx];
  player.setDisplayMode(mode);
  logAction(`setDisplayMode("${mode}")`);
});

// ── 设置：镜像 / 自动连播 / 关灯 / 画面比例 / 编码偏好 / 音量均衡 ──
// 镜像开关
let apiMirrorFlag = false;
wireDemoButton("btn-api-mirror", () => {
  const player = currentPlayer();
  if (!player) return;
  apiMirrorFlag = !apiMirrorFlag;
  player.setMirror(apiMirrorFlag);
  logAction(`setMirror(${apiMirrorFlag})`);
});

// 自动连播开关（autostart）
let apiAutostartFlag = false;
wireDemoButton("btn-api-autostart", () => {
  const player = currentPlayer();
  if (!player) return;
  apiAutostartFlag = !apiAutostartFlag;
  player.setAutostart(apiAutostartFlag);
  logAction(`setAutostart(${apiAutostartFlag})`);
});

// 关灯开关
let apiLightoffFlag = false;
wireDemoButton("btn-api-lightoff", () => {
  const player = currentPlayer();
  if (!player) return;
  apiLightoffFlag = !apiLightoffFlag;
  player.setLightoff(apiLightoffFlag);
  logAction(`setLightoff(${apiLightoffFlag})`);
});

// 画面比例轮换：自动(0:0) → 4:3 → 16:9（合法值见 VideoPlayer.setAspectRatio 注释）
const apiRatioCycle: readonly string[] = ["0:0", "4:3", "16:9"];
let apiRatioIdx = 0;
wireDemoButton("btn-api-ratio", () => {
  const player = currentPlayer();
  if (!player) return;
  apiRatioIdx = (apiRatioIdx + 1) % apiRatioCycle.length;
  const ratio = apiRatioCycle[apiRatioIdx];
  player.setAspectRatio(ratio);
  logAction(`setAspectRatio("${ratio}")`);
});

// 编码偏好轮换：0 默认 → 1 HEVC → 2 AVC → 3 AV1（持久化到 store，下次加载按此选流）
const apiCodecCycle: readonly number[] = [0, 1, 2, 3];
let apiCodecIdx = 0;
wireDemoButton("btn-api-codec", () => {
  const player = currentPlayer();
  if (!player) return;
  apiCodecIdx = (apiCodecIdx + 1) % apiCodecCycle.length;
  const type = apiCodecCycle[apiCodecIdx];
  player.setCodecPrefer(type);
  logAction(`setCodecPrefer(${type})（0 默认 / 1 HEVC / 2 AVC / 3 AV1）`);
});

// 音量均衡轮换：0 关闭 → 1 标准 → 2 高动态（经事件总线由音效插件应用压缩配置）
const apiLoudnessCycle: readonly number[] = [0, 1, 2];
let apiLoudnessIdx = 0;
wireDemoButton("btn-api-loudness", () => {
  const player = currentPlayer();
  if (!player) return;
  apiLoudnessIdx = (apiLoudnessIdx + 1) % apiLoudnessCycle.length;
  const mode = apiLoudnessCycle[apiLoudnessIdx];
  player.setLoudness(mode);
  logAction(`setLoudness(${mode})（0 关闭 / 1 标准 / 2 高动态）`);
});

// ── 画质 ──
wireDemoButton("btn-api-getquality", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`getCurrentQuality() = "${player.getCurrentQuality()}"`);
});

wireDemoButton("btn-api-qualities", () => {
  const player = currentPlayer();
  if (!player) return;
  const list = player.getQualities();
  const desc = list.map((quality) => quality.label).join(" / ");
  logAction(`getQualities(): ${list.length} 档 [${desc}]`);
});

wireDemoButton("btn-api-qualitymode", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`getQualityMode() = "${player.getQualityMode()}"`);
});

// 画质模式轮换：auto ↔ manual
let apiQualityManual = false;
wireDemoButton("btn-api-setqualitymode", () => {
  const player = currentPlayer();
  if (!player) return;
  apiQualityManual = !apiQualityManual;
  const mode = apiQualityManual ? "manual" : "auto";
  player.setQualityMode(mode);
  logAction(`setQualityMode("${mode}")`);
});

wireDemoButton("btn-api-qualitylimits", () => {
  const player = currentPlayer();
  if (!player) return;
  player.applyQualityLimits({ max: 2000 });
  logAction("applyQualityLimits({ max: 2000 }): 画质高度上限已应用");
});

// ── 播放列表 ──
wireDemoButton("btn-api-next", () => {
  const player = currentPlayer();
  if (!player) return;
  void player.next().then(
    () => logAction("next(): 已切到下一集"),
    () => logAction("next(): 无下一集或切换失败"),
  );
});

wireDemoButton("btn-api-prev", () => {
  const player = currentPlayer();
  if (!player) return;
  void player.prev().then(
    () => logAction("prev(): 已切到上一集"),
    () => logAction("prev(): 无上一集或切换失败"),
  );
});

wireDemoButton("btn-api-playlist", () => {
  const player = currentPlayer();
  if (!player) return;
  const list = player.getPlaylist();
  const titles = list
    .map((item, index) => `${index + 1}.${item.title ?? "(未命名)"}`)
    .join(" / ");
  logAction(`getPlaylist(): 共 ${list.length} 项 [${titles}]`);
});

wireDemoButton("btn-api-index", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`getCurrentIndex() = ${player.getCurrentIndex()}`);
});

/** 演示封面：1x1 SVG dataURL（demo 无静态图片资源，纯色块平铺即可见） */
const DEMO_POSTER_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="#00b4d8"/></svg>',
)}`;

wireDemoButton("btn-api-poster", () => {
  const player = currentPlayer();
  if (!player) return;
  player.setPoster(DEMO_POSTER_URL);
  logAction("setPoster(1x1 SVG dataURL): 封面已设置");
});

wireDemoButton("btn-api-load", () => {
  const player = currentPlayer();
  if (!player) return;
  const first = MEDIA_LIST[0];
  if (!first) {
    logAction("load(): 播放列表为空，请先添加视频来源");
    return;
  }
  void player
    .load(first.src, { autoplay: true })
    .then(() => logAction("load(首项 src, { autoplay: true }): 换源加载完成"));
});

// ── 状态查询 ──
wireDemoButton("btn-api-time", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`getCurrentTime() = ${player.getCurrentTime().toFixed(1)}s`);
});

wireDemoButton("btn-api-duration", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`getDuration() = ${player.getDuration().toFixed(1)}s`);
});

wireDemoButton("btn-api-buffered", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`getBuffered() = ${player.getBuffered().toFixed(1)}s`);
});

wireDemoButton("btn-api-ispause", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`isPaused() = ${player.isPaused()}`);
});

wireDemoButton("btn-api-isplaying", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(`isPlaying() = ${player.isPlaying()}`);
});

wireDemoButton("btn-api-resize", () => {
  const player = currentPlayer();
  if (!player) return;
  player.resize();
  logAction("resize(): 已广播容器尺寸");
});

wireDemoButton("btn-api-state", () => {
  const player = currentPlayer();
  if (!player) return;
  const snapshot = player.getState();
  logAction(
    `getState(): state=${snapshot.state} / currentTime=${snapshot.currentTime}s / duration=${snapshot.duration}s / volume=${snapshot.volume}`,
  );
});

wireDemoButton("btn-api-config", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(
    `getConfig().playback = ${JSON.stringify(player.getConfig().playback ?? {})}`,
  );
});

// ── VideoPlayer 级弹幕代理 ──
wireDemoButton("btn-api-dmvisible", () => {
  const player = currentPlayer();
  if (!player) return;
  const next = !player.isDanmakuVisible();
  player.setDanmakuVisible(next);
  logAction(`setDanmakuVisible(${next})`);
});

wireDemoButton("btn-api-dmvisstate", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(
    `isDanmakuVisible() = ${player.isDanmakuVisible()} / getDanmakuVisible() = ${player.getDanmakuVisible()}`,
  );
});

// 弹幕速度倍率轮换：1 → 1.5 → 0.5（实现为倍率语义，<=0 钳制为 0.1）
const apiDmSpeedCycle: readonly number[] = [1, 1.5, 0.5];
let apiDmSpeedIdx = 0;
wireDemoButton("btn-api-dmspeed", () => {
  const player = currentPlayer();
  if (!player) return;
  apiDmSpeedIdx = (apiDmSpeedIdx + 1) % apiDmSpeedCycle.length;
  const speed = apiDmSpeedCycle[apiDmSpeedIdx];
  player.setDanmakuSpeed(speed);
  logAction(`setDanmakuSpeed(倍率 ${speed})`);
});

wireDemoButton("btn-api-dmsource", () => {
  const player = currentPlayer();
  if (!player) return;
  player.setDanmakuSource(`${MOCK_SERVER_BASE}/x/v1/dm/list.so?oid=1`);
  logAction("setDanmakuSource(mock 弹幕接口): 数据源已切换");
});

wireDemoButton("btn-api-dmclear", () => {
  const player = currentPlayer();
  if (!player) return;
  player.clearDanmaku();
  logAction("clearDanmaku(): 屏幕弹幕已清空");
});

wireDemoButton("btn-api-dmsend", () => {
  const player = currentPlayer();
  if (!player) return;
  player.sendDanmaku("核心API发送的弹幕");
  logAction('sendDanmaku("核心API发送的弹幕")');
});

// ── VideoPlayer 级字幕代理 ──
wireDemoButton("btn-api-subvisible", () => {
  const player = currentPlayer();
  if (!player) return;
  const next = !player.isSubtitleVisible();
  player.setSubtitleVisible(next);
  logAction(`setSubtitleVisible(${next})`);
});

wireDemoButton("btn-api-subvisstate", () => {
  const player = currentPlayer();
  if (!player) return;
  logAction(
    `isSubtitleVisible() = ${player.isSubtitleVisible()} / getSubtitleVisible() = ${player.getSubtitleVisible()}`,
  );
});

// 字幕语言轮换：zh ↔ en（与 demo 字幕插件的本地识别语言对齐）
let apiSubLang = "zh";
wireDemoButton("btn-api-sublang", () => {
  const player = currentPlayer();
  if (!player) return;
  apiSubLang = apiSubLang === "zh" ? "en" : "zh";
  player.setSubtitleLang(apiSubLang);
  logAction(`setSubtitleLang("${apiSubLang}")`);
});

wireDemoButton("btn-api-sublist", () => {
  const player = currentPlayer();
  if (!player) return;
  // 内联 SRT：与 btn-sub-load 相同的 data URL 形式，
  // SubtitleConfig 结构为 { lang, label, url, isDefault? }
  const srt = [
    "1",
    "00:00:01,000 --> 00:00:06,000",
    "核心 API 内联字幕（setSubtitleList 装填）",
    "",
  ].join("\n");
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(srt)}`;
  player.setSubtitleList([
    { lang: "zh", label: "核心API内联轨", url, isDefault: true },
  ]);
  logAction("setSubtitleList(): 装填 1 条内联 SRT 轨");
});

// ── 插件 / 事件 / setConfig ──
wireDemoButton("btn-api-pluginapi", () => {
  const player = currentPlayer();
  if (!player) return;
  const api = player.getPluginAPI<Plugin>("danmaku");
  logAction(
    `getPluginAPI("danmaku"): ${
      api ? "实例可用（插件已注册）" : "undefined（插件未注册）"
    }`,
  );
});

/** once 演示回调：play 事件触发一次后自动解除 */
const oncePlayHandler = (): void => {
  logAction("once 事件触发: play（触发后自动解除）");
};

wireDemoButton("btn-api-once", () => {
  const player = currentPlayer();
  if (!player) return;
  player.once("play", oncePlayHandler);
  logAction('once("play"): 已绑定（下次播放触发一次后自动解除）');
});

/** on/off 演示回调：模块级具名函数，off 需传递同一引用才能解绑 */
const onOffPauseHandler = (): void => {
  logAction("on/off 演示: pause 事件触发");
};

// on/off 奇偶交替：奇数次点击绑定，偶数次点击解绑
let apiOnOffBound = false;
wireDemoButton("btn-api-onoff", () => {
  const player = currentPlayer();
  if (!player) return;
  if (!apiOnOffBound) {
    player.on("pause", onOffPauseHandler);
    apiOnOffBound = true;
    logAction('on("pause"): 已绑定');
  } else {
    player.off("pause", onOffPauseHandler);
    apiOnOffBound = false;
    logAction('off("pause"): 已解绑');
  }
});

// applySettingChange：设置面板 loop 项轮换（等价于点设置面板里的循环开关）
let apiApplyLoopFlag = false;
wireDemoButton("btn-api-applysetting", () => {
  const player = currentPlayer();
  if (!player) return;
  apiApplyLoopFlag = !apiApplyLoopFlag;
  player.applySettingChange("loop", apiApplyLoopFlag);
  logAction(`applySettingChange("loop", ${apiApplyLoopFlag})`);
});

// setConfig 深合并：改 playback.volume 后用 getVolume 验证立即生效
wireDemoButton("btn-api-setconfig", () => {
  const player = currentPlayer();
  if (!player) return;
  player.setConfig({ playback: { volume: 0.8 } });
  logAction(
    `setConfig({ playback: { volume: 0.8 } }): 深合并生效，getVolume() = ${player.getVolume()}`,
  );
});

// ============================================
// 音效插件 API 演示按钮（AudioEffectPluginAPI）
// ============================================

/** 获取音效插件运行时 API（未注册时记日志返回 null） */
const getAudioEffectApi = (): AudioEffectPluginAPI | null => {
  const player = currentPlayer();
  if (!player) return null;
  const api = player.getPluginAPI<AudioEffectPluginAPI>("audioEffect");
  if (!api) {
    logAction("AudioEffectPlugin 未注册（音效相关功能不可用）");
    return null;
  }
  return api;
};

// 五种效果开关轮换（按钮点击即用户手势，AudioContext 可正常 resume）
let aeEqOn = false;
wireDemoButton("btn-ae-eq", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  aeEqOn = !aeEqOn;
  api.setEffectActive("eq", aeEqOn);
  logAction(`audioEffect.setEffectActive("eq", ${aeEqOn})`);
});

let aeReverbOn = false;
wireDemoButton("btn-ae-reverb", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  aeReverbOn = !aeReverbOn;
  api.setEffectActive("reverb", aeReverbOn);
  logAction(`audioEffect.setEffectActive("reverb", ${aeReverbOn})`);
});

let aeA3dOn = false;
wireDemoButton("btn-ae-a3d", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  aeA3dOn = !aeA3dOn;
  api.setEffectActive("a3d", aeA3dOn);
  logAction(`audioEffect.setEffectActive("a3d", ${aeA3dOn})`);
});

let aePhoneOn = false;
wireDemoButton("btn-ae-phone", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  aePhoneOn = !aePhoneOn;
  api.setEffectActive("phone", aePhoneOn);
  logAction(`audioEffect.setEffectActive("phone", ${aePhoneOn})`);
});

let aeCompressorOn = false;
wireDemoButton("btn-ae-compressor", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  aeCompressorOn = !aeCompressorOn;
  api.setEffectActive("compressor", aeCompressorOn);
  logAction(`audioEffect.setEffectActive("compressor", ${aeCompressorOn})`);
});

// EQ 预设轮换（10 段）：pop → rock → jazz → classical → hiphop
const aeEqPresetCycle: readonly EQPresetName[] = [
  "pop",
  "rock",
  "jazz",
  "classical",
  "hiphop",
];
let aeEqPresetIdx = 0;
wireDemoButton("btn-ae-eqpreset", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  aeEqPresetIdx = (aeEqPresetIdx + 1) % aeEqPresetCycle.length;
  const preset = aeEqPresetCycle[aeEqPresetIdx];
  api.setEQPreset(preset, "10");
  logAction(`audioEffect.setEQPreset("${preset}", "10")（建议先激活 EQ）`);
});

// 混响预设轮换：default → room → live → bathroom → hall
const aeReverbPresetCycle: readonly ReverbPresetName[] = [
  "default",
  "room",
  "live",
  "bathroom",
  "hall",
];
let aeReverbPresetIdx = 0;
wireDemoButton("btn-ae-revpreset", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  aeReverbPresetIdx = (aeReverbPresetIdx + 1) % aeReverbPresetCycle.length;
  const preset = aeReverbPresetCycle[aeReverbPresetIdx];
  api.setReverbPreset(preset);
  logAction(`audioEffect.setReverbPreset("${preset}")（需先激活 reverb 效果）`);
});

// 音效音量轮换（dB）：-6 → 0 → +6（插件内部经 db2gain 换算为线性增益）
const aeVolumeCycle: readonly number[] = [-6, 0, 6];
let aeVolumeIdx = 0;
wireDemoButton("btn-ae-volume", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  aeVolumeIdx = (aeVolumeIdx + 1) % aeVolumeCycle.length;
  const db = aeVolumeCycle[aeVolumeIdx];
  api.setVolume(db);
  logAction(`audioEffect.setVolume(${db} dB)`);
});

// 组合预设轮换：default → pop → concertHall → a3d → phone（一键切整套效果组合）
const aeComboCycle: readonly CombinationPresetName[] = [
  "default",
  "pop",
  "concertHall",
  "a3d",
  "phone",
];
let aeComboIdx = 0;
wireDemoButton("btn-ae-combo", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  aeComboIdx = (aeComboIdx + 1) % aeComboCycle.length;
  const preset = aeComboCycle[aeComboIdx];
  api.selectCombination(preset);
  logAction(`audioEffect.selectCombination("${preset}")`);
});

wireDemoButton("btn-ae-list", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  const list = api.getEffectsList();
  logAction(`audioEffect.getEffectsList() = [${list.join(", ")}]`);
});

wireDemoButton("btn-ae-chain", () => {
  const api = getAudioEffectApi();
  if (!api) return;
  const chain = api.getEffectChain();
  logAction(
    chain
      ? "audioEffect.getEffectChain(): 已构造（音效链就绪）"
      : "audioEffect.getEffectChain(): null（音效链未构造，播放器挂载后构建）",
  );
});

// ============================================
// 交互卡片：模式切换 / 编辑工具行 / 内容编辑面板
// ============================================

/**
 * 全量重建交互内容编辑面板
 *
 * 数据源：插件 getStatus() 四列表当前值（编辑改动实时反映）。
 * 每张卡片渲染为一个 .ice-group 分组：
 * - guide：类型下拉（1 点赞 / 2 投币 / 3 收藏）→ updateCardContent({ guideType })
 * - link：文案输入 → updateCardContent({ linkContent })
 * - vote：问题输入 + 每选项输入/增删 → updateCardContent({ question / optionTexts })
 * - score：标题输入 + 图标类型下拉 → updateCardContent({ title / scoreType })
 *
 * 更新策略：
 * - 纯文本输入仅调 updateCardContent（插件 contentVersion 信号驱动卡片
 *   DOM 精准更新），面板不重建、输入焦点不丢失；
 * - 结构操作（选项增删 / 删除卡片 / 重置数据 / addCard）完成后由
 *   调用方重新渲染面板。
 */
function renderInteractionContentPanel(): void {
  const panel = document.getElementById("interaction-content-panel");
  if (!panel) return;
  panel.replaceChildren();

  const api = playerInstance?.getPlugin<InteractionPluginAPI>("interaction");
  if (!api) {
    appendPanelTip(panel, "InteractionPlugin 未注册（添加来源后可用）");
    return;
  }
  if (interactionMode !== "edit") {
    appendPanelTip(panel, "内容编辑仅在编辑模式下可用（先切换到编辑模式）");
    return;
  }

  const status = api.getStatus();
  const total =
    status.guideList.length +
    status.linkList.length +
    status.voteList.length +
    status.scoreList.length +
    status.scoreSumList.length;
  if (total === 0) {
    appendPanelTip(panel, "暂无交互卡片：点击上方「+ xx卡片」按钮添加");
    return;
  }

  status.guideList.forEach((item, index) => {
    panel.appendChild(buildGuideGroup(api, item, index));
  });
  status.linkList.forEach((item, index) => {
    panel.appendChild(buildLinkGroup(api, item, index));
  });
  status.voteList.forEach((item, index) => {
    panel.appendChild(buildVoteGroup(api, item, index));
  });
  status.scoreList.forEach((item, index) => {
    panel.appendChild(buildScoreGroup(api, item, index));
  });
  status.scoreSumList.forEach((item, index) => {
    panel.appendChild(buildScoreSumGroup(api, item, index));
  });
}

/** 面板占位提示行 */
function appendPanelTip(panel: HTMLElement, text: string): void {
  const tip = document.createElement("p");
  tip.className = "ice-tip";
  tip.textContent = text;
  panel.appendChild(tip);
}

/** toast 隐藏定时器（连续提示时复用同一元素，重置计时） */
let toastHideTimer: number | null = null;

/**
 * 轻量 toast 提示
 *
 * 时间窗互斥校验拒绝（添加 / 设置与其他卡片重叠）时弹出，
 * 2.4s 后自动淡出；连续触发时复用同一元素并重置计时
 */
function showToast(message: string): void {
  let toast = document.getElementById("demo-toast");
  if (toast === null) {
    toast = document.createElement("div");
    toast.id = "demo-toast";
    toast.className = "demo-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("demo-toast-show");
  if (toastHideTimer !== null) {
    window.clearTimeout(toastHideTimer);
  }
  toastHideTimer = window.setTimeout((): void => {
    toast?.classList.remove("demo-toast-show");
    toastHideTimer = null;
  }, 2400);
}

/** 字段行：标签 + 控件 */
function buildIceField(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("div");
  row.className = "ice-field";
  const labelEl = document.createElement("span");
  labelEl.className = "ice-label";
  labelEl.textContent = label;
  row.appendChild(labelEl);
  row.appendChild(control);
  return row;
}

/** 分组骨架：标题行（卡片名 + 删除按钮），返回分组容器供继续追加字段 */
function buildIceGroup(
  title: string,
  type: CardType,
  index: number,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "ice-group";
  const head = document.createElement("div");
  head.className = "ice-group-head";
  const titleEl = document.createElement("span");
  titleEl.className = "ice-group-title";
  titleEl.textContent = title;
  head.appendChild(titleEl);
  const removeBtn = document.createElement("button");
  removeBtn.className = "ice-remove";
  removeBtn.type = "button";
  removeBtn.textContent = "删除卡片";
  removeBtn.addEventListener("click", () => {
    const api = playerInstance?.getPlugin<InteractionPluginAPI>("interaction");
    if (!api) return;
    api.removeCard(type, index);
    logAction(`removeCard("${type}", ${index})`);
    renderInteractionContentPanel();
  });
  head.appendChild(removeBtn);
  group.appendChild(head);
  return group;
}

/** 类型下拉构建（guide 图标 / score 图标共用） */
function buildTypeSelect(
  options: { value: number; label: string }[],
  selected: number,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "ice-select";
  options.forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = label;
    select.appendChild(option);
  });
  select.value = String(selected);
  return select;
}

/**
 * 通用调度字段分组：时间窗（timeStart/timeEnd）+ 定位（top/left）
 *
 * 四类卡片共用，change 提交调 updateCardContent 的调度补丁：
 * - 时间窗展示模式立即重算窗口归属（入窗显示 / 出窗移除）
 * - 定位变更走条目重建（卡片 DOM 按 --top/--left 重渲染）
 * 「取当前」按钮一键填入当前播放时间并立即应用。
 */
function buildScheduleFields(
  api: InteractionPluginAPI,
  type: CardType,
  index: number,
  item: { timeStart?: number; timeEnd?: number; top: number; left: number },
): DocumentFragment {
  const fragment = document.createDocumentFragment();

  // ── 时间窗起始 ──
  const startInput = document.createElement("input");
  startInput.className = "ice-input ice-num";
  startInput.type = "number";
  startInput.step = "0.1";
  startInput.min = "0";
  startInput.value = item.timeStart !== undefined ? String(item.timeStart) : "";
  const applyStartTime = (): void => {
    const next = parseSegTimeInput(startInput.value);
    if (next === null || Number.isNaN(next)) {
      startInput.value =
        item.timeStart !== undefined ? String(item.timeStart) : "";
      return;
    }
    // 时间窗互斥预检：与其他卡片重叠 → toast 提示并拒绝（不写数据）
    if (
      item.timeEnd !== undefined &&
      api.wouldOverlap(type, index, next, item.timeEnd)
    ) {
      showToast(
        `时间窗 ${next}s-${item.timeEnd}s 与其他卡片重叠，一次只能存在一张交互卡片`,
      );
      startInput.value =
        item.timeStart !== undefined ? String(item.timeStart) : "";
      return;
    }
    // 先经插件应用（内含重叠二次校验），成功才同步面板数据并记日志
    if (!api.updateCardContent(type, index, { timeStart: next })) {
      showToast("时间窗与其他卡片重叠，设置未生效");
      startInput.value =
        item.timeStart !== undefined ? String(item.timeStart) : "";
      return;
    }
    item.timeStart = next;
    logAction(`updateCardContent("${type}", ${index}, { timeStart: ${next} })`);
  };
  startInput.addEventListener("change", applyStartTime);
  const startNow = document.createElement("button");
  startNow.className = "ice-mini";
  startNow.type = "button";
  startNow.textContent = "取当前";
  startNow.addEventListener("click", () => {
    const player = currentPlayer();
    if (!player) return;
    startInput.value = player.getCurrentTime().toFixed(1);
    applyStartTime();
  });
  fragment.appendChild(
    buildIceField("起始(秒)", wrapFieldControls(startInput, startNow)),
  );

  // ── 时间窗结束 ──
  const endInput = document.createElement("input");
  endInput.className = "ice-input ice-num";
  endInput.type = "number";
  endInput.step = "0.1";
  endInput.min = "0";
  endInput.value = item.timeEnd !== undefined ? String(item.timeEnd) : "";
  const applyEndTime = (): void => {
    const next = parseSegTimeInput(endInput.value);
    if (next === null || Number.isNaN(next)) {
      endInput.value = item.timeEnd !== undefined ? String(item.timeEnd) : "";
      return;
    }
    // 时间窗互斥预检：与其他卡片重叠 → toast 提示并拒绝（不写数据）
    if (
      item.timeStart !== undefined &&
      api.wouldOverlap(type, index, item.timeStart, next)
    ) {
      showToast(
        `时间窗 ${item.timeStart}s-${next}s 与其他卡片重叠，一次只能存在一张交互卡片`,
      );
      endInput.value = item.timeEnd !== undefined ? String(item.timeEnd) : "";
      return;
    }
    // 先经插件应用（内含重叠二次校验），成功才同步面板数据并记日志
    if (!api.updateCardContent(type, index, { timeEnd: next })) {
      showToast("时间窗与其他卡片重叠，设置未生效");
      endInput.value = item.timeEnd !== undefined ? String(item.timeEnd) : "";
      return;
    }
    item.timeEnd = next;
    logAction(`updateCardContent("${type}", ${index}, { timeEnd: ${next} })`);
  };
  endInput.addEventListener("change", applyEndTime);
  const endNow = document.createElement("button");
  endNow.className = "ice-mini";
  endNow.type = "button";
  endNow.textContent = "取当前";
  endNow.addEventListener("click", () => {
    const player = currentPlayer();
    if (!player) return;
    endInput.value = player.getCurrentTime().toFixed(1);
    applyEndTime();
  });
  fragment.appendChild(
    buildIceField("结束(秒)", wrapFieldControls(endInput, endNow)),
  );

  // ── 定位（顶部 / 左侧百分比，一行两输入） ──
  const topInput = document.createElement("input");
  topInput.className = "ice-input ice-num";
  topInput.type = "number";
  topInput.step = "1";
  topInput.min = "0";
  topInput.max = "100";
  topInput.value = String(item.top);
  topInput.addEventListener("change", () => {
    const next = parseSegTimeInput(topInput.value);
    if (next === null || Number.isNaN(next) || next > 100) {
      topInput.value = String(item.top);
      return;
    }
    item.top = next;
    api.updateCardContent(type, index, { top: next });
    logAction(`updateCardContent("${type}", ${index}, { top: ${next} })`);
  });
  const leftInput = document.createElement("input");
  leftInput.className = "ice-input ice-num";
  leftInput.type = "number";
  leftInput.step = "1";
  leftInput.min = "0";
  leftInput.max = "100";
  leftInput.value = String(item.left);
  leftInput.addEventListener("change", () => {
    const next = parseSegTimeInput(leftInput.value);
    if (next === null || Number.isNaN(next) || next > 100) {
      leftInput.value = String(item.left);
      return;
    }
    item.left = next;
    api.updateCardContent(type, index, { left: next });
    logAction(`updateCardContent("${type}", ${index}, { left: ${next} })`);
  });
  const posRow = document.createElement("div");
  posRow.className = "ice-field-pair";
  posRow.appendChild(topInput);
  const posGap = document.createElement("span");
  posGap.className = "ice-label ice-label-gap";
  posGap.textContent = "左侧(%)";
  posRow.appendChild(posGap);
  posRow.appendChild(leftInput);
  fragment.appendChild(buildIceField("顶部(%)", posRow));

  return fragment;
}

/** 输入框 + 小按钮的行内组合（输入占余宽，按钮跟随其后） */
function wrapFieldControls(
  input: HTMLInputElement,
  button: HTMLButtonElement,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "ice-field-pair";
  wrap.appendChild(input);
  wrap.appendChild(button);
  return wrap;
}

/** guide 卡片分组：类型下拉 → updateCardContent({ guideType }) */
function buildGuideGroup(
  api: InteractionPluginAPI,
  item: InteractionGuideThree,
  index: number,
): HTMLElement {
  const group = buildIceGroup(`点赞关注卡片 #${index}`, "guideThree", index);
  // 通用调度字段：时间窗 + 定位
  group.appendChild(buildScheduleFields(api, "guideThree", index, item));
  const select = buildTypeSelect(
    [
      { value: 1, label: "1 · 点赞" },
      { value: 2, label: "2 · 投币" },
      { value: 3, label: "3 · 收藏" },
    ],
    item.type ?? 1,
  );
  select.addEventListener("change", () => {
    const next = Number(select.value);
    if (next === 1 || next === 2 || next === 3) {
      api.updateCardContent("guideThree", index, { guideType: next });
      logAction(
        `updateCardContent("guideThree", ${index}, { guideType: ${next} })`,
      );
    }
  });
  group.appendChild(buildIceField("类型", select));
  return group;
}

/** link 卡片分组：文案输入 → updateCardContent({ linkContent }) */
function buildLinkGroup(
  api: InteractionPluginAPI,
  item: InteractionLink,
  index: number,
): HTMLElement {
  const group = buildIceGroup(`外链卡片 #${index}`, "link", index);
  // 通用调度字段：时间窗 + 定位
  group.appendChild(buildScheduleFields(api, "link", index, item));
  const input = document.createElement("input");
  input.className = "ice-input";
  input.type = "text";
  input.value = item.linkContent ?? "";
  input.placeholder = "外链文案";
  input.addEventListener("input", () => {
    api.updateCardContent("link", index, { linkContent: input.value });
  });
  group.appendChild(buildIceField("文案", input));
  return group;
}

/** vote 卡片分组：问题输入 + 选项输入/增删 → updateCardContent */
function buildVoteGroup(
  api: InteractionPluginAPI,
  item: InteractionVote,
  index: number,
): HTMLElement {
  const group = buildIceGroup(`投票卡片 #${index}`, "vote", index);
  // 通用调度字段：时间窗 + 定位
  group.appendChild(buildScheduleFields(api, "vote", index, item));

  // 问题输入：纯文本 patch，卡片 DOM 精准更新（面板不重建）
  const questionInput = document.createElement("input");
  questionInput.className = "ice-input";
  questionInput.type = "text";
  questionInput.value = item.question;
  questionInput.placeholder = "投票问题";
  questionInput.addEventListener("input", () => {
    api.updateCardContent("vote", index, { question: questionInput.value });
  });
  group.appendChild(buildIceField("问题", questionInput));

  // 选项本地副本：文本输入改写副本后整体 patch（等长 → 精准更新）；
  // 增删操作改变长度触发条目重建 → 重建面板
  const optionTexts = item.options.map((option) => option.optionText);
  const optionsWrap = document.createElement("div");
  const renderOptions = (): void => {
    optionsWrap.replaceChildren();
    optionTexts.forEach((text, optIdx) => {
      const row = document.createElement("div");
      row.className = "ice-option";
      const input = document.createElement("input");
      input.className = "ice-input";
      input.type = "text";
      input.value = text;
      input.addEventListener("input", () => {
        optionTexts[optIdx] = input.value;
        api.updateCardContent("vote", index, { optionTexts: [...optionTexts] });
      });
      const delBtn = document.createElement("button");
      delBtn.className = "ice-mini ice-mini-remove";
      delBtn.type = "button";
      delBtn.textContent = "删选项";
      delBtn.addEventListener("click", () => {
        optionTexts.splice(optIdx, 1);
        api.updateCardContent("vote", index, { optionTexts: [...optionTexts] });
        logAction(`投票#${index} 删除选项 → 剩 ${optionTexts.length} 项`);
        renderInteractionContentPanel();
      });
      row.appendChild(input);
      row.appendChild(delBtn);
      optionsWrap.appendChild(row);
    });
  };
  renderOptions();
  const optionsLabel = document.createElement("span");
  optionsLabel.className = "ice-label";
  optionsLabel.textContent = "选项";
  const optionsField = document.createElement("div");
  optionsField.className = "ice-field ice-field-options";
  optionsField.appendChild(optionsLabel);
  optionsField.appendChild(optionsWrap);
  group.appendChild(optionsField);

  // 添加选项：变长 patch → 条目重建 → 面板重建
  const addBtn = document.createElement("button");
  addBtn.className = "ice-mini ice-add-option";
  addBtn.type = "button";
  addBtn.textContent = "+ 加选项";
  addBtn.addEventListener("click", () => {
    optionTexts.push("新选项");
    api.updateCardContent("vote", index, { optionTexts: [...optionTexts] });
    logAction(`投票#${index} 添加选项 → 共 ${optionTexts.length} 项`);
    renderInteractionContentPanel();
  });
  group.appendChild(addBtn);
  return group;
}

/** score 卡片分组：标题输入 + 图标类型下拉 → updateCardContent */
function buildScoreGroup(
  api: InteractionPluginAPI,
  item: InteractionScore,
  index: number,
): HTMLElement {
  const group = buildIceGroup(`评分卡片 #${index}`, "score", index);
  // 通用调度字段：时间窗 + 定位
  group.appendChild(buildScheduleFields(api, "score", index, item));

  const titleInput = document.createElement("input");
  titleInput.className = "ice-input";
  titleInput.type = "text";
  titleInput.value = item.title;
  titleInput.placeholder = "评分标题";
  titleInput.addEventListener("input", () => {
    api.updateCardContent("score", index, { title: titleInput.value });
  });
  group.appendChild(buildIceField("标题", titleInput));

  const select = buildTypeSelect(
    [
      { value: 1, label: "1 · 星星" },
      { value: 2, label: "2 · 爱心" },
      { value: 3, label: "3 · 柠檬" },
    ],
    item.scoreType,
  );
  select.addEventListener("change", () => {
    const next = Number(select.value);
    if (next === 1 || next === 2 || next === 3) {
      api.updateCardContent("score", index, { scoreType: next });
      logAction(`updateCardContent("score", ${index}, { scoreType: ${next} })`);
    }
  });
  group.appendChild(buildIceField("图标", select));
  return group;
}

/**
 * scoreSum 卡片分组：通用调度字段（时间窗 + 定位）+ 标题编辑
 *
 * 总结卡标题可编辑（updateCardContent title 补丁 → 渲染层精准更新）；
 * 题目列表 / 平均分 / 总人数由插件运行期从 scoreList 聚合，无编辑字段；
 * 添加前提 scoreList 非空由 addScoreSum 校验（空列表返回 false → toast 提示）
 */
function buildScoreSumGroup(
  api: InteractionPluginAPI,
  item: InteractionScoreSum,
  index: number,
): HTMLElement {
  const group = buildIceGroup(`评分总结卡片 #${index}`, "scoreSum", index);
  // 通用调度字段：时间窗 + 定位（内容为运行期聚合）
  group.appendChild(buildScheduleFields(api, "scoreSum", index, item));

  // 标题编辑：title 补丁 → contentVersion 自增 → 卡片标题文本精准更新
  const titleInput = document.createElement("input");
  titleInput.className = "ice-input";
  titleInput.type = "text";
  titleInput.value = item.title ?? "";
  titleInput.placeholder = "总结卡片标题";
  titleInput.addEventListener("input", () => {
    api.updateCardContent("scoreSum", index, { title: titleInput.value });
  });
  group.appendChild(buildIceField("标题", titleInput));
  return group;
}

/** 同步模式切换 UI：两个模式按钮高亮态 + 内容面板显隐 */
const syncInteractionUi = (): void => {
  const viewBtn = document.getElementById("btn-interaction-view");
  if (viewBtn) {
    viewBtn.classList.toggle("mode-active", interactionMode === "interactive");
  }
  const editBtn = document.getElementById("btn-interaction-edit");
  if (editBtn) {
    editBtn.classList.toggle("mode-active", interactionMode === "edit");
  }
  // 内容编辑面板：仅编辑模式显示，显示时按插件当前数据渲染
  // （添加卡片表单两模式均可用：addXxx API 按当前时间窗口即时同步）
  const panel = document.getElementById("interaction-content-panel");
  if (panel) {
    panel.classList.toggle("is-hidden", interactionMode !== "edit");
  }
  if (interactionMode === "edit") {
    renderInteractionContentPanel();
  }
};

/**
 * 切换交互模式
 *
 * mode 为插件构造期配置 → 运行期切换通过
 * 「卸载旧实例 + 携带数据快照重建新实例」实现：
 * 卸载前 getStatus() 抓取当前数据（编辑改动自动保留），
 * 重建时经 config.data 注入新实例。
 */
const setInteractionMode = (mode: InteractionPluginMode): void => {
  if (mode === interactionMode) return;
  const player = currentPlayer();
  if (!player) return;
  // 卸载前抓取数据快照：编辑模式新增的卡片 / 拖拽后的位置都随 getStatus 带出
  snapshotInteraction();
  player.uninstallPlugin("interaction");
  interactionMode = mode;
  // 后装插件：播放器已挂载（player.el 存在），install 内就地初始化
  player.use(InteractionPlugin(makeInteractionConfig()));
  syncInteractionUi();
  logAction(
    mode === "edit"
      ? "交互插件切换为编辑模式：卡片常驻可拖拽，点击类监听不注册"
      : "交互插件切换为展示模式：按时间窗口纯展示，注册全部交互监听",
  );
};

wireDemoButton("btn-interaction-view", () => setInteractionMode("interactive"));
wireDemoButton("btn-interaction-edit", () => setInteractionMode("edit"));

// ============================================
// 运行期添加卡片表单（时间窗 / 定位 / 类型专属字段，两模式均可用）
// ============================================

/**
 * 按下拉选择渲染类型专属字段
 *
 * guide：类型下拉（点赞/投币/收藏）
 * link：文案输入
 * vote：问题输入 + 选项多行文本（每行一个选项）
 * score：标题输入 + 图标下拉
 */
const renderIceKindFields = (): void => {
  const wrap = document.getElementById("ice-add-kind-fields");
  const typeSelect = document.getElementById("ice-add-type");
  if (!wrap || !(typeSelect instanceof HTMLSelectElement)) return;
  wrap.replaceChildren();

  if (typeSelect.value === "guide") {
    const select = buildTypeSelect(
      [
        { value: 1, label: "1 · 点赞" },
        { value: 2, label: "2 · 投币" },
        { value: 3, label: "3 · 收藏" },
      ],
      1,
    );
    select.id = "ice-add-guide-type";
    wrap.appendChild(buildIceField("类型", select));
    return;
  }

  if (typeSelect.value === "link") {
    const input = document.createElement("input");
    input.className = "ice-input";
    input.type = "text";
    input.id = "ice-add-link-content";
    input.placeholder = "外链文案（默认自动编号）";
    wrap.appendChild(buildIceField("文案", input));
    return;
  }

  if (typeSelect.value === "vote") {
    const questionInput = document.createElement("input");
    questionInput.className = "ice-input";
    questionInput.type = "text";
    questionInput.id = "ice-add-vote-question";
    questionInput.value = "运行期新增投票？";
    questionInput.placeholder = "投票问题";
    wrap.appendChild(buildIceField("问题", questionInput));

    const optionsArea = document.createElement("textarea");
    optionsArea.className = "ice-input ice-textarea";
    optionsArea.id = "ice-add-vote-options";
    optionsArea.rows = 3;
    optionsArea.value = "支持\n反对";
    optionsArea.placeholder = "每行一个选项";
    wrap.appendChild(buildIceField("选项", optionsArea));
    return;
  }

  // scoreSum：标题（题目列表 / 平均分 / 总人数由插件运行期从 scoreList 聚合）
  if (typeSelect.value === "scoreSum") {
    const titleInput = document.createElement("input");
    titleInput.className = "ice-input";
    titleInput.type = "text";
    titleInput.id = "ice-add-scoresum-title";
    titleInput.value = "评分总结";
    titleInput.placeholder = "总结卡片标题";
    wrap.appendChild(buildIceField("标题", titleInput));
    return;
  }

  // score：标题 + 图标类型
  const titleInput = document.createElement("input");
  titleInput.className = "ice-input";
  titleInput.type = "text";
  titleInput.id = "ice-add-score-title";
  titleInput.value = "运行期新增评分";
  titleInput.placeholder = "评分标题";
  wrap.appendChild(buildIceField("标题", titleInput));

  const select = buildTypeSelect(
    [
      { value: 1, label: "1 · 星星" },
      { value: 2, label: "2 · 爱心" },
      { value: 3, label: "3 · 柠檬" },
    ],
    1,
  );
  select.id = "ice-add-score-type";
  wrap.appendChild(buildIceField("图标", select));
};

// 类型切换 → 重渲类型专属字段；初始渲染一次（默认 guide）
const iceTypeSelect = document.getElementById("ice-add-type");
if (iceTypeSelect instanceof HTMLSelectElement) {
  iceTypeSelect.addEventListener("change", renderIceKindFields);
}
renderIceKindFields();

// 起始 / 结束时间「取当前」按钮（与分段表单共用 fillCurrentTime）
wireDemoButton("btn-ice-start-now", () =>
  fillCurrentTime("ice-add-start", "起始"),
);
wireDemoButton("btn-ice-end-now", () => fillCurrentTime("ice-add-end", "结束"));

// 添加卡片：读取表单（类型 / 时间窗 / 定位 / 类型专属字段）组装并调 addXxx
wireDemoButton("btn-ice-add", () => {
  const player = currentPlayer();
  if (!player) return;
  const api = player.getPlugin<InteractionPluginAPI>("interaction");
  if (!api) {
    logAction("InteractionPlugin 未注册，无法添加卡片");
    return;
  }
  const typeSelect = document.getElementById("ice-add-type");
  const startInput = document.getElementById("ice-add-start");
  const endInput = document.getElementById("ice-add-end");
  const topInput = document.getElementById("ice-add-top");
  const leftInput = document.getElementById("ice-add-left");
  if (
    !(typeSelect instanceof HTMLSelectElement) ||
    !(startInput instanceof HTMLInputElement) ||
    !(endInput instanceof HTMLInputElement) ||
    !(topInput instanceof HTMLInputElement) ||
    !(leftInput instanceof HTMLInputElement)
  ) {
    return;
  }

  // 时间窗：默认起 = 当前播放时间、终 = 起 + 10；定位默认 top 40 / left 50
  const startParsed = parseSegTimeInput(startInput.value);
  const timeStart =
    startParsed !== null && !Number.isNaN(startParsed)
      ? startParsed
      : player.getCurrentTime();
  const endParsed = parseSegTimeInput(endInput.value);
  const timeEnd =
    endParsed !== null && !Number.isNaN(endParsed) ? endParsed : timeStart + 10;
  if (timeStart < 0 || timeEnd <= timeStart) {
    logAction(
      `添加失败：时间窗非法（起 ${timeStart}s / 终 ${timeEnd}s，需 0 ≤ 起 < 终）`,
    );
    return;
  }
  const topParsed = parseSegTimeInput(topInput.value);
  const top =
    topParsed !== null && !Number.isNaN(topParsed)
      ? Math.min(Math.max(topParsed, 0), 100)
      : 40;
  const leftParsed = parseSegTimeInput(leftInput.value);
  const left =
    leftParsed !== null && !Number.isNaN(leftParsed)
      ? Math.min(Math.max(leftParsed, 0), 100)
      : 50;

  switch (typeSelect.value) {
    case "guide": {
      const select = document.getElementById("ice-add-guide-type");
      const raw =
        select instanceof HTMLSelectElement ? Number(select.value) : 1;
      const guideType = raw === 2 || raw === 3 ? raw : 1;
      // 时间窗互斥校验在插件内完成：重叠返回 false → toast 提示不添加
      if (!api.addGuide({ top, left, timeStart, timeEnd, type: guideType })) {
        showToast(
          `时间窗 ${timeStart}s-${timeEnd}s 与其他卡片重叠，一次只能存在一张交互卡片`,
        );
        return;
      }
      logAction(
        `addGuide: ${timeStart}s-${timeEnd}s top ${top}% / left ${left}%（播放到该区间即可看到）`,
      );
      break;
    }
    case "link": {
      const input = document.getElementById("ice-add-link-content");
      const content =
        input instanceof HTMLInputElement && input.value.trim() !== ""
          ? input.value.trim()
          : `外部链接卡片 #${api.getStatus().linkList.length + 1}`;
      if (
        !api.addLink({ top, left, timeStart, timeEnd, linkContent: content })
      ) {
        showToast(
          `时间窗 ${timeStart}s-${timeEnd}s 与其他卡片重叠，一次只能存在一张交互卡片`,
        );
        return;
      }
      logAction(
        `addLink "${content}": ${timeStart}s-${timeEnd}s top ${top}% / left ${left}%`,
      );
      break;
    }
    case "vote": {
      const questionInput = document.getElementById("ice-add-vote-question");
      const optionsArea = document.getElementById("ice-add-vote-options");
      const question =
        questionInput instanceof HTMLInputElement &&
        questionInput.value.trim() !== ""
          ? questionInput.value.trim()
          : "运行期新增投票？";
      const optionTexts =
        optionsArea instanceof HTMLTextAreaElement
          ? optionsArea.value
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line !== "")
          : [];
      const options =
        optionTexts.length > 0
          ? optionTexts.map((text) => ({ optionText: text }))
          : [{ optionText: "支持" }, { optionText: "反对" }];
      if (!api.addVote({ top, left, timeStart, timeEnd, question, options })) {
        showToast(
          `时间窗 ${timeStart}s-${timeEnd}s 与其他卡片重叠，一次只能存在一张交互卡片`,
        );
        return;
      }
      logAction(
        `addVote "${question}"（${options.length} 选项）: ${timeStart}s-${timeEnd}s`,
      );
      break;
    }
    case "score": {
      const titleInput = document.getElementById("ice-add-score-title");
      const select = document.getElementById("ice-add-score-type");
      const title =
        titleInput instanceof HTMLInputElement && titleInput.value.trim() !== ""
          ? titleInput.value.trim()
          : "运行期新增评分";
      const raw =
        select instanceof HTMLSelectElement ? Number(select.value) : 1;
      const scoreType = raw === 2 || raw === 3 ? raw : 1;
      if (!api.addScore({ top, left, timeStart, timeEnd, title, scoreType })) {
        showToast(
          `时间窗 ${timeStart}s-${timeEnd}s 与其他卡片重叠，一次只能存在一张交互卡片`,
        );
        return;
      }
      logAction(
        `addScore "${title}": ${timeStart}s-${timeEnd}s top ${top}% / left ${left}%`,
      );
      break;
    }
    case "scoreSum": {
      // 标题可编辑；前置条件（至少一张评分卡）与时间窗互斥均由插件校验，失败 toast 提示
      const titleInput = document.getElementById("ice-add-scoresum-title");
      const title =
        titleInput instanceof HTMLInputElement && titleInput.value.trim() !== ""
          ? titleInput.value.trim()
          : "评分总结";
      if (!api.addScoreSum({ top, left, timeStart, timeEnd, title })) {
        if (api.getStatus().scoreList.length === 0) {
          showToast("评分总结卡片需要先添加至少一张评分卡片");
        } else {
          showToast(
            `时间窗 ${timeStart}s-${timeEnd}s 与其他卡片重叠，一次只能存在一张交互卡片`,
          );
        }
        return;
      }
      logAction(
        `addScoreSum "${title}": ${timeStart}s-${timeEnd}s top ${top}% / left ${left}%（汇总全部评分卡）`,
      );
      break;
    }
    default:
      return;
  }
  // 结构变更：编辑模式下面板全量重建（新增卡片分组出现）
  if (interactionMode === "edit") {
    renderInteractionContentPanel();
  }
});

// 重置交互数据：四列表整体替换为初始数据（updateData 编辑分支立即重建常显条目）
wireDemoButton("btn-interaction-reset", () => {
  const player = currentPlayer();
  if (!player) return;
  const api = player.getPlugin<InteractionPluginAPI>("interaction");
  if (!api) {
    logAction("InteractionPlugin 未注册，无法重置数据");
    return;
  }
  api.updateData(INITIAL_INTERACTION_DATA);
  logAction("updateData(INITIAL_INTERACTION_DATA): 交互数据已重置");
  renderInteractionContentPanel();
});

// 关闭首个卡片：按 vote → link → score 顺序找第一张可关闭的卡片
// （closeCard 对活跃条目生效，数据列表不变；guide 卡片无关闭概念）
wireDemoButton("btn-interaction-close", () => {
  const player = currentPlayer();
  if (!player) return;
  const api = player.getPlugin<InteractionPluginAPI>("interaction");
  if (!api) {
    logAction("InteractionPlugin 未注册，无法关闭卡片");
    return;
  }
  const status = api.getStatus();
  const candidates: { type: CardType; label: string; list: unknown[] }[] = [
    { type: "vote", label: "投票", list: status.voteList },
    { type: "link", label: "外链", list: status.linkList },
    { type: "score", label: "评分", list: status.scoreList },
    { type: "scoreSum", label: "评分总结", list: status.scoreSumList },
  ];
  for (const candidate of candidates) {
    if (candidate.list.length > 0) {
      api.closeCard(candidate.type, 0);
      logAction(
        `closeCard("${candidate.type}", 0): ${candidate.label}卡片 #0 已关闭（卡片未从数据移除）`,
      );
      return;
    }
  }
  logAction("暂无可关闭的卡片（vote / link / score / scoreSum 列表均为空）");
});

// 获取交互容器：getContainer 查询插件挂载的层容器
wireDemoButton("btn-interaction-container", () => {
  const player = currentPlayer();
  if (!player) return;
  const api = player.getPlugin<InteractionPluginAPI>("interaction");
  if (!api) {
    logAction("InteractionPlugin 未注册");
    return;
  }
  const container = api.getContainer();
  logAction(
    container
      ? `getContainer(): <${container.tagName.toLowerCase()}> 子元素 ${container.childElementCount} 个`
      : "getContainer(): null（插件未挂载容器）",
  );
});

// 导出当前交互数据（编辑改动后的最终落点 / 新增卡片全部包含在内）
wireDemoButton("btn-interaction-dump", () => {
  const player = currentPlayer();
  if (!player) return;
  const api = player.getPlugin<InteractionPluginAPI>("interaction");
  if (!api) {
    logAction("InteractionPlugin 未注册，无法导出数据");
    return;
  }
  logAction(`交互数据快照: ${JSON.stringify(api.getStatus())}`);
});

// 初始同步一次模式按钮态（初始为展示模式，编辑工具行默认隐藏）
syncInteractionUi();

// ============================================
// 辅：徽章状态更新
// ============================================

function updateBadgeToHydrated(label = "Hydrated"): void {
  const badge = document.getElementById("ssr-badge");
  if (badge) {
    badge.className = "ssr-badge hydrated";
    const text = badge.querySelector(".text");
    if (text) text.textContent = label;
  }
}

function updateBadgeToFailed(errorMsg: string): void {
  const badge = document.getElementById("ssr-badge");
  if (badge) {
    badge.className = "ssr-badge failed";
    const text = badge.querySelector(".text");
    if (text) text.textContent = "Hydration Failed";
  }
  const errorOverlay = document.getElementById("ssr-error");
  const errorMsgEl = document.getElementById("ssr-error-msg");
  if (errorOverlay && errorMsgEl) {
    errorMsgEl.textContent = errorMsg;
    errorOverlay.classList.add("show");
  }
}

// ============================================
// Top / Ending 插件演示（并入唯一 demo 入口）
// ============================================

function applyTopStyle(style: "default" | "tv" | "music"): void {
  const player = playerInstance;
  if (!player) return;
  demoTopStyle = style;
  player.setConfig({ ui: { topStyle: style } });
  player.refreshTop();
}

function applyEndingStyle(style: "standard" | "ogv" | "interactive"): void {
  const player = playerInstance;
  if (!player) return;
  demoEndingStyle = style;
  player.setConfig({
    ui: {
      endingStyle: style,
      ...(style === "ogv"
        ? {
            ogv: {
              title: player.props.ui?.title ?? "Lumina Demo",
              cover: DEMO_COVER,
              related: DEMO_RELATED,
            },
          }
        : {}),
      ...(style === "interactive"
        ? {
            interactive: {
              followers: "6.3万",
              backtrack: DEMO_BACKTRACK,
              activeBacktrackIndex: 2,
            },
          }
        : {}),
    },
  });
  player.refreshEnding();
  setTimeout(() => {
    player.seek(Math.max(0, player.getDuration() - 0.1));
  }, 300);
}

/** 切换站内 / 外链场景（场景影响播放器整体结构，需要重建播放器） */
async function applyScene(
  scene: "station" | "embedded",
  showEnding = false,
): Promise<void> {
  demoScene = scene;
  const index = playerInstance?.getCurrentIndex() ?? 0;
  await rebuildPlayer(index);
  if (showEnding) {
    // 外链尾页：等播放器重建完成后触发 ended，进入真实外链片尾
    setTimeout(() => {
      document
        .querySelector<HTMLVideoElement>("#player-wrapper video")
        ?.dispatchEvent(new Event("ended"));
    }, 400);
  }
}

function updateDemoTitle(title: string): void {
  const player = playerInstance;
  if (!player) return;
  player.setConfig({ ui: { title } });
  player.refreshTop();
  player.refreshEnding();
}

function installPluginDemoControls(): void {
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;gap:6px;flex-wrap:wrap;padding:8px;background:rgba(20,20,28,.92);border:1px solid rgba(255,255,255,.14);border-radius:8px;font:12px/1.4 sans-serif;color:#ddd";
  const buttons: Array<[string, () => void]> = [
    ["普通 Top", () => applyTopStyle("default")],
    ["电视剧 Top", () => applyTopStyle("tv")],
    ["音乐 Top", () => applyTopStyle("music")],
    ["标准片尾", () => applyEndingStyle("standard")],
    ["OGV 片尾", () => applyEndingStyle("ogv")],
    ["互动尾页", () => applyEndingStyle("interactive")],
    ["外链暂停页", () => applyScene("embedded")],
    ["外链尾页", () => applyScene("embedded", true)],
    ["站内场景", () => applyScene("station")],
    ["更新标题", () => updateDemoTitle("动态更新标题 " + Date.now())],
    ["卸载 Top 插件", () => playerInstance?.uninstallPlugin("top")],
    ["重装 Top 插件", () => playerInstance?.use(createTopPlugin())],
    ["卸载 Ending 插件", () => playerInstance?.uninstallPlugin("ending")],
    ["重装 Ending 插件", () => playerInstance?.use(createEndingPlugin())],
  ];
  for (const [label, onClick] of buttons) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText =
      "cursor:pointer;border:1px solid rgba(255,255,255,.18);border-radius:6px;background:#2a2a36;color:#eee;padding:5px 9px";
    button.addEventListener("click", onClick);
    panel.appendChild(button);
  }
  document.body.appendChild(panel);
}

installPluginDemoControls();

// 唯一 demo 入口：启动即加载示例视频（Top/Ending 插件演示可见）
if (MEDIA_LIST.length > 0) {
  if (playerInstance) {
    // SSR 已经产出播放器 HTML：水合后增量补齐 demo 插件与媒体数据
    void rebuildPlayer(0, true);
  } else {
    void rebuildPlayer(0);
  }
}

// ============================================
// 深浅色主题：真实切换页面 CSS 变量（不依赖组件内部状态）
// ============================================
function wireThemeToggle(): void {
  const button = document.querySelector<HTMLButtonElement>(
    ".theme-switcher button",
  );
  const root = document.querySelector<HTMLElement>(".app-root");
  if (!button || !root) return;
  const apply = (theme: "dark" | "light"): void => {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    const vars: Record<string, string> = {
      "--accent": isDark ? "#00b4d8" : "#1976D2",
      "--accent-hover": isDark ? "#0096b7" : "#1565C0",
      "--bg-base": isDark ? "#1a1a2e" : "#f5f5f5",
      "--panel-bg": isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
      "--btn-bg": isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
      "--border-color": isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
      "--text-primary": isDark ? "#e0e0e0" : "#333333",
      "--text-secondary": isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)",
    };
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    button.textContent = isDark ? "切换到亮色" : "切换到暗色";
    button.dataset.theme = theme;
  };
  apply((document.documentElement.dataset.theme as "dark" | "light") ?? "dark");
  button.addEventListener("click", () => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    appEventBus.emit("ACTION_LOG", {
      action: "主题切换: " + next,
      timestamp: Date.now(),
    });
  });
}

// 预览资源只预取一次（同一模式缓存）；避免每次重建都重复下载 preview.bin
setTimeout(() => ensurePreviewLoaded(previewMode), 800);

wireThemeToggle();
