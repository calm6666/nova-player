/**
 * ============================================
 * 清晰度选择面板组件 (QualityMenu)
 * ============================================
 */

import {
  h,
  defineComponent,
  useState,
  useReactiveState,
  useContext,
  t,
  signal,
  computed,
  For,
} from "@/core";
import type { ReadonlySignal } from "@/core";
import type { VNode } from "@/types";
import { useComponentUnmount } from "@/nova/core/componentUnmount";
import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import type { AnimationFrameID } from "@/utils/rafTimeout";
import { PlayerStateKeyEnum, StateContext } from "@/store/runtimeState";

/** 自动档 id（与 types/streamPlugin 的 AUTO_QUALITY_ID 取值一致；此处本地定义，避免跨模块耦合） */
const AUTO_QUALITY_ID = "auto";
/** 自动档文案 */
const AUTO_LABEL = "自动";
/** 清晰度切换中的占位文案 */
const SWITCHING_LABEL = "切换中";
/** 会员类徽标默认文案 */
const VIP_LABEL = "大会员";

/**
 * 清晰度面板消费的最小档位模型
 *
 * 与运行时 `types/streamPlugin.ts` 的 `QualityLevel` 结构兼容（它多出的字段可自由传入），
 * 但面板只依赖下面这些字段，因此共享类型尚未补 `codec` 时本文件也能独立编译。
 */
export interface QualityMenuItem {
  /** 档位标识（自动档为 'auto'） */
  id: string;
  /** 档位展示名 */
  label: string;
  /** 视频宽度 */
  width?: number;
  /** 视频高度（自动档为当前 ABR 实际选中档位的高度） */
  height?: number;
  /** 码率（比特/秒） */
  bitrate?: number;
  /** 是否为自动档（ABR） */
  isAuto?: boolean;
  /**
   * 视频编码格式短名（AVC / HEVC / AV1 / VP9 / VP8 / MPEG4）
   * 为空时不渲染编码徽标（不造假）
   */
  codec?: string;
  /** 编码原始串（如 avc1.640028），渲染为徽标 title */
  codecString?: string;
  /** 是否会员类档位；仅在数据明确带标记时渲染会员徽标 */
  vip?: boolean;
  /** 会员徽标文案，缺省「大会员」 */
  badge?: string;
}

/**
 * 运行时类型谓词：For 控制流的回调入参为 unknown（For 的 props 为
 * Record<string, unknown>，类型信息在回调边界丢失），
 * 用谓词收窄替代 as 断言
 */
const isQualityMenuItem = (item: unknown): item is QualityMenuItem =>
  typeof item === "object" &&
  item !== null &&
  "id" in item &&
  typeof item.id === "string" &&
  "label" in item &&
  typeof item.label === "string";

/**
 * 清晰度选项接口
 * @deprecated 运行时模型已统一为 QualityLevel / QualityMenuItem；此处仅保留导出以兼容旧引用
 */
export interface QualityItem {
  /** 清晰度显示标签 */
  label: string;
  /** 清晰度值 */
  value: string;
  /** 角标文本（如"大会员"） */
  badge?: string;
}

/**
 * QualityMenu 组件 Props 接口
 */
export interface QualityMenuProps {
  /** 初始清晰度列表（后续变化由组件内部订阅运行时状态获得） */
  qualities?: QualityMenuItem[];
  /** 当前清晰度 id（缺省时读运行时 player.qualityCurrent） */
  currentQuality?: string;
  /**
   * 是否具备 ABR 自动档能力
   * 缺省（父层未传）时按数据与运行时能力推断：列表自带自动项，或 player.qualityMode === 'adaptive'
   */
  autoEnabled?: boolean;
  /**
   * 配置显隐（ui.controls.quality）
   * 父层可传 Signal 形态（props 惰性代理读取穿透建立依赖），
   * 缺省可见；display 由本组件根节点响应式 style 单一来源管理
   */
  visible?: boolean | ReadonlySignal<boolean>;
}

export type QualityMenuEvents = {
  qualityChange: string;
  qualityMenuMounted: undefined;
};

/**
 * QualityMenu 组件 - 使用 defineComponent 创建独立组件
 *
 * 响应式迁移：
 *   - 清晰度列表渲染从 createItem + replaceChildren 改为 For 组件（key-based 精准更新）
 *   - 选中态 / 自动档激活态从手动 forEach + classList.toggle 改为响应式 class
 *   - 顶部清晰度名 / 自动徽标显隐从 textContent + style.display 改为 _reactiveText + 响应式 style
 *   - 运行时状态订阅从 useState 命令式包装改为 useReactiveState + computed
 *   - 面板 hover 显隐由 shownSignal 响应式驱动根节点 state-show 类，
 *     hover 定时器（rafTimeout）仅负责延迟时序并写信号
 *   - 配置显隐由 visible prop 传入（支持 Signal 形态，props 惰性代理读取穿透建立依赖），
 *     display 为本组件根节点响应式 style 单一来源，
 *     消除旧的 RightControls querySelector 直写 display（两边写 display 打架）
 *   - 按钮尺寸收起（列表 ≤ 1 项时不占位）由 collapsedSignal 响应式驱动
 *     根节点 visibility/width/marginRight（空串经 setProperty 清除内联）
 *   - 首次淡入从一次性 JS 动画（opacity/transition 手写）改为 CSS animation：
 *     state-fade-in 类随非收起态常驻，类移除后重新添加即自动重播（见 qualitymenu.scss）
 */
export const QualityMenu = defineComponent<QualityMenuProps, QualityMenuEvents>(
  (props, lifecycle) => {
    const state = useContext(StateContext);

    /** 展开 / 收起定时器 */
    let showTimer: AnimationFrameID | null = null;

    /** 收起定时器 */
    let hideTimer: AnimationFrameID | null = null;

    /**
     * 响应式信号：面板展开态
     * 驱动根节点 state-show 类（编译器包装为 __reactiveAttrs，
     * 变化时经 normalizeClass 精准更新类名），
     * 替代旧的 btnRef.classList.toggle 命令式写法
     */
    const shownSignal = signal<boolean>(false);

    /**
     * 落地面板展开态：写信号即可，DOM 类名由响应式系统自动同步
     * @param show - 是否展开
     */
    const setShown = (show: boolean): void => {
      shownSignal.value = show;
    };

    /** 取消两个方向的排队任务 */
    const clearTimers = (): void => {
      cancelRaf(showTimer!);
      cancelRaf(hideTimer!);
      showTimer = null;
      hideTimer = null;
    };

    // ============================================
    // 内部状态（响应式信号驱动视图）
    // ============================================

    /**
     * 当前选中档位 id 信号
     * 注意：不从 'auto' 起步 —— 自动项只有运行时明确处于自动档时才激活（默认不激活）
     * signal 变化时自动驱动 li 响应式 class + 顶部清晰度名 _reactiveText
     */
    const selectedIdSignal = signal<string>(
      typeof props.currentQuality === "string" ? props.currentQuality : "",
    );

    /**
     * 用户是否手动点过具体档位信号
     * 自适应（HLS/DASH）下运行时写进 player.qualityCurrent 的是 ABR 实际选中的具体档位 id，
     * 仅凭 selectedId 无法区分「自动」与「手动指定」，故用本标记区分：
     * 未手动选过 → 仍算自动档（顶部显示具体档位名 +「自动」徽标）；手动选过 → 按具体档位显示（无徽标）
     */
    const manualPickSignal = signal<boolean>(false);

    /** 具体档位（不含自动项），保持数据原始顺序 */
    const concreteListSignal = signal<QualityMenuItem[]>([]);

    /** 自动项 id 信号；'' 表示当前不具备自动能力，列表里不出现自动项 */
    const autoIdSignal = signal<string>("");

    /** 面板全部条目信号（具体档位 + 末尾自动项），驱动 For 组件 key-based 精准更新 */
    const menuItemsSignal = signal<QualityMenuItem[]>([]);

    /** 是否正在切换清晰度信号（切换期间顶部显示「切换中」） */
    const switchingSignal = signal<boolean>(false);

    /**
     * 响应式信号：按钮尺寸收起态（列表 ≤ 1 项时整体不占位）
     * 驱动根节点 visibility/width/marginRight（__reactiveAttrs 响应式 style），
     * 替代旧的 btnRef.style 命令式写法；收起时 state-fade-in 类一并移除，
     * 恢复可见时类重新添加自动重播 CSS 淡入
     */
    const collapsedSignal = signal<boolean>(false);

    /**
     * 配置显隐派生信号：父层经 visible prop 传入（支持 Signal 形态，
     * props 惰性代理读取穿透 Signal.value 自动建立依赖），
     * display 由本组件根节点响应式 style 单一来源管理
     */
    const configVisibleSignal = computed(() => props.visible !== false);

    // ============================================
    // 运行时状态信号（驱动 isAutoActive / resolveAutoConcreteLabel 响应式）
    // ============================================

    /** 运行时清晰度能力信号（none | static | adaptive），读取 .value 自动建立依赖 */
    const qualityModeSignal: ReadonlySignal<unknown> = state
      ? useReactiveState(state, PlayerStateKeyEnum.QUALITY_MODE, lifecycle)
      : signal<unknown>(undefined);

    /** 实际画质高度信号（loadedmetadata 写入），读取 .value 自动建立依赖 */
    const videoHeightSignal: ReadonlySignal<unknown> = state
      ? useReactiveState(state, PlayerStateKeyEnum.VIDEO_HEIGHT, lifecycle)
      : signal<unknown>(undefined);

    // ============================================
    // 渲染辅助：数据判定
    // ============================================

    /**
     * 是否为自动档条目
     * @param item - 清晰度档位
     */
    const isAutoEntry = (item: QualityMenuItem): boolean =>
      item.isAuto === true || item.id === AUTO_QUALITY_ID;

    /**
     * 档位展示名：label 优先，缺省用高度兜底，再缺省用 id
     * @param item - 清晰度档位
     */
    const labelOf = (item: QualityMenuItem): string =>
      item.label || ((item.height ?? 0) > 0 ? `${item.height}P` : item.id);

    /**
     * 取画质最高的一项（高度优先，同高度比码率）
     * @param list - 待比较的档位列表
     */
    const pickHighest = (
      list: QualityMenuItem[],
    ): QualityMenuItem | undefined => {
      let best: QualityMenuItem | undefined;
      for (const item of list) {
        if (
          !best ||
          (item.height ?? 0) > (best.height ?? 0) ||
          ((item.height ?? 0) === (best.height ?? 0) &&
            (item.bitrate ?? 0) > (best.bitrate ?? 0))
        ) {
          best = item;
        }
      }
      return best;
    };

    /**
     * 自动档能力判据（任一成立即在列表末尾渲染自动项）
     * 1. props.autoEnabled 显式打开（父层已确认具备 ABR）
     * 2. 数据里自带自动档条目（item.isAuto 或 id === 'auto'）
     * 3. 运行时清晰度能力为 adaptive（HLS / DASH）
     * @param list - 运行时清晰度列表
     */
    const detectAutoCapable = (list: QualityMenuItem[]): boolean =>
      props.autoEnabled === true ||
      list.some(isAutoEntry) ||
      state?.get(PlayerStateKeyEnum.QUALITY_MODE) === "adaptive";

    /**
     * 自动档激活时解析「当前具体清晰度名」
     * 1. 数据自带的自动档条目自身携带的档位信息（新契约：自动档带当前 ABR 实际选中的宽高）
     * 2. 运行时 video.height（loadedmetadata 写入）与具体档位高度精确 / 就近匹配
     * 3. 兜底：具体档位里画质最高的一项
     * @returns 具体清晰度名；完全无法判定时返回 ''
     *
     * 注：读取 menuItemsSignal / autoIdSignal / videoHeightSignal / concreteListSignal，
     * 在 computed 上下文中自动追踪信号变化（autoConcreteLabelSignal 派生）
     */
    const resolveAutoConcreteLabel = (): string => {
      const autoId = autoIdSignal.value;
      const autoEntry = menuItemsSignal.value.find(
        (item) => item.id === autoId,
      );
      if (autoEntry) {
        const own =
          autoEntry.label && autoEntry.label !== AUTO_LABEL
            ? autoEntry.label
            : "";
        if (own) return own;
        if ((autoEntry.height ?? 0) > 0) return `${autoEntry.height}P`;
      }

      const rawVideoHeight = videoHeightSignal.value;
      const videoHeight = typeof rawVideoHeight === "number" ? rawVideoHeight : 0;
      if (videoHeight > 0) {
        const concrete = concreteListSignal.value;
        const sized = concrete.filter((item) => (item.height ?? 0) > 0);
        const exact = sized.find((item) => item.height === videoHeight);
        if (exact) return labelOf(exact);
        const notAbove = sized.filter(
          (item) => (item.height ?? 0) <= videoHeight,
        );
        const nearest = pickHighest(notAbove);
        if (nearest) return labelOf(nearest);
      }

      const highest = pickHighest(concreteListSignal.value);
      return highest ? labelOf(highest) : "";
    };

    /**
     * 自动项是否激活
     * 判据：具备自动能力（autoId !== ''）且
     *   1) 运行时明确指向自动档（selectedId === autoId），或
     *   2) 处于自适应模式且用户没有手动选过具体档位
     *      （自适应下 player.qualityCurrent 存的是 ABR 选中的具体档位 id，
     *       此时当前档位仍应显示为「自动」+ 具体档位名）
     *
     * 注：读取 autoIdSignal / selectedIdSignal / manualPickSignal / qualityModeSignal，
     * 在 computed 上下文中自动追踪信号变化（autoActiveSignal 派生）
     */
    const isAutoActive = (): boolean => {
      const autoId = autoIdSignal.value;
      if (autoId === "") return false;
      const selectedId = selectedIdSignal.value;
      if (selectedId === autoId) return true;
      return !manualPickSignal.value && qualityModeSignal.value === "adaptive";
    };

    /**
     * 当前激活条目
     * 精确命中优先；选中值为空或 'auto' 但列表没有自动项时（原生 MP4 多变体：
     * VideoPlayer 的 'auto' 即 sources[0]，而档位 id 就是 sources 下标），
     * 退到数据里的第一档，保证顶部文案与高亮始终有落点
     */
    const resolveActiveItem = (): QualityMenuItem | undefined => {
      const selectedId = selectedIdSignal.value;
      const exact = menuItemsSignal.value.find(
        (item) => item.id === selectedId,
      );
      if (exact) return exact;
      if (selectedId === "" || selectedId === AUTO_QUALITY_ID)
        return concreteListSignal.value[0];
      return undefined;
    };

    // ============================================
    // 派生信号（computed）：驱动 VNode 响应式 class / _reactiveText / style
    // ============================================

    /** 自动档是否激活（派生）—— 驱动 li active class + 顶部文案 + 自动徽标显隐 */
    const autoActiveSignal = computed(() => isAutoActive());

    /** 自动档当前具体清晰度名（派生）—— 驱动自动项文案 + 顶部文案 */
    const autoConcreteLabelSignal = computed(() => resolveAutoConcreteLabel());

    /** 非自动档激活时当前激活条目 id（派生）—— 驱动 li active class */
    const activeItemIdSignal = computed(() => {
      if (autoActiveSignal.value) return "";
      const active = resolveActiveItem();
      return active?.id ?? "";
    });

    /** 顶部清晰度名（派生）—— 驱动 _reactiveText */
    const resultNameSignal = computed(() => {
      if (switchingSignal.value) return SWITCHING_LABEL;
      if (autoActiveSignal.value)
        return autoConcreteLabelSignal.value || AUTO_LABEL;
      const active = resolveActiveItem();
      return active ? labelOf(active) : AUTO_LABEL;
    });

    /** 自动徽标是否可见（派生）—— 驱动响应式 style.display */
    const autoBadgeVisibleSignal = computed(
      () => autoActiveSignal.value && !switchingSignal.value,
    );

    // ============================================
    // 渲染辅助：DOM 刷新（保留命令式：仅按钮显隐 + 首次淡入）
    // ============================================

    /**
     * 渲染单个清晰度菜单项（For 组件的 render 回调）
     * 每个 key 只调用一次，选中态由响应式 class（autoActiveSignal / activeItemIdSignal 自动驱动）自动同步
     * 自动项文案由 _reactiveText（autoConcreteLabelSignal 自动驱动）自动同步
     * 替代旧的 createItem + ref 收集 + updateActive forEach + classList.toggle 命令式操作
     * @param item - 清晰度档位
     * @returns 菜单项 VNode
     */
    const renderItem = (item: QualityMenuItem): VNode => {
      const isAuto = isAutoEntry(item);
      return h(
        "li",
        {
          // 响应式 class：autoActiveSignal.value / activeItemIdSignal.value / autoIdSignal.value 自动驱动
          // 替代旧的 entry.li.classList.toggle('nova-player-state-active', isActive)
          class: [
            "nova-player-ctrl-quality-menu-item",
            {
              "nova-player-state-active": autoActiveSignal.value
                ? item.id === autoIdSignal.value
                : item.id === activeItemIdSignal.value,
            },
          ],
          "data-value": item.id,
          onClick: () => {
            // 乐观切换选中态，切换结果由 player.qualityCurrent 订阅最终校正
            selectedIdSignal.value = item.id;
            // 点「自动」→ 回到自动态；点具体档位 → 记为手动指定（自适应下不再显示自动徽标）
            manualPickSignal.value = item.id !== autoIdSignal.value;
            // 具体档位发档位 id，自动项发 'auto'（VideoPlayer.setQuality 自身会对同档位去重）
            lifecycle.emit?.("qualityChange", item.id);
          },
        },
        h(
          "span",
          { class: "nova-player-ctrl-quality-text" },
          // 自动项文案随 autoConcreteLabelSignal 变化（编译器自动包装为 _reactiveText）
          // 非自动项文案为静态 labelOf(item)，整个三元表达式为动态，编译器统一包装
          isAuto
            ? autoConcreteLabelSignal.value
              ? `${AUTO_LABEL}(${autoConcreteLabelSignal.value})`
              : AUTO_LABEL
            : labelOf(item),
        ),
        // 编码格式徽标：仅在数据带 codec 时渲染（无数据不渲染，不造假）
        // 徽标 active class 同 li，由响应式 class 自动同步
        ...(item.codec
          ? [
              h(
                "span",
                {
                  class: [
                    "nova-player-ctrl-quality-badge nova-player-ctrl-quality-badge-codec",
                    {
                      "nova-player-state-active": autoActiveSignal.value
                        ? item.id === autoIdSignal.value
                        : item.id === activeItemIdSignal.value,
                    },
                  ],
                  ...(item.codecString ? { title: item.codecString } : {}),
                },
                item.codec,
              ),
            ]
          : []),
        // 会员类徽标：仅在数据带标记时渲染（当前运行时数据无该标记 → 不会出现）
        ...(item.vip === true
          ? [
              h(
                "span",
                {
                  class:
                    "nova-player-ctrl-quality-badge nova-player-ctrl-quality-badge-vip",
                },
                item.badge || VIP_LABEL,
              ),
            ]
          : []),
      );
    };

    /**
     * 按列表重建面板数据，并同步按钮显隐 / 首次淡入
     * 列表 DOM 由 For 组件 key-based 精准更新（menuItemsSignal 驱动）
     * 选中态 / 顶部文案 / 徽标显隐由响应式 class / _reactiveText / style 自动同步
     * @param list - 运行时清晰度列表
     */
    const renderQualities = (list?: QualityMenuItem[]): void => {
      const source = list ?? [];

      // 拆分具体档位 / 数据自带的自动项（自动项统一排到列表末尾，与参考 DOM 一致）
      const dataAuto = source.find(isAutoEntry);
      const concrete = source.filter((item) => item !== dataAuto);

      // 需求：列表从高清到低清（自动项由下方构造逻辑固定排在最后）
      const sortedConcrete = [...concrete].sort(
        (a, b) =>
          (b.height ?? 0) - (a.height ?? 0) ||
          (b.bitrate ?? 0) - (a.bitrate ?? 0),
      );

      const autoCapable = detectAutoCapable(source);
      const nextAutoId = dataAuto
        ? dataAuto.id
        : autoCapable
          ? AUTO_QUALITY_ID
          : "";
      const nextMenuItems = dataAuto
        ? [...sortedConcrete, dataAuto]
        : autoCapable
          ? [
              ...sortedConcrete,
              { id: AUTO_QUALITY_ID, label: AUTO_LABEL, isAuto: true },
            ]
          : [...sortedConcrete];

      // 默认选中：仅在完全不知道当前档位（selectedId 为空）时退到数据里的第一档，
      // 自动项因此保持不激活。
      // 注意：这里不能覆盖 selectedId === 'auto' —— 首次渲染时 player.qualityMode 可能还是上一轮的
      // 'none'（写入顺序是 AVAILABLE_QUALITIES → QUALITY_MODE），此刻自动项尚未生成，
      // 若把 'auto' 改写成具体档位，随后 QUALITY_MODE 变成 'adaptive' 时自动项就再也激活不了。
      if (!selectedIdSignal.value) {
        selectedIdSignal.value = sortedConcrete[0]?.id ?? "";
      }

      // 新列表代表换了视频/流，手动指定档位的标记一并复位，回到自动态
      manualPickSignal.value = false;
      concreteListSignal.value = sortedConcrete;
      autoIdSignal.value = nextAutoId;
      menuItemsSignal.value = nextMenuItems;
      // 列表 DOM 由 For 精准更新，选中态 / 文案 / 徽标由响应式信号自动同步，无需手动刷新

      // 按钮尺寸收起：只有 1 项时整体不占位（写信号即可，
      // visibility/width/marginRight 由根节点响应式 style 自动同步，
      // 空串经 setProperty 清除内联；从收起恢复时 state-fade-in 类重新添加自动重播淡入）
      collapsedSignal.value = nextMenuItems.length <= 1;
    };

    // ============================================
    // 状态监听（订阅运行时清晰度数据与切换生命周期）
    // ============================================

    // 列表变化 → renderQualities 重建 menuItemsSignal（For 精准更新 DOM）
    // 选中态 / 文案 / 徽标由响应式信号自动同步，无需手动 updateActive/applyResultName
    if (state) {
      /** 列表变化 → 命令式重建（新列表代表换了视频/流，手动指定档位的标记一并复位，回到自动态） */
      useState(
        state,
        PlayerStateKeyEnum.AVAILABLE_QUALITIES,
        (list) => {
          renderQualities(list);
        },
        lifecycle,
      );

      /** 清晰度能力变化（none | static | adaptive）→ 自动项是否出现随之变化 */
      useState(
        state,
        PlayerStateKeyEnum.QUALITY_MODE,
        () => {
          // 状态里还没有列表时保持现状，避免把 props.qualities 的初始数据清空
          const list = state.get(PlayerStateKeyEnum.AVAILABLE_QUALITIES);
          renderQualities(list ?? concreteListSignal.value);
        },
        lifecycle,
      );

      /** 当前生效档位变化 → 写入 selectedIdSignal（响应式 class / 顶部文案自动同步） */
      useState(
        state,
        PlayerStateKeyEnum.QUALITY_CURRENT,
        (id) => {
          if (typeof id === "string" && id) {
            selectedIdSignal.value = id;
          }
        },
        lifecycle,
      );

      /** 切换生命周期：切换中把顶部文案改为「切换中」→ 写入 switchingSignal（resultNameSignal computed 自动响应） */
      useState(
        state,
        PlayerStateKeyEnum.QUALITY_SWITCH_STATE,
        (phase) => {
          switchingSignal.value = phase === "switching";
        },
        lifecycle,
      );

      /** 实际画质高度（loadedmetadata 写入）→ autoConcreteLabelSignal 是 computed 自动响应，无需手动操作 */
      useState(
        state,
        PlayerStateKeyEnum.VIDEO_HEIGHT,
        () => {
          // autoConcreteLabelSignal 是 computed，自动追踪 videoHeightSignal 变化
          // 无需手动 updateActive/applyResultName
        },
        lifecycle,
      );
    }

    // ============================================
    // 事件处理函数
    // ============================================

    /**
     * 鼠标进入清晰度按钮：延迟展开面板（面板显隐由本组件自己负责）
     */
    const handleMouseEnter = (): void => {
      cancelRaf(hideTimer!);
      hideTimer = null;
      if (showTimer !== null) return;
      showTimer = rafTimeout(() => {
        showTimer = null;
        setShown(true);
      }, 120);
    };

    /**
     * 鼠标离开清晰度按钮：延迟收起面板
     */
    const handleMouseLeave = (): void => {
      cancelRaf(showTimer!);
      showTimer = null;
      if (hideTimer !== null) return;
      hideTimer = rafTimeout(() => {
        hideTimer = null;
        setShown(false);
      }, 220);
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    /**
     * 组件挂载后：先取一次运行时当前档位与列表渲染（原生 MP4 同步就绪），再通知外部已就绪
     */
    lifecycle.onMounted = (): void => {
      const runtimeId = state?.get(PlayerStateKeyEnum.QUALITY_CURRENT);
      const initialId =
        typeof props.currentQuality === "string" && props.currentQuality
          ? props.currentQuality
          : typeof runtimeId === "string"
            ? runtimeId
            : "";
      if (initialId) selectedIdSignal.value = initialId;

      const initial =
        state?.get(PlayerStateKeyEnum.AVAILABLE_QUALITIES) ??
        props.qualities ??
        [];
      renderQualities(initial);

      lifecycle.emit?.("qualityMenuMounted");
    };

    useComponentUnmount(lifecycle, clearTimers);

    // ============================================
    // 主渲染函数
    // ============================================

    return h(
      "div",
      {
        // 展开态类名由 shownSignal 响应式驱动（__reactiveAttrs + normalizeClass）；
        // 非收起态常驻 state-fade-in：类移除后重新添加时 CSS 淡入自动重播（见 qualitymenu.scss）
        class: [
          "nova-player-ctrl-btn",
          "nova-player-ctrl-quality",
          { "state-show": shownSignal.value },
          { "state-fade-in": !collapsedSignal.value },
        ],
        role: "button",
        "aria-label": t("player.ui.controls.quality"),
        tabindex: 0,
        // 配置显隐（display 单一来源：父层 ui.controls.quality 经 visible prop 传入）+
        // 档位收起态（visibility/width/marginRight 收 0 不占位；空串经 setProperty 清除内联）
        style: {
          display: configVisibleSignal.value ? "" : "none",
          visibility: collapsedSignal.value ? "hidden" : "",
          width: collapsedSignal.value ? "0" : "",
          marginRight: collapsedSignal.value ? "0" : "",
        },
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
      },
      // 当前清晰度显示（result-wrap > result-name + 自动徽标）
      // resultNameSignal 是 computed，自动追踪 switchingSignal/autoActiveSignal/autoConcreteLabelSignal
      // _reactiveText 让 result-name 文本随 resultNameSignal 变化自动更新
      h(
        "div",
        { class: "nova-player-ctrl-quality-result" },
        h(
          "div",
          { class: "nova-player-ctrl-quality-result-wrap" },
          h(
            "div",
            { class: "nova-player-ctrl-quality-result-name" },
            // 编译器自动检测动态表达式 resultNameSignal.value 并包装为 _reactiveText
            resultNameSignal.value,
          ),
          // autoBadgeVisibleSignal 是 computed，自动追踪 autoActiveSignal/switchingSignal
          // 响应式 style.display 让自动徽标随 autoBadgeVisibleSignal 变化自动显隐
          h(
            "span",
            {
              class: "nova-player-ctrl-quality-result-auto-badge",
              style: { display: autoBadgeVisibleSignal.value ? "" : "none" },
            },
            AUTO_LABEL,
          ),
        ),
      ),
      // 清晰度下拉菜单（For 组件 key-based 精准更新，menuItemsSignal 变化时自动同步）
      h(
        "div",
        { class: "nova-player-ctrl-quality-menu-wrap" },
        h(
          "ul",
          { class: "nova-player-ctrl-quality-menu" },
          h(For, {
            each: menuItemsSignal,
            // For 回调入参为 unknown：类型谓词收窄（替代 as 断言）
            key: (item: unknown): string =>
              isQualityMenuItem(item) ? item.id : "",
            render: (item: unknown): VNode =>
              isQualityMenuItem(item) ? renderItem(item) : h("li", {}),
          }),
        ),
      ),
      // 气泡（保留节点，默认 display:none，与参考 DOM 一致）
      h("div", {
        class: "nova-player-ctrl-quality-bubble",
        style: { display: "none" },
      }),
    );
  },
);
