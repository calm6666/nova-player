/**
 * ============================================
 * 音乐面板主题（对应 @bilibili/bili-theme + changeTheme 事件机制）
 * ============================================
 * 从 cookie「theme_style」读取当前主题，默认 light；
 * 提供组件外切换主题的全局信号（setMusicTheme，对应 changeTheme）。
 */

import { signal } from "@/core";
import type { Signal } from "@/core";

/** 主题类型 */
export type ThemeMode = "light" | "dark";

/** cookie 中的主题键名（与 bili-theme 一致） */
const THEME_COOKIE_KEY = "theme_style";

/** 默认主题（与 bili-theme 一致） */
const DEFAULT_THEME: ThemeMode = "light";

/**
 * 读取 cookie（与原版简化读取逻辑一致）
 *
 * @param name - cookie 键名
 * @returns cookie 值；不存在时返回空字符串
 */
export function getCookie(name: string): string {
  const cookies = typeof document === "undefined" ? "" : document.cookie;
  const parts = cookies.split("; ");
  let result = "";
  for (let i = 0; i < parts.length; i += 1) {
    const pair = parts[i].split("=");
    if (pair[0] === name) {
      result = pair[1] ?? "";
    }
  }
  return result;
}

/**
 * 获取当前主题（每次调用实时读取 cookie）
 *
 * @returns 主题模式
 */
export function getTheme(): ThemeMode {
  return getCookie(THEME_COOKIE_KEY) === "dark" ? "dark" : DEFAULT_THEME;
}

/** 组件内响应式主题信号，初始值读取 cookie */
export const musicTheme: Signal<ThemeMode> = signal<ThemeMode>(getTheme());

/**
 * 切换主题（对应原版 changeTheme 事件）
 *
 * @param mode - 目标主题
 */
export function setMusicTheme(mode: ThemeMode): void {
  musicTheme.value = mode;
}
