/**
 * ============================================
 * 互动视频插件 — 观看路径维护 (pathTracker)
 * ============================================
 * 维护观众在节点树中实际走过的路径（VisitedNode 快照列表），
 * 作为剧情进度条（story bar）的数据源。
 *
 * 主流互动视频模式：观看路径是节点树上一条从起点出发的路径，
 * 中间可以有很多分支，但进度条只显示实际走过的节点；
 * 从某节点选择新分支 = 截断该节点之后的历史再追加新节点；
 * 重播 = 清空路径回到起始节点。
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

  /** 观看路径快照（按观看顺序排列，最后一项为当前节点） */
  private path: VisitedNode[] = [];

  /**
   * @param nodes - 节点表
   * @param startNodeId - 起始节点 id（构造时即初始化路径）
   */
  constructor(nodes: Record<string, InteractiveNode>, startNodeId: string) {
    this.nodes = nodes;
    this.startNodeId = startNodeId;
    // 初始路径：仅起始节点，未选择任何选项
    this.path = [{ nodeId: startNodeId, selectedOptionIndex: -1 }];
  }

  /** 当前观看路径（只读快照，调用方不得修改） */
  getPath(): VisitedNode[] {
    return [...this.path];
  }

  /** 当前所在节点 id（路径最后一项；路径为空时回落起始节点） */
  getCurrentNodeId(): string {
    return this.path.length > 0
      ? this.path[this.path.length - 1].nodeId
      : this.startNodeId;
  }

  /** 按节点 id 取节点配置（无匹配时返回 undefined） */
  getNode(nodeId: string): InteractiveNode | undefined {
    return this.nodes[nodeId];
  }

  /**
   * 跳转到目标节点（外部 jumpTo / 分支选择后调用）：
   * - 目标已是当前节点：仅重置其选择记录（回到该节点重新选）
   * - 目标在历史路径中：截断路径到该节点（重走其后的分支），
   *   并重置其选择记录
   * - 目标是全新节点：追加到路径末尾（前一项的选择记录保持不变）
   *
   * @param nodeId - 目标节点 id
   * @returns 新路径快照
   */
  jumpTo(nodeId: string): VisitedNode[] {
    /** 目标在历史路径中的下标（不在路径中为 -1） */
    const historyIndex = this.path.findIndex((item) => item.nodeId === nodeId);

    if (historyIndex >= 0) {
      // 截断到目标节点并重置其选择记录（重新在该节点做选择）
      this.path = this.path.slice(0, historyIndex + 1);
      this.path[historyIndex] = { nodeId, selectedOptionIndex: -1 };
    } else {
      // 全新节点：追加（前驱节点的选择记录在 selectOption 时已写入）
      this.path.push({ nodeId, selectedOptionIndex: -1 });
    }

    return this.getPath();
  }

  /**
   * 记录当前节点上选择的选项（写入路径最后一项的选择记录）
   *
   * @param optionIndex - 选项下标
   */
  selectOption(optionIndex: number): void {
    if (this.path.length === 0) return;
    const lastIndex = this.path.length - 1;
    this.path[lastIndex] = {
      ...this.path[lastIndex],
      selectedOptionIndex: optionIndex,
    };
  }

  /**
   * 重播：清空路径回到起始节点（选择记录一并重置）
   *
   * @returns 新路径快照
   */
  reset(): VisitedNode[] {
    this.path = [{ nodeId: this.startNodeId, selectedOptionIndex: -1 }];
    return this.getPath();
  }
}
