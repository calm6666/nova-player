/**
 * `<nova-live-player-danmaku>` 弹幕层 Web Component。
 *
 * 本组件不再自建弹幕引擎 / DOM 渲染：渲染、轨道、动画、悬停操作条全部由
 * 开发者传入的弹幕插件（`@lumina/plugins` 的 `createDanmakuPlugin()`）负责。
 *
 * live-player 只做四件事：
 * - 提供插件契约容器（`.nova-player-bas-dm-wrap`），把外层 DOM 挂载好；
 * - 把 `NovaDanmakuItem` 适配成插件条目；
 * - 屏蔽词 / 屏蔽用户过滤；
 * - 字体 / 粗体 / 描边等插件未暴露 API 的外观设置写入 CSS 变量，
 *   选中态由 `styles/base.scss` 的类体系消费（描边统一走 text-shadow）。
 */

import { h } from '@/core';
import { DanmakuType } from '@/types/danmaku';
import type { DanmakuItem as PluginDanmakuItem } from '@/types/danmaku';
import type { NovaDanmakuItem, NovaDanmakuSetting, NovaLiveDanmakuPlugin } from '@/live/types';
import type { VNode } from '@/types';
import { NovaLiveUiElement } from './base';

/** 弹幕层标签名。 */
export const DANMAKU_TAG = 'nova-live-player-danmaku';

/** 悬停弹幕信息。 */
export interface NovaDanmakuHoverItem {
  /** 发送者 uid。 */
  uid: string;
  /** 发送者昵称。 */
  uname: string;
  /** 弹幕文本。 */
  message: string;
}

/** 弹幕层元素。 */
export class NovaLivePlayerDanmakuElement extends NovaLiveUiElement {
  /** 悬停回调。 */
  public onHover: ((item: NovaDanmakuHoverItem | null) => void) | null = null;

  /** 开发者传入的弹幕插件。 */
  private plugin: NovaLiveDanmakuPlugin | null = null;

  /** 视频元素。 */
  private video: HTMLVideoElement | null = null;

  /** 弹幕层（插件的挂载容器，插件会在此查找 `.nova-player-bas-dm-wrap`）。 */
  private layer: HTMLElement | null = null;

  /** 当前设置。 */
  private setting: NovaDanmakuSetting | null = null;

  /** 被屏蔽用户。 */
  private readonly blockedUsers = new Set<string>();

  /** 悬停监听清理。 */
  private hoverCleanup: (() => void) | null = null;

  /** 渲染容器（框架声明式）。 */
  protected render(): VNode {
    return h(
      'div',
      {
        class: 'nova-live-player-danmaku-layer',
        ref: (el: unknown): void => {
          this.layer = el instanceof HTMLElement ? el : null;
        },
      },
      // `.nova-player-bas-dm-wrap` 是 plugins 弹幕插件的容器契约类；
      // 外层 `nova-live-player-danmaku-layer` 只承担 live-player 自己的布局。
      h('div', { class: 'nova-live-player-danmaku-stage nova-player-bas-dm-wrap' }),
    );
  }

  /** 插件挂载容器（`LivePluginHost.mount` 使用）。 */
  public getContainerElement(): HTMLElement | null {
    return this.layer;
  }

  /**
   * 绑定视频与弹幕插件。
   *
   * @param video - 视频元素。
   * @param plugin - 开发者传入的弹幕插件；为空时不渲染（理论上层不会挂载）。
   */
  public attach(video: HTMLVideoElement, plugin: NovaLiveDanmakuPlugin | null): void {
    this.video = video;
    this.plugin = plugin;
    this.bindHoverTracking();
    if (this.setting) this.applyStyleVariables();
  }

  /** 应用设置（仅处理 live-player 自己负责的外观变量）。 */
  public setSetting(setting: NovaDanmakuSetting): void {
    this.setting = { ...setting, blockWords: [...setting.blockWords] };
    this.applyStyleVariables();
  }

  /** 发送弹幕（走插件 API）。 */
  public send(item: NovaDanmakuItem): void {
    const plugin = this.plugin;
    const video = this.video;
    if (!plugin || !video || this.shouldSkip(item)) return;
    const pluginItem = toPluginItem(item, video.currentTime, this.setting?.color ?? '#FFFFFF');
    plugin.send(pluginItem.text, {
      id: pluginItem.id,
      time: pluginItem.time,
      type: pluginItem.type,
      color: pluginItem.color,
      uid: pluginItem.uid,
      userName: pluginItem.userName,
    });
  }

  /** 批量加载（过滤屏蔽词 / 用户后交给插件）。 */
  public load(list: readonly NovaDanmakuItem[]): void {
    const plugin = this.plugin;
    const video = this.video;
    if (!plugin || !video) return;
    const time = video.currentTime;
    const color = this.setting?.color ?? '#FFFFFF';
    plugin.loadDanmaku(
      list.filter((item) => !this.shouldSkip(item)).map((item) => toPluginItem(item, time, color)),
    );
  }

  /** 屏蔽用户。 */
  public blockUser(uid: string): void {
    if (uid) this.blockedUsers.add(uid);
  }

  /** 清空。 */
  public clear(): void {
    this.plugin?.clear();
  }

  /** 暂停动画。 */
  public suspend(): void {
    this.plugin?.pause();
  }

  /** 恢复动画。 */
  public resume(): void {
    if (this.setting?.visible === false) return;
    this.plugin?.play();
  }

  /** 离开文档时解绑（插件实例由 PluginManager 负责卸载）。 */
  protected onDisconnect(): void {
    this.hoverCleanup?.();
    this.hoverCleanup = null;
    this.plugin = null;
    this.video = null;
    this.layer = null;
    this.setting = null;
  }

  /**
   * 悬停弹幕识别：插件引擎的 DOM 条目带 `.danmaku-x-dm` 类，
   * 这里只读文本与事件目标，不接管插件的渲染/暂停逻辑。
   */
  private bindHoverTracking(): void {
    const layer = this.layer;
    if (!layer || this.hoverCleanup) return;

    const onPointerOver = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const element = target.closest('.danmaku-x-dm');
      if (!(element instanceof HTMLElement)) return;
      this.onHover?.({
        uid: '',
        uname: '',
        message: element.textContent?.trim() ?? '',
      });
    };
    const onPointerLeave = (): void => this.onHover?.(null);

    layer.addEventListener('pointerover', onPointerOver);
    layer.addEventListener('pointerleave', onPointerLeave);
    this.hoverCleanup = (): void => {
      layer.removeEventListener('pointerover', onPointerOver);
      layer.removeEventListener('pointerleave', onPointerLeave);
    };
  }

  /** 字体 / 描边等插件未提供 API 的设置写入 CSS 变量（样式在 base.scss）。 */
  private applyStyleVariables(): void {
    const layer = this.layer;
    const setting = this.setting;
    if (!layer || !setting) return;
    layer.style.setProperty('--nova-live-player-dm-font', setting.fontFamily);
    layer.style.setProperty('--nova-live-player-dm-weight', setting.bold ? '700' : '400');
    layer.style.setProperty('--nova-live-player-dm-shadow', strokeShadow(setting.fontBorder));
  }

  /** 是否过滤（屏蔽词 / 屏蔽用户；类型过滤交给插件 `setFilter`）。 */
  private shouldSkip(item: NovaDanmakuItem): boolean {
    if (item.uid && this.blockedUsers.has(item.uid)) return true;
    const setting = this.setting;
    if (!setting) return false;
    const lower = item.text.toLowerCase();
    return setting.blockWords.some((word) => word.length > 0 && lower.includes(word.toLowerCase()));
  }
}

/**
 * 描边设置 → 多层 text-shadow。
 *
 * 不再使用 `-webkit-text-stroke`（会把文字实际宽度压窄）；描边完全由
 * 多层 text-shadow 承担，投影档位只保留投影。
 *
 * @param stroke - 弹幕描边档位。
 * @returns 可写入 `text-shadow` 的值。
 */
function strokeShadow(stroke: NovaDanmakuSetting['fontBorder']): string {
  if (stroke === 'projection') return '2px 2px 3px rgba(0, 0, 0, 0.85), 0 0 2px rgba(0, 0, 0, 0.6)';
  if (stroke === 'outline') {
    return [
      '-1px -1px 0 #000000',
      '1px -1px 0 #000000',
      '-1px 1px 0 #000000',
      '1px 1px 0 #000000',
    ].join(', ');
  }
  return [
    '0 -1px 0 #000000',
    '0 1px 0 #000000',
    '-1px 0 0 #000000',
    '1px 0 0 #000000',
    '-1px -1px 0 #000000',
    '1px -1px 0 #000000',
    '-1px 1px 0 #000000',
    '1px 1px 0 #000000',
    '0 0 3px rgba(0, 0, 0, 0.9)',
  ].join(', ');
}

/** 弹幕模式 → 插件类型（1 滚动 / 4 底部 / 5 顶部）。 */
function modeToType(mode?: number): DanmakuType {
  if (mode === 5) return DanmakuType.TOP;
  if (mode === 4) return DanmakuType.BOTTOM;
  return DanmakuType.SCROLL;
}

/** 本包条目 → 插件条目。 */
function toPluginItem(
  item: NovaDanmakuItem,
  fallbackTime: number,
  defaultColor: string,
): PluginDanmakuItem {
  return {
    id: `nova-live-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    text: item.text,
    time: item.time ?? fallbackTime,
    type: modeToType(item.mode),
    color: item.color ?? defaultColor,
    uid: item.uid,
    userName: item.uname,
  };
}
