/**
 * ============================================
 * 弹幕列表视图类型（DanmakuList）
 * ============================================
 * 视图层与弹幕插件的数据契约：
 * - 插件侧只持有播放器弹幕数据（@/types/danmaku 的 DanmakuItem）；
 * - 视图侧只消费已格式化的展示行 DanmakuListRow（时间 mm:ss / 发送时间）；
 * - 面板状态类型（菜单 / 排序 / 屏蔽 tab / 加载态）与源组件保持一致，
 *   交互逻辑原样移植，仅把 Solid 原语替换为 Lumina 原语。
 */

import type { DanmakuItem as PlayerDanmakuItem } from "@/types/danmaku";

// ============================================
// 面板状态
// ============================================

/** 下拉面板当前菜单：弹幕列表 / 屏蔽设定 / 高级弹幕 */
export type DanmakuMenu = "LIST" | "BLOCK" | "ADV";

/** 弹幕列表排序列：时间(stime) / 弹幕内容(text) / 发送时间(date) */
export type DanmakuOrderKey = "stime" | "text" | "date";

/** 屏蔽设定 tab：屏蔽文本 / 屏蔽正则 / 屏蔽用户 */
export type BlockTab = "text" | "regex" | "user";

/** 加载状态：0=填充中 1=完成 2=装填失败可重试 */
export type DanmakuLoadingState = 0 | 1 | 2;

// ============================================
// 展示数据
// ============================================

/**
 * 列表行（视图层展示数据）
 *
 * 所有字段均为渲染直接可用的值：播放器弹幕的秒数在插件数据同步时
 * 完成 mm:ss 格式化，视图内不再做时间换算。
 */
export interface DanmakuListRow {
  /** 弹幕 ID（列表 key / 屏蔽定位） */
  id: string | number;
  /** 展示用时间：mm:ss（也兼容 h:mm:ss） */
  time: string;
  /** 弹幕正文 */
  text: string;  /** 展示用发送时间：MM-dd HH:mm；数据源无时间戳时为空串 */
  date: string;
  /** 发送日期 key：yyyy-MM-dd（历史弹幕可选日期推导用） */
  dateKey?: string;
  /** 出现秒数（点击行跳转使用） */
  stime: number;
  /** 发送时间排序键（无发送时间时为 0） */
  dateTs: number;
  /** 用户 hash（屏蔽用户 tab 使用） */
  uhash?: string;
  /** 用户名（屏蔽用户 / 上报使用） */
  uname?: string;
  /** 弹幕模式：1=滚动 4=底部 5=顶部 7=特殊 8=代码 9=BAS */
  mode?: number;
  /** 是否处于「已屏蔽」状态（对应 dm-info-row-block） */
  blocked?: boolean;
  /** 是否已屏蔽该用户（对应 dm-info-block-btn.dm-info-blocked） */
  blockedUser?: boolean;
  /** 是否本人发送（列表「我」标记，与引擎 uid=1 判定一致） */
  own?: boolean;
}

/** 屏蔽词条目（屏蔽设定面板列表行） */
export interface BlockWordItem {
  /** 唯一 id */
  id: number | string;
  /** 内容：屏蔽文本 / 正则 / 用户名 */
  value: string;
  /** 状态：开启 / 关闭（对应 nova-player-disabled） */
  enabled: boolean;
  /** tab 归类 */
  tab: BlockTab;
}

/** 高级弹幕表单值（本地 state，字段与源组件 adv 面板一致） */
export interface AdvDanmakuForm {
  /** 弹幕颜色 */
  color: string;
  /** 字体大小 */
  size: string;
  /** 文本字体 */
  fontFamily: string;
  /** 文字描边 */
  stroke: boolean;
  /** Z 轴翻转 */
  zRotate: string;
  /** Y 轴翻转 */
  yRotate: string;
  /** 生存时间 */
  duration: string;
  /** 衰弱透明度起始 */
  sOpacity: string;
  /** 衰弱透明度结束 */
  eOpacity: string;
  /** 运动耗时(ms) */
  aTime: string;
  /** 延迟时间(ms) */
  aDelay: string;
  /** 线性加速 */
  speedup: boolean;
  /** 运动方式：起始位置 / 路径跟随 */
  way: "start" | "path";
  /** 按百分比 */
  percent: boolean;
  /** 起始 X/Y */
  startX: string;
  startY: string;
  /** 结束 X/Y */
  endX: string;
  endY: string;
  /** 弹幕正文 */
  text: string;
  /** 当前时间（勾选时出现时间禁用） */
  currentTime: boolean;
  /** 弹幕出现时间 hh:mm:ss */
  showtime: string;
}

// ============================================
// 组件契约
// ============================================

/**
 * 列表视图交互回调
 *
 * 视图只负责派发语义事件，播放器行为（跳转 / 发送 / 上报）由插件
 * 在挂载视图时接线，避免 UI 逻辑与插件耦合。
 */
export interface DanmakuListHandlers {
  /** 点击弹幕行跳转（秒） */
  onSeek?: (seconds: number, row: DanmakuListRow) => void;
  /** 排序变化 */
  onOrderChange?: (info: { order: DanmakuOrderKey; positive: boolean }) => void;
  /** 展开/折叠变化 */
  onFoldChange?: (expanded: boolean) => void;
  /** 面板切换（LIST / BLOCK / ADV） */
  onPanelChange?: (panel: DanmakuMenu) => void;
  /** 查看历史弹幕选择日期（yyyy-MM-dd） */
  onHistoryDate?: (date: string) => void;
  /** 屏蔽用户 / 取消屏蔽 */
  onBlockUser?: (row: DanmakuListRow) => void;
  /** 举报 */
  onReport?: (row: DanmakuListRow) => void;
  /** 批量屏蔽 */
  onBatchBlock?: (rows: DanmakuListRow[]) => void;
  /** 装填失败点击重试 */
  onLoadRetry?: () => void;
  /** 屏蔽词新增 / 删除 / 状态切换 */
  onBlockWordsChange?: (words: BlockWordItem[]) => void;
  /** 高级弹幕提交（测试效果 / 发送弹幕） */
  onAdvSubmit?: (form: AdvDanmakuForm, kind: "test" | "send") => void;
}

/** 弹幕列表组件属性 */
export interface DanmakuListProps {
  /** 弹幕展示行（响应式数据源：插件经 signal 传入，更新即重排列表） */
  rows: readonly DanmakuListRow[];
  /** 是否登录：影响「举报」「查看历史弹幕」「同步屏蔽列表」等 */
  loggedIn?: boolean;
  /** 初始是否展开（默认折叠态） */
  defaultExpanded?: boolean;
  /** 面板整体高度 px，默认 380 */
  height?: number;
  /** 历史弹幕可点日期集合（yyyy-MM-dd） */
  historyDates?: readonly string[];
  /** 开启后单击行=切换选中（默认单击跳转，Ctrl/Meta+单击选中） */
  selectable?: boolean;
  /** 交互回调 */
  handlers?: DanmakuListHandlers;
}

/** 列表挂载句柄（插件持有，用于数据同步与卸载） */
export interface DanmakuListViewHandle {
  /** 动态替换列表数据（播放器弹幕 → 展示行由视图内部完成） */
  setList(list: readonly PlayerDanmakuItem[]): void;
  /** 卸载视图并释放节点 */
  dispose(): void;
}
