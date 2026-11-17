/**
 * ============================================
 * 快捷键面板组件
 * ============================================
 * 声明式响应式版本：面板显隐由 activeSignal 驱动根节点
 * nova-player-panel-active 类（__reactiveAttrs），
 * 对外 show/hide/open/close API 契约不变，内部仅写信号。
 */

import { h, defineComponent, signal, For, t } from '@lumina/framework/core';
import type { ComponentLifecycle, VNode } from "@lumina/framework/types";
import { HOTKEYS, type HotkeyConfig } from "../core/hotkeys";
import type { HotkeyRegistry } from "../core/hotkeyRegistry";

/**
 * 快捷键项接口
 * 描述单个快捷键的按键名称和功能说明
 */
export interface HotkeyItem {
  /** 唯一 id（插件注册项提供） */
  id?: string;
  /** 来源插件名，用于分组展示 */
  plugin?: string;
  /** 快捷键按键名称 */
  name: string;
  /** 名称 i18n key（可选） */
  nameKey?: string;
  /** 快捷键功能描述 */
  desc: string;
  /** 描述 i18n key（可选） */
  descKey?: string;
}

/**
 * 快捷键面板组件 Props 接口
 */
export interface HotkeyPanelProps {
  /** 是否立即显示面板（默认为隐藏，由用户主动打开） */
  visible?: boolean;
  /** 快捷键列表，未提供时使用 HOTKEYS（与真实快捷键行为同一数据源） */
  hotkeys?: HotkeyItem[];
  /** 快捷键注册表：传入后订阅变化，内置与插件快捷键实时更新 */
  registry?: HotkeyRegistry;
  /** 关闭面板的回调函数 */
  onClose?: () => void;
}

/**
 * 快捷键面板对外暴露的 API
 */
export interface HotkeyPanelApi {
  /** 打开面板 */
  open: () => void;
  /** 关闭面板 */
  close: () => void;
}

/**
 * 关闭图标（与既有实现的 Close 图标一致）
 */
const CloseIcon = (): ReturnType<typeof h> =>
  h(
    "svg",
    {
      viewBox: "0 0 1024 1024",
      version: "1.1",
      xmlns: "http://www.w3.org/2000/svg",
    },
    h("path", {
      d: "M512 444.16l297.088-297.088c17.088-17.152 46.208-15.872 64.96 2.88 18.752 18.752 20.032 47.872 2.88 64.96L579.904 512l297.024 297.088c17.152 17.088 15.872 46.208-2.88 64.96-18.752 18.752-47.872 20.032-64.96 2.88L512 579.904l-297.088 297.024c-17.088 17.152-46.208 15.872-64.96-2.88-18.752-18.752-20.032-47.872-2.88-64.96L444.096 512 147.072 214.912c-17.152-17.088-15.872-46.208 2.88-64.96 18.752-18.752 47.872-20.032 64.96-2.88L512 444.096z",
    }),
  );

/**
 * 快捷键面板组件
 * 展示播放器支持的快捷键列表及其功能说明
 */
export const HotkeyPanel = defineComponent<HotkeyPanelProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 响应式信号（渲染层唯一数据源）
    // ============================================

    /**
     * 面板显隐信号：true = 显示（nova-player-panel-active 类，基态为 display: none）
     * 初值取 props.visible（与原 onMounted 内按 visible 补显隐的行为一致）
     */
    const activeSignal = signal<boolean>(props.visible === true);

    /**
     * 处理关闭面板操作
     */
    const handleClose = (): void => {
      close();
      props.onClose?.();
    };

    /** 面板展示项：插件分组标题 + 普通快捷键项 */
    interface HotkeyDisplayEntry {
      key: string;
      kind: "group" | "item";
      label?: string;
      item?: HotkeyItem;
    }

    /** 把注册表返回值收敛为面板展示字段 */
    const toItems = (list: readonly HotkeyConfig[]): HotkeyItem[] =>
      list.map((item) => ({
        id: item.id,
        plugin: item.plugin,
        name: item.name,
        nameKey: item.nameKey,
        desc: item.desc,
        descKey: item.descKey,
      }));

    /** 按来源插件插入分组标题 */
    const buildEntries = (list: HotkeyItem[]): HotkeyDisplayEntry[] => {
      const entries: HotkeyDisplayEntry[] = [];
      let lastPlugin: string | undefined;
      list.forEach((item, index) => {
        if (item.plugin !== undefined && item.plugin !== lastPlugin) {
          entries.push({
            key: `group:${item.plugin}:${index}`,
            kind: "group",
            label: item.plugin,
          });
        }
        lastPlugin = item.plugin;
        entries.push({
          key: item.id ?? `item:${index}`,
          kind: "item",
          item,
        });
      });
      return entries;
    };

    const hotkeyEntriesSignal = signal<HotkeyDisplayEntry[]>(
      buildEntries(
        props.hotkeys ??
          (props.registry ? toItems(props.registry.list()) : HOTKEYS),
      ),
    );
    let offRegistry: (() => void) | null = null;

    /** 渲染快捷键列表：For 按注册表变化增量更新 */
    const renderHotkeyEntries = (): ReturnType<typeof h> =>
      h(For, {
        each: (): HotkeyDisplayEntry[] => hotkeyEntriesSignal.value,
        key: (entry: unknown): string =>
          typeof entry === "object" && entry !== null && "key" in entry
            ? String((entry as HotkeyDisplayEntry).key)
            : "entry",
        render: (entry: unknown): VNode => {
          const display = entry as HotkeyDisplayEntry;
          if (display.kind === "group") {
            return h(
              "div",
              { class: "nova-player-hotkey-panel-content-group" },
              `${display.label ?? ""} · ${t("player.ui.hotkey.plugin_group")}`,
            );
          }
          const item = display.item as HotkeyItem;
          return h(
            "div",
            { class: "nova-player-hotkey-panel-content-item" },
            h(
              "span",
              { class: "nova-player-hotkey-panel-content-name" },
              item.nameKey ? t(item.nameKey) : item.name,
            ),
            h(
              "span",
              { class: "nova-player-hotkey-panel-content-desc" },
              item.descKey ? t(item.descKey) : item.desc,
            ),
          );
        },
      });

    // ============================================
    // 显隐控制（对外 API，内部写信号即可）
    // ============================================

    /**
     * 显示面板组件
     * 写信号即可：nova-player-panel-active 类由响应式系统自动同步
     */
    const show = (): void => {
      activeSignal.value = true;
    };

    /**
     * 隐藏面板组件
     */
    const hide = (): void => {
      activeSignal.value = false;
    };

    /**
     * 打开面板（对外 API 语义化别名）
     */
    const open = (): void => {
      show();
    };

    /**
     * 关闭面板（对外 API 语义化别名）
     */
    const close = (): void => {
      hide();
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    /**
     * 组件挂载后：通过事件向外暴露控制方法
     * （初始显隐已由 activeSignal 初值在渲染时体现）
     */
    lifecycle.onMounted = (): void => {
      if (props.registry) {
        offRegistry = props.registry.subscribe(() => {
          hotkeyEntriesSignal.value = buildEntries(
            toItems(props.registry!.list()),
          );
        });
      }
      lifecycle.emit?.("hotkeyPanelMounted", { show, hide, open, close });
    };

    lifecycle.onBeforeDestroy = (): void => {
      offRegistry?.();
      offRegistry = null;
    };

    return h(
      "div",
      {
        // 显隐类名由 activeSignal 响应式驱动（__reactiveAttrs + normalizeClass）
        class: [
          "nova-player-hotkey-panel",
          { "nova-player-panel-active": activeSignal.value },
        ],
      },
      h(
        "div",
        { class: "nova-player-hotkey-panel-title" },
        "快捷键说明",
        h(
          "span",
          { class: "nova-player-hotkey-panel-close", onClick: handleClose },
          h("span", { class: "common-svg-icon" }, CloseIcon()),
        ),
      ),
      h(
        "div",
        { class: "nova-player-hotkey-panel-area" },
        h(
          "div",
          {
            class: "nova-player-hotkey-panel-content",
            style: {
              transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
              transitionDuration: "0ms",
              transform: "translate(0px, 0px) scale(1) translateZ(0px)",
            },
          },
          renderHotkeyEntries(),
        ),
      ),
    );
  },
);
