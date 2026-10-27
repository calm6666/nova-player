/**
 * ============================================
 * 音乐详情插件类型定义（MusicDetailPlayer 移植）
 * ============================================
 * 数据结构与原 BiliMusic.umd.min.js 保持一致；
 * 仅承载纯类型与运行时枚举，不含任何视图 / 框架依赖。
 */

/** 歌手认证类型 */
export enum IdentifyType {
  /** 无认证 */
  No = -1,
  /** 个人认证（黄色闪电） */
  Self = 0,
  /** 机构认证（蓝色闪电） */
  Company = 1,
}

/** 视频标签值 */
export enum LabelValue {
  IsTop = 1,
  Other = 2,
  /** 同音乐视频 */
  SameMusic = 3,
  Zone = 4,
  IsHot = 5,
  MustWatchWeekly = 6,
  MustWatchEntry = 7,
}

/** 是否为虚拟歌手（VT）视频 */
export enum VtStatus {
  Not = 0,
  Is = 1,
}

/** 榜单类型 */
export enum RankListType {
  /** 新歌热榜 */
  Hot = 1,
  /** 二创榜单 */
  Recreation = 3,
}

/** 分享上报类型 */
export enum ReportType {
  None = 0,
  Share = 1,
  RcmdShow = 2,
  RcmdClick = 3,
}

/** 展示位置 */
export enum PositionId {
  PlayerHalfScreen = "1",
  TopicTag = "3",
  PlayerFullScreen = "2",
  AllScreen = "4",
  Story = "6",
}

/** 页面来源 */
export enum SourceId {
  PlayerHalfScreen = "1",
  TopicTag = "3",
  PlayerFullScreen = "2",
  Story = "6",
  Rank = "7",
  MusicCenter = "8",
  SearchAllScreen = "11",
  FromMsg = "12",
  FromMsgShare = "14",
  FromLegend = "16",
  H5Share = "109",
  PCShare = "209",
}

/** 歌手信息 */
export interface Singer {
  /** 用户 id */
  mid: number;
  /** 歌手名 */
  name: string;
  /** 认证身份描述 */
  identity: string;
  /** 认证类型 */
  identify_type: IdentifyType;
  /** 头像地址 */
  face: string;
}

/** 音乐详情数据（接口 /x/copyright-music-publicity/bgm/detail 返回） */
export interface MusicDetail {
  /** 音乐 id */
  music_id: string;
  /** 音乐标题 */
  music_title: string;
  /** MV 封面 */
  mv_cover: string;
  /** 原唱列表（逗号分隔） */
  origin_artist_list: string;
  /** 专辑 */
  album: string;
  /** 音乐出处 */
  music_source: string;
  /** 播放次数 */
  listen_pv: number;
  /** 榜单名（如「新歌榜第3名」） */
  music_rank: string;
  /** 二创榜单名 */
  recreation_rank: string;
  /** 对应榜单 id */
  max_list_id: number;
  /** 对应二创榜单 id */
  max_recreation_list_id: number;
  /** 是否已想听 */
  wish_listen: boolean;
  /** 想听人数 */
  wish_count: number;
  /** MV 视频 aid */
  mv_aid: number;
  /** MV 视频 bvid */
  mv_bvid: string;
  /** MV 分 P 序号 */
  mv_index_order: number;
  /** 流控属性 */
  flow_attr: { no_share: boolean };
  /** 接口原始歌手列表 */
  artists_list?: Singer[];
  /** 有 mid 的歌手（由 detail 数据加工） */
  midSingers: Singer[];
  /** 无 mid 的歌手（由 detail 数据加工） */
  noMidSingers: Singer[];
}

/** 音乐视频标签 */
export interface VideoLabel {
  value: LabelValue;
  name: string;
}

/** 音乐视频卡片数据（接口 /x/copyright-music-publicity/bgm/recommend_list 返回项） */
export interface MusicVideoItem {
  aid: number;
  bvid: string;
  title: string;
  cover: string;
  play: number;
  danmu: number;
  is_vt: VtStatus;
  /** VT 视频时长文案 */
  vt_display: string;
  up_nick_name: string;
  mid: number;
  label_list?: VideoLabel[];
  /** 分 P 序号 */
  index_order: number;
}

/** 小编推荐 banner 数据（接口 /x/web-show/res/locs 返回项） */
export interface RecommendItem {
  /** 展示位置序号 */
  pos_num: number;
  /** 跳转链接 */
  url: string;
  /** 图片地址 */
  pic: string;
}

/** 榜单跳转参数 */
export interface RankJumpParams {
  /** 榜单名文案 */
  value: string;
  list_type: RankListType;
  list_id: number;
  position_id: number;
}

/** 分享渠道 id */
export type ShareChannelId =
  | "dynmic"
  | "weixin"
  | "qq"
  | "qzone"
  | "weibo"
  | "link";

/** 分享渠道配置 */
export interface ShareChannel {
  id: ShareChannelId;
  /** 渠道文案 */
  text: string;
  /** 埋点渠道名 */
  reportId: string;
}

/** 分享内容 */
export interface ShareContent {
  title: string;
  desc: string;
  pics: string;
  link: string;
  share_id: string;
  oid: string;
}

/** pc 回调（播放器场景下由宿主注入） */
export interface PcCallback {
  /** 跳转类型：1 登录 2 前往播放器 */
  onJump?: (type: number) => void;
  /** 关闭面板 */
  onClose?: () => void;
}

/** 插件侧音乐数据快照（宿主可同步注入，避免挂载期二次请求） */
export interface MusicPluginData {
  /** 音乐详情（缺省时由插件内模拟接口拉取） */
  detail?: MusicDetail;
  /** 音乐相关视频列表 */
  videoList?: MusicVideoItem[];
  /** 小编推荐 banner */
  recommendList?: RecommendItem[];
}
