/**
 * ============================================
 * 插槽注入类型定义 (slots)
 * ============================================
 *
 * 阶段 C.1：播放器支持外部通过配置注入控制栏插槽与片尾页面内容。
 *
 * 设计要点：
 * - 区域插槽走「配置数组 + 插槽 id/顺序」：每项携带 slot/order/content，
 *   由 LeftControls / RightControls / PlayerDocker 按 slot 分组、按 order 升序渲染。
 * - 插件插槽由插件在 install 时通过 defineSlot 声明（id + 所属区域 + order + 默认内容），
 *   播放器只提供挂载规则，插槽内容由插件自己管理；消费方仍可通过 ui.slots 追加。
 * - 片尾页面插槽走「整页替换」：传入 content 即替换默认 Ending 组件渲染。
 * - 插槽 VNode 的生命周期由播放器统一管理（mount/destroy），外部只负责构造 VNode。
 */

import { createContext, mount } from '@lumina/framework/core';
import type { VNode } from '@lumina/framework/types';
import type { TypedStateManager } from '@lumina/framework/core';
import type { PlayerStateMap } from '../store/runtimeState';
import type { PlayerPort, PlayerUiHost } from './playerPort';

/**
 * 播放器内置区域插槽 id
 *
 * 区域容器由播放器固定渲染（无论是否装入插件 / 是否配置 ui.top 都存在），
 * 消费方可随时向区域追加内容：
 *
 * - video.overlay：视频画面区域（`.nova-player-video-area`）的悬浮插槽位；
 *   插槽内容按 order 依次追加，位置 / 层级 / 显隐 / 皮肤全部由插槽内容
 *   自行控制（播放器不创建任何包装 DOM，也不提供定位规则），
 *   如稍后再看 PiP 的上一个 / 下一个、mini 播放 / 音量按钮等
 * - controls.left.end：左侧按钮组末尾（prev / play / next / time 之后）
 * - controls.center：底部中央（LeftControls 与 RightControls 之间）；
 *   出口固定在控制栏中央，原生弹幕发送栏由 moveSendBar 追加在其后
 * - controls.right.start：右侧按钮组开头（quality 之前）
 * - controls.right.end：右侧按钮组末尾（full 之后）
 * - top.start：顶部栏左侧起始位（顶部内容之前）
 * - top.end：顶部栏右侧末尾位（顶部内容之后）
 */
export type RegionSlotId =
  | 'video.overlay'
  | 'controls.left.end'
  | 'controls.center'
  | 'controls.right.start'
  | 'controls.right.end'
  | 'top.start'
  | 'top.end';

/**
 * 插件自定义插槽 id
 *
 * 命名规则：`plugin.<插件名>.<用途>`。
 * 插件在 install 时通过 `defineSlot` 声明（id + 所属区域 + 排序 + 默认内容），
 * 播放器只负责按区域挂载；插槽的语义与内容全部由插件自己管理。
 */
export type PluginSlotId = `plugin.${string}.${string}`;

/** 全部可挂载的插槽 id */
export type SlotId = RegionSlotId | PluginSlotId;

/**
 * 插件插槽定义
 *
 * 插件 install 时声明，播放器据此把插槽内容挂到 `region` 对应区域；
 * 消费方仍可通过 `ui.slots` 向该插槽追加内容。
 */
export interface PluginSlotDefinition {
  /** 插件插槽 id（plugin.<插件名>.<用途>） */
  id: PluginSlotId;
  /** 挂载区域 */
  region: RegionSlotId;
  /** 区域内的排序权重，小的在前；默认 0 */
  order?: number;
  /** 插件为该插槽提供的默认内容；不提供时仅作为空插槽供消费方追加 */
  content?: SlotEntryContent;
}

/**
 * 插槽项内容
 *
 * - VNode：交给框架 mount，保留组件生命周期与事件；
 * - Node：原生 DOM 节点，直接 append（跨文档时由浏览器 adopt）；
 * - string：按 HTML 解析为 DocumentFragment 后 append；
 * - SlotMount：自定义挂载函数，拿到容器自行创建 DOM，并可返回清理函数；
 * - 函数：挂载期执行一次并传入 SlotContext，返回上述任意内容。
 *
 * 框架没有编译期响应式：函数只在挂载期执行一次，字符串内容也是静态快照。
 * 需要动态更新时使用 SlotMount 保存元素引用后手动更新，或由调用方重建插槽。
 */
export type SlotEntryContent =
  | VNode
  | Node
  | string
  | SlotMount
  | ((ctx: SlotContext) => SlotEntryContent | null);

/**
 * 可被插槽替换的原生控制按钮
 *
 * 用于 host 完全接管某个原生按钮：原生按钮不渲染，插槽内容挂到同一位置。
 * 替换项仍带 slot 字段，但替换模式下 slot 不参与排序。
 */
export type NativeControlKey =
  | "play"
  | "prev"
  | "next"
  | "time"
  | "quality"
  | "eplist"
  | "playbackrate"
  | "subtitle"
  | "volume"
  | "setting"
  | "pip"
  | "wide"
  | "web"
  | "full"
  | "flac";

/** 原生控制按钮选择器（保留用于兼容 / 测试定位；替换渲染已改为渲染期判定） */
export const NATIVE_CONTROL_SELECTORS: Record<NativeControlKey, string> = {
  play: ".nova-player-ctrl-play",
  prev: ".nova-player-ctrl-prev",
  next: ".nova-player-ctrl-next",
  time: ".nova-player-ctrl-time",
  quality: ".nova-player-ctrl-quality",
  eplist: ".nova-player-ctrl-eplist",
  playbackrate: ".nova-player-ctrl-playbackrate",
  subtitle: ".nova-player-ctrl-subtitle",
  volume: ".nova-player-ctrl-volume",
  setting: ".nova-player-ctrl-setting",
  pip: ".nova-player-ctrl-pip",
  wide: ".nova-player-ctrl-wide",
  web: ".nova-player-ctrl-web",
  full: ".nova-player-ctrl-full",
  flac: ".nova-player-ctrl-flac",
};

/** 替换目标类型：按钮图标元素 / 按钮结果（文字）元素 */
export type NativeReplaceTargetKind = "btn-icon" | "result";

/**
 * 各原生控件被插槽接管时「首次渲染就不创建」的目标元素
 *
 * 语义：只要调用方提供了 `replace: key` 的插槽，对应目标元素在渲染期直接
 * 不创建（不是先渲染再清空/删除），只渲染插槽内容；按钮壳、面板、事件、
 * 其它子节点保持不变。这样既不会泄漏 Lottie 实例，也允许消费方自定义图标/文案。
 *
 * 注：`time` 未纳入替换目标（保持原生渲染），列出仅用于满足 Record 完整性。
 */
export const NATIVE_REPLACE_TARGETS: Record<
  NativeControlKey,
  { kind: NativeReplaceTargetKind; selector: string }
> = {
  play: { kind: "btn-icon", selector: ".nova-player-ctrl-btn-icon" },
  prev: { kind: "btn-icon", selector: ".nova-player-ctrl-btn-icon" },
  next: { kind: "btn-icon", selector: ".nova-player-ctrl-btn-icon" },
  time: { kind: "result", selector: ".nova-player-ctrl-time" },
  quality: { kind: "result", selector: ".nova-player-ctrl-quality-result" },
  eplist: { kind: "result", selector: ".nova-player-ctrl-eplist-result" },
  playbackrate: { kind: "result", selector: ".nova-player-ctrl-playbackrate-result" },
  subtitle: { kind: "result", selector: ".nova-player-ctrl-subtitle-result-wrap" },
  volume: { kind: "btn-icon", selector: ".nova-player-ctrl-btn-icon" },
  setting: { kind: "btn-icon", selector: ".nova-player-ctrl-btn-icon" },
  pip: { kind: "btn-icon", selector: ".nova-player-ctrl-btn-icon" },
  wide: { kind: "btn-icon", selector: ".nova-player-ctrl-btn-icon" },
  web: { kind: "btn-icon", selector: ".nova-player-ctrl-btn-icon" },
  full: { kind: "btn-icon", selector: ".nova-player-ctrl-btn-icon" },
  flac: { kind: "btn-icon", selector: ".nova-player-ctrl-btn-icon" },
};

/**
 * 找到某个原生控件的替换插槽（同一 key 取数组中第一个）
 *
 * @param entries - 全量插槽项（来自 player.props.ui.slots）
 * @param key - 原生控件 key
 * @returns 命中的替换插槽项；未提供时返回 undefined（走原生渲染）
 */
export function findReplaceSlot(
  entries: readonly SlotEntry[] | undefined,
  key: NativeControlKey,
): SlotEntry | undefined {
  return (entries ?? []).find((entry) => entry.replace === key);
}

/**
 * 单个插槽项
 */
export interface SlotEntry {
  /** 唯一 id，用于 diff / 卸载 */
  id: string;
  /** 目标插槽 id（内置区域或插件声明的插槽） */
  slot: SlotId;
  /**
   * 排序权重，小的在前；默认 0
   *
   * 同一插槽内多个插槽项按 order 升序排列；同 order 时按数组顺序稳定排列。
   */
  order?: number;
  /**
   * 替换原生控制按钮；指定后默认隐藏原生按钮，内容直接挂到该按钮所在容器。
   * 替换模式下 slot 不参与排序。
   */
  replace?: NativeControlKey;
  /**
   * 替换模式的面板策略（仅 replace 生效）：
   *
   * - `custom`（默认）：隐藏原生按钮，插槽内容插到原位置；面板/交互由消费方自建；
   * - `native`：只替换原生按钮的**图标**——原生按钮、内置面板与全部交互保留，
   *   原生图标隐藏，插槽内容插入 `.nova-player-ctrl-btn-icon`（不存在时插入
   *   按钮本身），点击等事件冒泡给原生按钮，因此可同时拿到「原版图标 +
   *   播放器自带面板」。
   */
  replacePanel?: "native" | "custom";
  /**
   * 插槽内容，支持 VNode / 原生 Node / HTML 字符串 / 自定义挂载。
   * 详见 SlotEntryContent。
   */
  content: SlotEntryContent;
}

/**
 * 插槽上下文
 *
 * 传递给函数形式 vnode 的运行时上下文，供其访问播放器实例与状态管理器。
 */
export interface SlotContext {
  /** 播放器端口（UI/插件只依赖该契约，不依赖 VideoPlayer 具体实现） */
  player: PlayerPort;
  /** 运行时状态管理器（与组件树内 useContext(StateContext) 同源） */
  state: TypedStateManager<PlayerStateMap>;
}

/**
 * 其它框架 UI 的挂载函数：播放器只提供已有容器，不创建包装 DOM。
 */
export interface SlotMount {
  mount: (
    container: HTMLElement,
    ctx: SlotContext | null,
  ) => void | (() => void);
}

/** 插槽输入：原生 DOM / 其它框架挂载函数 / 返回它们的函数 */
export type SlotContent =
  | Node
  | SlotMount
  | ((ctx: SlotContext) => SlotContent | null);

/** Top / Ending 单插槽类型别名 */
export type TopSlot = SlotContent;
export type EndingSlot = SlotContent;

/**
 * 解析插槽内容；函数形式在 ctx 为空时不执行
 */
export function resolveSlotContent(
  content: SlotContent | undefined,
  ctx: SlotContext | null,
): Node | SlotMount | null {
  let current: SlotContent | null | undefined = content;
  while (typeof current === "function") {
    current = ctx ? current(ctx) : null;
    if (current == null) return null;
  }
  return current ?? null;
}

/**
 * 播放器实例上下文
 *
 * 由 VideoPlayer.render() 通过 __providers 注入，供子组件在渲染插槽函数时
 * 构造 SlotContext。默认值为 null：未注入时不调用函数式 vnode。
 */
export const PlayerContext = createContext<PlayerUiHost | null>(null);

/**
 * 按插槽 id 过滤插槽项并按 order 升序稳定排序
 *
 * 稳定排序：同 order 时保持原数组顺序（Array.prototype.sort 在主流引擎中是稳定排序）。
 *
 * @param entries - 全量插槽项（来自 ui.slots）
 * @param slot - 目标插槽 id
 * @returns 该插槽下的插槽项（已排序）
 */
export function pickSlotEntries(
  entries: readonly SlotEntry[] | undefined,
  slot: SlotId,
): readonly SlotEntry[] {
  if (!entries || entries.length === 0) return [];
  return entries
    .filter((entry) => entry.slot === slot && !entry.replace)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * 汇总某个区域应挂载的全部插槽项
 *
 * 规则（播放器只提供挂载规则，内容由插件 / 消费方自己管理）：
 * - `slot === region` 的插槽项按自身 order 参与排序；
 * - 插件定义的插槽（`definition.region === region`）把默认内容作为一项挂入，
 *   并包含消费方以该插件插槽 id 追加的插槽项；
 * - 插件插槽的排序权重 = 定义 order + 插槽项 order。
 *
 * @param entries - 全量插槽项（来自 ui.slots）
 * @param definitions - 插件插槽定义（来自 player.getSlotDefinitions()）
 * @param region - 目标区域
 * @returns 该区域内的插槽项（已排序）
 */
export function collectRegionEntries(
  entries: readonly SlotEntry[] | undefined,
  definitions: readonly PluginSlotDefinition[] | undefined,
  region: RegionSlotId,
): readonly SlotEntry[] {
  const list: Array<{ entry: SlotEntry; order: number }> = [];
  for (const entry of entries ?? []) {
    if (entry.replace) continue;
    if (entry.slot === region) {
      list.push({ entry, order: entry.order ?? 0 });
      continue;
    }
    const definition = (definitions ?? []).find(
      (item) => item.region === region && item.id === entry.slot,
    );
    if (definition) {
      list.push({ entry, order: (definition.order ?? 0) + (entry.order ?? 0) });
    }
  }
  for (const definition of definitions ?? []) {
    if (definition.region !== region || !definition.content) continue;
    list.push({
      entry: {
        id: definition.id,
        slot: definition.id,
        content: definition.content,
      },
      order: definition.order ?? 0,
    });
  }
  return list
    .sort((a, b) => a.order - b.order)
    .map((item) => item.entry);
}

/** 原生 DOM 判定：用 nodeType 而不是 instanceof，兼容 Document PiP 等跨 realm 节点 */
function isDomNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Node).nodeType === "number" &&
    typeof (value as Node).nodeName === "string"
  );
}

/**
 * 解析单个插槽项内容
 *
 * 函数形式在挂载期展开一次并传入 SlotContext；ctx 为 null 时不执行。
 *
 * @param entry - 插槽项
 * @param ctx - SlotContext，player / state 任一缺失视为不可用
 * @returns VNode / Node / HTML 字符串 / SlotMount / null
 */
export function resolveSlotEntryContent(
  entry: SlotEntry,
  ctx: SlotContext | null,
): VNode | Node | string | SlotMount | null {
  let current: SlotEntryContent | null = entry.content;
  while (typeof current === "function") {
    if (!ctx) return null;
    current = current(ctx);
    if (current == null) return null;
  }
  return current;
}

/** 判断其它框架挂载描述 */
export function isSlotMount(value: unknown): value is SlotMount {
  return (
    typeof value === "object" &&
    value !== null &&
    "mount" in value &&
    typeof (value as SlotMount).mount === "function"
  );
}

/**
 * 把 HTML 字符串按容器的 ownerDocument 解析并追加
 *
 * 跨文档（Document PiP）时必须用 ownerDocument，否则节点归属错误。
 */
function appendHtml(container: HTMLElement, html: string): void {
  const template = container.ownerDocument.createElement("template");
  template.innerHTML = html;
  container.appendChild(template.content);
}

interface MountedSlotItem {
  nodes: Node[];
  cleanup: (() => void) | null;
}

/** 挂载单个插槽项；anchor 存在时插入到锚点之前 */
function mountSlotItem(
  item: SlotEntry,
  container: HTMLElement,
  ctx: SlotContext | null,
  anchor: Node | null,
): MountedSlotItem {
  const content = resolveSlotEntryContent(item, ctx);
  if (!content) return { nodes: [], cleanup: null };

  // 用 lastChild 而不是 lastElementChild：HTML 字符串可能以文本节点开头
  const marker = container.lastChild;
  let cleanup: (() => void) | null = null;

  if (typeof content === "string") {
    appendHtml(container, content);
  } else if (isSlotMount(content)) {
    const result = content.mount(container, ctx);
    if (typeof result === "function") cleanup = result;
  } else if (isDomNode(content)) {
    container.appendChild(content);
  } else {
    mount(content, container);
  }

  // 记录本次追加的节点，供卸载时精确移除
  const nodes: Node[] = [];
  let node: Node | null = marker ? marker.nextSibling : container.firstChild;
  while (node) {
    nodes.push(node);
    node = node.nextSibling;
  }

  if (anchor && anchor.parentNode === container) {
    for (const insertedNode of nodes) {
      container.insertBefore(insertedNode, anchor);
    }
  }

  return { nodes, cleanup };
}

/** 判断值是否为框架 VNode（与 DOM Node 区分：VNode 没有 nodeType，带 tag/__tmpl/__flow/__reactive） */
function isFrameworkVNode(value: unknown): value is VNode {
  if (typeof value !== "object" || value === null) return false;
  const vnode = value as {
    tag?: unknown;
    __tmpl?: unknown;
    __flow?: unknown;
    __reactive?: unknown;
  };
  return (
    typeof vnode.tag === "string" ||
    typeof vnode.tag === "function" ||
    vnode.__tmpl !== undefined ||
    vnode.__flow !== undefined ||
    vnode.__reactive !== undefined
  );
}

/**
 * 解析替换插槽内容（被替换的目标节点在渲染期直接不创建）
 *
 * 替换内容**直接作为该位置的节点插入，不创建任何包装元素 / 占位 / 自造 class**：
 * - VNode：原样返回，交给框架 mount，生命周期由框架管理；
 * - 空内容（null / undefined）：返回 null，目标节点同样不渲染；
 * - 原生 Node / HTML 字符串 / SlotMount：无法在渲染期“无包装”地插入，
 *   输出一次开发警告并返回 null（需要挂载原生节点时请使用 `custom` 模式，
 *   由调用方自行接管整个按钮，或改用区域插槽）。
 *
 * @param entry - 命中 replace 的插槽项
 * @param ctx - SlotContext
 */
export function resolveReplaceVNode(
  entry: SlotEntry,
  ctx: SlotContext | null,
): VNode | null {
  const content = resolveSlotEntryContent(entry, ctx);
  if (content === null || content === undefined) return null;
  if (isFrameworkVNode(content)) return content;
  console.warn(
    `[nova-player] replace 插槽 "${entry.id}" 的内容必须是 VNode（当前为 ${
      typeof content === "string" ? "HTML 字符串" : "原生 Node / SlotMount"
    }）；` +
      "渲染期替换不创建包装元素，原生节点请改用 custom 模式或区域插槽。",
  );
  return null;
}

/**
 * 替换解析器：控制栏组件在渲染期询问「某个原生控件是否被插槽接管」
 *
 * 语义：`take(key).replaced === true` 时，调用方必须**不创建**目标节点，
 * 直接用返回的 node（可能为 null）替代；`replaced === false` 时走原生渲染。
 */
export interface ReplaceResolver {
  /** 解析某个原生控件的替换内容 */
  take(key: NativeControlKey): { replaced: boolean; node: VNode | null };
}

/**
 * 创建替换解析器
 *
 * @param player - 播放器 UI 宿主（来自 PlayerContext）；为空时全部走原生渲染
 */
export function createReplaceResolver(
  player: PlayerUiHost | null | undefined,
): ReplaceResolver {
  const slotCtx = (): SlotContext | null =>
    player ? { player, state: player.state } : null;
  return {
    take(key: NativeControlKey): { replaced: boolean; node: VNode | null } {
      const entry = findReplaceSlot(player?.props.ui?.slots, key);
      if (!entry) return { replaced: false, node: null };
      return { replaced: true, node: resolveReplaceVNode(entry, slotCtx()) };
    },
  };
}

/**
 * 把某个区域的插槽内容批量挂载到容器，返回统一清理函数
 *
 * 区域内容 = 直接指向该区域的插槽项 + 插件声明在该区域的插槽（含默认内容
 * 与消费方追加到插件插槽的插槽项），统一按 order 排序后挂载。
 *
 * 内容支持 VNode / 原生 Node / HTML 字符串 / SlotMount（见 SlotEntryContent）。
 *
 * 消费端约定：
 * - 容器可为「本区域专用空 div」，也可为与原生内容共享的容器
 *   （共享时清理函数只移除本次挂载追加的节点，不触碰容器内已有元素）；
 * - 重复挂载前应先执行上一次返回的清理函数；
 * - 清理函数幂等：自定义挂载的 cleanup 先执行，再移除本次追加但仍在容器中的节点。
 *
 * @param entries - 全量插槽项（来自 ui.slots）
 * @param definitions - 插件插槽定义（来自 player.getSlotDefinitions()）
 * @param region - 目标区域
 * @param container - 目标容器元素
 * @param ctx - SlotContext；为 null 时跳过函数式内容，仅挂载静态内容
 * @param anchor - 可选插入锚点；指定时插槽节点插到锚点之前，缺省追加到容器末尾
 * @returns 清理函数（幂等：重复调用无副作用）
 */
export function mountRegionSlots(
  entries: readonly SlotEntry[] | undefined,
  definitions: readonly PluginSlotDefinition[] | undefined,
  region: RegionSlotId,
  container: HTMLElement,
  ctx: SlotContext | null,
  anchor: Node | null = null,
): () => void {
  const items = collectRegionEntries(entries, definitions, region);
  /** 本次挂载追加的节点（清理时只移除这些，不影响容器内已有元素） */
  const appended: Node[] = [];
  /** 自定义挂载返回的清理函数 */
  const customCleanups: Array<() => void> = [];

  for (const item of items) {
    const mounted = mountSlotItem(item, container, ctx, anchor);
    appended.push(...mounted.nodes);
    if (mounted.cleanup) customCleanups.push(mounted.cleanup);
  }

  if (appended.length === 0 && customCleanups.length === 0) {
    return (): void => {};
  }

  let cleaned = false;
  return (): void => {
    if (cleaned) return;
    cleaned = true;
    // 自定义挂载可能自己移除节点，先执行其 cleanup
    for (const cleanup of customCleanups) cleanup();
    for (const node of appended) {
      if (node.parentNode === container) container.removeChild(node);
    }
    appended.length = 0;
    customCleanups.length = 0;
  };
}

/**
 * 挂载替换原生控制按钮的插槽（**已废弃，不再被运行时调用**）
 *
 * 新版替换语义在**渲染期**判定：控制栏组件通过 `createReplaceResolver` /
 * `findReplaceSlot` 读取 `ui.slots`，命中 replace 时直接不创建目标节点
 * （见 `NATIVE_REPLACE_TARGETS`），因此不再需要“先渲染后清空/删除”的 DOM 手术。
 *
 * 保留导出仅为兼容既有外部调用方与单元测试；新代码不要使用。
 *
 * @deprecated 使用 `createReplaceResolver` 在渲染期替换，避免 Lottie 实例泄漏。
 *
 * 对每个带 replace 的插槽：隐藏对应原生按钮，并把插槽内容插到按钮原位置。
 * 清理时移除插槽内容并恢复原生按钮显示。
 *
 * @param slots - 全量插槽项
 * @param container - 原生按钮所在容器
 * @param ctx - SlotContext
 * @returns 清理函数（幂等）
 */
export function mountReplacementSlots(
  slots: readonly SlotEntry[] | undefined,
  container: HTMLElement,
  ctx: SlotContext | null,
): () => void {
  const items = (slots ?? []).filter((slot) => Boolean(slot.replace));
  const removers: Array<() => void> = [];
  const restores: Array<() => void> = [];
  /** 同一个原生按钮只替换一次 */
  const replacedKeys = new Set<NativeControlKey>();

  for (const item of items) {
    const key = item.replace;
    if (!key || replacedKeys.has(key)) continue;
    const native = container.querySelector<HTMLElement>(NATIVE_CONTROL_SELECTORS[key]);
    // 渲染层已按 replace 跳过该原生控件（DOM 从未创建）：内容按原始按钮顺序插到正确位置，
    // 而不是 append 到容器末尾。左右控制栏各自使用自己的原生顺序。
    // replace 项由控制栏渲染层直接渲染成 VNode 占位（原生按钮不渲染），
    // 这里不再做任何“先挂到容器/再删除原生”的动作，直接跳过。
    if (!native) continue;
    replacedKeys.add(key);

    // 插槽替换 = 原生控件不渲染：所有 replace 项统一走「内容插原位 + 原生 DOM 移除」，
    // 不存在 display:none 保留 DOM 的分支。
    if ((item.replacePanel ?? "custom") === "native") {
      const iconHost =
        native.querySelector<HTMLElement>(".nova-player-ctrl-btn-icon") ?? native;
      // 图标容器内部一律清空（图标 DOM 直接移除，不是 display:none）；
      // 若定位不到 .ctrl-btn-icon、只能落到按钮根节点，则排除面板/菜单类节点，避免误删。
      const targets = (Array.from(iconHost.children) as HTMLElement[]).filter((el) => {
        if (iconHost !== native) return true;
        const cls = typeof el.className === "string" ? el.className : "";
        return !/box|menu|panel|wrap|list|language/i.test(cls);
      });
      const removedGlyphs: Array<{ el: HTMLElement; index: number }> = [];
      for (const el of targets) {
        const index = Array.prototype.indexOf.call(iconHost.children, el);
        if (index < 0) continue;
        removedGlyphs.push({ el, index });
        iconHost.removeChild(el);
      }
      restores.push(() => {
        for (const item of removedGlyphs) {
          const ref = iconHost.children[item.index] ?? null;
          iconHost.insertBefore(item.el, ref);
        }
      });

      const mounted = mountSlotItem(item, iconHost, ctx, null);
      removers.push(() => {
        mounted.cleanup?.();
        for (const node of mounted.nodes) {
          if (node.parentNode === iconHost) iconHost.removeChild(node);
        }
      });
      continue;
    }

    // custom 模式：先把插槽内容插到原生按钮原来的位置，再把原生按钮**整体从 DOM 移除**
    // （不是 display:none）；清理时先移除内容、再把按钮插回原位。
    const parent = native.parentElement;
    const nextSibling = native.nextSibling;

    const mounted = mountSlotItem(item, container, ctx, native);
    parent?.removeChild(native);
    restores.push(() => {
      if (parent) parent.insertBefore(native, nextSibling);
    });

    removers.push(() => {
      mounted.cleanup?.();
      for (const node of mounted.nodes) {
        if (node.parentNode === container) container.removeChild(node);
      }
    });
  }

  if (removers.length === 0) return (): void => {};

  let cleaned = false;
  return (): void => {
    if (cleaned) return;
    cleaned = true;
    for (const remove of removers) remove();
    for (const restore of restores) restore();
  };
}
