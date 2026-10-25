/**
 * ============================================
 * Demo 预览图 Provider 实现（B 站 videoshot 形状）
 * ============================================
 * 播放器不内置预览数据获取：demo 侧自行拉取 mock-server 的 /x/player/videoshot，
 * 按悬停时间换算预览帧后返回给播放器（ProgressPreview API）。
 *
 * 与 B 站现网一致（api.bilibili.com/x/player/videoshot）：
 * - data.pvdata 指向 bin 截取时间表：内容是 uint16 小端数组（2 字节对齐），
 *   与 data.index JSON 数组一一对应——第 0 项恒为 0（占位），从第 1 项开始
 *   是每张截图的截取时间（秒）。B 站的截图时间按画面变化程度决定（不均匀），
 *   这正是需要这份「帧 ↔ 时间」映射文件的原因；
 * - 查帧（B 站写法）：在时间表里找「最后一个 ≤ 悬停时间」的项 i（i ≥ 1），
 *   帧 k = i - 1（0 起），拼版 = floor(k / 每张格数)，格内下标 = k % 每张格数，
 *   列 = 格内下标 % img_x_len，行 = floor(格内下标 / img_x_len)，
 *   再用该拼版 URL + object-position 负偏移裁出当前帧；
 * - 时间表来源两级：bin（pvdata）优先，bin 拉取/解析失败退回 data.index
 *   （接口带 index=1 时返回的 JSON 时间表）；两者都不可用才按
 *   「帧间隔均匀」换算兜底（下标 = floor(悬停比例 * 拼版张数 * 每张格数)）。
 */

import type {
  ProgressPreviewFrame,
  ProgressPreviewProvider,
} from "@/types";

/**
 * B 站 videoshot 接口 data 的形状（与 mock-server /x/player/videoshot 一致）
 *
 * 字段名保持 B 站的 snake_case，接口返回什么就存什么，不做无谓改名。
 */
export interface VideoshotApiResponse {
  /** bin 截取时间表 URL（B 站口径恒有） */
  pvdata: string;
  /** 每张拼版列数（B 站一般为 10） */
  img_x_len: number;
  /** 每张拼版行数（B 站一般为 10） */
  img_y_len: number;
  /** 单格宽（像素，B 站一般为 160） */
  img_x_size: number;
  /** 单格高（像素，B 站一般为 90） */
  img_y_size: number;
  /** 雪碧图拼版 URL（按顺序，第一张占满后延续第二张） */
  image: string[];
  /** JSON 时间表（请求带 index=1 时非空；否则按 B 站口径为空数组） */
  index: number[];
}

/**
 * demo 运行期数据源 = 接口 data + 解析挂载的时间表
 *
 * times 由 pvdata bin（优先）或 index JSON（兜底）解析而来：
 * 第 0 项恒为 0（占位），第 k 项 = 第 k 张截图的秒数；
 * null = 两者都不可用，查帧退回均匀换算。
 */
export interface VideoshotData extends VideoshotApiResponse {
  /** 解析好的截取时间表（秒）；null = 无时间表，均匀换算兜底 */
  times: number[] | null;
}

/**
 * 判定是否为 B 站 videoshot 接口的 data 载荷（类型谓词窄化，替代 as 断言）
 *
 * @param value - 接口 JSON 解析结果
 * @returns 形状合法返回 true，并将 value 收窄为 VideoshotApiResponse
 */
export function isVideoshotData(value: unknown): value is VideoshotApiResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("pvdata" in value) ||
    !("img_x_len" in value) ||
    !("img_y_len" in value) ||
    !("img_x_size" in value) ||
    !("img_y_size" in value) ||
    !("image" in value) ||
    !("index" in value)
  ) {
    return false;
  }
  const v = value;
  return (
    typeof v.pvdata === "string" &&
    typeof v.img_x_len === "number" &&
    v.img_x_len > 0 &&
    typeof v.img_y_len === "number" &&
    v.img_y_len > 0 &&
    typeof v.img_x_size === "number" &&
    v.img_x_size > 0 &&
    typeof v.img_y_size === "number" &&
    v.img_y_size > 0 &&
    Array.isArray(v.image) &&
    v.image.every((item) => typeof item === "string" && item.length > 0) &&
    Array.isArray(v.index) &&
    v.index.every((item) => typeof item === "number")
  );
}

/**
 * 归一化预览数据源：验证 B 站形状必备字段
 *
 * @param source - videoshot data 载荷
 * @returns 归一后的数据源；无可用数据返回 null
 */
export function normalizeDemoPreview(
  source?: VideoshotData | null,
): VideoshotData | null {
  return isVideoshotData(source) ? source : null;
}

/**
 * 解析 B 站 pvdata bin（uint16 小端数组）为截取时间表
 *
 * 格式（bilibili-API-collect「bin格式截取时间表」）：
 * - 每项 uint16 小端，2 字节对齐，与接口的 index JSON 数组一一对应；
 * - 第 0 项恒为 0（占位），从第 1 项开始是每张截图的截取时间（秒）。
 *
 * @param buffer - bin 文件的原始字节
 * @returns 时间表（第 0 项为占位 0）；字节数非法、首项非 0 或时间乱序返回 null
 */
export function parsePvdata(buffer: ArrayBuffer): number[] | null {
  // uint16 数组：字节数必须是 2 的倍数，且至少含占位 + 1 项
  if (buffer.byteLength < 4 || buffer.byteLength % 2 !== 0) return null;
  const view = new DataView(buffer);
  const count = buffer.byteLength / 2;
  const times: number[] = new Array(count);
  for (let i = 0; i < count; i += 1) times[i] = view.getUint16(i * 2, true);
  // B 站口径：第 0 项恒为 0；时间表从第 1 项起必须单调不减（不均匀截图也满足）
  if (times[0] !== 0) return null;
  for (let i = 2; i < count; i += 1) {
    if (times[i] < times[i - 1]) return null;
  }
  return times;
}

/**
 * 解析某个时间点应显示的预览切片（B 站时间表查帧写法）
 *
 * @param source - B 站 videoshot 数据源（未归一也可）
 * @param time - 悬停时间（秒）
 * @param duration - 视频总时长（秒；仅均匀换算兜底时使用）
 * @returns 预览帧（含对应拼版 URL 与雪碧图裁切样式）；无可用数据时返回 null
 */
function resolveDemoPreviewFrame(
  source: VideoshotData | null | undefined,
  time: number,
  duration: number,
): ProgressPreviewFrame | null {
  const normalized = normalizeDemoPreview(source);
  if (!normalized) return null;

  const { img_x_len, img_y_len, img_x_size, img_y_size, image, times } = normalized;
  const tilesPerSheet = img_x_len * img_y_len;

  /** 0 起的帧序号（时间表命中项 i 对应帧 k = i - 1） */
  let frameIndex: number;
  if (times !== null && times.length > 1) {
    // B 站写法：时间表里二分找「最后一个 ≤ 悬停时间」的项。
    // times[0] 是占位 0，times[i] 是第 i 张截图的秒数；悬停时间早于第一张
    // 截图时显示第 1 帧（第 0 帧即视频 0 秒处）。
    let lo = 1;
    let hi = times.length - 1;
    let hit = 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= time) {
        hit = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    frameIndex = hit - 1;
  } else {
    // 兜底：没有时间表（bin 与 index 都不可用）时按「帧数均分总时长」换算。
    // 每张拼版 img_x_len * img_y_len 格，下标 clamp 到 total-1 永不越界。
    // 注意末张留空（B 站行为）时此换算可能裁到黑格——B 站前端在无 index 时同理；
    // 正常链路走时间表二分，帧号不会超过实际帧数，不会碰到空格。
    if (duration <= 0) return null;
    const ratio = Math.max(0, Math.min(1, time / duration));
    const total = image.length * tilesPerSheet;
    frameIndex = Math.min(total - 1, Math.floor(ratio * total));
  }
  if (frameIndex < 0) return null;

  // 先定位拼版，再在拼版内拆行列
  const sheet = Math.floor(frameIndex / tilesPerSheet);
  const localIndex = frameIndex % tilesPerSheet;
  const col = localIndex % img_x_len;
  const row = Math.floor(localIndex / img_x_len);
  const url = image[sheet];
  if (!url) return null;

  return {
    url,
    width: `${img_x_size}px`,
    height: `${img_y_size}px`,
    objectFit: "none",
    objectPosition: `-${col * img_x_size}px -${row * img_y_size}px`,
  };
}

/**
 * 创建预览图 Provider
 *
 * 包装一份已拉取好的 B 站 videoshot 数据源，返回播放器可消费的 provider 函数：
 * 播放器进度条悬停时按「悬停时间 + 总时长」调用，demo 侧换算出预览帧返回。
 *
 * @param source - 由 mock-server 拉取并归一后的数据源；null 时 provider 恒返回 null
 * @returns 预览图 provider（同步实现：数据已在内存，换算是纯计算）
 */
export function createPreviewProvider(
  source: VideoshotData | null,
): ProgressPreviewProvider {
  return (time, duration): ProgressPreviewFrame | null =>
    resolveDemoPreviewFrame(source, time, duration);
}

/**
 * 可变预览 Provider（运行期切换数据源用）
 *
 * 播放器的 previewProvider 在每次进度条悬停时同步调用（不缓存结果），
 * 因此把数据源放在闭包外的可变槽里、provider 每次调用时读取当前值，
 * 即可实现「不重建播放器、切换后下一次悬停立即生效」。
 */
export interface MutablePreviewProvider {
  /** 播放器可消费的 provider（始终读取最新数据源） */
  readonly provider: ProgressPreviewProvider;
  /** 替换数据源：立即对后续悬停生效（null = 清空预览） */
  setSource(source: VideoshotData | null): void;
}

/**
 * 创建可变预览 Provider
 *
 * @param initial - 初始数据源；null 表示暂无预览（后续可 setSource 补上）
 * @returns 带替换接口的 provider 持有器
 */
export function createMutablePreviewProvider(
  initial: VideoshotData | null,
): MutablePreviewProvider {
  let current = initial;
  return {
    provider: (time, duration): ProgressPreviewFrame | null =>
      resolveDemoPreviewFrame(current, time, duration),
    setSource(source: VideoshotData | null): void {
      current = source;
    },
  };
}
