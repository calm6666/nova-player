/**
 * `<nova-live-player>` 直播播放器根元素。
 *
 * 仅以下三部分封装为 Web Component：
 * - 根元素 `<nova-live-player>`；
 * - 弹幕层 `<nova-live-player-danmaku>`（基于 plugins 的 DanmakuManager）；
 * - 控制层 `<nova-live-player-control-bar>`。
 *
 * 其余面板（清晰度 / 线路、速度、弹幕设置、信息、快捷键、视频编码、右键菜单、
 * 发送条、Toast、错误、加载）全部是根元素内部 DOM，
 * 并统一用 Lumina 框架的声明式 VNode + signal 渲染，不手写 DOM 拼装。
 *
 * 配置只通过 property 传入，根元素不观察任何 attribute。
 */

import { getLocale, h, initI18n, isI18nEnabled, setLocale, signal, t } from '@/core';
import { dispatchPlayerEvent } from '@/live/core/events';
import { NOVA_LIVE_HOTKEYS } from '@/live/core/hotkeys';
import {
  clearSettings,
  loadMiniPosition,
  loadSettings,
  saveMiniPosition,
  saveSettings,
} from '@/live/core/persistence';
import { detectStreamKind } from '@/live/core/stream';
import type { StreamQuality } from '@/live/core/stream';
import { isDanmakuPluginInstance, LivePluginHost } from '@/live/core/pluginHost';
import { LiveTimerRegistry } from '@/live/core/timers';
import { pauseIcon, playIcon, refreshIcon } from '@/live/icons';
import { mergeLivePlayerMessages } from '@/live/i18n/locales';
import { DEFAULT_DANMAKU_SETTING } from '@/live/types';
import type {
  NovaCodecCandidate,
  NovaContextMenuAction,
  NovaContextMenuTarget,
  NovaControlAction,
  NovaDanmakuItem,
  NovaDanmakuSetting,
  NovaErrorContent,
  NovaLiveDanmakuPlugin,
  NovaLivePlayerOptions,
  NovaLivePlugin,
  NovaLineCandidate,
  NovaPanelName,
  NovaQualityCandidate,
  NovaScreenMode,
  NovaVideoInfo,
} from '@/live/types';
import type { VNode } from '@/types';
import { NovaLiveUiElement } from './base';
import { CONTROL_BAR_TAG, NovaLivePlayerControlBarElement } from './ControlBarElement';
import { DANMAKU_TAG, NovaLivePlayerDanmakuElement } from './DanmakuElement';
import { icon, reactive, text } from '../ui/helpers';
import {
  CodecPanel,
  ContextMenu,
  ErrorPanel,
  HotkeyPanel,
  InfoPanel,
  LoadingView,
  QualityPanel,
  SendBar,
  ToastView,
} from '../ui/panels';
import type { InfoChartSeries, MenuEntry } from '../ui/panels';
import { DmSettingPanel } from '../ui/dm-setting';

/** 根元素标签名。*/
export const LIVE_PLAYER_TAG = 'nova-live-player';

/** 倍速档位。*/
const SPEED_RATES = [0.75, 1, 1.25, 1.5, 2];

/** 信息面板刷新间隔。*/
const INFO_REFRESH_MS = 500;

/** 直播时长刷新间隔。*/
const LIVE_TIME_REFRESH_MS = 1000;

/** 控制条自动隐藏延时（对齐点播播放器）。*/
const CONTROL_HIDE_MS = 2600;

/** 信息面板曲线采样间隔（1Hz）。*/
const INFO_SAMPLE_MS = 1000;

/** 信息面板曲线保留的采样点数（环形窗口）。*/
const INFO_CHART_POINTS = 40;

/** 小窗默认距视口右下角的留白。*/
const MINI_VIEWPORT_MARGIN = 24;

/** 小窗尺寸兜底值（与 mini.scss 中的 CSS 变量保持一致，仅用于布局未就绪时收敛坐标）。*/
const MINI_FALLBACK_SIZE = { width: 380, height: 248 } as const;

/** 信息面板行定义。*/
const INFO_ROWS: ReadonlyArray<{ key: keyof NovaVideoInfo; labelKey: string }> = [
  { key: 'room', labelKey: 'livePlayer.info.room' },
  { key: 'status', labelKey: 'livePlayer.info.status' },
  { key: 'quality', labelKey: 'livePlayer.info.quality' },
  { key: 'line', labelKey: 'livePlayer.info.line' },
  { key: 'buffer', labelKey: 'livePlayer.info.buffer' },
  { key: 'droppedFrames', labelKey: 'livePlayer.info.dropped' },
  { key: 'resolution', labelKey: 'livePlayer.info.resolution' },
  { key: 'fps', labelKey: 'livePlayer.info.fps' },
  { key: 'player', labelKey: 'livePlayer.info.player' },
  { key: 'liveDuration', labelKey: 'livePlayer.info.liveDuration' },
];

/** 格式化直播时长。*/
const formatDuration = (totalSeconds: number): string => {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

/** 初始信息值。*/
const createEmptyInfo = (): Record<keyof NovaVideoInfo, string> => ({
  room: '-',
  status: '-',
  quality: '-',
  line: '-',
  buffer: '-',
  droppedFrames: '-',
  resolution: '-',
  fps: '-',
  player: '-',
  liveDuration: '00:00:00',
});

/** 根元素。*/
export class LivePlayerElement extends NovaLiveUiElement {
  /** 构造配置。*/
  private playerOptions: NovaLivePlayerOptions = {};

  /** 是否启用持久化。*/
  private persistEnabled = true;

  /** 是否已初始化。*/
  private initialized = false;

  /** 是否已销毁。*/
  private destroyed = false;

  /** 视频 / 弹幕 / 控制层。*/
  private videoEl: HTMLVideoElement | null = null;
  private danmakuEl: NovaLivePlayerDanmakuElement | null = null;
  private controlEl: NovaLivePlayerControlBarElement | null = null;

  /** 插件宿主（与点播播放器同一套 PluginManager）。*/
  private pluginHost: LivePluginHost | null = null;

  /** 开发者传入的弹幕插件（唯一入口）。*/
  private danmakuPlugin: NovaLiveDanmakuPlugin | null = null;

  /** 是否已安装弹幕插件（未安装时弹幕层不渲染、控制条入口禁用）。*/
  private danmakuAvailable = false;

  /** 音量浮层是否打开（打开期间控制条保持显示）。*/
  private volumeHovered = false;

  /** 音量 / 静音 / 清晰度 / 线路 / 倍速 / 屏幕。 */
  private volumeValue = 80;
  private mutedValue = false;
  private qualityValue = '';
  private lineValue = '';
  private speedRate = 1;
  private screenMode: NovaScreenMode = 'normal';
  private screenModeBeforeFullscreen: 'normal' | 'webscreen' = 'normal';

  /** 弹幕设置。*/
  private danmakuSetting: NovaDanmakuSetting = { ...DEFAULT_DANMAKU_SETTING, blockWords: [] };

  /** 清晰度 / 线路候选。*/
  private qualityCandidates: NovaQualityCandidate[] = [];
  private lineCandidates: NovaLineCandidate[] = [];

  /** 视频编码候选与当前值。*/
  private codecCandidates: NovaCodecCandidate[] = [];
  private codecValue = '';

  /** 右键目标 / 悬停弹幕 / 数据源。*/
  private menuTarget: NovaContextMenuTarget | null = null;
  private hoveredDanmaku: NovaContextMenuTarget | null = null;
  private danmakuSource: NovaDanmakuItem[] = [];

  /** 直播开始时间戳。*/
  private liveStartedAt = 0;

  /** 统一计时器注册表（所有延时 / 周期任务集中登记，disconnect 时统一清理）。*/
  private readonly timers = new LiveTimerRegistry();

  /** 面板延迟关闭的 debounce 包装（token 校验仍由面板 token 表负责）。*/
  private readonly panelCloseDebouncers = new Map<NovaPanelName, () => void>();
  private readonly panelCloseTokens = new Map<NovaPanelName, number>();
  private readonly panelPendingTokens = new Map<NovaPanelName, number>();

  /** 点击固定的面板（固定后不因鼠标离开关闭）。*/
  private readonly pinnedPanels = new Set<NovaPanelName>();

  /** 媒体事件清理。*/
  private mediaCleanups: Array<() => void> = [];

  /** 恢复配置中。*/
  private restoring = false;

  /** ready / 自动播放。*/
  private readyDispatched = false;
  private pendingAutoplay = false;

  /** 帧率采样。*/
  private frameSampleAt = 0;
  private frameSampleTotal = 0;

  /** 信息曲线上次采样时间（0 表示下一次刷新立即采样）。*/
  private lastInfoSampleAt = 0;

  /** 房间 / 状态。*/
  private roomLabel = '';
  private statusKey = 'livePlayer.status.live';

  // ============================================================
  // 小窗状态（悬浮 mini 播放器）
  // ============================================================

  /** 是否处于小窗。*/
  private miniMode = false;

  /** 关闭小窗后暂停自动弹出（玩家滚回可见位置时解除）。*/
  private autoMiniSuppressed = false;

  /** 小窗在视口中的位置（左上角，单位 px）。*/
  private miniPosition: { left: number; top: number } | null = null;

  /** 观测「播放器原始位置」的 IntersectionObserver。*/
  private miniObserver: IntersectionObserver | null = null;

  /** 当前被观测的目标（根元素或原始位置锚点）。*/
  private miniObservedTarget: Element | null = null;

  /** 原始位置锚点：小窗期间用于判断播放器是否滚回视口。*/
  private miniAnchor: HTMLElement | null = null;

  /**
   * 小窗期间「原始位置是否曾经完全离开视口」。
   *
   * 只有先离开、再回来才自动退出：手动点开小窗时播放器本来就在视口里，
   * 不能因为锚点可见就立刻收回。
   */
  private miniAnchorOutOfView = false;

  /** header 元素（拖动时做指针捕获）。*/
  private miniHeaderEl: HTMLElement | null = null;

  /** 拖动会话。*/
  private miniDrag: {
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null = null;

  // ============================================================
  // UI 信号
  // ============================================================

  private readonly sPlaying = signal(false);
  private readonly sMuted = signal(false);
  private readonly sVolume = signal(80);
  private readonly sDanmakuOn = signal(true);
  private readonly sQualityLabel = signal('');
  private readonly sSpeedLabel = signal('1x');
  private readonly sSpeedRate = signal(1);
  private readonly sScreenMode = signal<NovaScreenMode>('normal');
  private readonly sMini = signal(false);
  private readonly sMiniTitle = signal('');
  private readonly sMiniRoom = signal('');
  private readonly sControlVisible = signal(true);
  private readonly sQualityOpen = signal(false);
  private readonly sSpeedOpen = signal(false);
  private readonly sDmOpen = signal(false);
  private readonly sInfoOpen = signal(false);
  private readonly sHotkeyOpen = signal(false);
  private readonly sCodecOpen = signal(false);
  private readonly sSendOpen = signal(false);
  private readonly sMenuOpen = signal(false);
  private readonly sMenuX = signal(0);
  private readonly sMenuY = signal(0);
  private readonly sMenuItems = signal<MenuEntry[]>([]);
  private readonly sMenuTarget = signal<NovaContextMenuTarget | null>(null);
  private readonly sToastVisible = signal(false);
  private readonly sToastMessage = signal('');
  private readonly sToastType = signal('info');
  private readonly sErrorVisible = signal(false);
  private readonly sErrorMessage = signal('');
  private readonly sLoading = signal(false);
  private readonly sInfoValues = signal<Record<keyof NovaVideoInfo, string>>(createEmptyInfo());
  private readonly sLiveTime = signal('00:00:00');
  private readonly sQualityPage = signal(0);
  private readonly sQualityCandidates = signal<NovaQualityCandidate[]>([]);
  private readonly sQualityValue = signal('');
  private readonly sLineCandidates = signal<NovaLineCandidate[]>([]);
  private readonly sLineValue = signal('');
  private readonly sCodecCandidates = signal<NovaCodecCandidate[]>([]);
  private readonly sCodecValue = signal('');
  private readonly sInfoSeries = signal<InfoChartSeries>({ buffer: [], dropped: [] });
  private readonly sDmSetting = signal<NovaDanmakuSetting>({ ...DEFAULT_DANMAKU_SETTING, blockWords: [] });
  private readonly sDmPage = signal(0);

  /** options property。*/
  set options(value: NovaLivePlayerOptions) {
    this.playerOptions = value ?? {};
    if (this.initialized) this.applyOptions();
  }

  get options(): NovaLivePlayerOptions {
    return this.playerOptions;
  }

  /** 持久化。*/
  get persist(): boolean {
    return this.persistEnabled;
  }

  set persist(value: boolean) {
    this.persistEnabled = Boolean(value);
    if (this.persistEnabled) this.persistState();
  }

  /** 流地址。*/
  get streamUrl(): string {
    return this.pluginHost?.getUrl() || this.playerOptions.streamUrl || '';
  }

  set streamUrl(url: string) {
    this.setStream(url);
  }

  /** 音量 / 静音。*/
  get volume(): number {
    return this.volumeValue;
  }

  set volume(value: number) {
    this.setVolume(value);
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  set muted(value: boolean) {
    this.setMuted(value);
  }

  /** 清晰度 / 线路 / 屏幕。*/
  get quality(): string {
    return this.qualityValue;
  }

  get line(): string {
    return this.lineValue;
  }

  /** 当前视频编码。*/
  get codec(): string {
    return this.codecValue;
  }

  get screenModeValue(): NovaScreenMode {
    return this.screenMode;
  }

  /** 是否处于小窗（悬浮 mini 播放器）。*/
  get mini(): boolean {
    return this.miniMode;
  }

  /** 弹幕设置副本。*/
  public getDanmakuSetting(): NovaDanmakuSetting {
    return { ...this.danmakuSetting, blockWords: [...this.danmakuSetting.blockWords] };
  }

  /** 候选副本。*/
  public getQualityCandidates(): NovaQualityCandidate[] {
    return this.qualityCandidates.map((item) => ({ ...item }));
  }

  public getLineCandidates(): NovaLineCandidate[] {
    return this.lineCandidates.map((item) => ({ ...item }));
  }

  public getCodecCandidates(): NovaCodecCandidate[] {
    return this.codecCandidates.map((item) => ({ ...item }));
  }

  // ============================================================
  // 渲染
  // ============================================================

  /** 渲染整棵播放器树（声明式）。*/
  protected render(): VNode {
    this.initI18n();
    // 弹幕层只在开发者传入弹幕插件时渲染；未提供时整个弹幕图层不挂载。
    this.danmakuAvailable = this.resolveDanmakuPlugin() !== null;
    return h(
      'div',
      {
        class: 'nova-live-player',
        onPointerenter: (): void => this.showControls(),
        onPointermove: (): void => this.showControls(),
        onPointerleave: (): void => this.scheduleHideControls(700),
        onContextmenu: (event: MouseEvent): void => this.handleContextMenu(event),
      },
      h('video', {
        class: 'nova-live-player-video',
        playsinline: 'true',
        preload: 'none',
        // 播放 / 暂停只能由控制条按钮（及快捷键）触发：
        // 单击画面不做播放暂停切换，避免误触（双击仍是全屏）。
        onDblclick: (): void => void this.toggleFullscreen(),
        ref: (el: unknown): void => {
          this.videoEl = el instanceof HTMLVideoElement ? el : null;
        },
      }),
      ...(this.danmakuAvailable
        ? [
            h(DANMAKU_TAG, {
              ref: (el: unknown): void => {
                this.danmakuEl = el instanceof NovaLivePlayerDanmakuElement ? el : null;
                if (this.danmakuEl) {
                  this.danmakuEl.onHover = (item): void => {
                    this.hoveredDanmaku = item;
                  };
                }
              },
            }),
          ]
        : []),
      LoadingView({ visible: this.sLoading }),
      ErrorPanel({ visible: this.sErrorVisible, message: this.sErrorMessage, onRetry: (): void => this.reload() }),
      ToastView({ visible: this.sToastVisible, message: this.sToastMessage, type: this.sToastType }),
      SendBar({ open: this.sSendOpen, onSubmit: (value): void => this.sendDanmaku(value) }),
      h(CONTROL_BAR_TAG, {
        ref: (el: unknown): void => {
          this.controlEl = el instanceof NovaLivePlayerControlBarElement ? el : null;
          if (this.controlEl) {
            this.controlEl.bind({
              playing: this.sPlaying,
              muted: this.sMuted,
              volume: this.sVolume,
              danmakuOn: this.sDanmakuOn,
              danmakuAvailable: this.danmakuAvailable,
              qualityLabel: this.sQualityLabel,
              speedLabel: this.sSpeedLabel,
              screenMode: this.sScreenMode,
              mini: this.sMini,
              visible: this.sControlVisible,
              liveTime: this.sLiveTime,
              timers: this.timers,
              onAction: (action): void => this.handleControlAction(action),
              onVolume: (value): void => this.setVolume(value),
              onVolumeHover: (open): void => this.handleVolumeHover(open),
              onPanelHover: (name): void => this.hoverPanelOpen(name),
              onPanelLeave: (name): void => this.schedulePanelClose(name),
            });
          }
        },
      }),
      this.renderMiniChrome(),
      QualityPanel({
        open: this.sQualityOpen,
        page: this.sQualityPage,
        candidates: this.sQualityCandidates,
        current: this.sQualityValue,
        lines: this.sLineCandidates,
        lineCurrent: this.sLineValue,
        onSelectQuality: (qn): void => void this.setQuality(qn),
        onSelectLine: (line): void => { this.setLine(line); },
        onPointerEnter: (): void => this.keepPanel('quality'),
        onPointerLeave: (): void => this.leavePanel('quality'),
        onPin: (): void => this.pinPanel('quality'),
      }),
      DmSettingPanel({
        setting: this.sDmSetting,
        page: this.sDmPage,
        visible: this.sDmOpen,
        onChange: (patch): void => this.updateDanmakuSetting(patch),
        onReset: (): void => this.resetDanmakuSetting(),
        onPointerEnter: (): void => this.keepPanel('danmaku'),
        onPointerLeave: (): void => this.leavePanel('danmaku'),
        onPin: (): void => this.pinPanel('danmaku'),
      }),
      InfoPanel({
        open: this.sInfoOpen,
        values: this.sInfoValues,
        rows: INFO_ROWS,
        series: this.sInfoSeries,
        onClose: (): void => this.closePanel('info'),
        onPointerEnter: (): void => this.keepPanel('info'),
        onPointerLeave: (): void => this.leavePanel('info'),
        onPin: (): void => this.pinPanel('info'),
      }),
      HotkeyPanel({
        open: this.sHotkeyOpen,
        rows: NOVA_LIVE_HOTKEYS,
        onClose: (): void => this.closePanel('hotkey'),
        onPointerEnter: (): void => this.keepPanel('hotkey'),
        onPointerLeave: (): void => this.leavePanel('hotkey'),
        onPin: (): void => this.pinPanel('hotkey'),
      }),
      CodecPanel({
        open: this.sCodecOpen,
        candidates: this.sCodecCandidates,
        current: this.sCodecValue,
        onSelect: (codec): void => void this.setCodec(codec),
        onClose: (): void => this.closePanel('codec'),
        onPointerEnter: (): void => this.keepPanel('codec'),
        onPointerLeave: (): void => this.leavePanel('codec'),
        onPin: (): void => this.pinPanel('codec'),
      }),
      ContextMenu({
        open: this.sMenuOpen,
        x: this.sMenuX,
        y: this.sMenuY,
        items: this.sMenuItems,
        target: this.sMenuTarget,
        onAction: (action): void => this.handleMenuAction(action),
        onClose: (): void => {
          this.sMenuOpen.value = false;
        },
      }),
    );
  }

  // ============================================================
  // 渲染：小窗
  // ============================================================

  /**
   * 渲染小窗 UI（悬浮 mini 播放器）。
   *
   * DOM 结构照真实直播间 mini 播放器：
   * - 头部标题（真实是 `data-room-title` 的 `:before`）→ `-mini-header` / `-mini-title`；
   * - 关闭按钮（真实 `.minimal-restore-btn`）→ `-mini-close`；
   * - 悬停遮罩与控制按钮（真实 `.minimal-control-panel` / `.control-btn`）→
   *   `-mini-overlay` / `-mini-play` / `-mini-refresh`。
   *
   * 视频与弹幕仍然是同一份 DOM（不新建 video 元素），小窗只改变根元素尺寸与层级。
   */
  private renderMiniChrome(): VNode {
    return h(
      'div',
      {
        class: 'nova-live-player-mini',
        role: 'region',
        'aria-label': t('livePlayer.mini.label'),
        ...reactive({ hidden: (): boolean => !this.sMini.value }),
      },
      h(
        'div',
        {
          class: 'nova-live-player-mini-header',
          ref: (el: unknown): void => {
            this.miniHeaderEl = el instanceof HTMLElement ? el : null;
          },
          onPointerdown: (event: PointerEvent): void => this.handleMiniDragStart(event),
        },
        h(
          'span',
          {
            class: 'nova-live-player-mini-title',
            ...reactive({ title: (): string => this.sMiniTitle.value }),
          },
          text((): string => this.sMiniTitle.value),
        ),
        h('button', {
          type: 'button',
          class: 'nova-live-player-mini-close',
          title: t('livePlayer.mini.close'),
          'aria-label': t('livePlayer.mini.close'),
          onClick: (): void => this.closeMiniByUser(),
        }),
      ),
      h(
        'div',
        { class: 'nova-live-player-mini-body' },
        h(
          'div',
          { class: 'nova-live-player-mini-watermark' },
          'bilibili 直播',
          h(
            'span',
            {
              class: 'nova-live-player-mini-room',
              ...reactive({ hidden: (): boolean => this.sMiniRoom.value === '' }),
            },
            text((): string => this.sMiniRoom.value),
          ),
        ),
        h(
          'div',
          { class: 'nova-live-player-mini-overlay' },
          h(
            'div',
            { class: 'nova-live-player-mini-overlay-inner' },
            h(
              'button',
              {
                type: 'button',
                class: 'nova-live-player-mini-play',
                ...reactive({
                  'aria-label': (): string =>
                    this.sPlaying.value ? t('livePlayer.control.pause') : t('livePlayer.control.play'),
                }),
                onClick: (): void => this.togglePlay(),
              },
              h(
                'span',
                { class: 'nova-live-player-mini-icon' },
                h(
                  'span',
                  { ...reactive({ hidden: (): boolean => this.sPlaying.value }) },
                  icon(playIcon(), 'nova-live-player-mini-icon-glyph'),
                ),
                h(
                  'span',
                  { ...reactive({ hidden: (): boolean => !this.sPlaying.value }) },
                  icon(pauseIcon(), 'nova-live-player-mini-icon-glyph'),
                ),
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'nova-live-player-mini-refresh',
                'aria-label': t('livePlayer.control.refresh'),
                onClick: (): void => this.reload(),
              },
              icon(refreshIcon(), 'nova-live-player-mini-icon-glyph'),
            ),
          ),
        ),
      ),
    );
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /** 连接后初始化。*/
  protected onConnect(): void {
    if (this.destroyed || this.initialized || typeof window === 'undefined') return;
    this.initialized = true;
    this.restoring = true;
    this.initI18n();
    this.restoreSettings();
    this.pluginHost = new LivePluginHost();
    this.pluginHost.onStreamQualities = (list, current): void => this.applyStreamQualities(list, current);
    this.pluginHost.onStreamError = (message): void => this.reportStreamError(message);
    this.ensurePlugins();
    this.bindMediaEvents();
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    this.restoring = false;
    this.syncAllUi();
    this.applyOptions();
    this.restoreMiniPosition();
    this.syncMiniMeta();
    this.setupMiniObserver();
    window.addEventListener('resize', this.onWindowResize);
    this.startLiveTimeTimer();
    this.showControls();
    queueMicrotask((): void => this.dispatchReady());
  }

  /** 离开文档。*/
  protected onDisconnect(): void {
    this.stopInfoTimer();
    this.stopLiveTimeTimer();
    // 统一清理：Toast / 控制条自动隐藏 / 面板 hover 与延迟关闭 / 音量浮层
    // 等全部任务都在同一个注册表里，不会留下悬挂回写。
    this.timers.clearAll();
    this.teardownMini();
    window.removeEventListener('resize', this.onWindowResize);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    for (const cleanup of this.mediaCleanups.splice(0)) cleanup();
    this.pluginHost?.destroy();
    this.pluginHost = null;
    this.danmakuPlugin = null;
    this.volumeHovered = false;
    this.initialized = false;
  }

  /** 销毁。*/
  public destroy(): void {
    if (this.destroyed) return;
    this.onDisconnect();
    dispatchPlayerEvent(this, 'destroy', undefined);
    this.destroyed = true;
    this.destroyView();
  }

  /** 全局处理器。*/
  private readonly onKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event);
  private readonly onFullscreenChange = (): void => this.syncFullscreenState();
  private readonly onDocumentPointerDown = (event: PointerEvent): void => this.handleDocumentPointerDown(event);

  // ============================================================
  // 公开 API：播放 / 流  // ============================================================

  /** 播放。*/
  public async play(): Promise<void> {
    if (!this.videoEl || (!this.videoEl.currentSrc && !this.streamUrl)) {
      this.pendingAutoplay = true;
      return;
    }
    try {
      await this.videoEl.play();
    } catch {
      this.showToast(t('livePlayer.toast.playBlocked'), 'warning');
    }
  }

  /** 暂停。*/
  public pause(): void {
    this.videoEl?.pause();
  }

  /** 播放 / 暂停切换。*/
  public togglePlay(): void {
    if (this.videoEl?.paused !== false) void this.play();
    else this.pause();
  }

  /** 切换流。*/
  public setStream(url: string): void {
    if (!url) return;
    this.playerOptions = { ...this.playerOptions, streamUrl: url };
    this.liveStartedAt = 0;
    const shouldPlay = this.pendingAutoplay || this.videoEl?.paused === false;
    this.pendingAutoplay = false;
    this.sLoading.value = true;
    this.loadStream(url);
    if (shouldPlay) void this.play();
    dispatchPlayerEvent(this, 'streamchange', { url });
  }

  /** 重新加载。*/
  public reload(): void {
    const wasPlaying = this.videoEl?.paused === false;
    const url = this.streamUrl;
    this.liveStartedAt = 0;
    if (url) this.loadStream(url);
    if (wasPlaying) void this.play();
    this.sLoading.value = true;
    dispatchPlayerEvent(this, 'reload', undefined);
    this.showToast(t('livePlayer.toast.reloaded'), 'info');
  }

  /**
   * 把流地址交给开发者传入的流媒体插件。
   *
   * 只有这里做「后缀 → 插件声明类型」的匹配；加载、解封装、切档全部由插件完成。
   * 未提供对应插件时回退原生 `<video>` 并 Toast 提示。
   *
   * @param url - 流地址。
   */
  private loadStream(url: string): void {
    const result = this.pluginHost?.loadStream(url) ?? 'native';
    if (result === 'plugin' || result === 'unsupported') return;
    if (this.videoEl) {
      this.videoEl.src = url;
      this.videoEl.load();
    }
    if (result === 'missing') {
      this.showToast(t('livePlayer.toast.streamPluginMissing'), 'warning');
    }
  }

  // ============================================================
  // 公开 API：音量 / 倍速  // ============================================================

  /** 设置音量。*/
  public setVolume(value: number): void {
    const previous = this.volumeValue;
    const next = Math.max(0, Math.min(100, Math.round(value)));
    this.volumeValue = next;
    this.sVolume.value = next;
    if (this.videoEl) {
      this.videoEl.volume = next / 100;
      if (next > 0 && this.videoEl.muted) this.videoEl.muted = false;
    }
    if (!this.restoring && previous !== next) {
      dispatchPlayerEvent(this, 'volumechange', { volume: next });
      this.persistState();
    }
  }

  /** 设置静音。*/
  public setMuted(muted: boolean): void {
    const previous = this.mutedValue;
    this.mutedValue = Boolean(muted);
    this.sMuted.value = this.mutedValue;
    if (this.videoEl) this.videoEl.muted = this.mutedValue;
    if (!this.restoring && previous !== this.mutedValue) {
      dispatchPlayerEvent(this, 'mutechange', { muted: this.mutedValue });
      this.persistState();
    }
  }

  /** 静音切换。*/
  public toggleMute(): void {
    this.setMuted(!this.videoEl?.muted);
  }

  /** 设置倍速。*/
  public setSpeed(rate: number): void {
    this.speedRate = rate;
    this.sSpeedRate.value = rate;
    this.sSpeedLabel.value = `${rate}x`;
    if (this.videoEl) this.videoEl.playbackRate = rate;
    this.closePanel('speed');
  }

  /** 循环倍速。*/
  public cycleSpeed(): void {
    const index = SPEED_RATES.indexOf(this.speedRate);
    this.setSpeed(SPEED_RATES[(index + 1) % SPEED_RATES.length]);
    this.showToast(t('livePlayer.toast.speed', { rate: this.speedRate }), 'info');
  }

  // ============================================================
  // 公开 API：清晰度 / 线路
  // ============================================================

  /** 设置清晰度候选。*/
  public setQualityCandidates(list: readonly NovaQualityCandidate[], current?: string): void {
    this.qualityCandidates = list.map((item) => ({ ...item }));
    if (current !== undefined) this.qualityValue = current;
    else if (!this.qualityCandidates.some((item) => item.qn === this.qualityValue)) {
      this.qualityValue = this.qualityCandidates[0]?.qn ?? '';
    }
    this.sQualityCandidates.value = this.qualityCandidates;
    this.sQualityValue.value = this.qualityValue;
    this.syncQualityLabel();
    this.dispatchWhenReady('qualitycandidates', {
      candidates: this.qualityCandidates.map((item) => ({ qn: item.qn, label: item.label })),
      current: this.qualityValue,
    });
  }

  /** 切换清晰度。*/
  public async setQuality(qn: string): Promise<boolean> {
    const target = this.qualityCandidates.find((item) => item.qn === qn);
    if (!target) return false;
    this.qualityValue = qn;
    this.sQualityValue.value = qn;
    // 能力来自插件实例：插件提供 setQuality 才真正切换，否则只更新 UI 空态。
    this.pluginHost?.setQuality(qn);
    this.syncQualityLabel();
    this.persistState();
    dispatchPlayerEvent(this, 'qualitychange', { quality: qn, label: target.label });
    this.showToast(t('livePlayer.toast.qualitySwitched', { label: target.label }), 'success');
    this.closePanel('quality');
    return true;
  }

  /** 设置线路候选。*/
  public setLineCandidates(list: readonly NovaLineCandidate[], current?: string): void {
    this.lineCandidates = list.map((item) => ({ ...item }));
    if (current !== undefined) this.lineValue = current;
    else if (!this.lineCandidates.some((item) => item.line === this.lineValue)) {
      this.lineValue = this.lineCandidates[0]?.line ?? '';
    }
    this.sLineCandidates.value = this.lineCandidates;
    this.sLineValue.value = this.lineValue;
    this.dispatchWhenReady('linecandidates', {
      candidates: this.lineCandidates.map((item) => ({ line: item.line, label: item.label })),
      current: this.lineValue,
    });
  }

  /** 切换线路。*/
  public setLine(line: string): boolean {
    const target = this.lineCandidates.find((item) => item.line === line);
    if (!target) return false;
    this.lineValue = line;
    this.sLineValue.value = line;
    this.persistState();
    dispatchPlayerEvent(this, 'linechange', { line, label: target.label });
    this.showToast(t('livePlayer.toast.lineSwitched', { label: target.label }), 'success');
    this.closePanel('quality');
    return true;
  }

  // ============================================================
  // 公开 API：视频编码
  // ============================================================

  /** 设置视频编码候选。*/
  public setCodecCandidates(list: readonly NovaCodecCandidate[], current?: string): void {
    this.codecCandidates = list.map((item) => ({ ...item }));
    if (current !== undefined) this.codecValue = current;
    else if (!this.codecCandidates.some((item) => item.codec === this.codecValue)) {
      this.codecValue = this.codecCandidates[0]?.codec ?? '';
    }
    this.sCodecCandidates.value = this.codecCandidates;
    this.sCodecValue.value = this.codecValue;
  }

  /** 切换视频编码（UI 状态 + 事件，真实编码切换由上层负责）。*/
  public async setCodec(codec: string): Promise<boolean> {
    const target = this.codecCandidates.find((item) => item.codec === codec);
    if (!target) return false;
    this.codecValue = codec;
    this.sCodecValue.value = codec;
    // 插件实现 setCodecPreference 时转发编码偏好；否则仅 UI 状态 + 事件。
    this.pluginHost?.setCodecPreference(codec);
    this.persistState();
    dispatchPlayerEvent(this, 'codecchange', { codec, label: target.label });
    this.showToast(t('livePlayer.toast.codecSwitched', { label: target.label }), 'success');
    this.closePanel('codec');
    return true;
  }

  // ============================================================
  // 公开 API：屏幕 / 画中画  // ============================================================

  /** 原生全屏。*/
  public async enterFullscreen(): Promise<void> {
    if (document.fullscreenElement === this) return;
    if (!this.requestFullscreen) {
      this.showToast(t('livePlayer.toast.fullscreenUnsupported'), 'warning');
      return;
    }
    this.screenModeBeforeFullscreen = this.screenMode === 'fullscreen' ? 'normal' : this.screenMode;
    try {
      await this.requestFullscreen();
    } catch {
      this.showToast(t('livePlayer.toast.fullscreenUnsupported'), 'warning');
    }
  }

  /** 退出原生全屏。*/
  public async exitFullscreen(): Promise<void> {
    if (document.fullscreenElement !== this) return;
    try {
      await document.exitFullscreen();
    } catch {
      this.setScreenMode(this.screenModeBeforeFullscreen);
    }
  }

  /** 原生全屏切换。*/
  public async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement === this) await this.exitFullscreen();
    else await this.enterFullscreen();
  }

  /** 网页全屏。*/
  public enterWebFullscreen(): void {
    this.screenModeBeforeFullscreen = 'webscreen';
    if (document.fullscreenElement === this) void document.exitFullscreen();
    this.setScreenMode('webscreen');
  }

  public exitWebFullscreen(): void {
    if (this.screenMode !== 'webscreen') return;
    this.setScreenMode('normal');
  }

  public toggleWebFullscreen(): void {
    if (this.screenMode === 'webscreen') this.exitWebFullscreen();
    else this.enterWebFullscreen();
  }

  /** 画中画。*/
  public async togglePip(): Promise<void> {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (this.videoEl?.requestPictureInPicture) await this.videoEl.requestPictureInPicture();
      else this.showToast(t('livePlayer.toast.pipUnsupported'), 'warning');
    } catch {
      this.showToast(t('livePlayer.toast.pipUnsupported'), 'warning');
    }
  }

  // ============================================================
  // 公开 API：小窗（悬浮 mini 播放器）
  // ============================================================

  /**
   * 进入小窗。
   *
   * 只改变根元素自身（`data-mini` + 视口坐标），视频 / 弹幕 DOM 保持不动，
   * 因此播放不中断。窗口形态（网页全屏 / 原生全屏）下不允许进入小窗。
   *
   * @returns 是否成功进入。
   */
  public enterMini(): boolean {
    if (!this.initialized || this.destroyed || this.miniMode) return false;
    if (typeof window === 'undefined') return false;
    if (this.screenMode !== 'normal') return false;
    this.closePanels();
    this.sMenuOpen.value = false;
    this.sSendOpen.value = false;
    // 先断开「原位置」观测并在原始位置放一个锚点，再让根元素脱离文档流。
    this.disconnectMiniObserver();
    const rect = this.getBoundingClientRect();
    const anchor = this.ensureMiniAnchor(rect);
    this.miniAnchorOutOfView = !this.isRectInViewport(rect);
    this.miniMode = true;
    this.sMini.value = true;
    this.dataset.mini = 'true';
    this.applyMiniPosition(this.resolveMiniPosition());
    this.observeMiniTarget(anchor);
    dispatchPlayerEvent(this, 'minichange', { mini: true });
    return true;
  }

  /**
   * 退出小窗（不滚动页面）。
   *
   * @returns 是否确实由小窗切换回常规形态。
   */
  public exitMini(): boolean {
    return this.exitMiniInternal({ scrollBack: false });
  }

  /** 小窗切换。*/
  public toggleMini(): boolean {
    return this.miniMode ? this.exitMini() : this.enterMini();
  }

  /**
   * 关闭按钮：退出小窗并跳回播放器原始位置。
   *
   * 关闭后暂停自动弹出，直到玩家把播放器滚回视口（锚点可见）再解除。
   */
  private closeMiniByUser(): void {
    this.exitMiniInternal({ scrollBack: true });
  }

  /**
   * 退出小窗内部实现。
   *
   * @param options - `scrollBack` 为 true 时用 `scrollIntoView` 跳回原位置。
   */
  private exitMiniInternal(options: { scrollBack: boolean }): boolean {
    if (!this.miniMode) return false;
    this.endMiniDrag();
    this.miniMode = false;
    this.sMini.value = false;
    delete this.dataset.mini;
    this.style.left = '';
    this.style.top = '';
    this.style.right = '';
    this.style.bottom = '';
    this.disconnectMiniObserver();
    this.removeMiniAnchor();
    this.miniAnchorOutOfView = false;
    this.observeHostForMini();
    if (options.scrollBack) {
      this.autoMiniSuppressed = true;
      this.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    dispatchPlayerEvent(this, 'minichange', { mini: false });
    return true;
  }

  /** 读取小窗位置（先按视口收敛，避免视口变小后窗口跑到屏幕外）。*/
  private resolveMiniPosition(): { left: number; top: number } {
    const size = this.measureMiniSize();
    const fallback = {
      left: window.innerWidth - size.width - MINI_VIEWPORT_MARGIN,
      top: window.innerHeight - size.height - MINI_VIEWPORT_MARGIN,
    };
    const saved = this.miniPosition ?? fallback;
    return this.clampMiniPosition(saved.left, saved.top);
  }

  /** 收敛到视口内。*/
  private clampMiniPosition(left: number, top: number): { left: number; top: number } {
    const size = this.measureMiniSize();
    const maxLeft = Math.max(0, window.innerWidth - size.width);
    const maxTop = Math.max(0, window.innerHeight - size.height);
    return {
      left: Math.min(Math.max(0, Math.round(left)), Math.round(maxLeft)),
      top: Math.min(Math.max(0, Math.round(top)), Math.round(maxTop)),
    };
  }

  /** 小窗实际尺寸（布局未就绪时用与 SCSS 同源的兜底值）。*/
  private measureMiniSize(): { width: number; height: number } {
    const width = this.offsetWidth || MINI_FALLBACK_SIZE.width;
    const height = this.offsetHeight || MINI_FALLBACK_SIZE.height;
    return { width, height };
  }

  /**
   * 应用小窗坐标。
   *
   * 运行期坐标只能走内联样式（静态尺寸 / 颜色仍在 SCSS 里）。
   */
  private applyMiniPosition(position: { left: number; top: number }): void {
    const next = this.clampMiniPosition(position.left, position.top);
    this.miniPosition = next;
    this.style.left = `${next.left}px`;
    this.style.top = `${next.top}px`;
    // 覆盖宿主可能存在的 right/bottom 定位，保证拖动坐标是唯一来源。
    this.style.right = 'auto';
    this.style.bottom = 'auto';
  }

  /** header 按下开始拖动。*/
  private handleMiniDragStart(event: PointerEvent): void {
    if (!this.miniMode || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.nova-live-player-mini-close')) return;
    const header = this.miniHeaderEl;
    if (!header) return;
    event.preventDefault();
    const rect = this.getBoundingClientRect();
    this.miniDrag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    // 指针捕获保证鼠标移出 header 后依然能收到 pointermove。
    try {
      header.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件没有活动指针时捕获会失败，降级为普通 move 监听。
    }
    header.addEventListener('pointermove', this.onMiniDragMove);
    header.addEventListener('pointerup', this.onMiniDragEnd);
    header.addEventListener('pointercancel', this.onMiniDragEnd);
  }

  private readonly onMiniDragMove = (event: PointerEvent): void => {
    if (!this.miniDrag || event.pointerId !== this.miniDrag.pointerId) return;
    this.applyMiniPosition({
      left: event.clientX - this.miniDrag.offsetX,
      top: event.clientY - this.miniDrag.offsetY,
    });
  };

  private readonly onMiniDragEnd = (event: PointerEvent): void => {
    if (this.miniDrag && event.pointerId !== this.miniDrag.pointerId) return;
    this.endMiniDrag();
    this.persistMiniPosition();
  };

  /** 结束拖动（解绑监听 / 释放捕获）。*/
  private endMiniDrag(): void {
    const header = this.miniHeaderEl;
    if (header) {
      header.removeEventListener('pointermove', this.onMiniDragMove);
      header.removeEventListener('pointerup', this.onMiniDragEnd);
      header.removeEventListener('pointercancel', this.onMiniDragEnd);
      if (this.miniDrag) {
        try {
          header.releasePointerCapture(this.miniDrag.pointerId);
        } catch {
          // 捕获已被浏览器释放时忽略。
        }
      }
    }
    this.miniDrag = null;
  }

  /** 写入小窗位置（尊重 `persist=false`）。*/
  private persistMiniPosition(): void {
    if (!this.miniPosition) return;
    saveMiniPosition(this.miniPosition, this.persistEnabled);
  }

  /** 读取已持久化的小窗位置（`persist=false` 时不读）。*/
  private restoreMiniPosition(): void {
    if (!this.persistEnabled) return;
    const saved = loadMiniPosition();
    if (saved) this.miniPosition = saved;
  }

  /** 标题 / 房间号（options.room 优先，其次 `data-room`）。*/
  private syncMiniMeta(): void {
    const room = this.resolveRoomLabel();
    const documentTitle = typeof document === 'undefined' ? '' : document.title.trim();
    this.sMiniTitle.value = room || documentTitle;
    this.sMiniRoom.value = room;
  }

  /** 房间号来源：`options.room` → `data-room`。*/
  private resolveRoomLabel(): string {
    const fromOptions = this.playerOptions.room;
    if (typeof fromOptions === 'string' && fromOptions.trim()) return fromOptions.trim();
    const fromData = this.dataset.room;
    return typeof fromData === 'string' ? fromData.trim() : '';
  }

  // ============================================================
  // 内部：小窗滚动观测
  // ============================================================

  /**
   * 监听播放器是否滚出视口。
   *
   * 常规形态直接观测根元素；进入小窗后根元素变成 `position: fixed`，
   * 改观测「原始位置锚点」，从而「滚回可见 → 自动退出」依然成立。
   */
  private setupMiniObserver(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    if (!this.miniObserver) {
      this.miniObserver = new IntersectionObserver(
        (entries): void => this.handleMiniIntersection(entries),
        { threshold: 0 },
      );
    }
    this.observeHostForMini();
  }

  /** 观测根元素（常规形态）。*/
  private observeHostForMini(): void {
    if (!this.miniObserver) return;
    this.disconnectMiniObserver();
    this.miniObserver.observe(this);
    this.miniObservedTarget = this;
  }

  /** 观测指定目标。*/
  private observeMiniTarget(target: Element | null): void {
    if (!this.miniObserver || !target) return;
    this.disconnectMiniObserver();
    this.miniObserver.observe(target);
    this.miniObservedTarget = target;
  }

  /** 断开观测。*/
  private disconnectMiniObserver(): void {
    this.miniObserver?.disconnect();
    this.miniObservedTarget = null;
  }

  /**
   * 滚动可见性回调。
   *
   * threshold 为 0：`isIntersecting=false` 等价于「完全滚出视口」。
   * 只在播放中自动弹出；关闭小窗后的一次性抑制标记在播放器重新可见时解除。
   */
  private handleMiniIntersection(entries: IntersectionObserverEntry[]): void {
    if (!this.initialized || this.destroyed) return;
    const entry = entries[entries.length - 1];
    if (!entry || entry.target !== this.miniObservedTarget) return;
    if (this.miniMode) {
      if (!entry.isIntersecting) {
        this.miniAnchorOutOfView = true;
        return;
      }
      // 只有「离开过再回来」才自动退出（手动打开小窗时不会立刻收回）。
      if (this.miniAnchorOutOfView) this.exitMiniInternal({ scrollBack: false });
      return;
    }
    if (entry.isIntersecting) {
      this.autoMiniSuppressed = false;
      return;
    }
    if (this.autoMiniSuppressed) return;
    if (this.screenMode !== 'normal') return;
    if (this.videoEl?.paused !== false) return;
    this.enterMini();
  }

  /** 矩形是否与视口相交（与 IntersectionObserver threshold 0 语义一致）。*/
  private isRectInViewport(rect: DOMRect): boolean {
    return (
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight
    );
  }

  /** 在播放器原始位置放一个不可见锚点（文档坐标，供小窗期间观测）。*/
  private ensureMiniAnchor(rect: DOMRect): HTMLElement | null {    if (typeof document === 'undefined' || !document.body) return null;
    let anchor = this.miniAnchor;
    if (!anchor || !anchor.isConnected) {
      anchor = document.createElement('div');
      anchor.className = 'nova-live-player-mini-anchor';
      anchor.setAttribute('aria-hidden', 'true');
      document.body.appendChild(anchor);
      this.miniAnchor = anchor;
    }
    anchor.style.left = `${Math.round(rect.left + window.scrollX)}px`;
    anchor.style.top = `${Math.round(rect.top + window.scrollY)}px`;
    anchor.style.width = `${Math.max(1, Math.round(rect.width))}px`;
    anchor.style.height = `${Math.max(1, Math.round(rect.height))}px`;
    return anchor;
  }

  /** 移除原始位置锚点。*/
  private removeMiniAnchor(): void {
    this.miniAnchor?.remove();
    this.miniAnchor = null;
  }

  /** 视口尺寸变化：小窗保持可视。*/
  private readonly onWindowResize = (): void => {
    if (!this.initialized || !this.miniMode || !this.miniPosition) return;
    this.applyMiniPosition(this.miniPosition);
  };

  /** 销毁小窗相关资源（断开 / 移除时统一调用）。*/
  private teardownMini(): void {
    this.disconnectMiniObserver();
    this.miniObserver = null;
    this.endMiniDrag();
    this.removeMiniAnchor();
    this.autoMiniSuppressed = false;
    this.miniAnchorOutOfView = false;
    if (this.miniMode) {
      this.miniMode = false;
      this.sMini.value = false;
      delete this.dataset.mini;
      this.style.left = '';
      this.style.top = '';
      this.style.right = '';
      this.style.bottom = '';
    }
  }

  // ============================================================
  // 公开 API：弹幕  // ============================================================

  /** 发送弹幕（走弹幕插件 API）。*/
  public sendDanmaku(text: string, options?: Partial<NovaDanmakuItem>): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!this.danmakuAvailable || !this.danmakuPlugin) {
      this.showToast(t('livePlayer.toast.danmakuPluginMissing'), 'warning');
      return;
    }
    this.danmakuEl?.send({
      text: trimmed,
      color: options?.color ?? this.danmakuSetting.color,
      mode: options?.mode,
      time: this.videoEl?.currentTime ?? 0,
      uid: options?.uid,
      uname: options?.uname,
    });
    dispatchPlayerEvent(this, 'danmakusent', { text: trimmed });
  }

  /** 批量加载弹幕数据源（过滤后交给弹幕插件）。*/
  public loadDanmaku(list: readonly NovaDanmakuItem[]): void {
    this.danmakuSource = list.map((item) => ({ ...item }));
    if (!this.danmakuAvailable) return;
    this.danmakuEl?.load(this.danmakuSource);
  }

  /** 弹幕开关。*/
  public setDanmakuVisible(visible: boolean): void {
    if (!this.danmakuAvailable) {
      this.showToast(t('livePlayer.toast.danmakuPluginMissing'), 'warning');
      return;
    }
    this.updateDanmakuSetting({ visible });
  }

  /** 更新弹幕设置。*/
  public updateDanmakuSetting(patch: Partial<NovaDanmakuSetting>): void {
    this.danmakuSetting = {
      ...this.danmakuSetting,
      ...patch,
      blockWords: patch.blockWords ? [...patch.blockWords] : this.danmakuSetting.blockWords,
    };
    this.sDmSetting.value = this.danmakuSetting;
    this.sDanmakuOn.value = this.danmakuAvailable ? this.danmakuSetting.visible : false;
    // 设置透传：插件状态键 + 插件 API（字号 / 速度精确值），由宿主统一收敛。
    this.pluginHost?.applyDanmakuSetting(this.danmakuSetting);
    this.danmakuEl?.setSetting(this.danmakuSetting);
    if (this.danmakuEl) this.danmakuEl.hidden = !this.danmakuSetting.visible;
    this.persistState();
    dispatchPlayerEvent(this, 'danmakusetting', { setting: { ...this.danmakuSetting } });
    if (patch.visible !== undefined) {
      dispatchPlayerEvent(this, 'danmakuvisible', { visible: this.danmakuSetting.visible });
    }
    if (patch.blockWords) this.danmakuEl?.load(this.danmakuSource);
  }

  /** 恢复默认。*/
  public resetDanmakuSetting(): void {
    this.updateDanmakuSetting({ ...DEFAULT_DANMAKU_SETTING, blockWords: [] });
    this.showToast(t('livePlayer.danmaku.resetDone'), 'success');
  }

  // ============================================================
  // 公开 API：面板 / 提示 / 错误
  // ============================================================

  /** 打开面板。*/
  public openPanel(name: NovaPanelName): void {
    const reason = this.panelBlockReason(name);
    if (reason) {
      this.warnPanelBlocked(reason);
      return;
    }
    this.closeOtherPanels(name);
    this.sControlVisible.value = true;
    if (name === 'quality') {
      this.sQualityOpen.value = true;
      this.positionQualityPanel();
    }
    else if (name === 'speed') this.sSpeedOpen.value = true;
    else if (name === 'danmaku') this.sDmOpen.value = true;
    else if (name === 'info') {
      this.sInfoOpen.value = true;
      this.startInfoTimer();
    } else if (name === 'hotkey') this.sHotkeyOpen.value = true;
    else this.sCodecOpen.value = true;
  }

  /**
   * 面板拦截原因：弹幕设置需要「已装弹幕插件 + 弹幕开启」。
   *
   * @param name - 面板名称。
   * @returns 拦截原因；null 表示可打开。
   */
  private panelBlockReason(
    name: NovaPanelName,
  ): 'danmaku-plugin-missing' | 'danmaku-off' | null {
    if (name !== 'danmaku') return null;
    if (!this.danmakuAvailable) return 'danmaku-plugin-missing';
    if (!this.danmakuSetting.visible) return 'danmaku-off';
    return null;
  }

  /** 统一给出面板拦截 Toast。*/
  private warnPanelBlocked(reason: 'danmaku-plugin-missing' | 'danmaku-off'): void {
    this.showToast(
      t(
        reason === 'danmaku-plugin-missing'
          ? 'livePlayer.toast.danmakuPluginMissing'
          : 'livePlayer.toast.danmakuSettingBlocked',
      ),
      'warning',
    );
  }

  /** 把清晰度面板对齐到清晰度按钮正上方。 */
  private positionQualityPanel(): void {
    const anchor = this.querySelector('[data-action="quality"]');
    const panel = this.querySelector('.nova-live-player-quality-panel');
    if (!(anchor instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;
    const playerRect = this.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const panelWidth = panel.offsetWidth || 220;
    const centered = anchorRect.left - playerRect.left + anchorRect.width / 2 - panelWidth / 2;
    const left = Math.max(8, Math.min(centered, playerRect.width - panelWidth - 8));
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.transform = 'none';
  }

  /** 关闭面板。*/
  public closePanel(name: NovaPanelName): void {
    if (name === 'quality') {
      this.sQualityOpen.value = false;
      this.sQualityPage.value = 0;
    } else if (name === 'speed') this.sSpeedOpen.value = false;
    else if (name === 'danmaku') {
      this.sDmOpen.value = false;
      this.sDmPage.value = 0;
    } else if (name === 'info') {
      this.sInfoOpen.value = false;
      this.stopInfoTimer();
    } else if (name === 'hotkey') this.sHotkeyOpen.value = false;
    else this.sCodecOpen.value = false;
    this.pinnedPanels.delete(name);
  }

  /** 关闭其它面板。*/
  private closeOtherPanels(except?: NovaPanelName): void {
    (['quality', 'speed', 'danmaku', 'info', 'hotkey', 'codec'] as NovaPanelName[]).forEach((name) => {
      if (name !== except) this.closePanel(name);
    });
  }

  /** 关闭全部面板。*/
  public closePanels(): void {
    (['quality', 'speed', 'danmaku', 'info', 'hotkey', 'codec'] as NovaPanelName[]).forEach((name) =>
      this.closePanel(name),
    );
  }

  /** 打开右键菜单。*/
  public openContextMenu(x?: number, y?: number): void {
    const rect = this.stageRect();
    this.menuTarget = this.hoveredDanmaku ? { ...this.hoveredDanmaku } : null;
    this.showContextMenu(x ?? rect.left + rect.width / 2, y ?? rect.top + rect.height / 2);
  }

  /** 关闭右键菜单。*/
  public closeContextMenu(): void {
    this.sMenuOpen.value = false;
  }

  /** Toast。*/
  public showToast(
    message: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info',
    duration = 2000,
  ): void {
    this.sToastMessage.value = message;
    this.sToastType.value = type;
    this.sToastVisible.value = true;
    this.timers.setTimeout(
      'toast',
      (): void => {
        this.sToastVisible.value = false;
      },
      duration,
    );
  }

  /** 错误面板。*/
  public showError(content: NovaErrorContent): void {
    this.sErrorMessage.value = content.message;
    this.sErrorVisible.value = true;
    this.sLoading.value = false;
  }

  public hideError(): void {
    this.sErrorVisible.value = false;
  }

  /** 清空持久化。*/
  public clearPersistedSettings(): void {
    clearSettings();
  }

  /** 语言。*/
  public setLocale(locale: string): void {
    setLocale(locale);
  }

  public getLocale(): string {
    return getLocale();
  }

  /** DOM 访问。*/
  public getVideoElement(): HTMLVideoElement | null {
    return this.videoEl;
  }

  public getContainerElement(): HTMLElement | null {
    return this.querySelector('.nova-live-player');
  }

  public getDanmakuElement(): HTMLElement | null {
    return this.danmakuEl;
  }

  // ============================================================
  // 内部：初始化
  // ============================================================

  /** 初始化 i18n。 */
  private initI18n(): void {
    const locale = this.playerOptions.locale ?? (isI18nEnabled() ? getLocale() : 'zh-CN');
    initI18n({
      enabled: true,
      locale,
      fallbackLocale: 'en-US',
      messages: {
        'zh-CN': mergeLivePlayerMessages('zh-CN'),
        'en-US': mergeLivePlayerMessages('en-US'),
      },
    });
  }

  /** 恢复持久化。*/
  private restoreSettings(): void {
    if (this.playerOptions.persist === false) {
      this.persistEnabled = false;
      return;
    }
    this.persistEnabled = true;
    const saved = loadSettings();
    if (saved.volume !== undefined) this.volumeValue = saved.volume;
    if (saved.muted !== undefined) this.mutedValue = saved.muted;
    if (saved.quality !== undefined) this.qualityValue = saved.quality;
    if (saved.line !== undefined) this.lineValue = saved.line;
    if (saved.codec !== undefined) this.codecValue = saved.codec;
    this.danmakuSetting = {
      ...this.danmakuSetting,
      ...(saved.danmakuVisible !== undefined ? { visible: saved.danmakuVisible } : {}),
      ...(saved.danmakuOpacity !== undefined ? { opacity: saved.danmakuOpacity } : {}),
      ...(saved.danmakuFontsize !== undefined ? { fontsize: saved.danmakuFontsize } : {}),
      ...(saved.danmakuSpeed !== undefined ? { speed: saved.danmakuSpeed } : {}),
      ...(saved.danmakuArea !== undefined ? { area: saved.danmakuArea } : {}),
      ...(saved.danmakuDensity !== undefined ? { density: saved.danmakuDensity } : {}),
      ...(saved.danmakuAutoScale !== undefined ? { autoScale: saved.danmakuAutoScale } : {}),
      ...(saved.danmakuSpeedSync !== undefined ? { speedSync: saved.danmakuSpeedSync } : {}),
      ...(saved.danmakuFontFamily !== undefined ? { fontFamily: saved.danmakuFontFamily } : {}),
      ...(saved.danmakuBold !== undefined ? { bold: saved.danmakuBold } : {}),
        ...(saved.danmakuColor !== undefined ? { color: saved.danmakuColor } : {}),
      ...(saved.danmakuFontBorder !== undefined ? { fontBorder: saved.danmakuFontBorder } : {}),
      ...(saved.danmakuBlockWords !== undefined ? { blockWords: [...saved.danmakuBlockWords] } : {}),
    };
    if (saved.screenMode === 'webscreen') this.screenMode = 'webscreen';
  }

  /** 应用 options。*/
  private applyOptions(): void {
    const options = this.playerOptions;
    this.restoring = true;
    if (options.persist !== undefined) this.persistEnabled = options.persist;
    if (options.volume !== undefined) this.setVolume(options.volume);
    if (options.muted !== undefined) this.setMuted(options.muted);
    if (options.quality !== undefined && !this.qualityValue) this.qualityValue = options.quality;
    if (options.qualityCandidates) this.setQualityCandidates(options.qualityCandidates, this.qualityValue || options.quality);
    if (options.lineCandidates) this.setLineCandidates(options.lineCandidates, this.lineValue || options.line);
    if (options.danmaku) this.updateDanmakuSetting(options.danmaku);
    if (options.room !== undefined) this.roomLabel = options.room;
    if (options.line !== undefined && !this.lineValue) this.lineValue = options.line;
    if (options.autoplay !== undefined) this.pendingAutoplay = options.autoplay;
    this.restoring = false;
    this.syncMiniMeta();

    // 构造后再传入插件：按需重挂弹幕层并安装新增插件（插件实例变化时才处理）。
    const nextAvailable = this.resolveDanmakuPlugin() !== null;
    if (nextAvailable !== this.danmakuAvailable) {
      this.danmakuAvailable = nextAvailable;
      this.remountView();
      // 重挂会替换 <video>：旧监听必须解绑后重新绑定到新元素。
      for (const cleanup of this.mediaCleanups.splice(0)) cleanup();
      this.bindMediaEvents();
    }
    this.ensurePlugins();

    this.syncAllUi();
    if (options.streamUrl && options.streamUrl !== this.pluginHost?.getUrl()) this.setStream(options.streamUrl);
    else if (this.pendingAutoplay) void this.play();
  }

  /** 同步全部 UI 信号。*/
  private syncAllUi(): void {
    this.sVolume.value = this.volumeValue;
    this.sMuted.value = this.mutedValue;
    this.sQualityCandidates.value = this.qualityCandidates;
    this.sQualityValue.value = this.qualityValue;
    this.sLineCandidates.value = this.lineCandidates;
    this.sLineValue.value = this.lineValue;
    this.sCodecCandidates.value = this.codecCandidates;
    this.sCodecValue.value = this.codecValue;
    this.sDmSetting.value = this.danmakuSetting;
    this.sDanmakuOn.value = this.danmakuAvailable ? this.danmakuSetting.visible : false;
    this.sSpeedRate.value = this.speedRate;
    this.sSpeedLabel.value = `${this.speedRate}x`;
    this.syncQualityLabel();
    this.sScreenMode.value = this.screenMode;
    this.dataset.screen = this.screenMode;
    if (this.videoEl) {
      this.videoEl.volume = this.volumeValue / 100;
      this.videoEl.muted = this.mutedValue;
    }
    this.danmakuEl?.setSetting(this.danmakuSetting);
    if (this.danmakuEl) this.danmakuEl.hidden = !this.danmakuSetting.visible;
    this.updateLiveTimeText();
  }

  /** 清晰度按钮文案。*/
  private syncQualityLabel(): void {
    const current = this.qualityCandidates.find((item) => item.qn === this.qualityValue);
    this.sQualityLabel.value = current?.label ?? t('livePlayer.control.quality');
  }

  /** 收集开发者传入的插件列表（`plugins` 与 `danmakuPlugin` 为同一入口）。*/
  private collectPlugins(): NovaLivePlugin[] {
    const list = [...(this.playerOptions.plugins ?? [])];
    const explicit = this.playerOptions.danmakuPlugin;
    if (explicit) list.push(explicit);
    return list;
  }

  /**
   * 解析弹幕插件：显式 `danmakuPlugin` 优先，否则从 `plugins` 里按能力识别。
   *
   * @param plugins - 候选插件列表。
   * @returns 弹幕插件；未提供返回 null。
   */
  private resolveDanmakuPlugin(
    plugins: readonly NovaLivePlugin[] = this.collectPlugins(),
  ): NovaLiveDanmakuPlugin | null {
    if (this.playerOptions.danmakuPlugin) return this.playerOptions.danmakuPlugin;
    const found = plugins.find((plugin) => isDanmakuPluginInstance(plugin));
    return found && isDanmakuPluginInstance(found) ? found : null;
  }

  /**
   * 用点播播放器同一套 PluginManager 安装插件，并完成视频 / 弹幕挂载与设置同步。
   */
  private ensurePlugins(): void {
    const host = this.pluginHost;
    if (!host) return;
    host.install(this.collectPlugins());
    this.danmakuPlugin = host.getDanmakuPlugin();
    const video = this.videoEl;
    if (!video) return;
    if (this.danmakuEl) this.danmakuEl.attach(video, this.danmakuPlugin);
    host.mount(video, this.danmakuEl?.getContainerElement() ?? null);
    host.applyDanmakuSetting(this.danmakuSetting);
    if (this.codecValue) host.setCodecPreference(this.codecValue);
  }

  /** 音量浮层 hover：打开期间控制条保持显示。*/
  private handleVolumeHover(open: boolean): void {
    this.volumeHovered = open;
    if (open) {
      this.showControls();
      return;
    }
    this.scheduleHideControls(700);
  }

  /** 派发 ready。*/
  private dispatchWhenReady(
    name: 'qualitycandidates' | 'linecandidates',
    detail:
      | { candidates: ReadonlyArray<{ qn: string; label: string }>; current: string }
      | { candidates: ReadonlyArray<{ line: string; label: string }>; current: string },
  ): void {
    const dispatch = (): void => {
      dispatchPlayerEvent(this, name, detail as never);
    };
    if (this.readyDispatched) {
      dispatch();
      return;
    }
    queueMicrotask((): void => {
      if (this.initialized) dispatch();
    });
  }

  private dispatchReady(): void {
    if (this.readyDispatched || !this.initialized) return;
    this.readyDispatched = true;
    dispatchPlayerEvent(this, 'ready', { container: this.getContainerElement() });
  }

  // ============================================================
  // 内部：媒体  // ============================================================

  /** 绑定媒体事件。*/
  private bindMediaEvents(): void {
    const video = this.videoEl;
    if (!video) return;
    const bind = (type: string, handler: EventListener): void => {
      video.addEventListener(type, handler);
      this.mediaCleanups.push((): void => video.removeEventListener(type, handler));
    };
    bind('play', (): void => {
      if (this.liveStartedAt === 0) this.liveStartedAt = Date.now();
      this.sPlaying.value = true;
      this.danmakuEl?.resume();
      dispatchPlayerEvent(this, 'play', undefined);
    });
    bind('pause', (): void => {
      this.sPlaying.value = false;
      this.danmakuEl?.suspend();
      dispatchPlayerEvent(this, 'pause', undefined);
    });
    bind('playing', (): void => {
      this.sLoading.value = false;
      if (this.liveStartedAt === 0) this.liveStartedAt = Date.now();
    });
    bind('waiting', (): void => {
      this.sLoading.value = true;
    });
    bind('canplay', (): void => {
      this.sLoading.value = false;
    });
    bind('loadedmetadata', (): void => {
      this.sLoading.value = false;
      this.hideError();
      if (this.liveStartedAt === 0) this.liveStartedAt = Date.now();
      this.refreshInfo();
    });
    bind('timeupdate', (): void => {
      this.updateLiveTimeText();
      dispatchPlayerEvent(this, 'timeupdate', {
        currentTime: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        liveDuration: this.getLiveSeconds(),
      });
    });
    bind('progress', (): void => {
      const buffered = video.buffered;
      const end = buffered.length > 0 ? buffered.end(buffered.length - 1) : 0;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      dispatchPlayerEvent(this, 'progress', {
        buffered: end,
        percent: duration > 0 ? Math.min(100, (end / duration) * 100) : 0,
      });
    });
    bind('volumechange', (): void => this.handleVolumeChange());
    bind('ratechange', (): void => {
      this.speedRate = video.playbackRate;
      this.sSpeedRate.value = this.speedRate;
      this.sSpeedLabel.value = `${this.speedRate}x`;
    });
    bind('error', (): void => {
      this.sLoading.value = false;
      const message = t('livePlayer.error.media');
      this.showError({ code: 'media', message });
      dispatchPlayerEvent(this, 'error', { code: 'media', message });
    });
  }

  /** 外部音量变化。*/
  private handleVolumeChange(): void {
    if (!this.videoEl) return;
    const volume = Math.round(this.videoEl.volume * 100);
    const muted = this.videoEl.muted || volume === 0;
    const volumeChanged = volume !== this.volumeValue;
    const mutedChanged = muted !== this.mutedValue;
    this.volumeValue = volume;
    this.mutedValue = muted;
    this.sVolume.value = volume;
    this.sMuted.value = muted;
    if (volumeChanged) dispatchPlayerEvent(this, 'volumechange', { volume });
    if (mutedChanged) dispatchPlayerEvent(this, 'mutechange', { muted });
    if (!this.restoring) this.persistState();
  }

  /** 全屏同步。*/
  private syncFullscreenState(): void {
    if (!this.initialized) return;
    if (document.fullscreenElement === this) this.setScreenMode('fullscreen');
    else if (this.screenMode === 'fullscreen') this.setScreenMode(this.screenModeBeforeFullscreen);
  }

  /** 设置屏幕形态。*/
  private setScreenMode(mode: NovaScreenMode): void {
    // 全屏 / 网页全屏会接管整个视口，小窗必须先退出。
    if (mode !== 'normal' && this.miniMode) this.exitMiniInternal({ scrollBack: false });
    const changed = this.screenMode !== mode;
    this.screenMode = mode;
    this.sScreenMode.value = mode;
    this.dataset.screen = mode;
    if (!this.restoring) this.persistState();
    if (changed) dispatchPlayerEvent(this, 'screenchange', { mode });
  }

  // ============================================================
  // 内部：清晰度
  // ============================================================

  /** 插件清晰度映射。*/
  private applyStreamQualities(list: StreamQuality[], current: string): void {
    if (list.length === 0) return;
    const heights = list.filter((item) => !item.auto && item.height > 0).map((item) => item.height);
    const minHeight = heights.length > 0 ? Math.min(...heights) : 0;
    const maxHeight = heights.length > 0 ? Math.max(...heights) : 0;
    const candidates: NovaQualityCandidate[] = list.map((item) => ({
      qn: item.qn,
      label: item.auto ? t('livePlayer.quality.auto') : item.label,
      hint: item.auto
        ? t('livePlayer.quality.hintAuto')
        : maxHeight > 0 && item.height >= maxHeight
          ? t('livePlayer.quality.hintHigh')
          : minHeight > 0 && item.height <= minHeight
            ? t('livePlayer.quality.hintSmooth')
            : '',
    }));
    const preferred =
      this.qualityValue && candidates.some((item) => item.qn === this.qualityValue)
        ? this.qualityValue
        : current && candidates.some((item) => item.qn === current)
          ? current
          : candidates[0].qn;
    this.setQualityCandidates(candidates, preferred);
  }

  // ============================================================
  // 内部：hover / 固定 / 自动隐藏
  // ============================================================

  /** 显示控制条并重置隐藏定时器。*/
  private showControls(): void {
    this.sControlVisible.value = true;
    this.scheduleHideControls(CONTROL_HIDE_MS);
  }

  /** 安排控制条隐藏（同一时刻只有一个待执行的隐藏计时器）。*/
  private scheduleHideControls(delay: number): void {
    this.timers.setTimeout(
      'control-hide',
      (): void => {
        // 面板 / 右键菜单 / 音量浮层任一活跃时保持控制条可见。
        if (this.anyPanelOpen() || this.sMenuOpen.value || this.volumeHovered) return;
        this.sControlVisible.value = false;
      },
      delay,
    );
  }

  /** 面板是否打开。*/
  private anyPanelOpen(): boolean {
    return (
      this.sQualityOpen.value ||
      this.sSpeedOpen.value ||
      this.sDmOpen.value ||
      this.sInfoOpen.value ||
      this.sHotkeyOpen.value ||
      this.sCodecOpen.value
    );
  }

  /** 悬停打开（拦截时静默返回，点击路径才给 Toast）。*/
  private hoverPanelOpen(name: NovaPanelName): void {
    if (this.panelBlockReason(name)) return;
    this.timers.clearTimeout(`panel-close:${name}`);
    this.openPanel(name);
  }

  /** 保持打开（同时取消待执行的延迟关闭）。*/
  private keepPanel(name: NovaPanelName): void {
    this.panelCloseTokens.set(name, (this.panelCloseTokens.get(name) ?? 0) + 1);
    this.timers.clearTimeout(`panel-close:${name}`);
  }

  /** 面板 hover 离开：固定面板不关闭，延迟关闭走统一注册表的 debounce。*/
  private leavePanel(name: NovaPanelName): void {
    if (this.pinnedPanels.has(name)) return;
    const token = (this.panelCloseTokens.get(name) ?? 0) + 1;
    this.panelCloseTokens.set(name, token);
    this.panelPendingTokens.set(name, token);
    this.getPanelCloseDebouncer(name)();
  }

  /** 取（或创建）面板的延迟关闭 debounce，清晰度给更长等待。*/
  private getPanelCloseDebouncer(name: NovaPanelName): () => void {
    let closer = this.panelCloseDebouncers.get(name);
    if (!closer) {
      const delay = name === 'quality' ? 800 : 500;
      closer = this.timers.debounce(`panel-close:${name}`, (): void => {
        // token 校验：期间重新进入面板 / 固定面板都会让本次待关闭失效。
        if (this.panelPendingTokens.get(name) !== this.panelCloseTokens.get(name)) return;
        if (this.pinnedPanels.has(name)) return;
        const panel = this.querySelector(`[data-panel="${name}"]`);
        if (panel instanceof HTMLElement && panel.matches(':hover')) return;
        this.closePanel(name);
      }, delay);
      this.panelCloseDebouncers.set(name, closer);
    }
    return closer;
  }

  /** 面板内点击固定。*/
  private pinPanel(name: NovaPanelName): void {
    this.pinnedPanels.add(name);
    this.keepPanel(name);
  }

  /** 控制条图标离开。*/
  private schedulePanelClose(name: NovaPanelName): void {
    if (this.pinnedPanels.has(name)) return;
    this.leavePanel(name);
  }

  /** 点击外部收起面板。*/
  private handleDocumentPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (target instanceof Element) {
      const keep = target.closest(
        '[data-panel], nova-live-player-control-bar, .nova-live-player-send, .nova-live-player-error, .nova-live-player-menu',
      );
      if (keep) return;
    }
    this.closePanels();
    this.sMenuOpen.value = false;
  }

  /** 控制层动作。*/
  private handleControlAction(action: NovaControlAction): void {
    if (action === 'toggle-play') this.togglePlay();
    else if (action === 'toggle-mute') this.toggleMute();
    else if (action === 'refresh') this.reload();
    else if (action === 'toggle-danmaku') {
      if (!this.danmakuAvailable) {
        this.showToast(t('livePlayer.toast.danmakuPluginMissing'), 'warning');
        return;
      }
      this.setDanmakuVisible(!this.danmakuSetting.visible);
    } else if (action === 'quality') this.togglePanel('quality');
    else if (action === 'speed') this.togglePanel('speed');
    else if (action === 'danmaku-setting') this.togglePanel('danmaku');
    else if (action === 'send-danmaku') {
      if (!this.danmakuAvailable) {
        this.showToast(t('livePlayer.toast.danmakuPluginMissing'), 'warning');
        return;
      }
      this.sSendOpen.value = !this.sSendOpen.value;
      if (this.sSendOpen.value) this.closePanels();
    } else if (action === 'webscreen') this.toggleWebFullscreen();
    else if (action === 'mini') this.toggleMini();
    else void this.toggleFullscreen();
  }

  /** 点击图标固定 / 切换面板。*/
  private togglePanel(name: NovaPanelName): void {
    const reason = this.panelBlockReason(name);
    if (reason) {
      this.warnPanelBlocked(reason);
      return;
    }
    if (this.pinnedPanels.has(name)) {
      this.closePanel(name);
      return;
    }
    this.pinPanel(name);
    this.openPanel(name);
  }

  /** 舞台矩形。*/
  private stageRect(): DOMRect {
    const stage = this.querySelector('.nova-live-player');
    return stage instanceof HTMLElement
      ? stage.getBoundingClientRect()
      : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  }

  /** 右键菜单。*/
  private handleContextMenu(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-panel], .nova-live-player-send, .nova-live-player-error')) {
      return;
    }
    event.preventDefault();
    this.menuTarget = this.hoveredDanmaku ? { ...this.hoveredDanmaku } : null;
    this.showContextMenu(event.clientX, event.clientY);
  }

  /** 展示右键菜单。*/
  private showContextMenu(x: number, y: number): void {
    const items: MenuEntry[] = [
      {
        action: 'toggle-danmaku',
        label: t(this.danmakuSetting.visible ? 'livePlayer.menu.toggleOff' : 'livePlayer.menu.toggleOn'),
        disabled: !this.danmakuAvailable,
      },
      {
        action: 'more-danmaku-setting',
        label: t('livePlayer.menu.moreSetting'),
        disabled: !this.danmakuAvailable || !this.danmakuSetting.visible,
      },
      { action: 'video-info', label: t('livePlayer.menu.info'), disabled: false },
      { action: 'video-codec', label: t('livePlayer.menu.codec'), disabled: false },
    ];
    this.sMenuTarget.value = this.menuTarget;
    this.sMenuItems.value = items;
    this.sMenuX.value = Math.max(4, Math.min(x, window.innerWidth - 196));
    this.sMenuY.value = Math.max(4, Math.min(y, window.innerHeight - 180));
    this.sMenuOpen.value = true;
  }

  /** 菜单动作。*/
  private handleMenuAction(action: NovaContextMenuAction): void {
    if (action === 'toggle-danmaku') {
      this.setDanmakuVisible(!this.danmakuSetting.visible);
    } else if (action === 'more-danmaku-setting') {
      const reason = this.panelBlockReason('danmaku');
      if (reason) {
        this.warnPanelBlocked(reason);
        return;
      }
      this.openPanel('danmaku');
    } else if (action === 'video-info') {
      this.openPanel('info');
    } else {
      this.openPanel('codec');
    }
  }

  /** 快捷键。*/
  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.initialized) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
        if (event.key === 'Escape') this.sSendOpen.value = false;
        return;
      }
    }
    const key = event.key;
    if (key === ' ' || key.toLowerCase() === 'k') {
      event.preventDefault();
      this.togglePlay();
    } else if (key.toLowerCase() === 'm') {
      event.preventDefault();
      this.toggleMute();
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      this.setVolume(this.volumeValue + (key === 'ArrowUp' ? 5 : -5));
    } else if (key.toLowerCase() === 'f') {
      event.preventDefault();
      void this.toggleFullscreen();
    } else if (key.toLowerCase() === 'w') {
      event.preventDefault();
      this.toggleWebFullscreen();
    } else if (key.toLowerCase() === 'd') {
      event.preventDefault();
      this.setDanmakuVisible(!this.danmakuSetting.visible);
    } else if (key === '?') {
      event.preventDefault();
      this.pinPanel('hotkey');
      this.openPanel('hotkey');
    } else if (key === 'Escape') {
      this.sMenuOpen.value = false;
      if (this.sSendOpen.value) this.sSendOpen.value = false;
      else if (this.screenMode === 'webscreen') this.exitWebFullscreen();
      else this.closePanels();
    }
  }

  // ============================================================
  // 内部：时长 / 信息 / 持久化  // ============================================================

  /** 直播秒数。*/
  private getLiveSeconds(): number {
    if (this.liveStartedAt === 0) return 0;
    return (Date.now() - this.liveStartedAt) / 1000;
  }

  /** 更新直播时长。*/
  private updateLiveTimeText(): void {
    const value = formatDuration(this.getLiveSeconds());
    this.sLiveTime.value = value;
    this.sInfoValues.value = { ...this.sInfoValues.value, liveDuration: value };
  }

  /** 直播时长定时器。*/
  private startLiveTimeTimer(): void {
    this.stopLiveTimeTimer();
    this.timers.setInterval('live-time', (): void => this.updateLiveTimeText(), LIVE_TIME_REFRESH_MS);
  }

  private stopLiveTimeTimer(): void {
    this.timers.clearInterval('live-time');
  }

  /** 信息定时器。*/
  private startInfoTimer(): void {
    this.stopInfoTimer();
    this.resetInfoSeries();
    this.refreshInfo();
    this.timers.setInterval('info-refresh', (): void => this.refreshInfo(), INFO_REFRESH_MS);
  }

  /** 重置曲线采样窗口（面板重新打开时从头采集）。*/
  private resetInfoSeries(): void {
    this.lastInfoSampleAt = 0;
    this.sInfoSeries.value = { buffer: [], dropped: [] };
  }

  private stopInfoTimer(): void {
    this.timers.clearInterval('info-refresh');
  }

  /** 刷新信息。*/
  private refreshInfo(): void {
    if (!this.initialized || !this.videoEl) return;
    const snapshot = this.pluginHost?.getSnapshot() ?? {
      buffer: 0,
      downloadSpeed: 0,
      videoBitrate: 0,
      resolution: '-',
    };
    const quality = this.qualityCandidates.find((item) => item.qn === this.qualityValue);
    const line = this.lineCandidates.find((item) => item.line === this.lineValue);
    this.sInfoValues.value = {
      room: this.roomLabel || '-',
      status: t(this.statusKey),
      quality: quality?.label ?? '-',
      line: line?.label ?? (this.lineValue || '-'),
      buffer: `${snapshot.buffer.toFixed(1)}s`,
      droppedFrames: String(this.readDroppedFrames()),
      resolution: snapshot.resolution,
      fps: `${Math.round(this.readFrameRate())} FPS`,
      player: this.readPlayerLabel(),
      liveDuration: formatDuration(this.getLiveSeconds()),
    };
    this.sampleInfoCharts(snapshot.buffer);
  }

  /**
   * 1Hz 采样信息面板曲线数据。
   *
   * 缓冲换算为毫秒，丢帧读播放质量接口；环形窗口保留最近
   * `INFO_CHART_POINTS` 个点，空数据由面板侧不画线。
   */
  private sampleInfoCharts(bufferSeconds: number): void {
    if (!this.sInfoOpen.value) return;
    const now = Date.now();
    if (this.lastInfoSampleAt > 0 && now - this.lastInfoSampleAt < INFO_SAMPLE_MS) return;
    this.lastInfoSampleAt = now;
    const previous = this.sInfoSeries.value;
    this.sInfoSeries.value = {
      buffer: [...previous.buffer, Math.max(0, Math.round(bufferSeconds * 1000))].slice(-INFO_CHART_POINTS),
      dropped: [...previous.dropped, Math.max(0, Math.round(this.readDroppedFrames()))].slice(-INFO_CHART_POINTS),
    };
  }

  /** 丢帧。*/
  private readDroppedFrames(): number {
    if (!this.videoEl || typeof this.videoEl.getVideoPlaybackQuality !== 'function') return 0;
    return this.videoEl.getVideoPlaybackQuality().droppedVideoFrames;
  }

  /** 帧率。*/
  private readFrameRate(): number {
    if (!this.videoEl || typeof this.videoEl.getVideoPlaybackQuality !== 'function') return 0;
    const total = this.videoEl.getVideoPlaybackQuality().totalVideoFrames;
    const now = Date.now();
    if (this.frameSampleAt === 0) {
      this.frameSampleAt = now;
      this.frameSampleTotal = total;
      return 0;
    }
    const elapsed = (now - this.frameSampleAt) / 1000;
    if (elapsed < 0.2) return 0;
    const fps = (total - this.frameSampleTotal) / elapsed;
    this.frameSampleAt = now;
    this.frameSampleTotal = total;
    return Math.max(0, fps);
  }

  /** 播放内核。*/
  private readPlayerLabel(): string {
    const kind = this.pluginHost?.getPlayerKind() ?? detectStreamKind(this.streamUrl);
    if (kind === 'hls') return t('livePlayer.player.hls');
    if (kind === 'flv') return t('livePlayer.player.flv');
    return t('livePlayer.player.native');
  }

  /** 流错误。*/
  private reportStreamError(message: string): void {
    this.sLoading.value = false;
    this.showToast(t('livePlayer.toast.streamError'), 'warning');
    dispatchPlayerEvent(this, 'error', { code: 'stream', message });
  }

  /** 持久化。*/
  private persistState(): void {
    if (!this.persistEnabled || this.restoring) return;
    saveSettings({
      volume: this.volumeValue,
      muted: this.mutedValue,
      quality: this.qualityValue || undefined,
      line: this.lineValue || undefined,
      codec: this.codecValue || undefined,
      danmakuVisible: this.danmakuSetting.visible,
      danmakuOpacity: this.danmakuSetting.opacity,
      danmakuFontsize: this.danmakuSetting.fontsize,
      danmakuSpeed: this.danmakuSetting.speed,
      danmakuArea: this.danmakuSetting.area,
      danmakuDensity: this.danmakuSetting.density,
      danmakuAutoScale: this.danmakuSetting.autoScale,
      danmakuSpeedSync: this.danmakuSetting.speedSync,
      danmakuFontFamily: this.danmakuSetting.fontFamily,
        danmakuColor: this.danmakuSetting.color,
      danmakuBold: this.danmakuSetting.bold,
      danmakuFontBorder: this.danmakuSetting.fontBorder,
      danmakuBlockWords: [...this.danmakuSetting.blockWords],
      screenMode: this.screenMode === 'webscreen' ? 'webscreen' : 'normal',
    });
  }
}


