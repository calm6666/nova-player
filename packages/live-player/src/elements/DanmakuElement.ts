/**
 * `<nova-live-player-danmaku>` 弹幕层 Web Component。
 *
 * 渲染层使用框架 VNode；弹幕渲染本身复用 `packages/plugins` 的
 * `DanmakuManager`（与点播播放器同一套弹幕引擎），本组件负责：
 * - 创建 / 销毁引擎实例并挂到自己的容器；
 * - 把直播弹幕设置转换为引擎参数；
 * - 屏蔽词 / 屏蔽用户过滤；
 * - 悬停弹幕回调（供右键菜单识别目标）。
 */

import { h } from '@/core';
import { DanmakuManager, RenderMode } from '@/lumina/plugins/utils/danmaku';
import { injectPluginStyle } from '@/lumina/plugins/utils/injectStyle';
import danmakuCss from '@/lumina/plugins/danmaku/danmaku.scss?inline';
import { DanmakuType } from '@/types/danmaku';
import type { DanmakuItem as PluginDanmakuItem } from '@/types/danmaku';
import type { NovaDanmakuItem, NovaDanmakuSetting } from '@/live/types';
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

  /** 弹幕引擎。 */
  private manager: DanmakuManager | null = null;

  /** 视频元素。 */
  private video: HTMLVideoElement | null = null;

  /** 弹幕容器（由 VNode ref 赋值）。 */
  private layer: HTMLElement | null = null;

  /** 当前设置。 */
  private setting: NovaDanmakuSetting | null = null;

  /** 被屏蔽用户。 */
  private readonly blockedUsers = new Set<string>();

  /** 渲染容器（框架声明式）。 */
  protected render(): VNode {
    return h('div', {
      class: 'nova-live-player-danmaku-layer',
      ref: (el: unknown): void => {
        this.layer = el instanceof HTMLElement ? el : null;
      },
    });
  }

  /** 绑定视频并创建引擎。 */
  public attach(video: HTMLVideoElement): void {
    this.video = video;
    this.ensureManager();
  }

  /** 应用设置。 */
  public setSetting(setting: NovaDanmakuSetting): void {
    this.setting = { ...setting, blockWords: [...setting.blockWords] };
    this.applyStyleVariables();
    const manager = this.manager;
    if (!manager) return;
    manager.setVisible(setting.visible);
    manager.setOpacity(setting.opacity);
    manager.setAreaRatio(setting.area / 100);
    manager.setFontSizeScale(Math.max(0.5, Math.min(2.2, setting.fontsize / 18)));
    manager.setSpeedMultiplier(speedToMultiplier(setting.speed));
    manager.setDensity(setting.density);
    manager.setAutoScale(setting.autoScale);
    manager.setFilter({});
  }

  /** 发送弹幕。 */
  public send(item: NovaDanmakuItem): void {
    const manager = this.manager;
    const video = this.video;
    if (!manager || !video || this.shouldSkip(item)) return;
    const pluginItem = toPluginItem(item, video.currentTime);
    manager.sendDanmaku(pluginItem.text, {
      id: pluginItem.id,
      time: pluginItem.time,
      type: pluginItem.type,
      color: pluginItem.color,
      uid: pluginItem.uid,
      userName: pluginItem.userName,
    });
  }

  /** 批量加载（过滤屏蔽词 / 用户）。 */
  public load(list: NovaDanmakuItem[]): void {
    const manager = this.manager;
    const video = this.video;
    if (!manager || !video) return;
    manager.loadDanmaku(
      list.filter((item) => !this.shouldSkip(item)).map((item) => toPluginItem(item, video.currentTime)),
    );
  }

  /** 屏蔽用户。 */
  public blockUser(uid: string): void {
    if (uid) this.blockedUsers.add(uid);
  }

  /** 清空。 */
  public clear(): void {
    this.manager?.clear();
  }

  /** 暂停动画。 */
  public suspend(): void {
    this.manager?.pause();
  }

  /** 恢复动画。 */
  public resume(): void {
    if (this.setting?.visible === false) return;
    this.manager?.play();
  }

  /** 离开文档时销毁引擎。 */
  protected onDisconnect(): void {
    this.manager?.destroy();
    this.manager = null;
    this.video = null;
    this.layer = null;
  }

  /** 创建引擎。 */
  private ensureManager(): void {
    if (this.manager || !this.video || !this.layer) return;
    injectPluginStyle('live-player-danmaku', danmakuCss as unknown as string);
    this.manager = new DanmakuManager({
      container: this.layer,
      video: this.video,
      renderMode: RenderMode.DOM,
    });
    this.manager.setOnDanmakuHover((renderItem, position): void => {
      if (!renderItem || !position) {
        this.onHover?.(null);
        return;
      }
      this.onHover?.({
        uid: String(renderItem.uid ?? ''),
        uname: renderItem.userName ?? '',
        message: renderItem.text,
      });
    });
    this.manager.play();
    if (this.setting) this.setSetting(this.setting);
  }

  /** 字体 / 描边等引擎未提供 API 的设置写入 CSS 变量。 */
  private applyStyleVariables(): void {
    const layer = this.layer;
    const setting = this.setting;
    if (!layer || !setting) return;
    layer.style.setProperty('--nova-live-player-dm-font', setting.fontFamily);
    layer.style.setProperty('--nova-live-player-dm-weight', setting.bold ? '700' : '400');
    layer.style.setProperty(
      '--nova-live-player-dm-stroke',
      setting.fontBorder === 'outline' ? '1px' : setting.fontBorder === 'heavy' ? '0.8px' : '0px',
    );
    layer.style.setProperty(
      '--nova-live-player-dm-shadow',
      setting.fontBorder === 'projection' ? '2px 2px 2px rgba(0, 0, 0, 0.7)' : 'none',
    );
  }

  /** 是否过滤。 */
  private shouldSkip(item: NovaDanmakuItem): boolean {
    if (item.uid && this.blockedUsers.has(item.uid)) return true;
    const setting = this.setting;
    if (!setting) return false;
    const lower = item.text.toLowerCase();
    return setting.blockWords.some((word) => word.length > 0 && lower.includes(word.toLowerCase()));
  }
}

/** 速度 1-10 → 引擎倍率。 */
function speedToMultiplier(speed: number): number {
  if (speed <= 5) return 0.5 + speed * 0.1;
  return 1 + (speed - 5) * 0.2;
}

/** 弹幕模式 → 引擎类型。 */
function modeToType(mode?: number): DanmakuType {
  if (mode === 5) return DanmakuType.TOP;
  if (mode === 4) return DanmakuType.BOTTOM;
  return DanmakuType.SCROLL;
}

/** 本包条目 → 插件条目。 */
function toPluginItem(item: NovaDanmakuItem, fallbackTime: number): PluginDanmakuItem {
  return {
    id: `nova-live-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    text: item.text,
    time: item.time ?? fallbackTime,
    type: modeToType(item.mode),
    color: item.color ?? '#ffffff',
    uid: item.uid,
    userName: item.uname,
  };
}
