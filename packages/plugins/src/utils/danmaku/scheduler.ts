/**
 * 高性能弹幕系统 - 调度器
 * 管理弹幕分段加载和智能渲染调度
 */

import type { DanmakuItem, DanmakuSegment } from './types';

/** 调度器配置 */
interface SchedulerConfig {
  /** 分段时长 (秒) */
  segmentDuration: number;
  /** 预加载分段数 */
  preloadSegments: number;
  /** 最大缓存分段数 */
  maxCachedSegments: number;
  /** 渲染延迟 (毫秒) */
  renderDelay: number;
  /** 密度限制 (0-1) */
  densityLimit: number;
}

/** 分段加载回调 */
type SegmentLoadCallback = (startTime: number, endTime: number) => Promise<DanmakuItem[]>;

export class DanmakuScheduler {
  private config: SchedulerConfig;
  private segments: Map<number, DanmakuSegment> = new Map();
  private loadCallback: SegmentLoadCallback | null = null;

  // 状态
  private currentSegmentIndex = -1;
  private loadedRanges: Array<{ start: number; end: number }> = [];
  // 已经交给渲染引擎的弹幕。避免在时间窗口内每帧重复发射同一条弹幕。
  private emittedBySegment: Map<number, Set<string>> = new Map();
  private lastCurrentTime = -1;
  private worker: Worker | null = null;
  private workerRequestId = 0;
  private workerRequests = new Map<number, (keys: string[]) => void>();
  private workerItems = new Map<string, DanmakuItem>();
  private workerPendingItems: Array<{ key: string; time: number }> = [];
  private workerFlushScheduled = false;

  // 性能统计
  private stats = {
    totalLoaded: 0,
    totalRendered: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = {
      segmentDuration: 30, // 30秒一个分段
      preloadSegments: 2, // 预加载前后2个分段
      maxCachedSegments: 10, // 最多缓存10个分段
      renderDelay: 100, // 100ms渲染延迟
      densityLimit: 1, // 默认密度100%
      ...config,
    };

    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./scheduler.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (
          event: MessageEvent<{ type: string; requestId: number; keys: string[] }>
        ): void => {
          if (event.data.type !== 'result') return;
          const resolve = this.workerRequests.get(event.data.requestId);
          if (!resolve) return;
          this.workerRequests.delete(event.data.requestId);
          resolve(event.data.keys);
        };
        this.worker.onerror = (): void => {
          this.worker?.terminate();
          this.worker = null;
          for (const resolve of this.workerRequests.values()) resolve([]);
          this.workerRequests.clear();
        };
      } catch {
        this.worker = null;
      }
    }
  }

  /**
   * 设置分段加载回调
   * @param callback 加载回调
   */
  setLoadCallback(callback: SegmentLoadCallback): void {
    this.loadCallback = callback;
  }

  /**
   * 设置当前时间
   * @param time 时间 (秒)
   */
  setCurrentTime(time: number): void {
    const segmentIndex = Math.floor(time / this.config.segmentDuration);

    // 回退/跳转时允许重新发射对应时间段的弹幕。
    if (this.lastCurrentTime >= 0 && time < this.lastCurrentTime - 0.05) {
      this.emittedBySegment.clear();
      this.worker?.postMessage({ type: 'reset' });
    }
    this.lastCurrentTime = time;

    if (segmentIndex !== this.currentSegmentIndex) {
      this.currentSegmentIndex = segmentIndex;
      this.onSegmentChange(segmentIndex);
    }
  }

  /**
   * 分段变化处理
   * @param index 分段索引
   */
  private onSegmentChange(index: number): void {
    // 预加载附近分段
    this.preloadSegments(index);

    // 清理过期缓存
    this.cleanupCache(index);
  }

  /**
   * 预加载分段
   * @param centerIndex 中心分段索引
   */
  private async preloadSegments(centerIndex: number): Promise<void> {
    if (!this.loadCallback) return;

    const startIndex = Math.max(0, centerIndex - this.config.preloadSegments);
    const endIndex = centerIndex + this.config.preloadSegments;

    for (let i = startIndex; i <= endIndex; i++) {
      if (!this.segments.has(i)) {
        await this.loadSegment(i);
      }
    }
  }

  /**
   * 加载单个分段
   * @param index 分段索引
   */
  private async loadSegment(index: number): Promise<void> {
    if (!this.loadCallback || this.segments.has(index)) return;

    const startTime = index * this.config.segmentDuration;
    const endTime = startTime + this.config.segmentDuration;

    try {
      const danmakuList = await this.loadCallback(startTime, endTime);

      // 创建分段
      const segment: DanmakuSegment = {
        index,
        startTime,
        endTime,
        danmakuList: this.processDanmakuList(danmakuList),
        loaded: true,
      };

      this.segments.set(index, segment);
      this.stats.totalLoaded += danmakuList.length;
      this.registerWorkerItems(index, segment.danmakuList);

      // 更新加载范围
      this.updateLoadedRanges();
    } catch (error) {
      console.error(`Failed to load segment ${index}:`, error);
    }
  }

  /**
   * 处理弹幕列表
   * @param list 原始弹幕列表
   * @returns 处理后的列表
   */
  private processDanmakuList(list: DanmakuItem[]): DanmakuItem[] {
    // 按时间排序
    const sorted = list.sort((a, b) => a.time - b.time);

    // 应用密度限制
    if (this.config.densityLimit < 1) {
      const limit = Math.ceil(sorted.length * this.config.densityLimit);
      return sorted.slice(0, limit);
    }

    return sorted;
  }

  /**
   * 更新已加载范围
   */
  private updateLoadedRanges(): void {
    const indices = Array.from(this.segments.keys()).sort((a, b) => a - b);

    this.loadedRanges = [];
    let currentRange: { start: number; end: number } | null = null;

    for (const index of indices) {
      if (!currentRange) {
        currentRange = { start: index, end: index };
      } else if (index === currentRange.end + 1) {
        currentRange.end = index;
      } else {
        this.loadedRanges.push(currentRange);
        currentRange = { start: index, end: index };
      }
    }

    if (currentRange) {
      this.loadedRanges.push(currentRange);
    }
  }

  /**
   * 清理缓存
   * @param currentIndex 当前分段索引
   */
  private cleanupCache(currentIndex: number): void {
    const maxDistance = this.config.maxCachedSegments;

    for (const [index] of this.segments) {
      const distance = Math.abs(index - currentIndex);
      if (distance > maxDistance) {
        this.segments.delete(index);
        this.emittedBySegment.delete(index);
      }
    }

    // 已经离开屏幕很久的发射记录也不应无限增长。
    for (const [index] of this.emittedBySegment) {
      if (Math.abs(index - currentIndex) > maxDistance) {
        this.emittedBySegment.delete(index);
      }
    }
  }

  /**
   * 获取当前时间需要渲染的弹幕
   * @param currentTime 当前时间 (秒)
   * @param limit 最大返回数量（避免卡顿）
   * @param timeWindow 时间窗口 (秒)
   * @returns 需要渲染的弹幕列表
   */
  getDanmakuToRender(
    currentTime: number,
    limit: number = 20,
    timeWindow: number = 0.5
  ): DanmakuItem[] {
    const result: DanmakuItem[] = [];
    // 留出少量回看窗口，避免主线程忙时跨过某条弹幕的时间点；emitted 集合保证不会重复。
    const startTime = Math.max(0, currentTime - this.config.renderDelay / 1000);
    const endTime = currentTime + timeWindow;

    // 计算涉及的分段
    const startSegment = Math.floor(startTime / this.config.segmentDuration);
    const endSegment = Math.floor(endTime / this.config.segmentDuration);

    for (let i = startSegment; i <= endSegment && result.length < limit; i++) {
      const segment = this.segments.get(i);
      if (!segment) {
        this.stats.cacheMisses++;
        continue;
      }

      this.stats.cacheHits++;

      const emitted = this.emittedBySegment.get(i) || new Set<string>();
      this.emittedBySegment.set(i, emitted);

      // 分段数据已按时间排序；从窗口起点二分查找，避免每帧扫描整个分段。
      let low = 0;
      let high = segment.danmakuList.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (segment.danmakuList[mid].time < startTime) low = mid + 1;
        else high = mid;
      }

      // 筛选窗口内且尚未发射的弹幕
      for (let index = low; index < segment.danmakuList.length; index++) {
        const danmaku = segment.danmakuList[index];
        if (danmaku.time > endTime) break;
        const key = String(danmaku.id);
        if (emitted.has(key)) continue;
        if (danmaku.time >= startTime && danmaku.time <= endTime) {
          result.push(danmaku);
          emitted.add(key);
          if (result.length >= limit) {
            break;
          }
        }
      }
    }

    this.stats.totalRendered += result.length;
    return result;
  }

  getDanmakuToRenderAsync(
    currentTime: number,
    limit: number = 20,
    timeWindow: number = 0.5
  ): Promise<DanmakuItem[]> {
    if (!this.worker)
      return Promise.resolve(this.getDanmakuToRender(currentTime, limit, timeWindow));
    const requestId = ++this.workerRequestId;
    const startTime = Math.max(0, currentTime - this.config.renderDelay / 1000);
    const endTime = currentTime + timeWindow;
    return new Promise((resolve) => {
      // 单次查询的 settle 守卫：正常回包 / 超时兜底只取先到者，防止 resolve 重复调用
      let settled = false;
      const finish = (keys: string[]): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        this.workerRequests.delete(requestId);
        const result = keys
          .map((key) => this.workerItems.get(key))
          .filter((item): item is DanmakuItem => item !== undefined);
        this.stats.totalRendered += result.length;
        resolve(result);
      };

      // Worker 响应超时兜底：
      // 主线程被节流（后台标签页 / 无渲染环境）或 Worker 静默无响应时，
      // result 消息永远无法派发，renderQueryPending 将永久卡死、弹幕停发。
      // 超时即终止 Worker 并降级为同步查询路径，保证渲染链路始终有可靠回退。
      const timeoutId = setTimeout(() => {
        this.worker?.terminate();
        this.worker = null;
        // 唤醒其余在途请求（全部按空结果结算）
        this.workerRequests.forEach((pending) => pending([]));
        this.workerRequests.clear();
        finish([]);
      }, 1000);

      this.workerRequests.set(requestId, finish);
      this.worker?.postMessage({ type: 'query', requestId, startTime, endTime, limit });
    });
  }

  /**
   * 获取当前屏幕上应该显示的所有弹幕（用于快进后恢复显示）
   * @param currentTime 当前时间 (秒)
   * @param limit 最大返回数量
   * @returns 需要渲染的弹幕列表
   */
  getDanmakuOnScreen(currentTime: number, limit: number = 50): DanmakuItem[] {
    const result: DanmakuItem[] = [];

    // 估算弹幕在屏幕上的显示时间（通常8-10秒）
    const screenDuration = 10;
    const startTime = Math.max(0, currentTime - screenDuration);
    const endTime = currentTime + 1; // 未来1秒的弹幕也要显示

    // 计算涉及的分段
    const startSegment = Math.floor(startTime / this.config.segmentDuration);
    const endSegment = Math.floor(endTime / this.config.segmentDuration);

    for (let i = startSegment; i <= endSegment && result.length < limit; i++) {
      const segment = this.segments.get(i);
      if (!segment) continue;

      // 筛选在屏幕显示时间范围内的弹幕
      for (const danmaku of segment.danmakuList) {
        // 弹幕应该已经显示（time <= currentTime）
        // 且还没有移出屏幕（time + screenDuration > currentTime）
        if (danmaku.time <= currentTime && danmaku.time + screenDuration > currentTime) {
          result.push(danmaku);
          if (result.length >= limit) {
            break;
          }
        }
      }
    }

    return result;
  }

  /**
   * 添加弹幕到当前分段
   * @param danmaku 弹幕数据
   */
  addDanmaku(danmaku: DanmakuItem): void {
    const segmentIndex = Math.floor(danmaku.time / this.config.segmentDuration);
    let segment = this.segments.get(segmentIndex);

    // 如果分段不存在，创建新分段
    if (!segment) {
      const startTime = segmentIndex * this.config.segmentDuration;
      const endTime = startTime + this.config.segmentDuration;
      segment = {
        index: segmentIndex,
        startTime,
        endTime,
        danmakuList: [],
        loaded: true,
      };
      this.segments.set(segmentIndex, segment);
    }

    // 二分插入保持有序，避免每次 insert 都全量 sort（单条弹幕场景，O(log n) 定位 + O(n) 移位）
    const list = segment.danmakuList;
    let low = 0;
    let high = list.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (list[mid].time <= danmaku.time) low = mid + 1;
      else high = mid;
    }
    list.splice(low, 0, danmaku);
    this.registerWorkerItems(segmentIndex, [danmaku]);
  }

  /**
   * 批量加载弹幕（首次加载大量弹幕时的专用入口）。
   *
   * 与逐条 addDanmaku 的关键区别：每个分段只排序一次，
   * 而不是「每插入一条就全量 sort」，把 O(n²·log n) 降到 O(n·log n)，
   * 10 万条弹幕首次加载不再卡顿。
   */
  loadDanmakuBatch(list: DanmakuItem[]): void {
    if (list.length === 0) return;

    // 1. 按分段分组
    const bySegment = new Map<number, DanmakuItem[]>();
    for (const item of list) {
      const idx = Math.floor(item.time / this.config.segmentDuration);
      const arr = bySegment.get(idx);
      if (arr) arr.push(item);
      else bySegment.set(idx, [item]);
    }

    // 2. 每个分段排序一次，合并进已有分段
    for (const [idx, arr] of bySegment) {
      arr.sort((a, b) => a.time - b.time);

      let segment = this.segments.get(idx);
      if (!segment) {
        segment = {
          index: idx,
          startTime: idx * this.config.segmentDuration,
          endTime: (idx + 1) * this.config.segmentDuration,
          danmakuList: [],
          loaded: true,
        };
        this.segments.set(idx, segment);
      }

      segment.danmakuList =
        segment.danmakuList.length === 0
          ? arr
          : segment.danmakuList.concat(arr).sort((a, b) => a.time - b.time);

      this.stats.totalLoaded += arr.length;
      this.registerWorkerItems(idx, arr);
    }

    this.updateLoadedRanges();
  }

  private registerWorkerItems(segmentIndex: number, list: DanmakuItem[]): void {
    if (!this.worker) return;
    for (const item of list) {
      const key = `${segmentIndex}:${String(item.id)}`;
      this.workerItems.set(key, item);
      this.workerPendingItems.push({ key, time: item.time });
    }
    if (this.workerFlushScheduled || this.workerPendingItems.length === 0) return;
    this.workerFlushScheduled = true;
    Promise.resolve().then(() => {
      this.workerFlushScheduled = false;
      if (!this.worker || this.workerPendingItems.length === 0) return;
      const pending = this.workerPendingItems.splice(0);
      this.worker.postMessage({ type: 'add', items: pending });
    });
  }

  /**
   * 预加载指定时间范围
   * @param startTime 开始时间
   * @param endTime 结束时间
   */
  async preloadRange(startTime: number, endTime: number): Promise<void> {
    const startSegment = Math.floor(startTime / this.config.segmentDuration);
    const endSegment = Math.floor(endTime / this.config.segmentDuration);

    for (let i = startSegment; i <= endSegment; i++) {
      if (!this.segments.has(i)) {
        await this.loadSegment(i);
      }
    }
  }

  /**
   * 检查是否已加载
   * @param time 时间
   * @returns 是否已加载
   */
  isLoaded(time: number): boolean {
    const segmentIndex = Math.floor(time / this.config.segmentDuration);
    return this.segments.has(segmentIndex);
  }

  /**
   * 获取已加载范围
   * @returns 已加载范围列表
   */
  getLoadedRanges(): Array<{ start: number; end: number }> {
    return this.loadedRanges.map((range) => ({
      start: range.start * this.config.segmentDuration,
      end: (range.end + 1) * this.config.segmentDuration,
    }));
  }

  /**
   * 获取统计信息
   */
  getStats(): typeof this.stats & { cachedSegments: number } {
    return {
      ...this.stats,
      cachedSegments: this.segments.size,
    };
  }

  /** 清空渲染引擎后允许当前时间窗口重新发射弹幕。 */
  resetEmission(): void {
    this.emittedBySegment.clear();
    this.worker?.postMessage({ type: 'reset' });
  }

  /**
   * 标记弹幕为「已发射」（本地发送立即渲染场景专用）
   *
   * sendDanmaku 的链路是「入调度器 + 立即渲染」，若不在此标记，
   * 下一帧查询窗口 [t - renderDelay, t + 0.5] 仍然覆盖刚发送的时间点，
   * 主线程 emittedBySegment 与 Worker emitted 集合均无该条记录，
   * 调度器会再次发射同一条弹幕 → 屏幕出现两条一模一样的弹幕。
   * @param danmaku 已被立即渲染的弹幕（须在渲染前/后立即调用）
   */
  markEmitted(danmaku: DanmakuItem): void {
    // 主线程集合标记（key 与 getDanmakuToRender 的 String(id) 一致）
    const segmentIndex = Math.floor(
      danmaku.time / this.config.segmentDuration,
    );
    const key = String(danmaku.id);
    const emitted = this.emittedBySegment.get(segmentIndex) || new Set<string>();
    emitted.add(key);
    this.emittedBySegment.set(segmentIndex, emitted);

    // Worker 侧同步标记（key 与 registerWorkerItems 的 `${segmentIndex}:${id}` 一致）
    this.worker?.postMessage({
      type: 'markEmitted',
      keys: [`${segmentIndex}:${key}`],
    });
  }

  /**
   * 更新配置
   * @param config 配置
   */
  updateConfig(config: Partial<SchedulerConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * 重置
   */
  reset(): void {
    this.segments.clear();
    this.currentSegmentIndex = -1;
    this.loadedRanges = [];
    this.emittedBySegment.clear();
    this.lastCurrentTime = -1;
    this.workerItems.clear();
    this.workerPendingItems.length = 0;
    this.worker?.postMessage({ type: 'clear' });
    this.stats = {
      totalLoaded: 0,
      totalRendered: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.reset();
    this.loadCallback = null;
    this.worker?.postMessage({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    this.workerRequests.clear();
  }
}
