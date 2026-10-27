/**
 * ============================================
 * 音乐详情面板视图（MusicDetailPlayer 移植）
 * ============================================
 * 结构：Header（标题切换动画）+ MusicDetailInfo（详情卡片）+ MusicVideoCardList（视频区）。
 *
 * 数据加载与面板渲染分离：宿主注入 config.data 时同步渲染；未注入时走模拟 API。
 * 面板根节点为 #musicApp（与原实现一致），由视图在 onMounted 后挂载进宿主容器。
 */

import {
  h,
  defineComponent,
  signal,
  computed,
  untracked,
  onEffect,
  mount,
  destroy,
  type ComponentLifecycle,
} from "@/core";
import type { VNode } from "@/types";
import { CloseIcon, MusicNoteIcon, cx } from "./base";
import { fetchAbTest, fetchMusicDetail } from "./api";
import { musicTheme } from "./theme";
import { MusicDetailInfo } from "./MusicDetailInfo";
import { MusicVideoCardList } from "./MusicVideoCardList";
import {
  PositionId,
  type MusicDetail,
  type MusicPluginData,
  type PcCallback,
} from "./types";

/** 面板头部属性 */
interface MusicHeaderProps {
  /** 音乐详情 */
  detail: () => MusicDetail;
  /** 标题滚出头部后是否展示音乐标题 */
  isShowTitle: () => boolean;
  /** 播放器场景宿主回调 */
  pcCallback?: PcCallback;
  /** 关闭面板回调 */
  onClose?: () => void;
}

/**
 * 面板头部：音符图标 + 标题（out-in 切换动画）+ 关闭按钮
 */
const MusicHeader = defineComponent<MusicHeaderProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 当前展示文本：标题滚出头部可视区后展示音乐标题，否则展示固定文案 */
    const displayTitle = signal("音乐详情");
    /** 退出动画状态 */
    const animExit = signal(false);
    /** 进入动画状态 */
    const animEnter = signal(false);
    /** 过渡激活标记 */
    const animActive = signal(false);

    /** 标题容器元素引用 */
    let titleContainerEl: HTMLElement | null = null;
    /** 标题切换定时器 */
    let switchTimer: ReturnType<typeof setTimeout> | null = null;
    /** 双帧等待句柄 */
    let rafId = 0;

    // 标题切换：isShowTitle / 音乐标题变化 → out-in 动画
    onEffect(lifecycle, (): void => {
      const next = props.isShowTitle()
        ? props.detail().music_title
        : "音乐详情";
      const current = untracked((): string => displayTitle.value);
      if (current === next) {
        return;
      }
      // out-in 动画：旧文本先淡出，250ms 后替换文本并淡入新文本
      if (switchTimer !== null) {
        clearTimeout(switchTimer);
      }
      animExit.value = true;
      animEnter.value = false;
      animActive.value = true;
      switchTimer = setTimeout((): void => {
        displayTitle.value = next;
        animExit.value = false;
        animEnter.value = true;
        animActive.value = false;
        // 双帧等待保证 enter 初始态（opacity 0）先绘制，再过渡到 1
        rafId = requestAnimationFrame((): void => {
          rafId = requestAnimationFrame((): void => {
            animActive.value = true;
          });
        });
        switchTimer = null;
      }, 250);
    });

    // 标题容器动画类名
    onEffect(lifecycle, (): void => {
      if (!titleContainerEl) return;
      titleContainerEl.className = cx(
        "nova-music-title-container",
        animExit.value ? "nova-music-out-in-exit" : undefined,
        animExit.value && animActive.value
          ? "nova-music-out-in-exit-active"
          : undefined,
        animEnter.value ? "nova-music-out-in-enter" : undefined,
        animEnter.value && animActive.value
          ? "nova-music-out-in-enter-active"
          : undefined,
      );
    });

    lifecycle.onBeforeDestroy = (): void => {
      if (switchTimer !== null) {
        clearTimeout(switchTimer);
        switchTimer = null;
      }
      cancelAnimationFrame(rafId);
    };

    /** 关闭面板 */
    const handleClose = (): void => {
      props.onClose?.();
      props.pcCallback?.onClose?.();
    };

    return h(
      "h2",
      { class: "nova-music-header" },
      h(
        "div",
        { class: "nova-music-header-left" },
        h(MusicNoteIcon),
        h(
          "div",
          {
            class: "nova-music-title-container",
            ref: (el: unknown): void => {
              if (el instanceof HTMLElement) titleContainerEl = el;
            },
          },
          h(
            "span",
            { class: "nova-music-title" },
            (): string => displayTitle.value,
          ),
        ),
      ),
      h("div", { class: "nova-music-close", onClick: handleClose }, h(CloseIcon)),
    );
  },
);

/** 音乐详情面板属性 */
export interface MusicViewProps {
  /** 音乐 id */
  musicId: string;
  /** 挂载宿主容器（.nova-player-music-wrap） */
  host: HTMLElement;
  /** 展示位置（播放器全屏内嵌形态为 PlayerFullScreen） */
  positionId?: PositionId;
  /** 页面来源（预留，供上报使用） */
  source?: string;
  /** 入口视频 cid（预留，供上报使用） */
  entryCid?: number;
  /** 入口视频 aid（透传给视频列表请求） */
  entryAid?: number;
  /** 宿主注入的音乐数据快照（缺省时走模拟接口） */
  data?: MusicPluginData;
  /** 播放器场景宿主回调 */
  pcCallback?: PcCallback;
  /** 关闭面板回调 */
  onClose?: () => void;
}

/**
 * 音乐详情面板
 *
 * 数据就绪后把面板根节点挂载进 host；销毁时反向卸载。
 */
export const MusicView = defineComponent<MusicViewProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 音乐详情 */
    const detail = signal<MusicDetail | undefined>(props.data?.detail);
    /** 详情是否加载中 */
    const pending = signal(!props.data?.detail);
    /** 标题滚出头部后是否展示音乐标题 */
    const isShowTitle = signal(false);

    /** 面板根节点 */
    let appRootEl: HTMLElement | null = null;
    /** 面板 VNode（用于卸载） */
    let appVNode: VNode | null = null;
    /** 详情请求代际（防止切换音乐后旧请求覆盖） */
    let requestId = 0;

    /** 是否播放器全屏内嵌形态 */
    const isInPlayer = (): boolean =>
      (props.positionId ?? PositionId.PlayerHalfScreen) ===
      PositionId.PlayerFullScreen;
    /** 深色模式：播放器内强制深色，其余跟随宿主主题 */
    const isDark = computed(
      (): boolean => isInPlayer() || musicTheme.value === "dark",
    );

    /** 收藏按钮更新详情（无 mid 场景下保持原值） */
    const handleSetDetail = (
      updater: (prev: MusicDetail) => MusicDetail,
    ): void => {
      const prev = detail.value;
      if (prev) {
        detail.value = updater(prev);
      }
    };

    /** 读取已就绪的音乐详情（面板在数据就绪后才挂载，这里做空值保护） */
    const getDetail = (): MusicDetail => {
      const value = detail.value;
      if (!value) {
        throw new Error("音乐详情未就绪");
      }
      return value;
    };

    /** 面板根类名（深色 / 播放器内嵌形态） */
    const syncRootAppearance = (): void => {
      if (!appRootEl) return;
      appRootEl.className = cx(
        "nova-music-app",
        isDark.value ? "nova-music-dark" : "nova-music-normal",
        isInPlayer() ? "nova-music-in-player" : undefined,
      );
      appRootEl.style.padding = isInPlayer() ? "36px 0 0 0" : "36px 6px 8px";
    };

    /**
     * 构造并挂载面板 DOM
     */
    const mountApp = (): void => {
      const videoList = props.data?.videoList;
      const recommendList = props.data?.recommendList;
      const mainWarp = h(
        "div",
        {
          class: "nova-music-main-warp",
          style: { borderRadius: isInPlayer() ? "0" : "6px" },
          onScroll: (event: Event): void => event.stopPropagation(),
          onWheel: (event: Event): void => event.stopPropagation(),
        },
        h(
          "div",
          { class: "nova-music-main" },
          h(MusicHeader, {
            detail: getDetail,
            isShowTitle: (): boolean => isShowTitle.value,
            pcCallback: props.pcCallback,
            onClose: props.onClose,
          }),
          h(MusicDetailInfo, {
            detail: getDetail,
            setIsShowTitle: (updater: (prev: boolean) => boolean): void => {
              isShowTitle.value = updater(isShowTitle.value);
            },
            setDetail: handleSetDetail,
            isDark: (): boolean => isDark.value,
            isInPlayer: isInPlayer(),
            isUmd: true,
            musicId: props.musicId,
            pcCallback: props.pcCallback,
          }),
          h(MusicVideoCardList, {
            isDark: (): boolean => isDark.value,
            pcCallback: props.pcCallback,
            musicId: props.musicId,
            entryAid: props.entryAid,
            isUmd: true,
            videoList,
            recommendList,
          }),
        ),
      );
      const vnode = h(
        "div",
        {
          id: "musicApp",
          class: "nova-music-app",
          style: {
            padding: isInPlayer() ? "36px 0 0 0" : "36px 6px 8px",
          },
          onClick: (event: Event): void => event.stopPropagation(),
          ref: (el: unknown): void => {
            if (el instanceof HTMLElement) appRootEl = el;
          },
        },
        // 展开数组传子节点：编译插件不会把变量 VNode 误判为响应式文本
        ...[mainWarp],
      );
      mount(vnode, props.host);
      appVNode = vnode;
      syncRootAppearance();
    };

    /** 加载详情（未注入数据时） */
    const loadDetail = async (): Promise<void> => {
      const currentRequest = requestId;
      pending.value = true;
      try {
        await fetchAbTest({
          music_id: props.musicId,
          relation_from: "bgm_page",
        });
        const { data } = await fetchMusicDetail({
          music_id: props.musicId,
          relation_from: "bgm_page",
        });
        if (currentRequest !== requestId) return;
        detail.value = data;
        mountApp();
      } finally {
        if (currentRequest === requestId) {
          pending.value = false;
        }
      }
    };

    lifecycle.onMounted = (): void => {
      const initial = props.data?.detail;
      if (initial) {
        detail.value = initial;
        mountApp();
        pending.value = false;
        return;
      }
      void loadDetail();
    };

    lifecycle.onBeforeDestroy = (): void => {
      requestId += 1;
      if (appVNode) {
        destroy(appVNode);
        appVNode = null;
      }
      appRootEl = null;
    };

    // 面板尚未就绪时不产生任何 DOM（与原实现 Show 行为一致，宿主容器保持 :empty）
    return h("fragment", {});
  },
);
