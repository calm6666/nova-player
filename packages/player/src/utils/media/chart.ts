/**
 * SVG 曲线图生成器
 * 用于生成码率、缓冲区、帧率等数据的平滑曲线图
 */

import { h, materialize } from '@lumina/framework/core';
import type { BitrateDataPoint, ThroughputDataPoint, BufferDataPoint, FrameRateDataPoint } from './types';

/** 图表配置 */
export interface ChartConfig {
  /** 图表宽度 */
  width: number;
  /** 图表高度 */
  height: number;
  /** 边距 */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** 线条颜色 */
  lineColor?: string;
  /** 填充颜色 */
  fillColor?: string;
  /** 线条宽度 */
  lineWidth?: number;
  /** 是否显示网格 */
  showGrid?: boolean;
  /** 网格颜色 */
  gridColor?: string;
  /** 是否显示坐标轴 */
  showAxis?: boolean;
  /** 坐标轴颜色 */
  axisColor?: string;
  /** 平滑度 (0-1) */
  smoothness?: number;
}

/** 默认配置 */
const DEFAULT_CHART_CONFIG: Required<ChartConfig> = {
  width: 300,
  height: 100,
  padding: { top: 10, right: 10, bottom: 20, left: 50 },
  lineColor: '#ffffff',
  fillColor: 'rgba(0, 161, 214, 0.1)',
  lineWidth: 2,
  showGrid: true,
  gridColor: 'rgba(255, 255, 255, 0.1)',
  showAxis: true,
  axisColor: 'rgba(255, 255, 255, 0.3)',
  smoothness: 0.3,
};

/**
 * 格式化码率显示
 * @param bps 比特率 (bps)
 * @returns 格式化后的字符串
 */
export function formatBitrate(bps: number): string {
  if (bps >= 1000000) {
    return `${(bps / 1000000).toFixed(1)} Mbps`;
  } else if (bps >= 1000) {
    return `${(bps / 1000).toFixed(1)} Kbps`;
  }
  return `${bps} bps`;
}

/**
 * 格式化时间显示
 * @param seconds 秒数
 * @returns 格式化后的字符串
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  } else if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  }
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * 生成 SVG 路径命令
 * @param points 数据点数组
 * @param config 图表配置
 * @returns SVG 路径字符串
 */
function generatePath(
  points: { x: number; y: number }[],
  config: Required<ChartConfig>
): string {
  if (points.length < 2) return '';

  const { smoothness } = config;

  // 使用 Catmull-Rom 样条曲线生成平滑路径
  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    // 计算控制点
    const cp1x = p1.x + (p2.x - p0.x) * smoothness * 0.5;
    const cp1y = p1.y + (p2.y - p0.y) * smoothness * 0.5;
    const cp2x = p2.x - (p3.x - p1.x) * smoothness * 0.5;
    const cp2y = p2.y - (p3.y - p1.y) * smoothness * 0.5;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return path;
}

/**
 * 生成码率曲线图 SVG
 * @param data 码率数据
 * @param config 图表配置
 * @returns SVG 字符串
 */
export function generateBitrateChart(
  data: BitrateDataPoint[],
  config: Partial<ChartConfig> = {}
): string {
  const cfg = { ...DEFAULT_CHART_CONFIG, ...config };
  const { width, height, padding } = cfg;

  if (data.length < 2) {
    return generateEmptyChart(cfg);
  }

  // 计算绘图区域
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // 获取数据范围（动态Y轴）
  const rawMaxBitrate = Math.max(...data.map((d) => d.totalBitrate), 1);
  const rawMinBitrate = Math.min(...data.map((d) => d.totalBitrate));
  const bitrateRange = rawMaxBitrate - rawMinBitrate || rawMaxBitrate;
  const maxBitrate = rawMaxBitrate + bitrateRange * 0.1;
  const minBitrate = Math.max(0, rawMinBitrate - bitrateRange * 0.1);
  const bitrateValueRange = maxBitrate - minBitrate;
  const minTime = data[0].timestamp;
  const maxTime = data[data.length - 1].timestamp;
  const timeRange = Math.max(maxTime - minTime, 1);

  // 生成数据点
  const points = data.map((d) => ({
    x: padding.left + ((d.timestamp - minTime) / timeRange) * chartWidth,
    y: padding.top + chartHeight - ((d.totalBitrate - minBitrate) / bitrateValueRange) * chartHeight,
  }));

  // 生成路径
  const linePath = generatePath(points, cfg);

  // 生成填充区域路径
  const fillPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  // 生成网格线
  let gridLines = '';
  if (cfg.showGrid) {
    // 水平网格线
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i;
      gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${cfg.gridColor}" stroke-width="1"/>`;
    }
  }

  // 生成坐标轴
  let axes = '';
  if (cfg.showAxis) {
    // Y 轴
    axes += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="${cfg.axisColor}" stroke-width="1"/>`;
    // X 轴
    axes += `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="${cfg.axisColor}" stroke-width="1"/>`;

    // Y 轴标签
    for (let i = 0; i <= 4; i++) {
      const value = minBitrate + (bitrateValueRange / 4) * (4 - i);
      const y = padding.top + (chartHeight / 4) * i;
      axes += `<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" fill="${cfg.axisColor}" font-size="10">${formatBitrate(value)}</text>`;
    }
  }

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bitrateGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:${cfg.lineColor};stop-opacity:0.3" />
          <stop offset="100%" style="stop-color:${cfg.lineColor};stop-opacity:0" />
        </linearGradient>
      </defs>
      ${gridLines}
      ${axes}
      <path d="${fillPath}" fill="url(#bitrateGradient)" stroke="none"/>
      <path d="${linePath}" fill="none" stroke="${cfg.lineColor}" stroke-width="${cfg.lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

/**
 * 生成缓冲区曲线图 SVG
 * @param data 缓冲区数据
 * @param config 图表配置
 * @returns SVG 字符串
 */
export function generateBufferChart(
  data: BufferDataPoint[],
  config: Partial<ChartConfig> = {}
): string {
  const cfg = {
    ...DEFAULT_CHART_CONFIG,
    ...config,
    lineColor: '#00d68f',
    fillColor: 'rgba(0, 214, 143, 0.1)',
  };
  const { width, height, padding } = cfg;

  if (data.length < 2) {
    return generateEmptyChart(cfg);
  }

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // 获取数据范围（动态Y轴）
  const rawMaxBuffer = Math.max(...data.map((d) => Math.max(d.videoBuffer, d.audioBuffer)), 10);
  const rawMinBuffer = Math.min(...data.map((d) => Math.min(d.videoBuffer, d.audioBuffer)));
  const bufferRange = rawMaxBuffer - rawMinBuffer || rawMaxBuffer;
  const maxBuffer = rawMaxBuffer + bufferRange * 0.1;
  const minBuffer = Math.max(0, rawMinBuffer - bufferRange * 0.1);
  const bufferValueRange = maxBuffer - minBuffer;
  const minTime = data[0].timestamp;
  const maxTime = data[data.length - 1].timestamp;
  const timeRange = Math.max(maxTime - minTime, 1);

  // 生成视频缓冲区数据点
  const videoPoints = data.map((d) => ({
    x: padding.left + ((d.timestamp - minTime) / timeRange) * chartWidth,
    y: padding.top + chartHeight - ((d.videoBuffer - minBuffer) / bufferValueRange) * chartHeight,
  }));

  // 生成音频缓冲区数据点
  const audioPoints = data.map((d) => ({
    x: padding.left + ((d.timestamp - minTime) / timeRange) * chartWidth,
    y: padding.top + chartHeight - ((d.audioBuffer - minBuffer) / bufferValueRange) * chartHeight,
  }));

  const videoPath = generatePath(videoPoints, cfg);
  const audioPath = generatePath(audioPoints, cfg);

  // 生成网格线
  let gridLines = '';
  if (cfg.showGrid) {
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i;
      gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${cfg.gridColor}" stroke-width="1"/>`;
    }
  }

  // 生成坐标轴
  let axes = '';
  if (cfg.showAxis) {
    axes += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="${cfg.axisColor}" stroke-width="1"/>`;
    axes += `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="${cfg.axisColor}" stroke-width="1"/>`;

    for (let i = 0; i <= 4; i++) {
      const value = minBuffer + (bufferValueRange / 4) * (4 - i);
      const y = padding.top + (chartHeight / 4) * i;
      axes += `<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" fill="${cfg.axisColor}" font-size="10">${value.toFixed(1)}s</text>`;
    }
  }

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      ${axes}
      <path d="${audioPath}" fill="none" stroke="#ffa940" stroke-width="${cfg.lineWidth}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4,4"/>
      <path d="${videoPath}" fill="none" stroke="${cfg.lineColor}" stroke-width="${cfg.lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

/**
 * 生成吞吐量曲线图 SVG
 * @param data 吞吐量数据
 * @param config 图表配置
 * @returns SVG 字符串
 */
export function generateThroughputChart(
  data: ThroughputDataPoint[],
  config: Partial<ChartConfig> = {}
): string {
  const cfg = {
    ...DEFAULT_CHART_CONFIG,
    ...config,
    lineColor: '#ffa726',
    fillColor: 'rgba(255, 167, 38, 0.1)',
  };
  const { width, height, padding } = cfg;

  if (data.length < 2) {
    return generateEmptyChart(cfg);
  }

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // 获取数据范围（动态Y轴）
  const rawMaxThroughput = Math.max(...data.map((d) => d.totalThroughput), 1000000);
  const rawMinThroughput = Math.min(...data.map((d) => d.totalThroughput));
  const throughputRange = rawMaxThroughput - rawMinThroughput || rawMaxThroughput;
  const maxThroughput = rawMaxThroughput + throughputRange * 0.1;
  const minThroughput = Math.max(0, rawMinThroughput - throughputRange * 0.1);
  const throughputValueRange = maxThroughput - minThroughput;
  const minTime = data[0].timestamp;
  const maxTime = data[data.length - 1].timestamp;
  const timeRange = Math.max(maxTime - minTime, 1000);

  // 生成数据点
  const points = data.map((d) => ({
    x: padding.left + ((d.timestamp - minTime) / timeRange) * chartWidth,
    y: padding.top + chartHeight - ((d.totalThroughput - minThroughput) / throughputValueRange) * chartHeight,
  }));

  const linePath = generatePath(points, cfg);

  // 生成填充路径
  const fillPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  // 生成网格线
  let gridLines = '';
  if (cfg.showGrid) {
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i;
      gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${cfg.gridColor}" stroke-width="1"/>`;
    }
  }

  // 生成坐标轴
  let axes = '';
  if (cfg.showAxis) {
    axes += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="${cfg.axisColor}" stroke-width="1"/>`;
    axes += `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="${cfg.axisColor}" stroke-width="1"/>`;

    for (let i = 0; i <= 4; i++) {
      const value = minThroughput + (throughputValueRange / 4) * (4 - i);
      const y = padding.top + (chartHeight / 4) * i;
      axes += `<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" fill="${cfg.axisColor}" font-size="10">${formatBitrate(value)}</text>`;
    }
  }

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      ${axes}
      <path d="${fillPath}" fill="${cfg.fillColor}"/>
      <path d="${linePath}" fill="none" stroke="${cfg.lineColor}" stroke-width="${cfg.lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

/**
 * 生成帧率曲线图 SVG
 * @param data 帧率数据
 * @param config 图表配置
 * @returns SVG 字符串
 */
export function generateFPSChart(
  data: FrameRateDataPoint[],
  config: Partial<ChartConfig> = {}
): string {
  const cfg = {
    ...DEFAULT_CHART_CONFIG,
    ...config,
    lineColor: '#ff6b6b',
    fillColor: 'rgba(255, 107, 107, 0.1)',
  };
  const { width, height, padding } = cfg;

  if (data.length < 2) {
    return generateEmptyChart(cfg);
  }

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // 获取数据范围（动态Y轴）
  const rawMaxFPS = Math.max(...data.map((d) => d.fps), 60);
  const rawMinFPS = Math.min(...data.map((d) => d.fps));
  const fpsRange = rawMaxFPS - rawMinFPS || rawMaxFPS;
  const maxFPS = rawMaxFPS + fpsRange * 0.1;
  const minFPS = Math.max(0, rawMinFPS - fpsRange * 0.1);
  const fpsValueRange = maxFPS - minFPS;
  const minTime = data[0].timestamp;
  const maxTime = data[data.length - 1].timestamp;
  const timeRange = Math.max(maxTime - minTime, 1);

  // 生成数据点
  const points = data.map((d) => ({
    x: padding.left + ((d.timestamp - minTime) / timeRange) * chartWidth,
    y: padding.top + chartHeight - ((d.fps - minFPS) / fpsValueRange) * chartHeight,
  }));

  const linePath = generatePath(points, cfg);

  // 生成网格线
  let gridLines = '';
  if (cfg.showGrid) {
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i;
      gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${cfg.gridColor}" stroke-width="1"/>`;
    }
  }

  // 生成坐标轴
  let axes = '';
  if (cfg.showAxis) {
    axes += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="${cfg.axisColor}" stroke-width="1"/>`;
    axes += `<line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="${cfg.axisColor}" stroke-width="1"/>`;

    for (let i = 0; i <= 4; i++) {
      const value = minFPS + (fpsValueRange / 4) * (4 - i);
      const y = padding.top + (chartHeight / 4) * i;
      axes += `<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" fill="${cfg.axisColor}" font-size="10">${Math.round(value)} FPS</text>`;
    }
  }

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      ${axes}
      <path d="${linePath}" fill="none" stroke="${cfg.lineColor}" stroke-width="${cfg.lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

/**
 * 生成空图表
 * @param config 图表配置
 * @returns SVG 字符串
 */
function generateEmptyChart(config: Required<ChartConfig>): string {
  const { width, height } = config;

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="${config.axisColor}" font-size="12">
        等待数据...
      </text>
    </svg>
  `;
}

/**
 * 创建图表容器
 * @param container 容器元素
 * @param title 图表标题
 * @returns 图表内容元素
 */
export function createChartContainer(
  container: HTMLElement,
  title: string,
): HTMLElement {
  let content: HTMLElement | null = null;
  const wrapper = materialize(
    h(
      'div',
      { class: 'media-chart-wrapper' },
      h('div', { class: 'media-chart-title' }, title),
      h('div', {
        class: 'media-chart-content',
        ref: (el: Element) => {
          content = el as HTMLElement;
        },
      }),
    ),
  ) as HTMLElement;
  container.appendChild(wrapper);
  return content as unknown as HTMLElement;
}
