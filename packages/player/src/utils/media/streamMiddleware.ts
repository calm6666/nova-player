/**
 * ============================================
 * StreamMiddleware — 流媒体中间件
 * ============================================
 *
 * 统一管理 Native 和 Streaming 两种播放模式。
 * 当 PluginManager 检测到 StreamPlugin 安装时自动切换模式。
 * 中间件统一提供 play / pause / seek / load / getStats / getBufferInfo / getQualities / setQuality。
 */

import type {
  StreamPlugin,
  StreamConfig,
  StreamStats,
  BufferInfo,
  QualityLevel,
} from '@/types/streamPlugin';
import { StreamFormatEnum, StreamPluginTypeEnum } from '@/types/streamPlugin';

export enum PlayerMode { NATIVE = 'native', STREAMING = 'streaming' }

/** 流媒体格式 → 插件类型（决定用哪个插件加载清单） */
const FORMAT_TO_PLUGIN_TYPE: Partial<Record<StreamFormatEnum, StreamPluginTypeEnum>> = {
  [StreamFormatEnum.HLS]: StreamPluginTypeEnum.HLS,
  [StreamFormatEnum.DASH]: StreamPluginTypeEnum.DASH,
  [StreamFormatEnum.FLV]: StreamPluginTypeEnum.FLV,
};

export class StreamMiddleware {
  private mode: PlayerMode = PlayerMode.NATIVE;
  private activePlugin: StreamPlugin | null = null;
  private video: HTMLVideoElement;

  /** 已注册的流媒体插件（按类型索引，供按格式选择） */
  private readonly plugins = new Map<StreamPluginTypeEnum, StreamPlugin>();

  /** 清晰度列表订阅者集合 */
  private qualitySubscribers = new Set<(list: QualityLevel[]) => void>();

  /** 当前插件的 onQualitiesChange 取消订阅函数 */
  private pluginQualityUnsub: (() => void) | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  /** PluginManager 安装 StreamPlugin 时调用 */
  registerStreamPlugin(plugin: StreamPlugin): void {
    this.plugins.set(plugin.type, plugin);
    this.activatePlugin(plugin);
  }

  /**
   * PluginManager 卸载 StreamPlugin 时调用
   *
   * 不传插件时按旧行为整体清空（保留旧调用点的兼容性）；传插件时只移除该插件。
   *
   * @param plugin - 被卸载的插件；缺省表示整体注销
   */
  unregisterStreamPlugin(plugin?: StreamPlugin): void {
    if (plugin) {
      this.plugins.delete(plugin.type);
      if (this.activePlugin === plugin) {
        this.detachActivePlugin();
        this.activePlugin = this.pickFallbackPlugin();
        if (this.activePlugin) this.attachActivePlugin(this.activePlugin);
      }
      return;
    }

    this.detachActivePlugin();
    this.activePlugin = null;
    this.plugins.clear();
    this.mode = PlayerMode.NATIVE;
  }

  /**
   * 按流媒体格式选择插件
   *
   * 清单协议由调用方（VideoPlayer.resolveLoadTarget）按内容判定后以 format 传入，
   * 这里只做「格式 → 插件类型」的选择；找不到对应插件时保留当前生效插件。
   *
   * @param format - 已判定的流媒体格式
   * @returns 选中的插件；未注册对应插件时返回 null
   */
  selectPlugin(format: StreamFormatEnum): StreamPlugin | null {
    const type = FORMAT_TO_PLUGIN_TYPE[format];
    if (!type) return null;

    const plugin = this.plugins.get(type);
    if (!plugin) return null;

    if (plugin !== this.activePlugin) {
      this.detachActivePlugin();
      this.activePlugin = plugin;
      this.attachActivePlugin(plugin);
    }
    return plugin;
  }

  /**
   * 按类型取已注册插件
   *
   * @param type - 插件类型
   * @returns 插件实例；未注册返回 undefined
   */
  getPlugin(type: StreamPluginTypeEnum): StreamPlugin | undefined {
    return this.plugins.get(type);
  }

  /** 当前生效插件（无插件时为 null） */
  getActivePlugin(): StreamPlugin | null {
    return this.activePlugin;
  }

  /** 切换到新插件：接上清晰度桥接 */
  private activatePlugin(plugin: StreamPlugin): void {
    if (this.activePlugin === plugin) {
      this.mode = PlayerMode.STREAMING;
      return;
    }
    this.detachActivePlugin();
    this.activePlugin = plugin;
    this.attachActivePlugin(plugin);
  }

  /** 绑定生效插件：进入流媒体模式 + 桥接清晰度推送 */
  private attachActivePlugin(plugin: StreamPlugin): void {
    this.mode = PlayerMode.STREAMING;

    if (plugin.onQualitiesChange) {
      this.pluginQualityUnsub = plugin.onQualitiesChange((list) => {
        this.emitQualities(list);
      });
    }

    // 插件已能同步给出档位时，立即通知一次订阅者
    const list = plugin.getQualities();
    if (list.length > 0) {
      this.emitQualities(list);
    }
  }

  /** 解绑当前插件：断开清晰度桥接 */
  private detachActivePlugin(): void {
    this.pluginQualityUnsub?.();
    this.pluginQualityUnsub = null;
  }

  /** 按当前注册表取一个兜底插件（按 HLS → DASH → FLV 顺序） */
  private pickFallbackPlugin(): StreamPlugin | null {
    for (const type of [
      StreamPluginTypeEnum.HLS,
      StreamPluginTypeEnum.DASH,
      StreamPluginTypeEnum.FLV,
    ]) {
      const plugin = this.plugins.get(type);
      if (plugin) return plugin;
    }
    return null;
  }

  /**
   * 订阅清晰度列表的变化/就绪
   * @param cb - 列表变化回调
   * @returns 取消订阅函数
   */
  onQualitiesChange(cb: (list: QualityLevel[]) => void): () => void {
    this.qualitySubscribers.add(cb);
    return () => {
      this.qualitySubscribers.delete(cb);
    };
  }

  /** 通知所有清晰度订阅者 */
  private emitQualities(list: QualityLevel[]): void {
    this.qualitySubscribers.forEach((cb) => cb(list));
  }

  /** 获取当前播放模式 */
  getMode(): PlayerMode {
    return this.mode;
  }

  // ── 代理方法：统一委托给 StreamPlugin 或原生 video ──

  /** 播放 */
  play(): void {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      this.activePlugin.play();
    } else {
      this.video.play();
    }
  }

  /** 暂停 */
  pause(): void {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      this.activePlugin.pause();
    } else {
      this.video.pause();
    }
  }

  /** 跳转到指定时间 */
  seek(time: number): void {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      this.activePlugin.seek(time);
    } else {
      this.video.currentTime = time;
    }
  }

  /** 加载流媒体配置（先按格式选择插件，再委托加载） */
  load(config: StreamConfig): void {
    if (this.mode === PlayerMode.STREAMING) {
      const selected = this.selectPlugin(config.format) ?? this.activePlugin;
      if (selected) {
        selected.load(config);
        return;
      }
    }
    const url = typeof config.url === 'string' ? config.url : '';
    this.video.src = url;
    this.video.load();
  }

  /** 获取统计信息 */
  getStats(): Partial<StreamStats> | { currentTime: number; duration: number } {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      return this.activePlugin.getStats();
    }
    return { currentTime: this.video.currentTime, duration: this.video.duration };
  }

  /** 获取缓冲信息 */
  getBufferInfo(): BufferInfo {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      return this.activePlugin.getBufferInfo();
    }
    if (this.video.buffered.length === 0) {
      return { start: 0, end: 0, length: 0 };
    }
    const end: number = this.video.buffered.end(this.video.buffered.length - 1);
    return { start: 0, end, length: end - this.video.currentTime };
  }

  /** 获取可用画质列表 */
  getQualities(): QualityLevel[] {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      return this.activePlugin.getQualities();
    }
    return [];
  }

  /** 设置画质 */
  setQuality(quality: string): void {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      this.activePlugin.setQuality(quality);
    }
  }

  /** 当前流是否包含 Hi-Res / 无损音频轨 */
  hasHiResAudio(): boolean {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      return this.activePlugin.hasHiResAudio?.() ?? false;
    }
    return false;
  }

  /**
   * 切换 Hi-Res 音频轨
   * @param enabled - true 切到无损轨，false 切回普通音轨
   * @returns 是否成功发起切换
   */
  setHiResAudio(enabled: boolean): boolean {
    if (this.mode !== PlayerMode.STREAMING || !this.activePlugin) return false;
    const plugin = this.activePlugin;
    const tracks = plugin.getAudioTracks?.() ?? [];
    if (tracks.length === 0 || !plugin.setAudioTrack) return false;
    if (enabled) {
      const hiRes = tracks.find((track) => track.isHiRes === true);
      return hiRes ? plugin.setAudioTrack(hiRes.id) : false;
    }
    const normal = tracks.find((track) => track.isHiRes !== true) ?? tracks[0];
    return normal ? plugin.setAudioTrack(normal.id) : false;
  }

  /**
   * 设置视频编码偏好（转发给生效的流媒体插件）
   *
   * 设置面板「编码格式」→ VideoPlayer.setCodecPrefer → 此处转发；
   * 插件未实现该方法（setCodecPreference 可选）或原生模式下静默忽略
   * @param type - 编码偏好：0 默认 / 1 HEVC / 2 AVC / 3 AV1
   */
  setCodecPreference(type: number): void {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      this.activePlugin.setCodecPreference?.(type);
    }
  }

  /**
   * 获取当前生效的档位 id
   * @returns 流媒体模式转发给插件；原生模式返回 ''（原生单文件无档位概念）
   */
  getCurrentQuality(): string {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      return this.activePlugin.getCurrentQuality();
    }
    return '';
  }

  /**
   * 是否支持自动档（ABR）
   * @returns 流媒体模式转发给插件；原生模式恒为 false
   */
  supportsAutoQuality(): boolean {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      return this.activePlugin.supportsAutoQuality?.() ?? false;
    }
    return false;
  }

  /**
   * 应用清晰度上限/下限限制
   * @param limits - 上限/下限（像素高度）
   */
  applyLimits(limits: { max?: number; min?: number }): void {
    if (this.mode === PlayerMode.STREAMING && this.activePlugin) {
      this.activePlugin.applyLimits?.(limits);
    }
  }

  /** 销毁中间件，释放资源 */
  destroy(): void {
    this.detachActivePlugin();
    this.qualitySubscribers.clear();
    if (this.activePlugin) {
      this.activePlugin.destroy();
    }
    this.activePlugin = null;
    this.plugins.clear();
    this.mode = PlayerMode.NATIVE;
  }
}
