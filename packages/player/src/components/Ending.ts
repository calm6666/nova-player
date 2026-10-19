/**
 * ============================================
 * 片尾推荐面板组件 (Ending)
 * ============================================
 * 兼容两种场景：
 * - station：站内浮层片尾（UP 信息 / 功能按钮 / 8 张推荐卡 / 自动连播倒计时）
 * - embedded：外链嵌入整页片尾（标题 / UP / 顶部操作 / 5×2 推荐卡 / 下载与进入站内）
 *
 * 推荐 / UP 数据均由使用方通过 props 注入，播放器不臆造数据；
 * 未提供数据时只渲染容器结构，列表为空。
 */

import { h, defineComponent, useTemplateRef, t } from "@/core";
import type { VNode } from "@/types";
import type {
  EndingRelatedItem,
  EndingUpInfo,
  PlayerScene,
} from "@/types";
import { LottieIcon, type LottieIconApi } from "./LottieIcon";
import endingCountdownAnimationData from "../assets/lottie-icon/ending-countdown-animation.json";

/**
 * Ending 组件 Props 接口
 */
export interface EndingProps {
  /** 渲染形态（默认 station；ogv = 电视剧 / 番剧整页片尾） */
  variant?: PlayerScene | "ogv";
  /** 剧集封面（ogv 头部 68×68） */
  cover?: string;
  /** 是否已追剧（ogv 追剧按钮状态） */
  followed?: boolean;
  /** 视频标题（embedded 顶部展示） */
  title?: string;
  /** UP 主信息（无数据时不渲染详情内容） */
  upInfo?: EndingUpInfo;
  /** 相关推荐列表 */
  related?: EndingRelatedItem[];
  /**
   * 是否启用自动连播（station 生效）
   *
   * 传函数时在每次展示片尾时求值，避免挂载期播放列表尚未写入。
   */
  autoNext?: boolean | (() => boolean);
  /** 自动连播倒计时秒数（默认 5） */
  countdownSeconds?: number;
  /** 点击重播按钮时的回调 */
  onRestart?: () => void;
  /** 点击关注按钮时的回调 */
  onFollow?: () => void;
  /** 点击充电按钮时的回调 */
  onElectric?: () => void;
  /** 点击点赞（好评）按钮时的回调 */
  onLike?: () => void;
  /** 点击投币按钮时的回调 */
  onCoin?: () => void;
  /** 点击收藏按钮时的回调 */
  onCollect?: () => void;
  /** 点击分享按钮时的回调（station 内部会切换到分享面板） */
  onShare?: () => void;
  /** 关闭分享面板时的回调 */
  onCloseShare?: () => void;
  /** 倒计时结束：自动连播下一集 */
  onAutoNext?: () => void;
  /** 用户取消自动连播 */
  onCancelAutoNext?: () => void;
  /** 点击推荐卡片 */
  onRelatedClick?: (item: EndingRelatedItem) => void;
  /** embedded：进入站内观看 */
  onEnterSite?: () => void;
  /** embedded：下载客户端 */
  onDownloadApp?: () => void;
}

/**
 * 片尾面板对外暴露的 API
 */
export interface EndingApi {
  /** 显示片尾面板（data-select="1"） */
  showEndWrap: () => void;
  /** 关闭片尾面板（移除 data-select） */
  closeEndWrap: () => void;
  /** 显示分享面板（data-select="2"，仅 station） */
  showShareWrap: () => void;
  /** 关闭分享面板（回到片尾面板 data-select="1"） */
  closeShareWrap: () => void;
  /** 当前是否处于自动连播倒计时 */
  isCountdownActive: () => boolean;
}

/** 通用装饰图标（静态 SVG 填充图标） */
const SimpleIcon = (path: string): VNode =>
  h(
    "svg",
    {
      viewBox: "0 0 1024 1024",
      version: "1.1",
      xmlns: "http://www.w3.org/2000/svg",
    },
    h("path", { d: path }),
  );

/** 线性描边图标（embedded 下载 / 进入箭头） */
const StrokeIcon = (path: string): VNode =>
  h(
    "svg",
    {
      viewBox: "0 0 24 24",
      fill: "none",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      xmlns: "http://www.w3.org/2000/svg",
    },
    h("path", { d: path, stroke: "currentColor" }),
  );

/** 关注（加号）图标 */
const ADD_ICON =
  "M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64z m224 480H544v192a32 32 0 0 1-64 0V544H288a32 32 0 0 1 0-64h192V288a32 32 0 0 1 64 0v192h192a32 32 0 0 1 0 64z";
/** 重播图标 */
const RESTART_ICON =
  "M512 128c-106 0-202 46.4-267.8 120L160 163.8V384h220.2l-90.5-90.5C344.6 240 424.6 208 512 208c167.6 0 304 136.4 304 304s-136.4 304-304 304-304-136.4-304-304h-80c0 212 172 384 384 384s384-172 384-384S724 128 512 128z";
/** 点赞图标 */
const LIKE_ICON =
  "M885.9 533.7c16.8-22.2 26.1-49.4 26.1-77.7 0-44.9-25.1-87.4-65.5-111.1a67.67 67.67 0 0 0-34.3-9.3H572.4l6-122.9c1.4-29.7-9.1-57.9-29.5-79.4A106.62 106.62 0 0 0 468.9 96c-28.1 0-53.6 13.4-68.9 35.9L224 471.4v493.8c0 32.1 26.1 58.2 58.2 58.2h458.9c22.7 0 43.1-13.5 52-34.3l101.9-230.6c2.9-6.7 4.5-13.9 4.5-21.1V576c0-15.2-4.5-29.7-13.6-42.3z";
/** 投币图标 */
const COIN_ICON =
  "M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64z m0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z m48-532v96h-96v-96c0-26.5-21.5-48-48-48s-48 21.5-48 48v96h-32c-17.7 0-32 14.3-32 32v64c0 17.7 14.3 32 32 32h32v64h-32c-17.7 0-32 14.3-32 32v64c0 17.7 14.3 32 32 32h32v96c0 26.5 21.5 48 48 48s48-21.5 48-48v-96h96v96c0 26.5 21.5 48 48 48s48-21.5 48-48v-96h32c17.7 0 32-14.3 32-32v-64c0-17.7-14.3-32-32-32h-32v-64h32c17.7 0 32-14.3 32-32v-64c0-17.7-14.3-32-32-32h-32v-96c0-26.5-21.5-48-48-48s-48 21.5-48 48z";
/** 收藏图标 */
const COLLECT_ICON =
  "M908.1 353.1l-253.9-36.9L540.7 86.1c-3.1-6.3-8.2-11.4-14.5-14.5-15.8-7.8-35-1.3-42.9 14.5L369.8 316.2l-253.9 36.9c-7 1-13.4 3.8-18.5 8.2-12.8 11.8-13.6 31.8-1.8 44.6l185.1 180.4-43.7 254.1c-1.2 7-0.5 14.2 2.1 20.7 6.1 15.4 23.6 23 39 16.9L512 754.3l227.7 119.7c6.5 3.4 14 4.4 21 3.1 16.9-3.2 28-19.5 24.8-36.4l-43.7-254.1 184.6-179.9c5.1-4.9 8.6-11.3 9.7-18.3 2.6-16.9-8.9-32.6-26-35.3z";
/** 分享图标 */
const SHARE_ICON =
  "M725.3 128a106.7 106.7 0 1 1-88.1 166.5L401.1 425.9a106.8 106.8 0 0 1 0 172.2l236.1 131.4A106.7 106.7 0 1 1 618.7 768c0-6.2 0.5-12.3 1.5-18.2L384.1 618.4a106.7 106.7 0 1 1 0-212.8l236.1-131.4c-1-5.9-1.5-12-1.5-18.2A106.7 106.7 0 0 1 725.3 128z";
/** 关闭图标 */
const CLOSE_ICON =
  "M512 444.16l297.088-297.088c17.088-17.152 46.208-15.872 64.96 2.88 18.752 18.752 20.032 47.872 2.88 64.96L579.904 512l297.024 297.088c17.152 17.088 15.872 46.208-2.88 64.96-18.752 18.752-47.872 20.032-64.96 2.88L512 579.904l-297.088 297.024c-17.088 17.152-46.208 15.872-64.96-2.88-18.752-18.752-20.032-47.872-2.88-64.96L444.096 512 147.072 214.912c-17.152-17.088-15.872-46.208 2.88-64.96 18.752-18.752 47.872-20.032 64.96-2.88L512 444.096z";
/** 下载图标（线性） */
const DOWNLOAD_ICON = "M12 3v12m0 0 4-4m-4 4-4-4M4 21h16";
/** 进入箭头（线性） */
const ENTER_ICON = "m9 6 6 6-6 6";
/** 追剧爱心（OGV 片尾头部） */
const HEART_ICON =
  "M8 14c-.1 0-.25-.05-.35-.1-.45-.35-4.3-3.35-5.1-4.5-.9-1.2-1.05-1.85-1.05-3C1.5 4 3.25 2 5.45 2 6.4 2 7.3 2.35 8 3c.7-.65 1.6-1 2.55-1 2.2 0 3.95 2 3.95 4.4 0 1.1-.15 1.75-1.05 3-.8 1.1-4.7 4.15-5.1 4.5-.1.05-.25.1-.35.1z";

/**
 * 秒数格式化为 mm:ss / hh:mm:ss
 * @param value - 秒数或已格式化字符串
 */
const formatDuration = (value?: number | string): string => {
  if (value === undefined || value === "") return "";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value) || value < 0) return "";
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/**
 * 片尾推荐面板组件
 */
export const Ending = defineComponent<EndingProps>((props, lifecycle) => {
  const variant: PlayerScene | "ogv" = props.variant ?? "station";
  const isEmbedded = variant === "embedded";
  const isOgv = variant === "ogv";

  // ============================================
  // DOM 引用
  // ============================================

  /** 片尾面板外层容器 DOM 引用，通过 data-select 属性控制显示哪个子面板 */
  const endingWrapRef = useTemplateRef<HTMLDivElement>(
    lifecycle,
    "endingWrapRef",
  );

  /** 倒计时 lottie 实例 */
  const countdownRef = useTemplateRef<LottieIconApi>(
    lifecycle,
    "countdownRef",
  );

  /** 当前是否处于倒计时（普通变量，供 LottieIcon onReady 同步） */
  let countdownActive = false;

  /** 倒计时定时器 */
  let countdownTimer: ReturnType<typeof setTimeout> | null = null;

  /** 倒计时秒数 */
  const countdownSeconds = Math.max(1, props.countdownSeconds ?? 5);

  /** 解析自动连播开关（支持 getter，展示时求值） */
  const resolveAutoNext = (): boolean =>
    typeof props.autoNext === "function"
      ? Boolean(props.autoNext())
      : Boolean(props.autoNext);

  /** 推荐列表（默认空，不臆造数据） */
  const related: EndingRelatedItem[] = props.related ?? [];

  // ============================================
  // 自动连播倒计时
  // ============================================

  /** 清理倒计时定时器 */
  const clearCountdownTimer = (): void => {
    if (countdownTimer !== null) {
      clearTimeout(countdownTimer);
      countdownTimer = null;
    }
  };

  /** 停止倒计时并复位动画 / 属性 */
  const stopCountdown = (): void => {
    countdownActive = false;
    clearCountdownTimer();
    countdownRef.value?.stop();
    endingWrapRef.value?.removeAttribute("data-countdown");
  };

  /** 启动自动连播倒计时（仅 station 且存在推荐数据时） */
  const startCountdown = (): void => {
    if (isEmbedded || !resolveAutoNext()) return;
    countdownActive = true;
    // 有推荐卡时在第一张卡上展示倒计时；没有数据时仍保留 5s 自动连播兜底
    if (related.length > 0) {
      endingWrapRef.value?.setAttribute("data-countdown", "true");
    }
    countdownRef.value?.play();
    clearCountdownTimer();
    countdownTimer = setTimeout(() => {
      countdownTimer = null;
      stopCountdown();
      props.onAutoNext?.();
    }, countdownSeconds * 1000);
  };

  /** 用户取消自动连播 */
  const cancelCountdown = (): void => {
    if (!countdownActive) return;
    stopCountdown();
    props.onCancelAutoNext?.();
  };

  // ============================================
  // 面板显隐（data-select 属性机制）
  // ============================================

  /** 显示片尾面板（data-select="1"） */
  const showEndWrap = (): void => {
    endingWrapRef.value?.setAttribute("data-select", "1");
    startCountdown();
  };

  /** 关闭片尾面板（移除 data-select） */
  const closeEndWrap = (): void => {
    endingWrapRef.value?.removeAttribute("data-select");
    stopCountdown();
  };

  /** 显示分享面板（data-select="2"，仅 station） */
  const showShareWrap = (): void => {
    if (isEmbedded || isOgv) return;
    stopCountdown();
    endingWrapRef.value?.setAttribute("data-select", "2");
  };

  /** 关闭分享面板，回到片尾面板（data-select="1"） */
  const closeShareWrap = (): void => {
    endingWrapRef.value?.setAttribute("data-select", "1");
    startCountdown();
  };

  // ============================================
  // 渲染：推荐卡片（两场景共用）
  // ============================================

  /**
   * 渲染单张推荐卡片
   * @param item - 推荐数据
   * @param index - 下标（第 0 张承担自动连播倒计时）
   */
  const renderRelatedCard = (
    item: EndingRelatedItem,
    index: number,
  ): VNode => {
    // ===== embedded：5×2 网格卡片（poster + title） =====
    if (isEmbedded) {
      const cardContent: VNode[] = [
        h(
          "div",
          { class: "nova-player-relation-context-poster" },
          item.pic
            ? h("img", {
                src: item.pic,
                alt: item.title,
              })
            : null,
          formatDuration(item.duration)
            ? h(
                "div",
                { class: "nova-player-relation-context-poster-duration" },
                formatDuration(item.duration),
              )
            : null,
        ),
        h("div", { class: "nova-player-relation-context-title" }, item.title),
      ];
      const handleEmbeddedClick = (): void => {
        props.onRelatedClick?.(item);
      };
      return item.url
        ? h(
            "a",
            {
              class: "nova-player-relation-context-item",
              href: item.url,
              target: "_blank",
              rel: "noopener noreferrer",
              onClick: (event: MouseEvent) => {
                if (props.onRelatedClick) event.preventDefault();
                handleEmbeddedClick();
              },
            },
            ...cardContent,
          )
        : h(
            "div",
            {
              class: "nova-player-relation-context-item",
              role: "button",
              onClick: handleEmbeddedClick,
            },
            ...cardContent,
          );
    }

    /** 是否第一张卡（station 倒计时载体） */
    const isCountdownHost = !isEmbedded && index === 0;
    /** 卡片点击：优先走外部回调，未提供时由 <a> 自身跳转 */
    const handleClick = (): void => {
      props.onRelatedClick?.(item);
    };
    /** 卡片内容 */
    const content: VNode[] = [
      h("div", {
        class: "nova-player-ending-related-item-img",
        style: item.pic
          ? { backgroundImage: `url("${item.pic}")` }
          : undefined,
      }),
      h(
        "div",
        { class: "nova-player-ending-related-item-cover" },
        formatDuration(item.duration)
          ? h(
              "div",
              { class: "nova-player-ending-related-item-duration" },
              formatDuration(item.duration),
            )
          : null,
        h(
          "div",
          { class: "nova-player-ending-related-item-title" },
          item.title,
        ),
        h("div", { class: "nova-player-ending-related-item-watchlater" }),
        isCountdownHost
          ? h(
              "div",
              {
                class: "nova-player-ending-related-item-cancel",
                onClick: (event: MouseEvent) => {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelCountdown();
                },
              },
              t("player.ui.ending.cancel_auto_next"),
            )
          : null,
        isCountdownHost
          ? h(
              "div",
              { class: "nova-player-ending-related-item-countdown" },
              h(LottieIcon, {
                name: "ending-countdown",
                animationData: endingCountdownAnimationData,
                autoplay: false,
                loop: false,
                ref: "countdownRef",
                onReady: () => {
                  if (countdownActive) countdownRef.value?.play();
                },
              }),
            )
          : null,
      ),
    ];

    /** 有跳转地址时用 <a>，否则用 div 承载点击回调 */
    return item.url
      ? h(
          "a",
          {
            class: isCountdownHost
              ? "nova-player-ending-related-item state-countdown-host"
              : "nova-player-ending-related-item",
            href: item.url,
            target: "_blank",
            rel: "noopener noreferrer",
            onClick: (event: MouseEvent) => {
              if (props.onRelatedClick) event.preventDefault();
              handleClick();
            },
          },
          ...content,
        )
      : h(
          "div",
          {
            class: isCountdownHost
              ? "nova-player-ending-related-item state-countdown-host"
              : "nova-player-ending-related-item",
            role: "button",
            onClick: handleClick,
          },
          ...content,
        );
  };

  // ============================================
  // 渲染：station 片尾
  // ============================================

  /** 渲染站内片尾内容面板 */
  const renderStationEnding = (): VNode =>
    h(
      "div",
      { class: "nova-player-ending" },
      h(
        "div",
        {
          class: "nova-player-ending-content",
          "screen-mode": "second-screen",
        },
        h(
          "div",
          { class: "nova-player-ending-functions" },
          // UP 主头像
          h(
            "div",
            {
              class: "nova-player-ending-functions-avatar",
              "data-action": "upinfo",
            },
            h(
              "a",
              { href: props.upInfo?.url ?? undefined },
              props.upInfo?.face
                ? h("img", {
                    src: props.upInfo.face,
                    alt: props.upInfo.name ?? "",
                  })
                : null,
            ),
          ),
          // UP 主信息
          h(
            "div",
            {
              class: "nova-player-ending-functions-upinfo",
              "data-action": "upinfo",
            },
            h(
              "div",
              { class: "nova-player-ending-functions-name" },
              h(
                "a",
                { href: props.upInfo?.url ?? undefined },
                props.upInfo?.name ?? "",
              ),
            ),
            h(
              "div",
              { class: "nova-player-ending-functions-buttons" },
              h(
                "div",
                {
                  class: "nova-player-ending-functions-electric state-little",
                  onClick: props.onElectric,
                },
                h(
                  "span",
                  { class: "common-svg-icon" },
                  SimpleIcon(ADD_ICON),
                ),
                t("player.ui.ending.electric"),
              ),
              h(
                "div",
                {
                  class: [
                    "nova-player-ending-functions-follow",
                    { "state-disabled": Boolean(props.upInfo?.followed) },
                  ],
                  "data-action": "follow",
                  onClick: props.onFollow,
                },
                h(
                  "span",
                  { class: "common-svg-icon" },
                  SimpleIcon(ADD_ICON),
                ),
                props.upInfo?.followed
                  ? t("player.ui.ending.following")
                  : t("player.ui.ending.follow"),
              ),
            ),
          ),
          // 功能按钮
          h(
            "div",
            { class: "nova-player-ending-functions-common" },
            h(
              "div",
              {
                class: "nova-player-ending-functions-btn",
                "data-action": "restart",
                onClick: props.onRestart,
              },
              h("span", { class: "common-svg-icon" }, SimpleIcon(RESTART_ICON)),
              t("player.ui.ending.replay"),
            ),
            h(
              "div",
              { class: "nova-player-ending-functions-pagecallback" },
              h("div", {
                class: "nova-player-ending-functions-btn",
                "data-action": "grade",
              }),
              h(
                "div",
                {
                  class: "nova-player-ending-functions-btn state-active",
                  "data-action": "like",
                  onClick: props.onLike,
                },
                h("span", { class: "common-svg-icon" }, SimpleIcon(LIKE_ICON)),
                t("player.ui.ending.like"),
              ),
              h(
                "div",
                {
                  class: "nova-player-ending-functions-btn",
                  "data-action": "coin",
                  onClick: props.onCoin,
                },
                h("span", { class: "common-svg-icon" }, SimpleIcon(COIN_ICON)),
                t("player.ui.ending.coin"),
              ),
              h(
                "div",
                {
                  class: "nova-player-ending-functions-btn",
                  "data-action": "collect",
                  onClick: props.onCollect,
                },
                h(
                  "span",
                  { class: "common-svg-icon" },
                  SimpleIcon(COLLECT_ICON),
                ),
                t("player.ui.ending.collect"),
              ),
              h(
                "div",
                {
                  class: "nova-player-ending-functions-btn",
                  "data-action": "share",
                  onClick: () => {
                    props.onShare?.();
                    showShareWrap();
                  },
                },
                h("span", { class: "common-svg-icon" }, SimpleIcon(SHARE_ICON)),
                t("player.ui.ending.share"),
              ),
            ),
          ),
        ),
        // 相关推荐列表（数据由外部注入；未提供时为空列表）
        h(
          "div",
          { class: "nova-player-ending-related" },
          h(
            "div",
            { class: "nova-player-ending-related-title" },
            t("player.ui.ending.related"),
          ),
          ...related.slice(0, 8).map(renderRelatedCard),
        ),
      ),
    );

  // ============================================
  // 渲染：embedded 片尾
  // ============================================

  /** 渲染外链嵌入场景的整页片尾 */
  const renderEmbeddedEnding = (): VNode =>
    h(
      "div",
      { class: "nova-player-embedded-ending-wrap-box" },
      // 顶部：标题 / UP / 操作
      h(
        "div",
        { class: "nova-player-embedded-ending-top-wrap" },
        h(
          "div",
          { class: "nova-player-embedded-ending-top-left" },
          h(
            "div",
            { class: "nova-player-top-left-title" },
            h(
              "span",
              { class: "nova-player-top-left-logo" },
              t("player.ui.ending.logo"),
            ),
            h(
              "span",
              { class: "nova-player-top-left-title-text" },
              props.title ?? "",
            ),
          ),
          props.upInfo?.name
            ? h(
                "div",
                { class: "nova-player-top-left-follow" },
                h(
                  "div",
                  { class: "nova-player-follow" },
                  h(
                    "span",
                    { class: "nova-player-follow-face" },
                    props.upInfo.face
                      ? h("img", {
                          src: props.upInfo.face,
                          alt: props.upInfo.name,
                        })
                      : null,
                  ),
                  h(
                    "span",
                    { class: "nova-player-follow-name" },
                    props.upInfo.name,
                  ),
                  h(
                    "span",
                    { class: "nova-player-follow-text" },
                    props.upInfo.followed
                      ? t("player.ui.ending.following")
                      : t("player.ui.ending.follow"),
                  ),
                ),
              )
            : null,
        ),
        h(
          "div",
          { class: "nova-player-top-buttons" },
          h(
            "div",
            {
              class:
                "nova-player-top-button nova-player-top-buttons-replay",
              role: "button",
              onClick: props.onRestart,
            },
            h(
              "span",
              { class: "nova-player-top-button-icon" },
              SimpleIcon(RESTART_ICON),
            ),
            h(
              "span",
              { class: "nova-player-top-button-text" },
              t("player.ui.ending.replay"),
            ),
          ),
          h(
            "div",
            {
              class: "nova-player-top-button nova-player-top-buttons-like",
              role: "button",
              onClick: props.onLike,
            },
            h(
              "span",
              { class: "nova-player-top-button-icon" },
              SimpleIcon(LIKE_ICON),
            ),
            h(
              "span",
              { class: "nova-player-top-button-text" },
              t("player.ui.ending.like"),
            ),
          ),
          h(
            "div",
            {
              class: "nova-player-top-button nova-player-top-buttons-share",
              role: "button",
              onClick: () => {
                props.onShare?.();
                showShareWrap();
              },
            },
            h(
              "span",
              { class: "nova-player-top-button-icon" },
              SimpleIcon(SHARE_ICON),
            ),
            h(
              "span",
              { class: "nova-player-top-button-text" },
              t("player.ui.ending.share"),
            ),
          ),
        ),
      ),
      // 相关推荐：5 列 × 2 行
      h(
        "div",
        { class: "nova-player-embedded-ending-relation-wrap" },
        h(
          "div",
          { class: "nova-player-embedded-ending-relation-context" },
          ...related.slice(0, 10).map(renderRelatedCard),
        ),
      ),
      // 底部：下载客户端 / 进入站内
      h(
        "div",
        { class: "nova-player-embedded-ending-button-group" },
        h(
          "div",
          {
            class: "nova-player-downlowd",
            role: "button",
            onClick: props.onDownloadApp,
          },
          StrokeIcon(DOWNLOAD_ICON),
          t("player.ui.ending.download_app"),
        ),
        h(
          "div",
          {
            class: "nova-player-enter",
            role: "button",
            onClick: props.onEnterSite,
          },
          StrokeIcon(ENTER_ICON),
          t("player.ui.ending.enter_site"),
        ),
      ),
    );

  // ============================================
  // 渲染：ogv（电视剧 / 番剧）整页片尾
  // ============================================

  /** 渲染 OGV 单张推荐卡片（112×148，首张承载倒计时） */
  const renderOgvCard = (
    item: EndingRelatedItem,
    index: number,
  ): VNode => {
    const isCountdownHost = index === 0;
    const children: VNode[] = [
      h(
        "div",
        { class: "nova-ogv-ending-recommend-cover" },
        item.pic ? h("img", { src: item.pic, alt: item.title }) : null,
        h("div", { class: "nova-ogv-ending-recommend-mask" }),
      ),
      h("div", { class: "nova-ogv-ending-recommend-title" }, item.title),
    ];

    if (isCountdownHost) {
      children.push(
        h(
          "div",
          {
            class: "nova-ogv-ending-cancel",
            onClick: (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              cancelCountdown();
            },
          },
          t("player.ui.ending.cancel_auto_next"),
        ),
        h(
          "div",
          { class: "nova-ogv-ending-countdown" },
          h(
            "svg",
            { viewBox: "0 0 51 51" },
            h("circle", {
              class: "nova-ogv-ending-countdown-bg",
              cx: 25.5,
              cy: 25.5,
              r: 23,
            }),
            h("circle", {
              class: "nova-ogv-ending-countdown-progress",
              cx: 25.5,
              cy: 25.5,
              r: 23,
              pathLength: 1,
              style: { animationDuration: `${countdownSeconds}s` },
            }),
            h("path", {
              class: "nova-ogv-ending-play-icon",
              d: "M21 17.5 34 25.5 21 33.5z",
            }),
          ),
        ),
      );
    }

    const cls = isCountdownHost
      ? "nova-ogv-ending-recommend-item state-countdown-host"
      : "nova-ogv-ending-recommend-item";

    return item.url
      ? h(
          "a",
          {
            class: cls,
            href: item.url,
            target: "_blank",
            rel: "noopener noreferrer",
            onClick: (event: MouseEvent) => {
              if (props.onRelatedClick) event.preventDefault();
              props.onRelatedClick?.(item);
            },
          },
          ...children,
        )
      : h(
          "div",
          {
            class: cls,
            role: "button",
            onClick: () => props.onRelatedClick?.(item),
          },
          ...children,
        );
  };

  /** 渲染 OGV 整页片尾（对应 B 站 endpage_* 结构） */
  const renderOgvEnding = (): VNode =>
    h(
      "div",
      { class: "nova-ogv-ending" },
      h(
        "div",
        { class: "nova-ogv-ending-content" },
        // 头部：封面 / 标题 / 追剧 + 操作按钮
        h(
          "div",
          { class: "nova-ogv-ending-header" },
          h(
            "div",
            { class: "nova-ogv-ending-ep-info" },
            h(
              "div",
              { class: "nova-ogv-ending-cover" },
              props.cover ? h("img", { src: props.cover, alt: props.title }) : null,
            ),
            h(
              "div",
              { class: "nova-ogv-ending-ep-right" },
              h(
                "div",
                { class: "nova-ogv-ending-title" },
                props.title ?? "",
              ),
              h(
                "div",
                {
                  class: [
                    "nova-ogv-ending-follow",
                    { "state-followed": Boolean(props.followed) },
                  ],
                  role: "button",
                  onClick: props.onFollow,
                },
                h(
                  "span",
                  { class: "nova-ogv-ending-follow-icon" },
                  h(
                    "svg",
                    { viewBox: "0 -3 16 16" },
                    h("path", { d: HEART_ICON }),
                  ),
                ),
                t(
                  props.followed
                    ? "player.ui.ending.watching_series"
                    : "player.ui.ending.watch_series",
                ),
              ),
            ),
          ),
          h(
            "div",
            { class: "nova-ogv-ending-btn-group" },
            h(
              "div",
              {
                class: "nova-ogv-ending-btn nova-ogv-ending-restart",
                role: "button",
                onClick: props.onRestart,
              },
              h("span", { class: "nova-ogv-ending-btn-icon" }, SimpleIcon(RESTART_ICON)),
              h(
                "span",
                { class: "nova-ogv-ending-btn-text" },
                t("player.ui.ending.replay"),
              ),
            ),
            h(
              "div",
              {
                class: "nova-ogv-ending-btn nova-ogv-ending-like",
                role: "button",
                onClick: props.onLike,
              },
              h("span", { class: "nova-ogv-ending-btn-icon" }, SimpleIcon(LIKE_ICON)),
              h(
                "span",
                { class: "nova-ogv-ending-btn-text" },
                t("player.ui.ending.like"),
              ),
            ),
            h(
              "div",
              {
                class: "nova-ogv-ending-btn nova-ogv-ending-coin",
                role: "button",
                onClick: props.onCoin,
              },
              h("span", { class: "nova-ogv-ending-btn-icon" }, SimpleIcon(COIN_ICON)),
              h(
                "span",
                { class: "nova-ogv-ending-btn-text" },
                t("player.ui.ending.coin"),
              ),
            ),
            h(
              "div",
              {
                class: "nova-ogv-ending-btn nova-ogv-ending-share",
                role: "button",
                onClick: props.onShare,
              },
              h("span", { class: "nova-ogv-ending-btn-icon" }, SimpleIcon(SHARE_ICON)),
              h(
                "span",
                { class: "nova-ogv-ending-btn-text" },
                t("player.ui.ending.share"),
              ),
            ),
          ),
        ),
        // 相关推荐
        h(
          "div",
          { class: "nova-ogv-ending-recommend" },
          h(
            "div",
            { class: "nova-ogv-ending-recommend-heading" },
            t("player.ui.ending.related"),
          ),
          h(
            "div",
            { class: "nova-ogv-ending-recommend-list" },
            ...related.slice(0, 10).map(renderOgvCard),
          ),
        ),
      ),
    );

  // ============================================
  // 渲染：station 分享面板
  // ============================================

  /** 渲染分享面板（分享地址无真实数据源，值为空） */
  const renderSharePanel = (): VNode =>
    h(
      "div",
      { class: "nova-player-video-share-box" },
      h(
        "div",
        { class: "nova-player-video-share-header" },
        h(
          "span",
          {
            class: "nova-player-video-share-close",
            onClick: () => {
              props.onCloseShare?.();
              closeShareWrap();
            },
          },
          h("span", { class: "common-svg-icon" }, SimpleIcon(CLOSE_ICON)),
        ),
      ),
      h(
        "div",
        { class: "nova-player-video-share-content" },
        h(
          "div",
          { class: "nova-player-video-share-left" },
          h(
            "div",
            { class: "nova-player-video-share-source" },
            h(
              "div",
              { class: "nova-player-video-share-btn weibo" },
              h("span", { class: "common-svg-icon" }),
            ),
            h(
              "div",
              { class: "nova-player-video-share-btn qq" },
              h("span", { class: "common-svg-icon" }),
            ),
          ),
          h(
            "div",
            { class: "nova-player-video-share-link" },
            h(
              "p",
              { class: "nova-player-video-share-link-label" },
              t("player.ui.ending.video_address"),
            ),
            h(
              "div",
              { class: "nova-player-video-share-link-content" },
              h("input", {
                class: "nova-player-video-share-link-input html",
                readOnly: true,
              }),
              h(
                "div",
                {
                  class:
                    "nova-player-video-share-link-copy html ui ui-button",
                  onClick: (event: MouseEvent) => {
                    if (event.currentTarget instanceof HTMLElement) {
                      const value =
                        event.currentTarget.getAttribute("value") ?? "";
                      if (navigator.clipboard) {
                        void navigator.clipboard.writeText(value);
                      }
                    }
                  },
                },
                h(
                  "div",
                  { class: "ui-area ui-button-blue" },
                  t("player.ui.ending.copy"),
                ),
              ),
            ),
          ),
          h(
            "div",
            { class: "nova-player-video-share-link" },
            h(
              "p",
              { class: "nova-player-video-share-link-label" },
              t("player.ui.ending.embed_code"),
            ),
            h(
              "div",
              { class: "nova-player-video-share-link-content" },
              h("input", {
                class: "nova-player-video-share-link-input iframe",
                readOnly: true,
              }),
              h(
                "div",
                {
                  class:
                    "nova-player-video-share-link-copy iframe ui ui-button",
                  onClick: (event: MouseEvent) => {
                    if (event.currentTarget instanceof HTMLElement) {
                      const value =
                        event.currentTarget.getAttribute("value") ?? "";
                      if (navigator.clipboard) {
                        void navigator.clipboard.writeText(value);
                      }
                    }
                  },
                },
                h(
                  "div",
                  { class: "ui-area ui-button-blue" },
                  t("player.ui.ending.copy"),
                ),
              ),
            ),
          ),
        ),
        h(
          "div",
          { class: "nova-player-video-share-right" },
          h(
            "div",
            { class: "nova-player-video-share-qrcode" },
            h("span", {}, t("player.ui.ending.share_wechat")),
            h(
              "span",
              { class: "nova-player-video-share-qrcode-img" },
              h("canvas", { width: 150, height: 150 }),
            ),
          ),
        ),
      ),
    );

  // ============================================
  // 生命周期
  // ============================================

  /** 组件挂载后，通过事件向外暴露面板显隐控制方法 */
  lifecycle.onMounted = (): void => {
    lifecycle.emit?.("endingMounted", {
      showEndWrap,
      closeEndWrap,
      showShareWrap,
      closeShareWrap,
      isCountdownActive: () => countdownActive,
    } satisfies EndingApi);
  };

  /** 组件销毁前清理倒计时定时器 */
  lifecycle.onBeforeDestroy = (): void => {
    stopCountdown();
  };

  // ============================================
  // 组件渲染
  // ============================================

  const rootClass = isEmbedded
    ? "nova-player-ending-wrap nova-player-embedded-ending-wrap"
    : isOgv
      ? "nova-player-ending-wrap nova-ogv-ending-wrap"
      : "nova-player-ending-wrap";

  return h(
    "div",
    { class: rootClass, ref: "endingWrapRef" },
    // station 使用模糊封面背景；embedded 使用纯色整页背景；
    // ogv 用剧集封面做背景（无封面时保持纯色）
    isEmbedded
      ? null
      : h("div", {
          class: "nova-player-ending-backdrop",
          style:
            isOgv && props.cover
              ? { backgroundImage: `url("${props.cover}")` }
              : undefined,
        }),
    h(
      "div",
      { class: "nova-player-ending-panel", "data-option": "1" },
      isEmbedded
        ? renderEmbeddedEnding()
        : isOgv
          ? renderOgvEnding()
          : renderStationEnding(),
    ),
    isEmbedded || isOgv
      ? null
      : h(
          "div",
          { class: "nova-player-share-panel", "data-option": "2" },
          renderSharePanel(),
        ),
  );
});
