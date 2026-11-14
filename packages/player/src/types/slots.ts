/**
 * ============================================
 * 插槽注入类型定义 (slots)
 * ============================================
 *
 * 阶段 C.1：播放器支持外部通过配置注入控制栏插槽与片尾页面内容。
 *
 * 设计要点：
 * - 控制栏插槽走「配置数组 + 位置/顺序」：每项携带 position/order/vnode，
 *   由 LeftControls / RightControls / TopControls 按 position 分组、按 order 升序渲染。
 * - 片尾页面插槽走「整页替换」：传入 content 即替换默认 Ending 组件渲染。
 * - 插槽 VNode 的生命周期由播放器统一管理（mount/destroy），外部只负责构造 VNode。
 */

import { createContext, mount } from '@lumina/framework/core';
import type { VNode } from '@lumina/framework/types';
import type { TypedStateManager } from '@lumina/framework/core';
import type { PlayerStateMap } from '../store/runtimeState';
import type { VideoPlayer } from '../player';

/**
 * 插槽位置枚举
 *
 * - leftEnd：左侧按钮组末尾（prev / play / next / time 之后）
 * - rightStart：右侧按钮组开头（quality 之前），由右控制栏首部出口承载
 * - rightEnd：右侧按钮组末尾（full 之后），由右控制栏尾部出口承载
 * - topRight：顶部栏右侧（与顶部进度条同层）
 * - bottomCenter：底部中央（LeftControls 与 RightControls 之间）；
 *   出口固定在控制栏中央，原生弹幕发送栏由 moveSendBar 追加在其后
 * - stageLeft / stageRight：视频画面左右边缘垂直居中的悬浮层
 *   （cross 模式专属，如稍后再看形态的上一个 / 下一个悬浮按钮；
 *    挂载点容器常驻 DOM，显隐与定位由 cross.scss 按 data-screen 派生）
 * - cornerLeft / cornerRight：视频画面左下 / 右下的常驻悬浮层，
 *   直接挂到 video-area，内容自行绝对定位（如 mini 播放 / 音量按钮）
 */
export type ControlSlotPosition =
  | 'leftEnd'
  | 'rightStart'
  | 'rightEnd'
  | 'topRight'
  | 'bottomCenter'
  | 'stageLeft'
  | 'stageRight'
  | 'cornerLeft'
  | 'cornerRight';

/**
 * 控制栏插槽内容
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
export type ControlSlotContent =
  | VNode
  | Node
  | string
  | SlotMount
  | ((ctx: SlotContext) => ControlSlotContent | null);

/**
 * 可被插槽替换的原生控制按钮
 *
 * 用于 host 完全接管某个原生按钮：原生按钮隐藏，插槽内容挂到同一位置。
 * 替换项仍带 position 字段，但替换模式下 position 不参与排序。
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

/** 原生控制按钮选择器（替换时按此定位） */
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

/**
 * 单个插槽项
 */
export interface ControlSlotItem {
  /** 唯一 id，用于 diff / 卸载 */
  id: string;
  /** 插槽位置 */
  position: ControlSlotPosition;
  /**
   * 排序权重，小的在前；默认 0
   *
   * 同一 position 内多个插槽按 order 升序排列；同 order 时按数组顺序稳定排列。
   */
  order?: number;
  /**
   * 替换原生控制按钮；指定后默认隐藏原生按钮，内容直接挂到该按钮所在容器。
   * 替换模式下 position 不参与排序。
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
   * 详见 ControlSlotContent。
   */
  vnode: ControlSlotContent;
}

/**
 * 插槽上下文
 *
 * 传递给函数形式 vnode 的运行时上下文，供其访问播放器实例与状态管理器。
 */
export interface SlotContext {
  /** 播放器实例（可用于调用 API / 订阅事件） */
  player: VideoPlayer;
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
export const PlayerContext = createContext<VideoPlayer | null>(null);

/**
 * 按位置过滤插槽并按 order 升序稳定排序
 *
 * 稳定排序：同 order 时保持原数组顺序（Array.prototype.sort 在主流引擎中是稳定排序）。
 * 函数式 vnode 在此不展开，由调用方在持有时通过 resolveSlotVNode 处理。
 *
 * @param slots - 全量插槽列表（来自 ui.slots）
 * @param position - 目标位置
 * @returns 该位置下的插槽项（已排序）
 */
export function pickSlotsByPosition(
  slots: readonly ControlSlotItem[] | undefined,
  position: ControlSlotPosition,
): readonly ControlSlotItem[] {
  if (!slots || slots.length === 0) return [];
  return slots
    .filter((slot) => slot.position === position && !slot.replace)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
 * @param slot - 插槽项
 * @param ctx - SlotContext，player / state 任一缺失视为不可用
 * @returns VNode / Node / HTML 字符串 / SlotMount / null
 */
export function resolveControlSlotContent(
  slot: ControlSlotItem,
  ctx: SlotContext | null,
): VNode | Node | string | SlotMount | null {
  let current: ControlSlotContent | null = slot.vnode;
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
  item: ControlSlotItem,
  container: HTMLElement,
  ctx: SlotContext | null,
  anchor: Node | null,
): MountedSlotItem {
  const content = resolveControlSlotContent(item, ctx);
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

/**
 * 把指定位置的插槽内容批量挂载到容器，返回统一清理函数
 *
 * 内容支持 VNode / 原生 Node / HTML 字符串 / SlotMount（见 ControlSlotContent）。
 *
 * 消费端约定：
 * - 容器可为「本位置专用空 div」，也可为与原生内容共享的容器
 *   （共享时清理函数只移除本次挂载追加的节点，不触碰容器内已有元素）；
 * - 重复挂载前应先执行上一次返回的清理函数；
 * - 清理函数幂等：自定义挂载的 cleanup 先执行，再移除本次追加但仍在容器中的节点。
 *
 * @param slots - 全量插槽列表（来自 ui.slots）
 * @param position - 目标位置（leftEnd / stageLeft / stageRight 等）
 * @param container - 目标容器元素
 * @param ctx - SlotContext；为 null 时跳过函数式内容，仅挂载静态内容
 * @param anchor - 可选插入锚点；指定时插槽节点插到锚点之前，缺省追加到容器末尾
 * @returns 清理函数（幂等：重复调用无副作用）
 */
export function mountControlSlots(
  slots: readonly ControlSlotItem[] | undefined,
  position: ControlSlotPosition,
  container: HTMLElement,
  ctx: SlotContext | null,
  anchor: Node | null = null,
): () => void {
  const items = pickSlotsByPosition(slots, position);
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
 * 挂载替换原生控制按钮的插槽
 *
 * 对每个带 replace 的插槽：隐藏对应原生按钮，并把插槽内容插到按钮原位置。
 * 清理时移除插槽内容并恢复原生按钮显示。
 *
 * @param slots - 全量插槽列表
 * @param container - 原生按钮所在容器
 * @param ctx - SlotContext
 * @returns 清理函数（幂等）
 */
export function mountReplacementSlots(
  slots: readonly ControlSlotItem[] | undefined,
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
    if ((item.replacePanel as string) === "native-panel-keep") {
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
