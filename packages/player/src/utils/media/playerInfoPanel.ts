/**
 * 播放器详细信息面板
 * 显示视频编码、清晰度、帧率、码率等详细信息
 * 右键播放器打开，关闭后停止监控以节省性能
 */

import { MediaPlayerMonitor } from "./monitor";
import {
  generateBitrateChart,
  generateThroughputChart,
  generateBufferChart,
  generateFPSChart,
  formatBitrate,
} from "./chart";
import {
  PlayerType,
  type PlayerStats,
  type DashPlayer,
  type HlsPlayer,
  type FlvPlayer,
} from "./types";
import { Close } from "../../components/icons";
import { materialize } from '@lumina/framework/core';
import { renderSvgMarkup } from "../svgMarkup";

/** 面板配置 */
export interface PanelConfig {
  /** 面板标题 */
  title?: string;
  /** 主题色 */
  themeColor?: string;
  /** 背景色 */
  backgroundColor?: string;
  /** 文字颜色 */
  textColor?: string;
  /** 边框颜色 */
  borderColor?: string;
  /** 图表宽度 */
  chartWidth?: number;
  /** 图表高度 */
  chartHeight?: number;
}

/** 默认配置 */
const DEFAULT_PANEL_CONFIG: Required<PanelConfig> = {
  title: "播放器详细信息",
  themeColor: "#00a1d6",
  backgroundColor: "rgba(0, 0, 0, 0.9)",
  textColor: "#ffffff",
  borderColor: "rgba(255, 255, 255, 0.1)",
  chartWidth: 280,
  chartHeight: 80,
};

export class PlayerInfoPanel {
  /** 面板元素 */
  private panel: HTMLElement | null = null;
  /** 监控器实例 */
  private monitor: MediaPlayerMonitor;
  /** 配置 */
  private config: Required<PanelConfig>;
  /** 是否显示中 */
  private isVisible = false;
  /** 图表容器 */
  private bitrateChartContainer: HTMLElement | null = null;
  private throughputChartContainer: HTMLElement | null = null;
  private bufferChartContainer: HTMLElement | null = null;
  private fpsChartContainer: HTMLElement | null = null;
  /** 信息项元素 */
  private infoElements: Map<string, HTMLElement> = new Map();
  /** 父容器元素 */
  private container: HTMLElement | null = null;

  constructor(
    monitor: MediaPlayerMonitor,
    config: PanelConfig = {},
    container?: HTMLElement,
  ) {
    this.monitor = monitor;
    this.config = { ...DEFAULT_PANEL_CONFIG, ...config };
    this.container = container || null;
  }

  /**
   * 显示面板
   */
  show(): void {
    if (this.isVisible) return;

    this.isVisible = true;
    this.createPanel();
    this.monitor.start();
    this.updateDisplay();
  }

  /**
   * 隐藏面板
   */
  hide(): void {
    if (!this.isVisible) return;

    this.isVisible = false;
    this.monitor.stop();
    this.destroyPanel();
  }

  /**
   * 切换显示状态
   */
  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * 获取显示状态
   */
  getIsVisible(): boolean {
    return this.isVisible;
  }

  /**
   * 创建面板
   */
  private createPanel(): void {
    if (this.panel) return;

    // 创建面板容器
    this.panel = document.createElement("div");
    this.panel.className = "nova-player-info-panel";
    // 如果有父容器，使用 absolute 定位，否则使用 fixed
    const isInContainer = !!this.container;
    this.panel.style.cssText = `
      position: ${isInContainer ? "absolute" : "fixed"};
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 360px;
      max-height: ${isInContainer ? "80%" : "90vh"};
      background: ${this.config.backgroundColor};
      border: 1px solid ${this.config.borderColor};
      border-radius: 8px;
      padding: 16px;
      color: ${this.config.textColor};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      z-index: 9999;
      overflow-y: auto;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    `;

    // 创建标题栏
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid ${this.config.borderColor};
    `;

    const title = document.createElement("div");
    title.textContent = this.config.title;
    title.style.cssText = `
      font-size: 15px;
      font-weight: 600;
      color: ${this.config.themeColor};
    `;

    const closeBtn = document.createElement("button");
    // 关闭图标使用既有实现 icons 的 Close SVG（禁止用 unicode 字符当图标）
    closeBtn.appendChild(materialize(Close()));
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: ${this.config.textColor};
      font-size: 18px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: background 0.2s;
      display: flex;
      align-items: center;
    `;
    closeBtn.onmouseover = (): void => {
      closeBtn.style.background = "rgba(255, 255, 255, 0.1)";
    };
    closeBtn.onmouseout = (): void => {
      closeBtn.style.background = "transparent";
    };
    closeBtn.onclick = (): void => this.hide();

    header.appendChild(title);
    header.appendChild(closeBtn);
    this.panel.appendChild(header);

    // 创建基本信息区域
    const basicInfo = this.createSection("基本信息");
    this.createInfoItem(basicInfo, "播放器类型", "playerType");
    this.createInfoItem(basicInfo, "流媒体协议", "protocol");
    this.createInfoItem(basicInfo, "视频编码", "videoCodec");
    this.createInfoItem(basicInfo, "音频编码", "audioCodec");
    this.createInfoItem(basicInfo, "分辨率", "resolution");
    this.createInfoItem(basicInfo, "帧率", "frameRate");
    this.createInfoItem(basicInfo, "当前清晰度", "currentQuality");
    this.panel.appendChild(basicInfo);

    // 创建码率信息区域
    const bitrateInfo = this.createSection("码率信息");
    this.createInfoItem(bitrateInfo, "总码率", "totalBitrate");
    this.createInfoItem(bitrateInfo, "视频码率", "videoBitrate");
    this.createInfoItem(bitrateInfo, "音频码率", "audioBitrate");
    this.panel.appendChild(bitrateInfo);

    // 创建缓冲区信息区域
    const bufferInfo = this.createSection("缓冲区信息");
    this.createInfoItem(bufferInfo, "视频缓冲", "videoBuffer");
    this.createInfoItem(bufferInfo, "音频缓冲", "audioBuffer");
    this.panel.appendChild(bufferInfo);

    // 创建码率图表（静态码率 - 当前选中清晰度）
    const bitrateChartSection = this.createSection("码率曲线 (选中清晰度)");
    this.bitrateChartContainer = document.createElement("div");
    this.bitrateChartContainer.style.cssText = `
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      padding: 8px;
    `;
    bitrateChartSection.appendChild(this.bitrateChartContainer);
    this.panel.appendChild(bitrateChartSection);

    // 创建吞吐量图表（实际下载速度）
    const throughputChartSection = this.createSection("吞吐量曲线 (下载速度)");
    this.throughputChartContainer = document.createElement("div");
    this.throughputChartContainer.style.cssText = `
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      padding: 8px;
    `;
    throughputChartSection.appendChild(this.throughputChartContainer);
    this.panel.appendChild(throughputChartSection);

    // 创建缓冲区图表
    const bufferChartSection = this.createSection("缓冲区曲线");
    this.bufferChartContainer = document.createElement("div");
    this.bufferChartContainer.style.cssText = `
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      padding: 8px;
    `;
    bufferChartSection.appendChild(this.bufferChartContainer);
    this.panel.appendChild(bufferChartSection);

    // 创建帧率图表
    const fpsChartSection = this.createSection("帧率曲线");
    this.fpsChartContainer = document.createElement("div");
    this.fpsChartContainer.style.cssText = `
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      padding: 8px;
    `;
    fpsChartSection.appendChild(this.fpsChartContainer);
    this.panel.appendChild(fpsChartSection);

    // 添加到父容器或页面
    if (this.container) {
      // 确保父容器有相对定位
      const containerPosition = window.getComputedStyle(
        this.container,
      ).position;
      if (containerPosition === "static") {
        this.container.style.position = "relative";
      }
      this.container.appendChild(this.panel);
    } else {
      document.body.appendChild(this.panel);
    }

    // 绑定监控回调
    this.bindMonitorCallbacks();
  }

  /**
   * 创建区域
   */
  private createSection(title: string): HTMLElement {
    const section = document.createElement("div");
    section.style.cssText = `
      margin-bottom: 16px;
    `;

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = title;
    sectionTitle.style.cssText = `
      font-size: 12px;
      color: ${this.config.themeColor};
      margin-bottom: 8px;
      font-weight: 500;
    `;

    section.appendChild(sectionTitle);
    return section;
  }

  /**
   * 创建信息项
   */
  private createInfoItem(
    container: HTMLElement,
    label: string,
    key: string,
  ): void {
    const item = document.createElement("div");
    item.style.cssText = `
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px solid ${this.config.borderColor};
    `;

    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    labelEl.style.color = "rgba(255, 255, 255, 0.7)";

    const valueEl = document.createElement("span");
    valueEl.textContent = "-";
    valueEl.style.fontWeight = "500";
    valueEl.dataset.key = key;

    item.appendChild(labelEl);
    item.appendChild(valueEl);
    container.appendChild(item);

    this.infoElements.set(key, valueEl);
  }

  /**
   * 绑定监控回调
   */
  private bindMonitorCallbacks(): void {
    this.monitor["callbacks"] = {
      onStatsUpdate: (stats: PlayerStats): void => {
        this.updateInfo(stats);
      },
      onBitrateUpdate: (): void => {
        this.updateBitrateChart();
      },
      onThroughputUpdate: (): void => {
        this.updateThroughputChart();
      },
      onBufferUpdate: (): void => {
        this.updateBufferChart();
      },
      onFPSUpdate: (): void => {
        this.updateFPSChart();
      },
    };
  }

  /**
   * 更新信息显示
   */
  private updateInfo(stats: PlayerStats): void {
    const details = this.monitor.getPlayerDetails();

    this.setInfoValue("playerType", details.playerType.toUpperCase());
    this.setInfoValue("protocol", details.protocol);
    this.setInfoValue("videoCodec", details.videoCodec);
    this.setInfoValue("audioCodec", details.audioCodec);
    this.setInfoValue(
      "resolution",
      `${details.videoWidth}x${details.videoHeight}`,
    );
    this.setInfoValue("frameRate", `${Math.round(details.frameRate)} FPS`);
    this.setInfoValue("currentQuality", details.currentQuality);
    this.setInfoValue("totalBitrate", formatBitrate(stats.totalBitrate));
    this.setInfoValue("videoBitrate", formatBitrate(stats.videoBitrate));
    this.setInfoValue("audioBitrate", formatBitrate(stats.audioBitrate));
    this.setInfoValue("videoBuffer", `${stats.videoBufferLength.toFixed(1)}s`);
    this.setInfoValue("audioBuffer", `${stats.audioBufferLength.toFixed(1)}s`);
  }

  /**
   * 设置信息值
   */
  private setInfoValue(key: string, value: string): void {
    const element = this.infoElements.get(key);
    if (element) {
      element.textContent = value;
    }
  }

  /**
   * 更新码率图表
   */
  private updateBitrateChart(): void {
    if (!this.bitrateChartContainer) return;

    const data = this.monitor.getBitrateData();
    const svg = generateBitrateChart(data, {
      width: this.config.chartWidth,
      height: this.config.chartHeight,
    });

    renderSvgMarkup(this.bitrateChartContainer, svg);
  }

  /**
   * 更新吞吐量图表
   */
  private updateThroughputChart(): void {
    if (!this.throughputChartContainer) return;

    const data = this.monitor.getThroughputData();
    const svg = generateThroughputChart(data, {
      width: this.config.chartWidth,
      height: this.config.chartHeight,
    });

    renderSvgMarkup(this.throughputChartContainer, svg);
  }

  /**
   * 更新缓冲区图表
   */
  private updateBufferChart(): void {
    if (!this.bufferChartContainer) return;

    const data = this.monitor.getBufferData();
    const svg = generateBufferChart(data, {
      width: this.config.chartWidth,
      height: this.config.chartHeight,
    });

    renderSvgMarkup(this.bufferChartContainer, svg);
  }

  /**
   * 更新帧率图表
   */
  private updateFPSChart(): void {
    if (!this.fpsChartContainer) return;

    const data = this.monitor.getFPSData();
    const svg = generateFPSChart(data, {
      width: this.config.chartWidth,
      height: this.config.chartHeight,
    });

    renderSvgMarkup(this.fpsChartContainer, svg);
  }

  /**
   * 更新显示
   */
  private updateDisplay(): void {
    const stats = this.monitor.getStats();
    this.updateInfo(stats);
    this.updateBitrateChart();
    this.updateThroughputChart();
    this.updateBufferChart();
    this.updateFPSChart();
  }

  /**
   * 销毁面板
   */
  private destroyPanel(): void {
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }
    this.bitrateChartContainer = null;
    this.bufferChartContainer = null;
    this.fpsChartContainer = null;
    this.infoElements.clear();
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.hide();
  }
}

/**
 * 创建播放器信息面板
 * @param video 视频元素
 * @param config 面板配置
 * @param player dash.js/hls.js/flv.js 播放器实例
 * @param playerType 播放器类型
 * @returns PlayerInfoPanel 实例
 */
export function createPlayerInfoPanel(
  video: HTMLVideoElement,
  config?: PanelConfig,
  player?: DashPlayer | HlsPlayer | FlvPlayer | null,
  playerType?: PlayerType,
  container?: HTMLElement,
): PlayerInfoPanel {
  const monitor = new MediaPlayerMonitor(video);
  if (player && playerType) {
    monitor.setPlayer(player, playerType);
  }
  return new PlayerInfoPanel(monitor, config, container);
}
