/**
 * 直播插件宿主。
 *
 * 目的：让 `@lumina/live-player` 与点播播放器使用**完全相同的插件体系**，
 * 不再自建流媒体加载器 / 弹幕引擎：
 * - 使用点播播放器的 `PluginManager` 注册开发者传入的插件实例；
 * - 用一个最小的宿主对象冒充 `VideoPlayer`，只向插件暴露它们真正用到的
 *   `events` / `state` / `props`（插件包不感知 Web Component 架构）；
 * - 流媒体：按插件声明的 `type` 匹配 `.m3u8` / `.flv`，由插件自己 load；
 * - 弹幕：把直播设置写入点播播放器约定的运行时状态键，并调用弹幕插件 API。
 */

import type { VideoPlayer } from '@/nova/index';
import { PluginManager } from '@/nova/core/pluginManager';
import type { Plugin } from '@/nova/core/plugin';
import { createTypedEventBus, createTypedStateManager } from '@/core';
import { PlayerEventEnum } from '@/core/events';
import type { PlayerEventBus, PlayerEventMap } from '@/core/events';
import type { PlayerStateMap, RuntimeStateManager } from '@/nova/store/runtimeState';
import { PlayerStateKeyEnum } from '@/nova/store/runtimeState';
import {
  StreamFormatEnum,
  StreamPluginEventEnum,
} from '@/types/streamPlugin';
import type { QualityLevel, StreamPlugin } from '@/types/streamPlugin';
import type {
  NovaLiveDanmakuPlugin,
  NovaLivePlugin,
  NovaLivePluginInput,
  NovaDanmakuSetting,
} from '@/live/types';
import { detectStreamFormat, readStreamErrorMessage } from './stream';
import type { StreamQuality, StreamSnapshot } from './stream';

/** 一次流加载的结果。 */
export type StreamLoadResult = 'plugin' | 'native' | 'missing' | 'unsupported';

/** 插件私有事件总线（仅取错误事件所需的最小接口）。 */
interface StreamPluginErrorBus {
  /** 订阅插件私有事件。 */
  on(type: string, handler: (payload: unknown) => void): () => void;
}

/** 宿主伪造的 `VideoPlayer` 可见面（插件实际只会读这几项）。 */
interface PluginHostPlayer {
  /** 插件事件总线（播放器契约事件）。 */
  events: PlayerEventBus;
  /** 运行时状态管理器（弹幕设置键）。 */
  state: RuntimeStateManager;
  /** 播放器配置（插件读取 debug / danmaku 配置）。 */
  props: Record<string, unknown>;
}

/** 弹幕字号基准（点播播放器引擎 18px = 1 倍）。 */
const DANMAKU_BASE_FONT_SIZE = 18;

/** 弹幕字号缩放范围（与引擎收敛区间一致）。 */
const DANMAKU_MIN_SCALE = 0.5;
const DANMAKU_MAX_SCALE = 2.2;

/**
 * 判断一个插件实例是否为弹幕插件（按能力识别，不依赖具体类名）。
 *
 * @param plugin - 插件实例。
 * @returns 是否为弹幕插件。
 */
export function isDanmakuPluginInstance(plugin: Plugin): plugin is Plugin & NovaLiveDanmakuPlugin {
  const candidate = plugin as Partial<NovaLiveDanmakuPlugin>;
  return (
    typeof candidate.getManager === 'function' &&
    typeof candidate.send === 'function' &&
    typeof candidate.setOpacity === 'function' &&
    typeof candidate.loadDanmaku === 'function'
  );
}

/**
 * 判断一个插件实例是否为流媒体插件。
 *
 * @param plugin - 插件实例。
 * @returns 是否为流媒体插件。
 */
function isStreamPluginInstance(plugin: Plugin): plugin is StreamPlugin {
  const candidate = plugin as Partial<StreamPlugin>;
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.load === 'function' &&
    typeof candidate.isSupported === 'function' &&
    typeof candidate.getStats === 'function'
  );
}

/** 直播弹幕设置 → 引擎速度倍率（1-10 → 0.5-1.5，5 档 = 1.0）。 */
export function danmakuSpeedToMultiplier(speed: number): number {
  const value = Math.max(1, Math.min(10, speed));
  const slider = value <= 5 ? ((value - 1) / 4) * 50 : 50 + ((value - 5) / 5) * 50;
  return 0.5 + slider / 100;
}

/** 直播弹幕字号（px）→ 引擎缩放系数（1 = 18px）。 */
export function danmakuFontSizeToScale(fontsize: number): number {
  return Math.max(
    DANMAKU_MIN_SCALE,
    Math.min(DANMAKU_MAX_SCALE, fontsize / DANMAKU_BASE_FONT_SIZE),
  );
}

/** 直播弹幕字号（px）→ 点播面板字号档位（0-100，50 = 18px）。 */
export function danmakuFontSizeToSlider(fontsize: number): number {
  return Math.max(0, Math.min(100, (danmakuFontSizeToScale(fontsize) - 0.5) * 100));
}

/** 编码 id → 插件编码偏好（0 默认 / 1 HEVC / 2 AVC / 3 AV1）。 */
function codecToPreference(codec: string): number {
  switch (codec.toLowerCase()) {
    case 'hevc':
    case 'h265':
      return 1;
    case 'avc':
    case 'h264':
      return 2;
    case 'av1':
      return 3;
    default:
      return 0;
  }
}

/** 直播插件宿主。 */
export class LivePluginHost {
  /** 与点播播客相同的插件管理器。 */
  readonly pluginManager: PluginManager;

  /** 插件可见的运行时状态（弹幕设置唯一数据源）。 */
  readonly state: RuntimeStateManager;

  /** 插件可见的事件总线。 */
  readonly events: PlayerEventBus;

  /** 插件私有错误回调。 */
  onStreamError: ((message: string) => void) | null = null;

  /** 插件清晰度变化回调。 */
  onStreamQualities: ((list: StreamQuality[], current: string) => void) | null = null;

  /** 当前生效的流媒体插件。 */
  private activeStream: StreamPlugin | null = null;

  /** 开发者传入的流媒体插件（不参与 PluginManager 生命周期）。 */
  private readonly streamPlugins: StreamPlugin[] = [];

  /** 当前流的取消订阅函数。 */
  private streamCleanups: Array<() => void> = [];

  /** 当前流地址。 */
  private currentUrl = '';

  /** 弹幕插件实例（唯一入口）。 */
  private danmakuPlugin: NovaLiveDanmakuPlugin | null = null;

  /** 已挂载的视频元素。 */
  private video: HTMLVideoElement | null = null;

  /** 已挂载的弹幕容器。 */
  private danmakuContainer: HTMLElement | null = null;

  /** 是否已完成挂载（后安装的插件需要补发 mounted）。 */
  private mounted = false;

  constructor() {
    this.events = createTypedEventBus<PlayerEventMap>();
    // 弹幕插件以点播播放器运行时状态键为唯一数据源：这里按嵌套结构初始化，
    // 后续 setState 不会触发「中间节点被覆盖」告警。
    this.state = createTypedStateManager<PlayerStateMap>({
      player: {
        danmakuVisible: true,
        danmakuOpacity: 1,
        danmakuSpeed: 1,
        danmakuDensity: 0.5,
        danmakuArea: 75,
        danmakuFontSize: 50,
        danmakuColor: '#FFFFFF',
        danmakuMode: 1,
        danmakuScaleWithScreen: true,
        danmakuMaskEnabled: false,
      },
    });

    const hostPlayer: PluginHostPlayer = {
      events: this.events,
      state: this.state,
      // 插件会读取 advanced.debug / danmaku.provider 等可选配置：
      // 直播包不提供这些配置，保持空对象即可让插件走默认分支。
      props: { advanced: {}, danmaku: {} },
    };

    this.pluginManager = new PluginManager(hostPlayer as unknown as VideoPlayer);
  }

  /**
   * 同步开发者传入的插件集合。
   *
   * 与「只增不减」的旧实现不同，这里按 `name` / `type` 做 diff：
   * - 本次未提供的普通插件 → 卸载；
   * - 同名但实例变化 → 先卸载旧实例再安装新实例；
   * - 流媒体插件同理，被替换时重新加载当前流地址。
   * 这样动态更新 `options.plugins` 才能真正生效，而不是静默保留旧实例。
   *
   * @param plugins - 插件实例列表。
   */
  install(plugins: readonly NovaLivePluginInput[]): void {
    /** 本次期望安装的普通插件（按 name 去重，后者覆盖前者）。 */
    const desired = new Map<string, NovaLivePlugin>();
    /** 本次期望安装的流媒体插件（按 type 去重）。 */
    const desiredStreams = new Map<string, StreamPlugin>();

    for (const plugin of plugins) {
      if (!plugin) continue;
      if (isStreamPluginInstance(plugin)) {
        desiredStreams.set(String(plugin.type), plugin);
        continue;
      }
      desired.set(plugin.name, plugin as NovaLivePlugin);
    }

    // 1. 卸载本次未提供的普通插件
    const installedNames: string[] = [];
    this.pluginManager.forEachPlugin((plugin): void => {
      installedNames.push(plugin.name);
    });
    for (const name of installedNames) {
      if (!desired.has(name)) this.pluginManager.uninstall(name);
    }

    // 2. 安装新增插件；同名但实例变化时先卸载旧实例
    for (const [name, plugin] of desired) {
      const current = this.pluginManager.get(name);
      if (current === plugin) continue;
      if (current) this.pluginManager.uninstall(name);
      this.pluginManager.install(plugin);
      if (isDanmakuPluginInstance(plugin)) this.danmakuPlugin = plugin;
    }

    // 3. 流媒体插件 diff：按 type 对齐本次期望集合
    let streamReplaced = false;
    // 3a. 移除本次未提供的、或同名但实例已更换的旧插件
    for (const existing of [...this.streamPlugins]) {
      const next = desiredStreams.get(String(existing.type));
      if (next === existing) continue;
      this.removeStreamPlugin(existing);
      streamReplaced = true;
    }
    // 3b. 追加本次新增的类型（旧集合中不存在）
    for (const [type, plugin] of desiredStreams) {
      if (this.streamPlugins.some((item) => String(item.type) === type)) continue;
      this.streamPlugins.push(plugin);
      streamReplaced = true;
    }

    // 弹幕插件缓存失效：可能在 diff 中被卸载，getDanmakuPlugin 会重新扫描
    if (this.danmakuPlugin && !this.pluginManager.has(this.danmakuPlugin.name)) {
      this.danmakuPlugin = null;
    }

    // 流插件被替换后重新加载当前地址，避免旧实例继续占用 <video>
    if (streamReplaced && this.currentUrl) this.loadStream(this.currentUrl);
  }

  /**
   * 移除一个流媒体插件，必要时先解除当前绑定。
   *
   * @param plugin - 待移除的流媒体插件。
   */
  private removeStreamPlugin(plugin: StreamPlugin): void {
    if (this.activeStream === plugin) {
      this.detachStream();
      this.activeStream = null;
    }
    const index = this.streamPlugins.indexOf(plugin);
    if (index >= 0) this.streamPlugins.splice(index, 1);
    // 流插件不归 PluginManager 管理，被替换时需要自行释放实例资源
    plugin.destroy?.();
  }

  /**
   * 获取弹幕插件（开发者经 `plugins` 或 `danmakuPlugin` 传入）。
   *
   * @returns 弹幕插件；未安装返回 null。
   */
  getDanmakuPlugin(): NovaLiveDanmakuPlugin | null {
    if (this.danmakuPlugin) return this.danmakuPlugin;
    let found: NovaLiveDanmakuPlugin | null = null;
    this.pluginManager.forEachPlugin((plugin): void => {
      if (!found && isDanmakuPluginInstance(plugin)) found = plugin;
    });
    this.danmakuPlugin = found;
    return found;
  }

  /**
   * 挂载视频与弹幕容器，并向插件广播点播播放器约定的两个 mounted 事件。
   *
   * @param video - 视频元素。
   * @param danmakuContainer - 弹幕渲染容器（插件契约类 `.nova-player-bas-dm-wrap`）。
   */
  mount(video: HTMLVideoElement, danmakuContainer: HTMLElement | null): void {
    this.video = video;
    this.danmakuContainer = danmakuContainer;
    this.mounted = true;
    this.emitMounted();
  }

  /** 补发 mounted 事件（插件在挂载后安装时使用）。 */
  emitMounted(): void {
    if (!this.mounted || !this.video) return;
    const payload = { video: this.video, container: this.danmakuContainer ?? undefined };
    this.events.emit(PlayerEventEnum.MOUNTED, payload);
    // HLS / FLV 插件订阅的是旧事件名 'player:mounted'。
    this.events.emit('player:mounted', payload);
  }

  /**
   * 按地址后缀选择插件并加载。
   *
   * 格式判断只用于「按插件声明的 type 匹配」；真正的加载完全交给插件。
   *
   * @param url - 流地址。
   * @returns 加载结果。
   */
  loadStream(url: string): StreamLoadResult {
    this.currentUrl = url;
    const format = detectStreamFormat(url);
    if (!format) {
      this.detachStream();
      this.activeStream = null;
      return 'native';
    }

    const plugin = this.findStreamPlugin(format);
    if (!plugin) {
      this.detachStream();
      this.activeStream = null;
      return 'missing';
    }

    if (!plugin.isSupported()) {
      this.onStreamError?.('stream format is not supported in the current browser');
      return 'unsupported';
    }

    this.attachStream(plugin);
    plugin.videoElement = this.video ?? plugin.videoElement;
    plugin.load({ url, format, isLive: true });
    this.emitQualities(plugin.getQualities?.() ?? []);
    return 'plugin';
  }

  /** 重新加载当前流。 */
  reload(): StreamLoadResult {
    if (!this.currentUrl) return 'native';
    return this.loadStream(this.currentUrl);
  }

  /** 当前流地址。 */
  getUrl(): string {
    return this.currentUrl;
  }

  /** 当前生效插件类型（用于信息面板播放内核文案）。 */
  getPlayerKind(): 'hls' | 'flv' | 'dash' | 'native' {
    const type = this.activeStream?.type;
    if (type === 'hls') return 'hls';
    if (type === 'flv') return 'flv';
    if (type === 'dash') return 'dash';
    return 'native';
  }

  /** 实时统计快照。 */
  getSnapshot(): StreamSnapshot {
    const video = this.video;
    const stats = this.activeStream?.getStats?.() ?? {};
    const buffered = video?.buffered;
    const buffer =
      buffered && buffered.length > 0 && video
        ? Math.max(0, buffered.end(buffered.length - 1) - video.currentTime)
        : 0;
    const width = stats.resolution?.width ?? video?.videoWidth ?? 0;
    const height = stats.resolution?.height ?? video?.videoHeight ?? 0;
    return {
      buffer,
      downloadSpeed: stats.downloadSpeed ?? 0,
      videoBitrate: stats.videoBitrate ?? 0,
      resolution: width > 0 && height > 0 ? `${width} x ${height}` : '-',
    };
  }

  /** 切换清晰度（插件提供则转发，否则空操作）。 */
  setQuality(qn: string): void {
    this.activeStream?.setQuality?.(qn);
  }

  /** 当前清晰度（插件提供则读取）。 */
  getCurrentQuality(): string {
    return this.activeStream?.getCurrentQuality?.() ?? '';
  }

  /**
   * 转发视频编码偏好（插件实现 `setCodecPreference` 时才生效）。
   *
   * @param codec - 直播面板的编码 id（avc / hevc / av1 …）。
   */
  setCodecPreference(codec: string): void {
    this.activeStream?.setCodecPreference?.(codecToPreference(codec));
  }

  /**
   * 把直播弹幕设置透传给弹幕插件。
   *
   * 两个通道同时使用：
   * - 点播播放器约定的运行时状态键（`player.danmaku*`）由插件订阅；
   * - 插件公开 API 用于字号 / 速度这类需要精确值的设置。
   *
   * @param setting - 直播弹幕设置。
   */
  applyDanmakuSetting(setting: NovaDanmakuSetting): void {
    const state = this.state;
    state.set(PlayerStateKeyEnum.DANMAKU_VISIBLE, setting.visible);
    state.set(PlayerStateKeyEnum.DANMAKU_OPACITY, setting.opacity);
    state.set(PlayerStateKeyEnum.DANMAKU_SPEED, danmakuSpeedToMultiplier(setting.speed));
    state.set(PlayerStateKeyEnum.DANMAKU_DENSITY, setting.density);
    state.set(PlayerStateKeyEnum.DANMAKU_AREA, setting.area);
    state.set(PlayerStateKeyEnum.DANMAKU_FONT_SIZE, danmakuFontSizeToSlider(setting.fontsize));
    state.set(PlayerStateKeyEnum.DANMAKU_SCALE_WITH_SCREEN, setting.autoScale);
    state.set(PlayerStateKeyEnum.DANMAKU_MASK_ENABLED, setting.mask);
    state.set(PlayerStateKeyEnum.DANMAKU_COLOR, setting.color);
    state.set(PlayerStateKeyEnum.DANMAKU_MODE, 1);

    const plugin = this.getDanmakuPlugin();
    if (!plugin) return;
    plugin.setVisible(setting.visible);
    plugin.setOpacity(setting.opacity);
    plugin.setSpeedMultiplier(danmakuSpeedToMultiplier(setting.speed));
    plugin.setFontSizeScale(danmakuFontSizeToScale(setting.fontsize));
    plugin.setAreaRatio(setting.area / 100);
    plugin.setDensity(setting.density);
    plugin.setAutoScale(setting.autoScale);
    plugin.setFilter({
      scroll: setting.filterScroll,
      fixed: setting.filterFixed,
      colorful: setting.filterColorful,
    });
  }

  /** 销毁宿主：注销全部插件并释放流订阅。 */
  destroy(): void {
    this.detachStream();
    this.activeStream = null;
    this.danmakuPlugin = null;
    this.pluginManager.destroy();
    this.video = null;
    this.danmakuContainer = null;
    this.mounted = false;
    this.currentUrl = '';
  }

  /** 按格式选择已安装的流媒体插件（以插件声明的 type 为准）。 */
  private findStreamPlugin(format: StreamFormatEnum): StreamPlugin | null {
    const direct = this.streamPlugins.find((plugin) => String(plugin.type) === String(format));
    if (direct) return direct;
    let found: StreamPlugin | null = null;
    this.pluginManager.forEachPlugin((plugin): void => {
      if (found || !isStreamPluginInstance(plugin)) return;
      if (String(plugin.type) === String(format)) found = plugin;
    });
    return found;
  }

  /** 绑定生效插件：订阅错误与清晰度变化。 */
  private attachStream(plugin: StreamPlugin): void {
    if (this.activeStream !== plugin) this.detachStream();
    this.activeStream = plugin;
    if (this.streamCleanups.length > 0) return;

    const errorBus = (
      plugin as StreamPlugin & { getStreamEventBus?: () => StreamPluginErrorBus }
    ).getStreamEventBus?.();
    if (errorBus) {
      this.streamCleanups.push(
        errorBus.on(StreamPluginEventEnum.ERROR, (payload): void => {
          this.onStreamError?.(readStreamErrorMessage(payload));
        }),
      );
    }

    if (plugin.onQualitiesChange) {
      this.streamCleanups.push(
        plugin.onQualitiesChange((list): void => this.emitQualities(list)),
      );
    }
  }

  /** 注销当前插件订阅（插件实例仍由 PluginManager 管理）。 */
  private detachStream(): void {
    for (const cleanup of this.streamCleanups.splice(0)) cleanup();
  }

  /** 广播清晰度（插件画质 → 直播 UI 候选）。 */
  private emitQualities(list: QualityLevel[]): void {
    const mapped: StreamQuality[] = list.map((level) => ({
      qn: level.isAuto ? 'auto' : level.id,
      label: level.isAuto ? '' : level.label || `${level.height}p`,
      height: level.height,
      auto: Boolean(level.isAuto),
    }));
    this.onStreamQualities?.(mapped, this.getCurrentQuality());
  }
}
