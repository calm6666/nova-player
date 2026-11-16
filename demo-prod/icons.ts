/**
 * SVG 矢量图标组件
 * 完全不使用 Unicode emoji，所有图标均为纯 SVG 矢量图
 */

import { h, defineComponent } from '@lumina/framework/core';
import type { VNode } from '@lumina/framework/types';

type IconProps = { size?: number; color?: string };

function createIcon(paths: VNode[], viewBox = '0 0 24 24') {
  return defineComponent<IconProps>((props) => {
    const size = props.size ?? 16;
    const color = props.color ?? 'currentColor';
    return h('svg', {
      width: String(size),
      height: String(size),
      viewBox,
      fill: 'none',
      stroke: color,
      'stroke-width': '2',
      'stroke-linecap': 'round' as const,
      'stroke-linejoin': 'round' as const,
      xmlns: 'http://www.w3.org/2000/svg',
    }, ...paths);
  });
}

// ===== 基础 UI 图标 =====

export const IconCheck = createIcon([
  h('path', { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' }),
  h('polyline', { points: '22 4 12 14.01 9 11.01' }),
]);

export const IconX = createIcon([
  h('circle', { cx: '12', cy: '12', r: '10' }),
  h('line', { x1: '15', y1: '9', x2: '9', y2: '15' }),
  h('line', { x1: '9', y1: '9', x2: '15', y2: '15' }),
]);

export const IconPlus = createIcon([
  h('circle', { cx: '12', cy: '12', r: '10' }),
  h('line', { x1: '12', y1: '8', x2: '12', y2: '16' }),
  h('line', { x1: '8', y1: '12', x2: '16', y2: '12' }),
]);

export const IconMinus = createIcon([
  h('circle', { cx: '12', cy: '12', r: '10' }),
  h('line', { x1: '8', y1: '12', x2: '16', y2: '12' }),
]);

export const IconRefresh = createIcon([
  h('polyline', { points: '23 4 23 10 17 10' }),
  h('polyline', { points: '1 20 1 14 7 14' }),
  h('path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' }),
]);

// ===== 主题图标 =====

export const IconSun = createIcon([
  h('circle', { cx: '12', cy: '12', r: '5' }),
  h('line', { x1: '12', y1: '1', x2: '12', y2: '3' }),
  h('line', { x1: '12', y1: '21', x2: '12', y2: '23' }),
  h('line', { x1: '4.22', y1: '4.22', x2: '5.64', y2: '5.64' }),
  h('line', { x1: '18.36', y1: '18.36', x2: '19.78', y2: '19.78' }),
  h('line', { x1: '1', y1: '12', x2: '3', y2: '12' }),
  h('line', { x1: '21', y1: '12', x2: '23', y2: '12' }),
  h('line', { x1: '4.22', y1: '19.78', x2: '5.64', y2: '18.36' }),
  h('line', { x1: '18.36', y1: '5.64', x2: '19.78', y2: '4.22' }),
]);

export const IconMoon = createIcon([
  h('path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }),
]);

// ===== 系统图标 =====

export const IconServer = createIcon([
  h('rect', { x: '2', y: '2', width: '20', height: '8', rx: '2', ry: '2' }),
  h('rect', { x: '2', y: '14', width: '20', height: '8', rx: '2', ry: '2' }),
  h('line', { x1: '6', y1: '6', x2: '6.01', y2: '6' }),
  h('line', { x1: '6', y1: '18', x2: '6.01', y2: '18' }),
]);

export const IconZap = createIcon([
  h('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }),
]);

export const IconTerminal = createIcon([
  h('polyline', { points: '4 17 10 11 4 5' }),
  h('line', { x1: '12', y1: '19', x2: '20', y2: '19' }),
]);

export const IconEye = createIcon([
  h('path', { d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z' }),
  h('circle', { cx: '12', cy: '12', r: '3' }),
]);

// ===== 调试面板图标 =====

export const IconBug = createIcon([
  h('path', { d: 'M8 2l1.88 1.88' }),
  h('path', { d: 'M14.12 3.88L16 2' }),
  h('path', { d: 'M9 7.13v-1a3.003 3.003 0 1 1 6 0v1' }),
  h('path', { d: 'M18 11a4 4 0 0 0-4-4h-4a4 4 0 0 0-4 4v3a6.1 6.1 0 0 0 2 4.5' }),
  h('path', { d: 'M6.53 9C4.6 8.8 3 7.1 3 5' }),
  h('path', { d: 'M6 13H2' }),
  h('path', { d: 'M3 21c0-2.1 1.7-3.9 3.8-4' }),
  h('path', { d: 'M20.97 5c0 2.1-1.6 3.8-3.5 4' }),
  h('path', { d: 'M18 13h4' }),
  h('path', { d: 'M17.2 17c2.1.1 3.8 1.9 3.8 4' }),
]);

export const IconAlert = createIcon([
  h('path', { d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }),
  h('line', { x1: '12', y1: '9', x2: '12', y2: '13' }),
  h('line', { x1: '12', y1: '17', x2: '12.01', y2: '17' }),
]);

export const IconInfo = createIcon([
  h('circle', { cx: '12', cy: '12', r: '10' }),
  h('line', { x1: '12', y1: '16', x2: '12', y2: '12' }),
  h('line', { x1: '12', y1: '8', x2: '12.01', y2: '8' }),
]);

export const IconClock = createIcon([
  h('circle', { cx: '12', cy: '12', r: '10' }),
  h('polyline', { points: '12 6 12 12 16 14' }),
]);

export const IconShield = createIcon([
  h('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' }),
]);

export const IconCode = createIcon([
  h('polyline', { points: '16 18 22 12 16 6' }),
  h('polyline', { points: '8 6 2 12 8 18' }),
]);

export const IconLayers = createIcon([
  h('polygon', { points: '12 2 2 7 12 12 22 7 12 2' }),
  h('polyline', { points: '2 17 12 22 22 17' }),
  h('polyline', { points: '2 12 12 17 22 12' }),
]);

export const IconPieChart = createIcon([
  h('path', { d: 'M21.21 15.89A10 10 0 1 1 8 2.83' }),
  h('path', { d: 'M22 12A10 10 0 0 0 12 2v10z' }),
]);

export const IconVideo = createIcon([
  h('polygon', { points: '23 7 16 12 23 17 23 7' }),
  h('rect', { x: '1', y: '5', width: '15', height: '14', rx: '2', ry: '2' }),
]);
