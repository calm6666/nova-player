/**
 * 播放器用户设置持久化。
 *
 * 默认开启：所有会影响下次打开观感的设置写入 localStorage。
 * 根元素可通过 `persist = false` 关闭写入，通过 `clearPersistedSettings()` 清空。
 */

/** 存储键；字段结构变化时递增版本后缀。 */
const STORAGE_KEY = 'lumina.live-player.settings.v1';

/** 设置持久化结构。 */
export interface PersistedSettings {
  /** 音量 0-100。 */
  volume?: number;
  /** 是否静音。 */
  muted?: boolean;
  /** 清晰度 qn。 */
  quality?: string;
  /** 线路标识。 */
  line?: string;
  /** 视频编码标识。 */
  codec?: string;
  /** 弹幕开关。 */
  danmakuVisible?: boolean;
  /** 弹幕不透明度 0-1。 */
  danmakuOpacity?: number;
  /** 弹幕字号 12-48。 */
  danmakuFontsize?: number;
  /** 弹幕速度 1-10。 */
  danmakuSpeed?: number;
  /** 弹幕显示区域 25-100。 */
  danmakuArea?: number;
  /** 弹幕密度 0-1。 */
  danmakuDensity?: number;
  /** 弹幕随屏幕缩放。 */
  danmakuAutoScale?: boolean;
  /** 弹幕速度跟随播放倍速。 */
  danmakuSpeedSync?: boolean;
  /** 弹幕字体。 */
  danmakuFontFamily?: string;
  /** 弹幕字色（#RRGGBB）。 */
  danmakuColor?: string;
  /** 弹幕加粗。 */
  danmakuBold?: boolean;
  /** 弹幕描边类型。 */
  danmakuFontBorder?: 'heavy' | 'outline' | 'projection';
  /** 弹幕屏蔽词。 */
  danmakuBlockWords?: string[];
  /** 屏幕形态（只持久化网页全屏，原生全屏不可恢复）。 */
  screenMode?: 'normal' | 'webscreen';
}

/** localStorage 是否可用（服务端 / 隐私模式返回 false）。 */
const hasStorage = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.localStorage);
  } catch {
    return false;
  }
};

/** 数字收敛到闭区间。 */
const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

/** 过滤屏蔽词数组，保持字符串去重后的顺序。 */
const sanitizeBlockWords = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const word of value) {
    if (typeof word !== 'string') continue;
    const trimmed = word.trim();
    if (trimmed && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
};

/** 归一化任意输入，拒绝越界值与错误类型。 */
const sanitize = (raw: Partial<PersistedSettings>): PersistedSettings => {
  const result: PersistedSettings = {};
  if (raw.volume !== undefined) result.volume = clampNumber(raw.volume, 0, 100, 100);
  if (raw.muted !== undefined) result.muted = Boolean(raw.muted);
  if (typeof raw.quality === 'string' && raw.quality) result.quality = raw.quality;
  if (typeof raw.line === 'string' && raw.line) result.line = raw.line;
  if (typeof raw.codec === 'string' && raw.codec) result.codec = raw.codec;
  if (raw.danmakuVisible !== undefined) result.danmakuVisible = Boolean(raw.danmakuVisible);
  if (raw.danmakuOpacity !== undefined) {
    result.danmakuOpacity = clampNumber(raw.danmakuOpacity, 0, 1, 0.8);
  }
  if (raw.danmakuFontsize !== undefined) {
    result.danmakuFontsize = clampNumber(raw.danmakuFontsize, 12, 48, 25);
  }
  if (raw.danmakuSpeed !== undefined) {
    result.danmakuSpeed = clampNumber(raw.danmakuSpeed, 1, 10, 5);
  }
  if (raw.danmakuArea !== undefined) {
    result.danmakuArea = clampNumber(raw.danmakuArea, 25, 100, 100);
  }
  if (raw.danmakuDensity !== undefined) {
    result.danmakuDensity = clampNumber(raw.danmakuDensity, 0, 1, 1);
  }
  if (raw.danmakuAutoScale !== undefined) result.danmakuAutoScale = Boolean(raw.danmakuAutoScale);
  if (raw.danmakuSpeedSync !== undefined) result.danmakuSpeedSync = Boolean(raw.danmakuSpeedSync);
  if (typeof raw.danmakuFontFamily === 'string' && raw.danmakuFontFamily) {
    result.danmakuFontFamily = raw.danmakuFontFamily;
  }
  if (typeof raw.danmakuColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.danmakuColor)) {
    result.danmakuColor = raw.danmakuColor.toUpperCase();
  }
  if (raw.danmakuBold !== undefined) result.danmakuBold = Boolean(raw.danmakuBold);
  if (
    raw.danmakuFontBorder === 'heavy' ||
    raw.danmakuFontBorder === 'outline' ||
    raw.danmakuFontBorder === 'projection'
  ) {
    result.danmakuFontBorder = raw.danmakuFontBorder;
  }
  if (raw.danmakuBlockWords !== undefined) {
    result.danmakuBlockWords = sanitizeBlockWords(raw.danmakuBlockWords);
  }
  if (raw.screenMode === 'normal' || raw.screenMode === 'webscreen') {
    result.screenMode = raw.screenMode;
  }
  return result;
};

/** 读取已持久化设置；不可用时返回空对象。 */
export function loadSettings(): PersistedSettings {
  if (!hasStorage()) return {};
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return {};
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return sanitize(parsed as Partial<PersistedSettings>);
  } catch {
    return {};
  }
}

/** 合并写入一份设置补丁。 */
export function saveSettings(patch: PersistedSettings, enabled = true): void {
  if (!enabled || !hasStorage()) return;
  try {
    const merged = sanitize({ ...loadSettings(), ...patch });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // 隐私模式下写入会抛错，这里按「不持久化」处理。
  }
}

/** 清空全部已持久化设置（含小窗位置）。 */
export function clearSettings(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(MINI_POSITION_KEY);
  } catch {
    // 忽略存储不可用。
  }
}

// ============================================================
// 小窗位置持久化
// ============================================================

/**
 * 小窗位置存储键。
 *
 * 与播放设置分开存：小窗位置属于「布局」而不是「观感设置」，
 * 单独一个键可以避免拖动小窗时反复重写整份设置。
 */
export const MINI_POSITION_KEY = 'lumina.live-player.mini-position.v1';

/** 小窗位置（视口坐标，单位 px）。 */
export interface PersistedMiniPosition {
  /** 小窗左边缘距视口左边的距离。 */
  left: number;
  /** 小窗上边缘距视口顶部的距离。 */
  top: number;
}

/** 读取已持久化的小窗位置；不可用或数据非法时返回 null。 */
export function loadMiniPosition(): PersistedMiniPosition | null {
  if (!hasStorage()) return null;
  try {
    const text = window.localStorage.getItem(MINI_POSITION_KEY);
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const left = Number((parsed as Partial<PersistedMiniPosition>).left);
    const top = Number((parsed as Partial<PersistedMiniPosition>).top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left: Math.round(left), top: Math.round(top) };
  } catch {
    return null;
  }
}

/** 写入小窗位置（非法数值直接忽略）。 */
export function saveMiniPosition(position: PersistedMiniPosition, enabled = true): void {
  if (!enabled || !hasStorage()) return;
  const left = Math.round(Number(position.left));
  const top = Math.round(Number(position.top));
  if (!Number.isFinite(left) || !Number.isFinite(top)) return;
  try {
    window.localStorage.setItem(MINI_POSITION_KEY, JSON.stringify({ left, top }));
  } catch {
    // 隐私模式下写入会抛错，这里按「不持久化」处理。
  }
}

/** 清空小窗位置。 */
export function clearMiniPosition(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(MINI_POSITION_KEY);
  } catch {
    // 忽略存储不可用。
  }
}

export { STORAGE_KEY };
