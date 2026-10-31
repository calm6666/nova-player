import type { PlayerConfig } from "@/types";
import type { ControlsConfig } from "@/nova/types";
import { PlayMode } from "@/types";
import { LogLevel } from "@/utils";

/**
 * 默认控件开关
 *
 * 说明：此处是控件开关的**唯一默认值来源**，供 `defaultConfig.ui.controls`
 * 与运行时 `defaultControlConfig` 转发使用，避免两处默认值漂移。
 */
export const defaultControlConfig: ControlsConfig = {
  prev: true,
  next: true,
  viewpoint: false,
  quality: true,
  // 选集按钮：普通模式由 CSS 隐藏（visibility/width），仅网页全屏 / 全屏
  // 且播放列表长度 > 1 时显示；此处是「控件总开关」，默认必须开启，
  // 否则 display:none 会在全屏下也把按钮整个禁掉（选集永远不可见）
  episodes: true,
  setting: true,
  pip: true,
  wideScreen: true,
  webFullscreen: true,
};

/**
 * 默认配置（命名空间形态）
 *
 * 注意：所有嵌套对象（playback / ui / danmaku / subtitle / plugins / storage /
 * ssr / advanced 等）都必须写全默认值。合并由 `mergePlayerConfig()` 做深度合并
 * （见 config/mergeConfig.ts），用户只传部分字段时，同层其余默认值会被保留。
 *
 * progress.segments 默认为空数组：不要放占位分段，
 * 否则会在进度条上渲染出一个并不存在的分段。
 */
const defaultConfig: PlayerConfig = {
  // ── 顶层资源 ──
  container: undefined,
  src: "",
  poster: "",

  // ── 播放行为 ──
  playback: {
    autoplay: false,
    muted: false,
    volume: 1,
    playbackRate: 1,
    loop: false,
    skipIntroOutro: false,
    playMode: PlayMode.ORDER,
    preload: "metadata",
    playsinline: true,
    startTime: 0,
  },

  // ── 播放列表 ──
  playlist: [],
  playlistIndex: 0,

  // ── 外观与控件 ──
  ui: {
    title: "Nova Player",
    scene: "station",
    endingStyle: "standard",
    // 容器阴影开关：false = 不添加 state-disable-box-shadow 类名（显示阴影）
    disableBoxShadow: false,
    controls: defaultControlConfig,
  },

  // ── 交互 ──
  interaction: {
    keyboard: true,
  },

  // ── 清晰度 ──
  quality: {
    default: "auto",
    mode: "auto",
  },

  // ── 进度条 ──
  progress: {
    segments: [],
  },

  // ── 字幕 ──
  subtitle: {
    enabled: false,
    list: [],
  },

  // ── 插件 ──
  plugins: {
    list: [],
    options: {},
  },

  // ── 持久化 ──
  storage: {
    enabled: true,
    prefix: "nova-player:",
  },

  // ── 高级 ──
  advanced: {
    debug: false,
    logLevel: LogLevel.SILENT,
  },

  // ── 回调 ──
  callbacks: {},
};

export default defaultConfig;
