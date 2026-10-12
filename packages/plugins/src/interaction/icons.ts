/**
 * ============================================
 * 交互插件图片资源与主题色映射
 * ============================================
 * 集中持有评分卡片 / 缩小条目所需的静态图片 URL 导入与
 * 「评分类型 → 图标对 / 主题色」「卡片类型 → 缩小条目图标与标题」映射，
 * 供 ScoreCard / ScoreSumCard / ShrinkBar / 插件主流程共用
 *
 * 图片均为 Vite 静态资源导入（小图自动内联为 data URL，
 * 构建后无外部资源依赖）
 */

import type { CardType } from "./types";

// ============================================
// 评分图标（描边版 off / 填充版 on）
// ============================================

import fivePointedStarIcon from "./images/five-pointed-star.png";
import fivePointedStarFillIcon from "./images/five-pointed-star-fill.png";
import heartIcon from "./images/heart.png";
import heartFillIcon from "./images/heart-fill.png";
import lemonIcon from "./images/lemon.png";
import lemonFillIcon from "./images/lemon-fill.png";

// ============================================
// 缩小条目图标
// ============================================

import linkVideoIcon from "./images/link-video.png";
import voteIcon from "./images/vote.png";
import scoreIcon from "./images/score.png";

/** 单个评分图标的 on（填充）/ off（描边）图片对 */
export interface ScoreIconPair {
  on: string;
  off: string;
}

/**
 * 按评分类型取图标对（1 = 星星，2 = 爱心，3 = 柠檬，默认星星）
 * @param scoreType - 评分图标类型
 */
export function getScoreIconPair(scoreType: number): ScoreIconPair {
  switch (scoreType) {
    case 2:
      return { on: heartFillIcon, off: heartIcon };
    case 3:
      return { on: lemonFillIcon, off: lemonIcon };
    default:
      return { on: fivePointedStarFillIcon, off: fivePointedStarIcon };
  }
}

/**
 * 按评分类型取主题色（评分数字 / 结果平均分文本颜色）
 * 颜色与对应填充版图标的主色保持一致：
 * - 星星：填充橙黄 #ffb027
 * - 爱心：填充红 #FA5555
 * - 柠檬：填充柠檬黄 #F7DC6F
 * @param scoreType - 评分图标类型
 */
export function getScoreThemeColor(scoreType: number): string {
  switch (scoreType) {
    case 2:
      return "#FA5555";
    case 3:
      return "#F7DC6F";
    default:
      return "#ffb027";
  }
}

/** 缩小条目的图标与标题映射 */
export interface ShrinkMeta {
  icon: string;
  title: string;
}

/** 缩小条目图标 / 标题按卡片类型的映射表（guideThree 无关闭概念不参与） */
const SHRINK_META_MAP: Partial<Record<CardType, ShrinkMeta>> = {
  link: { icon: linkVideoIcon, title: "推荐" },
  vote: { icon: voteIcon, title: "投票" },
  score: { icon: scoreIcon, title: "推荐" },
  scoreSum: { icon: scoreIcon, title: "推荐" },
};

/**
 * 按卡片类型取缩小条目图标与标题
 * link → link-video 图标 +「推荐」；vote → vote 图标 +「投票」；
 * score / scoreSum → score 图标 +「推荐」；guideThree 兜底同 score
 * @param type - 被关闭卡片的类型
 */
export function getShrinkMeta(type: CardType): ShrinkMeta {
  const meta = SHRINK_META_MAP[type];
  if (meta !== undefined) return meta;
  // guideThree 理论不可达（无关闭概念），防御式兜底
  return { icon: scoreIcon, title: "推荐" };
}
