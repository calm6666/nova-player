/**
 * ============================================
 * 缓冲速度采样（字节/秒）
 * ============================================
 *
 * 为 State 组件「正在缓冲... <速度>」文本提供真实的字节级数据源，
 * 两条路径按优先级回退：
 *
 * 1. 流媒体路径（HLS / DASH / FLV）：使用插件统计
 *    （`StreamStats.downloadSpeed`，单位即字节/秒，见 types/streamPlugin.ts），
 *    由调用方通过 `getStreamSpeed` 注入
 *    （VideoPlayer → StreamMiddleware → 插件 getStats()）。
 * 2. 原生路径（渐进式 MP4 / WebM 等）：插件不上报下载速度，
 *    改用 PerformanceObserver 观察 resource 条目，按媒体资源的
 *    transferSize / encodedBodySize / decodedBodySize 与传输耗时算吞吐量。
 *
 * 取不到真实数据（能力不支持、跨域无 Timing-Allow-Origin、窗口内没有
 * 已完成的条目、MSE 场景下段请求无法归因到媒体元素）时统一返回 0，
 * 由调用方隐藏速度文本，不显示「0.0MB/S」这类无意义的假数据。
 */

import { isBrowser } from '@lumina/framework/utils';

/** 原生路径滑动窗口时长（毫秒）：只统计最近这段时间内完成的资源条目 */
const WINDOW_MS = 5000;

/** 参与统计的资源条目 */
interface ResourceSample {
  /** 条目完成时刻（performance.now() 时间轴的 responseEnd） */
  time: number;
  /** 传输字节数 */
  bytes: number;
  /** 该条目的传输耗时（秒） */
  duration: number;
}

/**
 * 缓冲速度采样器选项
 */
export interface BufferSpeedSamplerOptions {
  /**
   * 流媒体插件下载速度提供者（字节/秒）
   * 无数据时返回 0 / NaN / 负数即可，采样器会回退到原生 Resource Timing 路径
   */
  getStreamSpeed?: () => number;
  /** 当前媒体资源地址（用于过滤 Resource Timing 条目；取不到时按元素类型过滤） */
  getMediaUrl?: () => string | undefined;
}

/**
 * 缓冲速度采样器
 */
export interface BufferSpeedSampler {
  /**
   * 采样一次
   * @returns 当前下载速度（字节/秒）；无有效数据返回 0
   */
  sample(): number;
  /** 释放观察器与内部缓存 */
  destroy(): void;
}

/**
 * 是否为正的有限速度值
 * @param value - 待校验的值
 */
function isValidSpeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * 去掉 URL 的查询串 / 哈希，便于资源条目与当前媒体地址比对
 * @param url - 原始地址
 */
function stripUrlTail(url: string): string {
  return url.split('#')[0].split('?')[0];
}

/**
 * 判断资源条目是否属于当前媒体资源
 * @param name - 资源地址
 * @param initiatorType - 发起者类型
 * @param mediaUrl - 当前媒体地址
 */
function isMediaEntry(
  name: string,
  initiatorType: string,
  mediaUrl: string | undefined,
): boolean {
  // 取不到媒体地址时退化为「媒体元素发起」判断
  if (!mediaUrl) return initiatorType === 'video' || initiatorType === 'audio';
  // MSE（HLS / DASH）场景下 video.currentSrc 是 blob:，分片请求由流媒体库自行发起，
  // 无法归因到媒体元素，此时只接受 video / audio 发起的条目
  if (mediaUrl.startsWith('blob:')) {
    return initiatorType === 'video' || initiatorType === 'audio';
  }
  const target = stripUrlTail(mediaUrl);
  const candidate = stripUrlTail(name);
  if (candidate === target) return true;
  // 字节范围请求 / 参数顺序差异会导致字面量不等，退化为路径比较
  try {
    return new URL(candidate).pathname === new URL(target).pathname;
  } catch {
    return false;
  }
}

/**
 * 取条目的传输字节数
 *
 * transferSize 含响应头，最接近真实网络传输量；跨域且无 Timing-Allow-Origin 时
 * 三者均为 0，此时返回 0 由调用方跳过（不伪造速度）。
 * @param entry - Resource Timing 条目
 */
function pickBytes(entry: PerformanceResourceTiming): number {
  return entry.transferSize || entry.encodedBodySize || entry.decodedBodySize || 0;
}

/**
 * 取条目传输耗时（秒）
 * @param entry - Resource Timing 条目
 */
function pickDuration(entry: PerformanceResourceTiming): number {
  return Math.max(0, entry.responseEnd - entry.startTime) / 1000;
}

/**
 * 创建缓冲速度采样器
 *
 * @param options - 采样器选项
 * @returns 采样器实例（`sample()` 返回字节/秒，无数据为 0）
 *
 * @example
 * const sampler = createBufferSpeedSampler({
 *   getStreamSpeed: () => stats?.downloadSpeed ?? 0,
 *   getMediaUrl: () => video.currentSrc,
 * });
 * sampler.sample(); // 1536000（约 1.5MB/S）
 * sampler.destroy();
 */
export function createBufferSpeedSampler(
  options: BufferSpeedSamplerOptions = {},
): BufferSpeedSampler {
  /** 观察器路径下窗口内已完成的媒体资源条目（按 responseEnd 递增） */
  const samples: ResourceSample[] = [];

  /** 是否运行在浏览器且具备 Resource Timing 能力（SSR 安全） */
  const supported =
    isBrowser() &&
    typeof performance !== 'undefined' &&
    typeof performance.now === 'function';

  /**
   * 收集一条资源条目
   * @param entry - Resource Timing 条目
   */
  const collect = (entry: PerformanceResourceTiming): void => {
    if (!isMediaEntry(entry.name, entry.initiatorType, options.getMediaUrl?.())) {
      return;
    }
    const bytes = pickBytes(entry);
    if (bytes <= 0) return;
    samples.push({
      time: entry.responseEnd,
      bytes,
      duration: pickDuration(entry),
    });
  };

  /** Resource Timing 观察器（不支持时走 getEntriesByType 兜底） */
  let observer: PerformanceObserver | null = null;
  if (supported && typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.entryType === 'resource') {
            collect(entry as PerformanceResourceTiming);
          }
        });
      });
      // buffered: true 可补取观察器创建前已完成的条目
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // 部分环境不支持 type / buffered 选项，降级到 Resource Timing 缓冲区
      observer = null;
    }
  }

  /**
   * 观察器不可用时，直接从 Resource Timing 缓冲区读取条目（每次重算，天然去重）
   * @param now - 当前时刻（performance.now()）
   * @returns 窗口内吞吐量（字节/秒）；无数据返回 0
   */
  const sampleFromBuffer = (now: number): number => {
    if (typeof performance.getEntriesByType !== 'function') return 0;
    const entries = performance.getEntriesByType(
      'resource',
    ) as PerformanceResourceTiming[];
    const mediaUrl = options.getMediaUrl?.();
    let bytes = 0;
    let duration = 0;
    entries.forEach((entry) => {
      if (now - entry.responseEnd > WINDOW_MS) return;
      if (!isMediaEntry(entry.name, entry.initiatorType, mediaUrl)) return;
      const size = pickBytes(entry);
      if (size <= 0) return;
      bytes += size;
      duration += pickDuration(entry);
    });
    return duration > 0 ? bytes / duration : 0;
  };

  /**
   * 丢弃窗口外的条目
   * @param now - 当前时刻（performance.now()）
   */
  const prune = (now: number): void => {
    while (samples.length > 0 && now - samples[0].time > WINDOW_MS) {
      samples.shift();
    }
  };

  return {
    sample: (): number => {
      // 1) 流媒体路径：插件统计优先（单位已是字节/秒）
      const streamSpeed = options.getStreamSpeed?.();
      if (isValidSpeed(streamSpeed)) return streamSpeed;

      // 2) 原生路径：Resource Timing 滑动窗口
      if (!supported) return 0;
      const now = performance.now();
      if (!observer) return sampleFromBuffer(now);

      prune(now);
      if (samples.length === 0) return 0;

      let bytes = 0;
      let duration = 0;
      samples.forEach((item) => {
        bytes += item.bytes;
        duration += item.duration;
      });
      // 吞吐量口径与 hls.js / DASH 一致：窗口内总字节 / 总传输耗时
      return duration > 0 ? bytes / duration : 0;
    },
    destroy: (): void => {
      observer?.disconnect();
      observer = null;
      samples.length = 0;
    },
  };
}
