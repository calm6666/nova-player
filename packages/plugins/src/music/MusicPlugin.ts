/**
 * ============================================
 * Music 插件（音乐详情面板，结构对齐 Top / Ending 插件）
 * ============================================
 * 只负责接线与双模式挂载，视图全部在 MusicView；
 *
 * 双模式：
 * - 网页全屏 / 全屏：面板挂载在播放器内 `.nova-player-dialog-wrap` 的后一个位置
 *   （同父级、紧随其后），容器类名 `.nova-player-music-wrap`；
 * - 非全屏：面板挂载到宿主通过 config.target 传入的页面挂载点
 *   （selector / HTMLElement，由调用方提供，插件不自行 query 页面节点）。
 *
 * Top 音乐模式：Top 只有在检测到本插件已安装时才显示音乐形态（见 PlayerDocker /
 * TopPlugin 的 gating）。
 */

import {
  h,
  mount,
  destroy,
  type Plugin,
  type VNode,
  type VideoPlayer,
} from "@lumina/nova";
import { PlayerStateKeyEnum } from "@/nova/store/runtimeState";
import { MusicView } from "./MusicView";
import { injectPluginStyle } from "../utils/injectStyle";
import {
  PositionId,
  type MusicPluginData,
  type PcCallback,
} from "./types";
import musicCss from "./style.scss?inline";

/**
 * 页面挂载点来源
 *
 * - string：CSS selector（每次模式切换时重新解析）
 * - HTMLElement：直接使用
 * - 函数：惰性解析（挂载点可能在播放器之后创建）
 */
export type MusicPluginTarget =
  | string
  | HTMLElement
  | (() => HTMLElement | null);

/** 音乐插件配置 */
export interface MusicPluginConfig {
  /** 插件实例名（默认 music） */
  id?: string;
  /** 音乐 id（默认取 mock 数据 id） */
  musicId?: string;
  /** 宿主注入的音乐数据快照（不传时走插件内模拟接口） */
  data?: MusicPluginData;
  /**
   * 非全屏时的页面挂载点（必传才能在非全屏显示）。
   *
   * 挂载点元素需带 `.nova-player-music-wrap` 类（或类名在其祖先上），
   * 以便插件样式作用域生效。
   */
  target?: MusicPluginTarget;
  /** 展示位置（默认非全屏为 PlayerHalfScreen、播放器内为 PlayerFullScreen） */
  positionId?: PositionId;
  /** 页面来源（预留，供上报使用） */
  source?: string;
  /** 入口视频 cid（预留，供上报使用） */
  entryCid?: number;
  /** 入口视频 aid（透传给视频列表请求） */
  entryAid?: number;
  /** 播放器场景宿主回调 */
  pcCallback?: PcCallback;
  /** 关闭面板回调（宿主可在此隐藏面板） */
  onClose?: () => void;
  /** 初始是否打开（默认 true） */
  open?: boolean;
}

/** 音乐插件运行时 API */
export interface MusicPluginAPI {
  /** 打开面板 */
  open(): void;
  /** 关闭面板 */
  close(): void;
  /** 面板是否打开 */
  isOpen(): boolean;
  /** 当前是否处于播放器内嵌模式（全屏 / 网页全屏） */
  isInPlayerMode(): boolean;
  /** 更新音乐 id（可同时更新数据快照） */
  setMusicId(musicId: string, data?: MusicPluginData): void;
  /** 重新解析挂载点并重挂面板（挂载点后创建 / 切页后可调用） */
  refresh(): void;
  /** 面板根节点（未打开或未挂载时为 null） */
  getElement(): HTMLElement | null;
}

/** 播放器内音乐容器类名（DOM 约定） */
const PLAYER_WRAP_CLASS = "nova-player-music-wrap";

/** 对话框容器类名（面板插入位置参照） */
const DIALOG_WRAP_CLASS = "nova-player-dialog-wrap";

/**
 * 音乐插件实现
 */
class MusicPluginClass implements Plugin, MusicPluginAPI {
  readonly name: string;
  readonly version = "1.0.0";
  readonly description: string;

  /** 插件配置 */
  private readonly config: MusicPluginConfig;
  /** 播放器实例 */
  private player: VideoPlayer | null = null;
  /** 当前音乐 id */
  private musicId: string;
  /** 面板是否打开 */
  private opened: boolean;
  /** 当前视图 VNode */
  private viewVNode: VNode | null = null;
  /** 当前挂载宿主 */
  private hostEl: HTMLElement | null = null;
  /** 播放器内音乐容器 */
  private wrapEl: HTMLElement | null = null;
  /** 当前是否播放器内嵌模式 */
  private internalMode = false;
  /** 挂载完成事件退订 */
  private offMounted: (() => void) | null = null;
  /** 全屏状态订阅退订 */
  private stateUnsubscribes: Array<() => void> = [];

  constructor(config: MusicPluginConfig = {}) {
    this.config = config;
    this.name = config.id ?? "music";
    this.description = `Music plugin: ${this.name}`;
    this.musicId = config.musicId ?? "29668340001";
    this.opened = config.open ?? false;
  }

  // ============================================
  // 生命周期
  // ============================================

  install(player: Parameters<Plugin["install"]>[0]): void {
    this.player = player;
    injectPluginStyle("music", musicCss);

    // 播放器已挂载（运行期动态注册）→ 立即初始化；否则等待 MOUNTED
    if (this.player.el) {
      this.setup();
    } else {
      this.offMounted = this.player.on("mounted", (): void => {
        this.offMounted?.();
        this.offMounted = null;
        this.setup();
      });
    }

    // Top 音乐模式依赖本插件安装状态；安装动作完成后（插件管理器登记
    // 完成 → hasPlugin 生效）再刷新 Top，避免刷新时读到的仍是未安装
    this.scheduleTopRefresh();
  }

  uninstall(): void {
    this.teardown();
    this.scheduleTopRefresh();
    this.player = null;
  }

  /** 异步刷新 Top（等插件管理器完成安装 / 卸载登记后执行） */
  private scheduleTopRefresh(): void {
    const player = this.player;
    if (!player) return;
    queueMicrotask((): void => {
      player.refreshTop();
    });
  }

  // ============================================
  // 对外 API
  // ============================================

  /** 打开面板 */
  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.applyMode(true);
  }

  /** 关闭面板 */
  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.destroyView();
  }

  /** 面板是否打开 */
  isOpen(): boolean {
    return this.opened && this.viewVNode !== null;
  }

  /** 当前是否处于播放器内嵌模式（全屏 / 网页全屏） */
  isInPlayerMode(): boolean {
    return this.internalMode;
  }

  /** 更新音乐 id（可同时更新数据快照） */
  setMusicId(musicId: string, data?: MusicPluginData): void {
    this.musicId = musicId;
    if (data) {
      this.config.data = data;
    }
    this.destroyView();
    this.applyMode(true);
  }

  /** 重新解析挂载点并重挂面板 */
  refresh(): void {
    this.applyMode(true);
  }

  /** 面板根节点 */
  getElement(): HTMLElement | null {
    return this.hostEl?.querySelector<HTMLElement>(".nova-music-app") ?? null;
  }

  // ============================================
  // 内部：初始化 / 销毁
  // ============================================

  /** 播放器挂载完成后的初始化 */
  private setup(): void {
    if (!this.player) return;
    // 全屏 / 网页全屏变化 → 切换挂载位置
    this.stateUnsubscribes.push(
      this.player.state.subscribe(
        PlayerStateKeyEnum.IS_FULLSCREEN,
        (): void => this.applyMode(),
      ),
      this.player.state.subscribe(
        PlayerStateKeyEnum.IS_WEB_FULLSCREEN,
        (): void => this.applyMode(),
      ),
    );
    this.applyMode(true);
  }

  /** 完整清理（插件卸载） */
  private teardown(): void {
    this.offMounted?.();
    this.offMounted = null;
    this.stateUnsubscribes.forEach((unsubscribe): void => unsubscribe());
    this.stateUnsubscribes = [];
    this.destroyView();
    if (this.wrapEl && this.wrapEl.parentNode) {
      this.wrapEl.parentNode.removeChild(this.wrapEl);
    }
    this.wrapEl = null;
  }

  // ============================================
  // 内部：双模式挂载
  // ============================================

  /** 当前是否应显示在播放器内部（全屏 / 网页全屏） */
  private isPlayerInternalMode(): boolean {
    if (!this.player) return false;
    return this.player.isFullscreen() || this.player.isWebFullscreen();
  }

  /**
   * 应用当前挂载模式
   *
   * @param force - 是否强制重建（模式未变时默认复用现有面板）
   */
  private applyMode(force = false): void {
    if (!this.player || !this.opened) return;
    const internal = this.isPlayerInternalMode();
    const host = internal ? this.ensurePlayerWrap() : this.resolveTarget();
    // 模式与宿主均未变化 → 保持现状
    if (!force && internal === this.internalMode && host === this.hostEl) {
      return;
    }
    this.destroyView();
    this.internalMode = internal;
    if (!host) return;
    this.mountView(host, internal);
  }

  /**
   * 挂载面板视图
   *
   * @param host - 挂载宿主
   * @param internal - 是否播放器内嵌模式（决定深色窄栏形态）
   */
  private mountView(host: HTMLElement, internal: boolean): void {
    const vnode = h(MusicView, {
      musicId: this.musicId,
      host,
      positionId: internal
        ? PositionId.PlayerFullScreen
        : (this.config.positionId ?? PositionId.PlayerHalfScreen),
      source: this.config.source,
      entryCid: this.config.entryCid,
      entryAid: this.config.entryAid,
      data: this.config.data,
      pcCallback: this.config.pcCallback,
      // 关闭按钮默认收起本插件面板，再通知宿主自定义关闭逻辑
      onClose: (): void => {
        this.close();
        this.config.onClose?.();
      },
    });
    mount(vnode, host);
    this.viewVNode = vnode;
    this.hostEl = host;
  }

  /** 卸载面板视图 */
  private destroyView(): void {
    if (this.viewVNode) {
      destroy(this.viewVNode);
      this.viewVNode = null;
    }
    this.hostEl = null;
  }

  /**
   * 确保播放器内 `.nova-player-music-wrap` 存在
   *
   * 位置：`.nova-player-dialog-wrap` 的后一个位置（同父级、紧随其后）。
   *
   * @returns 容器元素；播放器 DOM 未就绪时返回 null
   */
  private ensurePlayerWrap(): HTMLElement | null {
    if (this.wrapEl && this.wrapEl.isConnected) {
      return this.wrapEl;
    }
    const root = this.player?.el;
    if (!root) return null;
    const wrap = document.createElement("div");
    wrap.className = PLAYER_WRAP_CLASS;
    const dialog = root.querySelector(`.${DIALOG_WRAP_CLASS}`);
    if (dialog && dialog.parentElement) {
      dialog.parentElement.insertBefore(wrap, dialog.nextSibling);
    } else {
      root.appendChild(wrap);
    }
    this.wrapEl = wrap;
    return wrap;
  }

  /**
   * 解析非全屏页面挂载点
   *
   * @returns 挂载点元素；未配置或尚未创建时返回 null
   */
  private resolveTarget(): HTMLElement | null {
    const target = this.config.target;
    if (!target) return null;
    if (typeof target === "function") {
      return target();
    }
    if (typeof target === "string") {
      const el = document.querySelector(target);
      return el instanceof HTMLElement ? el : null;
    }
    return target;
  }
}

/**
 * 创建音乐插件
 *
 * @param config - 插件配置
 * @returns 插件实例（含运行时 API）
 */
export function MusicPlugin(config: MusicPluginConfig = {}): Plugin {
  return new MusicPluginClass(config);
}

/**
 * 创建音乐插件（工厂别名，保持与 createXxxPlugin 命名习惯一致）
 *
 * @param config - 插件配置
 * @returns 插件实例（含运行时 API）
 */
export function createMusicPlugin(config: MusicPluginConfig = {}): Plugin {
  return MusicPlugin(config);
}
