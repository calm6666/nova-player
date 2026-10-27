/**
 * ============================================
 * 音乐插件模拟数据
 * ============================================
 * 数据结构与真实接口保持一致；demo 可直接把这些数据经插件 config.data 注入，
 * 也可由插件内置模拟 API 拉取（未注入时的兜底路径）。
 */

import {
  IdentifyType,
  LabelValue,
  VtStatus,
  type MusicDetail,
  type MusicVideoItem,
  type RecommendItem,
  type Singer,
} from "./types";
import coverUrl from "./assets/cover.jpg";
import face01Url from "./assets/face-01.jpg";
import face02Url from "./assets/face-02.jpg";
import video01Url from "./assets/video-01.jpg";
import video02Url from "./assets/video-02.jpg";

/** 有 mid 的歌手（模拟） */
const mockMidSingers: Singer[] = [
  {
    mid: 189902,
    name: "晚晴要唱歌",
    identity: "音乐区优质UP主",
    identify_type: IdentifyType.Self,
    face: face01Url,
  },
  {
    mid: 356021,
    name: "白夜工作室",
    identity: "官方认证音乐机构",
    identify_type: IdentifyType.Company,
    face: face02Url,
  },
];

/** 无 mid 的歌手（模拟，仅展示名字） */
const mockNoMidSingers: Singer[] = [
  {
    mid: 0,
    name: "陈屿",
    identity: "",
    identify_type: IdentifyType.No,
    face: "",
  },
];

/** 音乐详情（模拟） */
export const mockMusicDetail: MusicDetail = {
  music_id: "29668340001",
  music_title: "晚风信笺",
  mv_cover: coverUrl,
  origin_artist_list: "晚晴要唱歌,陈屿",
  album: "晚风信笺(单曲)",
  music_source: "音乐综艺《舞台上的夏天》第3期",
  listen_pv: 2345600,
  music_rank: "新歌榜第3名",
  recreation_rank: "",
  max_list_id: 39,
  max_recreation_list_id: 0,
  wish_listen: false,
  wish_count: 12856,
  mv_aid: 113542039911902,
  mv_bvid: "BV1xJ411s7mp",
  mv_index_order: 1,
  flow_attr: { no_share: false },
  artists_list: [...mockMidSingers, ...mockNoMidSingers],
  midSingers: mockMidSingers,
  noMidSingers: mockNoMidSingers,
};

/** 音乐视频列表（模拟，7 条，含各类标签） */
export const mockVideoList: MusicVideoItem[] = [
  {
    aid: 113542039911902,
    bvid: "BV1xJ411s7mp",
    title: "【晚风信笺】官方 MV：把想说的话都写进晚风里",
    cover: video01Url,
    play: 3862300,
    danmu: 12483,
    is_vt: VtStatus.Not,
    vt_display: "",
    up_nick_name: "白夜工作室",
    mid: 356021,
    label_list: [{ value: LabelValue.IsTop, name: "官方" }],
    index_order: 1,
  },
  {
    aid: 113599038822773,
    bvid: "BV1sZ421u7te",
    title: "翻唱晚风信笺,耳机党福利,人声直击天灵盖",
    cover: video02Url,
    play: 526700,
    danmu: 8291,
    is_vt: VtStatus.Not,
    vt_display: "",
    up_nick_name: "晚晴要唱歌",
    mid: 189902,
    label_list: [{ value: LabelValue.SameMusic, name: "同曲" }],
    index_order: 1,
  },
  {
    aid: 113610045533884,
    bvid: "BV1pT421V8kf",
    title: "晚风信笺钢琴改编|深夜练琴第 102 天,弹给晚睡的你",
    cover: video01Url,
    play: 98200,
    danmu: 1563,
    is_vt: VtStatus.Not,
    vt_display: "",
    up_nick_name: "钢琴上的鱼",
    mid: 412335,
    index_order: 1,
  },
  {
    aid: 113625077744995,
    bvid: "BV1wM4m1C6ry",
    title: "【虚拟歌手】晚风信笺 AI 翻唱,这音色也太温柔了吧",
    cover: video02Url,
    play: 243100,
    danmu: 4427,
    is_vt: VtStatus.Is,
    vt_display: "3:42",
    up_nick_name: "星尘合唱团",
    mid: 598811,
    label_list: [{ value: LabelValue.Zone, name: "虚拟歌手" }],
    index_order: 1,
  },
  {
    aid: 113640022655106,
    bvid: "BV1qD421A3dn",
    title: "吉他指弹晚风信笺,一个人的黄昏音乐会",
    cover: video01Url,
    play: 65400,
    danmu: 987,
    is_vt: VtStatus.Not,
    vt_display: "",
    up_nick_name: "六弦行者",
    mid: 721190,
    index_order: 1,
  },
  {
    aid: 113655088866217,
    bvid: "BV1nX421H5wt",
    title: "【二创】把晚风信笺做成了一封真的信,寄给一年前的自己",
    cover: video02Url,
    play: 187300,
    danmu: 3215,
    is_vt: VtStatus.Not,
    vt_display: "",
    up_nick_name: "信纸与风",
    mid: 833402,
    label_list: [
      { value: LabelValue.IsHot, name: "热门" },
      { value: LabelValue.SameMusic, name: "同曲" },
    ],
    index_order: 1,
  },
  {
    aid: 113670055977328,
    bvid: "BV1vE421z9hb",
    title: "晚风信笺 8D 环绕音,闭上眼就像站在风里",
    cover: video01Url,
    play: 45200,
    danmu: 612,
    is_vt: VtStatus.Not,
    vt_display: "",
    up_nick_name: "听觉实验室",
    mid: 945518,
    index_order: 1,
  },
];

/** 小编推荐 banner（模拟，对应接口 data['4979']） */
export const mockRecommendList: RecommendItem[] = [
  {
    pos_num: 1,
    url: "https://music.bilibili.com/pc/music-center",
    pic: video01Url,
  },
  {
    pos_num: 2,
    url: "https://music.bilibili.com/pc/music-center",
    pic: video02Url,
  },
];
