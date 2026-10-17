/**
 * 弹幕防遮挡 —— 人像分割 Worker
 * ============================================================
 * 运行在 Web Worker 中，负责最耗时的工作：
 * 1. 加载 MediaPipe ImageSegmenter（人像分割模型）；
 * 2. 对主线程抽出的视频帧做分割推理；
 * 3. 把置信度 mask 降采样成低分辨率二值 mask，再用 marching-squares 转成
 *    SVG 轮廓（人物镂空、背景黑）；
 * 4. 只把 SVG 字符串回传主线程，避免占用主线程。
 *
 * 之所以放 Worker：分割推理（WASM/GPU）+ mask 后处理都很耗时，
 * 放主线程会卡 UI / 掉帧。
 */

import { ImageSegmenter } from '@mediapipe/tasks-vision';
import { maskToSvg } from './maskToSvg';
// 用 Vite `?url` 直接从包内拿 wasm 资源地址（开发/构建都由 Vite 管理，不依赖 CDN，
// 也不放 public/——public 里的 .js 不能被 import() 当模块加载）。再按官方
// vision.d.ts 的建议「手工构造 WasmFileset」，替代 FilesetResolver.forVisionTasks。
//
// 必须用 `vision_wasm_module_internal`（ES6 模块，`export default ModuleFactory`）。
// 另两个 `vision_wasm_internal` / `vision_wasm_nosimd_internal` 是 UMD 写法
// （module.exports），import() 后拿不到 ModuleFactory，会报「ModuleFactory not set」。
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import type {
  CapabilityInfo,
  MaskRegion,
  SegmentationBackend,
  SegmentationConfig,
  SegmentationWorkerRequest,
  SegmentationWorkerResponse,
} from './types';

/** Worker 全局作用域最小类型（避免引入 webworker lib 与 DOM lib 冲突） */
interface WorkerScope {
  postMessage(message: SegmentationWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<SegmentationWorkerRequest>) => void) | null;
}

const workerScope = self as unknown as WorkerScope;

let segmenter: ImageSegmenter | null = null;
let config: SegmentationConfig | null = null;
/**
 * 传给 MediaPipe 的内部单调时间戳（ms）
 *
 * VIDEO 运行模式要求每帧时间戳严格递增：输入的媒体时间（video.currentTime）
 * 在暂停时重复、seek 时回退，直接传入会触发
 * 「Packet timestamp mismatch」且计算图进入错误态（后续帧全部失败）。
 * 故推理统一用内部计数器（尽量贴合媒体毫秒时间，冲突时 +1），
 * 回传结果仍带原始媒体时间（客户端过期判定用）
 */
let lastGraphTs = 0;

function post(message: SegmentationWorkerResponse): void {
  workerScope.postMessage(message);
}

/**
 * 从 mask 的指定区域（region，0~1 相对坐标）双线性采样到 outW×outH。
 * region 是视频内容在 letterbox 画布里的区域；只采样这块，把 mask 对齐回视频
 * 的宽高比，避免「正方形 letterbox → 直接压成 16:9」导致人物横向压扁 / 错位。
 */
function sampleMaskRegion(
  mask: Float32Array,
  srcW: number,
  srcH: number,
  region: MaskRegion,
  outW: number,
  outH: number
): Float32Array {
  const out = new Float32Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    // 在 region 内按像素中心等距采样，映射回源 mask 坐标
    const sy = region.y * srcH + ((y + 0.5) / outH) * region.h * srcH;
    const y0 = Math.floor(sy);
    const y1 = Math.min(srcH - 1, y0 + 1);
    const ty = sy - y0;
    for (let x = 0; x < outW; x++) {
      const sx = region.x * srcW + ((x + 0.5) / outW) * region.w * srcW;
      const x0 = Math.floor(sx);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const tx = sx - x0;
      const p00 = mask[y0 * srcW + x0];
      const p10 = mask[y0 * srcW + x1];
      const p01 = mask[y1 * srcW + x0];
      const p11 = mask[y1 * srcW + x1];
      const top = p00 + (p10 - p00) * tx;
      const bottom = p01 + (p11 - p01) * tx;
      out[y * outW + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

/** Uint8Array → base64 字符串（Worker 里没有 Buffer，手动编码） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** SVG 字符串 → data URL */
function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

/** 人物 mask（0~1）→「背景黑、人物透明」的 PNG data URL */
async function maskToPngDataUrl(
  mask: Float32Array,
  w: number,
  h: number,
  threshold: number
): Promise<string> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const imageData = ctx.createImageData(w, h);
  const data = imageData.data;
  for (let i = 0; i < w * h; i++) {
    const isPerson = mask[i] >= threshold;
    data[i * 4] = 0;
    data[i * 4 + 1] = 0;
    data[i * 4 + 2] = 0;
    // 人物透明（挡弹幕）、背景不透明黑（显示弹幕）
    data[i * 4 + 3] = isPerson ? 0 : 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  return `data:image/png;base64,${bytesToBase64(buf)}`;
}

/**
 * 只保留 mask 中最大的连通区域（人），把其余被模型误判成人的小物体
 * （植物 / 旗帜 / 柱子等）置 0。selfie_segmenter 偶尔会把类人形状误识别，
 * 人物通常是画面里最大的一整块，用最大连通域过滤掉零散假阳性。
 */
function keepLargestComponent(
  mask: Float32Array,
  w: number,
  h: number,
  threshold: number
): Float32Array {
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  const sizes: number[] = [];
  let current = 0;

  for (let i = 0; i < n; i++) {
    if (mask[i] < threshold || label[i] !== -1) continue;
    label[i] = current;
    stack.length = 0;
    stack.push(i);
    let size = 0;
    while (stack.length > 0) {
      const idx = stack.pop()!;
      size++;
      const x = idx % w;
      const y = (idx / w) | 0;
      if (x > 0 && mask[idx - 1] >= threshold && label[idx - 1] === -1) {
        label[idx - 1] = current;
        stack.push(idx - 1);
      }
      if (x < w - 1 && mask[idx + 1] >= threshold && label[idx + 1] === -1) {
        label[idx + 1] = current;
        stack.push(idx + 1);
      }
      if (y > 0 && mask[idx - w] >= threshold && label[idx - w] === -1) {
        label[idx - w] = current;
        stack.push(idx - w);
      }
      if (y < h - 1 && mask[idx + w] >= threshold && label[idx + w] === -1) {
        label[idx + w] = current;
        stack.push(idx + w);
      }
    }
    sizes[current] = size;
    current++;
  }

  let largest = -1;
  let largestSize = 0;
  for (let l = 0; l < sizes.length; l++) {
    if (sizes[l] > largestSize) {
      largestSize = sizes[l];
      largest = l;
    }
  }

  const out = new Float32Array(n);
  if (largest >= 0) {
    for (let i = 0; i < n; i++) {
      out[i] = label[i] === largest ? mask[i] : 0;
    }
  }
  return out;
}

/**
 * 填充人物内部的空洞：模型偶尔会把身体/头部内部误判成背景（置信度低），
 * 导致阈值化后人物变成「只有边缘一圈」，头和身体没被扣出来。这里把被人物
 * 完全包围的背景像素填回「人物」，保证人物是实心的。
 */
function fillHoles(mask: Float32Array, w: number, h: number, threshold: number): Float32Array {
  const isPerson = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) isPerson[i] = mask[i] >= threshold ? 1 : 0;

  // 从边界 flood-fill，标记「外部背景」
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!outside[i] && isPerson[i] === 0) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length > 0) {
    const idx = stack.pop()!;
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x > 0) push(idx - 1);
    if (x < w - 1) push(idx + 1);
    if (y > 0) push(idx - w);
    if (y < h - 1) push(idx + w);
  }

  // 空洞 = 背景像素但不在「外部」→ 填成人（置信度设为 1）
  const out = mask.slice();
  for (let i = 0; i < w * h; i++) {
    if (isPerson[i] === 0 && outside[i] === 0) {
      out[i] = 1;
    }
  }
  return out;
}

/** 形态学膨胀（max 池化）：把人物高置信区域向外扩 radius 像素，补齐模型 mask 比真人小一圈的问题 */
function dilateMask(mask: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return mask;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let max = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const v = mask[ny * w + nx];
          if (v > max) max = v;
        }
      }
      out[y * w + x] = max;
    }
  }
  return out;
}

/** 初始化：构造 WasmFileset + 加载模型 */
async function handleInit(cfg: SegmentationConfig, cap: CapabilityInfo): Promise<void> {
  config = cfg;

  // 手工构造 WasmFileset（module 变体，SIMD；ES6 模块假定支持 SIMD）。
  // SIMD 不支持时（极老的浏览器）这里会加载失败，由上层 catch 回退 mock。
  const fileset = {
    wasmLoaderPath: wasmLoaderUrl,
    wasmBinaryPath: wasmBinaryUrl,
  };

  // WebGL2/WebGPU 可用时走 GPU 委托（WebGL），否则回退 CPU（XNNPACK）。
  // 之前误写死 CPU 导致控制台出现「XNNPACK delegate for CPU」。
  const delegate: 'CPU' | 'GPU' = cap.backend === 'wasm' ? 'CPU' : 'GPU';

  segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: cfg.modelUrl, delegate },
    runningMode: 'VIDEO',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });

  // 预热：先跑一次空帧，把 WebGL 上下文创建 + 首次推理的耗时提前到初始化阶段，
  // 避免首次播放时第一次真实分割卡一下。
  try {
    const warm = new OffscreenCanvas(64, 64);
    const wctx = warm.getContext('2d');
    wctx?.fillRect(0, 0, 64, 64);
    const warmBitmap = warm.transferToImageBitmap();
    const warmResult = segmenter.segmentForVideo(warmBitmap, 0);
    warmResult.confidenceMasks?.forEach(m => m.close());
    warmResult.categoryMask?.close();
    warmBitmap.close();
  } catch {
    // 预热失败不影响主流程
  }

  post({ type: 'ready', backend: cap.backend as SegmentationBackend, actualFps: cap.estimatedFps });
}

/** 单帧分割 */
async function handleSegment(
  id: number,
  bitmap: ImageBitmap,
  timestamp: number,
  region: MaskRegion
): Promise<void> {
  if (!segmenter || !config) {
    post({ type: 'error', id, message: '分割模型尚未初始化' });
    bitmap.close();
    return;
  }

  const started = performance.now();
  try {
    // 推理时间戳：严格单调递增（暂停/seek 时媒体时间重复或回退，
    // 直接传 MediaPipe 会报 timestamp mismatch 并使图进入错误态）
    let graphTs = Math.round(timestamp * 1000);
    if (graphTs <= lastGraphTs) graphTs = lastGraphTs + 1;
    lastGraphTs = graphTs;
    // 先算遮罩目标尺寸（按视频宽高比）
    const aspect = region.w / region.h;
    let outW: number;
    let outH: number;
    if (aspect >= 1) {
      outW = config.maskWidth;
      outH = Math.max(1, Math.round(config.maskWidth / aspect));
    } else {
      outH = config.maskWidth;
      outW = Math.max(1, Math.round(config.maskWidth * aspect));
    }

    // 分割推理（置信度 mask；二分类 1 个，多分类 6 个，除背景外相加 = 人物）
    const result = segmenter.segmentForVideo(bitmap, graphTs);
    const masks = result.confidenceMasks ?? [];

    let image = '';
    let noPerson = false;
    let downscaled: Float32Array | null = null;

    if (masks.length > 0) {
      const srcW = masks[0].width;
      const srcH = masks[0].height;
      const person = new Float32Array(srcW * srcH);

      if (masks.length === 1) {
        person.set(masks[0].getAsFloat32Array());
      } else {
        for (let c = 1; c < masks.length; c++) {
          const d = masks[c].getAsFloat32Array();
          for (let i = 0; i < d.length; i++) person[i] += d[i];
        }
      }

      let seg = sampleMaskRegion(person, srcW, srcH, region, outW, outH);
      seg = keepLargestComponent(seg, outW, outH, config.threshold);
      seg = fillHoles(seg, outW, outH, config.threshold);
      seg = dilateMask(seg, outW, outH, config.dilatePixels);

      let personPixels = 0;
      for (let i = 0; i < seg.length; i++) {
        if (seg[i] >= config.threshold) personPixels++;
      }
      const personRatio = personPixels / seg.length;

      if (personRatio >= config.minPersonRatio) {
        downscaled = seg;
      } else {
        noPerson = true;
      }
    } else {
      noPerson = true;
    }

    // 生成遮罩图
    if (downscaled) {
      if (config.outputFormat === 'png') {
        image = await maskToPngDataUrl(downscaled, outW, outH, config.threshold);
      } else {
        // 矢量轮廓：marching-squares + 线性插值
        image = svgToDataUrl(maskToSvg(downscaled, outW, outH, config.threshold));
      }
    }

    for (const m of masks) m.close();
    post({
      type: 'result',
      id,
      image,
      timestamp,
      isMock: false,
      elapsedMs: Math.round(performance.now() - started),
      width: outW,
      height: outH,
      noPerson,
    });
  } catch (e) {
    post({ type: 'error', id, message: `分割失败：${(e as Error)?.message ?? String(e)}` });
  } finally {
    bitmap.close();
  }
}

workerScope.onmessage = (event: MessageEvent<SegmentationWorkerRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      void handleInit(msg.config, msg.capability).catch((e) => {
        post({ type: 'error', message: `模型初始化失败：${(e as Error)?.message ?? String(e)}` });
      });
      break;
    case 'segment':
      void handleSegment(msg.id, msg.bitmap, msg.timestamp, msg.region);
      break;
    case 'dispose':
      segmenter?.close();
      segmenter = null;
      break;
  }
};
