/**
 * ============================================
 * 互动视频插件 — 剧情进度条（纯响应式 VNode 组件）
 * ============================================
 * 底部居中的半透明胶囊条：展示观众已走过的节点圆点，
 * 悬停圆点弹出节点标题 + 视频封面的悬停卡片（与圆点一一对应），
 * 点击已看完的圆点可跳回该节点重新观看（路径截断到该节点）。
 *
 * 响应式写法（与 interaction 插件 GuideCard 同模式）：
 * - 数据源为 Signal<StoryNodeEntry[]>，经 For 控制流按 key 渲染；
 * - class / style / display 直接绑定读 signal.value 的表达式，
 *   编译器（luminaCompile）自动追踪依赖，信号变化原位更新 DOM；
 * - 悬停态信号化：entry.hover 翻转时圆点图标切换（.hover 类）与
 *   悬停卡片显隐（display 表达式）同步更新，无需命令式操作
 *
 * 【图标切换必须走 class + CSS 显隐】For 按 key 复用已存在条目的
 * DOM、不会重跑 render 回调 —— 路径推进后旧条目从「正在观看」变为
 * 「已看完」时，children 里的结构三元（position / check 图标选哪个）
 * 是创建时的静态快照、永远不会重建；只有 class 表达式（读 isCurrent
 * 信号）会被编译器持续追踪原位更新。因此四种图标（位置 / 打勾 ×
 * 常态 / 悬停）全部渲染进 DOM，由 .position / .check 类控制显隐。
 *
 * 布局（宽度不够自动换行，不缩小圆点）：
 * - 圆点固定 40px、间距 10px；胶囊条最大占播放器宽度 80%；
 * - 放不下时 flex-wrap 自动换到下一行，每行内容居中；
 * - 悬停卡片中心对齐圆点中心，太靠边时向内收窄（clamp）不被遮挡；
 * - 全屏 / 非全屏 / 窗口缩放 / 播放器尺寸不同都经 layerWidth 信号
 *   驱动换行与卡片定位动态重算
 *
 * 结构：
 * .nova-player-interaction-story（默认隐藏，visible 信号驱动显隐）
 *   ├─ .nova-player-interaction-oval-wrap
 *   │   └─ .nova-player-interaction-oval（flex-wrap 换行容器，
 *   │       max-width 由插件按播放器宽度内联）
 *   │       └─ .nova-player-interaction-oval-item(.position | .check [.hover])
 *   │           └─ .nova-player-interaction-oval-round
 *   │               ├─ .small.normal（常态：.icon-position / .icon-check 二选一显示）
 *   │               └─ .small.hover（悬停：.icon-position / .icon-check 二选一显示）
 *   └─ .nova-player-interaction-hover-wrap（零尺寸定位基准，位于胶囊条左上角）
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
 * 交互状态以 signal 挂在条目上，跨 DOM 重建保留语义。
 * 【isCurrent 必须信号化】For 按 key 复用已存在条目的 DOM、
 * 不会重跑 render 回调 —— 路径推进后旧条目从「正在观看」变为
 * 「已看完」时，图标切换只能靠信号驱动（普通 boolean 在回调
 * 闭包里是创建时的静态快照，永远不更新）
 */
export interface StoryNodeEntry {
  /** For 稳定 key：路径下标 + 节点 id */
  id: string;
  /** 路径下标（悬停卡片定位 / 点击跳转用） */
  index: number;
  /** 节点配置（标题 / 封面） */
  node: InteractiveNode;
  /** 是否正在观看（true = 位置图标 / false = 打勾图标；信号驱动图标切换） */
  isCurrent: Signal<boolean>;
  /** 悬停态（驱动圆点图标切换与悬停卡片显隐） */
  hover: Signal<boolean>;
}

// ============================================
// 布局参数（宽度不够自动换行，圆点尺寸恒定）
// ============================================

/** 圆点尺寸（固定不缩小：放不下换行而不是缩） */
const STORY_DOT_SIZE = 40;
/** 圆点行内 / 行间间距 */
const STORY_DOT_GAP = 10;
/** 悬停卡片宽度（标题条 119px，见 scss 的 hover-item） */
const STORY_CARD_WIDTH = 119;
/** 悬停卡片距播放器左右边缘的最小留白 */
const STORY_CARD_EDGE_PADDING = 8;
/** 剧情条最大占播放器宽度的比例（超出换行） */
const STORY_MAX_RATIO = 0.8;

/**
 * 按播放器宽度计算剧情条换行布局（纯函数，响应式表达式内调用）
 *
 * 圆点固定 40px：全部圆点单行放不下时按最大宽度折算每行容纳数
 * （cols），放不下的自动换到下一行（CSS flex-wrap），每行内容居中。
 *
 * @param layerWidth - 播放器（互动层）当前宽度（px）
 * @param count - 路径节点数
 * @returns 换行布局：每行圆点数 / 胶囊条内容宽（最大行宽）
 */
function computeWrapLayout(layerWidth: number, count: number): {
  cols: number;
  contentWidth: number;
} {
  if (count <= 0) {
    return { cols: 1, contentWidth: 0 };
  }
  /** 胶囊条内容可用最大宽度（窄屏至少容纳 2 个圆点） */
  const maxWidth = Math.max(
    2 * STORY_DOT_SIZE + STORY_DOT_GAP,
    layerWidth * STORY_MAX_RATIO,
  );
  /** 单行容纳数：n 个圆点占 n*40 + (n-1)*10 ≤ maxWidth */
  const cols = Math.max(
    1,
    Math.floor((maxWidth + STORY_DOT_GAP) / (STORY_DOT_SIZE + STORY_DOT_GAP)),
  );
  const usedCols = Math.min(count, cols);
  return {
    cols,
    contentWidth:
      usedCols * STORY_DOT_SIZE + (usedCols - 1) * STORY_DOT_GAP,
  };
}

/**
 * 计算指定圆点的位置（换行布局下的行列坐标，纯函数）
 *
 * @param layerWidth - 播放器（互动层）当前宽度（px）
 * @param count - 路径节点数
 * @param index - 目标圆点的路径下标
 * @returns dotCenterX（圆点中心在播放器中的 x）/ dotTopY（圆点顶
 *          相对胶囊条顶的 y）
 */
function computeDotPosition(
  layerWidth: number,
  count: number,
  index: number,
): {
  dotCenterX: number;
  dotTopY: number;
} {
  const { cols, contentWidth } = computeWrapLayout(layerWidth, count);
  /** 目标圆点的行 / 列 / 所在行的实际圆点数 */
  const row = Math.floor(index / cols);
  const col = index % cols;
  const rowCount = Math.min(cols, count - row * cols);
  /** 所在行内容宽（每行独立居中） */
  const rowWidth = rowCount * STORY_DOT_SIZE + (rowCount - 1) * STORY_DOT_GAP;
  /** 胶囊条整体水平居中（内容区中心 = 播放器中心） */
  const contentLeft = (layerWidth - contentWidth) / 2;
  return {
    dotCenterX:
      contentLeft +
      (contentWidth - rowWidth) / 2 +
      col * (STORY_DOT_SIZE + STORY_DOT_GAP) +
      STORY_DOT_SIZE / 2,
    dotTopY: row * (STORY_DOT_SIZE + STORY_DOT_GAP),
  };
}

/**
 * 悬停卡片中心的层坐标 X（纯函数，响应式表达式内调用）
 *
 * 默认对齐圆点中心；圆点太靠边时按播放器左右边界向内收窄（clamp），
 * 保证卡片不被遮挡。
 *
 * @param layerWidth - 播放器（互动层）当前宽度（px）
 * @param count - 路径节点数
 * @param index - 目标圆点的路径下标
 * @returns 卡片中心在播放器中的 x
 */
function computeHoverCardX(
  layerWidth: number,
  count: number,
  index: number,
): number {
  const { dotCenterX } = computeDotPosition(layerWidth, count, index);
  /** 卡片半宽 + 边缘最小留白 */
  const minX = STORY_CARD_WIDTH / 2 + STORY_CARD_EDGE_PADDING;
  return Math.min(
    Math.max(dotCenterX, minX),
    Math.max(minX, layerWidth - minX),
  );
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
 * 渲染单个节点圆点
 *
 * 图标显隐完全由 class 驱动（CSS 控制）：.position / .check 挑图标
 * 种类、.hover 挑常态 / 悬停变体 —— class 表达式读信号被编译器持续
 * 追踪，For 复用 DOM 时也能原位更新（children 结构三元不可响应，
 * 四种图标必须全部渲染进 DOM）。
 *
 * @param item - For 回调参数（unknown，谓词收窄为 StoryNodeEntry）
 * @param onSeekNode - 点击跳转回调（点击已看完的圆点跳回该节点）
 * @returns 圆点 VNode
 */
function renderOvalItem(
  item: unknown,
  onSeekNode: (index: number) => void,
): VNode {
  if (!isStoryEntry(item)) return h("div", {});

  return h(
    "div",
    {
      // 类名表达式：类型变体（position / check）+ 悬停态（hover）。
      // 【isCurrent 信号化】For 复用 DOM 不重跑回调，路径推进后
      // 「正在观看 → 已看完」的图标切换由信号驱动 class 原位更新，
      // CSS 再按 class 挑选四种图标中的对应一种显示
      class: `nova-player-interaction-oval-item ${item.isCurrent.value ? "position" : "check"}${item.hover.value ? " hover" : ""}`,
      // 悬停翻转信号：圆点图标切换 + 对应悬停卡片显隐同步更新
      onMouseEnter: (): void => {
        item.hover.value = true;
      },
      onMouseLeave: (): void => {
        item.hover.value = false;
      },
      // 点击跳转：点击圆点跳回对应节点（当前节点 / 越界由回调内守卫）
      onClick: (): void => {
        onSeekNode(item.index);
      },
    },
    h(
      "div",
      { class: "nova-player-interaction-oval-round" },
      // 常态图标层（.small.normal）：位置 / 打勾二选一（CSS 类控显隐）
      h(
        "span",
        { class: "small normal" },
        h(
          "div",
          { class: "icon-position" },
          renderPositionIcon(false),
        ),
        h("div", { class: "icon-check" }, renderCheckIcon(false)),
      ),
      // 悬停图标层（.small.hover）：位置 / 打勾二选一（CSS 类控显隐）
      h(
        "span",
        { class: "small hover" },
        h("div", { class: "icon-position" }, renderPositionIcon(true)),
        h("div", { class: "icon-check" }, renderCheckIcon(true)),
      ),
    ),
  );
}

/**
 * 渲染单个悬停卡片（hover 信号驱动 display 与定位表达式）
 *
 * 定位协议（换行布局 + 播放器宽度自适应）：
 * - 卡片水平中心对齐对应圆点中心（图标正上方）；
 * - 太靠边的圆点卡片按播放器左右边界向内收窄（clamp），不被遮挡；
 * - 垂直方向悬在对应行圆点上方（换行后跟随所在行，top 按行动态）
 *
 * @param item - For 回调参数（unknown，谓词收窄为 StoryNodeEntry）
 * @param layerWidth - 互动层宽度信号（定位表达式读取，动态变换）
 * @param entries - 条目数组信号（布局参数读节点数）
 * @returns 悬停卡片 VNode
 */
function renderHoverItem(
  item: unknown,
  layerWidth: Signal<number>,
  entries: Signal<StoryNodeEntry[]>,
): VNode {
  if (!isStoryEntry(item)) return h("div", {});

  return h(
    "div",
    {
      class: "nova-player-interaction-hover-item",
      // 【left / top 必须是表达式内计算】在回调体内先解构再拼字符串
      // 是创建时的静态快照 —— 全屏切换 / 窗口缩放导致的换行行列
      // 变化永远不会更新（第二排圆点的卡片会停留在第一排位置）；
      // 写成属性表达式（读取 layerWidth / entries 信号）后编译器
      // 持续追踪、原位更新。
      // 坐标基准：hover-wrap 挂在全宽 story 的左上角 = 播放器左缘，
      // left 即卡片中心的层坐标（clamp 后）；top 悬在圆点所在行
      // 上方 27px（换行后按行动态跟随）
      style: {
        display: item.hover.value ? "block" : "none",
        left: `${computeHoverCardX(
          layerWidth.value,
          entries.value.length,
          item.index,
        )}px`,
        top: `${
          computeDotPosition(
            layerWidth.value,
            entries.value.length,
            item.index,
          ).dotTopY - 27
        }px`,
        transform: "translateX(-50%)",
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
    // 下指小三角（双层描边；卡片底部中央指向圆点，见 scss label 定位）
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
 * @param layerWidth - 互动层宽度信号（ResizeObserver 驱动：全屏 /
 *                    非全屏 / 窗口缩放时换行布局与悬停卡片定位动态变换）
 * @param onSeekNode - 点击圆点跳转回调（路径下标；当前节点由主类守卫）
 * @returns 剧情进度条根 VNode
 */
export function renderStoryBar(
  entries: Signal<StoryNodeEntry[]>,
  visible: Signal<boolean>,
  layerWidth: Signal<number>,
  onSeekNode: (index: number) => void,
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
    // 圆点外层（换行容器的外壳：宽度由内容撑开）
    h(
      "div",
      { class: "nova-player-interaction-oval-wrap" },
      h(
        "div",
        {
          class: "nova-player-interaction-oval",
          // 最大宽度表达式（播放器宽度自适应）：超过 80% 播放器宽度
          // 时 CSS flex-wrap 自动换行（每行居中），圆点尺寸不变
          style: {
            maxWidth: `${Math.max(
              2 * STORY_DOT_SIZE + STORY_DOT_GAP,
              layerWidth.value * STORY_MAX_RATIO,
            )}px`,
          },
        },
        // render 回调闭包捕获信号引用：For 新建条目时求值一次，
        // 后续信号变化（宽度 / 节点数 / 悬停 / isCurrent）由
        // 编译器追踪表达式原位更新，无需重跑回调
        h(For, {
          each: entries,
          key: entryKey,
          render: (item: unknown): VNode =>
            renderOvalItem(item, onSeekNode),
        }),
      ),
    ),
    // 悬停卡片挂载点（零尺寸定位基准，位于胶囊条左上角，
    // 卡片绝对定位向外展开）
    h(
      "div",
      { class: "nova-player-interaction-hover-wrap" },
      h(For, {
        each: entries,
        key: entryKey,
        render: (item: unknown): VNode =>
          renderHoverItem(item, layerWidth, entries),
      }),
    ),
  );
}
