/**
 * ============================================
 * 弹幕列表面板视图（DanmakuList）
 * ============================================
 * 职责：把源仓库 Solid 组件 DanmakuList 完整移植为播放器自研 Lumina 实现，
 * 作为弹幕插件的列表 UI（插件只负责挂载与数据同步，UI 全部收敛在此）。
 *
 * 写法与现有 player / plugins 组件保持一致：
 * - defineComponent + h 渲染，signal / For / Show / onEffect 驱动更新；
 * - 动态 class/style/aria 等属性直接写表达式（如
 *   class: ["base", { "state-on": signal.value }]），由编译插件提取为
 *   由编译插件自动提取为响应式属性，挂载时注册 effect 精准更新 DOM；
 * - 动态文本直接写表达式或 t(...) 子节点，编译插件包装为响应式文本节点；
 * - 列表全量渲染（1000+ 条一次挂载），滚动仅更新容器 transform 与滚动条，
 *   不做虚拟窗口 diff，避免滚动时行 DOM 反复重建；
 * - 挂载 / 卸载由 mount / destroy 完成，不引入任何第三方组件运行时。
 *
 * DOM 结构与源组件一致（仅类名前缀按项目约定重命名）：
 * - 根 .nova-docker.nova-docker-minor > .nova-player-auxiliary
 * - 折叠面板 .ui-collapse：header（标题 / 下拉菜单）+ body（三面板）
 * - LIST 面板：排序头 + 弹幕列表（自绘 nscroll 滚动条）+ 查看历史弹幕
 * - BLOCK 面板：屏蔽列表开关 / 同步 / 添加屏蔽词 / tab / 屏蔽词列表
 * - ADV 面板：高级弹幕表单（颜色 / 字号 / 字体 / 旋转 / 坐标 / 正文 / 发送）
 * - 三面板共用 .ui-* 公共控件样式（packages/player/src/styles/ui.scss），
 *   面板私有样式在本目录 DanmakuList.scss。
 *
 * 样式作用域：挂载容器由插件追加 .danmaku-wrap，本组件不额外包 DOM。
 */

import {
  defineComponent,
  destroy,
  For,
  h,
  mount,
  signal,
  t,
  onEffect,
  Show,
} from "@/core";
import type { VNode } from "@/types";
import type { DanmakuItem as PlayerDanmakuItem } from "@/types/danmaku";

import {
  CheckboxIcon,
  CheckboxSelectedIcon,
  CloseIcon,
  CollapseArrowIcon,
  DateNextIcon,
  DatePrevIcon,
  DropdownIcon,
  ListSyncIcon,
  SortArrowIcon,
  SyncIcon,
  TrashIcon,
} from "./icons";
import type {
  AdvDanmakuForm,
  BlockTab,
  BlockWordItem,
  DanmakuListProps,
  DanmakuListRow,
  DanmakuListViewHandle,
  DanmakuLoadingState,
  DanmakuMenu,
  DanmakuOrderKey,
} from "./types";

// ============================================
// i18n key 表
// ============================================

/** 弹幕列表面板文案 key（统一 player.ui.danmaku.* 命名空间） */
const KEYS = {
  listTitle: "player.ui.danmaku.listTitle",
  blockMenu: "player.ui.danmaku.block",
  advMenu: "player.ui.danmaku.adv",
  time: "player.ui.danmaku.time",
  content: "player.ui.danmaku.content",
  sendTime: "player.ui.danmaku.sendTime",
  loading: "player.ui.danmaku.loading",
  loadFailed: "player.ui.danmaku.loadFailed",
  retry: "player.ui.danmaku.retry",
  viewHistory: "player.ui.danmaku.viewHistory",
  selected: "player.ui.danmaku.selected",
  itemUnit: "player.ui.danmaku.itemUnit",
  deselect: "player.ui.danmaku.deselect",
  batchBlock: "player.ui.danmaku.batchBlock",
  blockUser: "player.ui.danmaku.blockUser",
  cancelBlockUser: "player.ui.danmaku.cancelBlockUser",
  report: "player.ui.danmaku.report",
  blockList: "player.ui.danmaku.blockList",
  syncBlockList: "player.ui.danmaku.syncBlockList",
  syncBlockWord: "player.ui.danmaku.syncBlockWord",
  addPlaceholder: "player.ui.danmaku.addPlaceholder",
  add: "player.ui.danmaku.add",
  blockText: "player.ui.danmaku.blockText",
  blockRegex: "player.ui.danmaku.blockRegex",
  blockUserTab: "player.ui.danmaku.blockUserTab",
  status: "player.ui.danmaku.status",
  operation: "player.ui.danmaku.operation",
  sync: "player.ui.danmaku.sync",
  statusOn: "player.ui.danmaku.statusOn",
  statusOff: "player.ui.danmaku.statusOff",
  unknownDate: "player.ui.danmaku.unknownDate",
  downloadBlockList: "player.ui.danmaku.downloadBlockList",
  loginDownloadBlockList: "player.ui.danmaku.loginDownloadBlockList",
  downloadedBlockList: "player.ui.danmaku.downloadedBlockList",
  specialDanmaku: "player.ui.danmaku.specialDanmaku",
  subtitleDanmaku: "player.ui.danmaku.subtitleDanmaku",
  blockedDanmaku: "player.ui.danmaku.blockedDanmaku",
  deletingDanmaku: "player.ui.danmaku.deletingDanmaku",
  basDanmaku: "player.ui.danmaku.basDanmaku",
  yearDisplay: "player.ui.danmaku.yearDisplay",
  historyDateLabel: "player.ui.danmaku.historyDateLabel",
  advColor: "player.ui.danmaku.adv.color",
  advFontSize: "player.ui.danmaku.adv.fontSize",
  advFontFamily: "player.ui.danmaku.adv.fontFamily",
  advStroke: "player.ui.danmaku.adv.stroke",
  advZRotate: "player.ui.danmaku.adv.zRotate",
  advYRotate: "player.ui.danmaku.adv.yRotate",
  advDuration: "player.ui.danmaku.adv.duration",
  advOpacity: "player.ui.danmaku.adv.opacity",
  advATime: "player.ui.danmaku.adv.aTime",
  advADelay: "player.ui.danmaku.adv.aDelay",
  advSpeedup: "player.ui.danmaku.adv.speedup",
  advWay: "player.ui.danmaku.adv.way",
  advWayStart: "player.ui.danmaku.adv.wayStart",
  advWayPath: "player.ui.danmaku.adv.wayPath",
  advCoordinates: "player.ui.danmaku.adv.coordinates",
  advPercent: "player.ui.danmaku.adv.percent",
  advStart: "player.ui.danmaku.adv.start",
  advEnd: "player.ui.danmaku.adv.end",
  advTracking: "player.ui.danmaku.adv.tracking",
  advBody: "player.ui.danmaku.adv.body",
  advShowtime: "player.ui.danmaku.adv.showtime",
  advCurrentTime: "player.ui.danmaku.adv.currentTime",
  advTest: "player.ui.danmaku.adv.test",
  advSend: "player.ui.danmaku.adv.send",
  advDialogText: "player.ui.danmaku.adv.dialogText",
  advDialogNo: "player.ui.danmaku.adv.dialogNo",
  advDialogCoin: "player.ui.danmaku.adv.dialogCoin",
  fontHei: "player.ui.danmaku.font.hei",
  fontSong: "player.ui.danmaku.font.song",
  fontNSong: "player.ui.danmaku.font.nsong",
  fontFangSong: "player.ui.danmaku.font.fangsong",
  fontYaHei: "player.ui.danmaku.font.yahei",
} as const;

// ============================================
// 布局常量（与源组件一致）
// ============================================

/** 行高：.ui-long-list-item / .dm-info-row 固定 24px */
const ROW_HEIGHT = 24;
/** 列表头 .nova-player-dm-function 高度 */
const HEADER_ROW_HEIGHT = 32;
/** 底部「查看历史弹幕」高度 + margin-top（31 + 8） */
const FOOTER_BLOCK_HEIGHT = 39;
/** 计算列表可视高度时扣除的固定高度（与源组件 height - 32 - 39 一致） */
const LIST_HEIGHT_OFFSET = HEADER_ROW_HEIGHT + FOOTER_BLOCK_HEIGHT;
/** 折叠面板 header 高度 */
const COLLAPSE_HEADER_HEIGHT = 44;
/** 面板默认高度 */
const DEFAULT_VIEWPORT_HEIGHT = 380;
/** 超过该条数启用虚拟滚动（低于阈值全量渲染，避免小列表无谓的窗口计算） */
const VIRTUAL_THRESHOLD = 200;
/** 虚拟滚动 overscan：可视区上下额外保留的行数 */
const VIRTUAL_OVERSCAN = 6;

/** 历史弹幕默认可用日期（yyyy-MM-dd，与源组件证据一致） */
const DEFAULT_HISTORY_DATES: readonly string[] = [
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-06",
  "2026-10-07",
  "2026-10-08",
  "2026-10-09",
  "2026-10-11",
  "2026-10-15",
  "2026-10-17",
  "2026-10-18",
  "2026-10-22",
  "2026-10-23",
];

/** 高级弹幕色板（12 色，顺序与源组件一致） */
const ADV_COLORS: readonly string[] = [
  "#FE0302",
  "#FF7204",
  "#FFAA02",
  "#FFD302",
  "#FFFF00",
  "#A0EE00",
  "#00CD00",
  "#019899",
  "#4266BE",
  "#89D5FF",
  "#CC02ED",
  "#770088",
];

/** 高级弹幕字体列表（labelKey 走 i18n） */
const ADV_FONT_FAMILIES: ReadonlyArray<{ labelKey: string; value: string }> = [
  { labelKey: KEYS.fontHei, value: 'SimHei, "Microsoft JhengHei"' },
  { labelKey: KEYS.fontSong, value: "SimSun" },
  { labelKey: KEYS.fontNSong, value: "NSimSun" },
  { labelKey: KEYS.fontFangSong, value: "FangSong" },
  { labelKey: KEYS.fontYaHei, value: '"Microsoft YaHei"' },
];

/** 高级弹幕表单默认值 */
const DEFAULT_ADV_FORM: AdvDanmakuForm = {
  color: "#FFFFFF",
  size: "36",
  fontFamily: 'SimHei, "Microsoft JhengHei"',
  stroke: true,
  zRotate: "0",
  yRotate: "0",
  duration: "4.5",
  sOpacity: "1",
  eOpacity: "1",
  aTime: "500",
  aDelay: "0",
  speedup: true,
  way: "start",
  percent: false,
  startX: "0",
  startY: "0",
  endX: "0",
  endY: "0",
  text: "",
  currentTime: true,
  showtime: "",
};

/** 星期文案 key（0=周日） */
const WEEK_KEYS: readonly string[] = [
  "player.ui.danmaku.week.0",
  "player.ui.danmaku.week.1",
  "player.ui.danmaku.week.2",
  "player.ui.danmaku.week.3",
  "player.ui.danmaku.week.4",
  "player.ui.danmaku.week.5",
  "player.ui.danmaku.week.6",
];

/** 月份文案 key（1 月 → 12 月） */
const MONTH_KEYS: readonly string[] = [
  "player.ui.danmaku.month.1",
  "player.ui.danmaku.month.2",
  "player.ui.danmaku.month.3",
  "player.ui.danmaku.month.4",
  "player.ui.danmaku.month.5",
  "player.ui.danmaku.month.6",
  "player.ui.danmaku.month.7",
  "player.ui.danmaku.month.8",
  "player.ui.danmaku.month.9",
  "player.ui.danmaku.month.10",
  "player.ui.danmaku.month.11",
  "player.ui.danmaku.month.12",
];

/** 屏蔽设定 tab 项 */
interface BlockTabItem {
  /** tab 标识 */
  key: BlockTab;
  /** 文案 i18n key */
  labelKey: string;
}

/** 高级弹幕字体项 */
interface AdvFontFamily {
  /** 文案 i18n key */
  labelKey: string;
  /** CSS font-family 值 */
  value: string;
}

/** 数字型表单字段（高级弹幕 spinner 使用） */
type AdvNumberField =
  | "size"
  | "zRotate"
  | "yRotate"
  | "duration"
  | "sOpacity"
  | "eOpacity"
  | "aTime"
  | "aDelay"
  | "startX"
  | "startY"
  | "endX"
  | "endY";

// ============================================
// 数据格式化工具
// ============================================

/** 事件目标收窄：input 元素（替代 as 断言） */
function inputElement(event: Event): HTMLInputElement | null {
  return event.currentTarget instanceof HTMLInputElement
    ? event.currentTarget
    : null;
}

/** 事件目标收窄：textarea 元素（替代 as 断言） */
function textAreaElement(event: Event): HTMLTextAreaElement | null {
  return event.currentTarget instanceof HTMLTextAreaElement
    ? event.currentTarget
    : null;
}

/** 秒 -> mm:ss（超过 1 小时展开为 h:mm:ss） */
function formatRowTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 时间戳（毫秒） -> MM-dd HH:mm */
function formatSendDate(timestamp: number): string {
  const date = new Date(timestamp);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 数值 ID 是否可作为发送时间戳（本地发送使用 Date.now() 作为 id） */
function idTimestamp(id: string | number): number {
  const value = typeof id === "number" ? id : Number(id);
  return Number.isFinite(value) && value >= 1_000_000_000_000 ? value : 0;
}

/** 时间戳（毫秒） -> yyyy-MM-dd（本地时区，历史弹幕日期 key） */
function formatDateKeyFromTs(timestamp: number): string {
  const date = new Date(timestamp);
  return formatDateKey(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 播放器弹幕 -> 列表展示行（时间 / 发送时间在此统一格式化） */
function toListRow(item: PlayerDanmakuItem): DanmakuListRow {
  // 优先使用数据源发送时间戳；缺省时回落为「id 为毫秒时间戳」（本地发送）
  const sentAt =
    typeof item.sentAt === "number" && Number.isFinite(item.sentAt)
      ? item.sentAt
      : 0;
  const ts = sentAt > 0 ? sentAt : idTimestamp(item.id);
  const row: DanmakuListRow = {
    id: item.id,
    time: formatRowTime(item.time),
    text: item.text,
    date: ts > 0 ? formatSendDate(ts) : "",
    stime: item.time,
    dateTs: ts,
    own: item.uid === 1 || item.uid === "1",
  };
  if (ts > 0) row.dateKey = formatDateKeyFromTs(ts);
  if (typeof item.userId === "string") row.uhash = item.userId;
  if (typeof item.userName === "string") row.uname = item.userName;
  if (item.type !== undefined) row.mode = Number(item.type);
  return row;
}

/** 播放器弹幕列表 -> 展示行列表 */
function toListRows(list: readonly PlayerDanmakuItem[]): DanmakuListRow[] {
  return list.map((item) => toListRow(item));
}

/** 数值递增（保留 step 的小数位，与源组件一致） */
function bumpValue(
  raw: string,
  delta: number,
  min: number,
  max: number,
  step: number,
): string {
  const base = Number.parseFloat(raw);
  const current = Number.isFinite(base) ? base : 0;
  const next = Math.max(min, Math.min(max, current + delta * step));
  const text = String(step);
  const dot = text.indexOf(".");
  const digits = dot >= 0 ? text.length - dot - 1 : 0;
  return digits > 0 ? next.toFixed(digits) : String(next);
}

/** yyyy-MM-dd */
function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 当前日期分量 */
function nowDate(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
}

// ============================================
// 表单子组件：数字步进器
// ============================================

/** 数字步进器属性 */
interface NumberSpinnerProps {
  /** 当前值 */
  value: () => string;
  /** 最小值 */
  min: number;
  /** 最大值 */
  max: number;
  /** 步进值 */
  step: number;
  /** data-key 标识（与源 DOM 一致） */
  dataKey: string;
  /** 步进 +1 */
  stepUp: () => void;
  /** 步进 -1 */
  stepDown: () => void;
  /** 输入回调 */
  onInput: (value: string) => void;
}

/** 数字步进器（.nova-player-adv-danmaku-spinner.ui.ui-input） */
const NumberSpinner = defineComponent<NumberSpinnerProps>(
  (props, lifecycle) => {
    /** 输入框 DOM 引用（value 为 DOM property，需命令式同步） */
    let inputEl: HTMLInputElement | null = null;

    /** 值变化时同步输入框显示值（受控输入） */
    onEffect(lifecycle, () => {
      const value = props.value();
      if (inputEl !== null && inputEl.value !== value) inputEl.value = value;
    });

    return h(
      "span",
      {
        class: "nova-player-adv-danmaku-spinner ui ui-input",
        "data-min": String(props.min),
        "data-max": String(props.max),
        "data-step": String(props.step),
        "data-key": props.dataKey,
        "data-value": props.value(),
        "data-origin": props.value(),
      },
      h(
        "div",
        { class: "ui-area" },
        h(
          "div",
          { class: "ui-input-wrap" },
          h("input", {
            class: "ui-input-input",
            type: "number",
            ref: (el: unknown): void => {
              if (!(el instanceof HTMLInputElement)) return;
              inputEl = el;
            },
            onInput: (event: Event): void => {
              props.onInput(inputElement(event)?.value ?? "");
            },
          }),
          h(
            "div",
            { class: "ui-input-stepper" },
            h(
              "div",
              {
                class: "ui-input-stepper-half ui-input-stepper-up",
                onClick: (): void => props.stepUp(),
              },
              h("span", { class: "ui-input-arrow ui-input-arrow-up" }),
            ),
            h(
              "div",
              {
                class: "ui-input-stepper-half ui-input-stepper-down",
                onClick: (): void => props.stepDown(),
              },
              h("span", { class: "ui-input-arrow ui-input-arrow-down" }),
            ),
          ),
        ),
      ),
    );
  },
);

// ============================================
// 表单子组件：复选框
// ============================================

/** 复选框属性 */
interface CheckboxProps {
  /** 追加类名（源组件 bpx-player-adv-danmaku-* 定位类） */
  className?: string;
  /** 当前勾选态 */
  checked: () => boolean;
  /** 文案 i18n key */
  labelKey: string;
  /** 勾选变化回调 */
  onChange: (checked: boolean) => void;
}

/** 复选框（.nova-player-adv-danmaku-checkbox.ui.ui-checkbox） */
const Checkbox = defineComponent<CheckboxProps>((props, lifecycle) => {
  /** 原生 checkbox 引用（checked 为 DOM property） */
  let inputEl: HTMLInputElement | null = null;

  /** 勾选态变化时同步原生 checked */
  onEffect(lifecycle, () => {
    const checked = props.checked();
    if (inputEl !== null && inputEl.checked !== checked)
      inputEl.checked = checked;
  });

  return h(
    "span",
    {
      class: `nova-player-adv-danmaku-checkbox ${props.className ?? ""} ui ui-checkbox`,
    },
    h(
      "div",
      { class: "ui-area" },
      h("input", {
        class: "ui-checkbox-input",
        type: "checkbox",
        ref: (el: unknown): void => {
          if (!(el instanceof HTMLInputElement)) return;
          inputEl = el;
        },
        onChange: (event: Event): void => {
          props.onChange(inputElement(event)?.checked ?? false);
        },
        "aria-label": t(props.labelKey),
      }),
      h(
        "label",
        { class: "ui-checkbox-label" },
        h(
          "span",
          { class: "ui-checkbox-icon ui-checkbox-icon-default" },
          CheckboxIcon(),
        ),
        h(
          "span",
          { class: "ui-checkbox-icon ui-checkbox-icon-selected" },
          CheckboxSelectedIcon(),
        ),
        h("span", { class: "ui-checkbox-name" }, t(props.labelKey)),
      ),
    ),
  );
});

// ============================================
// 弹幕列表视图组件
// ============================================

/** 弹幕列表面板（三面板：弹幕列表 / 屏蔽设定 / 高级弹幕） */
export const DanmakuList = defineComponent<DanmakuListProps>(
  (props, lifecycle) => {
    // ============================================
    // 基础状态
    // ============================================

    /** 是否登录（影响举报 / 历史弹幕 / 同步屏蔽列表） */
    const isLoggedIn = (): boolean => props.loggedIn === true;

    /** 当前数据行（插件经 signal 传入，读取即建立依赖） */
    const rows = (): readonly DanmakuListRow[] => props.rows ?? [];

    /** 折叠态（true = 折叠） */
    const folded = signal<boolean>(props.defaultExpanded !== true);

    /** 当前菜单面板 */
    const menu = signal<DanmakuMenu>("LIST");

    /** 下拉菜单展开态 */
    const dropdownOpen = signal<boolean>(false);

    /** 加载状态 */
    const loadingState = signal<DanmakuLoadingState>(1);

    /** 高级弹幕付费确认弹窗 */
    const advDialogOpen = signal<boolean>(false);

    /** 排序键 */
    const orderKey = signal<DanmakuOrderKey>("stime");

    /** 排序箭头是否可见（源组件首次点击前不显示） */
    const orderVisible = signal<boolean>(false);

    /** 升序 / 降序 */
    const positive = signal<boolean>(true);

    /** 选中日期（历史弹幕） */
    const selectedDateKey = signal<string | null>(null);

    /** 日期选择器展开态 */
    const datePickerOpen = signal<boolean>(false);

    // ============================================
    // 尺寸派生：外层高度 -> body -> 列表可视高度
    // ============================================

    /** 面板整体高度（px） */
    const panelHeight = (): number =>
      typeof props.height === "number" && Number.isFinite(props.height)
        ? props.height
        : DEFAULT_VIEWPORT_HEIGHT;

    /** 面板 body 高度（扣除折叠 header） */
    const bodyHeight = (): number =>
      Math.max(0, panelHeight() - COLLAPSE_HEADER_HEIGHT);

    /** 折叠 body 高度（折叠时 0） */
    const collapseHeight = (): number => (folded.value ? 0 : bodyHeight());

    /** 列表可视高度（扣除排序头与底部历史按钮） */
    const listHeight = (): number =>
      Math.max(0, bodyHeight() - LIST_HEIGHT_OFFSET);

    // ============================================
    // 历史日期过滤
    // ============================================

    /** 历史日期标签（选中日期后展示「(M月D日)」） */
    const historyLabel = (): string => {
      const key = selectedDateKey.value;
      if (key === null) return "";
      const segments = key.split("-").map((part) => Number.parseInt(part, 10));
      const month = segments[1];
      const day = segments[2];
      if (!month || !day) return "";
      return t(KEYS.historyDateLabel, { month, day });
    };

    /** 过滤后的数据行（选中历史日期时优先展示当日弹幕） */
    const sourceRows = (): readonly DanmakuListRow[] => {
      const all = rows();
      const key = selectedDateKey.value;
      if (key === null) return all;
      const segments = key.split("-").map((part) => Number.parseInt(part, 10));
      const month = segments[1];
      const day = segments[2];
      if (!month || !day) return all;
      const mmdd = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const matched = all.filter((row) => row.date.startsWith(mmdd));
      return matched.length > 0 ? matched : all;
    };

    // ============================================
    // 排序
    // ============================================

    /** 排序后的数据行 */
    const sortedRows = (): readonly DanmakuListRow[] => {
      const key = orderKey.value;
      const list = sourceRows().slice();
      if (key === "text") {
        list.sort((a, b) =>
          String(a.text).localeCompare(String(b.text), "zh-Hans-CN"),
        );
      } else {
        const value = (row: DanmakuListRow): number =>
          key === "stime" ? row.stime : row.dateTs;
        list.sort((a, b) => value(a) - value(b));
      }
      return positive.value ? list : list.reverse();
    };

    /** 点击排序表头：同列切换正反序，换列重置升序 */
    const handleOrderClick = (key: DanmakuOrderKey): void => {
      if (orderKey.value === key) {
        positive.value = !positive.value;
      } else {
        orderKey.value = key;
        positive.value = true;
      }
      orderVisible.value = true;
      applyScroll(0);
      props.handlers?.onOrderChange?.({
        order: orderKey.value,
        positive: positive.value,
      });
    };

    // ============================================
    // 滚动（虚拟列表 + 自绘滚动条）
    // ============================================

    /** 列表滚动偏移 */
    const scrollTop = signal<number>(0);

    /** 列表内容总高度 */
    const contentHeight = (): number => sortedRows().length * ROW_HEIGHT;

    /** 最大可滚动距离 */
    const maxScroll = (): number => Math.max(0, contentHeight() - listHeight());

    /** 限制滚动范围 */
    const clampScroll = (value: number): number =>
      Math.max(0, Math.min(maxScroll(), value));

    // ---- 虚拟滚动状态 ----
    // 关键点：像素偏移(scrollTop) 与 行步进窗口(windowStart) 分离。
    // 滚动时仅更新容器 transform；只有跨过整行时窗口才换页，行 DOM 槽位固定复用，
    // 不重建节点（主流虚拟列表的 windowing 语义）。

    /** 虚拟窗口起始行（含 overscan，按整行步进更新） */
    const windowStart = signal<number>(0);

    /** 可视行数（含半行余量） */
    const visibleRowCount = (): number =>
      Math.ceil(listHeight() / ROW_HEIGHT) + 1;

    /** 虚拟列表槽位数（固定长度 → For 不会在滚动时增删节点） */
    const slotCount = (): number => visibleRowCount() + VIRTUAL_OVERSCAN * 2;

    /** 窗口起始行上限（保证末尾槽位尽量填满） */
    const maxWindowStart = (): number =>
      Math.max(0, sortedRows().length - slotCount());

    /** 是否启用虚拟滚动 */
    const virtualMode = (): boolean => sortedRows().length > VIRTUAL_THRESHOLD;

    /** 槽位索引表（长度只随视口高度变化，不随滚动变化） */
    const slotIndexes = (): number[] =>
      Array.from({ length: slotCount() }, (_, index) => index);

    /** 虚拟窗口内 slot 对应的数据行（滚动时随窗口更新） */
    const rowAtWindow = (slot: number): DanmakuListRow | undefined =>
      sortedRows()[windowStart.value + slot];

    /**
     * 应用滚动位置
     *
     * 同步两个信号：scrollTop（像素级，驱动 transform）与 windowStart（行级，
     * 驱动窗口内行内容）。行窗口只在跨行时变化，因此滚动过程中行 DOM 槽位不变。
     */
    const applyScroll = (next: number): void => {
      const clamped = clampScroll(next);
      if (scrollTop.value !== clamped) scrollTop.value = clamped;
      const start = Math.min(
        maxWindowStart(),
        Math.max(0, Math.floor(clamped / ROW_HEIGHT) - VIRTUAL_OVERSCAN),
      );
      if (windowStart.value !== start) windowStart.value = start;
    };

    /** 列表滚轮 */
    const handleListWheel = (event: WheelEvent): void => {
      if (maxScroll() <= 0) return;
      event.preventDefault();
      applyScroll(scrollTop.value + event.deltaY);
    };

    /** 是否需要滚动条 */
    const needScrollbar = (): boolean =>
      contentHeight() > listHeight() && listHeight() > 0;

    /** 滚动条滑块高度 */
    const thumbHeight = (): number => {
      const viewport = listHeight();
      const content = contentHeight();
      if (viewport <= 0 || content <= viewport) return viewport;
      return Math.max(20, Math.min(viewport, (viewport * viewport) / content));
    };

    /** 滑块最大偏移 */
    const maxThumbTop = (): number => Math.max(0, listHeight() - thumbHeight());

    /** 滑块当前偏移 */
    const thumbTop = (): number =>
      maxScroll() > 0 ? (scrollTop.value / maxScroll()) * maxThumbTop() : 0;

    /** 滚动条轨道 DOM */
    let scrollbarEl: HTMLDivElement | null = null;
    /** 滚动条滑块 DOM */
    let thumbEl: HTMLDivElement | null = null;
    /** 拖拽起点 Y */
    let dragStartY = 0;
    /** 拖拽起点滑块偏移 */
    let dragStartTop = 0;
    /** 是否正在拖拽 */
    const dragging = signal<boolean>(false);

    /** 点击轨道跳转 */
    const handleTrackDown = (event: PointerEvent): void => {
      if (
        scrollbarEl === null ||
        event.target === thumbEl ||
        maxScroll() <= 0
      ) {
        return;
      }
      const rect = scrollbarEl.getBoundingClientRect();
      const nextThumbTop = event.clientY - rect.top - thumbHeight() / 2;
      const ratio = maxThumbTop() > 0 ? nextThumbTop / maxThumbTop() : 0;
      applyScroll(ratio * maxScroll());
    };

    /** 滑块按下 */
    const handleThumbDown = (event: PointerEvent): void => {
      event.stopPropagation();
      if (thumbEl === null || maxScroll() <= 0) return;
      dragStartY = event.clientY;
      dragStartTop = thumbTop();
      dragging.value = true;
      thumbEl.setPointerCapture(event.pointerId);
    };

    /** 滑块拖动 */
    const handleThumbMove = (event: PointerEvent): void => {
      if (!dragging.value || thumbEl === null) return;
      const nextThumbTop = Math.max(
        0,
        Math.min(maxThumbTop(), dragStartTop + event.clientY - dragStartY),
      );
      const ratio = maxThumbTop() > 0 ? nextThumbTop / maxThumbTop() : 0;
      applyScroll(ratio * maxScroll());
    };

    /** 滑块松开 */
    const handleThumbUp = (event: PointerEvent): void => {
      if (!dragging.value) return;
      if (thumbEl !== null && thumbEl.hasPointerCapture(event.pointerId)) {
        thumbEl.releasePointerCapture(event.pointerId);
      }
      dragging.value = false;
    };

    // ============================================
    // 选中 / 屏蔽
    // ============================================

    /** 行唯一 key */
    const keyOf = (row: DanmakuListRow): string => `d:${String(row.id)}`;

    /** 选中行 key 集合 */
    const selected = signal<ReadonlySet<string>>(new Set<string>());
    /** 屏蔽行 key 集合 */
    const blockedIds = signal<ReadonlySet<string>>(new Set<string>());
    /** 屏蔽用户 key 集合 */
    const blockedUsers = signal<ReadonlySet<string>>(new Set<string>());

    /** 行是否已屏蔽 */
    const isBlocked = (row: DanmakuListRow): boolean => {
      const key = keyOf(row);
      return (
        row.blocked === true ||
        blockedIds.value.has(key) ||
        blockedUsers.value.has(key)
      );
    };

    /** 行用户是否已屏蔽 */
    const isBlockedUser = (row: DanmakuListRow): boolean => {
      const key = keyOf(row);
      return row.blockedUser === true || blockedUsers.value.has(key);
    };

    /** 切换行选中态 */
    const toggleSelect = (key: string): void => {
      const next = new Set(selected.value);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      selected.value = next;
    };

    /** 清空选中 */
    const clearSelection = (): void => {
      selected.value = new Set<string>();
    };

    /** 已选中的行 */
    const selectedRows = (): DanmakuListRow[] =>
      sortedRows().filter((row) => selected.value.has(keyOf(row)));

    /** 批量屏蔽选中行 */
    const batchBlock = (): void => {
      const chosen = selectedRows();
      const next = new Set(blockedIds.value);
      for (const row of chosen) next.add(keyOf(row));
      blockedIds.value = next;
      props.handlers?.onBatchBlock?.(chosen);
      clearSelection();
    };

    /** 屏蔽 / 取消屏蔽用户 */
    const toggleBlockUser = (row: DanmakuListRow): void => {
      const key = keyOf(row);
      const next = new Set(blockedUsers.value);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      blockedUsers.value = next;
      props.handlers?.onBlockUser?.(row);
    };

    /** 行点击：屏蔽 / 举报 / 选中 / 跳转 */
    const handleRowClick = (row: DanmakuListRow, event: MouseEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = target?.dataset?.action;
      if (action === "block") {
        event.stopPropagation();
        toggleBlockUser(row);
        return;
      }
      if (action === "report") {
        event.stopPropagation();
        props.handlers?.onReport?.(row);
        return;
      }
      if (props.selectable === true || event.ctrlKey || event.metaKey) {
        toggleSelect(keyOf(row));
        return;
      }
      props.handlers?.onSeek?.(row.stime, row);
    };

    // ============================================
    // 折叠 / 下拉 / 菜单
    // ============================================

    /** 设置展开态 */
    const setExpanded = (expanded: boolean): void => {
      folded.value = !expanded;
      props.handlers?.onFoldChange?.(expanded);
    };

    /** 折叠 header 点击 */
    const toggleFold = (): void => {
      dropdownOpen.value = false;
      setExpanded(folded.value);
    };

    /** 下拉开关 */
    const toggleDropdown = (event: MouseEvent): void => {
      event.stopPropagation();
      dropdownOpen.value = !dropdownOpen.value;
    };

    /** 当前菜单文案 */
    const menuName = (): string => {
      if (menu.value === "BLOCK") return t(KEYS.blockMenu);
      if (menu.value === "ADV") return t(KEYS.advMenu);
      return t(KEYS.listTitle);
    };

    /** 切换菜单面板 */
    const switchMenu = (next: DanmakuMenu): void => {
      menu.value = next;
      dropdownOpen.value = false;
      if (folded.value) setExpanded(true);
      if (next !== "LIST") datePickerOpen.value = false;
      advDialogOpen.value = next === "ADV" && isLoggedIn();
      props.handlers?.onPanelChange?.(next);
    };

    /** 重试定时器 id */
    let retryTimer = 0;

    /** 装填失败点击重试 */
    const retryLoad = (): void => {
      loadingState.value = 0;
      props.handlers?.onLoadRetry?.();
      retryTimer = window.setTimeout(() => {
        loadingState.value = 1;
      }, 900);
    };

    // ============================================
    // 查看历史弹幕 / 日期选择器
    // ============================================

    /** 日期选择器是否已初始化视图月份 */
    const pickerInited = signal<boolean>(false);
    /** 当前视图年 */
    const viewYear = signal<number>(nowDate().year);
    /** 当前视图月（0-11） */
    const viewMonth = signal<number>(nowDate().month);

    /**
     * 历史可用日期集合
     *
     * 优先级：显式 props.historyDates > 当前弹幕数据中出现过的发送日期 >
     * 内置演示日期。真实数据源接入后日期选择器直接可用，无需额外配置。
     */
    const historyDateSet = (): ReadonlySet<string> => {
      if (props.historyDates !== undefined) {
        return new Set(props.historyDates);
      }
      const dates = new Set<string>();
      for (const row of rows()) {
        if (row.dateKey !== undefined) dates.add(row.dateKey);
      }
      return dates.size > 0 ? dates : new Set(DEFAULT_HISTORY_DATES);
    };

    /** 打开 / 关闭日期选择器 */
    const openDatePicker = (): void => {
      if (!isLoggedIn()) return;
      if (!pickerInited.value) {
        const today = nowDate();
        viewYear.value = today.year;
        viewMonth.value = today.month;
        pickerInited.value = true;
      }
      datePickerOpen.value = !datePickerOpen.value;
    };

    /** 上一个月 */
    const prevMonth = (): void => {
      if (viewMonth.value === 0) {
        viewMonth.value = 11;
        viewYear.value = viewYear.value - 1;
      } else {
        viewMonth.value = viewMonth.value - 1;
      }
    };

    /** 下一个月是否禁用 */
    const nextDisabled = (): boolean => {
      const today = nowDate();
      return (
        viewYear.value > today.year ||
        (viewYear.value === today.year && viewMonth.value >= today.month)
      );
    };

    /** 下一个月 */
    const nextMonth = (): void => {
      if (nextDisabled()) return;
      if (viewMonth.value === 11) {
        viewMonth.value = 0;
        viewYear.value = viewYear.value + 1;
      } else {
        viewMonth.value = viewMonth.value + 1;
      }
    };

    /** 日历单元格 */
    interface CalendarCell {
      /** 日期数字（空串 = 占位格） */
      day: number | "";
      /** yyyy-MM-dd */
      key: string;
      /** 是否可点击 */
      enabled: boolean;
    }

    /** 日历单元格列表（读取视图年月 / 历史日期 / 选中日期） */
    const calendarCells = (): CalendarCell[] => {
      const year = viewYear.value;
      const month = viewMonth.value;
      const days = new Date(year, month + 1, 0).getDate();
      const firstPos = new Date(year, month, 1).getDay();
      const today = nowDate();
      const todayTs = new Date(today.year, today.month, today.day).getTime();
      const available = historyDateSet();
      const cells: CalendarCell[] = [];
      for (let index = 0; index < firstPos; index += 1) {
        cells.push({ day: "", key: `blank-${index}`, enabled: false });
      }
      for (let day = 1; day <= days; day += 1) {
        const key = formatDateKey(year, month, day);
        const ts = new Date(year, month, day).getTime();
        cells.push({ day, key, enabled: available.has(key) && ts <= todayTs });
      }
      return cells;
    };

    /** 选择历史日期 */
    const chooseDate = (key: string, enabled: boolean): void => {
      if (!enabled) return;
      selectedDateKey.value = key;
      datePickerOpen.value = false;
      applyScroll(0);
      props.handlers?.onHistoryDate?.(key);
    };

    /** 日期选择器 DOM */
    let pickerEl: HTMLDivElement | null = null;

    /** 点击外部 / Esc 关闭日期选择器 */
    const handleDocumentDown = (event: MouseEvent): void => {
      if (!datePickerOpen.value) return;
      const target = event.target instanceof Node ? event.target : null;
      if (pickerEl !== null && target !== null && pickerEl.contains(target)) {
        return;
      }
      if (
        target instanceof Element &&
        target.closest(".nova-player-dm-btn-history") !== null
      ) {
        return;
      }
      datePickerOpen.value = false;
    };

    /** Esc 关闭日期选择器 */
    const handleDocumentKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") datePickerOpen.value = false;
    };

    // ============================================
    // 屏蔽设定面板
    // ============================================

    /** 屏蔽列表开关 */
    const blockEnabled = signal<boolean>(true);
    /** 当前屏蔽 tab */
    const blockTab = signal<BlockTab>("text");
    /** 屏蔽词输入框内容 */
    const blockInput = signal<string>("");
    /** 屏蔽词列表 */
    const blockWords = signal<BlockWordItem[]>([]);
    /** 屏蔽词自增 seed */
    const wordSeed = signal<number>(1);
    /** 屏蔽词输入框 DOM */
    let blockInputEl: HTMLInputElement | null = null;

    /** 提交屏蔽词变更 */
    const emitBlockWords = (next: BlockWordItem[]): void => {
      blockWords.value = next;
      props.handlers?.onBlockWordsChange?.(next);
    };

    /** 添加屏蔽词 */
    const addBlockWord = (): void => {
      const value = blockInput.value.trim();
      if (!value) return;
      const key = `${Date.now()}-${wordSeed.value}`;
      wordSeed.value = wordSeed.value + 1;
      emitBlockWords([
        ...blockWords.value,
        { id: key, value, enabled: true, tab: blockTab.value },
      ]);
      blockInput.value = "";
      if (blockInputEl !== null) blockInputEl.value = "";
    };

    /** 删除屏蔽词 */
    const removeBlockWord = (id: number | string): void => {
      emitBlockWords(blockWords.value.filter((word) => word.id !== id));
    };

    /** 切换屏蔽词启用状态 */
    const toggleBlockWord = (id: number | string): void => {
      emitBlockWords(
        blockWords.value.map((word) =>
          word.id === id ? { ...word, enabled: !word.enabled } : word,
        ),
      );
    };

    /** 当前 tab 的屏蔽词 */
    const tabWords = (): BlockWordItem[] =>
      blockWords.value.filter((word) => word.tab === blockTab.value);

    /** 屏蔽 tab 定义（labelKey 走 i18n） */
    const blockTabs: ReadonlyArray<{ key: BlockTab; labelKey: string }> = [
      { key: "text", labelKey: KEYS.blockText },
      { key: "regex", labelKey: KEYS.blockRegex },
      { key: "user", labelKey: KEYS.blockUserTab },
    ];

    // ============================================
    // 高级弹幕面板
    // ============================================

    /** 高级弹幕表单状态 */
    const advForm = signal<AdvDanmakuForm>({ ...DEFAULT_ADV_FORM });
    /** 字体下拉展开态 */
    const fontOpen = signal<boolean>(false);

    /** 当前表单值 */
    const adv = (): AdvDanmakuForm => advForm.value;

    /** 局部更新表单 */
    const patchAdv = (patch: Partial<AdvDanmakuForm>): void => {
      advForm.value = { ...advForm.value, ...patch };
    };

    /** 当前字体文案 key */
    const fontLabelKey = (): string =>
      ADV_FONT_FAMILIES.find((font) => font.value === adv().fontFamily)
        ?.labelKey ?? KEYS.fontHei;

    /** 写入高级弹幕数值字段（数值字段值均为字符串） */
    const setAdvValue = (field: AdvNumberField, value: string): void => {
      advForm.value = { ...advForm.value, [field]: value };
    };

    /** 生成步进处理器 */
    const stepFor = (
      delta: number,
      min: number,
      max: number,
      step: number,
      field: AdvNumberField,
    ): (() => void) => {
      return (): void => {
        const raw = String(adv()[field]);
        setAdvValue(field, bumpValue(raw, delta, min, max, step));
      };
    };

    /** 渲染数字步进器 */
    const renderSpinner = (
      field: AdvNumberField,
      min: number,
      max: number,
      step: number,
    ): VNode =>
      h(NumberSpinner, {
        value: (): string => String(adv()[field]),
        min,
        max,
        step,
        dataKey: field,
        stepUp: stepFor(1, min, max, step, field),
        stepDown: stepFor(-1, min, max, step, field),
        onInput: (value: string): void => {
          setAdvValue(field, value);
        },
      });

    /** 高级弹幕正文输入框 DOM */
    let advTextEl: HTMLTextAreaElement | null = null;
    /** 弹幕出现时间输入框 DOM */
    let advShowtimeEl: HTMLInputElement | null = null;
    /** 弹幕颜色输入框 DOM */
    let advColorEl: HTMLInputElement | null = null;

    /** 表单值变化时同步原生输入框（textarea / 颜色 / 出现时间） */
    onEffect(lifecycle, () => {
      const form = advForm.value;
      if (advTextEl !== null && advTextEl.value !== form.text) {
        advTextEl.value = form.text;
      }
      if (advShowtimeEl !== null && advShowtimeEl.value !== form.showtime) {
        advShowtimeEl.value = form.showtime;
      }
      if (advColorEl !== null && advColorEl.value !== form.color) {
        advColorEl.value = form.color;
      }
    });

    // ============================================
    // 屏蔽设定 / 高级弹幕面板滚动
    // ============================================

    /** 屏蔽面板滚动偏移 */
    const blockScroll = signal<number>(0);
    /** 屏蔽面板内容高度 */
    const blockContentHeight = signal<number>(0);
    /** 屏蔽面板内容 DOM */
    let blockAreaEl: HTMLDivElement | null = null;
    /** 屏蔽面板最大滚动距离 */
    const blockMaxScroll = (): number =>
      Math.max(0, blockContentHeight.value - bodyHeight());

    /** 高级面板滚动偏移 */
    const advScroll = signal<number>(0);
    /** 高级面板内容高度 */
    const advContentHeight = signal<number>(0);
    /** 高级面板内容 DOM */
    let advAreaEl: HTMLDivElement | null = null;
    /** 高级面板最大滚动距离 */
    const advMaxScroll = (): number =>
      Math.max(0, advContentHeight.value - bodyHeight());

    /** ResizeObserver 清理函数列表 */
    const observerDisposers: Array<() => void> = [];

    /** 观察内容高度（面板滚动条计算） */
    const observeContent = (
      getElement: () => HTMLElement | null,
      setHeight: (value: number) => void,
    ): void => {
      const element = getElement();
      if (element === null || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver((): void => {
        setHeight(element.offsetHeight);
      });
      observer.observe(element);
      setHeight(element.offsetHeight);
      observerDisposers.push(() => observer.disconnect());
    };

    /** 面板滚动条滑块高度 */
    const paneThumbHeight = (content: number): number => {
      const viewport = bodyHeight();
      if (viewport <= 0) return 0;
      return Math.max(
        20,
        viewport * Math.min(1, viewport / Math.max(1, content)),
      );
    };

    /** 面板滚动条滑块偏移 */
    const paneThumbTop = (
      offset: number,
      max: number,
      content: number,
    ): number => {
      if (max <= 0) return 0;
      const viewport = bodyHeight();
      const thumb = paneThumbHeight(content);
      return (offset / max) * Math.max(0, viewport - thumb);
    };

    // ============================================
    // 面板片段：折叠 header
    // ============================================

    /** 渲染下拉菜单项 */
    const renderMenuItem = (value: DanmakuMenu, labelKey: string): VNode =>
      h(
        "div",
        {
          "data-value": value,
          onClick: (event: MouseEvent): void => {
            event.stopPropagation();
            switchMenu(value);
          },
          class: `ui-dropdown-item${menu.value === value ? " ui-hide" : ""}`,
        },
        (): string => t(labelKey),
      );

    /** 渲染折叠 header */
    const renderHeader = (): VNode =>
      h(
        "div",
        { class: "ui-collapse-header", onClick: toggleFold },
        h(
          "div",
          { class: "ui-collapse-arrow" },
          h(
            "span",
            { class: "ui-collapse-arrow-text" },
            h("span", { class: "arrow-icon" }, CollapseArrowIcon()),
          ),
        ),
        h(
          "div",
          { class: "nova-player-filter ui ui-dropdown" },
          h(
            "div",
            { class: "ui-area" },
            h(
              "div",
              {
                class: `ui-dropdown-wrap${dropdownOpen.value ? " ui-dropdown-unfold" : ""}`,
              },
              h(
                "div",
                { class: "ui-dropdown-display", onClick: toggleDropdown },
                h("span", { class: "ui-dropdown-name" }, () => menuName()),
                h("span", { class: "ui-dropdown-icon" }, DropdownIcon()),
              ),
              h(
                "div",
                { class: "ui-dropdown-items" },
                renderMenuItem("LIST", KEYS.listTitle),
                renderMenuItem("BLOCK", KEYS.blockMenu),
                renderMenuItem("ADV", KEYS.advMenu),
              ),
            ),
          ),
        ),
      );

    // ============================================
    // 面板片段：弹幕列表
    // ============================================

    /**
     * 渲染单条弹幕行内容（静态列表与虚拟窗口共用）
     *     * @param getRow - 取当前行数据（虚拟窗口下随滚动窗口变化）
     * @param getIndex - 取当前行索引（data-index，随数据增删/排序响应式更新）
     * @param virtualTop - 虚拟窗口行的绝对定位偏移 getter（静态列表不传）
     */
    const renderRowContent = (
      getRow: () => DanmakuListRow | undefined,
      getIndex: () => number,
      virtualTop?: () => number,
    ): VNode => {
      /** 当前行（虚拟窗口末尾槽位可能为空） */
      const currentRow = (): DanmakuListRow | undefined => getRow();
      /** 行容器类（选中态由信号驱动） */
      const rowClass = (): string => {
        const row = currentRow();
        const active =
          row !== undefined && selected.value.has(keyOf(row))
            ? "ui-long-list-item-selected"
            : "";
        return active === ""
          ? "ui-long-list-item"
          : `ui-long-list-item ${active}`;
      };
      /** 行内容类（屏蔽态由信号驱动） */
      const rowDivClass = (): string => {
        const row = currentRow();
        return `dm-info-row${
          row !== undefined && isBlocked(row) ? " dm-info-row-block" : ""
        }`;
      };
      /** 屏蔽按钮类（用户屏蔽态由信号驱动） */
      const blockBtnClass = (): string => {
        const row = currentRow();
        return `dm-info-block-btn${
          row !== undefined && isBlockedUser(row) ? " dm-info-blocked" : ""
        }`;
      };
      return h(
        "li",
        {
          "data-index": getIndex(),
          class: rowClass(),
          style: {
            height: `${ROW_HEIGHT}px`,
            ...(virtualTop === undefined ? {} : { top: `${virtualTop()}px` }),
          },
        },
        h(
          "div",
          {
            "data-index": getIndex(),
            onClick: (event: MouseEvent): void => {
              const row = currentRow();
              if (row !== undefined) handleRowClick(row, event);
            },
            class: rowDivClass(),
            "data-special-danmu-text": t(KEYS.specialDanmaku),
            "data-subtitle-danmu-text": t(KEYS.subtitleDanmaku),
            "data-blocked-text": t(KEYS.blockedDanmaku),
            "data-deleting-text": t(KEYS.deletingDanmaku),
            "data-bas-danmu-text": t(KEYS.basDanmaku),
          },
          h("span", { class: "dm-info-time" }, () => currentRow()?.time ?? ""),
          h(
            "span",
            {
              class: "dm-info-dm",
              title: currentRow()?.text ?? "",
              "data-index": getIndex(),
            },
            () => currentRow()?.text ?? "",
          ),
          h("span", { class: "dm-info-date" }, (): string => {
            const row = currentRow();
            return row === undefined || row.date === ""
              ? t(KEYS.unknownDate)
              : row.date;
          }),
          h(
            "span",
            {
              "data-action": "block",
              class: blockBtnClass(),
              "data-index": getIndex(),
            },
            (): string => {
              const row = currentRow();
              return row !== undefined && isBlockedUser(row)
                ? t(KEYS.cancelBlockUser)
                : t(KEYS.blockUser);
            },
          ),
          h(
            "span",
            {
              class: "dm-info-report-btn nova-player-db-btn",
              "data-action": "report",
              "data-index": getIndex(),
            },
            t(KEYS.report),
          ),
        ),
      );
    }; /** 行在当前排序数据中的索引（响应式；删除/排序后自动更新 data-index） */
    const rowIndexOf = (row: DanmakuListRow): number =>
      sortedRows().findIndex(
        (item) => String(item.id) === String(row.id),
      ); /** 渲染静态列表行 */
    const renderRow = (row: DanmakuListRow): VNode =>
      renderRowContent(
        () => row,
        () => rowIndexOf(row),
      ); /** 渲染虚拟窗口槽位行（槽位固定，内容随窗口滚动更新） */
    const renderWindowRow = (slot: number): VNode =>
      renderRowContent(
        () => rowAtWindow(slot),
        (): number =>
          rowAtWindow(slot) === undefined ? -1 : windowStart.value + slot,
        () => (windowStart.value + slot) * ROW_HEIGHT,
      );

    /** 渲染列表滚动条 */
    const renderListScrollbar = (): VNode =>
      h(
        "div",
        {
          ref: (el: unknown): void => {
            if (!(el instanceof HTMLDivElement)) return;
            scrollbarEl = el;
          },
          onPointerDown: handleTrackDown,
          class: `nscroll-vertical-scrollbar${dragging.value ? " mousedown" : ""}`,
          style: `display: ${needScrollbar() ? "block" : "none"};`,
        },
        h("div", {
          class: "nscroll-indicator",
          ref: (el: unknown): void => {
            if (!(el instanceof HTMLDivElement)) return;
            thumbEl = el;
          },
          onPointerDown: handleThumbDown,
          onPointerMove: handleThumbMove,
          onPointerUp: handleThumbUp,
          onPointerCancel: handleThumbUp,
          style:
            "background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.9); " +
            `height: ${thumbHeight()}px; ` +
            `transform: translateY(${thumbTop()}px) translateZ(0px);`,
        }),
      );

    /** 渲染加载状态覆盖层 */
    const renderLoadStatus = (): VNode =>
      h(
        "div",
        {
          class: `nova-player-dm-load-status${
            loadingState.value === 2 ? " nova-player-dm-close" : ""
          }`,
          style: `height: ${listHeight()}px; line-height: ${listHeight()}px;`,
        },
        h(
          Show,
          {
            when: (): boolean => loadingState.value === 2,
            fallback: h(
              Show,
              { when: (): boolean => loadingState.value === 0 },
              t(KEYS.loading),
            ),
          },
          t(KEYS.loadFailed),
          " ",
          h(
            "span",
            { class: "nova-player-reset", onClick: retryLoad },
            t(KEYS.retry),
          ),
        ),
      );

    /** 渲染日期选择器 */
    const renderDatePicker = (): VNode =>
      h(
        "div",
        {
          ref: (el: unknown): void => {
            if (!(el instanceof HTMLDivElement)) return;
            pickerEl = el;
          },
          style: { bottom: "40px" },
          onClick: (event: MouseEvent): void => event.stopPropagation(),
          class: `nova-player-date-picker${
            datePickerOpen.value ? " nova-player-show" : ""
          }`,
        },
        h(
          "div",
          { class: "nova-player-date-picker-header" },
          h(
            "span",
            {
              "data-action": "prev",
              class: "nova-player-date-picker-btn btn-prev",
              onClick: prevMonth,
            },
            DatePrevIcon(),
          ),
          h(
            "span",
            {
              "data-action": "next",
              onClick: nextMonth,
              class: `nova-player-date-picker-btn btn-next${
                nextDisabled() ? " nova-player-disabled" : ""
              }`,
            },
            DateNextIcon(),
          ),
          h(
            "span",
            { class: "nova-player-date-picker-year" },
            t(KEYS.yearDisplay, { year: viewYear.value }),
          ),
          h(
            "span",
            { class: "nova-player-date-picker-month" },
            t(MONTH_KEYS[viewMonth.value] ?? MONTH_KEYS[0]),
          ),
        ),
        h(
          "div",
          { class: "nova-player-date-picker-body" },
          h(
            "div",
            { class: "nova-player-date-picker-week" },
            h(For, {
              each: WEEK_KEYS,
              key: (week: string): string => week,
              render: (week: string): VNode =>
                h("span", { class: "nova-player-date-picker-day" }, t(week)),
            }),
          ),
          h(
            "div",
            { class: "nova-player-date-picker-day-content" },
            h(For, {
              each: () => calendarCells(),
              key: (cell: CalendarCell): string => cell.key,
              render: (cell: CalendarCell): VNode => renderCalendarCell(cell),
            }),
          ),
        ),
      );

    /** 渲染日历单元格 */
    const renderCalendarCell = (cell: CalendarCell): VNode => {
      const activeKey = (): string =>
        selectedDateKey.value ?? formatDateKey(...nowKeyParts());
      const isActive = (): boolean =>
        cell.day !== "" && cell.key === activeKey();
      const isEnabled = (): boolean => cell.day !== "" && cell.enabled;
      return h(
        "span",
        {
          class: [
            "nova-player-date-picker-day",
            isEnabled() ? "day-enable" : "",
            isActive() ? "nova-player-active" : "",
          ]
            .filter((name: string): boolean => name !== "")
            .join(" "),
          "data-timestamp":
            cell.day === ""
              ? undefined
              : String(
                  new Date(
                    viewYear.value,
                    viewMonth.value,
                    cell.day,
                  ).getTime() / 1000,
                ),
          "data-action": cell.day === "" ? undefined : "changeDay",
          onClick: (): void => {
            if (cell.day !== "") chooseDate(cell.key, cell.enabled);
          },
        },
        cell.day === "" ? "" : String(cell.day),
      );
    };

    /** 当前日期分量数组（供 formatDateKey 展开） */
    const nowKeyParts = (): [number, number, number] => {
      const today = nowDate();
      return [today.year, today.month, today.day];
    };

    /** 渲染弹幕列表面板 */
    const renderListPanel = (): VNode =>
      h(
        "div",
        {
          role: "list",
          class: `nova-player-filter-wrap nova-player-dm${
            loadingState.value === 1 ? " nova-player-hide-status" : ""
          }`,
          style: `display: ${menu.value === "LIST" ? "block" : "none"};`,
        },
        h("div", { class: "nova-player-dm-management" }),
        // 排序表头
        h(
          "div",
          {
            class: [
              "nova-player-dm-function",
              orderVisible.value && !positive.value
                ? "nova-player-order-rotate"
                : "",
              orderVisible.value && orderKey.value === "stime"
                ? "nova-player-order-stime"
                : "",
              orderVisible.value && orderKey.value === "text"
                ? "nova-player-order-text"
                : "",
              orderVisible.value && orderKey.value === "date"
                ? "nova-player-order-date"
                : "",
            ]
              .filter((name: string): boolean => name !== "")
              .join(" "),
          },
          h(
            "div",
            {
              class: "nova-player-dm-btn-time",
              "data-action": "stime",
              onClick: (): void => handleOrderClick("stime"),
            },
            h("span", { "data-action": "stime" }, t(KEYS.time)),
            h("span", { class: "nova-player-dm-btn-icon" }, SortArrowIcon()),
          ),
          h(
            "div",
            {
              class: "nova-player-dm-btn-dm",
              "data-action": "text",
              onClick: (): void => handleOrderClick("text"),
            },
            h("span", { "data-action": "text" }, t(KEYS.content)),
            h("span", { class: "nova-player-dm-number-span" }, () =>
              historyLabel(),
            ),
            h("span", { class: "nova-player-dm-btn-icon" }, SortArrowIcon()),
          ),
          h(
            "div",
            {
              class: "nova-player-dm-btn-date",
              "data-action": "date",
              onClick: (): void => handleOrderClick("date"),
            },
            h("span", { "data-action": "date" }, (): string =>
              t(KEYS.sendTime),
            ),
            h("span", { class: "nova-player-dm-btn-icon" }, SortArrowIcon()),
          ),
          // 多选操作条（选中 > 1 条时展示）
          h(
            Show,
            { when: (): boolean => selected.value.size > 1 },
            h(
              "div",
              { class: "nova-player-dm-multiple nova-player-show" },
              h(
                "div",
                { class: "nova-player-dm-multiple-title" },
                h("span", {}, t(KEYS.selected)),
                h("span", { class: "nova-player-dm-multiple-number" }, () =>
                  String(selected.value.size),
                ),
                h("span", {}, t(KEYS.itemUnit)),
              ),
              h(
                "div",
                {
                  class: "nova-player-dm-multiple-cancel",
                  "data-action": "cancel",
                  onClick: clearSelection,
                },
                t(KEYS.deselect),
              ),
              h(
                "div",
                {
                  class: "nova-player-dm-multiple-submit",
                  "data-action": "block",
                  onClick: batchBlock,
                },
                t(KEYS.batchBlock),
              ),
            ),
          ),
        ),
        // 列表主体
        h(
          "div",
          { class: "nova-player-dm-wrap", style: `height: ${listHeight()}px;` },
          h(
            "div",
            { class: "nova-player-dm-container ui ui-long-list" },
            h(
              "div",
              { class: "ui-area" },
              h(
                "div",
                { class: "ui-long-list-wrap", onWheel: handleListWheel },
                h(
                  "ul",
                  {
                    class: [
                      "ui-long-list-list",
                      virtualMode() ? "nova-player-long-list-virtual" : "",
                    ]
                      .filter((name: string): boolean => name !== "")
                      .join(" "),
                    style:
                      `height: ${contentHeight()}px; ` +
                      `transform: translate(0px, ${-scrollTop.value}px) scale(1) translateZ(0px); ` +
                      "transition-duration: 0ms; " +
                      "transition-timing-function: cubic-bezier(0.165, 0.84, 0.44, 1);",
                  },
                  h(For, {
                    // 虚拟模式：each 为固定长度槽位（不随滚动变化，For 不重建节点）；
                    // 静态模式：小列表全量渲染
                    each: (): ReadonlyArray<DanmakuListRow | number> =>
                      virtualMode() ? slotIndexes() : sortedRows(),
                    key: (item: DanmakuListRow | number): string =>
                      typeof item === "number"
                        ? `slot-${item}`
                        : `${String(item.id)}|${item.time}|${item.text}|${item.date}`,
                    render: (item: DanmakuListRow | number): VNode =>
                      typeof item === "number"
                        ? renderWindowRow(item)
                        : renderRow(item),
                  }),
                ),
                renderListScrollbar(),
              ),
            ),
          ),
          renderLoadStatus(),
        ),
        // 空容器（源 DOM 保留结构，预留弹幕子面板位）
        h(
          "div",
          { class: "nova-player-dm-wrap-child" },
          h("div", { class: "nova-player-dm-container" }),
        ),
        // 底部：查看历史弹幕 + 日期选择器
        h(
          "div",
          { class: "nova-player-dm-btn-footer" },
          h(
            "div",
            {
              onClick: openDatePicker,
              class: `nova-player-dm-btn-history${isLoggedIn() ? "" : " nova-player-disable"}`,
            },
            t(KEYS.viewHistory),
            renderDatePicker(),
          ),
        ),
      );

    // ============================================
    // 面板片段：屏蔽设定
    // ============================================

    /** 渲染屏蔽设定面板 */
    const renderBlockPanel = (): VNode =>
      h(
        "div",
        {
          role: "block",
          onWheel: (event: WheelEvent): void => {
            if (blockMaxScroll() <= 0) return;
            event.preventDefault();
            blockScroll.value = Math.max(
              0,
              Math.min(blockMaxScroll(), blockScroll.value + event.deltaY),
            );
          },
          class: [
            "nova-player-filter-wrap nova-player-block nova-player-bscrollbar",
            isLoggedIn() ? "" : "nova-player-unlogin",
            blockEnabled.value ? "" : "nova-player-hide",
          ]
            .filter((name: string): boolean => name !== "")
            .join(" "),
          style: `display: ${menu.value === "BLOCK" ? "block" : "none"};`,
        },
        h(
          "div",
          {
            class: "nova-player-block-area",
            ref: (el: unknown): void => {
              if (!(el instanceof HTMLDivElement)) return;
              blockAreaEl = el;
            },
            style: `transform: translate(0px, ${-blockScroll.value}px) scale(1) translateZ(0px);`,
          },
          h(
            "div",
            { class: "nova-player-block-top" },
            h(
              "div",
              {},
              h("div", { class: "nova-player-block-label" }, (): string =>
                t(KEYS.blockList),
              ),
              h(
                "div",
                { class: "nova-player-block-switch ui ui-switch" },
                h(
                  "div",
                  { class: "ui-area" },
                  h("input", {
                    class: "ui-switch-input",
                    type: "checkbox",
                    "aria-label": t(KEYS.blockList),
                    ref: (el: unknown): void => {
                      if (!(el instanceof HTMLInputElement)) return;
                      const input = el;
                      input.checked = blockEnabled.value;
                      input.addEventListener("change", (): void => {
                        blockEnabled.value = input.checked;
                      });
                    },
                  }),
                  h(
                    "label",
                    { class: "ui-switch-label" },
                    h("span", { class: "ui-switch-name" }),
                    h(
                      "span",
                      { class: "ui-switch-body" },
                      h("span", { class: "ui-switch-dot" }, h("span", {})),
                    ),
                  ),
                ),
              ),
            ),
            h(
              "div",
              {
                class: "nova-player-block-sync-btn",
                "data-download-text": t(KEYS.downloadBlockList),
                "data-login-download-text": t(KEYS.loginDownloadBlockList),
                "data-downloaded-text": t(KEYS.downloadedBlockList),
              },
              h("span", { class: "nova-player-sync-icon" }, SyncIcon()),
              h("span", {}, t(KEYS.syncBlockList)),
            ),
          ),
          // 添加屏蔽词
          h(
            "div",
            { class: "nova-player-block-add" },
            h("input", {
              type: "text",
              class: "nova-player-block-add-input",
              ref: (el: unknown): void => {
                if (!(el instanceof HTMLInputElement)) return;
                blockInputEl = el;
              },
              onInput: (event: Event): void => {
                blockInput.value = inputElement(event)?.value ?? "";
              },
              onKeyDown: (event: KeyboardEvent): void => {
                if (event.key === "Enter") addBlockWord();
              },
              placeholder: t(KEYS.addPlaceholder),
            }),
            h(
              "div",
              {
                class: "nova-player-block-add-btn ui ui-button",
                onClick: addBlockWord,
              },
              h(
                "div",
                { class: "ui-area ui-button-gray" },
                h("span", {}, t(KEYS.add)),
              ),
            ),
          ),
          // 屏蔽 tab
          h(
            "div",
            { class: "nova-player-block-tab ui ui-tabs" },
            h(
              "div",
              { class: "ui-area" },
              h(
                "div",
                { class: "ui-tabs-wrap" },
                h(
                  "div",
                  { class: "ui-tabs-header" },
                  h(For, {
                    each: blockTabs,
                    key: (tab: BlockTabItem): string => tab.key,
                    render: (tab: BlockTabItem): VNode => {
                      return h(
                        "div",
                        {
                          "data-value": tab.key,
                          onClick: (): void => {
                            blockTab.value = tab.key;
                          },
                          class: `ui-tabs-header-item${
                            blockTab.value === tab.key
                              ? " ui-tabs-header-item-active"
                              : ""
                          }`,
                        },
                        t(tab.labelKey),
                      );
                    },
                  }),
                ),
                h(
                  "div",
                  { class: "ui-tabs-body" },
                  h(For, {
                    each: blockTabs,
                    key: (tab: BlockTabItem): string => tab.key,
                    render: (tab: BlockTabItem): VNode => {
                      return h("div", {
                        class: `ui-tabs-body-item${
                          blockTab.value === tab.key
                            ? " ui-tabs-body-item-active"
                            : ""
                        }`,
                      });
                    },
                  }),
                ),
              ),
            ),
          ),
          // 屏蔽词列表
          h(
            "div",
            { class: "nova-player-block-list" },
            h(
              "div",
              { class: "nova-player-block-list-function" },
              h(
                "div",
                { class: "nova-player-block-list-function-content" },
                h("span", {}, t(KEYS.content)),
                " ( ",
                h("span", { class: "nova-player-block-number" }, () =>
                  tabWords().length === 0 ? "-" : String(tabWords().length),
                ),
                " )",
              ),
              h(
                "div",
                { class: "nova-player-state-list-wrap" },
                h(
                  "div",
                  { class: "nova-player-block-list-state" },
                  t(KEYS.status),
                ),
                h(
                  "div",
                  { class: "nova-player-block-list-delete" },
                  t(KEYS.operation),
                ),
                h("div", { class: "nova-player-block-list-sync" }, (): string =>
                  t(KEYS.sync),
                ),
              ),
            ),
            h(
              "div",
              { class: "nova-player-block-list-item" },
              h(For, {
                each: () => tabWords(),
                key: (word: BlockWordItem): string =>
                  `${String(word.id)}|${word.enabled ? 1 : 0}`,
                render: (word: BlockWordItem): VNode => {
                  return h(
                    "div",
                    {
                      class: `nova-player-block-list-line${
                        word.enabled ? "" : " nova-player-disabled"
                      }`,
                    },
                    h(
                      "div",
                      {
                        class: "nova-player-block-list-content",
                        title: word.value,
                      },
                      word.value,
                    ),
                    h(
                      "div",
                      { class: "nova-player-state-list-wrap" },
                      h(
                        "div",
                        {
                          class: "nova-player-block-list-state",
                          onClick: (): void => toggleBlockWord(word.id),
                        },
                        () =>
                          word.enabled ? t(KEYS.statusOn) : t(KEYS.statusOff),
                      ),
                      h(
                        "div",
                        {
                          class: "nova-player-block-list-delete",
                          onClick: (): void => removeBlockWord(word.id),
                        },
                        TrashIcon(),
                      ),
                      h(
                        "div",
                        {
                          class: "nova-player-block-list-sync",
                          "data-sync-text": t(KEYS.syncBlockWord),
                        },
                        ListSyncIcon(),
                      ),
                    ),
                  );
                },
              }),
            ),
          ),
        ),
        // 屏蔽面板滚动条
        h(
          "div",
          {
            class: "nscroll-vertical-scrollbar",
            style: `display: ${blockMaxScroll() > 0 ? "block" : "none"};`,
          },
          h("div", {
            class: "nscroll-indicator",
            style:
              "background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.9); " +
              `height: ${paneThumbHeight(blockContentHeight.value)}px; ` +
              `transform: translateY(${paneThumbTop(
                blockScroll.value,
                blockMaxScroll(),
                blockContentHeight.value,
              )}px) translateZ(0px);`,
          }),
        ),
      );

    // ============================================
    // 面板片段：高级弹幕
    // ============================================

    /** 渲染高级弹幕面板 */
    const renderAdvPanel = (): VNode =>
      h(
        "div",
        {
          class: "nova-player-filter-wrap nova-player-adv-danmaku",
          onWheel: (event: WheelEvent): void => {
            if (advMaxScroll() <= 0) return;
            event.preventDefault();
            advScroll.value = Math.max(
              0,
              Math.min(advMaxScroll(), advScroll.value + event.deltaY),
            );
          },
          style: `display: ${menu.value === "ADV" ? "block" : "none"};`,
        },
        h(
          "div",
          { class: "nova-player-adv-danmaku-panel mask" },
          h(
            "div",
            {
              class: "nova-player-adv-danmaku-group-wrap",
              ref: (el: unknown): void => {
                if (!(el instanceof HTMLDivElement)) return;
                advAreaEl = el;
              },
              style: `transform: translate(0px, ${-advScroll.value}px) scale(1) translateZ(0px);`,
            },
            // 第一组：颜色 / 字体 / 旋转 / 属性
            h(
              "div",
              { class: "nova-player-adv-danmaku-group" },
              h(
                "div",
                {
                  class:
                    "nova-player-adv-danmaku-group-row nova-player-adv-danmaku-color",
                },
                h(
                  "span",
                  { class: "nova-player-adv-danmaku-title" },
                  t(KEYS.advColor),
                ),
                h(
                  "div",
                  {
                    class:
                      "nova-player-adv-danmaku-color-picker ui ui-color-picker",
                  },
                  h(
                    "div",
                    { class: "ui-area" },
                    h(
                      "div",
                      { class: "ui-color-picker-wrap" },
                      h(
                        "div",
                        { class: "ui-color-picker-result" },
                        h(
                          "span",
                          {
                            class: "ui-color-picker-input ui ui-input",
                          },
                          h(
                            "div",
                            { class: "ui-area" },
                            h(
                              "div",
                              { class: "ui-input-wrap" },
                              h("input", {
                                class: "ui-input-input",
                                type: "text",
                                ref: (el: unknown): void => {
                                  if (!(el instanceof HTMLInputElement)) return;
                                  advColorEl = el;
                                },
                                onInput: (event: Event): void => {
                                  patchAdv({
                                    color: inputElement(event)?.value ?? "",
                                  });
                                },
                              }),
                            ),
                          ),
                        ),
                        h("span", {
                          class: "ui-color-picker-display",
                          style: `background-color: ${adv().color};`,
                        }),
                      ),
                      h(
                        "ul",
                        { class: "ui-color-picker-options" },
                        h(For, {
                          each: ADV_COLORS,
                          key: (color: string): string => color,
                          render: (color: string): VNode => {
                            return h("li", {
                              class: "ui-color-picker-option",
                              "data-value": color,
                              style: { "background-color": color },
                              onClick: (): void => {
                                patchAdv({ color });
                              },
                            });
                          },
                        }),
                      ),
                    ),
                  ),
                ),
              ),
              h(
                "div",
                {
                  class:
                    "nova-player-adv-danmaku-group-row nova-player-adv-danmaku-font",
                },
                h(
                  "div",
                  {
                    class:
                      "nova-player-adv-danmaku-group-item nova-player-adv-danmaku-font-size",
                  },
                  h(
                    "span",
                    { class: "nova-player-adv-danmaku-title" },
                    t(KEYS.advFontSize),
                  ),
                  renderSpinner("size", 10, 127, 1),
                ),
                h(
                  "div",
                  {
                    class:
                      "nova-player-adv-danmaku-group-item nova-player-adv-danmaku-font-family",
                  },
                  h(
                    "span",
                    { class: "nova-player-adv-danmaku-title" },
                    t(KEYS.advFontFamily),
                  ),
                  h(
                    "span",
                    {
                      class: `nova-player-adv-danmaku-font-family-select ui ui-select${
                        fontOpen.value ? " ui-select-unfold" : ""
                      }`,
                    },
                    h(
                      "div",
                      { class: "ui-area" },
                      h(
                        "div",
                        { class: "ui-select-wrap" },
                        h(
                          "div",
                          { class: "ui-select-border" },
                          h(
                            "div",
                            {
                              class: "ui-select-header",
                              onClick: (): void => {
                                fontOpen.value = !fontOpen.value;
                              },
                            },
                            h(
                              "span",
                              { class: "ui-select-result" },
                              t(fontLabelKey()),
                            ),
                            h(
                              "span",
                              { class: "ui-select-arrow" },
                              h("span", { class: "ui-select-arrow-down" }),
                            ),
                          ),
                          h(
                            "div",
                            { class: "ui-select-list-wrap" },
                            h(
                              "ul",
                              {
                                class: "ui-select-list",
                                style: `height: ${
                                  fontOpen.value
                                    ? `${ADV_FONT_FAMILIES.length * 22}px`
                                    : "0px"
                                }; border: none;`,
                              },
                              h(For, {
                                each: ADV_FONT_FAMILIES,
                                key: (font: AdvFontFamily): string =>
                                  font.value,
                                render: (font: AdvFontFamily): VNode => {
                                  return h(
                                    "li",
                                    {
                                      class: [
                                        "ui-select-item",
                                        adv().fontFamily === font.value
                                          ? "ui-select-item-active"
                                          : "",
                                      ]
                                        .filter(
                                          (name: string): boolean =>
                                            name !== "",
                                        )
                                        .join(" "),
                                      "data-value": font.value,
                                      onClick: (): void => {
                                        patchAdv({ fontFamily: font.value });
                                        fontOpen.value = false;
                                      },
                                    },
                                    t(font.labelKey),
                                  );
                                },
                              }),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  h(Checkbox, {
                    className: "nova-player-adv-danmaku-font-stroke",
                    checked: (): boolean => adv().stroke,
                    labelKey: KEYS.advStroke,
                    onChange: (checked: boolean): void => {
                      patchAdv({ stroke: checked });
                    },
                  }),
                ),
              ),
              h(
                "div",
                {
                  class:
                    "nova-player-adv-danmaku-group-row nova-player-adv-danmaku-rotate",
                },
                h(
                  "div",
                  {
                    class:
                      "nova-player-adv-danmaku-group-item nova-player-adv-danmaku-rotateZ",
                  },
                  h(
                    "span",
                    { class: "nova-player-adv-danmaku-title" },
                    t(KEYS.advZRotate),
                  ),
                  renderSpinner("zRotate", 0, 360, 1),
                ),
                h(
                  "div",
                  {
                    class:
                      "nova-player-adv-danmaku-group-item nova-player-adv-danmaku-rotateY",
                  },
                  h(
                    "span",
                    { class: "nova-player-adv-danmaku-title" },
                    t(KEYS.advYRotate),
                  ),
                  renderSpinner("yRotate", 0, 360, 1),
                ),
              ),
              h(
                "div",
                {
                  class:
                    "nova-player-adv-danmaku-group-row nova-player-adv-danmaku-property",
                },
                h(
                  "div",
                  {
                    class:
                      "nova-player-adv-danmaku-group-item nova-player-adv-danmaku-duration",
                  },
                  h(
                    "span",
                    { class: "nova-player-adv-danmaku-title" },
                    t(KEYS.advDuration),
                  ),
                  renderSpinner("duration", 0, 10, 0.1),
                ),
                h(
                  "div",
                  {
                    class:
                      "nova-player-adv-danmaku-group-item nova-player-adv-danmaku-opacity",
                  },
                  h(
                    "span",
                    { class: "nova-player-adv-danmaku-title" },
                    t(KEYS.advOpacity),
                  ),
                  renderSpinner("sOpacity", 0, 1, 0.01),
                  h("span", {}, "~"),
                  renderSpinner("eOpacity", 0, 1, 0.01),
                ),
              ),
            ),
            // 第二组：动画 / 运动方式 / 坐标
            h(
              "div",
              { class: "nova-player-adv-danmaku-group" },
              h(
                "div",
                {
                  class:
                    "nova-player-adv-danmaku-group-row nova-player-adv-danmaku-animation",
                },
                h(
                  "div",
                  {
                    class:
                      "nova-player-adv-danmaku-group-item nova-player-adv-danmaku-animation-time",
                  },
                  h(
                    "span",
                    { class: "nova-player-adv-danmaku-title" },
                    t(KEYS.advATime),
                  ),
                  renderSpinner("aTime", 0, 10000, 100),
                ),
                h(
                  "div",
                  {
                    class:
                      "nova-player-adv-danmaku-group-item nova-player-adv-danmaku-animation-delay",
                  },
                  h(
                    "span",
                    { class: "nova-player-adv-danmaku-title" },
                    t(KEYS.advADelay),
                  ),
                  renderSpinner("aDelay", 0, 10000, 100),
                  h(Checkbox, {
                    className: "nova-player-adv-danmaku-speedup",
                    checked: (): boolean => adv().speedup,
                    labelKey: KEYS.advSpeedup,
                    onChange: (checked: boolean): void => {
                      patchAdv({ speedup: checked });
                    },
                  }),
                ),
              ),
              h(
                "div",
                {
                  class:
                    "nova-player-adv-danmaku-group-row nova-player-adv-danmaku-animation-way",
                },
                h(
                  "span",
                  { class: "nova-player-adv-danmaku-title" },
                  t(KEYS.advWay),
                ),
                h(
                  "span",
                  {
                    onClick: (): void => {
                      patchAdv({ way: "start" });
                    },
                    class: `nova-player-adv-danmaku-btn nova-player-adv-danmaku-animation-way1 ui ui-button${
                      adv().way === "start" ? " active" : ""
                    }`,
                  },
                  h("div", { class: "ui-area ui-button-small" }, (): string =>
                    t(KEYS.advWayStart),
                  ),
                ),
                h(
                  "span",
                  {
                    onClick: (): void => {
                      patchAdv({ way: "path" });
                    },
                    class: `nova-player-adv-danmaku-btn nova-player-adv-danmaku-animation-way2 ui ui-button${
                      adv().way === "path" ? " active" : ""
                    }`,
                  },
                  h("div", { class: "ui-area ui-button-small" }, (): string =>
                    t(KEYS.advWayPath),
                  ),
                ),
              ),
              h(
                "div",
                {
                  class:
                    "nova-player-adv-danmaku-group-row nova-player-adv-danmaku-pos",
                },
                h(
                  "span",
                  { class: "nova-player-adv-danmaku-title" },
                  h("span", {}, t(KEYS.advCoordinates)),
                  h(Checkbox, {
                    className: "nova-player-adv-danmaku-pos-percent",
                    checked: (): boolean => adv().percent,
                    labelKey: KEYS.advPercent,
                    onChange: (checked: boolean): void => {
                      patchAdv({ percent: checked });
                    },
                  }),
                ),
                h(
                  "div",
                  { class: "nova-player-adv-danmaku-pos-start" },
                  h(
                    "span",
                    { class: "nova-player-adv-danmaku-pos-title" },
                    t(KEYS.advStart),
                  ),
                  h("span", { class: "nova-player-adv-danmaku-pos-axis" }, "X"),
                  renderSpinner("startX", 0, 9999, 1),
                  h("span", { class: "nova-player-adv-danmaku-pos-axis" }, "Y"),
                  renderSpinner("startY", 0, 9999, 1),
                  h(
                    "span",
                    {
                      class:
                        "nova-player-adv-danmaku-btn nova-player-adv-danmaku-pos-start-follow ui ui-button",
                    },
                    h("div", { class: "ui-area ui-button-gray" }, (): string =>
                      t(KEYS.advTracking),
                    ),
                  ),
                ),
                h(
                  "div",
                  { class: "nova-player-adv-danmaku-pos-end" },
                  h(
                    "span",
                    { class: "nova-player-adv-danmaku-pos-title" },
                    t(KEYS.advEnd),
                  ),
                  h("span", { class: "nova-player-adv-danmaku-pos-axis" }, "X"),
                  renderSpinner("endX", 0, 9999, 1),
                  h("span", { class: "nova-player-adv-danmaku-pos-axis" }, "Y"),
                  renderSpinner("endY", 0, 9999, 1),
                  h(
                    "span",
                    {
                      class:
                        "nova-player-adv-danmaku-btn nova-player-adv-danmaku-pos-end-follow ui ui-button",
                    },
                    h("div", { class: "ui-area ui-button-gray" }, (): string =>
                      t(KEYS.advTracking),
                    ),
                  ),
                ),
              ),
            ),
            // 第三组：正文 / 出现时间 / 发送
            h(
              "div",
              { class: "nova-player-adv-danmaku-group" },
              h(
                "div",
                {
                  class:
                    "nova-player-adv-danmaku-group-row nova-player-adv-danmaku-text",
                },
                h(
                  "span",
                  { class: "nova-player-adv-danmaku-title" },
                  t(KEYS.advBody),
                ),
                h(
                  "div",
                  { class: "nova-player-adv-danmaku-text-input ui ui-input" },
                  h(
                    "div",
                    { class: "ui-area" },
                    h(
                      "div",
                      { class: "ui-input-wrap" },
                      h("textarea", {
                        class: "ui-input-input",
                        ref: (el: unknown): void => {
                          if (!(el instanceof HTMLTextAreaElement)) return;
                          advTextEl = el;
                        },
                        onInput: (event: Event): void => {
                          patchAdv({
                            text: textAreaElement(event)?.value ?? "",
                          });
                        },
                      }),
                    ),
                  ),
                ),
              ),
              h(
                "div",
                {
                  class:
                    "nova-player-adv-danmaku-group-row nova-player-adv-danmaku-showtime",
                },
                h(
                  "span",
                  { class: "nova-player-adv-danmaku-title" },
                  t(KEYS.advShowtime),
                ),
                h(
                  "div",
                  {
                    class: `nova-player-adv-danmaku-showtime-input ui ui-input${
                      adv().currentTime ? " ui-disabled" : ""
                    }`,
                  },
                  h(
                    "div",
                    { class: "ui-area" },
                    h(
                      "div",
                      { class: "ui-input-wrap" },
                      h("input", {
                        class: "ui-input-input",
                        type: "text",
                        ref: (el: unknown): void => {
                          if (!(el instanceof HTMLInputElement)) return;
                          advShowtimeEl = el;
                        },
                        onInput: (event: Event): void => {
                          patchAdv({
                            showtime: inputElement(event)?.value ?? "",
                          });
                        },
                        disabled: adv().currentTime ? "disabled" : "",
                      }),
                    ),
                  ),
                ),
                h(
                  "span",
                  {
                    class: "nova-player-adv-danmaku-showtime-tip",
                    style: { display: "none" },
                  },
                  "hh:mm:ss",
                ),
                h(Checkbox, {
                  className: "nova-player-adv-danmaku-current-time",
                  checked: (): boolean => adv().currentTime,
                  labelKey: KEYS.advCurrentTime,
                  onChange: (checked: boolean): void => {
                    patchAdv({ currentTime: checked });
                  },
                }),
              ),
              h(
                "div",
                {
                  class:
                    "nova-player-adv-danmaku-group-row nova-player-adv-danmaku-send",
                },
                h(
                  "span",
                  {
                    class:
                      "nova-player-adv-danmaku-btn nova-player-adv-danmaku-send-test ui ui-button",
                    onClick: (): void => {
                      props.handlers?.onAdvSubmit?.(adv(), "test");
                    },
                  },
                  h("div", { class: "ui-area ui-button-large" }, (): string =>
                    t(KEYS.advTest),
                  ),
                ),
                h(
                  "span",
                  {
                    class:
                      "nova-player-adv-danmaku-btn nova-player-adv-danmaku-send-send ui ui-button",
                    onClick: (): void => {
                      props.handlers?.onAdvSubmit?.(adv(), "send");
                    },
                  },
                  h("div", { class: "ui-area ui-button-large" }, (): string =>
                    t(KEYS.advSend),
                  ),
                ),
              ),
            ),
          ),
          // 高级面板滚动条
          h(
            "div",
            {
              class: "nscroll-vertical-scrollbar",
              style: `display: ${advMaxScroll() > 0 ? "block" : "none"};`,
            },
            h("div", {
              class: "nscroll-indicator",
              style:
                "background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.9); " +
                `height: ${paneThumbHeight(advContentHeight.value)}px; ` +
                `transform: translateY(${paneThumbTop(
                  advScroll.value,
                  advMaxScroll(),
                  advContentHeight.value,
                )}px) translateZ(0px);`,
            }),
          ),
        ),
        // 高级弹幕付费确认弹窗
        h(
          "div",
          {
            class: "nova-player-adv-danmaku-dialog ui ui-dialog",
            style: `display: ${advDialogOpen.value ? "block" : "none"};`,
          },
          h(
            "div",
            { class: "ui-area" },
            h(
              "div",
              { class: "ui-dialog-wrap" },
              h("div", { class: "ui-dialog-title" }, (): string =>
                t(KEYS.advMenu),
              ),
              h(
                "div",
                { class: "ui-dialog-body" },
                h(
                  "div",
                  { class: "nova-player-adv-danmaku-dialog-content" },
                  h(
                    "div",
                    { class: "nova-player-adv-danmaku-dialog-text" },
                    t(KEYS.advDialogText),
                  ),
                  h(
                    "div",
                    { class: "nova-player-adv-danmaku-dialog-functions" },
                    h(
                      "button",
                      {
                        type: "button",
                        class: "nova-player-adv-danmaku-dialog-function",
                        onClick: (): void => {
                          advDialogOpen.value = false;
                        },
                      },
                      t(KEYS.advDialogNo),
                    ),
                    h(
                      "button",
                      {
                        type: "button",
                        class: "nova-player-adv-danmaku-dialog-function",
                        onClick: (): void => {
                          advDialogOpen.value = false;
                        },
                      },
                      t(KEYS.advDialogCoin),
                    ),
                  ),
                ),
              ),
              h(
                "div",
                {
                  class: "ui-dialog-close",
                  onClick: (): void => {
                    advDialogOpen.value = false;
                  },
                },
                CloseIcon(),
              ),
            ),
          ),
        ),
      );

    // ============================================
    // 生命周期
    // ============================================

    /** 数据 / 尺寸变化时夹紧列表滚动偏移 */
    onEffect(lifecycle, () => {
      listHeight();
      contentHeight();
      applyScroll(scrollTop.peek());
    });

    /** 挂载：观察面板内容高度 + 注册全局关闭监听 */
    lifecycle.onMounted = (): void => {
      observeContent(
        () => blockAreaEl,
        (value): void => {
          blockContentHeight.value = value;
        },
      );
      observeContent(
        () => advAreaEl,
        (value): void => {
          advContentHeight.value = value;
        },
      );
      document.addEventListener("mousedown", handleDocumentDown, true);
      document.addEventListener("keydown", handleDocumentKey, true);
    };

    /** 销毁：清理监听 / 定时器 / ResizeObserver */
    lifecycle.onBeforeDestroy = (): void => {
      document.removeEventListener("mousedown", handleDocumentDown, true);
      document.removeEventListener("keydown", handleDocumentKey, true);
      window.clearTimeout(retryTimer);
      for (const dispose of observerDisposers) dispose();
      observerDisposers.length = 0;
    };

    // ============================================
    // 根节点
    // ============================================

    return h(
      "div",
      {
        "data-injector": "nova",
        "data-revision": "1",
        class: `nova-docker nova-docker-minor${
          isLoggedIn() ? " danmaku-wrap-login" : ""
        }`,
      },
      h(
        "div",
        {
          class: `nova-player-auxiliary${
            isLoggedIn() ? "" : " nova-player-unlogin"
          }`,
        },
        h(
          "div",
          { class: "nova-player-collapse ui ui-collapse" },
          h(
            "div",
            { class: "ui-area" },
            h(
              "div",
              {
                class: `ui-collapse-wrap${
                  folded.value ? " ui-collapse-wrap-folded" : ""
                }`,
              },
              renderHeader(),
              h(
                "div",
                {
                  class: "ui-collapse-body",
                  style: `height: ${collapseHeight()}px;`,
                },
                h(
                  "div",
                  {
                    class: `nova-player-wraplist${
                      menu.value === "LIST" && loadingState.value === 0
                        ? " mask"
                        : ""
                    }`,
                    style: `height: ${bodyHeight()}px;`,
                  },
                  h("div", {
                    class:
                      "nova-player-filter-wrap nova-player-bas-danmaku-visual nova-player-bscrollbar",
                  }),
                  renderListPanel(),
                  renderBlockPanel(),
                  renderAdvPanel(),
                  h("div", {
                    class: "nova-player-setting",
                    style: { display: "none" },
                  }),
                ),
              ),
            ),
          ),
        ),
        h("ul", { class: "nova-player-contextmenu nova-player-white" }),
      ),
    );
  },
);

// ============================================
// 挂载 / 卸载
// ============================================

/**
 * 把弹幕列表视图挂载到指定容器
 *
 * 数据经 signal 传入组件：setList 只写 signal，视图内部 diff 后精准更新，
 * 无需重建组件（卸载由 dispose 统一 destroy）。
 *
 * @param container - 挂载容器（插件会追加 .danmaku-wrap 样式作用域类）
 * @param list - 初始播放器弹幕列表
 * @param options - 视图配置（登录态 / 高度 / 交互回调）
 * @returns 列表挂载句柄（setList / dispose）
 */
export function mountDanmakuListView(
  container: HTMLElement,
  list: readonly PlayerDanmakuItem[],
  options?: {
    loggedIn?: boolean;
    height?: number;
    historyDates?: readonly string[];
    handlers?: DanmakuListProps["handlers"];
  },
): DanmakuListViewHandle {
  /** 响应式数据源（插件 updateList 写它，视图自动更新） */
  const rowsSignal = signal<DanmakuListRow[]>(toListRows(list));

  /** 视图 VNode（dispose 时 destroy） */
  const vnode = h(DanmakuList, {
    rows: rowsSignal,
    loggedIn: options?.loggedIn ?? false,
    height: options?.height,
    historyDates: options?.historyDates,
    handlers: options?.handlers,
  });

  mount(vnode, container);

  return {
    setList(next: readonly PlayerDanmakuItem[]): void {
      rowsSignal.value = toListRows(next);
    },
    dispose(): void {
      destroy(vnode);
    },
  };
}

export type {
  DanmakuListHandlers,
  DanmakuListProps,
  DanmakuListRow,
  DanmakuListViewHandle,
} from "./types";
