/**
 * ============================================
 * 交互插件 (InteractionPlugin) — 响应式重构版
 * ============================================
 * 互动命令功能插件，通过 PlayerEventEnum 事件实现跨组件通信
 * 在 MOUNTED 时查找 .nova-player-cmd-dm-inside 容器（不自行创建容器）
 *
 * 响应式架构（Lumina 框架 Signal + For 控制流）：
 * - 4 个 For 控制流按 key（类型前缀 + 列表下标）精准创建/销毁卡片 DOM
 * - 卡片 DOM 在显示时间点前 CARD_CREATE_LEAD（0.6s，与 diffAlgorithm 的
 *   bufferTime 一致）才按需创建，默认 visibility:hidden + opacity:0，
 *   到点由 show 信号翻转 .nova-danmaku-x-show 类播放 CSS 过渡
 * - 播放越过 timeEnd（或被关闭）→ 淡出过渡结束后删除 DOM，
 *   下次进入时间窗口重新创建并重播过渡（不保留任何关键帧动画）
 * - 关闭环倒计时方向为 100% → 0：remaining 信号随播放推进从满环消隐到空环
 * - 交互状态（点赞/投票/评分）由插件持有 Map（按列表下标），跨 DOM 重建保留
 * - 时间驱动复用 diffAlgorithm（updateCardsDiff 的增量窗口 diff）
 *
 * 双模式 API（config.mode）：
 * - 'interactive'（默认，展示模式）：订阅 TIME_UPDATE 按时间窗口显隐卡片，
 *   注册全部交互监听（点赞/投币/收藏/关注/投票/评分/关闭/跳链），
 *   关闭按钮点击即关闭并回传 config 业务回调
 * - 'edit'（编辑模式）：显隐口径与展示模式完全一致（同样由 TIME_UPDATE
 *   按时间窗口驱动，到播放时间点才创建/显示，播过窗口即淡出移除），
 *   区别仅在卡片可编辑：不注册点击/关闭监听（关闭圆环仅渲染不可点），
 *   bindDragInEditMode 提供拖拽定位，贴边经 AlignLines 响应式组件绘制辅助线；
 *   POSITION_CHANGE 位置上报是编辑模式的核心输出
 *
 * 内容编辑 API（updateCardContent / removeCard）：
 * - 文本字段原地更新 + contentVersion 自增 → 响应式文本精准更新 DOM
 * - 结构字段（形态/图标/选项数量）信号化驱动 → 类名/图标/选项行
 *   按信号精准增删替换，卡片 DOM 全程复用（不销毁重建）
 * - 定位字段（top/left）为渲染期静态 style → 条目重建（唯一重建路径）
 *
 * 使用方式：
 * import { InteractionPlugin } from '@lumina/plugins';
 *
 * plugins: [
 *   InteractionPlugin({
 *     mode: 'interactive',
 *     onLike: () => console.log('liked'),
 *     onVoteSelect: (voteIndex, optionIndex) => console.log(voteIndex, optionIndex)
 *   })
 * ]
 */

import type { Plugin, PluginOptions } from "@/types/plugin";
import type { VideoPlayer } from "../../../player/src/player/VideoPlayer";
import type { PlayerEventBus } from "../../../player/src/core/plugin";
import { PlayerEventEnum } from "@/core/events";
import { h, signal, Fragment, For, mount, destroy } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";
import { updateCardsDiff } from "./diffAlgorithm";
import { isBrowser } from "@/utils";
import { injectPluginStyle } from "../utils/injectStyle";
// 交互插件样式以字符串形式内联导入（Vite `?inline`），install 时运行时注入
import interactionCss from "./interaction.scss?inline";
import type {
  CardType,
  PositionEvent,
  InteractionGuideThree,
  InteractionLink,
  InteractionVote,
  InteractionScore,
  InteractionScoreSum,
  InteractionCard,
  InteractionPluginConfig,
  InteractionPluginMode,
  ActiveCardEntry,
  ShrinkCardEntry,
  CardContentPatch,
  VoteOption,
} from "./types";
import { renderGuideCard, createGuideCardState } from "./GuideCard";
import type { GuideCardOptions, GuideCardState } from "./GuideCard";
import { renderLinkCard } from "./LinkCard";
import type { LinkCardOptions } from "./LinkCard";
import { renderVoteCard, createVoteCardState } from "./VoteCard";
import type { VoteCardOptions, VoteCardState } from "./VoteCard";
import { renderScoreCard, createScoreCardState } from "./ScoreCard";
import type { ScoreCardOptions, ScoreCardState } from "./ScoreCard";
import { renderScoreSumCard } from "./ScoreSumCard";
import type {
  ScoreSumCardOptions,
  ScoreSumSummary,
  ScoreSumSummaryItem,
} from "./ScoreSumCard";
import { renderShrinkBar } from "./ShrinkBar";
import { getShrinkMeta } from "./icons";
import { CARD_FADE_MS } from "./closeCircle";
import { bindDragInEditMode } from "./dragEditor";
import type { AlignLineBounds } from "./dragEditor";
import { createAlignLinesSignal, renderAlignLines } from "./AlignLines";
import type { AlignLinesState } from "./AlignLines";

// ============================================
// 常量
// ============================================

/**
 * 卡片提前创建的提前量（秒）
 * 与 diffAlgorithm 的 bufferTime 保持一致：播放头进入
 * [timeStart - 0.6, timeEnd] 即创建 DOM（隐藏态），
 * 到 timeStart 翻转为显示态播放淡入过渡
 */
const CARD_CREATE_LEAD = 0.6;

/** 活跃条目 id 的类型前缀（For 的 key 由前缀 + 列表下标构成） */
const ENTRY_PREFIX = {
  guideThree: "guideThree:",
  link: "link:",
  vote: "vote:",
  score: "score:",
  scoreSum: "scoreSum:",
} as const;

/** 缩小条目 id 前缀（For 的 key 由前缀 + 类型 + 列表下标构成） */
const SHRINK_ENTRY_PREFIX = "shrink:";

// ============================================
// 类型定义
// ============================================

/** 交互插件已解析配置 */
interface InteractionResolvedConfig {
  mode: InteractionPluginMode;
  data: Partial<InteractionCard>;
  onPositionChange: ((event: PositionEvent) => void) | null;
  onCardClose: ((type: CardType, index: number) => void) | null;
  onLike: (() => void) | null;
  onCoin: (() => void) | null;
  onCollect: (() => void) | null;
  onFollow: (() => void) | null;
  onLinkClick: ((link: InteractionLink) => void) | null;
  onVoteSelect: ((voteIndex: number, optionIndex: number) => void) | null;
  onScoreSelect: ((scoreIndex: number, value: number) => void) | null;
}

/**
 * 时间同步引擎对卡片数据的最小结构要求
 * （guide 卡片无 isClose/closeTime 字段，可缺省）
 */
interface SyncItem {
  timeStart?: number;
  timeEnd?: number;
  isClose?: boolean;
  closeTime?: number;
}

// ============================================
// 运行时类型谓词（For 回调入参为 unknown，用谓词收窄替代 as 断言）
// ============================================

/** 判断未知值是否为含字符串 id 的对象 */
const hasStringId = (item: unknown): item is { id: string } =>
  typeof item === "object" &&
  item !== null &&
  "id" in item &&
  typeof item.id === "string";

/** 判断未知值是否为合法的卡片类型字符串 */
const isCardType = (value: unknown): value is CardType =>
  value === "guideThree" ||
  value === "link" ||
  value === "vote" ||
  value === "score" ||
  value === "scoreSum";

/** 收窄到点赞关注条目 */
const isGuideEntry = (
  item: unknown,
): item is ActiveCardEntry<InteractionGuideThree> =>
  hasStringId(item) && item.id.startsWith(ENTRY_PREFIX.guideThree);

/** 收窄到外链条目 */
const isLinkEntry = (
  item: unknown,
): item is ActiveCardEntry<InteractionLink> =>
  hasStringId(item) && item.id.startsWith(ENTRY_PREFIX.link);

/** 收窄到投票条目 */
const isVoteEntry = (
  item: unknown,
): item is ActiveCardEntry<InteractionVote> =>
  hasStringId(item) && item.id.startsWith(ENTRY_PREFIX.vote);

/** 收窄到评分条目 */
const isScoreEntry = (
  item: unknown,
): item is ActiveCardEntry<InteractionScore> =>
  hasStringId(item) && item.id.startsWith(ENTRY_PREFIX.score);

/** 收窄到评分总结条目 */
const isScoreSumEntry = (
  item: unknown,
): item is ActiveCardEntry<InteractionScoreSum> =>
  hasStringId(item) && item.id.startsWith(ENTRY_PREFIX.scoreSum);

/** 收窄到左下角缩小条目 */
const isShrinkEntry = (item: unknown): item is ShrinkCardEntry =>
  hasStringId(item) && item.id.startsWith(SHRINK_ENTRY_PREFIX);

// ============================================
// 互动插件 API 接口
// ============================================

/** 互动插件完整 API 接口 */
export interface InteractionPluginAPI extends Plugin {
  /**
   * 添加引导卡片（时间窗与任何已有卡片重叠时拒绝添加）
   * @returns 是否添加成功（false = 时间窗重叠被拒）
   */
  addGuide(item: InteractionGuideThree): boolean;
  /**
   * 添加链接卡片（时间窗与任何已有卡片重叠时拒绝添加）
   * @returns 是否添加成功（false = 时间窗重叠被拒）
   */
  addLink(item: InteractionLink): boolean;
  /**
   * 添加投票卡片（时间窗与任何已有卡片重叠时拒绝添加）
   * @returns 是否添加成功（false = 时间窗重叠被拒）
   */
  addVote(item: InteractionVote): boolean;
  /**
   * 添加评分卡片（时间窗与任何已有卡片重叠时拒绝添加）
   * @returns 是否添加成功（false = 时间窗重叠被拒）
   */
  addScore(item: InteractionScore): boolean;
  /**
   * 添加评分总结卡片
   * 前置条件：scoreList 至少已有一张评分卡片；
   * 时间窗与任何已有卡片重叠时拒绝添加
   * @returns 是否添加成功（false = 无评分卡片或时间窗重叠被拒）
   */
  addScoreSum(item: InteractionScoreSum): boolean;
  /**
   * 查询待设置的时间窗是否与任何已有卡片重叠
   * （编辑面板在提交添加/修改前预检，重叠则 toast 提示并拒绝提交）
   *
   * @param type - 待设置卡片的类型（新增与修改均传目标类型）
   * @param index - 待设置卡片在其列表中的下标（新增传 -1 表示不在任何列表中）
   * @param timeStart - 待设置的时间窗起点（秒）
   * @param timeEnd - 待设置的时间窗终点（秒）
   * @returns true = 与某张已有卡片的时间窗重叠
   */
  wouldOverlap(
    type: CardType,
    index: number,
    timeStart: number,
    timeEnd: number,
  ): boolean;
  /** 获取容器 */
  getContainer(): HTMLElement | null;
  /** 关闭卡片 */
  closeCard(type: CardType, index: number): void;
  /** 获取状态 */
  getStatus(): InteractionCard;
  /** 更新数据 */
  updateData(data: Partial<InteractionCard>): void;
  /**
   * 编辑卡片内容（文本精准更新 / 结构字段触发条目重建）
   * 时间窗补丁（timeStart/timeEnd）会做重叠校验，重叠时拒绝应用
   * @returns 是否成功应用（false = 时间窗重叠被拒）
   */
  updateCardContent(type: CardType, index: number, patch: CardContentPatch): boolean;
  /** 从数据列表移除卡片并销毁其条目（编辑器删除语义） */
  removeCard(type: CardType, index: number): void;
}

// ============================================
// 交互插件类
// ============================================

class InteractionPluginClass implements InteractionPluginAPI {
  readonly name = "interaction";
  readonly version = "1.0.0";
  readonly description = "互动命令插件";
  readonly options?: PluginOptions;

  private container: HTMLElement | null = null;
  private dmInsideElement: HTMLElement | null = null;

  private config: InteractionResolvedConfig;
  private interactCard: InteractionCard = {
    guideList: [],
    linkList: [],
    voteList: [],
    scoreList: [],
    scoreSumList: [],
  };

  // ============================================
  // 响应式数据源：活跃条目 signal 数组（For 控制流消费）
  // 条目加入数组 = 挂载 DOM，移除 = 销毁 DOM
  // ============================================

  private guideActive = signal<ActiveCardEntry<InteractionGuideThree>[]>([]);
  private linkActive = signal<ActiveCardEntry<InteractionLink>[]>([]);
  private voteActive = signal<ActiveCardEntry<InteractionVote>[]>([]);
  private scoreActive = signal<ActiveCardEntry<InteractionScore>[]>([]);
  private scoreSumActive = signal<ActiveCardEntry<InteractionScoreSum>[]>([]);
  /**
   * 左下角缩小条目（展示模式下卡片被手动关闭后的残留条目）：
   * 进度环沿用关闭时刻的剩余比例继续倒数，归零移除；点击重开原卡片
   */
  private shrinkActive = signal<ShrinkCardEntry[]>([]);

  // ============================================
  // 交互状态（按列表下标持有，跨 DOM 重建保留：
  // 卡片淡出删除后再次进入窗口重建 DOM，投票/评分/点赞结果不丢失）
  // ============================================

  private guideStates = new Map<number, GuideCardState>();
  private voteStates = new Map<number, VoteCardState>();
  private scoreStates = new Map<number, ScoreCardState>();

  /** 响应式根（Fragment 包裹 4 个 For），uninstall 时 destroy */
  private rootVNode: VNode | null = null;

  // ============================================
  // 编辑模式状态
  // ============================================

  /** 是否编辑模式（构造时由 config.mode 派生，运行期不变） */
  private readonly isEditMode: boolean;

  /**
   * 对齐辅助线状态 signal（仅编辑模式消费：
   * mountRoot 时挂载 AlignLines 组件，拖拽贴边回调驱动显隐）
   */
  private alignLines: Signal<AlignLinesState> = createAlignLinesSignal();

  /**
   * 拖拽贴边回调：把 dragEditor 报告的边界写入辅助线 signal
   * （bounds 为 null 或某方向字段缺省时，对应线段隐藏，位置保留上次值）
   */
  private readonly handleAlignLines = (
    bounds: AlignLineBounds | null,
  ): void => {
    const prev = this.alignLines.value;
    this.alignLines.value = {
      left: bounds?.left ?? prev.left,
      right: bounds?.right ?? prev.right,
      top: bounds?.top ?? prev.top,
      bottom: bounds?.bottom ?? prev.bottom,
      leftShow: bounds?.left !== undefined,
      rightShow: bounds?.right !== undefined,
      topShow: bounds?.top !== undefined,
      bottomShow: bounds?.bottom !== undefined,
    };
  };

  /**
   * 组装编辑模式的拖拽绑定器：绑定 dragEditor + 位置回写 + 辅助线回调
   *
   * @param type - 卡片类型（位置变更事件回传 payload 使用）
   * @param index - 卡片在数据列表中的下标
   * @param item - 卡片原始数据（拖拽落点直接回写 top/left）
   */
  private makeBindDrag(
    type: CardType,
    index: number,
    item: { top: number; left: number },
  ): (el: HTMLDivElement) => () => void {
    return (el: HTMLDivElement): (() => void) =>
      bindDragInEditMode(
        el,
        (top: number, left: number): void => {
          this.handlePositionChange(type, index, item, top, left);
        },
        this.handleAlignLines,
      );
  }

  // 时间追踪（用于 diffAlgorithm 与关闭时间点记录）
  private currentTime = 0;
  private prevTime = 0;

  // 事件取消订阅
  private unsubscribers: Array<() => void> = [];

  // 事件总线引用（install 时从播放器获取，用于向总线发布互动事件）
  private eventBus: PlayerEventBus | null = null;

  constructor(config?: InteractionPluginConfig) {
    this.config = {
      mode: config?.mode ?? "interactive",
      data: config?.data ?? {},
      onPositionChange: config?.onPositionChange ?? null,
      onCardClose: config?.onCardClose ?? null,
      onLike: config?.onLike ?? null,
      onCoin: config?.onCoin ?? null,
      onCollect: config?.onCollect ?? null,
      onFollow: config?.onFollow ?? null,
      onLinkClick: config?.onLinkClick ?? null,
      onVoteSelect: config?.onVoteSelect ?? null,
      onScoreSelect: config?.onScoreSelect ?? null,
    };

    // 初始化数据
    if (config?.data) {
      this.interactCard = {
        guideList: config.data.guideList ?? [],
        linkList: config.data.linkList ?? [],
        voteList: config.data.voteList ?? [],
        scoreList: config.data.scoreList ?? [],
        scoreSumList: config.data.scoreSumList ?? [],
      };
    }

    // 模式派生（运行期只读）：后续所有分支判断统一走 isEditMode
    this.isEditMode = this.config.mode === "edit";

    this.options = undefined;
  }

  install(player: VideoPlayer): void {
    if (!isBrowser()) return;

    // 运行时注入交互插件样式：样式随插件分发，与播放器样式包彻底解耦
    // injectPluginStyle 幂等，多播放器实例共享同一样式节点
    injectPluginStyle("interaction", interactionCss);

    const events: PlayerEventBus = player.events;
    // 保存事件总线引用，供卡片交互发生时发布互动事件
    this.eventBus = player.events;

    // 公共订阅：MOUNTED 挂载响应式根（两种模式都需要）
    const unsubMounted = events.on(PlayerEventEnum.MOUNTED, (data): void => {
      if (data.container) {
        this.initAfterMounted(data.container);
      }
    });
    this.unsubscribers.push(unsubMounted);

    // 运行期后装（player.use）场景：播放器已挂载时 MOUNTED 已错过不再触发，
    // 检测到容器就地补一次初始化（initAfterMounted 幂等，重复调用无副作用）
    if (player.el) {
      this.initAfterMounted(player.el);
    }

    // 公共订阅：时间更新（两种模式同一口径）：
    // diffAlgorithm 增量同步卡片时间窗口显隐与关闭环
    // （编辑模式同样到播放时间点才创建/显示卡片；视频暂停时
    //   TIME_UPDATE 停发 → 圆环随之停住）
    const unsubTimeUpdate = events.on(
      PlayerEventEnum.TIME_UPDATE,
      (data): void => {
        this.handleTimeUpdate(data.time);
      },
    );
    this.unsubscribers.push(unsubTimeUpdate);

    // 公共订阅：位置变更转发（类型谓词收窄替代 as 断言）
    // 编辑模式下拖拽落点是核心输出，config.onPositionChange 必须收到回传
    const unsubPositionChange = events.on(
      PlayerEventEnum.INTERACTION_POSITION_CHANGE,
      (data): void => {
        if (isCardType(data.type)) {
          this.config.onPositionChange?.({
            type: data.type,
            index: data.index,
            top: data.top,
            left: data.left,
          });
        }
      },
    );
    this.unsubscribers.push(unsubPositionChange);

    // 编辑模式：不注册任何业务交互监听——编辑模式下卡片不注册点击/
    // 投票/评分/关闭监听，对应事件根本不会发出，订阅无意义
    if (this.isEditMode) return;

    // ==================== 以下订阅仅展示模式注册 ====================

    // 订阅互动事件：转发外部 config 回调（卡片交互由插件内部发布到总线）

    const unsubLike = events.on(PlayerEventEnum.INTERACTION_LIKE, (): void => {
      this.config.onLike?.();
    });
    this.unsubscribers.push(unsubLike);

    const unsubCoin = events.on(PlayerEventEnum.INTERACTION_COIN, (): void => {
      this.config.onCoin?.();
    });
    this.unsubscribers.push(unsubCoin);

    const unsubCollect = events.on(
      PlayerEventEnum.INTERACTION_COLLECT,
      (): void => {
        this.config.onCollect?.();
      },
    );
    this.unsubscribers.push(unsubCollect);

    const unsubFollow = events.on(
      PlayerEventEnum.INTERACTION_FOLLOW,
      (): void => {
        this.config.onFollow?.();
      },
    );
    this.unsubscribers.push(unsubFollow);

    // 说明：LINK_CLICK 不在总线订阅后转发——事件无 payload，link 数据无法
    // 经总线透传；config.onLinkClick 由渲染层回调直接携带卡片数据调用（见
    // renderLinkEntry），总线仅承担向外部监听者广播的职责

    const unsubVoteSelect = events.on(
      PlayerEventEnum.INTERACTION_VOTE_SELECT,
      (data): void => {
        this.config.onVoteSelect?.(data.voteIndex, data.optionIndex);
      },
    );
    this.unsubscribers.push(unsubVoteSelect);

    const unsubScoreSelect = events.on(
      PlayerEventEnum.INTERACTION_SCORE_SELECT,
      (data): void => {
        this.config.onScoreSelect?.(data.scoreIndex, data.value);
      },
    );
    this.unsubscribers.push(unsubScoreSelect);

    // 卡片关闭：类型谓词收窄替代旧实现的 as 断言
    const unsubCardClose = events.on(
      PlayerEventEnum.INTERACTION_CARD_CLOSE,
      (data): void => {
        if (isCardType(data.type)) {
          this.config.onCardClose?.(data.type, data.index);
        }
      },
    );
    this.unsubscribers.push(unsubCardClose);
  }

  uninstall(): void {
    // 取消所有事件订阅
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];

    // 释放条目级资源（移除定时器 / 拖拽绑定）并清空条目数组
    this.disposeEntries(this.guideActive);
    this.disposeEntries(this.linkActive);
    this.disposeEntries(this.voteActive);
    this.disposeEntries(this.scoreActive);
    this.disposeEntries(this.scoreSumActive);
    // 缩小条目无定时器与拖拽绑定，直接清空
    this.shrinkActive.value = [];

    // 清理交互状态
    this.guideStates.clear();
    this.voteStates.clear();
    this.scoreStates.clear();

    // 销毁响应式根（For dispose 同步销毁全部卡片 DOM 与响应式 effect）
    if (this.rootVNode !== null) {
      destroy(this.rootVNode);
      this.rootVNode = null;
    }

    this.dmInsideElement = null;
    this.container = null;
    this.eventBus = null;
    this.currentTime = 0;
    this.prevTime = 0;
  }

  // ==================== 响应式根挂载 ====================

  /**
   * MOUNTED 后初始化：定位互动容器并挂载响应式根
   *
   * 两个触发时机共用（幂等，重复调用无副作用）：
   * - MOUNTED 事件回调（随 plugins.list 在构造期注入的正常路径）
   * - install 时检测 player.el 已存在（播放器先挂载、后 player.use 的后装路径）
   *
   * @param container - 播放器容器（MOUNTED 载荷或 player.el）
   */
  private initAfterMounted(container: HTMLElement): void {
    this.container = container;
    // 查找 .nova-player-cmd-dm-inside 容器（不自行创建）
    this.dmInsideElement =
      container.querySelector(".nova-player-cmd-dm-inside") ?? null;

    if (this.dmInsideElement) {
      // 挂载响应式根（4 个 For 控制流，编辑模式追加对齐辅助线）
      this.mountRoot();
      // 显隐口径两种模式统一：卡片由 TIME_UPDATE 按播放时间窗口驱动创建，
      // 编辑模式同样到显示时间点才出现（此前编辑模式挂载即全量常驻，
      // 与展示模式行为不一致）；挂载后首个 TIME_UPDATE 完成窗口同步
    }
  }

  /**
   * 挂载响应式根：Fragment 包裹全部 For 控制流
   * For 按 key（类型前缀 + 列表下标）精准创建/销毁卡片 DOM
   * 编辑模式追加对齐辅助线（alignLines signal 驱动的响应式组件）
   */
  private mountRoot(): void {
    if (this.rootVNode !== null || this.dmInsideElement === null) return;
    // 卡片控制流（两种模式共用）+ 左下角缩小条目控制流（仅展示模式消费）
    const flows: VNode[] = [
      h(For, {
        each: this.guideActive,
        key: entryKey,
        render: this.renderGuideEntry,
      }),
      h(For, {
        each: this.linkActive,
        key: entryKey,
        render: this.renderLinkEntry,
      }),
      h(For, {
        each: this.voteActive,
        key: entryKey,
        render: this.renderVoteEntry,
      }),
      h(For, {
        each: this.scoreActive,
        key: entryKey,
        render: this.renderScoreEntry,
      }),
      h(For, {
        each: this.scoreSumActive,
        key: entryKey,
        render: this.renderScoreSumEntry,
      }),
      h(For, {
        each: this.shrinkActive,
        key: entryKey,
        render: this.renderShrinkEntry,
      }),
    ];
    // 编辑模式：追加对齐辅助线（拖拽贴边时由 handleAlignLines 写 signal 驱动显隐）
    if (this.isEditMode) {
      flows.push(renderAlignLines(this.alignLines));
    }
    this.rootVNode = h(Fragment, null, ...flows);
    mount(this.rootVNode, this.dmInsideElement);
  }

  // ==================== For 渲染回调（每 key 只调用一次） ====================

  /**
   * 渲染点赞关注卡片
   * 展示模式注册业务回调（写状态信号与发布事件，渲染层随信号自动更新）；
   * 编辑模式仅绑定拖拽（点击监听一律不注册）
   */
  private readonly renderGuideEntry = (item: unknown): VNode => {
    if (!isGuideEntry(item)) return h("div", {});
    const { listIndex, item: card } = item;
    // 状态按列表下标获取/创建，跨 DOM 重建保留
    const state =
      this.guideStates.get(listIndex) ??
      createGuideCardState(card.type ?? 1);
    this.guideStates.set(listIndex, state);

    // 编辑模式：仅传 bindDrag（业务回调缺省 → 点击监听不注册）
    if (this.isEditMode) {
      return renderGuideCard(item, state, {
        bindDrag: this.makeBindDrag("guideThree", listIndex, card),
      });
    }

    const options: GuideCardOptions = {
      onLike: (): void => {
        // 切换激活态（对齐旧实现的 classList.toggle 语义）
        state.likeActive.value = !state.likeActive.value;
        this.eventBus?.emit(PlayerEventEnum.INTERACTION_LIKE);
      },
      onCoin: (): void => {
        state.coinActive.value = !state.coinActive.value;
        this.eventBus?.emit(PlayerEventEnum.INTERACTION_COIN);
      },
      onCollect: (): void => {
        state.collectActive.value = !state.collectActive.value;
        this.eventBus?.emit(PlayerEventEnum.INTERACTION_COLLECT);
      },
      onFollow: (): void => {
        // no-follow / following 互斥切换（对齐旧实现）
        state.following.value = !state.following.value;
        this.eventBus?.emit(PlayerEventEnum.INTERACTION_FOLLOW);
      },
    };
    return renderGuideCard(item, state, options);
  };

  /**
   * 渲染外链卡片
   * 展示模式注册跳链与关闭回调；编辑模式仅绑定拖拽（关闭圆环仅渲染不可点）
   */
  private readonly renderLinkEntry = (item: unknown): VNode => {
    if (!isLinkEntry(item)) return h("div", {});
    const { listIndex, item: card } = item;

    // 编辑模式：仅传 bindDrag（onClose 缺省 → 关闭圆环不注册点击）
    if (this.isEditMode) {
      return renderLinkCard(item, {
        bindDrag: this.makeBindDrag("link", listIndex, card),
      });
    }

    const options: LinkCardOptions = {
      onLinkClick: (link: InteractionLink): void => {
        // 渲染层直接携带卡片数据调用外部回调（旧实现经事件订阅转发，
        // 但 LINK_CLICK 事件无 payload，link 参数无法透传导致回调丢失）
        this.config.onLinkClick?.(link);
        // 同时向事件总线广播（供外部 on() 监听者消费，无 payload）
        this.eventBus?.emit(PlayerEventEnum.INTERACTION_LINK_CLICK);
      },
      onClose: (): void => {
        this.closeEntry("link", item, this.linkActive);
      },
    };
    return renderLinkCard(item, options);
  };

  /**
   * 渲染投票卡片
   * 展示模式注册投票与关闭回调；编辑模式仅绑定拖拽（选项点击与关闭均不注册）
   */
  private readonly renderVoteEntry = (item: unknown): VNode => {
    if (!isVoteEntry(item)) return h("div", {});
    const { listIndex, item: card } = item;
    const state =
      this.voteStates.get(listIndex) ?? createVoteCardState(card.options);
    this.voteStates.set(listIndex, state);

    // 编辑模式：仅传 bindDrag（onVoteSelect/onClose 缺省 → 监听不注册）
    if (this.isEditMode) {
      return renderVoteCard(item, state, {
        bindDrag: this.makeBindDrag("vote", listIndex, card),
      });
    }

    const options: VoteCardOptions = {
      onVoteSelect: (optionIndex: number): void => {
        // 校验未投票（信号写入同步生效，重复点击立即被拦截）
        if (state.votedIndex.value >= 0) return;
        const option = card.options[optionIndex];
        if (!option) return;
        // 累加选中选项票数（对齐旧实现：undefined 视为 0 后 +1）
        option.votes = (option.votes ?? 0) + 1;
        state.votedIndex.value = optionIndex;
        // 总票数 = 全部选项票数之和（对齐旧实现的 forEach 累加）
        state.totalVotes.value = card.options.reduce(
          (sum: number, opt: VoteOption): number => sum + (opt.votes ?? 0),
          0,
        );
        // buffer 宽度揭示由 CSS 过渡承接：投票信号写入后渲染层内联
        // 选项占比，scss transition: width 1s 从 0 平滑生长到占比
        //（选中行蓝色 / 未选行灰色由 -selected/-select 类的 CSS 驱动）
        this.eventBus?.emit(PlayerEventEnum.INTERACTION_VOTE_SELECT, {
          voteIndex: listIndex,
          optionIndex,
        });
        // 将所选答案作为弹幕发送：经 DANMAKU_SEND 事件进入弹幕插件的
        // 发送链路（按用户弹幕设置组装颜色/模式后上屏，uid=1 标记本人）
        this.eventBus?.emit(PlayerEventEnum.DANMAKU_SEND, {
          text: option.optionText,
        });
      },
      onClose: (): void => {
        this.closeEntry("vote", item, this.voteActive);
      },
    };
    return renderVoteCard(item, state, options);
  };

  /**
   * 渲染评分卡片
   * 展示模式注册评分与关闭回调；编辑模式仅绑定拖拽（评分项点击与关闭均不注册）
   */
  private readonly renderScoreEntry = (item: unknown): VNode => {
    if (!isScoreEntry(item)) return h("div", {});
    const { listIndex, item: card } = item;
    const state =
      this.scoreStates.get(listIndex) ??
      createScoreCardState(card.scoreType);
    this.scoreStates.set(listIndex, state);

    // 编辑模式：仅传 bindDrag（onScoreSelect/onClose 缺省 → 监听不注册）
    if (this.isEditMode) {
      return renderScoreCard(item, state, {
        bindDrag: this.makeBindDrag("score", listIndex, card),
      });
    }

    const options: ScoreCardOptions = {
      onScoreSelect: (value: number): void => {
        // 校验未评分（信号写入同步生效，重复点击立即被拦截）
        if (state.selected.value > 0) return;
        state.selected.value = value;
        // 对齐旧实现：总分累加、人数 +1，平均分 = 总分 / 人数
        state.totalScore.value = state.totalScore.value + value;
        state.count.value = state.count.value + 1;
        this.eventBus?.emit(PlayerEventEnum.INTERACTION_SCORE_SELECT, {
          scoreIndex: listIndex,
          value,
        });
      },
      onClose: (): void => {
        this.closeEntry("score", item, this.scoreActive);
      },
    };
    return renderScoreCard(item, state, options);
  };

  /**
   * 渲染评分总结卡片
   * 聚合数据（全部评分卡题目 / 平均分 / 总参与人数）在条目创建时
   * 计算一次并注入 signal（评分窗口与总结窗口互斥，评分行为不可能
   * 与总结卡显示同时发生，聚合值保持正确）；
   * 展示模式注册关闭回调；编辑模式仅绑定拖拽
   */
  private readonly renderScoreSumEntry = (item: unknown): VNode => {
    if (!isScoreSumEntry(item)) return h("div", {});
    const { listIndex, item: card } = item;

    // 聚合全部评分卡片：题目 + 当前平均分 + 总参与人数
    const summaryItems: ScoreSumSummaryItem[] =
      this.interactCard.scoreList.map(
        (score: InteractionScore, scoreIndex: number): ScoreSumSummaryItem => {
          const state = this.scoreStates.get(scoreIndex);
          const scoreCount = state ? state.count.value : 0;
          const totalScore = state ? state.totalScore.value : 0;
          return {
            name: score.title,
            average:
              scoreCount > 0 ? (totalScore / scoreCount).toFixed(1) : "0.0",
          };
        },
      );
    const totalCount = this.interactCard.scoreList.reduce(
      (sum: number, _score: InteractionScore, scoreIndex: number): number => {
        const state = this.scoreStates.get(scoreIndex);
        return sum + (state ? state.count.value : 0);
      },
      0,
    );
    const summary = signal<ScoreSumSummary>({
      items: summaryItems,
      count: totalCount,
    });

    // 编辑模式：仅传 bindDrag（onClose 缺省 → 关闭圆环不注册点击）
    if (this.isEditMode) {
      const editOptions: ScoreSumCardOptions = {
        bindDrag: this.makeBindDrag("scoreSum", listIndex, card),
      };
      return renderScoreSumCard(item, summary, editOptions);
    }

    const options: ScoreSumCardOptions = {
      onClose: (): void => {
        this.closeEntry("scoreSum", item, this.scoreSumActive);
      },
    };
    return renderScoreSumCard(item, summary, options);
  };

  /**
   * 渲染左下角缩小条目（仅展示模式会写入 shrinkActive）：
   * 点击条目 → 清除卡片关闭标记 → 移除条目 → 原卡片重新显示
   */
  private readonly renderShrinkEntry = (item: unknown): VNode => {
    if (!isShrinkEntry(item)) return h("div", {});
    return renderShrinkBar(item, {
      onClick: (): void => {
        this.reopenFromShrink(item);
      },
    });
  };

  // ==================== 时间更新与窗口同步 ====================

  /**
   * 处理时间更新：diffAlgorithm 增量找出受播放窗口影响的卡片，
   * 逐张同步时间窗口状态（创建/显示/刷新倒计时/淡出移除）
   */
  private handleTimeUpdate(currentTime: number): void {
    this.prevTime = this.currentTime;
    this.currentTime = currentTime;

    // 根未挂载：无从创建卡片（数据已持有，待挂载后由时间驱动）
    if (this.rootVNode === null) return;

    // 显隐口径两种模式统一：编辑模式同样按时间窗口 diff 驱动创建/显示/
    // 淡出移除（关闭环剩余比例由 syncCard 窗口内路径刷新，
    // 视频暂停时 TIME_UPDATE 停发 → 圆环随之停住，与展示模式一致）
    this.syncList(
      ENTRY_PREFIX.guideThree,
      this.interactCard.guideList,
      this.guideActive,
      currentTime,
    );
    this.syncList(
      ENTRY_PREFIX.link,
      this.interactCard.linkList,
      this.linkActive,
      currentTime,
    );
    this.syncList(
      ENTRY_PREFIX.vote,
      this.interactCard.voteList,
      this.voteActive,
      currentTime,
    );
    this.syncList(
      ENTRY_PREFIX.score,
      this.interactCard.scoreList,
      this.scoreActive,
      currentTime,
    );
    this.syncList(
      ENTRY_PREFIX.scoreSum,
      this.interactCard.scoreSumList,
      this.scoreSumActive,
      currentTime,
    );
    // 左下角缩小条目：进度环继续倒数，归零移除（或卡片被重开时移除）
    this.syncShrinkEntries();
  }

  /**
   * 对单个卡片列表执行增量 diff，受影响卡片逐张同步时间窗口状态
   *
   * updateCardsDiff 已按 [prevTime, currentTime] 时间交集过滤出受影响的
   * 卡片，此处按列表下标转发给 syncCard。
   */
  private syncList<T extends SyncItem>(
    idPrefix: string,
    list: T[],
    active: Signal<ActiveCardEntry<T>[]>,
    currentTime: number,
  ): void {
    updateCardsDiff(list, currentTime, this.prevTime, (card: T): void => {
      const listIndex = list.indexOf(card);
      if (listIndex < 0) return;
      this.syncCard(idPrefix, listIndex, card, currentTime, active);
    });
  }

  /**
   * 同步单张卡片的时间窗口状态（核心状态机）：
   * - 窗口内且无条目：创建 DOM（隐藏态）；已过 timeStart 则双 rAF 后翻转为显示态
   * - 窗口内且有条目：取消排队移除，刷新关闭环剩余比例，未显示且到点则显示
   * - 越过 timeEnd / 被关闭：翻转隐藏类播放淡出，过渡结束后删除 DOM
   * - seek 回窗口之前：直接删除（再次到点时重建重播过渡）
   *
   * @param idPrefix - 条目 id 的类型前缀（For 的 key）
   * @param listIndex - 卡片在数据列表中的下标
   * @param item - 卡片原始数据
   * @param currentTime - 当前播放时间（秒）
   * @param active - 该类型的活跃条目 signal 数组
   */
  private syncCard<T extends SyncItem>(
    idPrefix: string,
    listIndex: number,
    item: T,
    currentTime: number,
    active: Signal<ActiveCardEntry<T>[]>,
  ): void {
    const { timeStart, timeEnd } = item;
    // 时间范围不完整的卡片不参与时间驱动（对齐旧实现）
    if (timeStart === undefined || timeEnd === undefined) return;

    // seek 回关闭时间点之前：重置关闭状态，卡片可重新显示（对齐旧实现）
    if (item.closeTime !== undefined && item.closeTime > currentTime) {
      item.isClose = false;
    }
    // 已关闭且关闭时间已过：视同窗口外（关闭后不再显示）
    const closedNow =
      item.isClose === true &&
      item.closeTime !== undefined &&
      item.closeTime <= currentTime;

    // 显示窗口：[timeStart - 提前量, timeEnd]；被关闭的卡片视为出窗
    const inWindow =
      !closedNow &&
      currentTime >= timeStart - CARD_CREATE_LEAD &&
      currentTime <= timeEnd;

    /** 当前条目（未创建时为 undefined） */
    const existing = active.value.find(
      (entry: ActiveCardEntry<T>) => entry.listIndex === listIndex,
    );

    if (inWindow) {
      // 窗口内：创建（或复用）条目并刷新状态
      const entry = existing ?? this.createEntry(idPrefix, listIndex, item);
      if (existing === undefined) {
        // For 按 key 精准挂载新 DOM（默认 visibility:hidden + opacity:0）
        active.value = [...active.value, entry];
      }
      // 取消排队中的移除（seek 回窗口内：淡出中的卡片重新接管）
      this.cancelRemoval(entry);
      // 未显示且已到显示时间：双 rAF 后翻转为显示态（保证过渡可播放）
      if (!entry.show.value && currentTime >= timeStart) {
        this.scheduleShow(entry);
      }
      // 刷新关闭环剩余比例：1（满环）→ 0（空环），随播放推进消隐
      const total = timeEnd - timeStart;
      const elapsedRatio =
        total > 0 ? (currentTime - timeStart) / total : 0;
      entry.remaining.value =
        1 - Math.min(Math.max(elapsedRatio, 0), 1);
    } else if (existing !== undefined) {
      if (currentTime > timeEnd || closedNow) {
        // 播完 / 被关闭：翻转隐藏类播放淡出，过渡结束后删除 DOM
        this.scheduleRemoval(active, existing);
      } else {
        // seek 回显示窗口之前：直接删除（未展示无需过渡，再次到点重建）
        this.removeEntry(active, existing);
      }
    }
  }

  // ==================== 条目生命周期辅助 ====================

  /**
   * 创建活跃条目（不含挂载：写入 signal 数组后由 For 挂载 DOM）
   *
   * @param idPrefix - 条目 id 的类型前缀
   * @param listIndex - 卡片在数据列表中的下标
   * @param item - 卡片原始数据
   */
  private createEntry<T>(
    idPrefix: string,
    listIndex: number,
    item: T,
  ): ActiveCardEntry<T> {
    return {
      // For 的稳定 key：类型前缀 + 列表下标
      id: `${idPrefix}${listIndex}`,
      listIndex,
      item,
      // 默认隐藏：卡片根类基础态为 visibility:hidden + opacity:0，
      // show 翻转时追加 .nova-danmaku-x-show 播放过渡
      show: signal(false),
      // 关闭环满环（100%），随播放推进递减到 0（空环）
      remaining: signal(1),
      // 内容版本号：文本编辑时自增驱动响应式文本更新
      contentVersion: signal(0),
      // 选项文案版本号：optionTexts 编辑时自增（字段级细腻更新，
      // 不触发 question 等其他文本字段的响应式 effect）
      optionsVersion: signal(0),
      removeTimer: null,
      dragCleanup: null,
    };
  }

  /**
   * 双 rAF 后翻转为显示态
   *
   * 先让浏览器完成一次「隐藏态」的样式计算与绘制，再追加显示类，
   * 确保 opacity/visibility 的 CSS 过渡能被触发（元素与显示类同帧
   * 挂载时，浏览器视为初始即显示态，不播放过渡）
   */
  private scheduleShow(entry: { show: Signal<boolean> }): void {
    requestAnimationFrame((): void => {
      requestAnimationFrame((): void => {
        entry.show.value = true;
      });
    });
  }

  /** 取消排队中的移除定时器（seek 回窗口内时恢复卡片） */
  private cancelRemoval(entry: { removeTimer: number | null }): void {
    if (entry.removeTimer !== null) {
      window.clearTimeout(entry.removeTimer);
      entry.removeTimer = null;
    }
  }

  /**
   * 淡出后移除：翻转隐藏类播放淡出过渡，
   * CARD_FADE_MS（与 CSS 过渡时长一致）后删除 DOM
   * 幂等：已在移除流程中的条目跳过
   */
  private scheduleRemoval<T>(
    active: Signal<ActiveCardEntry<T>[]>,
    entry: ActiveCardEntry<T>,
  ): void {
    if (entry.removeTimer !== null) return;
    entry.show.value = false;
    entry.removeTimer = window.setTimeout((): void => {
      entry.removeTimer = null;
      this.removeEntry(active, entry);
    }, CARD_FADE_MS);
  }

  /**
   * 立即移除条目：清理定时器与拖拽绑定，
   * 从 signal 数组过滤后由 For 按 key 销毁对应 DOM
   */
  private removeEntry<T>(
    active: Signal<ActiveCardEntry<T>[]>,
    entry: ActiveCardEntry<T>,
  ): void {
    this.cancelRemoval(entry);
    entry.dragCleanup?.();
    entry.dragCleanup = null;
    const next = active.value.filter(
      (candidate: ActiveCardEntry<T>) => candidate !== entry,
    );
    if (next.length !== active.value.length) {
      active.value = next;
    }
  }

  /** 释放条目数组内全部条目的资源并清空数组 */
  private disposeEntries<T>(active: Signal<ActiveCardEntry<T>[]>): void {
    for (const entry of active.value) {
      this.cancelRemoval(entry);
      entry.dragCleanup?.();
      entry.dragCleanup = null;
    }
    active.value = [];
  }

  // ==================== 关闭与位置 ====================

  /**
   * 关闭卡片：标记关闭时间点（seek 回退可恢复）、淡出后删除 DOM、
   * 发布卡片关闭事件（外部 config.onCardClose 由 install 订阅转发）
   *
   * 展示模式下 guide 以外的卡片在关闭环未归零时被手动关闭，
   * 会在互动区左下角生成缩小条目（进度环继续倒数至归零，点击重开）；
   * 编辑模式不生成（编辑模式的关闭圆环本就不可点击）
   */
  private closeEntry<T extends SyncItem>(
    type: CardType,
    entry: ActiveCardEntry<T>,
    active: Signal<ActiveCardEntry<T>[]>,
  ): void {
    entry.item.isClose = true;
    entry.item.closeTime = this.currentTime;
    this.scheduleRemoval(active, entry);
    // 左下角缩小条目：仅展示模式 + guide 以外的卡片（guide 无关闭概念）
    if (!this.isEditMode && type !== "guideThree") {
      this.appendShrinkEntry(type, entry);
    }
    this.eventBus?.emit(PlayerEventEnum.INTERACTION_CARD_CLOSE, {
      type,
      index: entry.listIndex,
    });
  }

  /**
   * 生成左下角缩小条目：进度环沿用卡片关闭时刻的剩余比例继续倒数
   * （同卡片同下标重复关闭时幂等替换，不产生重复条目）
   */
  private appendShrinkEntry<T extends SyncItem>(
    type: CardType,
    entry: ActiveCardEntry<T>,
  ): void {
    const meta = getShrinkMeta(type);
    const id = `${SHRINK_ENTRY_PREFIX}${type}:${entry.listIndex}`;
    // 幂等：同卡片的旧条目先移除（理论上互斥时间窗下不会共存）
    const rest = this.shrinkActive.value.filter(
      (candidate: ShrinkCardEntry) => candidate.id !== id,
    );
    const shrink: ShrinkCardEntry = {
      id,
      type,
      listIndex: entry.listIndex,
      icon: meta.icon,
      title: meta.title,
      show: signal(false),
      // 关闭时刻的剩余比例即为缩小条目进度环的起点
      remaining: signal(entry.remaining.value),
    };
    this.shrinkActive.value = [...rest, shrink];
    // 双 rAF 后翻转显示态（播放 0.35s 淡入过渡，与卡片显隐协议一致）
    this.scheduleShow(shrink);
  }

  /**
   * 同步左下角缩小条目（每次 TIME_UPDATE 调用）：
   * - 进度环按原卡片时间窗继续倒数（1 → 0），归零移除条目
   * - 源卡片被重新打开（点击条目）或 seek 回关闭点之前
   *   （closeTime 重置逻辑已清除 isClose）→ 移除条目
   * - 源卡片数据被删除 → 移除条目
   */
  private syncShrinkEntries(): void {
    const current = this.shrinkActive.value;
    if (current.length === 0) return;
    const kept: ShrinkCardEntry[] = [];
    for (const shrink of current) {
      const source = this.findShrinkSourceItem(shrink);
      // 源卡片不存在或已被重新打开：条目随之移除
      if (source === null) continue;
      const { timeStart, timeEnd } = source;
      if (timeStart === undefined || timeEnd === undefined) continue;
      const total = timeEnd - timeStart;
      const elapsedRatio =
        total > 0 ? (this.currentTime - timeStart) / total : 0;
      const remaining = 1 - Math.min(Math.max(elapsedRatio, 0), 1);
      // 归零（播放越过 timeEnd）：条目完成使命移除
      if (remaining <= 0) continue;
      shrink.remaining.value = remaining;
      kept.push(shrink);
    }
    if (kept.length !== current.length) {
      this.shrinkActive.value = kept;
    }
  }

  /**
   * 查找缩小条目对应的源卡片数据（按类型 + 列表下标），
   * 源已从数据列表删除或卡片已被重新打开时返回 null
   */
  private findShrinkSourceItem(
    shrink: ShrinkCardEntry,
  ): SyncItem | null {
    switch (shrink.type) {
      case "link": {
        const item = this.interactCard.linkList[shrink.listIndex];
        return item !== undefined && item.isClose === true ? item : null;
      }
      case "vote": {
        const item = this.interactCard.voteList[shrink.listIndex];
        return item !== undefined && item.isClose === true ? item : null;
      }
      case "score": {
        const item = this.interactCard.scoreList[shrink.listIndex];
        return item !== undefined && item.isClose === true ? item : null;
      }
      case "scoreSum": {
        const item = this.interactCard.scoreSumList[shrink.listIndex];
        return item !== undefined && item.isClose === true ? item : null;
      }
      default:
        return null;
    }
  }

  /**
   * 点击缩小条目重开原卡片：清除关闭标记 → 移除条目 →
   * 按当前播放时间立即重建卡片（当前仍在时间窗内即刻恢复显示）
   */
  private reopenFromShrink(shrink: ShrinkCardEntry): void {
    // 先移除条目（无论源卡片是否仍可显示）
    this.shrinkActive.value = this.shrinkActive.value.filter(
      (candidate: ShrinkCardEntry) => candidate !== shrink,
    );
    // 清除关闭标记：卡片回到「窗口内即显示」状态
    switch (shrink.type) {
      case "link": {
        const item = this.interactCard.linkList[shrink.listIndex];
        if (item === undefined) return;
        item.isClose = false;
        item.closeTime = undefined;
        this.syncCard(
          ENTRY_PREFIX.link,
          shrink.listIndex,
          item,
          this.currentTime,
          this.linkActive,
        );
        return;
      }
      case "vote": {
        const item = this.interactCard.voteList[shrink.listIndex];
        if (item === undefined) return;
        item.isClose = false;
        item.closeTime = undefined;
        this.syncCard(
          ENTRY_PREFIX.vote,
          shrink.listIndex,
          item,
          this.currentTime,
          this.voteActive,
        );
        return;
      }
      case "score": {
        const item = this.interactCard.scoreList[shrink.listIndex];
        if (item === undefined) return;
        item.isClose = false;
        item.closeTime = undefined;
        this.syncCard(
          ENTRY_PREFIX.score,
          shrink.listIndex,
          item,
          this.currentTime,
          this.scoreActive,
        );
        return;
      }
      case "scoreSum": {
        const item = this.interactCard.scoreSumList[shrink.listIndex];
        if (item === undefined) return;
        item.isClose = false;
        item.closeTime = undefined;
        this.syncCard(
          ENTRY_PREFIX.scoreSum,
          shrink.listIndex,
          item,
          this.currentTime,
          this.scoreSumActive,
        );
        return;
      }
      default:
        return;
    }
  }

  /**
   * 拖拽落点：回写卡片数据定位并发布位置变更事件
   */
  private handlePositionChange(
    type: CardType,
    index: number,
    item: { top: number; left: number },
    top: number,
    left: number,
  ): void {
    item.top = top;
    item.left = left;
    this.eventBus?.emit(PlayerEventEnum.INTERACTION_POSITION_CHANGE, {
      type,
      index,
      top,
      left,
    });
  }

  // ==================== 数据增删与编辑模式 ====================

  /**
   * 编辑模式追加单张卡片条目（幂等）
   *
   * 显隐随时间窗口驱动后，本方法仅服务 rebuildEntry 的「编辑中卡片
   * 窗口内无闪烁重建」场景（immediate 显示态渲染，不播淡入过渡）
   *
   * @param idPrefix - 条目 id 的类型前缀
   * @param listIndex - 卡片在数据列表中的下标
   * @param item - 卡片原始数据
   * @param active - 该类型的活跃条目 signal 数组
   * @param immediate - true 时直接以显示态渲染（不播淡入过渡）：
   *   内容编辑的结构性重建场景使用，避免每次编辑重播过渡闪烁
   */
  private appendEditEntry<T>(
    idPrefix: string,
    listIndex: number,
    item: T,
    active: Signal<ActiveCardEntry<T>[]>,
    immediate = false,
  ): void {
    const existing = active.value.find(
      (entry: ActiveCardEntry<T>) => entry.listIndex === listIndex,
    );
    if (existing !== undefined) return;
    const entry = this.createEntry(idPrefix, listIndex, item);
    if (immediate) {
      // 渲染前即置为显示态：class 初始计算即含过渡类，挂载即显示无过渡
      entry.show.value = true;
      active.value = [...active.value, entry];
      return;
    }
    active.value = [...active.value, entry];
    this.scheduleShow(entry);
  }

  /**
   * 运行时添加卡片后的即时同步：
   * 根未挂载则仅入列表（待 MOUNTED 后由时间驱动）；
   * 两种模式统一按当前时间窗口判断是否立即创建（未来卡片由后续
   * TIME_UPDATE 驱动，编辑模式与展示模式同一口径）
   */
  private syncAddedCard<T extends SyncItem>(
    idPrefix: string,
    list: T[],
    item: T,
    active: Signal<ActiveCardEntry<T>[]>,
  ): void {
    // 根未挂载：数据已入列表，MOUNTED 后由时间更新驱动创建
    if (this.rootVNode === null) return;
    const listIndex = list.indexOf(item);
    if (listIndex < 0) return;
    this.syncCard(idPrefix, listIndex, item, this.currentTime, active);
  }

  // ==================== 公共 API ====================

  /**
   * 查询待设置的时间窗是否与任何已有卡片重叠
   *
   * 时间窗不完整的条目（timeStart/timeEnd 缺省）不参与判定
   * （与 syncCard 的「时间范围不完整不参与时间驱动」口径一致）；
   * 半开区间相交判定：边界相接（前卡 timeEnd == 后卡 timeStart）
   * 不视为重叠，保证节目单可无缝衔接
   */
  wouldOverlap(
    type: CardType,
    index: number,
    timeStart: number,
    timeEnd: number,
  ): boolean {
    /** 单条卡片与待设置窗口是否相交（时间窗不完整视为不相交） */
    const overlaps = (item: SyncItem): boolean => {
      if (item.timeStart === undefined || item.timeEnd === undefined) {
        return false;
      }
      return item.timeStart < timeEnd && item.timeEnd > timeStart;
    };
    /** 遍历单个列表：排除自身（同类型同下标）后任一条目相交即重叠 */
    const checkList = <T extends SyncItem>(
      list: T[],
      itemType: CardType,
    ): boolean =>
      list.some(
        (item: T, itemIndex: number): boolean =>
          !(itemType === type && itemIndex === index) && overlaps(item),
      );
    return (
      checkList(this.interactCard.guideList, "guideThree") ||
      checkList(this.interactCard.linkList, "link") ||
      checkList(this.interactCard.voteList, "vote") ||
      checkList(this.interactCard.scoreList, "score") ||
      checkList(this.interactCard.scoreSumList, "scoreSum")
    );
  }

  /**
   * 添加点赞关注卡片（入数据列表 + 立即同步时间窗口）
   * 时间窗与任何已有卡片重叠时拒绝添加（一次只能存在一张卡片）
   */
  addGuide(item: InteractionGuideThree): boolean {
    // 时间窗完整才参与互斥校验（guide 卡片时间窗可缺省）
    if (
      item.timeStart !== undefined &&
      item.timeEnd !== undefined &&
      this.wouldOverlap("guideThree", -1, item.timeStart, item.timeEnd)
    ) {
      return false;
    }
    this.interactCard.guideList.push(item);
    this.syncAddedCard(
      ENTRY_PREFIX.guideThree,
      this.interactCard.guideList,
      item,
      this.guideActive,
    );
    return true;
  }

  /**
   * 添加外链卡片（入数据列表 + 立即同步时间窗口）
   * 时间窗与任何已有卡片重叠时拒绝添加
   */
  addLink(item: InteractionLink): boolean {
    if (
      item.timeStart !== undefined &&
      item.timeEnd !== undefined &&
      this.wouldOverlap("link", -1, item.timeStart, item.timeEnd)
    ) {
      return false;
    }
    this.interactCard.linkList.push(item);
    this.syncAddedCard(
      ENTRY_PREFIX.link,
      this.interactCard.linkList,
      item,
      this.linkActive,
    );
    return true;
  }

  /**
   * 添加投票卡片（入数据列表 + 立即同步时间窗口）
   * 时间窗与任何已有卡片重叠时拒绝添加
   */
  addVote(item: InteractionVote): boolean {
    if (
      item.timeStart !== undefined &&
      item.timeEnd !== undefined &&
      this.wouldOverlap("vote", -1, item.timeStart, item.timeEnd)
    ) {
      return false;
    }
    this.interactCard.voteList.push(item);
    this.syncAddedCard(
      ENTRY_PREFIX.vote,
      this.interactCard.voteList,
      item,
      this.voteActive,
    );
    return true;
  }

  /**
   * 添加评分卡片（入数据列表 + 立即同步时间窗口）
   * 时间窗与任何已有卡片重叠时拒绝添加
   */
  addScore(item: InteractionScore): boolean {
    if (
      item.timeStart !== undefined &&
      item.timeEnd !== undefined &&
      this.wouldOverlap("score", -1, item.timeStart, item.timeEnd)
    ) {
      return false;
    }
    this.interactCard.scoreList.push(item);
    this.syncAddedCard(
      ENTRY_PREFIX.score,
      this.interactCard.scoreList,
      item,
      this.scoreActive,
    );
    return true;
  }

  /**
   * 添加评分总结卡片（入数据列表 + 立即同步时间窗口）
   * 前置条件：scoreList 至少已有一张评分卡片；
   * 时间窗与任何已有卡片重叠时拒绝添加
   */
  addScoreSum(item: InteractionScoreSum): boolean {
    // 总结卡必须建立在已有评分卡的基础上（无可汇总的题目）
    if (this.interactCard.scoreList.length === 0) {
      return false;
    }
    if (
      item.timeStart !== undefined &&
      item.timeEnd !== undefined &&
      this.wouldOverlap("scoreSum", -1, item.timeStart, item.timeEnd)
    ) {
      return false;
    }
    this.interactCard.scoreSumList.push(item);
    this.syncAddedCard(
      ENTRY_PREFIX.scoreSum,
      this.interactCard.scoreSumList,
      item,
      this.scoreSumActive,
    );
    return true;
  }

  /**
   * 获取互动层容器元素
   * @returns 容器元素，未挂载返回 null
   */
  getContainer(): HTMLElement | null {
    return this.container;
  }

  /**
   * 关闭卡片（外部调用）
   * 走统一关闭流程：标记关闭时间点 → 淡出过渡 → 删除 DOM → 发布关闭事件
   */
  closeCard(type: CardType, index: number): void {
    // guide 卡片无关闭概念（对齐旧实现），仅处理 link/vote/score
    switch (type) {
      case "link": {
        const entry = this.linkActive.value.find(
          (candidate: ActiveCardEntry<InteractionLink>) =>
            candidate.listIndex === index,
        );
        if (entry !== undefined) {
          this.closeEntry("link", entry, this.linkActive);
        }
        break;
      }
      case "vote": {
        const entry = this.voteActive.value.find(
          (candidate: ActiveCardEntry<InteractionVote>) =>
            candidate.listIndex === index,
        );
        if (entry !== undefined) {
          this.closeEntry("vote", entry, this.voteActive);
        }
        break;
      }
      case "score": {
        const entry = this.scoreActive.value.find(
          (candidate: ActiveCardEntry<InteractionScore>) =>
            candidate.listIndex === index,
        );
        if (entry !== undefined) {
          this.closeEntry("score", entry, this.scoreActive);
        }
        break;
      }
      case "scoreSum": {
        const entry = this.scoreSumActive.value.find(
          (candidate: ActiveCardEntry<InteractionScoreSum>) =>
            candidate.listIndex === index,
        );
        if (entry !== undefined) {
          this.closeEntry("scoreSum", entry, this.scoreSumActive);
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * 获取状态
   */
  getStatus(): InteractionCard {
    return { ...this.interactCard };
  }

  /**
   * 更新数据：清空全部活跃条目与交互状态，替换提供的列表后重建
   * （两种模式统一由后续 TIME_UPDATE 按时间窗口重建条目）
   */
  updateData(data: Partial<InteractionCard>): void {
    // 清空全部活跃条目（含移除定时器与拖拽绑定）
    this.disposeEntries(this.guideActive);
    this.disposeEntries(this.linkActive);
    this.disposeEntries(this.voteActive);
    this.disposeEntries(this.scoreActive);
    this.disposeEntries(this.scoreSumActive);
    // 左下角缩小条目随数据更换一并清空（源卡片已不在新数据中）
    this.shrinkActive.value = [];

    // 数据更换后旧交互状态不再适用
    this.guideStates.clear();
    this.voteStates.clear();
    this.scoreStates.clear();

    // 替换提供的列表（对齐旧实现：仅覆盖显式传入的列表）
    if (data.guideList) {
      this.interactCard.guideList = data.guideList;
    }
    if (data.linkList) {
      this.interactCard.linkList = data.linkList;
    }
    if (data.voteList) {
      this.interactCard.voteList = data.voteList;
    }
    if (data.scoreList) {
      this.interactCard.scoreList = data.scoreList;
    }
    if (data.scoreSumList) {
      this.interactCard.scoreSumList = data.scoreSumList;
    }

    // 重建统一交给后续 TIME_UPDATE 按时间窗口驱动（编辑/展示同一口径）：
    // 播放中的下一个时间更新点即完成窗口内条目的创建与显示
  }

  // ==================== 内容编辑（updateCardContent / removeCard） ====================

  /**
   * 自增条目的内容版本号（文本类编辑的响应式驱动）
   * 渲染层文本 getter 读取 contentVersion 建立依赖，版本号自增后
   * 文本节点精准更新，无需重建卡片 DOM（输入态/滚动位置不受影响）
   */
  private bumpEntryContent<T>(
    active: Signal<ActiveCardEntry<T>[]>,
    listIndex: number,
  ): void {
    const entry = active.value.find(
      (candidate: ActiveCardEntry<T>) => candidate.listIndex === listIndex,
    );
    if (entry !== undefined) {
      entry.contentVersion.value = entry.contentVersion.value + 1;
    }
  }

  /**
   * 自增条目的选项文案版本号（字段级细腻更新）
   * 仅 vote 卡片的选项文案 getter 读取该信号建立依赖：
   * 更新/增删选项时自增，question 等其他文本字段的
   * effect 不被触发（同理，question 编辑也不触碰选项行）
   */
  private bumpEntryOptions<T>(
    active: Signal<ActiveCardEntry<T>[]>,
    listIndex: number,
  ): void {
    const entry = active.value.find(
      (candidate: ActiveCardEntry<T>) => candidate.listIndex === listIndex,
    );
    if (entry !== undefined) {
      entry.optionsVersion.value = entry.optionsVersion.value + 1;
    }
  }

  /**
   * 定位变更的条目重建：移除旧条目后按新数据重建
   *
   * 仅 applySchedulePatch 的 top/left 补丁使用（定位为渲染期静态 style
   * 变量，重建是变更定位的最小可靠路径；内容/形态/图标/选项编辑均已
   * 信号化，不再经过此方法）。
   *
   * 编辑模式：显隐口径与展示模式一致（时间窗驱动），唯一差异在编辑
   * 体验——仍在当前显示窗口内的卡片以显示态立即重建（不播淡入过渡，
   * 避免编辑过程闪烁）；被改到窗口外的不重建，交由 TIME_UPDATE 到点驱动。
   * 展示模式：交由 syncCard 按当前时间窗口决定是否重建。
   */
  private rebuildEntry<T extends SyncItem>(
    idPrefix: string,
    listIndex: number,
    item: T,
    active: Signal<ActiveCardEntry<T>[]>,
  ): void {
    const existing = active.value.find(
      (candidate: ActiveCardEntry<T>) => candidate.listIndex === listIndex,
    );
    if (existing !== undefined) {
      this.removeEntry(active, existing);
    }
    // 根未挂载：数据已更新，待挂载后由时间驱动重建兜底
    if (this.rootVNode === null) return;
    if (this.isEditMode) {
      // 与 syncCard 同口径的窗口判定（提前量 / 上界 / 关闭态）
      const { timeStart, timeEnd } = item;
      const inWindow =
        timeStart !== undefined &&
        timeEnd !== undefined &&
        item.isClose !== true &&
        this.currentTime >= timeStart - CARD_CREATE_LEAD &&
        this.currentTime <= timeEnd;
      // 窗口内的编辑中卡片：显示态立即重建（无过渡不闪烁）
      if (inWindow) {
        this.appendEditEntry(idPrefix, listIndex, item, active, true);
      }
      // 窗口外：不重建，与展示模式一致由后续 TIME_UPDATE 到点创建
      return;
    }
    // 展示模式：按当前时间窗口判断（未来卡片由后续 TIME_UPDATE 驱动）
    this.syncCard(idPrefix, listIndex, item, this.currentTime, active);
  }

  /**
   * 通用调度字段补丁：时间窗（timeStart/timeEnd）与定位（top/left）
   *
   * 五类卡片共用字段，先落到数据条目再同步渲染：
   * - 时间窗：按当前播放时间立即重算窗口归属（入窗即刻创建显示 /
   *   出窗即刻淡出移除），编辑/展示两种模式同一口径；
   *   补丁合并后的新窗口与其他任何卡片重叠时整个补丁拒绝（一次
   *   只能存在一张卡片，编辑面板据返回值 toast 提示）
   * - 定位：渲染期为静态 style（--top/--left CSS 变量），变更走条目重建；
   *   交互状态按 listIndex 存于 Map，重建不丢失
   *
   * @param type - 卡片类型（重叠校验时排除自身条目）
   * @param idPrefix - 条目 id 的类型前缀
   * @param listIndex - 卡片在对应数据列表中的下标
   * @param item - 卡片原始数据（时间窗与定位字段可写）
   * @param active - 该类型的活跃条目 signal 数组
   * @param patch - 内容补丁（仅消费 timeStart/timeEnd/top/left）
   * @returns 是否成功应用（false = 合并后的时间窗与其他卡片重叠被拒）
   */
  private applySchedulePatch<T extends SyncItem & { top: number; left: number }>(
    type: CardType,
    idPrefix: string,
    listIndex: number,
    item: T,
    active: Signal<ActiveCardEntry<T>[]>,
    patch: CardContentPatch,
  ): boolean {
    // 时间窗补丁：合并 patch 与现值得到新窗口，与其他卡片重叠则整体拒绝
    // （时间窗不完整的卡片不参与互斥，与 wouldOverlap 的判定口径一致）
    if (patch.timeStart !== undefined || patch.timeEnd !== undefined) {
      const nextStart = patch.timeStart ?? item.timeStart;
      const nextEnd = patch.timeEnd ?? item.timeEnd;
      if (
        nextStart !== undefined &&
        nextEnd !== undefined &&
        this.wouldOverlap(type, listIndex, nextStart, nextEnd)
      ) {
        return false;
      }
    }

    // 根未挂载：数据写入后待挂载兜底，无需同步渲染
    if (this.rootVNode === null) {
      if (patch.timeStart !== undefined) item.timeStart = patch.timeStart;
      if (patch.timeEnd !== undefined) item.timeEnd = patch.timeEnd;
      if (patch.top !== undefined) item.top = patch.top;
      if (patch.left !== undefined) item.left = patch.left;
      return true;
    }

    // 时间窗补丁：写入后按当前播放时间重算窗口归属
    // （入窗即刻创建显示 / 出窗即刻淡出移除，编辑/展示同一口径；
    // 关闭环剩余比例由 syncCard 窗口内路径刷新）
    if (patch.timeStart !== undefined || patch.timeEnd !== undefined) {
      if (patch.timeStart !== undefined) item.timeStart = patch.timeStart;
      if (patch.timeEnd !== undefined) item.timeEnd = patch.timeEnd;
      this.syncCard(idPrefix, listIndex, item, this.currentTime, active);
    }

    // 定位补丁：写入后条目重建（静态 style 变更的最小可靠路径）
    const posChanged =
      (patch.top !== undefined && patch.top !== item.top) ||
      (patch.left !== undefined && patch.left !== item.left);
    if (posChanged) {
      if (patch.top !== undefined) item.top = patch.top;
      if (patch.left !== undefined) item.left = patch.left;
      this.rebuildEntry(idPrefix, listIndex, item, active);
    }
    return true;
  }

  /**
   * 编辑卡片内容
   *
   * 全部内容字段均不重建卡片 DOM（细腻更新）：
   * - 文本字段（linkContent / question / optionTexts / title）：
   *   原地更新 + contentVersion 自增 → 响应式文本精准更新 DOM
   * - 结构字段（guideType / scoreType / optionTexts 变长）：
   *   信号化驱动 —— 形态类名切换 / 图标按值替换 / 选项行按引用增删，
   *   卡片 DOM 与交互状态全程复用（无闪烁、视频暂停时也即时生效）
   * - 调度字段（timeStart/timeEnd/top/left）：见 applySchedulePatch
   *  （其中 top/left 为渲染期静态 style，是内容编辑唯一的重建路径）
   *
   * @param type - 卡片类型
   * @param index - 卡片在对应数据列表中的下标
   * @param patch - 内容补丁（未提供的字段保持原值）
   */
  updateCardContent(
    type: CardType,
    index: number,
    patch: CardContentPatch,
  ): boolean {
    switch (type) {
      case "guideThree": {
        const item = this.interactCard.guideList[index];
        if (item === undefined) return false;
        // 调度补丁（时间窗/定位）：时间窗重叠时整个补丁拒绝
        if (
          !this.applySchedulePatch(
            "guideThree",
            ENTRY_PREFIX.guideThree,
            index,
            item,
            this.guideActive,
            patch,
          )
        ) {
          return false;
        }
        if (patch.guideType !== undefined && patch.guideType !== item.type) {
          item.type = patch.guideType;
          // 形态为根类名变体（三连/关注区 DOM 恒在、CSS 显隐）：
          // 写入信号由类名表达式原位切换，卡片 DOM 不销毁重建；
          // 卡片未挂载时无状态可写，数据已更新，下次创建按新形态渲染
          const state = this.guideStates.get(index);
          if (state) state.guideTypeSignal.value = patch.guideType;
        }
        return true;
      }
      case "link": {
        const item = this.interactCard.linkList[index];
        if (item === undefined) return false;
        if (
          !this.applySchedulePatch(
            "link",
            ENTRY_PREFIX.link,
            index,
            item,
            this.linkActive,
            patch,
          )
        ) {
          return false;
        }
        if (patch.linkContent !== undefined) {
          item.linkContent = patch.linkContent;
          this.bumpEntryContent(this.linkActive, index);
        }
        return true;
      }
      case "vote": {
        const item = this.interactCard.voteList[index];
        if (item === undefined) return false;
        if (
          !this.applySchedulePatch(
            "vote",
            ENTRY_PREFIX.vote,
            index,
            item,
            this.voteActive,
            patch,
          )
        ) {
          return false;
        }
        if (patch.question !== undefined) {
          item.question = patch.question;
          this.bumpEntryContent(this.voteActive, index);
        }
        if (patch.optionTexts !== undefined) {
          const texts = patch.optionTexts;
          const oldCount = item.options.length;
          const overlap = Math.min(texts.length, oldCount);
          // 重叠区间：原地改写文案（保留票数与对象引用 → For 复用既有行）
          for (let i = 0; i < overlap; i += 1) {
            const option = item.options[i];
            if (option) option.optionText = texts[i];
          }
          // 尾部增删：新增选项 push 新对象 / 多余选项截断。
          // 仅尾部操作保证既有选项位置与引用稳定，For 仅对差异行
          // 创建/销毁 DOM，卡片 DOM 不销毁重建
          for (let i = oldCount; i < texts.length; i += 1) {
            item.options.push({ optionText: texts[i] });
          }
          if (oldCount > texts.length) {
            item.options.length = texts.length;
          }
          // 字段级细腻更新：只自增选项文案版本号，question 等
          // 其他文本字段的响应式 effect 不被触发
          this.bumpEntryOptions(this.voteActive, index);
          // 数量变化时同步选项信号：For 按引用 diff 精准增删行；
          // 等长时数组内容未变信号无需重写，文案更新已由版本号驱动。
          // 卡片未挂载时无状态可写，数据已更新，下次创建按新选项渲染
          if (texts.length !== oldCount) {
            const state = this.voteStates.get(index);
            if (state) state.optionsSignal.value = [...item.options];
          }
        }
        return true;
      }
      case "score": {
        const item = this.interactCard.scoreList[index];
        if (item === undefined) return false;
        if (
          !this.applySchedulePatch(
            "score",
            ENTRY_PREFIX.score,
            index,
            item,
            this.scoreActive,
            patch,
          )
        ) {
          return false;
        }
        if (patch.title !== undefined) {
          item.title = patch.title;
          this.bumpEntryContent(this.scoreActive, index);
        }
        if (patch.scoreType !== undefined && patch.scoreType !== item.scoreType) {
          item.scoreType = patch.scoreType;
          // 图标类型经单元素 For 渲染：写入 [新类型] 按值替换图标 VNode，
          // 评分项容器/数值气泡/类名全部复用，卡片 DOM 不销毁重建；
          // 卡片未挂载时无状态可写，数据已更新，下次创建按新图标渲染
          const state = this.scoreStates.get(index);
          if (state) state.scoreIconList.value = [patch.scoreType];
        }
        return true;
      }
      case "scoreSum": {
        const item = this.interactCard.scoreSumList[index];
        if (item === undefined) return false;
        // 总结卡只有调度字段（定位 + 时间窗），内容为运行期聚合
        return this.applySchedulePatch(
          "scoreSum",
          ENTRY_PREFIX.scoreSum,
          index,
          item,
          this.scoreSumActive,
          patch,
        );
      }
      default:
        return false;
    }
  }

  /**
   * 从数据列表移除卡片并销毁其条目
   *
   * 编辑器的删除语义（与 closeCard 的「本次播放关闭」语义不同）：
   * 数据从列表删除，跨快照/重建不再出现。
   * 删除后重建全部条目（列表 splice 导致下标位移，
   * 条目 key 与下标的映射需整体刷新）。
   */
  removeCard(type: CardType, index: number): void {
    let removed = false;
    switch (type) {
      case "guideThree":
        removed = this.interactCard.guideList.splice(index, 1).length > 0;
        break;
      case "link":
        removed = this.interactCard.linkList.splice(index, 1).length > 0;
        break;
      case "vote":
        removed = this.interactCard.voteList.splice(index, 1).length > 0;
        break;
      case "score":
        removed = this.interactCard.scoreList.splice(index, 1).length > 0;
        break;
      case "scoreSum":
        removed = this.interactCard.scoreSumList.splice(index, 1).length > 0;
        break;
      default:
        return;
    }
    if (!removed) return;

    // 下标位移后旧条目全部失效：整体清空重建
    this.disposeEntries(this.guideActive);
    this.disposeEntries(this.linkActive);
    this.disposeEntries(this.voteActive);
    this.disposeEntries(this.scoreActive);
    this.disposeEntries(this.scoreSumActive);
    // 左下角缩小条目一并清空（源卡片下标已位移，按新数据重建后由
    // 后续关闭操作重新生成）
    this.shrinkActive.value = [];
    this.guideStates.clear();
    this.voteStates.clear();
    this.scoreStates.clear();

    if (this.rootVNode === null) return;
    // 五类列表按当前时间窗口立即重建（在窗卡片恢复显示）：
    // 编辑/展示同一口径 —— 编辑模式当前窗口内的卡片删除其他卡片后
    // 同样立即恢复显示（可继续编辑），窗口外卡片到点再出现
    this.syncList(
      ENTRY_PREFIX.guideThree,
      this.interactCard.guideList,
      this.guideActive,
      this.currentTime,
    );
    this.syncList(ENTRY_PREFIX.link, this.interactCard.linkList, this.linkActive, this.currentTime);
    this.syncList(ENTRY_PREFIX.vote, this.interactCard.voteList, this.voteActive, this.currentTime);
    this.syncList(ENTRY_PREFIX.score, this.interactCard.scoreList, this.scoreActive, this.currentTime);
    this.syncList(
      ENTRY_PREFIX.scoreSum,
      this.interactCard.scoreSumList,
      this.scoreSumActive,
      this.currentTime,
    );
  }
}

/**
 * For 控制流的 key 函数：条目 id（类型前缀 + 列表下标），
 * 非法入参回退到下标（理论不可达，防御式兜底）
 */
function entryKey(item: unknown, index: number): string {
  return hasStringId(item) ? item.id : `unknown:${index}`;
}

/**
 * 交互插件工厂函数
 *
 * @param config - 插件配置（mode: 'interactive' 展示模式 | 'edit' 编辑模式）
 * @returns Plugin 实例
 *
 * @example
 * plugins: [
 *   InteractionPlugin({
 *     mode: 'interactive',
 *     onLike: () => console.log('liked'),
 *     onVoteSelect: (voteIndex, optionIndex) => console.log(voteIndex, optionIndex)
 *   })
 * ]
 */
export function InteractionPlugin(
  config?: InteractionPluginConfig,
): InteractionPluginAPI {
  return new InteractionPluginClass(config);
}

// 重新导出类型（外部编辑器构造数据 / 类型标注使用）
export type {
  CardType,
  CardContentPatch,
  PositionEvent,
  InteractionPluginConfig,
  InteractionPluginMode,
  InteractionCard,
  InteractionGuideThree,
  InteractionLink,
  InteractionVote,
  InteractionScore,
  InteractionScoreSum,
  VoteOption,
} from "./types";
