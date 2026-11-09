/**
 * ============================================
 * 互动组件类型定义
 * ============================================
 * 定义 RowCmd 组件所需的所有类型和接口
 */

/**
 * 互动卡片类型
 */
export type CardType = 'guideThree' | 'link' | 'vote' | 'score';

/**
 * 位置事件
 */
export interface PositionEvent {
  type: CardType;
  index: number;
  top: number;
  left: number;
}

/**
 * 互动类型
 */
export type InteractionType = 1 | 2 | 3;

/**
 * 互动选项接口
 */
export interface InteractionOptions<T> {
  get: (index?: number, subIndex?: number) => T[] | T;
  add: (value: T, index?: number) => void;
  remove: (index?: number, subIndex?: number) => void;
  update: (index: number, value: T, subIndex?: number) => void;
}

/**
 * 投票选项
 */
export interface VoteOption {
  element?: HTMLDivElement;
  id?: number;
  voteid?: number;
  optionText: string;
  anvoteCount: number;
}

/**
 * 互动点赞关注
 */
export interface InteractionGuideThree {
  element?: HTMLDivElement;
  id?: number;
  vid?: number;
  uid?: number;
  left?: number;
  top?: number;
  type?: InteractionType;
  timeStart?: number;
  timeEnd?: number;
}

/**
 * 互动外链视频
 */
export interface InteractionLink {
  element?: HTMLDivElement;
  id?: number;
  vid?: number;
  uid?: number;
  left?: number;
  top?: number;
  link_url?: string;
  link_content?: string;
  timeStart?: number;
  timeEnd?: number;
  isClose?: boolean;
  closeTime?: number;
}

/**
 * 互动投票
 */
export interface InteractionVote {
  element?: HTMLDivElement;
  id?: number;
  vid?: number;
  uid?: number;
  left: number;
  top: number;
  question?: string;
  timeStart?: number;
  timeEnd?: number;
  isClose?: boolean;
  closeTime?: number;
  voteOptions?: VoteOption[];
}

/**
 * 互动评分
 */
export interface InteractionScore {
  element?: HTMLDivElement;
  id?: number;
  vid?: number;
  uid?: number;
  left?: number;
  top?: number;
  scoreType: InteractionType;
  title?: string;
  timeStart?: number;
  timeEnd?: number;
  isClose?: boolean;
  closeTime?: number;
}

/**
 * 互动卡片集合
 */
export interface InteractionCard {
  guideList: InteractionGuideThree[];
  linkList: InteractionLink[];
  voteList: InteractionVote[];
  scoreList: InteractionScore[];
}

/**
 * 智能合并结果（工具层契约，实现在 @lumina/framework/utils/smartMerge）
 */
export type { MergeResult } from '@lumina/framework/utils/smartMerge';
