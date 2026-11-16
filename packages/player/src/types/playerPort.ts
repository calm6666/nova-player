/**
 * ============================================
 * PlayerPort：播放器核心与 UI/插件之间的唯一契约
 * ============================================
 * 目标：UI 层（控制栏 / 菜单 / 插槽 / PiP）与插件层只依赖本接口，
 * 不直接依赖 VideoPlayer 具体实现，为后续「core / ui 分层」与
 * 原生（N-API / wasm）核心替换留出边界。
 *
 * 本文件只做类型声明，不包含任何运行时逻辑；引入它不会改变现有行为。
 *
 * 阶段 1 的落地方式：
 *   - VideoPlayer 已具备下列方法，先让它 structural 满足 PlayerPort（无需改调用方）；
 *   - 后续把 SlotContext.player 的类型从 VideoPlayer 换成 PlayerPort，
 *     UI 组件与插件即自动收口到契约上。
 *
 * 类型约定：
 *   - 这里不再使用 `[key: string]: any` 索引签名兜底内部扩展能力，
 *     UI 真正依赖的成员一律显式声明（可选能力用 `?`），从而让
 *     `@typescript-eslint/no-unsafe-*` 系列规则可以真正生效；
 *   - 新增 UI 内部能力时，请在本文件补充显式声明，而不是回退到 any。
 */

import type { TypedStateManager } from "@lumina/framework/core";
import type { MediaItem, PlayerConfig } from "./player";
import type { PluginSlotDefinition, SlotEntry, SlotMount } from "./slots";
import type { PlayerStateMap } from "../store/runtimeState";

/** 播放器事件名（与 `player.on('<name>')` 的小写事件键一致） */
export type PlayerPortEvent =
  | "ready"
  | "loadstart"
  | "loadedmetadata"
  | "loadeddata"
  | "canplay"
  | "play"
  | "playing"
  | "pause"
  | "ended"
  | "waiting"
  | "timeupdate"
  | "durationchange"
  | "volumechange"
  | "statechange"
  | "destroy";

/**
 * 播放器端口（core ↔ ui 契约）
 *
 * 设计约束：
 * - 只暴露 UI/插件真正需要的能力（命令 + 查询 + 事件订阅）；
 * - 不暴露内部 store / 插件管理器 / DOM 引用；
 * - 所有事件订阅必须返回取消订阅函数（幂等调用无副作用）。
 */
export interface PlayerPort {
  // ---- 播放控制 ----
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  isPlaying(): boolean;

  // ---- 音量 ----
  setVolume(volume: number): void;
  getVolume(): number;
  setMuted(muted: boolean): void;
  toggleMute(): void;

  // ---- 字幕 ----
  setSubtitleVisible(visible: boolean): void;
  setSubtitleList(list: unknown[]): void;

  // ---- 插件能力（可选，由插件安装后提供；UI 需先做存在性判断） ----
  isDanmakuVisible?(): boolean;
  setDanmakuVisible?(visible: boolean): void;

  // ---- 事件 ----
  /** 订阅播放器事件，返回取消订阅函数（事件名见 PlayerPortEvent） */
  on(event: string, handler: (...args: unknown[]) => void): () => void;

  // ---- 生命周期 ----
  destroy(): void;
}

/** 可被端口替换的播放列表条目（与核心 MediaItem 对齐的别名，便于 UI 层引用） */
export type PlayerPortMediaItem = MediaItem;

/**
 * UI 内部宿主：在 `PlayerPort` 公共契约之上，允许 UI 访问播放器内部扩展能力
 * （`state` / `props` / 插件挂载等）。
 *
 * 分层约定：
 * - 对外（SlotContext、插件回调）只暴露 `PlayerPort`；
 * - 组件树内部通过 `PlayerContext` 使用 `PlayerUiHost`，逐步把具体能力收敛回 Port。
 *
 * 注意：本接口**不使用** `[key: string]: any` 索引签名；新增 UI 能力必须显式声明，
 * 避免把内部扩展访问退化为 any（这正是 unsafe-any 链的根源）。
 */
export interface PlayerUiHost extends PlayerPort {
  /** 播放器公开配置（与 VideoPlayer.props 同源；`ui.slots` 为插槽声明） */
  props: PlayerConfig;
  /** 运行态状态管理器（与组件树内 StateContext 同源） */
  state: TypedStateManager<PlayerStateMap>;

  /** 插件注册的 Top 插件挂载函数 */
  getTopPluginMount?(): SlotMount["mount"] | null;
  /** 插件注册的 Ending 插件挂载函数 */
  getEndingPluginMount?(): SlotMount["mount"] | null;
  /** 插件是否已安装（按插件 name 判断） */
  hasPlugin?(name: string): boolean;

  /** 注册顶栏视图刷新回调（null 表示注销） */
  registerTopViewRefresh?(refresh: (() => void) | null): void;
  /** 注册片尾视图刷新回调（null 表示注销） */
  registerEndingViewRefresh?(refresh: (() => void) | null): void;

  /** 插件声明的插槽定义（用于区域挂载时合并插件插槽内容） */
  getSlotDefinitions(): readonly PluginSlotDefinition[];
  /** 注册区域插槽刷新回调，返回取消注册函数 */
  registerSlotsRefresh(refresh: () => void): () => void;

  /** 宽屏切换（UI 内部扩展能力；状态写入 + 持久化 + 事件广播由实现方负责） */
  setWideScreen?(wide: boolean): void;
  /** 控制栏挂载完成后回传 API，供 PlayerDocker 持有（UI 内部扩展能力） */
  attachControlsApi?(api: unknown): void;
  /** 当前 UI 配置快照（只读；部分实现可能通过 props.ui 暴露） */
  readonly ui?: PlayerConfig["ui"];
}

/** 插槽声明列表（便于 UI 层引用） */
export type PlayerSlotEntries = readonly SlotEntry[];
