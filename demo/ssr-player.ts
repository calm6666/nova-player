/**
 * ============================================
 * Demo 播放器 SSR 配置
 * ============================================
 * 服务端与客户端必须使用完全相同的 PlayerConfig，
 * 否则 renderToString 的 VNode 结构与 hydrate 的 VNode 结构不一致。
 */

import { VideoPlayer } from "@/nova/player";
import type { PlayerConfig } from "@/types";
import zhCN from "@/core/locales/zh-CN.json";
import enUS from "@/core/locales/en-US.json";

/** 服务端首屏使用的稳定示例源（与 entry-client 的 MEDIA_LIST[0] 保持一致） */
export const DEMO_SSR_SOURCE = "/sample.mp4";
export const DEMO_SSR_TITLE = "赶集买了几只牛蛙，好久没吃了，立马安排...";

/** SSR / 水合共用的基础配置：不包含任何浏览器专属数据 */
export const DEMO_SSR_PLAYER_CONFIG: PlayerConfig = {
  src: DEMO_SSR_SOURCE,
  playback: {
    autoplay: false,
    muted: true,
    volume: 0.3,
  },
  interaction: {
    keyboard: true,
  },
  ui: {
    title: DEMO_SSR_TITLE,
    scene: "station",
  },
  advanced: {
    debug: false,
  },
  i18n: {
    enabled: true,
    locale: "zh-CN",
    fallbackLocale: "en-US",
    messages: {
      "zh-CN": zhCN,
      "en-US": enUS,
    },
  },
};

/** 创建 SSR / 水合播放器实例（每次渲染阶段必须新建实例） */
export function createDemoSSRPlayer(): VideoPlayer {
  return new VideoPlayer(DEMO_SSR_PLAYER_CONFIG);
}
