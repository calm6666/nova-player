/**
 * 图标资源：全部来自真实播放器 bundle（room-player.01626800.prod.min.js）中的内联 SVG，
 * 原样保存为 src/assets/*.svg 后以字符串形式引入，不再手绘图标。
 *
 * 颜色统一改为 currentColor，便于跟随控制条状态色。
 */
import fullscreenRaw from './全屏.svg?raw';
import exitFullscreenRaw from './退出全屏.svg?raw';
import webscreenRaw from './网页全屏.svg?raw';
import exitWebscreenRaw from './退出网页全屏.svg?raw';
import miniRaw from './小窗模式.svg?raw';
import exitMiniRaw from './退出小窗模式.svg?raw';
import pauseRaw from './播放中（暂停）.svg?raw';
import playRaw from './暂停中（播放）.svg?raw';
import volumeRaw from './音量-正常.svg?raw';
import muteRaw from './静音.svg?raw';
import refreshRaw from './刷新.svg?raw';
import danmakuRaw from './弹幕开.svg?raw';
import danmakuOffRaw from './弹幕关.svg?raw';
import danmakuSettingRaw from './弹幕设置.svg?raw';
import sendRaw from './发送弹幕.svg?raw';
import arrowRaw from './翻页箭头.svg?raw';

const normalize = (svg: string): string =>
  svg
    .trim()
    .replace(/fill="white"/g, 'fill="currentColor"')
    .replace(/stroke="white"/g, 'stroke="currentColor"');

/** 全屏。 */
export const fullscreenIcon = (): string => normalize(fullscreenRaw);

/** 退出全屏。 */
export const exitFullscreenIcon = (): string => normalize(exitFullscreenRaw);

/** 网页全屏。 */
export const webscreenIcon = (): string => normalize(webscreenRaw);

/** 退出网页全屏。 */
export const exitWebscreenIcon = (): string => normalize(exitWebscreenRaw);

/** 小窗模式。 */
export const miniIcon = (): string => normalize(miniRaw);

/** 退出小窗模式。 */
export const exitMiniIcon = (): string => normalize(exitMiniRaw);

/** 播放。 */
export const playIcon = (): string => normalize(playRaw);

/** 暂停。 */
export const pauseIcon = (): string => normalize(pauseRaw);

/** 音量。 */
export const volumeIcon = (): string => normalize(volumeRaw);

/** 静音。 */
export const mutedIcon = (): string => normalize(muteRaw);

/** 刷新。 */
export const refreshIcon = (): string => normalize(refreshRaw);

/** 弹幕开启。 */
export const danmakuIcon = (): string => normalize(danmakuRaw);

/** 弹幕关闭。 */
export const danmakuOffIcon = (): string => normalize(danmakuOffRaw);

/** 弹幕设置。 */
export const danmakuSettingIcon = (): string => normalize(danmakuSettingRaw);

/** 发送弹幕。 */
export const sendIcon = (): string => normalize(sendRaw);

/** 翻页箭头（向右）。 */
export const arrowRightIcon = (): string => normalize(arrowRaw);

/** 翻页箭头（向左，样式侧做中心翻转）。 */
export const arrowLeftIcon = (): string => normalize(arrowRaw);
