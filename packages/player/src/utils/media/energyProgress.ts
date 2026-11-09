/**
 * 高能进度条（PBP）数据
 *
 * 数据源由外部注入（`PlayerConfig.progress.energyProvider`），
 * 归一化后的形态：`{ stepSec, data: number[], duration? }`，
 * 其中 `data[i]` 是第 i 个采样点的热度（0-1，首点对应 0 秒）。
 *
 * 本模块只做「数据 → SVG path」的纯换算，渲染交给 PbpControls。
 */

import type { EnergyProgressData } from '../../types/player';

/**
 * 高能进度条数据（类型定义已上移到公共类型模块 `@/types`，
 * 此处 re-export 保持既有导入路径兼容）
 */
export type { EnergyProgressData };

/** 曲线坐标系尺寸（与实际像素解耦，靠 preserveAspectRatio="none" 拉伸） */
export const ENERGY_VIEW_WIDTH = 1000;
export const ENERGY_VIEW_HEIGHT = 100;

/** 两端收敛到基线的过渡段宽度（像素；像素宽度未知时退回按比例） */
export const ENERGY_EDGE_FADE_PX = 2;

/** 两端收敛到基线的过渡段占比（仅在未知像素宽度时使用） */
export const ENERGY_EDGE_FADE_RATIO = 0.002;

/**
 * 归一化高能进度条数据
 *
 * @param value - 任意可能形态（`{step_sec,data}` / `{stepSec,data}` / 纯数组）
 * @returns 归一后的数据；无有效采样点时返回 null
 */
export function normalizeEnergyProgress(value: unknown): EnergyProgressData | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as {
    step_sec?: unknown;
    stepSec?: unknown;
    duration?: unknown;
    data?: unknown;
  };
  const rawData = Array.isArray(record.data) ? record.data : null;
  if (!rawData || rawData.length === 0) return null;

  const data: number[] = [];
  for (const item of rawData) {
    const num = Number(item);
    if (Number.isFinite(num)) data.push(Math.min(1, Math.max(0, num)));
  }
  if (data.length === 0) return null;

  const stepRaw = Number(record.step_sec ?? record.stepSec);
  const durationRaw = Number(record.duration);

  return {
    stepSec: Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 1,
    data,
    duration: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined,
  };
}

/**
 * 把采样点换算为「面积路径」（从底边闭合成一块区域）
 *
 * 首尾各 `ENERGY_EDGE_FADE_PX` 像素内收敛到基线（与采样密度无关）。
 *
 * @param samples - 采样点（0-1），长度 >= 1
 * @param throughIndex - 只画到该下标（含）；缺省画满
 * @param barWidthPx - 进度条实际像素宽度，用于把过渡段固定成约 2~3 像素
 * @returns SVG path 的 d 属性；无有效点返回空串
 */
export function buildEnergyAreaPath(
  samples: number[],
  throughIndex?: number,
  barWidthPx?: number,
): string {
  if (samples.length === 0) return '';

  const last =
    throughIndex === undefined
      ? samples.length - 1
      : Math.max(0, Math.min(samples.length - 1, throughIndex));
  const visible = samples.slice(0, last + 1);
  const stepX = ENERGY_VIEW_WIDTH / Math.max(1, samples.length - 1);

  // 三次贝塞尔平滑：每段用「水平切线的 S 曲线」（控制点取两点的中点 X、
  // 分别取前后两点的 Y），与参考的 `C mid,y0 mid,y1 x1,y1` 写法一致
  const yAt = (value: number): number =>
    ENERGY_VIEW_HEIGHT - value * ENERGY_VIEW_HEIGHT;
  const xAt = (index: number): number => index * stepX;

  // 两端归零距离（视图单位）：由像素换算，最多半个采样间隔，避免盖过相邻采样点
  const fadeUnits =
    barWidthPx && barWidthPx > 0
      ? Math.min(
          (ENERGY_EDGE_FADE_PX * ENERGY_VIEW_WIDTH) / barWidthPx,
          stepX,
        )
      : Math.min(ENERGY_VIEW_WIDTH * ENERGY_EDGE_FADE_RATIO, stepX);

  const lastIsEnd = last === samples.length - 1;
  const valueAt = (index: number): number => visible[index];

  /* 两端各留 fadeUnits 的归零段：首/末采样点的 x 向内侧缩 fadeUnits，
   * 与基线之间用一段贝塞尔接上，归零距离恒为约 2px，与采样密度无关 */
  const xOf = (index: number): number => {
    if (index === 0) return fadeUnits;
    if (lastIsEnd && index === visible.length - 1) {
      return Math.max(fadeUnits, xAt(index) - fadeUnits);
    }
    return xAt(index);
  };

  let path = `M0,${ENERGY_VIEW_HEIGHT}`;
  if (visible.length === 1) {
    const x1 = xOf(0);
    const y1 = yAt(valueAt(0));
    path += ` C${(fadeUnits / 2).toFixed(2)},${ENERGY_VIEW_HEIGHT} ${(fadeUnits / 2).toFixed(2)},${y1.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
    if (lastIsEnd) {
      path += ` C${(x1 + fadeUnits / 2).toFixed(2)},${y1.toFixed(2)} ${(x1 + fadeUnits / 2).toFixed(2)},${ENERGY_VIEW_HEIGHT} ${ENERGY_VIEW_WIDTH},${ENERGY_VIEW_HEIGHT}`;
    }
    path += ' Z';
    return path;
  }

  path += ` C${(fadeUnits / 2).toFixed(2)},${ENERGY_VIEW_HEIGHT} ${(fadeUnits / 2).toFixed(2)},${yAt(valueAt(0)).toFixed(2)} ${xOf(0).toFixed(2)},${yAt(valueAt(0)).toFixed(2)}`;
  for (let i = 1; i < visible.length; i += 1) {
    const x0 = xOf(i - 1);
    const x1 = xOf(i);
    const y0 = yAt(valueAt(i - 1));
    const y1 = yAt(valueAt(i));
    const midX = ((x0 + x1) / 2).toFixed(2);
    path += ` C${midX},${y0.toFixed(2)} ${midX},${y1.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  if (lastIsEnd) {
    const xEnd = xOf(visible.length - 1);
    const yEnd = yAt(valueAt(visible.length - 1));
    path += ` C${(xEnd + fadeUnits / 2).toFixed(2)},${yEnd.toFixed(2)} ${(xEnd + fadeUnits / 2).toFixed(2)},${ENERGY_VIEW_HEIGHT} ${ENERGY_VIEW_WIDTH},${ENERGY_VIEW_HEIGHT} Z`;
    return path;
  }
  path += ` L${xOf(visible.length - 1).toFixed(2)},${ENERGY_VIEW_HEIGHT} Z`;
  return path;
}

/**
 * 把播放进度换算成采样点下标
 *
 * @param data - 高能数据
 * @param time - 当前播放时间（秒）
 * @returns 采样点下标（已夹在 [0, length-1]）
 */
export function energyIndexAt(data: EnergyProgressData, time: number): number {
  const total = data.duration ?? data.stepSec * data.data.length;
  if (!Number.isFinite(time) || total <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, time / total));
  return Math.max(0, Math.min(data.data.length - 1, Math.floor(ratio * data.data.length)));
}
