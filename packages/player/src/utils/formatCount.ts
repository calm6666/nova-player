/**
 * ============================================
 * 播放器计数展示格式化（参考 B 站）
 * ============================================
 * 发送栏底部两处计数：
 * - 在线观看人数：B 站风格「万 / 亿」单位（不带加号），如 1.2万、10万、1亿
 * - 弹幕条数：超过 1000 后按数量级封顶加加号，如 1000+、1.2万+、10万+、1亿+
 *
 * 数值来源由 VideoPlayer.setOnlineCount / setDanmakuCount 写入运行时状态，
 * 发送栏通过状态信号响应式刷新（服务端实时数据 + 本地发送自增）。
 */

/**
 * 去掉整数位后多余的 `.0`（B 站「1万」而非「1.0万」）
 * @param text - 已保留一位小数的数字文本
 * @returns 去掉尾零的文本
 */
function trimTrailingZero(text: string): string {
  return text.replace(/\.0$/, "");
}

/**
 * 归一化计数输入（NaN / 负数 / 小数 → 非负整数）
 * @param value - 原始数值
 * @returns 归一化后的非负整数
 */
function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/**
 * 格式化在线观看人数（B 站风格，不带加号）
 *
 * - `< 1 万`：原样输出（如 999）
 * - `< 1 亿`：万级保留一位小数（向下截断），如 1.2万 / 10万
 * - `>= 1 亿`：亿级保留一位小数（向下截断），如 1.2亿
 * @param value - 在线人数
 * @returns 展示文本
 */
export function formatOnlineCount(value: number): string {
  const count = normalizeCount(value);
  if (count < 10000) return String(count);
  if (count < 100000000) {
    // 向下截断到 0.1 万，避免把「9999」进位成「1万」
    return `${trimTrailingZero((Math.floor(count / 1000) / 10).toFixed(1))}万`;
  }
  return `${trimTrailingZero((Math.floor(count / 10000000) / 10).toFixed(1))}亿`;
}

/**
 * 格式化弹幕条数（B 站式数量级封顶 + 加号）
 *
 * - `< 1000`：原样输出（如 999）
 * - `< 1 万`：`1000+`
 * - `< 1 亿`：万级保留一位小数（向下截断）并加 `+`，如 1.2万+ / 10万+
 * - `>= 1 亿`：亿级保留一位小数（向下截断）并加 `+`，如 1.2亿+
 * @param value - 弹幕总条数
 * @returns 展示文本
 */
export function formatDanmakuCount(value: number): string {
  const count = normalizeCount(value);
  if (count < 1000) return String(count);
  if (count < 10000) return "1000+";
  if (count < 100000000) {
    return `${trimTrailingZero((Math.floor(count / 1000) / 10).toFixed(1))}万+`;
  }
  return `${trimTrailingZero((Math.floor(count / 10000000) / 10).toFixed(1))}亿+`;
}
