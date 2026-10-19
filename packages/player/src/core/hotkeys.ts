/**
 * ============================================
 * 播放器快捷键处理模块
 * ============================================
 *
 * 本模块负责播放器所有快捷键的配置与处理逻辑，
 * 从 PlayerDocker 组件中提取出来，实现关注点分离。
 *
 * 快捷键分为以下几类：
 *   - 互动操作类：E
 *   - 播放控制类：Space、→、←
 *   - 音量控制类：↑、↓
 *   - 画面模式类：Esc、媒体键、F
 *   - 多P切换类：[、]
 *   - 弹幕控制类：Enter、D
 *   - 静音控制类：M
 *
 * 说明：
 *   - 快捷键列表 HOTKEYS 同时作为「快捷键说明面板」的唯一数据源，
 *     避免面板文案与真实行为再次出现不一致。
 *   - → 键支持「单次快进 5s，长按进入倍速播放」，长按逻辑在
 *     createHotkeyHandlers() 中通过 keydown/keyup 配合实现。
 */

import { useContext } from "@/core";
import { StateContext, type PlayerStateMap } from "@/store/runtimeState";
import type { TypedStateManager } from "@/core";

// ============================================
// 类型定义
// ============================================

/**
 * 快捷键执行上下文
 *
 * 由调用方（如 PlayerDocker）提供，向快捷键动作暴露播放器操作方法。
 * 动作函数只依赖这里声明的方法，不直接访问组件内部实现细节。
 */
export interface HotkeyContext {
  /** 获取 video 元素（尚未挂载或已销毁时返回 null） */
  getVideo(): HTMLVideoElement | null;

  /** 播放 / 暂停切换 */
  togglePlayPause(): void;

  /** 全屏 / 退出全屏切换 */
  toggleFullscreen(): void;

  /** 仅退出全屏（用于 Esc） */
  exitFullscreen(): void;

  /** 静音切换 */
  toggleMute(): void;

  /** 设置音量（内部会 clamp 到 0-1） */
  setVolume(volume: number): void;

  /** 读取当前音量（0-1） */
  getVolume(): number;

  /** 相对当前位置跳转（正数快进、负数快退，单位秒） */
  seekBy(seconds: number): void;

  /** 设置播放速率 */
  setPlaybackRate(rate: number): void;

  /** 读取当前播放速率 */
  getPlaybackRate(): number;

  /** 点赞 */
  like(): void;

  /** 投币 */
  coin(): void;

  /** 收藏 */
  favorite(): void;

  /** 一键三连 */
  tripleLike(): void;

  /** 关注 UP 主 */
  follow(): void;

  /** 弹幕显示 / 隐藏切换 */
  toggleDanmaku(): void;

  /** 聚焦弹幕输入框（发弹幕） */
  sendDanmaku(): void;

  /** 上一个分 P */
  prevEpisode(): void;

  /** 下一个分 P */
  nextEpisode(): void;
}

/**
 * 快捷键配置项
 *
 * 每个快捷键对应一个配置项，包含按键信息、功能描述和执行动作。
 * 按键匹配通过 keyMatcher 函数实现，支持单键、组合键和媒体键。
 */
export interface HotkeyConfig {
  /**
   * 快捷键显示名称
   * 用于快捷键面板展示，如 "Space"、"→"、"媒体键 play/pause" 等
   */
  name: string;
  /** 名称 i18n key（可选；面板渲染时优先取翻译） */
  nameKey?: string;
  /**
   * 快捷键功能描述
   * 详细说明该快捷键的作用和行为，与快捷键面板文案完全一致
   */
  desc: string;
  /** 描述 i18n key（可选；面板渲染时优先取翻译） */
  descKey?: string;
  /**
   * 按键匹配函数
   * 接收 KeyboardEvent，返回是否匹配该快捷键。
   * 支持单键匹配（如 Space）、组合键匹配（如 Shift + 1）、
   * 以及媒体键匹配（如 MediaPlayPause）
   */
  keyMatcher: (event: KeyboardEvent) => boolean;
  /**
   * 是否需要阻止浏览器默认行为
   * 用于 Space、方向键等会引发页面滚动的按键
   */
  preventDefault?: boolean;
  /**
   * 快捷键执行动作
   * 当按键匹配成功时调用，执行对应的播放器操作
   */
  action: (
    ctx: HotkeyContext,
    state: TypedStateManager<PlayerStateMap> | null,
  ) => void;
}

// ============================================
// 长按快进参数
// ============================================

/** 长按 → 键多久后进入倍速播放（毫秒） */
const SEEK_HOLD_DELAY = 300;

/** 长按 → 键时的倍速 */
const SEEK_HOLD_RATE = 3;

/** 方向键单次快进 / 快退的秒数 */
const SEEK_STEP = 5;

/** 音量单次调整幅度 */
const VOLUME_STEP = 0.1;

// ============================================
// 快捷键配置列表
// ============================================

/**
 * 播放器快捷键配置
 *
 * 顺序与快捷键说明面板的展示顺序一致（同时是面板的数据源）。
 * 每个快捷键包含：
 *   - name:    面板展示的按键名称
 *   - desc:    功能描述
 *   - keyMatcher: 按键匹配逻辑
 *   - preventDefault: 是否阻止默认行为
 *   - action:  匹配成功后执行的操作
 */
export const HOTKEYS: HotkeyConfig[] = [
  // ------------------------------------------
  // 互动操作类
  // ------------------------------------------

  {
    name: "E",
    desc: "Favorite",
    descKey: "player.ui.hotkey.favorite",
    keyMatcher: (e: KeyboardEvent) => e.key === "e" || e.key === "E",
    action: (ctx: HotkeyContext): void => {
      ctx.favorite();
    },
  },

  // ------------------------------------------
  // 播放控制类
  // ------------------------------------------

  {
    name: "Space",
    desc: "Play/Pause",
    descKey: "player.ui.hotkey.play_pause",
    keyMatcher: (e: KeyboardEvent) => e.key === " ",
    preventDefault: true,
    action: (ctx: HotkeyContext): void => {
      ctx.togglePlayPause();
    },
  },
  {
    name: "→",
    desc: "Seek forward 5s, long-press for fast playback",
    descKey: "player.ui.hotkey.seek_forward",
    keyMatcher: (e: KeyboardEvent) => e.key === "ArrowRight",
    preventDefault: true,
    action: (ctx: HotkeyContext): void => {
      ctx.seekBy(SEEK_STEP);
    },
  },
  {
    name: "←",
    desc: "Seek backward 5s",
    descKey: "player.ui.hotkey.seek_backward",
    keyMatcher: (e: KeyboardEvent) => e.key === "ArrowLeft",
    preventDefault: true,
    action: (ctx: HotkeyContext): void => {
      ctx.seekBy(-SEEK_STEP);
    },
  },

  // ------------------------------------------
  // 音量控制类
  // ------------------------------------------

  {
    name: "↑",
    desc: "Volume up 10%",
    descKey: "player.ui.hotkey.volume_up",
    keyMatcher: (e: KeyboardEvent) => e.key === "ArrowUp",
    preventDefault: true,
    action: (ctx: HotkeyContext): void => {
      ctx.setVolume(ctx.getVolume() + VOLUME_STEP);
    },
  },
  {
    name: "↓",
    desc: "Volume down 10%",
    descKey: "player.ui.hotkey.volume_down",
    keyMatcher: (e: KeyboardEvent) => e.key === "ArrowDown",
    preventDefault: true,
    action: (ctx: HotkeyContext): void => {
      ctx.setVolume(ctx.getVolume() - VOLUME_STEP);
    },
  },

  // ------------------------------------------
  // 画面模式类
  // ------------------------------------------

  {
    name: "Esc",
    desc: "Exit fullscreen",
    descKey: "player.ui.hotkey.exit_fullscreen",
    keyMatcher: (e: KeyboardEvent) => e.key === "Escape",
    action: (ctx: HotkeyContext): void => {
      ctx.exitFullscreen();
    },
  },
  {
    name: "Media key play/pause",
    nameKey: "player.ui.hotkey.media_key",
    desc: "Play/Pause",
    descKey: "player.ui.hotkey.play_pause",
    keyMatcher: (e: KeyboardEvent) =>
      e.key === "MediaPlayPause" || e.key === "MediaPlay" || e.key === "MediaPause",
    action: (ctx: HotkeyContext): void => {
      ctx.togglePlayPause();
    },
  },
  {
    name: "F",
    desc: "Fullscreen/Exit fullscreen",
    descKey: "player.ui.hotkey.fullscreen",
    keyMatcher: (e: KeyboardEvent) => e.key === "f" || e.key === "F",
    action: (ctx: HotkeyContext): void => {
      ctx.toggleFullscreen();
    },
  },

  // ------------------------------------------
  // 多P切换类
  // ------------------------------------------

  {
    name: "[",
    desc: "Previous episode",
    descKey: "player.ui.hotkey.prev_episode",
    keyMatcher: (e: KeyboardEvent) => e.key === "[",
    action: (ctx: HotkeyContext): void => {
      ctx.prevEpisode();
    },
  },
  {
    name: "]",
    desc: "Next episode",
    descKey: "player.ui.hotkey.next_episode",
    keyMatcher: (e: KeyboardEvent) => e.key === "]",
    action: (ctx: HotkeyContext): void => {
      ctx.nextEpisode();
    },
  },

  // ------------------------------------------
  // 弹幕控制类
  // ------------------------------------------

  {
    name: "Enter",
    desc: "Send danmaku",
    descKey: "player.ui.hotkey.send_danmaku",
    keyMatcher: (e: KeyboardEvent) => e.key === "Enter",
    action: (ctx: HotkeyContext): void => {
      ctx.sendDanmaku();
    },
  },
  {
    name: "D",
    desc: "Toggle danmaku",
    descKey: "player.ui.hotkey.toggle_danmaku",
    keyMatcher: (e: KeyboardEvent) => e.key === "d" || e.key === "D",
    action: (ctx: HotkeyContext): void => {
      ctx.toggleDanmaku();
    },
  },

  // ------------------------------------------
  // 静音控制类
  // ------------------------------------------

  {
    name: "M",
    desc: "Toggle mute",
    descKey: "player.ui.hotkey.toggle_mute",
    keyMatcher: (e: KeyboardEvent) => e.key === "m" || e.key === "M",
    action: (ctx: HotkeyContext): void => {
      ctx.toggleMute();
    },
  },
];

// ============================================
// 快捷键处理器
// ============================================

/**
 * 快捷键处理器集合
 * keydown 与 keyup 需要成对注册，才能支持「长按」类操作
 */
export interface HotkeyHandlers {
  /** keydown 事件处理函数 */
  onKeydown: (event: KeyboardEvent) => void;
  /** keyup 事件处理函数 */
  onKeyup: (event: KeyboardEvent) => void;
  /** 释放内部定时器（组件销毁时调用） */
  destroy: () => void;
}

/**
 * 判断按键事件是否发生在可编辑元素中
 *
 * 既有实现的行为：焦点在输入框 / 文本域时不响应快捷键，
 * 避免用户打字时误触发播放器操作。
 *
 * @returns 是否应跳过本次快捷键处理
 */
function isEditableTarget(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return ["INPUT", "TEXTAREA"].includes(active.tagName);
}

/**
 * 创建快捷键事件处理器
 *
 * 根据传入的上下文对象，返回一对 keydown / keyup 处理函数。
 * keydown 时遍历所有快捷键配置，按顺序匹配第一个命中的快捷键并执行其动作；
 * keyup 时结束「长按快进」等需要成对处理的交互。
 *
 * @param ctx - 快捷键执行上下文，提供播放器操作方法
 * @returns keydown / keyup 处理函数与销毁方法
 */
export function createHotkeyHandlers(ctx: HotkeyContext): HotkeyHandlers {
  /** 长按 → 键的计时器；非 null 表示正在等待判定是否为长按 */
  let seekHoldTimer: ReturnType<typeof setTimeout> | null = null;
  /** 是否已进入长按倍速状态 */
  let isSeekHolding = false;
  /** 进入长按倍速前的播放速率，用于松开后还原 */
  let rateBeforeHold = 1;

  /** 清除长按计时器 */
  const clearSeekHoldTimer = (): void => {
    if (seekHoldTimer !== null) {
      clearTimeout(seekHoldTimer);
      seekHoldTimer = null;
    }
  };

  /**
   * 开始长按判定：超过阈值后进入倍速播放
   */
  const startSeekHold = (): void => {
    clearSeekHoldTimer();
    if (isSeekHolding) return;
    rateBeforeHold = ctx.getPlaybackRate();
    seekHoldTimer = setTimeout(() => {
      seekHoldTimer = null;
      if (!ctx.getVideo()) return;
      isSeekHolding = true;
      ctx.setPlaybackRate(SEEK_HOLD_RATE);
    }, SEEK_HOLD_DELAY);
  };

  /**
   * 结束长按：还原长按前的播放速率
   */
  const endSeekHold = (): void => {
    clearSeekHoldTimer();
    if (isSeekHolding) {
      isSeekHolding = false;
      ctx.setPlaybackRate(rateBeforeHold);
    }
  };

  const onKeydown = (event: KeyboardEvent): void => {
    // 焦点在输入框 / 文本域时不响应快捷键
    if (isEditableTarget()) return;
    // 带 Ctrl / Meta / Alt 的组合键交给浏览器，避免抢占系统快捷键
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    // 通过 Context 获取状态管理器（部分动作需要读取运行时状态）
    const state = useContext(StateContext);

    for (const hotkey of HOTKEYS) {
      if (!hotkey.keyMatcher(event)) continue;

      if (hotkey.preventDefault) {
        event.preventDefault();
      }

      // 长按 → 键：首次按下才跳转，系统自动重复的事件不再叠加跳转，
      // 而是交给 startSeekHold 的定时器切换为倍速播放
      if (hotkey.keyMatcher(event) && event.key === "ArrowRight" && event.repeat) {
        return;
      }

      hotkey.action(ctx, state);

      if (event.key === "ArrowRight") {
        startSeekHold();
      }
      return;
    }
  };

  const onKeyup = (event: KeyboardEvent): void => {
    if (event.key === "ArrowRight") {
      endSeekHold();
    }
  };

  const destroy = (): void => {
    clearSeekHoldTimer();
    isSeekHolding = false;
  };

  return { onKeydown, onKeyup, destroy };
}

/**
 * 创建快捷键 keydown 事件处理函数（仅 keydown）
 *
 * @deprecated 仅需 keydown 的场景请使用本函数；需要支持「长按快进」
 * 等成对交互时请改用 createHotkeyHandlers() 并同时注册 keyup。
 *
 * @param ctx - 快捷键执行上下文，提供播放器操作方法
 * @returns keydown 事件处理函数，可直接传给 addEventListener
 */
export function createHotkeyHandler(
  ctx: HotkeyContext,
): (event: KeyboardEvent) => void {
  return createHotkeyHandlers(ctx).onKeydown;
}
