/**
 * ============================================
 * 字幕类型定义
 * ============================================
 * 合并 player 和 plugin 的字幕类型，纯类型定义，零运行时依赖
 * player 和 plugins 包均从此导入
 *
 * @module types/subtitle
 */

/** 字幕文件格式 */
export enum SubtitleFormat {
  SRT = 'srt',
  ASS = 'ass',
  SSA = 'ssa',
  VTT = 'vtt',
  UNKNOWN = 'unknown',
}

/** 字幕样式 */
export interface SubtitleStyle {
  /** 字体名称 */
  fontName?: string;
  /** 字体大小 */
  fontSize?: number;
  /** 主颜色 */
  primaryColor?: string;
  /** 描边颜色 */
  outlineColor?: string;
  /** 描边宽度 */
  outlineWidth?: number;
  /** 粗体 */
  bold?: boolean;
  /** 斜体 */
  italic?: boolean;
  /** 下划线 */
  underline?: boolean;
  /** 删除线 */
  strikeout?: boolean;
  /** 对齐方式：1-左下, 2-中下, 3-右下, 4-左中, 5-中中, 6-右中, 7-左上, 8-中上, 9-右上 */
  alignment?: number;
  /** 左边距 */
  marginL?: number;
  /** 右边距 */
  marginR?: number;
  /** 垂直边距 */
  marginV?: number;
}

/** 字幕项 */
export interface SubtitleItem {
  /**
   * 唯一标识
   * 约定：文件/服务端轨使用正数自增（1, 2, …）；
   * 本地实时识别轨使用负数自增（-1, -2, …），避免与文件/服务端轨冲突
   */
  id: number;
  /** 开始时间 (秒) */
  startTime: number;
  /** 结束时间 (秒) */
  endTime: number;
  /** 字幕文本 (支持多行) */
  text: string;
  /** 样式信息 (ASS格式) */
  style?: SubtitleStyle;
}

/** 解析后的字幕数据 */
export interface ParsedSubtitle {
  /** 格式类型 */
  format: SubtitleFormat;
  /** 字幕项列表 */
  items: SubtitleItem[];
  /** 全局样式 (ASS格式) */
  globalStyle?: SubtitleStyle;
  /** 原始标题 (ASS格式) */
  title?: string;
}

/** 字幕源 */
export interface SubtitleSource {
  /** 字幕 URL */
  src: string;
  /** 语言代码 */
  lang: string;
  /** 显示名称 */
  label: string;
  /** 默认选中 */
  default?: boolean;
}

// ============================================
// 字幕双模式类型定义
// （模式 A：本地 AI 实时识别 / 模式 B：服务端返回）
// 纯类型零运行时依赖；引擎具体实现放插件包 asr/ 目录
// ============================================

/**
 * 字幕条目（服务端返回 / 识别引擎产出的最小时间轴单元）
 * 原定义位于插件包 aiSubtitleConfig.ts，迁移至此统一维护
 */
export interface AiSubtitleEntry {
  /** 开始时间（秒） */
  start: number;
  /** 结束时间（秒） */
  end: number;
  /** 字幕文本 */
  text: string;
  /** 译文（可选，双语拼装用） */
  translation?: string;
  /** 置信度（0-1，低于阈值时被过滤） */
  confidence?: number;
}

/** 本地 AI 引擎状态载荷（SUBTITLE_AI_STATUS 事件） */
export interface SubtitleAiStatusPayload {
  /** 阶段：downloading=模型下载中 / loading=引擎初始化 / ready=就绪 / error=失败 */
  phase: 'downloading' | 'loading' | 'ready' | 'error';
  /** 进度（0-1，下载/初始化阶段可选） */
  progress?: number;
  /** 附加信息（错误原因等） */
  message?: string;
}

/**
 * 字幕条目增量事件（模式 A 推送 / 模式 B 拉取后归一）
 * finalCues 的 id 由插件统一重排：本地轨负数自增、服务端轨正数自增
 */
export interface SubtitleCueEvent {
  /** 本条 cue 的轨道 id（本地识别轨 = 'local-ai'，服务端轨等自定义） */
  trackId: string;
  /** 该轨道语言代码 */
  lang: string;
  /** 稳定完成的条目（final） */
  finalCues: SubtitleItem[];
  /**
   * 进行中的部分识别结果（可选，仅模式 A 有）：
   * 文本仍在变动，渲染层以「临时灰显」展示，被后续 finalCues 覆盖
   */
  partialCue?: SubtitleItem | null;
}

/**
 * 引擎联动事件总线（结构性兼容 PlayerEventBus）
 * 就地定义最小结构，避免公共类型反向依赖播放器内核
 */
export interface SubtitleEngineEvents {
  /** 监听事件（name 为事件名字符串，如 'seekEnd' / 'rateChange'），返回取消函数 */
  on(name: string, listener: (data?: unknown) => void): () => void;
  /** 广播事件 */
  emit(name: string, data?: unknown): void;
}

/** 音频 PCM 输入流（16kHz 单声道 Float32 分块推送，由采集层喂入） */
export interface SubtitleAudioStream {
  /** 注册音频块消费者；返回取消函数 */
  onChunk(consumer: (chunk: Float32Array, mediaTime: number) => void): () => void;
}

/** 本地识别引擎运行上下文（由插件注入，引擎不直接触碰播放器） */
export interface SubtitleEngineContext {
  /** 音频 PCM 输入流 */
  readonly audioStream: SubtitleAudioStream;
  /** 播放器事件（seekEnd/rateChange 等，用于引擎状态联动） */
  readonly events: SubtitleEngineEvents;
  /** 读取当前媒体时间（秒）——VAD 分段时间戳对齐用 */
  getMediaTime(): number;
}

/** ASR 引擎初始化选项 */
export interface AsrEngineInitOptions {
  /** 识别语言（决定加载哪组模型） */
  lang: string;
  /** 模型资源 base 路径（懒加载下载 + 缓存） */
  modelBasePath?: string;
  /** wasm 运行时 base 路径（sherpa-onnx 等真实引擎的运行时资源目录） */
  wasmBasePath?: string;
}

/** 流式识别部分结果（文本仍在变动，渲染层灰显展示） */
export interface AsrPartialResult {
  /** 部分识别文本 */
  text: string;
  /** 置信度（可选） */
  confidence?: number;
}

/** 语音段最终识别结果 */
export interface AsrFinalResult {
  /** 最终识别文本 */
  text: string;
  /** 置信度（低于阈值的条目按配置丢弃） */
  confidence: number;
}

/** ASR 推理引擎状态 */
export interface AsrEngineStatus {
  /** loading=模型加载中 / ready=就绪 / error=失败 */
  state: 'loading' | 'ready' | 'error';
  /** 附加信息（错误原因等） */
  message?: string;
}

/**
 * ASR 推理引擎接口
 * 实现可运行于 Web Worker 或主线程；流式引擎在 acceptAudio 中即时产出 partial，
 * 段尾由 finalizeSegment 产出 final（设计文档 4.4）
 */
export interface AsrEngine {
  /** 引擎名（'sherpa-streaming' | 'whisper-chunk' | 'mock-asr' | 自定义） */
  readonly name: string;
  /** 初始化：加载模型文件（须可重复调用，语言切换重启时复用实例） */
  init(options: AsrEngineInitOptions): Promise<void>;
  /** 喂入音频块（16kHz mono Float32）；流式引擎可即时返回 partial */
  acceptAudio(chunk: Float32Array, mediaTime: number): AsrPartialResult | null;
  /** 结束当前语音段，产出 final 文本 */
  finalizeSegment(): AsrFinalResult | null;
  /** 状态查询（loading/ready/error，向上广播用） */
  getStatus(): AsrEngineStatus;
  /** 丢弃当前段在途音频（seek 后调用，可选实现） */
  reset?(): void;
  /** 释放模型资源 */
  dispose(): void;
}

/** 推送型字幕提供者（模式 A：本地 AI 实时识别） */
export interface LocalAiSubtitleProvider {
  readonly type: 'local-ai';
  /** 启动识别（幂等）；context 由插件注入 */
  start(context: SubtitleEngineContext): void;
  /** 停止识别并释放引擎资源（保留已识别字幕条目由插件负责） */
  stop(): void;
  /** cue 推送回调，由插件注入 */
  onCue?: (event: SubtitleCueEvent) => void;
  /**
   * 识别链状态回调（可选，由插件注入）：
   * Worker 引擎异步加载模型，经此上报就绪/失败；主线程引擎无需调用
   */
  onStatus?: (phase: 'ready' | 'error', message?: string) => void;
}

/** 服务端字幕轨道描述（一次列表请求返回，设计文档 5.1） */
export interface RemoteSubtitleTrack {
  /** 轨道 id（服务器定义，稳定） */
  trackId: string;
  /** 语言代码（BCP-47，如 zh / en-US） */
  lang: string;
  /** 显示名（如「中文（AI 生成）」） */
  label: string;
  /** 轨道类型：原文识别轨 / 翻译轨 */
  kind: 'original' | 'translation';
  /** 翻译轨指向的原文轨 id（kind=translation 时必有） */
  originalTrackId?: string;
}

/**
 * 拉取型字幕提供者（模式 B：服务端返回，可整段或增量）
 * fetch 拉取「当前激活轨道」的数据；多轨时先 activateTrack 再 fetch
 */
export interface RemoteSubtitleProvider {
  readonly type: 'remote';
  /**
   * 拉取字幕段
   * @param range 可选：增量模式下的时间区间（秒）；整段模式忽略
   * @returns 该区间的 AiSubtitleEntry[]（可为空数组）
   */
  fetch(range?: { from: number; to: number }): Promise<AiSubtitleEntry[]>;
  /** 是否支持增量拉取（决定插件是否分段请求） */
  readonly incremental?: boolean;
  /** 列出服务端轨道（多轨协议；未提供表示单轨） */
  listTracks?(): Promise<RemoteSubtitleTrack[]>;
  /** 激活某轨道（激活后 fetch 拉取该轨数据） */
  activateTrack?(trackId: string): Promise<void>;
}

/** 播放器统一轨道信息（listTracks() 返回值：文件源 + 服务端轨 + 本地轨的并集） */
export interface SubtitleTrackInfo {
  /** 轨道 id（文件轨 file:<lang> / 服务端轨 remote:<trackId> / 本地轨 local-ai） */
  trackId: string;
  /** 语言代码 */
  lang: string;
  /** 显示名 */
  label: string;
  /** 轨道来源 */
  source: 'file' | 'remote' | 'local-ai';
  /** 本地轨显示「实时识别」徽标 */
  isLive?: boolean;
  /** 状态点（downloading/loading/ready/error，仅本地轨有意义） */
  status?: SubtitleAiStatusPayload['phase'];
  /** 轨道类型：原文识别轨 / 翻译轨（服务端轨） */
  kind?: 'original' | 'translation';
}

/** 模式 A 配置（SubtitlePluginConfig.localAi） */
export interface LocalAiSubtitleConfig {
  /** 自定义 Provider（可选；缺省时由插件用 engines 组装内部采集管线） */
  provider?: LocalAiSubtitleProvider;
  /**
   * Worker 引擎类型（可选；优先级低于 provider、高于 engines）：
   * 传注册表 key（如 'sherpa' / 'mock'），重计算（VAD + 推理）全部在
   * ASR 专用 Worker 内运行，主线程零阻塞；引擎在 Worker 内按需创建
   */
  engineKind?: string;
  /** 引擎实现（按语言挂引擎；识别语言缺引擎时回落 defaultLang 对应引擎） */
  engines?: Partial<Record<string, AsrEngine>>;
  /** 默认识别语言 */
  defaultLang: string;
  /** 模型资源 base 路径（懒加载下载 + 缓存，真实引擎接入时使用） */
  modelBasePath?: string;
  /** wasm 运行时 base 路径（sherpa-onnx 等真实引擎的运行时资源目录） */
  wasmBasePath?: string;
  /** 置信度阈值（低于丢弃，默认 0.35） */
  confidenceThreshold?: number;
  /** 单段最长秒数（默认 15，超限强制切段） */
  maxSegmentSeconds?: number;
}
