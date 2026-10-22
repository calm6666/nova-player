/**
 * Demo 播放器 SSR 配置
 *
 * 服务端与客户端必须使用完全相同的 PlayerConfig 才能 hydrate。
 * 这里的配置包含全部“结构 / 设置”项（播放、UI、国际化、跳过片头片尾等）；
 * 分段、高能曲线、插件属于运行期数据，客户端水合后通过 API 注入。
 */

import { VideoPlayer } from "@/nova/player";
import type { PlayerConfig } from "@/types";
import zhCN from "@/locales/zh-CN.json";
import enUS from "@/locales/en-US.json";

export const DEMO_SSR_SOURCE = "/sample.mp4";
export const DEMO_SSR_TITLE = "赶集买了几只牛蛙，好久没吃了，立马安排...";

/** SSR / 水合共用配置：服务端与客户端对象结构完全一致 */
export const DEMO_SSR_PLAYER_CONFIG: PlayerConfig = {
  src: DEMO_SSR_SOURCE,
  playback: {
    autoplay: true,
    muted: true,
    volume: 0.3,
  },
  progress: {
    skipPoints: { introEnd: 2, outroStart: 4 },
    shadowPermanent: false,
  },
  interaction: {
    keyboard: true,
  },
  ui: {
    title: DEMO_SSR_TITLE,
    scene: "station",
    // 与 entry-client 的 demo 默认值保持一致
    topStyle: "default",
    embedded: {
      title: DEMO_SSR_TITLE,
      stats: { like: 3537, comment: 19 },
      up: {
        name: "小梅vlog",
        face:
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#00b4d8"/><text x="48" y="58" font-size="32" text-anchor="middle" fill="#1a1a2e">UP</text></svg>',
          ),
        followed: true,
      },
      related: [],
      enterUrl: "https://www.bilibili.com/",
      downloadUrl: "https://www.bilibili.com/",
    },
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
