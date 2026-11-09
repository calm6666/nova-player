/**
 * ============================================
 * 互动组件默认配置
 * ============================================
 * 提供互动卡片的默认配置
 */

import type { InteractionGuideThree, InteractionLink, InteractionScore, InteractionVote, VoteOption } from '../types';

/**
 * 点赞关注默认配置
 */
const guideThreeConfig: InteractionGuideThree = {
  element: undefined,
  left: 50,
  top: 50,
  type: 1,
  timeStart: 0,
  timeEnd: 5,
};

/**
 * 外链视频默认配置
 */
const linkConfig: InteractionLink = {
  element: undefined,
  left: 50,
  top: 50,
  timeStart: 0,
  timeEnd: 5,
  link_url: '',
  link_content: '',
  closeTime: 0,
  isClose: false,
};

/**
 * 投票默认配置
 */
const voteConfig: InteractionVote = {
  element: undefined,
  left: 50,
  top: 50,
  timeStart: 0,
  timeEnd: 5,
  question: '',
  closeTime: 0,
  isClose: false,
  voteOptions: [
    { optionText: '', anvoteCount: 0 },
    { optionText: '', anvoteCount: 0 },
  ],
};

/**
 * 投票选项默认配置
 */
const subVoteConfig: VoteOption = {
  element: undefined,
  optionText: '',
  anvoteCount: 0,
};

/**
 * 评分默认配置
 */
const scoreConfig: InteractionScore = {
  element: undefined,
  left: 50,
  top: 50,
  scoreType: 1,
  timeStart: 0,
  timeEnd: 5,
  title: '',
  closeTime: 0,
  isClose: false,
};

export default {
  guideThreeConfig,
  linkConfig,
  voteConfig,
  subVoteConfig,
  scoreConfig,
};
