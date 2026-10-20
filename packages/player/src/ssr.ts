/**
 * ============================================
 * 播放器服务端渲染入口
 * ============================================
 * 将播放器完整 UI 树序列化为静态 HTML，供 SSR 首屏输出。
 * 客户端使用同一份 VNode 树 hydrate 后即可交互。
 */

import { renderToString } from "@/core";
import type { VideoPlayer } from "@/player/VideoPlayer";

/**
 * 服务端渲染播放器为 HTML 字符串
 *
 * @param player - 已构造的播放器实例
 * @returns 播放器完整 HTML（video + 控制栏 + 图层）
 */
export function renderPlayerToString(player: VideoPlayer): string {
  return renderToString(player.render());
}
