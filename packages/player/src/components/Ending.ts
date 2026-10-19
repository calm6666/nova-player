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
import endingElectricIcon from "../assets/images/ending-electric.png";

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
  /** 分享面板：视频地址 */
  shareUrl?: string;
  /** 分享面板：嵌入代码 */
  embedCode?: string;
  /** 分享面板：二维码图片（未提供时展示占位提示） */
  qrCodeUrl?: string;
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

/** ===== B 站片尾标准操作图标（精确取自 B 站 ending DOM） ===== */
/** 重播 */
const BILI_RESTART_PATH =
  "M14.158 6.212c-4.404 0-8.06 3.656-8.06 8.06s3.656 8.06 8.06 8.06c2.806 0 5.318-1.414 6.859-3.717.195-.392.708-.734 1.132-.734.765 0 1.413.594 1.413 1.413 0 .171-.033.307-.093.458a.605.605 0 0 0-.021.145l-.079.123c-1.981 3.096-5.382 5.026-9.096 5.026A10.728 10.728 0 0 1 3.5 14.273 10.73 10.73 0 0 1 14.273 3.5c2.591 0 5.021.919 6.921 2.532v-.549c0-.733.564-1.299 1.297-1.299a1.28 1.28 0 0 1 1.299 1.299v3.996a1.28 1.28 0 0 1-1.299 1.299h-3.996a1.278 1.278 0 0 1-1.297-1.299c0-.783.472-1.413 1.297-1.413h.787c-1.46-1.179-3.26-1.854-5.124-1.854z";
/** 好评（标准片尾） */
const BILI_LIKE_PATH =
  "M20.319 7.75h-4.543c.223-.484.457-1.093.545-1.683.064-.426.07-.948.019-1.445-.05-.485-.163-1.027-.387-1.452-.476-.901-1.13-1.534-1.917-1.688-.837-.163-1.558.263-1.99.916-.36.546-.501 1.001-.63 1.416l-.004.014c-.123.399-.244.791-.556 1.344-.513.909-.932 1.38-1.495 1.873-.29.255-.588.427-.861.538v13.642a108.372 108.372 0 0 0 8.127-.118c1.28-.067 2.504-.713 3.173-1.885.632-1.109 1.44-2.786 1.929-4.792.457-1.88.647-3.407.724-4.445.096-1.278-.943-2.235-2.134-2.235ZM7 21.184V7.75H5.302c-1.543 0-2.914 1.1-3.09 2.698A35.171 35.171 0 0 0 2 14.252c0 1.587.117 3.06.24 4.16.167 1.519 1.42 2.628 2.913 2.698.532.026 1.156.052 1.847.074Z";
/** 投币（标准片尾） */
const BILI_COIN_PATH =
  "M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2Zm3.25 4.75a.75.75 0 0 1 0 1.5h-2.5v1.29c1.117.125 2.062.539 2.761 1.253.849.867 1.239 2.077 1.239 3.457v.5a.75.75 0 0 1-1.5 0v-.5c0-1.105-.31-1.895-.81-2.407-.383-.39-.934-.678-1.69-.79V17a.75.75 0 0 1-1.5 0v-5.947c-.756.112-1.307.4-1.69.79-.5.512-.81 1.302-.81 2.407v.5a.75.75 0 0 1-1.5 0v-.5c0-1.38.39-2.59 1.239-3.457.7-.714 1.644-1.128 2.761-1.252V8.25h-2.5a.75.75 0 0 1 0-1.5h6.5Z";
/** 收藏（标准片尾） */
const BILI_COLLECT_PATH =
  "M10.43 2.735c.643-1.3 2.498-1.3 3.14 0l1.87 3.79c.182.37.534.625.941.685l4.183.607c1.436.209 2.009 1.973.97 2.985l-3.027 2.95a1.25 1.25 0 0 0-.36 1.107l.715 4.167c.246 1.43-1.255 2.52-2.539 1.844l-3.741-1.967a1.25 1.25 0 0 0-1.164 0L7.677 20.87c-1.284.675-2.784-.415-2.54-1.844l.715-4.167a1.25 1.25 0 0 0-.36-1.106l-3.026-2.95C1.427 9.79 2 8.025 3.436 7.816l4.183-.607c.407-.06.759-.315.941-.684l1.87-3.79Z";
/** 分享（标准片尾） */
const BILI_SHARE_PATH =
  "M10.25 3.827c0-1.264 1.467-1.961 2.447-1.163l8.574 6.978c.86.7.86 2.015 0 2.715l-8.574 6.978c-.98.798-2.447.1-2.447-1.163v-3.298c-.83.008-1.763.17-2.71.627-1.213.587-2.503 1.686-3.646 3.69-.29.507-.843.636-1.264.527-.43-.111-.867-.513-.827-1.13.283-4.443 1.685-7.268 3.511-9.025 1.58-1.52 3.412-2.18 4.936-2.447V3.827Z";
/** 好评（OGV 片尾） */
const OGV_LIKE_PATH =
  "M4.909 8.543v15.275h-1.78a2.944 2.944 0 0 1-2.947-2.94v-9.395c0-1.624 1.32-2.94 2.948-2.94h1.779zm8.64-8.114c1.282.62 2.128 2.183 2.128 4.272 0 1.25-.156 2.53-.468 3.842h5.655a2.955 2.955 0 0 1 2.868 3.662l-1.865 7.568a5.318 5.318 0 0 1-5.163 4.045H6.682V8.508l.132-.047c2.316-.894 3.634-3.072 3.957-6.64C10.9.396 12.256-.196 13.548.428z";
/** 投币（OGV 片尾） */
const OGV_COIN_PATH =
  "M12 .182C18.527.182 23.818 5.473 23.818 12A11.818 11.818 0 0 1 12 23.818C5.473 23.818.182 18.527.182 12 .182 5.473 5.473.182 12 .182zm3.658 6.753a.844.844 0 1 0 0-1.688H8.342a.844.844 0 0 0 0 1.688h2.814v1.44a5.335 5.335 0 0 0-5.065 5.313v1.126a.844.844 0 0 0 1.688 0v-1.126a3.647 3.647 0 0 1 3.377-3.624v7.879a.844.844 0 1 0 1.688 0v-7.879c1.9.141 3.37 1.72 3.377 3.624v1.126a.844.844 0 0 0 1.688 0v-1.126a5.335 5.335 0 0 0-5.065-5.312v-1.44z";
/** 分享（OGV 片尾） */
const OGV_SHARE_PATH =
  "M12.605 9.649V4.516c0-.837.667-1.516 1.488-1.516.349 0 .687.125.954.353l10.337 8.805a1.773 1.773 0 0 1 0 2.684l-10.337 8.805a1.469 1.469 0 0 1-2.096-.191 1.532 1.532 0 0 1-.346-.972v-4.729c-5.011 0-7.235 1.952-10.034 5.746-.095.13-.571.265-.571-.328C2 15.827 3.901 9.649 12.605 9.649z";

/** 生成 B 站片尾 SVG 图标 */
const BiliIcon = (
  viewBox: string,
  path: string,
  fill: string,
  fillRule?: "evenodd" | "nonzero",
): VNode =>
  h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", viewBox, fill: "none" },
    h("path", {
      d: path,
      fill,
      ...(fillRule ? { "fill-rule": fillRule } : {}),
    }),
  );

/** 标准片尾操作图标 */
const RestartIcon = (): VNode =>
  BiliIcon("0 0 28 28", BILI_RESTART_PATH, "#fff");
const LikeIcon = (): VNode =>
  BiliIcon("0 0 24 24", BILI_LIKE_PATH, "currentColor", "evenodd");
const CoinIcon = (): VNode =>
  BiliIcon("0 0 24 24", BILI_COIN_PATH, "currentColor", "evenodd");
const CollectIcon = (): VNode =>
  BiliIcon("0 0 24 24", BILI_COLLECT_PATH, "currentColor", "evenodd");
const ShareIcon = (): VNode =>
  BiliIcon("0 0 24 24", BILI_SHARE_PATH, "currentColor", "evenodd");
/** OGV 片尾操作图标 */
const OgvLikeIcon = (): VNode =>
  BiliIcon("0 0 24 24", OGV_LIKE_PATH, "currentColor");
const OgvCoinIcon = (): VNode =>
  BiliIcon("0 0 24 24", OGV_COIN_PATH, "currentColor", "nonzero");
const OgvShareIcon = (): VNode =>
  BiliIcon("0 0 24 24", OGV_SHARE_PATH, "currentColor");
/** 充电图标（B 站标准片尾使用 PNG 素材） */

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
                h("img", {
                  class: "nova-player-ending-functions-electric-icon",
                  src: endingElectricIcon,
                  alt: "",
                }),
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
              h("span", { class: "common-svg-icon" }, RestartIcon()),
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
                h("span", { class: "common-svg-icon" }, LikeIcon()),
                t("player.ui.ending.like"),
              ),
              h(
                "div",
                {
                  class: "nova-player-ending-functions-btn",
                  "data-action": "coin",
                  onClick: props.onCoin,
                },
                h("span", { class: "common-svg-icon" }, CoinIcon()),
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
                  CollectIcon(),
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
                h("span", { class: "common-svg-icon" }, ShareIcon()),
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
              RestartIcon(),
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
              LikeIcon(),
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
              ShareIcon(),
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
              h("span", { class: "nova-ogv-ending-btn-icon" }, RestartIcon()),
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
              h("span", { class: "nova-ogv-ending-btn-icon" }, OgvLikeIcon()),
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
              h("span", { class: "nova-ogv-ending-btn-icon" }, OgvCoinIcon()),
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
              h("span", { class: "nova-ogv-ending-btn-icon" }, OgvShareIcon()),
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
              h("span", { class: "nova-player-video-share-btn-text" }, "微博"),
            ),
            h(
              "div",
              { class: "nova-player-video-share-btn qq" },
              h("span", { class: "nova-player-video-share-btn-text" }, "QQ"),
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
                value: props.shareUrl ?? "",
              }),
              h(
                "div",
                {
                  class:
                    "nova-player-video-share-link-copy html ui ui-button",
                  onClick: (event: MouseEvent) => {
                    if (event.currentTarget instanceof HTMLElement) {
                      if (navigator.clipboard) {
                        void navigator.clipboard.writeText(
                          props.shareUrl ?? "",
                        );
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
                value: props.embedCode ?? "",
              }),
              h(
                "div",
                {
                  class:
                    "nova-player-video-share-link-copy iframe ui ui-button",
                  onClick: (event: MouseEvent) => {
                    if (event.currentTarget instanceof HTMLElement) {
                      if (navigator.clipboard) {
                        void navigator.clipboard.writeText(
                          props.embedCode ?? "",
                        );
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
            props.qrCodeUrl
              ? h(
                  "span",
                  { class: "nova-player-video-share-qrcode-img" },
                  h("img", {
                    src: props.qrCodeUrl,
                    alt: t("player.ui.ending.share_wechat"),
                  }),
                )
              : h(
                  "span",
                  {
                    class:
                      "nova-player-video-share-qrcode-img nova-player-video-share-qrcode-placeholder",
                  },
                  t("player.ui.ending.qr_placeholder"),
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
