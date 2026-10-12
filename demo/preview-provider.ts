/**
 * ============================================
 * Demo 预览图 Provider 实现（外部数据获取示例）
 * ============================================
 * 播放器不内置预览数据获取：demo 侧自行拉取 mock-server 的雪碧图 /
 * 逐帧数据，按悬停时间换算预览帧后返回给播放器（ProgressPreview API）。
 *
 * 数据形态（与 mock-server 对应）：
 * - 雪碧图：一张大图 + img_x_len/img_y_len/img_x_size/img_y_size，
 *   按切片下标裁切（objectPosition 负偏移），B 站形状；
 * - 逐帧列表：`/videoshot/preview.bin`，`\u001f` 分隔的 jpeg data URL。
 */

import type {
  ProgressPreviewFrame,
  ProgressPreviewProvider,
} from "@/types";

/**
 * 预览数据源（两种形态兼容）
 *
 * 从 mock-server 拉取后由 demo 归一保存：
 * - frames：逐帧预览图（data URL 数组），preview.bin 形态；
 * - imgUrl + imgXLen/imgYLen/imgXSize/imgYSize：雪碧图形态。
 */
export interface DemoPreviewSource {
  /** 逐帧预览图（data URL 数组），preview.bin 形态 */
  frames?: string[];
  /** 雪碧图地址，sprite 形态 */
  imgUrl?: string;
  /** 雪碧图列数 */
  imgXLen?: number;
  /** 雪碧图行数 */
  imgYLen?: number;
  /** 单格宽（像素） */
  imgXSize?: number;
  /** 单格高（像素） */
  imgYSize?: number;
  /** 切片总数（缺省取 imgXLen * imgYLen；index 数组长度更准时可显式传入） */
  sliceCount?: number;
}

/**
 * 归一化预览数据源：验证两类形态各自必备的字段
 *
 * @param source - 逐帧数组或结构化数据源
 * @returns 归一后的数据源；无可用数据返回 null
 */
export function normalizeDemoPreview(
  source?: DemoPreviewSource | string[] | null,
): DemoPreviewSource | null {
  if (!source) return null;
  if (Array.isArray(source)) {
    return source.length > 0 ? { frames: source } : null;
  }
  if (Array.isArray(source.frames) && source.frames.length > 0) {
    return { ...source, frames: source.frames };
  }
  const { imgUrl, imgXLen, imgYLen } = source;
  if (
    typeof imgUrl === "string" &&
    imgUrl.length > 0 &&
    typeof imgXLen === "number" &&
    imgXLen > 0 &&
    typeof imgYLen === "number" &&
    imgYLen > 0
  ) {
    return { ...source, imgUrl, imgXLen, imgYLen };
  }
  return null;
}

/**
 * 解析某个时间点应显示的预览切片（纯函数，迁移自播放器内部实现）
 *
 * @param source - 预览数据源（未归一也可）
 * @param time - 悬停时间（秒）
 * @param duration - 视频总时长（秒）
 * @returns 预览帧（含雪碧图裁切样式）；无可用数据或时长非法时返回 null
 */
function resolveDemoPreviewFrame(
  source: DemoPreviewSource | string[] | null | undefined,
  time: number,
  duration: number,
): ProgressPreviewFrame | null {
  const normalized = normalizeDemoPreview(source);
  if (!normalized || duration <= 0) return null;

  /** 悬停位置在整条时间轴上的比例（钳制在 [0, 1]） */
  const ratio = Math.max(0, Math.min(1, time / duration));

  // 逐帧模式：按比例换算帧下标，直接返回该帧的 URL
  if (normalized.frames && normalized.frames.length > 0) {
    const index = Math.min(
      normalized.frames.length - 1,
      Math.floor(ratio * normalized.frames.length),
    );
    const url = normalized.frames[index];
    if (!url) return null;
    return { url };
  }

  // 雪碧图模式：按比例换算切片下标，再拆出所在行列并生成裁切偏移
  const { imgUrl, imgXLen, imgYLen, imgXSize, imgYSize } = normalized;
  if (!imgUrl || !imgXLen || !imgYLen) return null;

  const total = normalized.sliceCount ?? imgXLen * imgYLen;
  const index = Math.min(total - 1, Math.floor(ratio * total));
  if (index < 0) return null;

  const col = index % imgXLen;
  const row = Math.floor(index / imgXLen);
  const width = imgXSize ?? 160;
  const height = imgYSize ?? 90;

  return {
    url: imgUrl,
    width: `${width}px`,
    height: `${height}px`,
    objectFit: "none",
    objectPosition: `-${col * width}px -${row * height}px`,
  };
}

/**
 * 创建预览图 Provider
 *
 * 包装一份已拉取好的预览数据源，返回播放器可消费的 provider 函数：
 * 播放器进度条悬停时按「悬停时间 + 总时长」调用，demo 侧换算出预览帧返回。
 *
 * @param source - 由 mock-server 拉取并归一后的预览数据源；null 时 provider 恒返回 null
 * @returns 预览图 provider（同步实现：数据已在内存，换算是纯计算）
 */
export function createPreviewProvider(
  source: DemoPreviewSource | string[] | null,
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
  setSource(source: DemoPreviewSource | string[] | null): void;
}

/**
 * 创建可变预览 Provider
 *
 * 与 {@link createPreviewProvider} 的区别：数据源可以运行期替换
 * （雪碧图 ↔ 逐帧 bin 切换），播放器实例与进度条控件全程复用。
 *
 * @param initial - 初始数据源；null 表示暂无预览（后续可 setSource 补上）
 * @returns 带替换接口的 provider 持有器
 */
export function createMutablePreviewProvider(
  initial: DemoPreviewSource | string[] | null,
): MutablePreviewProvider {
  let current = initial;
  return {
    provider: (time, duration): ProgressPreviewFrame | null =>
      resolveDemoPreviewFrame(current, time, duration),
    setSource(source: DemoPreviewSource | string[] | null): void {
      current = source;
    },
  };
}
