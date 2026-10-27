/**
 * ============================================
 * 音乐插件数据 API（模拟请求层）
 * ============================================
 * 接口路径与真实接口一致；后续接入真实接口时仅需替换返回值为 HTTP 请求。
 * 插件本身的 UI 不直接依赖本模块——宿主可通过 config.data 注入数据快照，
 * 本模块只在未注入数据时用于兜底。
 */

import type { MusicDetail, MusicVideoItem, RecommendItem } from "./types";
import { mockMusicDetail, mockRecommendList, mockVideoList } from "./mock";

/**
 * 模拟网络延迟
 *
 * @param ms - 延迟毫秒数
 * @returns 延迟结束的 Promise
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 深拷贝模拟数据，避免调用方修改污染源头
 *
 * @param value - 待拷贝数据
 * @returns 拷贝结果
 */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/** 详情接口参数（接口 /x/copyright-music-publicity/bgm/detail） */
export interface FetchDetailParams {
  music_id: string;
  relation_from?: string;
}

/**
 * 获取音乐详情（模拟）
 *
 * @param _params - 详情参数
 * @returns 音乐详情
 */
export async function fetchMusicDetail(
  _params: FetchDetailParams,
): Promise<{ data: MusicDetail }> {
  await sleep(400);
  return { data: clone(mockMusicDetail) };
}

/**
 * AB 实验接口（接口 /x/copyright-music-publicity/bgm/ab/test，模拟返回空配置）
 *
 * @param _params - 实验参数
 * @returns 空配置
 */
export async function fetchAbTest(
  _params: FetchDetailParams,
): Promise<Record<string, never>> {
  await sleep(200);
  return {};
}

/** 音乐视频列表接口参数（接口 /x/copyright-music-publicity/bgm/recommend_list） */
export interface FetchVideoListParams {
  music_id: string;
  aid?: string;
}

/**
 * 获取音乐相关视频列表（模拟）
 *
 * @param _params - 列表参数
 * @returns 视频列表
 */
export async function fetchMusicVideoList(
  _params: FetchVideoListParams,
): Promise<{ data: { list: MusicVideoItem[] } }> {
  await sleep(500);
  return { data: { list: clone(mockVideoList) } };
}

/**
 * 获取小编推荐 banner（接口 /x/web-show/res/locs，ids=4979）
 *
 * @returns 推荐位数据
 */
export async function fetchRecommendList(): Promise<{
  data: Record<string, RecommendItem[]>;
}> {
  await sleep(600);
  return { data: { "4979": clone(mockRecommendList) } };
}

/** 更新想听状态参数（接口 /x/copyright-music-publicity/bgm/wish/update） */
export interface UpdateWishParams {
  music_id: string;
  /** 1 想听 2 取消想听 */
  state: number;
}

/**
 * 更新想听状态（模拟，本地同步修改 mock 数据）
 *
 * @param params - 更新参数
 */
export async function updateWish(params: UpdateWishParams): Promise<void> {
  await sleep(300);
  mockMusicDetail.wish_listen = params.state === 1;
  mockMusicDetail.wish_count += params.state === 1 ? 1 : -1;
}

/** 分享上报参数（接口 /x/copyright-music-publicity/app/log） */
export interface ReportShareParams {
  type: number;
  music_id: string;
}

/**
 * 分享行为上报（模拟，不真正上报）
 *
 * @param _params - 上报参数
 */
export async function reportShareLog(_params: ReportShareParams): Promise<void> {
  await sleep(100);
}
