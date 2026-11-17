/**
 * ============================================
 * 视频色彩调整插件
 * ============================================
 * 面板与滤镜逻辑都由插件自己持有：
 * - 右键菜单项与面板通过播放器 UI 注册表注册
 * - 滤镜参数直接写入播放器 video 元素的 style.filter
 */

import type { Plugin, VideoPlayer } from '@lumina/nova';
import {
  h,
  mount,
  destroy,
  loadColorPanel,
  loadPanelStyles,
} from '@lumina/nova';
import type { ColorPanelApi } from '@lumina/nova';
import type { VNode } from '@lumina/framework/types';

const DEFAULT_VALUE = 100;

class ColorPluginClass implements Plugin {
  readonly name = 'color';
  readonly version = '1.0.0';
  readonly description = 'Video color adjustment plugin';

  private player: VideoPlayer | null = null;
  private saturate = DEFAULT_VALUE;
  private brightness = DEFAULT_VALUE;
  private contrast = DEFAULT_VALUE;
  private panelApi: Partial<ColorPanelApi> = {};

  install(player: VideoPlayer): void {
    this.player = player;
    player.registerMenuItem?.({
      id: 'color.settings',
      plugin: this.name,
      position: 20,
      label: '视频色彩调整',
      onSelect: () => player.openPanel?.('color'),
    });

    let panelVNode: VNode | null = null;
    let panelClosed = false;
    player.registerPanel?.({
      id: 'color',
      plugin: this.name,
      mount: ({ container }): (() => void) => {
        panelClosed = false;
        this.panelApi = {};
        void (async (): Promise<void> => {
          const [panelModule, styleModule] = await Promise.all([
            loadColorPanel(),
            loadPanelStyles(),
          ]);
          if (panelClosed) return;
          styleModule.ensureLazyPanelStyles();
          panelVNode = h(panelModule.ColorPanel, {
            onClose: (): void => {
              this.panelApi.close?.();
            },
            onSaturateChange: (value: number): void => {
              this.saturate = value;
              this.applyFilter();
            },
            onBrightnessChange: (value: number): void => {
              this.brightness = value;
              this.applyFilter();
            },
            onContrastChange: (value: number): void => {
              this.contrast = value;
              this.applyFilter();
            },
            onReset: (): void => {
              this.saturate = DEFAULT_VALUE;
              this.brightness = DEFAULT_VALUE;
              this.contrast = DEFAULT_VALUE;
              this.applyFilter();
            },
            onColorPanelMounted: (api: ColorPanelApi): void => {
              this.panelApi = api;
            },
          });
          mount(panelVNode, container);
        })();
        return (): void => {
          panelClosed = true;
          if (panelVNode) {
            destroy(panelVNode);
            panelVNode = null;
          }
          this.panelApi = {};
        };
      },
      open: (): void => {
        this.panelApi.open?.();
      },
      close: (): void => {
        this.panelApi.close?.();
      },
    });
  }

  /** 把当前参数写入 video 的 CSS filter，默认值不参与拼接 */
  private applyFilter(): void {
    const video = this.player?.getVideoElement?.() ?? null;
    if (!video) return;
    const parts: string[] = [];
    if (this.saturate !== DEFAULT_VALUE) parts.push(`saturate(${this.saturate}%)`);
    if (this.brightness !== DEFAULT_VALUE) parts.push(`brightness(${this.brightness}%)`);
    if (this.contrast !== DEFAULT_VALUE) parts.push(`contrast(${this.contrast}%)`);
    video.style.filter = parts.join(" ");
  }

  uninstall(): void {
    // 卸载时恢复默认滤镜，避免色彩残留
    this.saturate = DEFAULT_VALUE;
    this.brightness = DEFAULT_VALUE;
    this.contrast = DEFAULT_VALUE;
    this.applyFilter();
    this.player = null;
    this.panelApi = {};
  }
}

export function ColorPlugin(): Plugin {
  return new ColorPluginClass();
}
