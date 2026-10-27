/**
 * ============================================
 * 音乐详情卡片（PcDetailInfo 移植）
 * ============================================
 * 封面 + 标题（歌手信息弹窗）+ 播放数据 + 操作按钮（看MV / 收藏 / 分享）。
 * 溢出检测与 IntersectionObserver 内联在组件中。
 */

import {
  h,
  defineComponent,
  signal,
  Show,
  For,
  onEffect,
  type ComponentLifecycle,
} from "@/core";
import type { VNode } from "@/types";
import {
  ArrowRightIcon,
  HeartIcon,
  IdentifyBadge,
  LazyImage,
  ModalCloseIcon,
  Popover,
  ShareIcon,
  Tooltip,
  UpFace,
  WatchMvIcon,
  WechatIcon,
  WeiboIcon,
  DynmicShareIcon,
  QqIcon,
  QzoneIcon,
  cx,
  COPY_LINK_ICON,
  UP_MORE_DARK,
  UP_MORE_LIGHT,
} from "./base";
import { formatCount, toast, copyText } from "./format";
import { musicTheme } from "./theme";
import { updateWish, reportShareLog } from "./api";
import {
  IdentifyType,
  PositionId,
  RankListType,
  SourceId,
  type MusicDetail,
  type PcCallback,
  type RankJumpParams,
  type ShareChannel,
  type ShareContent,
  type ShareChannelId,
  type Singer,
} from "./types";

/**
 * 读取 URL 查询参数
 *
 * @param name - 参数名
 * @returns 参数值；不存在返回空字符串
 */
export function getQueryParam(name: string): string {
  if (typeof window === "undefined") {
    return "";
  }
  return new URLSearchParams(window.location.search).get(name) || "";
}

/**
 * 构造视频跳转链接（bvid 为空时返回占位符）
 *
 * @param bvid - 视频 bvid
 * @param part - 分 P 序号
 * @returns 视频地址
 */
export function videoUrl(bvid: string, part: number): string {
  return bvid
    ? `https://www.bilibili.com/video/${bvid}/${part ? `?p=${part}` : ""}`
    : "#";
}

/**
 * 新窗口打开 MV 视频
 *
 * @param bvid - 视频 bvid
 * @param part - 分 P 序号
 */
export function openMvVideo(bvid: string, part: number): void {
  if (!bvid) {
    return;
  }
  window.open(
    `https://www.bilibili.com/video/${bvid}/${part ? `?p=${part}` : ""}`,
  );
}

/**
 * 构造用户空间链接；onlyReturn 为真时只返回地址，否则直接新窗口打开
 *
 * @param mid - 用户 id
 * @param onlyReturn - 是否仅返回地址
 * @returns 用户空间地址
 */
export function buildSpaceHref(
  mid: number | string,
  onlyReturn?: boolean,
): string {
  const url = `https://space.bilibili.com/${mid}`;
  if (onlyReturn) {
    return url;
  }
  window.open(url);
  return url;
}

/**
 * 新窗口打开榜单页
 *
 * @param params - 榜单跳转参数
 */
export function openRankPage(params: RankJumpParams): void {
  let url = "https://music.bilibili.com/pc/rank";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.append(key, `${value}`);
  }
  url += search.toString() ? `?${search.toString()}` : "";
  window.open(url);
}

/**
 * 新歌热榜入口链接
 *
 * @returns 音乐中心地址
 */
export function musicCenterUrl(): string {
  return "https://music.bilibili.com/pc/music-center";
}

/**
 * 构造分享落地页链接
 *
 * @param musicId - 音乐 id
 * @param source - 页面来源
 * @returns 分享落地页地址
 */
export function musicDetailLink(
  musicId: string,
  source: SourceId = SourceId.PCShare,
): string {
  return `https://music.bilibili.com/pc/music-detail?music_id=${musicId}&position_id=${PositionId.AllScreen}&source=${source}`;
}

/** MV 封面缺省图（分享卡片用） */
const SHARE_FALLBACK_PIC =
  "https://i0.hdslb.com/bfs/activity-plat/static/20220727/9bf4d09cb86df3e0272bde9d69145883/6cGIL8RzOK.png";

/**
 * 构造分享内容（标题 / 描述 / 封面 / 链接）
 *
 * @param detail - 音乐详情
 * @param musicId - 音乐 id
 * @param source - 页面来源
 * @returns 分享内容
 */
export function buildShareContent(
  detail: MusicDetail,
  musicId: string,
  source?: SourceId,
): ShareContent {
  const title = `${detail.music_title || ""}-${detail.origin_artist_list || ""}`;
  const listenPart = detail.listen_pv
    ? `播放${formatCount(Number(detail.listen_pv), 1)}次,`
    : "";
  const rankPart = detail.music_rank ? `位列${detail.music_rank}。` : "";
  const desc = `${listenPart}${rankPart}来b站看视频发现好音乐!`;
  const pics = (detail.mv_cover || SHARE_FALLBACK_PIC).replace(
    /^https?:/,
    "https:",
  );
  const link = musicDetailLink(musicId, source ?? SourceId.PCShare);
  return { title, desc, pics, link, share_id: "333.1121.0.0", oid: link };
}

/** 歌手信息弹窗属性 */
interface SingerModalProps {
  /** 音乐详情 */
  detail: () => MusicDetail;
  /** 是否显示 */
  isShow: () => boolean;
  /** 更新显示状态 */
  setIsShow: (show: boolean) => void;
  /** 深色模式 */
  isDark: () => boolean;
  /** 水平偏移百分比（默认 50 居中） */
  skidding?: () => number | undefined;
  /** 附加类名 */
  class?: string;
  /** 播放器场景宿主回调 */
  pcCallback?: PcCallback;
  /** 触发内容 */
  children?: VNode[];
}

/** 歌手信息弹窗：展示歌名 / 原唱 / 歌手（可跳转空间）/ 专辑 / 出处 */
const SingerModal = defineComponent<SingerModalProps>(
  (props): VNode => {
    /** 弹窗内大号头像（36x36 + 认证徽章） */
    const renderUpFace = (face: string, identifyType: IdentifyType): VNode =>
      h(
        "div",
        { class: "nova-music-up-face" },
        h(LazyImage, {
          class: "nova-music-face",
          src: face,
          width: 36,
          height: 36,
          ratio: 3,
        }),
        h(
          Show,
          {
            when: (): boolean => identifyType !== IdentifyType.No,
            fallback: null,
          },
          h(IdentifyBadge, {
            class: "nova-music-identify-icon",
            type:
              identifyType === IdentifyType.No
                ? IdentifyType.Self
                : identifyType,
          }),
        ),
      );

    /** label / value 信息行 */
    const renderTextRow = (label: string, value: string): VNode | null =>
      value
        ? h(
            "div",
            { class: "nova-music-text" },
            h("span", { class: "nova-music-label" }, `${label}:`),
            h("span", { class: "nova-music-value" }, value),
          )
        : null;

    /** 歌手点击：深色场景走宿主跳转回调，浅色场景由 a 标签默认跳转空间 */
    const handleArtistClick = (): void => {
      if (props.isDark()) {
        props.pcCallback?.onJump?.(2);
      }
    };

    /** 弹窗内容（详情已就绪，构建一次） */
    const detail = props.detail();
    const popChildren = h(
      "div",
      { class: "nova-music-singer-modal" },
      h(
        "div",
        { class: "nova-music-modal-content" },
        h(
          "div",
          { class: "nova-music-header" },
          h("span", {}, "音乐信息"),
          h(ModalCloseIcon, {
            onClick: (): void => {
              props.setIsShow(false);
            },
          }),
        ),
        renderTextRow("歌名", detail.music_title),
        renderTextRow("原唱", detail.origin_artist_list),
        h(
          "div",
          { class: "nova-music-artist-many" },
          h(For, {
            each: (): Singer[] => detail.midSingers || [],
            key: (singer: Singer, index: number): string =>
              `${singer.mid}-${index}`,
            render: (singer: Singer): VNode =>
              h(
                "a",
                {
                  class: "nova-music-artist-many-item",
                  target: "_blank",
                  rel: "noreferrer",
                  href: buildSpaceHref(singer.mid, true),
                  onClick: handleArtistClick,
                },
                renderUpFace(singer.face, singer.identify_type),
                h(
                  "span",
                  { class: "nova-music-artist-many-item-name" },
                  singer.name,
                ),
                h(
                  "span",
                  { class: "nova-music-artist-many-item-identity" },
                  singer.identity,
                ),
              ),
          }),
        ),
        renderTextRow("专辑", detail.album),
        renderTextRow("出处", detail.music_source),
      ),
    );

    return h(
      Popover,
      {
        dark: props.isDark,
        show: props.isShow,
        popClass: "nova-music-singer-pop",
        onChangeShow: (show: boolean): void => {
          props.setIsShow(show);
        },
        skidding: props.skidding,
        arrow: true,
        arrowClass: "nova-music-singer-dark-arrow",
        clickOutClose: true,
        mask: true,
        class: props.class,
        popChildren,
      },
      ...(props.children ?? []),
    );
  },
);

/** 溢出省略文本属性 */
interface EllipsisTextProps {
  /** 容器元素（比较高度用） */
  containerRef?: HTMLElement | null;
  /** 外层 span 类名 */
  class?: string;
  /** 内容 span 类名 */
  contentClass?: string;
  /** 溢出时点击打开弹窗 */
  onOpenModal: () => void;
  /** 文本内容 */
  children?: VNode[];
}

/** 溢出省略文本：内容高度超过容器时展示可点击样式 */
const EllipsisText = defineComponent<EllipsisTextProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 是否溢出 */
    const overflow = signal(false);
    /** 内容元素引用 */
    let contentEl: HTMLSpanElement | null = null;

    lifecycle.onMounted = (): void => {
      const contentHeight = contentEl?.getBoundingClientRect().height || 0;
      const containerHeight =
        props.containerRef?.getBoundingClientRect().height || 0;
      overflow.value = contentHeight > containerHeight;
    };

    return h(
      "span",
      {
        class: cx(
          props.class,
          overflow.value ? "nova-music-can-click" : undefined,
        ),
        onClick: (event: Event): void => {
          event.stopPropagation();
          if (overflow.value) {
            props.onOpenModal();
          }
        },
      },
      h(
        "span",
        {
          class: props.contentClass,
          ref: (el: unknown): void => {
            if (el instanceof HTMLSpanElement) contentEl = el;
          },
        },
        ...(props.children ?? []),
      ),
    );
  },
);

/** 无 mid 歌手行属性 */
interface NoMidSingerRowProps {
  /** 无 mid 歌手列表 */
  singers: Singer[];
  /** 容器元素 */
  containerRef?: HTMLElement | null;
  /** 打开弹窗回调 */
  onOpenModal: () => void;
}

/** 无 mid 歌手行（纯文本） */
const NoMidSingerRow = defineComponent<NoMidSingerRowProps>(
  (props): VNode =>
    h(
      EllipsisText,
      {
        class: "nova-music-singer",
        contentClass: "nova-music-no-mid-singer",
        containerRef: props.containerRef,
        onOpenModal: props.onOpenModal,
      },
      props.singers.map((singer: Singer): string => singer.name).join(", "),
    ),
);

/** 少量歌手行属性 */
interface FewSingerRowProps {
  /** 音乐详情 */
  detail: () => MusicDetail;
  /** 容器元素 */
  containerRef?: HTMLElement | null;
  /** 播放器全屏场景 */
  isInPlayer: boolean;
  /** 打开弹窗回调 */
  onOpenModal: () => void;
}

/** 少量歌手行（1-2 人，头像 + 名字） */
const FewSingerRow = defineComponent<FewSingerRowProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 无 mid 歌手部分是否溢出 */
    const noMidOverflow = signal(false);
    /** 无 mid 文本元素引用 */
    let noMidContentEl: HTMLSpanElement | null = null;

    lifecycle.onMounted = (): void => {
      const contentHeight =
        noMidContentEl?.getBoundingClientRect().height || 0;
      const containerHeight =
        props.containerRef?.getBoundingClientRect().height || 0;
      noMidOverflow.value = contentHeight > containerHeight;
    };

    const detail = props.detail();
    const midSingers = detail.midSingers || [];
    const noMidSingers = detail.noMidSingers || [];
    const singerCount = midSingers.length;

    return h(
      "fragment",
      {},
      h(For, {
        each: (): Singer[] => midSingers,
        key: (singer: Singer, index: number): string => `${singer.mid}-${index}`,
        render: (singer: Singer, index: number): VNode =>
          h(
            "div",
            {
              class: cx(
                "nova-music-few-singer",
                singerCount === 1 ? "nova-music-one-mid-singer" : undefined,
              ),
              onClick: (): void => {
                if (singer.mid) {
                  buildSpaceHref(singer.mid);
                }
              },
            },
            h(
              Show,
              {
                when: (): boolean => Boolean(singer.mid) && index !== 0,
                fallback: null,
              },
              h("span", { class: "nova-music-gap" }),
            ),
            h(UpFace, {
              class: cx(
                "nova-music-up",
                props.isInPlayer ? "nova-music-up-in-player" : undefined,
              ),
              type:
                singer.identify_type === undefined
                  ? IdentifyType.No
                  : singer.identify_type,
              src: singer.face || "",
              width: 20,
              height: 20,
            }),
            h(
              "span",
              {
                class: cx(
                  "nova-music-singer",
                  singer.mid ? "nova-music-can-click" : undefined,
                ),
              },
              singer.name,
            ),
          ),
      }),
      h(
        Show,
        {
          when: (): boolean => noMidSingers.length > 0,
          fallback: null,
        },
        h(
          "span",
          {
            class: cx(
              "nova-music-no-mid-singers",
              noMidOverflow.value ? "nova-music-can-click" : undefined,
            ),
            onClick: (): void => {
              if (noMidOverflow.value) {
                props.onOpenModal();
              }
            },
          },
          h("span", {}, ",\u00A0"),
          h(
            "span",
            {
              ref: (el: unknown): void => {
                if (el instanceof HTMLSpanElement) noMidContentEl = el;
              },
            },
            noMidSingers
              .map((singer: Singer): string => singer.name)
              .join(", "),
          ),
        ),
      ),
    );
  },
);

/** 多歌手行属性 */
interface MoreSingerRowProps {
  /** 音乐详情 */
  detail: () => MusicDetail;
  /** 深色模式 */
  isDark: () => boolean;
  /** 播放器全屏场景 */
  isInPlayer: boolean;
  /** 打开弹窗回调 */
  onOpenModal: () => void;
}

/** 多歌手行（3 人以上，前两个头像 + 更多图标 + 全部名字） */
const MoreSingerRow = defineComponent<MoreSingerRowProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 歌手容器元素引用（深色头像描边跟随主题） */
    let rootEl: HTMLElement | null = null;
    /** 「更多歌手」图标元素引用 */
    let upMoreEl: HTMLImageElement | null = null;

    onEffect(lifecycle, (): void => {
      if (rootEl) {
        rootEl.dataset.dark = props.isDark() ? "true" : "false";
      }
      if (upMoreEl) {
        upMoreEl.src = props.isDark() ? UP_MORE_DARK : UP_MORE_LIGHT;
      }
    });

    const detail = props.detail();
    const midSingers = detail.midSingers || [];
    const noMidSingers = detail.noMidSingers || [];
    /** 全部歌手名字 */
    const allNames = [...midSingers, ...noMidSingers]
      .map((singer: Singer): string => singer.name)
      .join(", ");

    return h(
      "span",
      {
        class: "nova-music-more-singer",
        onClick: (): void => props.onOpenModal(),
        ref: (el: unknown): void => {
          if (el instanceof HTMLElement) rootEl = el;
        },
      },
      h(
        "span",
        { class: "nova-music-more-singer-faces" },
        h(For, {
          each: (): Singer[] => midSingers.slice(0, 2),
          key: (singer: Singer, index: number): string =>
            `${singer.mid}-${index}`,
          render: (singer: Singer): VNode =>
            h(UpFace, {
              class: cx(
                "nova-music-up",
                props.isInPlayer ? "nova-music-up-in-player" : undefined,
                props.isDark() ? "nova-music-up-dark" : undefined,
              ),
              type:
                singer.identify_type === undefined
                  ? IdentifyType.No
                  : singer.identify_type,
              src: singer.face || "",
              width: 20,
              height: 20,
            }),
        }),
        h("img", {
          class: "nova-music-up-more",
          src: props.isDark() ? UP_MORE_DARK : UP_MORE_LIGHT,
          alt: "",
          ref: (el: unknown): void => {
            if (el instanceof HTMLImageElement) upMoreEl = el;
          },
        }),
      ),
      h(
        "span",
        { class: "nova-music-singer nova-music-can-click" },
        allNames,
      ),
    );
  },
);

/** 出处 / 专辑行属性 */
interface AlbumRowProps {
  /** 音乐详情 */
  detail: () => MusicDetail;
  /** 容器元素 */
  containerRef?: HTMLElement | null;
  /** 打开弹窗回调 */
  onOpenModal: () => void;
  /** 附加类名 */
  class?: string;
}

/** 出处 / 专辑行 */
const AlbumRow = defineComponent<AlbumRowProps>(
  (props): VNode => {
    const detail = props.detail();
    return h(
      EllipsisText,
      {
        class: cx("nova-music-album", props.class),
        containerRef: props.containerRef,
        onOpenModal: props.onOpenModal,
      },
      h("span", { class: "nova-music-point" }, "·"),
      h("span", {}, detail.music_source || detail.album),
    );
  },
);

/** 音乐信息区属性（歌手行 + 出处行，嵌套在歌手弹窗中） */
interface MusicInfoSectionProps {
  /** 音乐详情 */
  detail: () => MusicDetail;
  /** 深色模式 */
  isDark: () => boolean;
  /** 是否 UMD（播放器内嵌形态） */
  isUmd: boolean;
  /** 播放器全屏场景 */
  isInPlayer: boolean;
}

/** 音乐信息区：歌手展示 + 出处展示，内容溢出时可点击打开信息弹窗 */
const MusicInfoSection = defineComponent<MusicInfoSectionProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 是否显示歌手弹窗 */
    const isShowModal = signal(false);
    /** 弹窗水平偏移 */
    const centerSkidding = signal<number | undefined>(undefined);
    /** 内容容器引用 */
    let centerEl: HTMLDivElement | null = null;

    lifecycle.onMounted = (): void => {
      // 弹窗水平偏移随内容宽度调整（内容宽 > 150 时按比例偏移）
      if (centerEl && props.isUmd) {
        const width = centerEl.getBoundingClientRect().width || 0;
        if (width > 150) {
          centerSkidding.value = (10 / 68) * (width - 150) + 58;
        }
      }
    };

    const detail = props.detail();
    const midSingerCount = (detail.midSingers || []).length;
    const noMidSingers = detail.noMidSingers || [];

    /** 歌手行：0 人 / 1-2 人 / 3 人以上三种形态 */
    const renderSingerRow = (): VNode => {
      if (midSingerCount >= 3) {
        return h(MoreSingerRow, {
          detail: props.detail,
          isDark: props.isDark,
          isInPlayer: props.isInPlayer,
          onOpenModal: (): void => {
            isShowModal.value = true;
          },
        });
      }
      if (midSingerCount === 0) {
        return h(NoMidSingerRow, {
          singers: noMidSingers,
          containerRef: centerEl,
          onOpenModal: (): void => {
            isShowModal.value = true;
          },
        });
      }
      return h(FewSingerRow, {
        detail: props.detail,
        containerRef: centerEl,
        isInPlayer: props.isInPlayer,
        onOpenModal: (): void => {
          isShowModal.value = true;
        },
      });
    };

    return h(
      SingerModal,
      {
        detail: props.detail,
        isShow: (): boolean => isShowModal.value,
        setIsShow: (show: boolean): void => {
          isShowModal.value = show;
        },
        isDark: props.isDark,
        skidding: centerSkidding,
        class: "nova-music-center",
      },
      h(
        "div",
        {
          class: "nova-music-center-content",
          ref: (el: unknown): void => {
            if (el instanceof HTMLDivElement) centerEl = el;
          },
        },
        h(
          "div",
          {
            class: "nova-music-ups",
            onClick: (event: Event): void => event.stopPropagation(),
          },
          renderSingerRow(),
        ),
        h(
          Show,
          {
            when: (): boolean =>
              !props.isUmd && Boolean(detail.music_source || detail.album),
            fallback: null,
          },
          h(AlbumRow, {
            detail: props.detail,
            containerRef: centerEl,
            onOpenModal: (): void => {
              isShowModal.value = true;
            },
            class: midSingerCount >= 3 ? "nova-music-more-singer-album" : "",
          }),
        ),
      ),
    );
  },
);

/** 操作按钮区属性（看MV / 收藏 / 分享） */
interface MusicBtnsProps {
  /** 音乐 id */
  musicId: string;
  /** 音乐详情 */
  detail: () => MusicDetail;
  /** 更新详情 */
  setDetail: (updater: (prev: MusicDetail) => MusicDetail) => void;
  /** 是否 UMD（播放器内嵌形态） */
  isUmd: boolean;
  /** 播放器全屏场景 */
  isInPlayer: boolean;
  /** 深色模式 */
  isDark: () => boolean;
  /** 播放器场景宿主回调 */
  pcCallback?: PcCallback;
}

/** 操作按钮区：看 MV、收藏（切换想听状态）、分享入口 */
const MusicBtns = defineComponent<MusicBtnsProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 是否大屏（>1681px） */
    const isBigScreen = signal(window.innerWidth > 1681);
    /** 是否显示分享弹窗 */
    const isShowShare = signal(false);

    /** 收藏按钮元素引用 */
    let favBtnEl: HTMLElement | null = null;
    /** 收藏数量元素引用 */
    let favCountEl: HTMLElement | null = null;
    /** 窗口尺寸监听（卸载时移除） */
    let resizeHandler: (() => void) | null = null;

    /** 大图标模式：非 UMD、无 MV 或大屏非播放器场景 */
    const isBigIconMode = (): boolean =>
      !props.isUmd ||
      !props.detail().mv_aid ||
      (isBigScreen.value && !props.isInPlayer);

    lifecycle.onMounted = (): void => {
      resizeHandler = (): void => {
        if (props.isUmd && props.detail().mv_aid) {
          isBigScreen.value = window.innerWidth > 1681;
        }
      };
      window.addEventListener("resize", resizeHandler);
    };

    lifecycle.onBeforeDestroy = (): void => {
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
        resizeHandler = null;
      }
    };

    // 收藏按钮样式 / 想听数量：随详情信号更新
    onEffect(lifecycle, (): void => {
      const detail = props.detail();
      if (favBtnEl) {
        favBtnEl.className = isBigIconMode()
          ? "nova-music-fav-icon nova-music-big-icon"
          : cx(
              "nova-music-btn",
              detail.wish_listen ? "nova-music-has-fav" : undefined,
            );
      }
      if (favCountEl) {
        favCountEl.textContent = detail.wish_count
          ? String(formatCount(detail.wish_count, 1))
          : "";
      }
    });

    /** 切换想听状态 */
    const handleFavClick = async (): Promise<void> => {
      try {
        const detail = props.detail();
        await updateWish({
          music_id: props.musicId,
          state: detail.wish_listen ? 2 : 1,
        });
        toast.info(
          detail.wish_listen ? "已取消喜欢" : "wow~恭喜你发现了好音乐~",
        );
        props.setDetail(
          (prev: MusicDetail): MusicDetail => ({
            ...prev,
            wish_listen: !prev.wish_listen,
            wish_count: (prev.wish_count || 0) + (prev.wish_listen ? -1 : 1),
          }),
        );
      } catch {
        // 模拟环境忽略异常
      }
    };

    /** 打开分享弹窗 */
    const handleShareClick = async (): Promise<void> => {
      isShowShare.value = true;
      try {
        await reportShareLog({ type: 1, music_id: props.musicId || "" });
      } catch {
        // 模拟环境忽略异常
      }
    };

    const detail = props.detail();
    const bigIcon = isBigIconMode();

    return h(
      "div",
      { class: "nova-music-btns nova-music-info-btns" },
      h(
        Show,
        {
          when: (): boolean => Boolean(detail.mv_aid),
          fallback: null,
        },
        h(
          "div",
          {
            class: "nova-music-mv nova-music-btn",
            onClick: (): void =>
              openMvVideo(detail.mv_bvid || "", detail.mv_index_order),
          },
          h(WatchMvIcon),
          "看MV",
        ),
      ),
      h(
        "div",
        {
          class: bigIcon
            ? "nova-music-fav-icon nova-music-big-icon"
            : cx(
                "nova-music-btn",
                detail.wish_listen ? "nova-music-has-fav" : undefined,
              ),
          onClick: (): void => {
            void handleFavClick();
          },
          ref: (el: unknown): void => {
            if (el instanceof HTMLElement) favBtnEl = el;
          },
        },
        h(HeartIcon, {
          isFav: (): boolean => props.detail().wish_listen,
        }),
        h(
          Show,
          {
            when: (): boolean => Boolean(detail.wish_count),
            fallback: null,
          },
          h(
            "span",
            {
              class: "nova-music-number",
              ref: (el: unknown): void => {
                if (el instanceof HTMLElement) favCountEl = el;
              },
            },
            `${formatCount(detail.wish_count || 0, 1)}`,
          ),
        ),
      ),
      h(
        Show,
        {
          when: (): boolean =>
            !(detail.flow_attr && detail.flow_attr.no_share),
          fallback: null,
        },
        h(
          ShareModel,
          {
            musicId: props.musicId,
            detail: props.detail,
            class: "nova-music-share-container",
            isShow: (): boolean => isShowShare.value,
            setIsShow: (show: boolean): void => {
              isShowShare.value = show;
            },
            isUmd: props.isUmd,
            isDark: props.isDark,
          },
          bigIcon
            ? h(
                "div",
                {
                  class: "nova-music-big-icon",
                  onClick: (): void => {
                    void handleShareClick();
                  },
                },
                h(ShareIcon),
              )
            : h(
                "div",
                {
                  class: "nova-music-btn",
                  onClick: (): void => {
                    void handleShareClick();
                  },
                },
                h(ShareIcon),
                h("span", {}, "分享"),
              ),
        ),
      ),
    );
  },
);

/** 分享弹窗属性 */
interface ShareModelProps {
  /** 音乐 id */
  musicId: string;
  /** 音乐详情 */
  detail: () => MusicDetail;
  /** 附加类名 */
  class?: string;
  /** 是否显示 */
  isShow: () => boolean;
  /** 更新显示状态 */
  setIsShow: (show: boolean) => void;
  /** 是否 UMD（播放器内嵌形态） */
  isUmd: boolean;
  /** 深色模式 */
  isDark: () => boolean;
  /** 触发内容 */
  children?: VNode[];
}

/** 分享渠道配置 */
const SHARE_CHANNELS: ShareChannel[] = [
  { text: "动态", id: "dynmic", reportId: "dynmic" },
  { text: "微信", id: "weixin", reportId: "wechat" },
  { text: "QQ", id: "qq", reportId: "QQ" },
  { text: "QQ空间", id: "qzone", reportId: "QQspace" },
  { text: "微博", id: "weibo", reportId: "weibo" },
  { text: "复制链接", id: "link", reportId: "link" },
];

/**
 * 分享渠道图标（link 渠道使用 base64 图片）
 *
 * @param id - 渠道 id
 * @returns 图标 VNode
 */
function renderChannelIcon(id: ShareChannelId): VNode {
  if (id === "link") {
    return h("img", { src: COPY_LINK_ICON, alt: "" });
  }
  if (id === "weixin") {
    return WechatIcon();
  }
  if (id === "qq") {
    return QqIcon();
  }
  if (id === "qzone") {
    return QzoneIcon();
  }
  if (id === "weibo") {
    return WeiboIcon();
  }
  return DynmicShareIcon();
}

/** 分享弹窗：动态 / 微信 / QQ / QQ空间 / 微博 / 复制链接（模拟环境仅复制与提示） */
const ShareModel = defineComponent<ShareModelProps>(
  (props): VNode => {
    /** 弹窗水平偏移：UMD 场景按有无 MV 调整 */
    const skidding = (): number => {
      const detail = props.detail();
      return props.isUmd ? (detail.mv_aid ? 88 : 80) : 50;
    };
    /** 分享弹窗水平偏移信号（供 Popover 定位） */
    const shareSkidding = signal<number | undefined>(skidding());

    /** 渠道点击处理 */
    const handleShare = async (channel: ShareChannelId): Promise<void> => {
      const source = channel === "dynmic" ? SourceId.FromMsgShare : undefined;
      const content = buildShareContent(
        props.detail(),
        props.musicId,
        source,
      );
      if (channel === "link" || channel === "weixin") {
        await copyText(`【${content.title}】${content.link}`);
        toast.info("已成功复制到剪贴板");
        return;
      }
      // 模拟环境：未接入外部分享 SDK，仅提示
      const channelText =
        SHARE_CHANNELS.find(
          (item: ShareChannel): boolean => item.id === channel,
        )?.text || "";
      toast.info(`模拟环境：暂不支持分享到${channelText}`);
    };

    const popChildren = h(
      "div",
      { class: "nova-music-share-model" },
      h(
        "div",
        { class: "nova-music-header" },
        h("span", {}, "音乐信息"),
        h(ModalCloseIcon, {
          onClick: (): void => {
            props.setIsShow(false);
          },
        }),
      ),
      h(
        "div",
        { class: "nova-music-content" },
        h(For, {
          each: (): ShareChannel[] => SHARE_CHANNELS,
          key: (channel: ShareChannel): string => channel.id,
          render: (channel: ShareChannel): VNode =>
            h(
              "div",
              {
                class: "nova-music-channel",
                onClick: (): void => {
                  void handleShare(channel.id);
                },
              },
              renderChannelIcon(channel.id),
              h("span", {}, channel.text),
            ),
        }),
      ),
    );

    return h(
      Popover,
      {
        dark: props.isDark,
        show: props.isShow,
        duration: 300,
        class: props.class,
        popClass: "nova-music-share-pop",
        popChildren,
        onChangeShow: (show: boolean): void => {
          props.setIsShow(show);
        },
        skidding: (): number | undefined => shareSkidding.value,
        arrow: true,
        arrowClass: "nova-music-share-dark-arrow",
        clickOutClose: true,
        mask: true,
      },
      ...(props.children ?? []),
    );
  },
);

/** 详情卡片属性 */
export interface MusicDetailInfoProps {
  /** 音乐详情 */
  detail: () => MusicDetail;
  /** 头部标题显隐回调（标题滚出头部时展示音乐标题） */
  setIsShowTitle: (updater: (prev: boolean) => boolean) => void;
  /** 更新详情 */
  setDetail: (updater: (prev: MusicDetail) => MusicDetail) => void;
  /** 深色模式 */
  isDark: () => boolean;
  /** 播放器全屏场景 */
  isInPlayer: boolean;
  /** 是否 UMD（播放器内嵌形态） */
  isUmd: boolean;
  /** 音乐 id */
  musicId: string;
  /** 附加类名 */
  class?: string;
  /** 播放器场景宿主回调 */
  pcCallback?: PcCallback;
}

/** 详情卡片：封面 + 标题（点击打开信息弹窗）+ 播放数据 + 操作按钮 */
export const MusicDetailInfo = defineComponent<MusicDetailInfoProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 歌手信息弹窗水平偏移 */
    const skidding = signal<number | undefined>(undefined);
    /** 是否显示标题信息弹窗 */
    const isShowTitleModal = signal(false);
    /** 标题元素引用 */
    let titleEl: HTMLDivElement | null = null;
    /** 根元素引用（深色模式类名） */
    let rootEl: HTMLElement | null = null;
    /** 标题可见性观察器（卸载时断开） */
    let titleObserver: IntersectionObserver | null = null;

    lifecycle.onMounted = (): void => {
      // 标题滚出头部可视区时，通知头部展示音乐标题
      if (typeof IntersectionObserver !== "undefined" && titleEl) {
        titleObserver = new IntersectionObserver(
          (entries: IntersectionObserverEntry[]): void => {
            const next = !(entries[0] && entries[0].isIntersecting);
            props.setIsShowTitle((prev: boolean): boolean =>
              prev === next ? prev : next,
            );
          },
          { rootMargin: "-48px" },
        );
        titleObserver.observe(titleEl);
      }
      // 弹窗水平偏移随标题宽度调整
      const width = titleEl?.getBoundingClientRect().width || 0;
      skidding.value =
        width > 162
          ? (10 / 56) * (width - 162) + 58
          : (11 / 128) * (width - 34) + 39;
    };

    lifecycle.onBeforeDestroy = (): void => {
      titleObserver?.disconnect();
      titleObserver = null;
    };

    // 深色模式类名（播放器内强制深色 / 跟随主题）
    onEffect(lifecycle, (): void => {
      if (!rootEl) return;
      const dark = props.isDark() || musicTheme.value === "dark";
      rootEl.className = cx(
        "nova-music-detail-info",
        dark ? "nova-music-dark" : undefined,
        props.class,
      );
    });

    const detail = props.detail();

    /** 播放次数 + 榜单徽章行 */
    const renderDescRow = (): VNode | null => {
      const detailValue = props.detail();
      const listenSpan =
        !props.isUmd && detailValue.listen_pv
          ? h(
              "span",
              {},
              `${formatCount(Number(detailValue.listen_pv), 1)}次播放`,
            )
          : null;
      const rankParams: RankJumpParams = {
        value: "",
        list_type: RankListType.Hot,
        list_id: 0,
        position_id: Number(getQueryParam("position_id") || ""),
      };
      if (detailValue.music_rank && detailValue.max_list_id) {
        rankParams.value = detailValue.music_rank;
        rankParams.list_type = RankListType.Hot;
        rankParams.list_id = detailValue.max_list_id;
      } else if (
        detailValue.max_recreation_list_id &&
        detailValue.recreation_rank
      ) {
        rankParams.value = detailValue.recreation_rank;
        rankParams.list_type = RankListType.Recreation;
        rankParams.list_id = detailValue.max_recreation_list_id;
      }
      const rankSpan = rankParams.value
        ? h(
            "span",
            {
              class: "nova-music-rank",
              onClick: (): void => openRankPage(rankParams),
            },
            rankParams.value,
            h(ArrowRightIcon),
          )
        : null;
      const shown = [listenSpan, rankSpan].filter(
        (item): item is VNode => item !== null,
      );
      return shown.length > 0
        ? h("div", { class: "nova-music-desc" }, ...shown)
        : null;
    };

    return h(
      "div",
      {
        class: cx("nova-music-detail-info", props.class),
        ref: (el: unknown): void => {
          if (el instanceof HTMLElement) rootEl = el;
        },
      },
      h(
        "div",
        { class: "nova-music-left" },
        h(LazyImage, {
          class: "nova-music-cover",
          src: detail.mv_cover || "",
          ratio: 2,
          width: 98,
          height: 98,
          type: "mv",
        }),
      ),
      h(
        "div",
        { class: "nova-music-right" },
        h(
          SingerModal,
          {
            detail: props.detail,
            isShow: (): boolean => isShowTitleModal.value,
            setIsShow: (show: boolean): void => {
              isShowTitleModal.value = show;
            },
            isDark: props.isDark,
            class: "nova-music-title-wrapper",
            skidding: (): number | undefined => skidding.value,
          },
          h(
            Tooltip,
            {
              targetDom: null,
              content: h("div", {}, "点击查看更多音乐信息"),
            },
            h(
              "div",
              {
                class: "nova-music-title",
                onClick: (): void => {
                  isShowTitleModal.value = true;
                },
                ref: (el: unknown): void => {
                  if (el instanceof HTMLDivElement) titleEl = el;
                },
              },
              detail.music_title || "",
              h(ArrowRightIcon, {
                class: "nova-music-title-right",
                width: 15,
                height: 15,
              }),
            ),
          ),
        ),
        h(
          "div",
          { class: "nova-music-music-info" },
          h(MusicInfoSection, {
            detail: props.detail,
            isDark: props.isDark,
            isUmd: props.isUmd,
            isInPlayer: props.isInPlayer,
          }),
          renderDescRow(),
        ),
        h(MusicBtns, {
          musicId: props.musicId,
          detail: props.detail,
          setDetail: props.setDetail,
          isUmd: props.isUmd,
          isInPlayer: props.isInPlayer,
          isDark: props.isDark,
          pcCallback: props.pcCallback,
        }),
      ),
    );
  },
);
