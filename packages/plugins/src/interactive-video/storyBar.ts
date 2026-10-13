/**
 * ============================================
 * 互动视频插件 — 剧情进度条（纯响应式 VNode 组件）
 * ============================================
 * 底部居中的半透明胶囊条：展示观众已走过的节点圆点，
 * 悬停圆点弹出节点标题 + 视频封面的悬停卡片（与圆点一一对应）。
 *
 * 响应式写法（与 interaction 插件 GuideCard 同模式）：
 * - 数据源为 Signal<StoryNodeEntry[]>，经 For 控制流按 key 渲染；
 * - class / style / display 直接绑定读 signal.value 的表达式，
 *   编译器（luminaCompile）自动追踪依赖，信号变化原位更新 DOM；
 * - 悬停态信号化：entry.hover 翻转时圆点图标切换（.hover 类）与
 *   悬停卡片显隐（display 表达式）同步更新，无需命令式操作
 *
 * 结构：
 * .nova-player-interaction-story（默认隐藏，visible 信号驱动显隐）
 *   ├─ .nova-player-interaction-oval-wrap
 *   │   └─ .nova-player-interaction-oval（宽度随节点数响应式伸缩）
 *   │       └─ .nova-player-interaction-oval-item(.position | .check)
 *   │           └─ .nova-player-interaction-oval-round
 *   │               ├─ .small.normal（常态 svg：黑底）
 *   │               └─ .small.hover（悬停 svg：#00A1D6 蓝底）
 *   └─ .nova-player-interaction-hover-wrap
 *       └─ .nova-player-interaction-hover-item × N（hover 信号驱动显隐）
 *           ├─ .nova-player-interaction-background
 *           ├─ .nova-player-interaction-text（节点标题）
 *           ├─ .nova-player-interaction-label（下指小三角，双层描边）
 *           │   ├─ .nova-player-interaction-label-one
 *           │   └─ .nova-player-interaction-label-two
 *           └─ .nova-player-interaction-cover > img（节点封面）
 */

import { h, For } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";
import type { InteractiveNode } from "./types";
import { renderCheckIcon, renderPositionIcon } from "./icons";

// ============================================
// 数据结构
// ============================================

/**
 * 剧情进度条节点条目（For 数据源单元，悬停态信号化）
 *
 * 与 interaction 插件的 ActiveCardEntry 同模式：
 * 交互状态以 signal 挂在条目上，跨 DOM 重建保留语义
 */
export interface StoryNodeEntry {
  /** For 稳定 key：路径下标 + 节点 id */
  id: string;
  /** 路径下标（悬停卡片 left 定位用） */
  index: number;
  /** 节点配置（标题 / 封面） */
  node: InteractiveNode;
  /** 是否正在观看（true = 位置图标 / false = 打勾图标） */
  isCurrent: boolean;
  /** 悬停态（驱动圆点图标切换与悬停卡片显隐） */
  hover: Signal<boolean>;
}

// ============================================
// 类型谓词（替代 as 断言收窄 For 回调的 unknown 参数）
// ============================================

/**
 * 判断 For 回调参数是否为剧情进度条节点条目
 *
 * @param item - For 回调参数（unknown）
 * @returns 是否为 StoryNodeEntry
 */
function isStoryEntry(item: unknown): item is StoryNodeEntry {
  return (
    typeof item === "object" &&
    item !== null &&
    "id" in item &&
    "node" in item &&
    "hover" in item
  );
}

// ============================================
// For 回调（每 key 只调用一次，信号读取由编译器追踪）
// ============================================

/**
 * 渲染单个节点圆点（读 hover 信号切换 .hover 类 → CSS 控制双图标显隐）
 *
 * @param item - For 回调参数（unknown，谓词收窄为 StoryNodeEntry）
 * @returns 圆点 VNode
 */
function renderOvalItem(item: unknown): VNode {
  if (!isStoryEntry(item)) return h("div", {});

  return h(
    "div",
    {
      // 类名表达式：类型变体（position / check）+ 悬停态（hover），
      // hover 信号翻转时编译器原位更新 className
      class: `nova-player-interaction-oval-item ${item.isCurrent ? "position" : "check"}${item.hover.value ? " hover" : ""}`,
      // 悬停翻转信号：圆点图标切换 + 对应悬停卡片显隐同步更新
      onMouseEnter: (): void => {
        item.hover.value = true;
      },
      onMouseLeave: (): void => {
        item.hover.value = false;
      },
    },
    h(
      "div",
      { class: "nova-player-interaction-oval-round" },
      // 双图标层叠放：normal 常态 / hover 悬停（CSS 显隐，DOM 恒在）
      h(
        "span",
        { class: "small normal" },
        item.isCurrent ? renderPositionIcon(false) : renderCheckIcon(false),
      ),
      h(
        "span",
        { class: "small hover" },
        item.isCurrent ? renderPositionIcon(true) : renderCheckIcon(true),
      ),
    ),
  );
}

/**
 * 渲染单个悬停卡片（hover 信号驱动 display 与 left 定位表达式）
 *
 * @param item - For 回调参数（unknown，谓词收窄为 StoryNodeEntry）
 * @returns 悬停卡片 VNode
 */
function renderHoverItem(item: unknown): VNode {
  if (!isStoryEntry(item)) return h("div", {});

  return h(
    "div",
    {
      class: "nova-player-interaction-hover-item",
      // display 表达式：hover 信号翻转时原位切换显隐；
      // left 表达式：按路径下标定位（每项 50px，圆点中心对齐，
      // 卡片自身 margin-left: -35px 已含微调）
      style: {
        display: item.hover.value ? "block" : "none",
        left: `${5 + 20 + item.index * 50}px`,
      },
    },
    // 标题条背景
    h("div", { class: "nova-player-interaction-background" }),
    // 标题文本（单行省略）
    h(
      "div",
      { class: "nova-player-interaction-text" },
      item.node.title,
    ),
    // 下指小三角（双层描边）
    h(
      "div",
      { class: "nova-player-interaction-label" },
      h("div", { class: "nova-player-interaction-label-one" }),
      h("div", { class: "nova-player-interaction-label-two" }),
    ),
    // 节点封面（标题条上方悬浮）
    h(
      "div",
      { class: "nova-player-interaction-cover" },
      h("img", { src: item.node.cover, alt: item.node.title }),
    ),
  );
}

// ============================================
// 剧情进度条根组件
// ============================================

/**
 * 渲染剧情进度条（For 控制流 × 2：圆点行 + 悬停卡片行共用同一数据源）
 *
 * @param entries - 节点条目信号（整组替换，For 按 id diff 增删）
 * @param visible - 显隐信号（display 表达式驱动）
 * @returns 剧情进度条根 VNode
 */
export function renderStoryBar(
  entries: Signal<StoryNodeEntry[]>,
  visible: Signal<boolean>,
): VNode {
  /** For 稳定 key 提取函数 */
  const entryKey = (item: unknown): string =>
    isStoryEntry(item) ? item.id : String(item);

  return h(
    "div",
    {
      class: "nova-player-interaction-story",
      // display 表达式：visible 信号驱动显隐
      style: { display: visible.value ? "flex" : "none" },
    },
    // 圆点外层（限宽裁剪）
    h(
      "div",
      { class: "nova-player-interaction-oval-wrap" },
      h(
        "div",
        {
          class: "nova-player-interaction-oval",
          // 宽度表达式：节点数变化时响应式伸缩（CSS transition 平滑）
          style: { width: `${entries.value.length * 50}px` },
        },
        h(For, { each: entries, key: entryKey, render: renderOvalItem }),
      ),
    ),
    // 悬停卡片挂载点（零尺寸定位基准，卡片绝对定位向外展开）
    h(
      "div",
      { class: "nova-player-interaction-hover-wrap" },
      h(For, { each: entries, key: entryKey, render: renderHoverItem }),
    ),
  );
}
