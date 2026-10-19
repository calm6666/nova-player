/**
 * 浏览器能力检测工具类
 * ============================================================
 * 用于弹幕防遮挡（人像分割）前的环境探测：
 *
 * 1. 检测 WebGL2 / WebGPU / WASM SIMD / OffscreenCanvas 是否可用；
 * 2. 选定最优推理后端（WebGPU > WebGL > WASM）；
 * 3. 启发式估算最高处理 fps（真实 fps 由分割 Worker 首次推理实测回传）；
 * 4. 不满足阈值时标记 supported=false，调用方走 mock 数据。
 *
 * 注意：本类只在浏览器环境使用（服务端渲染不执行）。
 */

import type { CapabilityInfo, SegmentationBackend } from './types';

/** 各后端启发式 fps（真实值受设备与模型影响，仅用于初始判断） */
const BACKEND_FPS_ESTIMATE: Record<SegmentationBackend, number> = {
  webgpu: 30,
  webgl: 20,
  wasm: 8,
  none: 0,
};

/** 判断是否处于浏览器环境 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** 检测 WebGL2 是否可用 */
function detectWebGL2(): boolean {
  if (!isBrowser()) return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    return !!gl;
  } catch {
    return false;
  }
}

/** 检测 WebGPU 是否可用 */
function detectWebGPU(): boolean {
  if (!isBrowser()) return false;
  const nav = navigator as Navigator & { gpu?: unknown };
  return typeof nav.gpu === 'object' && nav.gpu !== null;
}

/** 检测 WASM SIMD 是否可用（用一段含 i32x4 指令的 wasm 字节码做校验） */
function detectWasmSimd(): boolean {
  if (typeof WebAssembly === 'undefined') return false;
  // 最小 wasm 模块：验证 v128（SIMD）类型是否被支持
  const bytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // magic "\0asm"
    0x01, 0x00, 0x00, 0x00, // version 1
  ]);
  try {
    // 仅验证基本 wasm 是否可用；SIMD 额外用 WebAssembly.validate 探测含 v128 的模块
    if (!WebAssembly.validate(bytes)) return false;
    // 含 SIMD 指令（i32x4.add）的最小模块
    const simdBytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // func type: () -> v128
      0x03, 0x02, 0x01, 0x00, // function
      0x07, 0x08, 0x01, 0x04, 0x74, 0x65, 0x73, 0x74, 0x00, 0x00, // export
      0x0a, 0x09, 0x01, 0x07, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x0b, // body
    ]);
    return WebAssembly.validate(simdBytes);
  } catch {
    return false;
  }
}

/** 检测 OffscreenCanvas 是否可用 */
function detectOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas !== 'undefined';
}

/**
 * 浏览器能力检测工具类。
 */
export class CapabilityDetector {
  /**
   * 执行能力检测并给出后端选择与可用性判断。
   *
   * @param minFps 判定「可用」的最低 fps 阈值，低于则 supported=false（走 mock）
   */
  detect(minFps = 5): CapabilityInfo {
    const webgl2 = detectWebGL2();
    const webgpu = detectWebGPU();
    const wasmSimd = detectWasmSimd();
    const offscreenCanvas = detectOffscreenCanvas();

    // 选择最优后端：WebGPU > WebGL2 > WASM
    let backend: SegmentationBackend = 'none';
    if (webgpu) backend = 'webgpu';
    else if (webgl2) backend = 'webgl';
    else if (wasmSimd) backend = 'wasm';

    const estimatedFps = BACKEND_FPS_ESTIMATE[backend];
    // GPU-only：CPU（wasm/XNNPACK）推理每帧数百毫秒，即使放在 Worker 也会
    // 拖垮整页（GPU 进程与解码线程被抢占），无 GPU 时直接判不支持（走 mock）
    const supported =
      (backend === 'webgpu' || backend === 'webgl') && estimatedFps >= minFps;

    return { webgl2, webgpu, wasmSimd, offscreenCanvas, backend, estimatedFps, supported };
  }

  /** 便捷：快速判断是否可用真实分割 */
  isSupported(minFps = 5): boolean {
    return this.detect(minFps).supported;
  }
}
