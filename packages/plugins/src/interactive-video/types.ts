/**
 * ============================================
 * 互动视频插件 (InteractiveVideoPlugin) — 数据结构定义
 * ============================================
 * 面向「分支剧情视频」：观众在分支点通过 canvas 绘制的选项按钮
 * 决定剧情走向，插件维护观看路径并驱动播放器在节点间切换。
 *
 * 与 interaction（交互卡片）插件的数据结构完全独立，互不复用。
 */

import type { PlayerSource } from "@/types";
import type { Plugin } from "@/types/plugin";

// ============================================
// 节点与分支
// ============================================

/** 互动视频节点（一个节点 = 一段可播放的视频片段） */
export interface InteractiveNode {
  /** 节点唯一 id */
  id: string;
  /** 节点标题（剧情进度条悬停卡片显示） */
  title: string;
  /** 节点视频封面图 URL（剧情进度条悬停卡片显示） */
  cover: string;
  /**
   * 节点视频源（与播放器 src 同构：字符串 / 多清晰度数组 / HLS 清单对象）。
   * 与 avid 至少提供一个：静态配置场景直接给 video；后端剧情树场景只给
   * avid 引用，由插件配置的 resolveVideo 回调按需解析成真实播放源
   */
  video?: PlayerSource;
  /**
   * 视频 avid 引用（后端互动视频的标准做法：剧情树节点只带 avid，
   * 分支切换时前端再拿 avid 请求 playurl 换取播放地址）。
   * 配置了 resolveVideo 时优先走 avid 解析；缓存按 avid 记账，
   * 同一节点回看 / 重播不重复请求
   */
  avid?: string;
  /** 视频总时长（秒，用于分支时间窗判定） */
  duration: number;
  /** 分支点配置：到达时间窗弹出分支选择（无则该节点为直线播放） */
  question?: InteractiveQuestion;
}

/** 分支选择配置 */
export interface InteractiveQuestion {
  /** 选择时间窗起点（秒，播放越过该点显示选项） */
  timeStart: number;
  /** 选择时间窗终点（秒，倒计时归零自动选择默认项） */
  timeEnd: number;
  /** 题目文案（可选，绘制在选项上方） */
  title?: string;
  /** 答案背景图 URL（可选；不同节点可配不同背景，缺省用插件默认背景） */
  background?: string;
  /** 选项列表（至少一项） */
  options: InteractiveOption[];
  /** 超时自动选择的选项下标（默认 0） */
  defaultOptionIndex?: number;
}

/** 分支选项 */
export interface InteractiveOption {
  /** 选项文案 */
  text: string;
  /** 选项前缀（A / B / ...，缺省按下标自动生成） */
  label?: string;
  /** 选择后跳转的目标节点 id */
  targetNodeId: string;
}

// ============================================
// 观看路径
// ============================================

/** 观看路径上的节点快照（剧情进度条数据源） */
export interface VisitedNode {
  /** 节点 id */
  nodeId: string;
  /**
   * 在该节点选择过的选项下标（-1 表示未选择 / 直线播放到底，
   * >= 0 表示在该节点走了对应分支）
   */
  selectedOptionIndex: number;
}

// ============================================
// 插件配置与 API
// ============================================

/** 互动视频插件配置 */
export interface InteractiveVideoPluginConfig {
  /** 节点表（id → 节点） */
  nodes: Record<string, InteractiveNode>;
  /** 起始节点 id */
  startNodeId: string;
  /** 选择分支后是否自动续播（默认 true） */
  autoPlay?: boolean;
  /**
   * 视频源解析器（可选）：节点带 avid 引用且未直接给 video 时，
   * 插件在首次加载该节点前调用它换取真实播放源（如按 avid 请求
   * playurl 接口，按协议 + 格式返回 URL 或清单对象）。
   * 解析结果按 avid 缓存在插件内，同一节点回看 / 重播不重复调用
   */
  resolveVideo?: (node: InteractiveNode) => Promise<PlayerSource> | PlayerSource;
  /** 业务回调：选择了某分支 */
  onOptionSelect?: (nodeId: string, optionIndex: number) => void;
  /** 业务回调：观看路径变化（剧情进度条数据源更新） */
  onPathChange?: (path: VisitedNode[]) => void;
  /** 业务回调：点击重播 */
  onReplay?: () => void;
}

/** 互动视频插件对外 API（经 player.getPluginAPI 获取；Plugin 基接口提供 name/install/uninstall） */
export interface InteractiveVideoPluginAPI extends Plugin {
  /** 当前观看路径（只读快照） */
  getPath(): VisitedNode[];
  /** 外部主动跳转节点（编辑器 / 外链场景） */
  jumpTo(nodeId: string): void;
  /** 从起始节点重播（重置路径） */
  replay(): void;
  /** 手动显示剧情进度条 */
  showStoryBar(): void;
  /** 手动隐藏剧情进度条 */
  hideStoryBar(): void;
}
