/**
 * ============================================
 * 音乐视频区（VideoCardList 移植）
 * ============================================
 * 视频卡片网格 + 小编推荐 banner + 没看够引导。
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
  DanmuCountIcon,
  HotRankIcon,
  LazyImage,
  PlayCountIcon,
  UpBadgeIcon,
  VtDurationIcon,
  cx,
} from "./base";
import { formatCount } from "./format";
import { musicTheme } from "./theme";
import { fetchMusicVideoList, fetchRecommendList } from "./api";
import { musicCenterUrl, videoUrl } from "./MusicDetailInfo";
import {
  LabelValue,
  VtStatus,
  type MusicVideoItem,
  type PcCallback,
  type RecommendItem,
  type VideoLabel,
} from "./types";

/** 视频卡片属性 */
interface VideoCardProps {
  /** 视频信息 */
  info: MusicVideoItem;
  /** 卡片位置（索引从 0 开始） */
  index: number;
  /** 深色模式 */
  isDark: () => boolean;
  /** 播放器场景宿主回调 */
  pcCallback?: PcCallback;
  /** 附加类名 */
  class?: string;
}

/** 视频卡片：封面状态栏 + 标题 + UP 信息行 */
const VideoCard = defineComponent<VideoCardProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 标签徽章元素引用（深色配色跟随主题） */
    let labelEl: HTMLElement | null = null;

    const item = props.info;
    /** 标签值列表 */
    const labelValues = (): number[] =>
      (item.label_list || []).map((label: VideoLabel): number => label.value);
    /** 多标签（1 个以上） */
    const hasMultiLabels = (): boolean => labelValues().length > 1;
    /** 标签名映射（按标签值） */
    const labelNameMap = (): Record<number, string> => {
      const map: Record<number, string> = {};
      for (const label of item.label_list || []) {
        map[label.value] = label.name;
      }
      return map;
    };
    /** 存在「同音乐视频」标签 */
    const hasSameMusicLabel = (): boolean =>
      Boolean(labelNameMap()[LabelValue.SameMusic]);

    // 标签徽章深色配色
    onEffect(lifecycle, (): void => {
      if (!labelEl) return;
      const dark = props.isDark() || musicTheme.value === "dark";
      labelEl.className = cx(
        "nova-music-up-label",
        dark ? "nova-music-dark-label" : undefined,
      );
    });

    /** 深色场景点击由宿主接管跳转 */
    const handleClick = (): void => {
      if (props.isDark()) {
        props.pcCallback?.onJump?.(2);
      }
    };

    /** 视频地址 */
    const href = videoUrl(item.bvid || "", item.index_order || 0);

    return h(
      "div",
      { class: cx("nova-music-video-card", props.class) },
      h(
        "div",
        { class: "nova-music-cover" },
        h(
          "a",
          {
            class: "nova-music-cover-wrap",
            target: "_blank",
            rel: "noreferrer",
            href,
            onClick: handleClick,
          },
          h(LazyImage, {
            class: "nova-music-cover-img",
            src: item.cover || "",
            width: 228,
            height: 142.5,
            ratio: 2,
          }),
          h(
            "div",
            { class: "nova-music-status-bar" },
            h(
              Show,
              {
                when: (): boolean => item.is_vt === VtStatus.Is,
                fallback: h(
                  "fragment",
                  {},
                  h(PlayCountIcon, { class: "nova-music-play-icon" }),
                  h(
                    "span",
                    { class: "nova-music-first" },
                    `${formatCount(item.play || 0, 1)}`,
                  ),
                ),
              },
              h(
                "fragment",
                {},
                h(VtDurationIcon, { class: "nova-music-time-icon" }),
                h("span", { class: "nova-music-first" }, item.vt_display),
              ),
            ),
            h(DanmuCountIcon, { class: "nova-music-danmu-icon" }),
            h("span", {}, `${formatCount(item.danmu || 0, 1)}`),
          ),
        ),
      ),
      h(
        "a",
        {
          class: "nova-music-video-title",
          target: "_blank",
          rel: "noreferrer",
          href,
          onClick: handleClick,
        },
        item.title,
      ),
      h(
        "div",
        { class: "nova-music-up" },
        h(
          Show,
          {
            when: (): boolean => Boolean(item.label_list),
            fallback: null,
          },
          h(
            "span",
            {
              class: "nova-music-up-label",
              ref: (el: unknown): void => {
                if (el instanceof HTMLElement) labelEl = el;
              },
            },
            (item.label_list || [])
              .map((label: VideoLabel): string => label.name)
              .join("｜"),
          ),
        ),
        h(
          Show,
          {
            when: (): boolean => !(hasMultiLabels() || hasSameMusicLabel()),
            fallback: null,
          },
          h(
            "a",
            {
              class: "nova-music-name",
              target: "_blank",
              rel: "noreferrer",
              href: `https://space.bilibili.com/${item.mid || 0}`,
              onClick: handleClick,
            },
            h(
              Show,
              {
                when: (): boolean => !item.label_list,
                fallback: null,
              },
              h(UpBadgeIcon),
            ),
            h("div", { class: "nova-music-name-text" }, item.up_nick_name),
          ),
        ),
      ),
    );
  },
);

/** 小编推荐属性 */
interface RecommendListProps {
  /** 深色模式 */
  isDark: () => boolean;
  /** 播放器场景宿主回调 */
  pcCallback?: PcCallback;
  /** 推荐位就绪回调 */
  setIsRecommendListReady: (ready: boolean) => void;
  /** 宿主注入的推荐位数据（缺省时走模拟接口） */
  data?: RecommendItem[];
}

/** 小编推荐 banner 位（接口 /x/web-show/res/locs，ids=4979） */
const RecommendList = defineComponent<RecommendListProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 推荐位数据 */
    const resList = signal<RecommendItem[]>(props.data ?? []);

    lifecycle.onMounted = (): void => {
      if (props.data && props.data.length > 0) {
        props.setIsRecommendListReady(true);
        return;
      }
      void (async (): Promise<void> => {
        try {
          const { data } = await fetchRecommendList();
          resList.value = (data["4979"] || []).filter(
            (item: RecommendItem): boolean => Boolean(item.url),
          );
        } finally {
          props.setIsRecommendListReady(true);
        }
      })();
    };

    /** 深色场景点击由宿主接管跳转 */
    const handleClick = (): void => {
      if (props.isDark()) {
        props.pcCallback?.onJump?.(2);
      }
    };

    return h(
      Show,
      {
        when: (): boolean => resList.value.length > 0,
        fallback: null,
      },
      h(
        "div",
        { class: "nova-music-recommend-list" },
        h("div", { class: "nova-music-title" }, "小编推荐"),
        h(
          "div",
          { class: "nova-music-main" },
          h(For, {
            each: (): RecommendItem[] => resList.value,
            key: (item: RecommendItem, index: number): string =>
              `${item.pos_num}-${index}`,
            render: (item: RecommendItem): VNode =>
              h(
                "a",
                {
                  class: "nova-music-res-item",
                  target: "_blank",
                  rel: "noreferrer",
                  href: item.url,
                  onClick: handleClick,
                },
                h(LazyImage, {
                  class: "nova-music-res-img",
                  src: item.pic || "",
                  width: 344,
                  height: 122,
                }),
              ),
          }),
        ),
      ),
    );
  },
);

/** 视频列表容器属性 */
export interface MusicVideoCardListProps {
  /** 深色模式 */
  isDark: () => boolean;
  /** 播放器场景宿主回调 */
  pcCallback?: PcCallback;
  /** 音乐 id */
  musicId: string;
  /** 入口视频 aid（透传给视频列表请求） */
  entryAid?: number;
  /** 是否 UMD（播放器内嵌形态） */
  isUmd: boolean;
  /** 附加类名 */
  class?: string;
  /** 宿主注入的视频列表数据（缺省时走模拟接口） */
  videoList?: MusicVideoItem[];
  /** 宿主注入的小编推荐数据（缺省时走模拟接口） */
  recommendList?: RecommendItem[];
}

/** 音乐视频区：视频卡片网格 + 小编推荐 + 没看够引导 */
export const MusicVideoCardList = defineComponent<MusicVideoCardListProps>(
  (props, lifecycle: ComponentLifecycle): VNode => {
    /** 视频列表 */
    const videoList = signal<MusicVideoItem[]>(props.videoList ?? []);
    /** 视频列表是否就绪 */
    const ready = signal(false);
    /** 小编推荐是否就绪 */
    const isRecommendListReady = signal(false);

    lifecycle.onMounted = (): void => {
      if (props.videoList && props.videoList.length > 0) {
        ready.value = true;
        return;
      }
      void (async (): Promise<void> => {
        try {
          const { data } = await fetchMusicVideoList({
            music_id: props.musicId,
            aid: props.entryAid?.toString(),
          });
          videoList.value = data.list || [];
        } finally {
          ready.value = true;
        }
      })();
    };

    /** 是否展示「没看够」引导（视频就绪即展示；不足 7 条时需等推荐位就绪） */
    const showNoMore = (): boolean =>
      (ready.value &&
        videoList.value.length <= 6 &&
        isRecommendListReady.value) ||
      ready.value;

    return h(
      "div",
      { class: cx("nova-music-video-list-wrap", props.class) },
      h(
        Show,
        {
          when: (): boolean => videoList.value.length > 0,
          fallback: null,
        },
        h(
          "div",
          { class: "nova-music-video-container" },
          h("div", { class: "nova-music-title" }, "音乐视频"),
          h(
            "div",
            { class: "nova-music-video-list" },
            h(For, {
              each: (): MusicVideoItem[] => videoList.value,
              key: (info: MusicVideoItem): string => `${info.aid}-${info.bvid}`,
              render: (info: MusicVideoItem, index: number): VNode =>
                h(VideoCard, {
                  class: "nova-music-card",
                  info,
                  index,
                  isDark: props.isDark,
                  pcCallback: props.pcCallback,
                }),
            }),
            h(
              Show,
              {
                when: (): boolean =>
                  Boolean(props.isUmd && videoList.value.length % 2 === 1),
                fallback: null,
              },
              h("div", { class: "nova-music-card" }),
            ),
          ),
        ),
      ),
      h(
        Show,
        {
          when: (): boolean =>
            Boolean(props.isUmd && ready.value && videoList.value.length <= 6),
          fallback: null,
        },
        h(RecommendList, {
          isDark: props.isDark,
          pcCallback: props.pcCallback,
          setIsRecommendListReady: (value: boolean): void => {
            isRecommendListReady.value = value;
          },
          data: props.recommendList,
        }),
      ),
      h(
        Show,
        {
          when: (): boolean => showNoMore(),
          fallback: null,
        },
        h(
          "div",
          { class: "nova-music-no-more" },
          h(
            "div",
            { class: "nova-music-text" },
            "没看够?点击前往发现更多新热好歌",
          ),
          h(
            "a",
            {
              class: "nova-music-bottom-btn",
              target: "_blank",
              rel: "noreferrer",
              href: musicCenterUrl(),
            },
            h(HotRankIcon, { class: "nova-music-hot-icon" }),
            h("span", {}, "新歌热榜"),
            h(ArrowRightIcon, { class: "nova-music-right-arrow" }),
          ),
        ),
      ),
    );
  },
);
