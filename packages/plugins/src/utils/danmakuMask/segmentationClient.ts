/**
 * 弹幕防遮挡 —— 分割主线程客户端
 * ============================================================
 * 封装能力检测 + 分割 Worker 的生命周期：
 *
 * - `init()`：检测浏览器 GPU 能力；不支持则进入 mock 模式（不创建 Worker），
 *   支持则创建 Worker 并加载 MediaPipe 模型；
 * - `segment(video, timestamp)`：从视频抽一帧（OffscreenCanvas，不占 DOM），
 *   交给 Worker 分割，返回 SVG 轮廓结果；mock 模式下直接返回预置轮廓；
 * - `dispose()`：释放 Worker 与资源。
 *
 * 抽帧节流（sampleInterval）由调用方（如 VideoPlayer）控制，本类只负责单帧处理。
 */

import { CapabilityDetector } from './capabilityDetector';
import {
  DEFAULT_MASK_CONFIG,
  type CapabilityInfo,
  type MaskRegion,
  type SegmentationConfig,
  type SegmentationResult,
  type SegmentationWorkerRequest,
  type SegmentationWorkerResponse,
} from './types';

/** 抽帧画布边长（传给模型前的输入尺寸，保持宽高比、居中 letterbox） */
const EXTRACT_SIZE = 256;

export class DanmakuMaskSegmenter {
  private readonly config: SegmentationConfig;
  private capability: CapabilityInfo | null = null;
  private worker: Worker | null = null;
  private ready = false;
  private mock = false;
  private disposed = false;
  private nextId = 1;
  /** 最新一次分割请求的 id：结果回来时若小于它，说明已被更新的帧取代（stale） */
  private latestId = 0;

  /** 最近一次非过期分割结果（背压跳帧时复用，避免遮罩闪断） */
  private lastResult: SegmentationResult | null = null;

  /** 实时分割循环是否运行中（预处理模式） */
  private realtimeRunning = false;
  /** 实时循环的目标视频元素 */
  private realtimeVideo: HTMLVideoElement | null = null;

  private extractCanvas: OffscreenCanvas | null = null;

  private readonly pending = new Map<
    number,
    { resolve: (r: SegmentationResult) => void; reject: (e: Error) => void }
  >();

  private resolveReady: (() => void) | null = null;
  private rejectReady: ((e: Error) => void) | null = null;

  constructor(config?: Partial<SegmentationConfig>) {
    this.config = { ...DEFAULT_MASK_CONFIG, ...config };
  }

  /** 当前能力检测结果（init 后可用） */
  getCapability(): CapabilityInfo | null {
    return this.capability;
  }

  /**
   * 启动实时预处理分割循环（预处理「即将播放的帧」）
   *
   * 自驱串行流水线：按 sampleInterval 帧间隔「抽当前画面 → Worker 推理」，
   * 弹幕引擎的定时器只消费 getLatest() 缓存结果——遮罩延迟 =
   * 帧间隔 + 单帧推理耗时，且更新帧率不受引擎采样限制
   *
   * 幂等：已运行时重复调用直接返回
   */
  startRealtime(video: HTMLVideoElement): void {
    if (this.realtimeRunning) return;
    this.realtimeRunning = true;
    this.realtimeVideo = video;
    void this.runRealtimeLoop();
  }

  /** 停止实时分割循环（dispose 内也会调用） */
  stopRealtime(): void {
    this.realtimeRunning = false;
    this.realtimeVideo = null;
  }

  /**
   * 实时循环体：串行「抽帧 → 推理」，按帧间隔节流；
   * dispose/stopRealtime 后退出。抽帧失败（视频未就绪）时
   * 短暂等待重试，不空转
   *
   * 帧间隔节流（必须）：GPU 推理一次仅需 10~50ms，若「完成一帧立即
   * 下一帧」会以 20~100fps 满负荷推理——每帧都在 GPU 上分配缓冲区
   * （reusable_pool 警告刷屏）+ CPU-GPU 同步开销，把渲染进程拖死，
   * 视频解码被饿死导致播放卡死。轮廓变化慢（人物移动慢），
   * 按 sampleInterval（默认 300ms ≈ 3.3fps）节流后遮罩延迟
   * = 帧间隔 + 单帧推理耗时，肉眼无感而负载降一个数量级
   */
  private async runRealtimeLoop(): Promise<void> {
    // 相邻两次推理启动的最小间隔（毫秒）
    const frameInterval = Math.max(this.config.sampleInterval, 100);
    // 上一次推理启动时刻（performance.now 毫秒）
    let lastFrameAt = 0;
    while (this.realtimeRunning && !this.disposed) {
      const video = this.realtimeVideo;
      if (!video) break;
      try {
        // 视频未就绪（未开播/无画面）或模型未就绪时等待重试，避免忙转
        if (
          video.readyState < 2 ||
          video.videoWidth === 0 ||
          (!this.ready && !this.mock)
        ) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        // mock 降级模式无 Worker 推理，无实时意义，直接退出循环
        if (this.mock) break;
        // 暂停时画面静止：彻底不分割（含 seek 后暂停，遮罩
        // 残留由 getLatest 的过期判定自动清除），零 GPU 占用
        if (video.paused) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        // 帧间隔未到：睡到下一帧再试（节流是循环侧职责，
        // segment() 本身不感知间隔）
        const waitMs = frameInterval - (performance.now() - lastFrameAt);
        if (waitMs > 0) {
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        // 背压：上一帧推理在途时短等再试——segment() 背压分支是
        // 立即 resolve 的，直接 await 会造成零耗时空转
        if (this.pending.size > 0) {
          await new Promise((r) => setTimeout(r, 30));
          continue;
        }
        // timestamp 传视频媒体时间（结果回传后用于过期判定）
        lastFrameAt = performance.now();
        await this.segment(video, video.currentTime);
      } catch {
        // 单帧失败不终止循环（网络/瞬时异常），稍等后继续
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  /**
   * 取最新分割结果（实时循环的缓存消费者接口）
   *
   * @param videoTime 当前视频媒体时间（秒），用于判定结果是否过期：
   *                  结果帧时间距今超过阈值（暂停后旧帧/seek 遗留）
   *                  视为不可用，返回 null
   * @returns 最新结果；无可用结果或已过期返回 null
   */
  getLatest(videoTime: number): SegmentationResult | null {
    const result = this.lastResult;
    if (!result || result.noPerson || result.stale) return null;
    // 帧时间与当前播放位置偏差过大（>1.5s）视为过期
    if (Math.abs(videoTime - result.timestamp) > 1.5) return null;
    return result;
  }

  /** 是否处于 mock 降级模式 */
  isMock(): boolean {
    return this.mock;
  }

  /**
   * 初始化：检测能力并（可选）启动分割 Worker。
   * @returns 能力检测结果
   */
  async init(): Promise<CapabilityInfo> {
    const detector = new CapabilityDetector();
    this.capability = detector.detect(this.config.minFps);

    if (!this.capability.supported) {
      this.mock = true;
      return this.capability;
    }

    // 启动分割 Worker
    this.worker = new Worker(new URL('./segmentationWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<SegmentationWorkerResponse>) =>
      this.onMessage(event.data);
    this.worker.onerror = (event: ErrorEvent) => {
      const message = event.message || '分割 Worker 异常';
      if (!this.ready && this.rejectReady) this.rejectReady(new Error(message));
    };

    const readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.worker.postMessage({
      type: 'init',
      config: this.config,
      capability: this.capability,
    } satisfies SegmentationWorkerRequest);

    await readyPromise;
    return this.capability;
  }

  /**
   * 对视频当前帧做分割，返回 SVG 轮廓结果。
   *
   * @param video 视频元素
   * @param timestamp 时间戳（供模型 video 模式使用，用 performance.now() 即可）
   */
  segment(video: HTMLVideoElement, timestamp: number): Promise<SegmentationResult> {
    // 模型还没就绪 / 能力不足时：不再返回 mock 人形剪影（很丑），
    // 而是返回「无人」结果，调用方直接不设置遮罩，等真实模型就绪后自动切换。
    if (this.disposed || this.mock || !this.worker || !this.ready) {
      return Promise.resolve(this.emptyResult());
    }

    // 背压：上一帧还在推理中就跳过本帧，返回最近一次有效结果——
    // 无背压时慢设备上 worker 消息队列会积压，worker 逐帧白跑旧帧
    // （stale 丢弃只保正确性不省算力），且遮罩延迟持续增大；
    // 返回缓存而非 emptyResult，避免调用方误判 noPerson 触发遮罩闪断
    if (this.pending.size > 0) {
      return Promise.resolve(
        this.lastResult ?? this.emptyResult(),
      );
    }

    const { bitmap, region } = this.extractFrame(video);
    const id = this.nextId++;
    this.latestId = id;
    const worker = this.worker;

    return new Promise<SegmentationResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(
        { type: 'segment', id, bitmap, timestamp, region } satisfies SegmentationWorkerRequest,
        [bitmap]
      );
    });
  }

  /** 生成「无人」结果：不设置遮罩 */
  private emptyResult(): SegmentationResult {
    return {
      image: '',
      timestamp: Date.now(),
      isMock: false,
      width: this.config.maskWidth,
      height: this.config.maskHeight,
      noPerson: true,
    };
  }

  /** 释放资源 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // 停止实时分割循环
    this.stopRealtime();

    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' } satisfies SegmentationWorkerRequest);
      this.worker.terminate();
      this.worker = null;
    }
    this.pending.clear();
    this.ready = false;
  }

  /** 从视频抽一帧到 OffscreenCanvas（letterbox 居中），返回 bitmap 与视频区域 */
  private extractFrame(video: HTMLVideoElement): { bitmap: ImageBitmap; region: MaskRegion } {
    if (!this.extractCanvas) {
      this.extractCanvas = new OffscreenCanvas(EXTRACT_SIZE, EXTRACT_SIZE);
    }
    const ctx = this.extractCanvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 绘制上下文');

    const vw = video.videoWidth || EXTRACT_SIZE;
    const vh = video.videoHeight || EXTRACT_SIZE;
    const scale = Math.min(EXTRACT_SIZE / vw, EXTRACT_SIZE / vh);
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    const x = (EXTRACT_SIZE - w) / 2;
    const y = (EXTRACT_SIZE - h) / 2;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, EXTRACT_SIZE, EXTRACT_SIZE);
    ctx.drawImage(video, x, y, w, h);

    const bitmap = this.extractCanvas.transferToImageBitmap();
    // 视频内容在 256×256 画布里的相对区域（0~1），Worker 用它把 mask 裁回视频宽高比，
    // 避免「正方形 letterbox → 16:9」造成的横向压扁 / 人物错位。
    const region: MaskRegion = {
      x: x / EXTRACT_SIZE,
      y: y / EXTRACT_SIZE,
      w: w / EXTRACT_SIZE,
      h: h / EXTRACT_SIZE,
    };
    return { bitmap, region };
  }

  private onMessage(msg: SegmentationWorkerResponse): void {
    switch (msg.type) {
      case 'ready': {
        this.ready = true;
        if (msg.actualFps && this.capability) {
          this.capability = { ...this.capability, estimatedFps: msg.actualFps };
        }
        this.resolveReady?.();
        break;
      }
      case 'result': {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          // 缓存最近一次有效结果（背压跳帧时复用）
          if (!msg.noPerson) {
            this.lastResult = {
              image: msg.image,
              timestamp: msg.timestamp,
              isMock: msg.isMock,
              width: msg.width,
              height: msg.height,
              stale: false,
              noPerson: false,
            };
          }
          p.resolve({
            image: msg.image,
            timestamp: msg.timestamp,
            isMock: msg.isMock,
            width: msg.width,
            height: msg.height,
            // 结果回来时若已经有更新的分割请求在跑，这个结果就过期了
            stale: msg.id < this.latestId,
            noPerson: msg.noPerson,
          });
        }
        break;
      }
      case 'error': {
        if (msg.id === undefined) {
          this.rejectReady?.(new Error(msg.message));
        } else {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p.reject(new Error(msg.message));
          }
        }
        break;
      }
    }
  }
}
