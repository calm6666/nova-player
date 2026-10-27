/**
 * ============================================
 * sherpa-onnx 流式识别引擎（SherpaAsrEngine）
 * ============================================
 * 基于 sherpa-onnx wasm 运行时（next-gen Kaldi）的真实流式 ASR 引擎，
 * 运行于 ASR 专用 Web Worker（asrWorker.ts 经 engineKind='sherpa' 创建），
 * 实现与 MockAsrEngine 相同的 AsrEngine 接口。
 *
 * 资源布局（由 AsrEngineInitOptions 传入 base 路径）：
 * - wasmBasePath：emscripten 运行时目录
 *     - sherpa-onnx-wasm-nodejs.js（MODULARIZE 工厂）
 *     - sherpa-onnx-wasm-nodejs.wasm（onnxruntime + sherpa-onnx 核心）
 *     - sherpa-onnx-asr.js（OnlineRecognizer JS 封装）
 * - modelBasePath：流式 zipformer transducer 模型目录
 *     - encoder / decoder / joiner（int8 onnx）+ tokens.txt
 *
 * 加载流程（全在 Worker 内，主线程零阻塞）：
 * 1. fetch 运行时 JS 源码 → new Function 求值取出工厂
 *    （module Worker 无法 importScripts，动态 import 也无法消费
 *    emscripten 的 UMD 产物，故用 fetch + Function 注入）
 * 2. 工厂({ locateFile }) 初始化 wasm 模块（编译 15MB wasm）
 * 3. fetch 模型文件 → 写入 emscripten 虚拟文件系统（MEMFS）
 *    （wasm 内部经 std::ifstream 读模型，必须先落虚拟 FS）
 * 4. createOnlineRecognizer(module, config) 创建流式识别器
 *
 * 识别流程（官方 wasm/asr demo 同款模式）：
 * - acceptAudio：stream.acceptWaveform(16kHz) → 就绪即逐块 decode →
 *   getResult 取当前段累计文本作为 partial
 * - finalizeSegment：取最终文本后 recognizer.reset(stream) 清段内状态
 * - reset（seek）：recognizer.reset(stream) 丢弃在途假设
 *
 * 备注：
 * - 流式 zipformer 不产出逐词置信度，final 置信度固定为 0.9
 *   （SubtitlePlugin 阈值过滤语义保持兼容）
 * - numThreads=1：wasm 为单线程构建，识别为增量解码，
 *   0.5s 音频块解码耗时不阻塞主线程
 *
 * @module packages/plugins/src/subtitle/asr/sherpaAsrEngine
 */

import type {
  AsrEngine,
  AsrEngineInitOptions,
  AsrEngineStatus,
  AsrFinalResult,
  AsrPartialResult,
} from '@/types/subtitle';

/** 目标采样率（引擎约定 16kHz，与采集链一致） */
const SAMPLE_RATE = 16000;

/** 流式 final 结果的固定置信度（流式模型无逐词置信度） */
const FINAL_CONFIDENCE = 0.9;

/** wasm 运行时文件名（emscripten 产物，固定命名） */
const WASM_LOADER_FILE = 'sherpa-onnx-wasm-nodejs.js';
const WASM_BINARY_FILE = 'sherpa-onnx-wasm-nodejs.wasm';
const ASR_WRAPPER_FILE = 'sherpa-onnx-asr.js';

/** 模型文件名缺省值（sherpa-onnx 流式 zipformer zh-14m 命名约定） */
const DEFAULT_MODEL_FILES = {
  encoder: 'encoder-epoch-99-avg-1.int8.onnx',
  decoder: 'decoder-epoch-99-avg-1.onnx',
  joiner: 'joiner-epoch-99-avg-1.int8.onnx',
  tokens: 'tokens.txt',
} as const;

// ============================================================
// emscripten 产物的最小结构声明（配合类型谓词，禁止 as 断言）
// ============================================================

/** emscripten 模块初始化参数（locateFile 重定向 wasm 二进制地址） */
interface WasmModuleArg {
  locateFile: (path: string) => string;
}

/** emscripten 模块实例（本引擎只直接使用虚拟文件系统） */
interface WasmModuleInstance {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
  };
}

/** asr.js 的 OnlineStream 实例形状 */
interface OnlineStreamLike {
  acceptWaveform(sampleRate: number, samples: Float32Array): void;
  free(): void;
}

/** asr.js 的 OnlineRecognizer 实例形状（官方封装的公开方法集） */
interface OnlineRecognizerLike {
  createStream(): OnlineStreamLike;
  isReady(stream: OnlineStreamLike): boolean;
  decode(stream: OnlineStreamLike): void;
  reset(stream: OnlineStreamLike): void;
  getResult(stream: OnlineStreamLike): { text: string };
  free(): void;
}

/** asr.js 的 createOnlineRecognizer 函数形状 */
type CreateOnlineRecognizerFn = (
  module: WasmModuleInstance,
  config: unknown,
) => OnlineRecognizerLike;

/** emscripten MODULARIZE 工厂函数形状（返回模块实例，可能为 Promise） */
type WasmLoaderFn = (
  moduleArg: WasmModuleArg,
) => Promise<WasmModuleInstance> | WasmModuleInstance;

// ============================================================
// 类型谓词（运行时校验 new Function 取出的未知产物）
// ============================================================

/** 校验未知值是否为 emscripten MODULARIZE 工厂函数 */
function isWasmLoaderFn(value: unknown): value is WasmLoaderFn {
  return typeof value === 'function';
}

/** 校验未知值是否为 createOnlineRecognizer 函数 */
function isCreateRecognizerFn(value: unknown): value is CreateOnlineRecognizerFn {
  return typeof value === 'function';
}

/** 校验未知值是否为带虚拟文件系统的 emscripten 模块实例 */
function isWasmModuleInstance(value: unknown): value is WasmModuleInstance {
  if (typeof value !== 'object' || value === null) return false;
  if (!('FS' in value)) return false;
  const fs: unknown = value.FS;
  if (typeof fs !== 'object' || fs === null) return false;
  if (!('writeFile' in fs)) return false;
  return typeof fs.writeFile === 'function';
}

/** 校验未知值是否为 OnlineRecognizer 实例（方法集齐全即认定） */
function isOnlineRecognizer(value: unknown): value is OnlineRecognizerLike {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'createStream' in value &&
    'isReady' in value &&
    'decode' in value &&
    'reset' in value &&
    'getResult' in value &&
    'free' in value
  );
}

// ============================================================
// 引擎实现
// ============================================================

export class SherpaAsrEngine implements AsrEngine {
  readonly name = 'sherpa-onnx-streaming';

  /** 引擎状态（loading → ready / error） */
  private status: AsrEngineStatus = { state: 'loading' };
  /** 流式识别器（OnlineRecognizer 实例，内部持有 wasm 模块引用） */
  private recognizer: OnlineRecognizerLike | null = null;
  /** 常驻识别流（段间 reset 复用，dispose 时释放） */
  private stream: OnlineStreamLike | null = null;

  /**
   * 初始化：加载 wasm 运行时 + 模型文件并创建识别器
   *
   * @param options.lang 识别语言（zh：流式 zipformer 中文模型）
   * @param options.modelBasePath 模型目录（缺省 /asr/models/zh-14m）
   * @param options.wasmBasePath wasm 运行时目录（缺省 /asr/wasm）
   */
  async init(options: AsrEngineInitOptions): Promise<void> {
    this.status = { state: 'loading' };
    try {
      const wasmBase = (options.wasmBasePath ?? '/asr/wasm').replace(/\/$/, '');
      const modelBase = (options.modelBasePath ?? '/asr/models/zh-14m').replace(
        /\/$/,
        '',
      );

      // 1) 初始化 wasm 模块（fetch 源码 + Function 求值取工厂 → locateFile 重定向）
      const loaderUrl = `${wasmBase}/${WASM_LOADER_FILE}`;
      const module = await this.initWasmModule(loaderUrl, `${wasmBase}/${WASM_BINARY_FILE}`);

      // 2) 拉取模型文件并写入虚拟文件系统（wasm 内经 ifstream 读取）
      await this.writeModelFiles(module, modelBase);

      // 3) 加载 asr.js 封装并创建流式识别器
      const createRecognizer = await this.loadRecognizerFactory(
        `${wasmBase}/${ASR_WRAPPER_FILE}`,
      );
      const recognizer = createRecognizer(module, {
        featConfig: {
          sampleRate: SAMPLE_RATE,
          featureDim: 80,
        },
        modelConfig: {
          transducer: {
            encoder: `/${DEFAULT_MODEL_FILES.encoder}`,
            decoder: `/${DEFAULT_MODEL_FILES.decoder}`,
            joiner: `/${DEFAULT_MODEL_FILES.joiner}`,
          },
          tokens: `/${DEFAULT_MODEL_FILES.tokens}`,
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
          modelType: '',
          modelingUnit: 'cjkchar',
          bpeVocab: '',
        },
        decodingMethod: 'greedy_search',
        maxActivePaths: 4,
        // 分段由外层 VAD 状态机驱动（asrWorker），关闭内置端点检测避免双重切段
        enableEndpoint: 0,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: 1.2,
        rule3MinUtteranceLength: 20,
        hotwordsFile: '',
        hotwordsScore: 1.5,
        ctcFstDecoderConfig: {
          graph: '',
          maxActive: 3000,
        },
        ruleFsts: '',
        ruleFars: '',
      });
      if (!isOnlineRecognizer(recognizer)) {
        throw new Error('invalid recognizer instance from sherpa-onnx-asr.js');
      }

      this.recognizer = recognizer;
      this.stream = recognizer.createStream();
      this.status = { state: 'ready' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = { state: 'error', message };
      throw error;
    }
  }

  /**
   * 喂入音频块：推入识别流并逐块解码，返回当前段累计文本（partial）
   */
  acceptAudio(chunk: Float32Array, _mediaTime: number): AsrPartialResult | null {
    const recognizer = this.recognizer;
    const stream = this.stream;
    if (!recognizer || !stream) return null;

    stream.acceptWaveform(SAMPLE_RATE, chunk);
    // 就绪即解码：zipformer 增量解码，每次消费固定帧数的特征
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
    const text = this.readResultText(recognizer, stream);
    if (!text) return null;
    return { text };
  }

  /**
   * 段尾：取最终文本并重置识别流（下一段从空假设开始）
   */
  finalizeSegment(): AsrFinalResult | null {
    const recognizer = this.recognizer;
    const stream = this.stream;
    if (!recognizer || !stream) return null;

    const text = this.readResultText(recognizer, stream);
    // 段结束即重置：流式识别器的 getResult 返回「自上次 reset 起的累计文本」，
    // 不重置会导致下一段 partial 携带上一段全部内容
    recognizer.reset(stream);
    if (!text) return null;
    return { text, confidence: FINAL_CONFIDENCE };
  }

  /** 状态查询 */
  getStatus(): AsrEngineStatus {
    return this.status;
  }

  /** 丢弃当前段在途音频（seek 后由 worker reset 消息触发） */
  reset(): void {
    const recognizer = this.recognizer;
    const stream = this.stream;
    if (!recognizer || !stream) return;
    recognizer.reset(stream);
  }

  /** 释放资源（识别流 + 识别器；模块实例随 Worker 终止整体回收） */
  dispose(): void {
    this.stream?.free();
    this.stream = null;
    this.recognizer?.free();
    this.recognizer = null;
    this.status = { state: 'loading' };
  }

  // ============================================================
  // 私有：运行时加载
  // ============================================================

  /**
   * 初始化 emscripten wasm 模块
   *
   * module Worker 无法 importScripts（也无 module.exports 可动态 import），
   * 故 fetch 脚本源码后经 new Function 求值，从函数作用域取出
   * MODULARIZE 工厂（源码末尾 `var Module = (() => factory)()`）
   */
  private async initWasmModule(
    loaderUrl: string,
    wasmBinaryUrl: string,
  ): Promise<WasmModuleInstance> {
    const source = await fetchScript(loaderUrl);
    // 求值器：执行源码（顶层 var Module = 工厂）并返回 Module
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const evaluateLoader = new Function(`${source}\nreturn Module;`);
    const loaderCandidate: unknown = evaluateLoader();
    if (!isWasmLoaderFn(loaderCandidate)) {
      throw new Error('failed to evaluate sherpa-onnx wasm loader');
    }
    const loader = loaderCandidate;
    // locateFile：emscripten 以相对路径请求 wasm 二进制，重定向到实际地址
    const instance: unknown = await loader({
      locateFile: (path: string): string =>
        path.endsWith('.wasm') ? wasmBinaryUrl : loaderUrl,
    });
    if (!isWasmModuleInstance(instance)) {
      throw new Error('sherpa-onnx wasm module has no FS.writeFile');
    }
    return instance;
  }

  /**
   * 加载 asr.js 封装，取出 createOnlineRecognizer 工厂
   * （同样经 fetch + Function 求值；源码内函数声明为脚本顶层作用域）
   */
  private async loadRecognizerFactory(
    wrapperUrl: string,
  ): Promise<CreateOnlineRecognizerFn> {
    const source = await fetchScript(wrapperUrl);
    // 求值器：执行源码（顶层函数声明）并返回 createOnlineRecognizer
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const evaluateWrapper = new Function(
      `${source}\nreturn createOnlineRecognizer;`,
    );
    const factoryCandidate: unknown = evaluateWrapper();
    if (!isCreateRecognizerFn(factoryCandidate)) {
      throw new Error('failed to evaluate sherpa-onnx-asr.js wrapper');
    }
    return factoryCandidate;
  }

  /**
   * 拉取模型四件套并写入虚拟文件系统根目录
   * （MEMFS 的 writeFile 不自动创建目录，写入根路径避免 mkdir）
   */
  private async writeModelFiles(
    module: WasmModuleInstance,
    modelBase: string,
  ): Promise<void> {
    const files: Array<{ url: string; path: string }> = [
      { url: `${modelBase}/${DEFAULT_MODEL_FILES.encoder}`, path: `/${DEFAULT_MODEL_FILES.encoder}` },
      { url: `${modelBase}/${DEFAULT_MODEL_FILES.decoder}`, path: `/${DEFAULT_MODEL_FILES.decoder}` },
      { url: `${modelBase}/${DEFAULT_MODEL_FILES.joiner}`, path: `/${DEFAULT_MODEL_FILES.joiner}` },
      { url: `${modelBase}/${DEFAULT_MODEL_FILES.tokens}`, path: `/${DEFAULT_MODEL_FILES.tokens}` },
    ];
    // 并行拉取（encoder 21MB 为主，本地/同域资源并行无压力）
    const payloads = await Promise.all(
      files.map(async (file): Promise<{ path: string; data: Uint8Array }> => {
        const response = await fetch(file.url);
        if (!response.ok) {
          throw new Error(`failed to fetch model file: ${file.url}`);
        }
        return { path: file.path, data: new Uint8Array(await response.arrayBuffer()) };
      }),
    );
    for (const payload of payloads) {
      module.FS.writeFile(payload.path, payload.data);
    }
  }

  /** 读取识别流当前文本（getResult 返回自上次 reset 起的累计内容） */
  private readResultText(
    recognizer: OnlineRecognizerLike,
    stream: OnlineStreamLike,
  ): string {
    const result: unknown = recognizer.getResult(stream);
    if (typeof result !== 'object' || result === null) return '';
    if (!('text' in result)) return '';
    const text: unknown = result.text;
    return typeof text === 'string' ? text : '';
  }
}

/** 拉取脚本源码（失败抛英文错误，与运行时错误约定一致） */
async function fetchScript(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch script: ${url}`);
  }
  return response.text();
}
