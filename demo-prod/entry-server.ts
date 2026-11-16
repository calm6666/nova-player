/**
 * demo-prod SSR 入口
 * ============================================
 * 使用相对路径导入框架核心，避免 @/ 别名在 Vite SSR 中的解析问题。
 * Vite 会递归转换 core/ 内部文件的 @/ 导入。
 */

import { renderToString } from '@lumina/framework/core';
import { createApp } from './main';

const SSR_MODULE_LOAD_TIME = Date.now();
let lastSSRDuration = 0;
let lastSSRStartTime = 0;

export function render(): string {
  lastSSRStartTime = performance.now();
  const html = renderToString(createApp({}));
  lastSSRDuration = performance.now() - lastSSRStartTime;
  return html;
}

export function getSSRMeta(): {
  startTime: number;
  renderDuration: number;
  moduleLoadTime: number;
} {
  return {
    startTime: SSR_MODULE_LOAD_TIME,
    renderDuration: lastSSRDuration,
    moduleLoadTime: SSR_MODULE_LOAD_TIME,
  };
}
