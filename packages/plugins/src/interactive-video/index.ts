/**
 * ============================================
 * 互动视频插件 (InteractiveVideoPlugin)
 * ============================================
 * 面向「分支剧情视频」：观众在分支点通过 canvas 选项按钮决定剧情走向，
 * 插件维护观看路径、驱动播放器在节点间切换，并提供剧情进度条 /
 * 倒计时 / 重播等互动视频专属能力。
 *
 * 与 InteractionPlugin（交互卡片插件）是完全不同的两个插件：
 * - 挂载容器不同：本插件注入播放器侧的 .nova-player-interaction-wrap
 *   （由播放器组件 InteractiveVideoLayer 提供的空容器），
 *   交互卡片插件注入 .nova-player-cmd-dm-inside
 * - 功能定位不同：本插件面向「分支剧情视频」（选择不同分支跳转播放），
 *   交互卡片插件面向「时间窗互动卡片」（点赞/投票/评分等）
 *
 * 响应式写法（与 interaction 插件同模式）：
 * - 全部 UI 状态信号化（storyEntries / questionState / countdownRatio /
 *   countdownVisible / replayVisible），mountRoot 一次性构建 VNode 树，
 *   事件处理只写信号，编译器（luminaCompile）自动追踪依赖原位更新 DOM；
 * - 播放器事件（TIME_UPDATE / SEEKED / ENDED）驱动信号更新：
 *   TIME_UPDATE 按时间窗写倒计时比例（与 interaction 插件关闭环
 *   remaining 信号同模式），CSS transition 抹平上报周期阶梯感
 *
 * 模块编排（本文件 = 主类，子模块均为纯 VNode 渲染函数 / canvas 绘制）：
 * - storyBar.ts        剧情进度条（圆点 + 悬停卡片，For 控制流）
 * - questionCanvas.ts  分支选择透明 canvas（响应式容器 + effect 重绘）
 * - countdown.ts       分支选择倒计时（ratio 信号驱动 width 表达式）
 * - replay.ts          重播按钮（visible 信号驱动 display 表达式）
 * - pathTracker.ts     观看路径维护（纯数据逻辑）
 *
 * 使用方式：
 * import { InteractiveVideoPlugin } from '@lumina/plugins';
 *
 * plugins: [
 *   InteractiveVideoPlugin({
 *     nodes: {
 *       start: { id: 'start', title: '序言', cover: '...', video: '...', duration: 60, question: {...} },
 *       ...
 *     },
 *     startNodeId: 'start',
 *     onOptionSelect: (nodeId, index) => console.log(nodeId, index)
 *   })
 * ]
 */

import { h, Fragment, signal, mount, destroy } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";
import type { VideoPlayer } from "../../../player/src/player/VideoPlayer";
import { PlayerEventEnum } from "@/core/events";
import { t } from "@/core";
import { isBrowser } from "@/utils";
import { injectPluginStyle } from "../utils/injectStyle";
// 互动视频插件样式以字符串形式内联导入（Vite `?inline`），install 时运行时注入
import interactiveVideoCss from "./interactive-video.scss?inline";
import type {
  InteractiveNode,
  InteractiveQuestion,
  InteractiveVideoPluginConfig,
  InteractiveVideoPluginAPI,
  VisitedNode,
} from "./types";
import { PathTracker } from "./pathTracker";
import { renderStoryBar } from "./storyBar";
import type { StoryNodeEntry } from "./storyBar";
import { renderQuestion } from "./questionCanvas";
import { renderCountdown } from "./countdown";
import { renderReplay } from "./replay";

/**
 * 互动视频插件主类
 *
 * 生命周期：install（注入样式 + 订阅事件）→ MOUNTED（定位容器 +
 * mountRoot 构建 VNode 树）→ 播放驱动（TIME_UPDATE 时间窗 / ENDED
 * 播完处理，全部写信号）→ uninstall（解绑事件 + 执行清理 + 销毁 VNode）
 */
class InteractiveVideoPluginClass implements InteractiveVideoPluginAPI {
  /** 插件名（Plugin 接口要求，getPluginAPI 按此查询） */
  readonly name = "interactiveVideo";

  /** 插件配置（构造期固化，运行期只读） */
  private readonly config: InteractiveVideoPluginConfig;

  /** 观看路径追踪器（纯数据逻辑） */
  private readonly pathTracker: PathTracker;

  /** 事件订阅解绑函数列表（uninstall 时统一执行） */
  private readonly unsubscribers: Array<() => void> = [];

  /** 模块级清理函数列表（effect dispose / 事件解绑 / 观察器断开） */
  private readonly cleanups: Array<() => void> = [];

  /** 播放器实例引用（install 后可用） */
  private player: VideoPlayer | null = null;

  /** 互动视频 VNode 树根（mountRoot 构建，uninstall 销毁） */
  private rootVNode: VNode | null = null;

  // ==================== 响应式 UI 状态 ====================

  /** 剧情进度条节点条目（整组替换，For 按 id diff 增删） */
  private readonly storyEntries: Signal<StoryNodeEntry[]> = signal([]);

  /** 剧情进度条显隐 */
  private readonly storyVisible: Signal<boolean> = signal(false);

  /** 分支选择配置（null = 隐藏并清空画布；ended = 播完弹出，画最后一帧背景） */
  private readonly questionState: Signal<{
    question: InteractiveQuestion;
    ended: boolean;
  } | null> = signal(null);

  /** 倒计时剩余比例（1 → 0，TIME_UPDATE 驱动） */
  private readonly countdownRatio: Signal<number> = signal(1);

  /** 倒计时显隐 */
  private readonly countdownVisible: Signal<boolean> = signal(false);

  /** 重播按钮显隐 */
  private readonly replayVisible: Signal<boolean> = signal(false);

  /**
   * @param config - 插件配置（节点表 + 起始节点 + 业务回调）
   */
  constructor(config?: InteractiveVideoPluginConfig) {
    // 空配置兜底：无节点表时给一个空表（插件不产生任何互动行为）
    this.config = config ?? { nodes: {}, startNodeId: "" };
    this.pathTracker = new PathTracker(
      this.config.nodes,
      this.config.startNodeId,
    );
  }

  // ==================== 安装 / 卸载 ====================

  /**
   * 安装插件：注入样式 + 订阅播放器事件
   *
   * @param player - 播放器实例
   */
  install(player: VideoPlayer): void {
    if (!isBrowser()) return;

    // 运行时注入互动视频插件样式（幂等，多播放器实例共享同一节点）
    injectPluginStyle("interactiveVideo", interactiveVideoCss);

    this.player = player;
    const events = player.events;

    // 订阅 MOUNTED：定位互动视频容器并 mountRoot
    this.unsubscribers.push(
      events.on(PlayerEventEnum.MOUNTED, (data): void => {
        if (data.container) {
          this.initAfterMounted(data.container);
        }
      }),
    );

    // 运行期后装（player.use）场景：容器已在 DOM 就地补一次初始化
    //（initAfterMounted 幂等，重复调用无副作用）
    if (player.el) {
      this.initAfterMounted(player.el);
    }

    // 订阅 TIME_UPDATE：分支时间窗判定 + 倒计时比例驱动
    this.unsubscribers.push(
      events.on(PlayerEventEnum.TIME_UPDATE, (data): void => {
        this.handleTimeUpdate(data.time);
      }),
    );

    // 订阅 SEEKED：拖出时间窗时校正选择显隐
    this.unsubscribers.push(
      events.on(PlayerEventEnum.SEEKED, (): void => {
        this.handleSeeked();
      }),
    );

    // 订阅 ENDED：播完处理（有未选分支 → 弹出选择；无分支 → 显示重播）
    this.unsubscribers.push(
      events.on(PlayerEventEnum.ENDED, (): void => {
        this.handleEnded();
      }),
    );
  }

  /**
   * 卸载插件：取消订阅 + 执行模块清理 + 销毁 VNode 树
   */
  uninstall(): void {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers.length = 0;

    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups.length = 0;

    if (this.rootVNode) {
      destroy(this.rootVNode);
      this.rootVNode = null;
    }

    this.player = null;
  }

  // ==================== 容器初始化与挂载 ====================

  /**
   * MOUNTED 后初始化：定位互动视频容器并 mountRoot（幂等）
   *
   * 两个触发时机共用：
   * - MOUNTED 事件回调（随 plugins.list 在构造期注入的正常路径）
   * - install 时检测 player.el 已存在（后装路径）
   *
   * @param container - 播放器容器（MOUNTED 载荷或 player.el）
   */
  private initAfterMounted(container: HTMLElement): void {
    // 幂等：VNode 树已挂载则跳过
    if (this.rootVNode) return;

    // 定位互动视频根容器（播放器组件 InteractiveVideoLayer 提供）
    const wrap = container.querySelector<HTMLElement>(
      ".nova-player-interaction-wrap",
    );
    if (!wrap) return;

    // 一次性构建全部互动视频 VNode 树（后续状态变化走信号更新）
    this.rootVNode = h(
      Fragment,
      null,
      // 激活标志元素（零尺寸）：问题 / 重播显示中时置为可见，
      // CSS :has(.nova-player-interaction-active) 据此让整个互动层
      // 脱离「随控制栏隐藏」的联动（播完弹问题时控制栏收起但问题可点）
      h("div", {
        class: "nova-player-interaction-active",
        style: {
          display:
            this.questionState.value !== null || this.replayVisible.value
              ? "block"
              : "none",
        },
      }),
      // 剧情进度条（For 控制流，storyEntries 信号驱动）
      renderStoryBar(this.storyEntries, this.storyVisible),
      // 分支选择（questionState 信号驱动显隐 + canvas effect 重绘；
      // videoGetter 供播完弹出时绘制视频最后一帧）
      renderQuestion(
        this.questionState,
        (): HTMLVideoElement | null => this.player?.video ?? null,
        (index): void => {
          this.handleSelect(index);
        },
        this.cleanups,
      ),
      // 倒计时（countdownRatio / countdownVisible 信号驱动）
      renderCountdown(this.countdownRatio, this.countdownVisible),
      // 重播按钮（replayVisible 信号驱动）
      renderReplay(
        this.replayVisible,
        t("player.ui.interactionVideo.replay"),
        (): void => {
          this.handleReplay();
        },
      ),
    );
    mount(this.rootVNode, wrap);

    // 初始渲染：起始节点的剧情进度（单节点也显示，当前项为位置图标）
    this.rebuildStoryEntries();
    this.storyVisible.value = true;

    // 业务未设置初始 src 时才回落到起始节点视频（业务已配置 src 的
    // 场景由业务自行决定起播内容，插件不覆盖）
    const player = this.player;
    const startNode = this.pathTracker.getNode(this.config.startNodeId);
    if (startNode && player && !player.getConfig().src) {
      void player.load(startNode.video);
    }
  }

  // ==================== 对外 API ====================

  /** 当前观看路径（只读快照） */
  getPath(): VisitedNode[] {
    return this.pathTracker.getPath();
  }

  /**
   * 外部主动跳转节点（编辑器 / 外链场景）：
   * 更新路径 + 重建进度条信号 + 切换视频源
   *
   * @param nodeId - 目标节点 id
   */
  jumpTo(nodeId: string): void {
    this.switchToNode(nodeId);
  }

  /** 从起始节点重播（重置路径） */
  replay(): void {
    this.handleReplay();
  }

  /** 手动显示剧情进度条 */
  showStoryBar(): void {
    this.storyVisible.value = true;
  }

  /** 手动隐藏剧情进度条 */
  hideStoryBar(): void {
    this.storyVisible.value = false;
  }

  // ==================== 播放驱动（事件 → 信号） ====================

  /**
   * TIME_UPDATE 处理：分支时间窗判定 + 倒计时比例驱动
   * - 播放进入 [timeStart, timeEnd) 且当前节点分支未选择 →
   *   显示选择（questionState）+ 启动倒计时（ratio 信号）
   * - 播放越过 timeEnd 且仍未选择 → 自动选择默认项
   *
   * @param time - 当前播放时间（秒）
   */
  private handleTimeUpdate(time: number): void {
    const question = this.currentQuestion();
    // 当前节点无分支或已选择：不处理
    if (!question || this.hasSelected()) return;

    // 播放越过窗口终点仍未选择：自动选择默认项
    if (time >= question.timeEnd) {
      this.handleSelect(question.defaultOptionIndex ?? 0);
      return;
    }

    // 播放进入窗口起点：显示分支选择 + 驱动倒计时比例
    if (time >= question.timeStart) {
      // 相同引用赋值：已显示时信号内部跳过通知，无副作用
      this.questionState.value = { question, ended: false };

      // 倒计时比例 = 剩余时间 / 窗口总时长（CSS transition 平滑过渡）
      const windowDuration = question.timeEnd - question.timeStart;
      this.countdownVisible.value = true;
      this.countdownRatio.value = Math.max(
        0,
        (question.timeEnd - time) / windowDuration,
      );
    }
  }

  /**
   * SEEKED 处理：拖出时间窗时隐藏选择（用户主动 seek 跳过分支点）
   * 拖回窗口内则重新显示（未选择状态下）
   */
  private handleSeeked(): void {
    const question = this.currentQuestion();
    if (!question || this.hasSelected() || !this.player) return;

    const time = this.player.getCurrentTime();

    // 时间窗之外：隐藏选择 + 停止倒计时（写信号驱动 UI）
    if (time < question.timeStart || time > question.timeEnd) {
      this.questionState.value = null;
      this.countdownVisible.value = false;
      return;
    }

    // 拖回窗口内：重新显示选择 + 倒计时（按剩余时间重算比例）
    this.questionState.value = { question, ended: false };
    const windowDuration = question.timeEnd - question.timeStart;
    this.countdownVisible.value = true;
    this.countdownRatio.value = Math.min(
      1,
      Math.max(0, (question.timeEnd - time) / windowDuration),
    );
  }

  /**
   * ENDED 处理：当前节点播完
   * - 有未选择的分支 → 弹出选择（无倒计时，视频时间轴已停）：
   *   此时控制栏与其余 UI 均收起，canvas 以视频最后一帧为背景绘制问题，
   *   问题 / 重播不随控制栏隐藏（active 标志保持互动层可交互）
   * - 无分支 → 显示重播按钮（同样不随控制栏隐藏）
   */
  private handleEnded(): void {
    const question = this.currentQuestion();

    // 播完场景：剧情进度条与其它 UI 随控制栏一起收起，只留问题 / 重播
    this.storyVisible.value = false;

    if (question && !this.hasSelected()) {
      // 播完弹选择：不启动倒计时（等用户选择）；ended = true 让 canvas
      // 绘制视频最后一帧作为问题背景
      this.questionState.value = { question, ended: true };
      this.countdownVisible.value = false;
      return;
    }

    // 路径走完：显示重播按钮（replayVisible 信号驱动）
    this.replayVisible.value = true;
  }

  /**
   * 重播处理：重置路径 → 重建进度条 → 跳回起始节点
   */
  private handleReplay(): void {
    // 重置路径到起始节点并广播
    this.pathTracker.reset();
    this.rebuildStoryEntries();
    this.config.onPathChange?.(this.pathTracker.getPath());

    // 隐藏重播按钮 + 清理可能残留的选择态（写信号驱动 UI）
    this.replayVisible.value = false;
    this.questionState.value = null;
    this.countdownVisible.value = false;

    // 跳回起始节点（reset 后路径已含起始节点，switchToNode 内
    // jumpTo 对已存在节点做截断重置，语义正确）
    this.switchToNode(this.config.startNodeId);
    this.config.onReplay?.();
  }

  // ==================== 内部工具 ====================

  /**
   * 切换到目标节点：更新路径 → 重建进度条信号 → 清理 UI 信号 → 切源
   *
   * @param nodeId - 目标节点 id
   */
  private switchToNode(nodeId: string): void {
    const node = this.pathTracker.getNode(nodeId);
    if (!node || !this.player) return;

    // 路径更新 + 进度条信号重建 + 路径变化广播
    this.pathTracker.jumpTo(nodeId);
    this.rebuildStoryEntries();
    this.config.onPathChange?.(this.pathTracker.getPath());

    // 清理上一节点的残留 UI（写信号驱动隐藏）+ 恢复剧情进度条
    this.questionState.value = null;
    this.countdownVisible.value = false;
    this.replayVisible.value = false;
    this.storyVisible.value = true;

    // 换源加载（复用同一 video 元素与整棵 DOM）：load 内部有竞态守卫
    // （loadToken）+ pendingSeek 机制，loadedmetadata 后统一应用起播时间
    // 与 attemptAutoplay（含自动播放策略静音兜底），比 setConfig + 立即
    // play() 的时序可靠；HLS / DASH 源由 streamMiddleware 分发到对应
    // 流媒体插件加载
    void this.player.load(node.video, {
      autoplay: this.config.autoPlay ?? true,
    });
  }

  /**
   * 选项选择处理：记录选择 → 隐藏选择 UI → 广播回调 → 跳转目标分支
   *
   * @param index - 选项下标
   */
  private handleSelect(index: number): void {
    const question = this.currentQuestion();
    if (!question) return;

    /** 目标分支选项（选项越界时中止） */
    const option = question.options[index];
    if (!option) return;

    /** 当前节点 id */
    const currentNodeId = this.pathTracker.getCurrentNodeId();

    // 记录选择（写入路径末项）+ 隐藏选择 UI（写信号驱动）
    this.pathTracker.selectOption(index);
    this.questionState.value = null;
    this.countdownVisible.value = false;

    // 业务回调
    this.config.onOptionSelect?.(currentNodeId, index);

    // 跳转目标分支节点
    this.switchToNode(option.targetNodeId);
  }

  /**
   * 重建剧情进度条节点信号（整组替换，For 按 id diff 增删）
   *
   * 嵌套结构整体替换触发更新（浅层信号对嵌套对象属性赋值不通知，
   * 整组重建条目数组是框架推荐的更新方式）
   */
  private rebuildStoryEntries(): void {
    /** 当前观看路径快照 */
    const path = this.pathTracker.getPath();

    // 过滤无配置节点并重排下标（保持 left 定位连续）
    this.storyEntries.value = path.flatMap((visited, rawIndex): Array<StoryNodeEntry> => {
      /** 节点配置（异常 id 容错跳过） */
      const node = this.pathTracker.getNode(visited.nodeId);
      if (!node) return [];

      return [
        {
          // 稳定 key：路径下标 + 节点 id（同节点可重复出现在路径上）
          id: `story-${rawIndex}-${visited.nodeId}`,
          index: rawIndex,
          node,
          // 最后一项 = 正在观看（位置图标），其余为已看完（打勾图标）
          isCurrent: rawIndex === path.length - 1,
          hover: signal(false),
        },
      ];
    });
  }

  /** 当前节点的分支配置（无分支返回 undefined） */
  private currentQuestion(): InteractiveNode["question"] {
    return this.pathTracker.getNode(this.pathTracker.getCurrentNodeId())
      ?.question;
  }

  /** 当前节点是否已选择过分支（路径末项 selectedOptionIndex >= 0） */
  private hasSelected(): boolean {
    const path = this.pathTracker.getPath();
    if (path.length === 0) return false;
    return path[path.length - 1].selectedOptionIndex >= 0;
  }
}

/**
 * 互动视频插件工厂函数
 *
 * @param config - 插件配置（节点表 + 起始节点 + 业务回调）
 * @returns 插件实例（经 player plugins.list 或 player.use 挂载）
 */
export function InteractiveVideoPlugin(
  config?: InteractiveVideoPluginConfig,
): InteractiveVideoPluginAPI {
  return new InteractiveVideoPluginClass(config);
}

// 重新导出类型（外部构造数据 / 类型标注使用）
export type {
  InteractiveNode,
  InteractiveQuestion,
  InteractiveOption,
  VisitedNode,
  InteractiveVideoPluginConfig,
  InteractiveVideoPluginAPI,
} from "./types";
