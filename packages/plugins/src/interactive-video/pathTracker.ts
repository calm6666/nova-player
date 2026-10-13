/**
 * ============================================
 * 互动视频插件 — 观看路径维护 (pathTracker)
 * ============================================
 * 维护观众在节点树中实际走过的路径（VisitedNode 快照列表），
 * 作为剧情进度条（story bar）的数据源。
 *
 * 「历史保留 + 游标」语义：
 * - 观看路径是节点树上一条从起点出发的路径，进度条显示实际走过的
 *   全部节点（历史不丢弃）；
 * - 「当前所在节点」由游标（cursor）标记 —— 回看跳转（点击剧情条
 *   上已看过的圆点）只移动游标、不截断历史，已看过的点全部保留，
 *   之后仍可再次点击跳转；
 * - 从游标节点选择新分支 = 截断游标之后的旧分支历史再追加新节点
 *   （新选择覆盖旧分支）；
 * - 重播 = 清空路径回到起始节点。
 */

import type { InteractiveNode, VisitedNode } from "./types";

/**
 * 观看路径追踪器（纯数据逻辑，不碰 DOM）
 */
export class PathTracker {
  /** 节点表引用（id → 节点），用于取节点标题与封面 */
  private readonly nodes: Record<string, InteractiveNode>;

  /** 起始节点 id（重播回落点） */
  private readonly startNodeId: string;

  /** 观看路径快照（按观看顺序排列的完整历史） */
  private path: VisitedNode[] = [];

  /**
   * 当前所在节点在路径中的下标（游标）：
   * 回看跳转只移动游标不截断路径；选择新分支时截断游标之后的
   * 历史再追加，游标随之指向末项
   */
  private cursor = 0;

  /**
   * @param nodes - 节点表
   * @param startNodeId - 起始节点 id（构造时即初始化路径）
   */
  constructor(nodes: Record<string, InteractiveNode>, startNodeId: string) {
    this.nodes = nodes;
    this.startNodeId = startNodeId;
    // 初始路径：仅起始节点，未选择任何选项（游标指向它）
    this.path = [{ nodeId: startNodeId, selectedOptionIndex: -1 }];
  }

  /** 当前观看路径（完整历史，只读快照，调用方不得修改） */
  getPath(): VisitedNode[] {
    return [...this.path];
  }

  /** 当前所在节点在路径中的下标（游标；剧情条 isCurrent 判定用） */
  getCursorIndex(): number {
    return this.cursor;
  }

  /** 当前所在节点 id（游标节点；路径为空时回落起始节点） */
  getCurrentNodeId(): string {
    return this.path.length > 0
      ? this.path[this.cursor].nodeId
      : this.startNodeId;
  }

  /** 按节点 id 取节点配置（无匹配时返回 undefined） */
  getNode(nodeId: string): InteractiveNode | undefined {
    return this.nodes[nodeId];
  }

  /**
   * 跳转到目标节点（点击剧情条圆点 / 分支选择后调用）：
   * - 目标在历史路径中：仅移动游标到该节点并重置其选择记录，
   *   路径不截断 —— 已看过的点全部保留，之后仍可再次点击跳转
   *   （含分支指回路径中已有节点的环路场景）
   * - 目标是全新节点：截断游标之后的旧分支历史（新选择覆盖旧
   *   分支），追加到游标之后，游标随之指向末项
   *
   * @param nodeId - 目标节点 id
   * @returns 新路径快照
   */
  jumpTo(nodeId: string): VisitedNode[] {
    /** 目标在历史路径中的下标（不在路径中为 -1） */
    const historyIndex = this.path.findIndex((item) => item.nodeId === nodeId);

    if (historyIndex >= 0) {
      // 回看跳转：移动游标 + 重置该节点的选择记录（回到该节点重新选），
      // 历史路径原样保留
      this.cursor = historyIndex;
      this.path[historyIndex] = { nodeId, selectedOptionIndex: -1 };
    } else {
      // 全新节点：丢弃游标之后的旧分支（从游标处重走新分支），
      // 追加到游标之后并将游标推进到末项
      this.path = this.path.slice(0, this.cursor + 1);
      this.path.push({ nodeId, selectedOptionIndex: -1 });
      this.cursor = this.path.length - 1;
    }

    return this.getPath();
  }

  /**
   * 记录当前（游标）节点上选择的选项
   * （回看状态下给旧节点重新选分支时写入的是游标项而非末项）
   *
   * @param optionIndex - 选项下标
   */
  selectOption(optionIndex: number): void {
    if (this.path.length === 0) return;
    this.path[this.cursor] = {
      ...this.path[this.cursor],
      selectedOptionIndex: optionIndex,
    };
  }

  /** 当前（游标）节点是否已选择过选项（分支时间窗状态机判定用） */
  hasSelected(): boolean {
    return (
      this.path.length > 0 &&
      this.path[this.cursor].selectedOptionIndex >= 0
    );
  }

  /**
   * 重播：清空路径回到起始节点（选择记录一并重置，游标归零）
   *
   * @returns 新路径快照
   */
  reset(): VisitedNode[] {
    this.path = [{ nodeId: this.startNodeId, selectedOptionIndex: -1 }];
    this.cursor = 0;
    return this.getPath();
  }
}
