/**
 * 交互插件类型定义
 * 与既有实现 types/interaction.ts 保持一致
 */

import type { Signal } from "@/core";

/** 互动类型 */
export type InteractionType = 1 | 2 | 3;

/** 互动卡片类型 */
export type CardType = 'guideThree' | 'link' | 'vote' | 'score';

/** 互动模式 */
export type InteractionMode = 'guide' | 'link' | 'vote' | 'score';

/** 位置事件 */
export interface PositionEvent {
  type: CardType;
  index: number;
  top: number;
  left: number;
}

/** 投票选项 */
export interface VoteOption {
  optionText: string;
  votes?: number;
}

/** 点赞关注配置 */
export interface InteractionGuideThree {
  type?: 1 | 2 | 3;
  top: number;
  left: number;
  timeStart?: number;
  timeEnd?: number;
  element?: HTMLDivElement;
}

/** 外链视频配置 */
export interface InteractionLink {
  top: number;
  left: number;
  /** 外链文案 */
  linkContent?: string;
  timeStart?: number;
  timeEnd?: number;
  closeTime?: number;
  isClose?: boolean;
  element?: HTMLDivElement;
}

/** 投票配置 */
export interface InteractionVote {
  top: number;
  left: number;
  question: string;
  options: VoteOption[];
  timeStart?: number;
  timeEnd?: number;
  closeTime?: number;
  isClose?: boolean;
  element?: HTMLDivElement;
}

/** 评分配置 */
export interface InteractionScore {
  top: number;
  left: number;
  title: string;
  scoreType: InteractionType;
  timeStart?: number;
  timeEnd?: number;
  closeTime?: number;
  isClose?: boolean;
  element?: HTMLDivElement;
}

/** 互动卡片集合 */
export interface InteractionCard {
  guideList: InteractionGuideThree[];
  linkList: InteractionLink[];
  voteList: InteractionVote[];
  scoreList: InteractionScore[];
}

/**
 * 卡片内容编辑补丁（updateCardContent 的入参）
 *
 * 按卡片类型提供对应字段，未提供的字段保持原值：
 * - 文本字段（linkContent / question / optionTexts 等长 / title）：
 *   原地更新 + contentVersion 自增 → 渲染层响应式文本精准更新 DOM
 * - 结构字段（guideType / scoreType / optionTexts 变长）：
 *   条目按新数据重建（类名/图标/选项行数为渲染期静态结构）
 */
export interface CardContentPatch {
  /** guideThree：卡片形态（1=三连+关注 2=仅三连 3=仅关注） */
  guideType?: 1 | 2 | 3;
  /** link：外链文案 */
  linkContent?: string;
  /** vote：问题文案 */
  question?: string;
  /** vote：全部选项文案（长度变化触发条目重建） */
  optionTexts?: string[];
  /** score：标题文案 */
  title?: string;
  /** score：图标类型（触发条目重建） */
  scoreType?: InteractionType;
  /**
   * 时间窗起点（秒，四类卡片通用）：
   * 更新后按当前播放时间立即重算窗口归属（入窗即刻创建显示 /
   * 出窗即刻淡出移除），编辑/展示两种模式同一口径
   */
  timeStart?: number;
  /** 时间窗终点（秒，四类卡片通用），同 timeStart 的同步语义 */
  timeEnd?: number;
  /** 顶部定位（百分比，四类卡片通用）：定位为渲染期静态 style，变更触发条目重建 */
  top?: number;
  /** 左侧定位（百分比，四类卡片通用），同 top 的重建语义 */
  left?: number;
}

/**
 * 活跃卡片条目
 *
 * 响应式渲染的最小数据单元：插件按时间窗口把命中的卡片包装为条目
 * 写入对应类型的 signal 数组，For 控制流按 id 精准创建/删除 DOM。
 * 条目移除即 DOM 销毁，下次进入窗口重新创建并重播音入过渡。
 */
export interface ActiveCardEntry<T> {
  /** For 的稳定 key：类型前缀 + 列表下标（如 "link:0"） */
  id: string;
  /** 卡片在原始数据列表中的下标（事件回传 payload 使用） */
  listIndex: number;
  /** 原始卡片数据（时间范围/定位/业务字段） */
  item: T;
  /** 是否显示（驱动 .nova-danmaku-x-show 过渡类） */
  show: Signal<boolean>;
  /** 关闭环剩余比例（1 = 满环 → 0 = 空环），guide 卡片不消费 */
  remaining: Signal<number>;
  /**
   * 内容版本号（文本类内容编辑的响应式驱动源）
   * 渲染层文本 getter 读取该信号建立依赖，updateCardContent
   * 修改文本后自增版本号 → 文本节点精准更新（无需重建 DOM）
   */
  contentVersion: Signal<number>;
  /** 淡出过渡结束后移除 DOM 的定时器句柄（幂等防重入） */
  removeTimer: number | null;
  /** 编辑模式拖拽绑定的清理函数（条目移除时调用） */
  dragCleanup: (() => void) | null;
}

/**
 * 互动插件运行模式
 * - 'interactive'：展示模式（默认），卡片按时间窗口显隐，注册全部交互监听
 *   （点赞/投币/收藏/关注/投票/评分/关闭/跳链），关闭按钮点击即关闭
 * - 'edit'：编辑模式，全部卡片常驻显示供拖拽定位，注册拖拽与位置上报，
 *   不注册任何点击/投票/评分/关闭监听（关闭按钮仅渲染不可点）
 */
export type InteractionPluginMode = 'interactive' | 'edit';

/** 互动插件配置 */
export interface InteractionPluginConfig {
  /** 运行模式（默认 'interactive' 展示模式） */
  mode?: InteractionPluginMode;
  /** 初始数据 */
  data?: Partial<InteractionCard>;
  /** 位置变更回调 */
  onPositionChange?: (event: PositionEvent) => void;
  /** 卡片关闭回调 */
  onCardClose?: (type: CardType, index: number) => void;
  /** 点赞回调 */
  onLike?: () => void;
  /** 投币回调 */
  onCoin?: () => void;
  /** 收藏回调 */
  onCollect?: () => void;
  /** 关注回调 */
  onFollow?: () => void;
  /** 链接点击回调 */
  onLinkClick?: (link: InteractionLink) => void;
  /** 投票选择回调 */
  onVoteSelect?: (voteIndex: number, optionIndex: number) => void;
  /** 评分选择回调 */
  onScoreSelect?: (scoreIndex: number, value: number) => void;
}
