/**
 * ============================================
 * Music 插件入口
 * ============================================
 * 播放器音乐详情面板（Solid MusicDetailPlayer 的 Lumina 移植版）。
 */

export { MusicPlugin, createMusicPlugin } from "./MusicPlugin";
export type {
  MusicPluginConfig,
  MusicPluginAPI,
  MusicPluginTarget,
} from "./MusicPlugin";
export { MusicView } from "./MusicView";
export type { MusicViewProps } from "./MusicView";
export { MusicDetailInfo } from "./MusicDetailInfo";
export type { MusicDetailInfoProps } from "./MusicDetailInfo";
export { MusicVideoCardList } from "./MusicVideoCardList";
export type { MusicVideoCardListProps } from "./MusicVideoCardList";
export {
  musicTheme,
  setMusicTheme,
  getTheme,
} from "./theme";
export type { ThemeMode } from "./theme";
export { formatCount, toast, copyText } from "./format";
export {
  mockMusicDetail,
  mockVideoList,
  mockRecommendList,
} from "./mock";
export {
  IdentifyType,
  LabelValue,
  VtStatus,
  RankListType,
  ReportType,
  PositionId,
  SourceId,
} from "./types";
export type {
  MusicDetail,
  MusicPluginData,
  MusicVideoItem,
  RecommendItem,
  Singer,
  VideoLabel,
  PcCallback,
  ShareChannel,
  ShareChannelId,
  ShareContent,
  RankJumpParams,
} from "./types";
