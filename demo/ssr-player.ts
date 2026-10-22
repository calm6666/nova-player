/**
 * ============================================
 * Demo 播放器 SSR 配置
 * ============================================
 * 服务端与客户端必须使用完全相同的 PlayerConfig，
 * 否则 renderToString 的 VNode 结构与 hydrate 的 VNode 结构不一致。
 *
 * SSR 只渲染播放器骨架：章节、高能曲线等业务数据不参与服务端渲染，
 * 客户端水合后只请求一次数据，通过 player.progress API 注入。
 */

import { VideoPlayer } from "@/nova/player";
import type { PlayerConfig } from "@/types";
import zhCN from "@/locales/zh-CN.json";
import enUS from "@/locales/en-US.json";

/** 服务端首屏使用的稳定示例源（与 entry-client 的 MEDIA_LIST[0] 保持一致） */
export const DEMO_SSR_SOURCE = "/sample.mp4";
export const DEMO_SSR_TITLE = "赶集买了几只牛蛙，好久没吃了，立马安排...";

/** SSR / 水合共用配置：不包含任何服务端请求得到的业务数据 */
export const DEMO_SSR_PLAYER_CONFIG: PlayerConfig = {
  src: DEMO_SSR_SOURCE,
  playback: {
    autoplay: false,
    muted: true,
    volume: 0.3,
  },
  progress: {
    // 章节 / 分段进度条 / 影子进度条共用同一份数据，客户端注入
    segments: [],
    shadowPermanent: false,
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
