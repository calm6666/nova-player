/**
 * ============================================
 * 顶部栏组件
 * ============================================
 */

import { h, defineComponent, useTemplateRef, t, Fragment, rafTimeout, cancelRaf, type AnimationFrameID } from "@lumina/nova";
import type { ComponentLifecycle, VNode } from "@lumina/nova";


import { Plus, Issue } from "@lumina/nova";
/** 外链顶部操作图标（B 站 external 样式） */
const TOP_LIKE_PATH =
  "M20.319 7.75h-4.543c.223-.484.457-1.093.545-1.683.064-.426.07-.948.019-1.445-.05-.485-.163-1.027-.387-1.452-.476-.901-1.13-1.534-1.917-1.688-.837-.163-1.558.263-1.99.916-.36.546-.501 1.001-.63 1.416l-.004.014c-.123.399-.244.791-.556 1.344-.513.909-.932 1.38-1.495 1.873-.29.255-.588.427-.861.538v13.642a108.372 108.372 0 0 0 8.127-.118c1.28-.067 2.504-.713 3.173-1.885.632-1.109 1.44-2.786 1.929-4.792.457-1.88.647-3.407.724-4.445.096-1.278-.943-2.235-2.134-2.235ZM7 21.184V7.75H5.302c-1.543 0-2.914 1.1-3.09 2.698A35.171 35.171 0 0 0 2 14.252c0 1.587.117 3.06.24 4.16.167 1.519 1.42 2.628 2.913 2.698.532.026 1.156.052 1.847.074Z";
const TOP_SHARE_PATH =
  "M10.25 3.827c0-1.264 1.467-1.961 2.447-1.163l8.574 6.978c.86.7.86 2.015 0 2.715l-8.574 6.978c-.98.798-2.447.1-2.447-1.163v-3.298c-.83.008-1.763.17-2.71.627-1.213.587-2.503 1.686-3.646 3.69-.29.507-.843.636-1.264.527-.43-.111-.867-.513-.827-1.13.283-4.443 1.685-7.268 3.511-9.025 1.58-1.52 3.412-2.18 4.936-2.447V3.827Z";
const TOP_COMMENT_PATH =
  "M12 2C6.477 2 2 6.03 2 11c0 2.55 1.16 4.86 3.03 6.52-.13 1.12-.62 2.55-1.68 3.48-.23.2-.08.58.23.55 2.16-.2 3.77-1.08 4.8-1.83.85.18 1.74.28 2.62.28 5.52 0 10-4.03 10-9S17.52 2 12 2zm-5 7h10v2H7V9zm0 4h7v2H7v-2z";
const TOP_MORE_PATH =
  "M12 6.5a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5zm0 7.25a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5zm0 7.25a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5z";

/** 外链顶部图标 */
const TopIcon = (path: string): VNode =>
  h(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", fill: "none" },
    h("path", { d: path, fill: "currentColor", "fill-rule": "evenodd" }),
  );

/**
 * 顶栏提示信息（与既有实现的 Tooltip 结构一致）
 */
export interface TopTooltip {
  /** 触发提示的 DOM 元素 */
  element: HTMLElement | null;
  /** 提示名称 */
  name: string;
  /** 提示的数据属性名（对应 Tooltips 提示项的 name） */
  dataName: string;
}

/** 电视剧追剧心形图标 */
const TOP_TV_HEART_PATH =
  "M8 14c-.1 0-.25-.05-.35-.1-.45-.35-4.3-3.35-5.1-4.5-.9-1.2-1.05-1.85-1.05-3C1.5 4 3.25 2 5.45 2 6.4 2 7.3 2.35 8 3c.7-.65 1.6-1 2.55-1 2.2 0 3.95 2 3.95 4.4 0 1.1-.15 1.75-1.05 3-.8 1.1-4.7 4.15-5.1 4.5-.1.05-.25.1-.35.1z";

/**
 * 顶部栏组件 Props 接口
 */
export interface TopProps {
  /** 视频标题 */
  title?: string;
  /** 外链播放器形态：显示 bilibili logo / 点赞评论分享更多 */
  embedded?: boolean;
  /** UP 是否已关注 */
  followed?: boolean;
  /** UP 昵称 */
  upName?: string;
  /** 外链点赞数 */
  likeCount?: number;
  /** 外链评论数 */
  commentCount?: number;
  /** 点赞按钮回调 */
  onLikeClick?: () => void;
  /** 评论按钮回调 */
  onCommentClick?: () => void;
  /** 分享按钮回调 */
  onShareClick?: () => void;
  /** 更多按钮回调 */
  onMoreClick?: () => void;
  /** UP主头像 URL */
  avatar?: string;
  /** 是否显示顶部栏 */
  visible?: boolean;
  /** 电视剧 / 番剧 Top 形态 */
  tv?: boolean;
  /** 音乐模式 Top 形态 */
  music?: boolean;
  /** 音乐模式跑马灯文案 */
  musicTitle?: string;
  /** 点击 Top 音乐条打开音乐插件面板 */
  onMusicClick?: () => void;
  /** 插件挂载时的根容器（.nova-player-top-wrap） */
  host?: HTMLElement | null;
  /** 问题反馈点击回调 */
  onIssueClick?: () => void;
  /** 关注按钮点击回调 */
  onFollowClick?: () => void;
  /** 请求显示 tooltip（问题反馈图标悬停） */
  onShowTooltip?: (tooltip: TopTooltip) => void;
  /** 请求隐藏 tooltip */
  onHideTooltip?: (tooltip: TopTooltip) => void;
}

/**
 * 顶部栏组件
 */
export const Top = defineComponent<TopProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // DOM 引用
    // ============================================

    /** 根容器元素引用 */
    const topWrapRef = { value: props.host ?? null };

    /** 标题文本元素引用 */
    const titleRef = useTemplateRef<HTMLDivElement>(lifecycle, "titleRef");

    /** 头像图片元素引用 */
    const avatarRef = useTemplateRef<HTMLImageElement>(lifecycle, "avatarRef");

    /** 问题反馈图标元素引用 */
    const issueIconRef = useTemplateRef<HTMLSpanElement>(
      lifecycle,
      "issueIconRef",
    );

    // ============================================
    // 问题反馈图标的悬停提示（与既有实现一致）
    // ============================================

    /** 提示延迟显示的定时器 */
    let inTimer: AnimationFrameID | null = null;

    /** 反馈按钮提示信息（dataName 对应 Tooltips 的 feedback-btn 提示项） */
    const issueTooltip: TopTooltip = {
      element: null,
      name: "issue",
      dataName: "feedback-btn",
    };

    /** 图标悬停 300ms 后显示提示 */
    const handleIssueEnter = (): void => {
      cancelRaf(inTimer!);
      inTimer = rafTimeout(() => {
        props.onShowTooltip?.(issueTooltip);
      }, 300);
    };

    /** 移开图标立即隐藏提示 */
    const handleIssueLeave = (): void => {
      cancelRaf(inTimer!);
      props.onHideTooltip?.(issueTooltip);
    };

    // ============================================
    // 事件处理函数
    // ============================================

    /**
     * 处理问题反馈按钮点击
     */
    const handleIssueClick = (): void => {
      props.onIssueClick?.();
    };

    /**
     * 处理关注按钮点击
     */
    const handleFollowClick = (): void => {
      props.onFollowClick?.();
    };

    // ============================================
    // DOM 更新函数
    // ============================================

    /**
     * 设置视频标题文本
     * @param title - 标题内容
     */
    const setTitle = (title: string): void => {
      if (titleRef.value) {
        titleRef.value.textContent = title;
      }
    };

    /**
     * 设置UP主头像图片地址
     * @param avatar - 头像 URL
     */
    const setAvatar = (avatar: string): void => {
      if (avatarRef.value) {
        avatarRef.value.src = avatar;
      }
    };

    /**
     * 显示顶部栏
     */
    const show = (): void => {
      if (topWrapRef.value) {
        topWrapRef.value.style.display = "";
      }
    };

    /**
     * 隐藏顶部栏
     */
    const hide = (): void => {
      if (topWrapRef.value) {
        topWrapRef.value.style.display = "none";
      }
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    lifecycle.onMounted = (): void => {
      // 初始状态：根据 props 设置显示/隐藏
      if (props.visible === false) {
        hide();
      }


      // 悬停提示的目标元素（挂载后才有 DOM 引用）
      issueTooltip.element = issueIconRef.value;

      lifecycle.emit?.("topMounted", {
        setTitle,
        setAvatar,
        show,
        hide,
      });
    };

    lifecycle.onBeforeDestroy = (): void => {};

    // ============================================
    // 主渲染函数
    // ============================================

    if (props.music) {
      return h(
        Fragment,
        {},
        h("div", { class: "nova-player-top-mask", hidden: true }),
        h("div", { class: "nova-player-top-title" }),
        h("div", { class: "nova-player-top-follow" }),
        h(
          "div",
          { class: "nova-player-top-left" },
          h(
            "div",
            {
              class: "nova-player-top-left-title",
              style: { fontSize: "20px" },
            },
            props.title ?? "",
          ),
          h(
            "div",
            { class: "nova-player-top-left-follow" },
            h(
              "div",
              { class: "nova-player-follow", onClick: handleFollowClick },
              h("img", {
                class: "nova-player-follow-face",
                src:
                  props.avatar ??
                  "https://io.v.hblog.top/hfs/face/706353e46fe1c390d6d2cb72a704818a.jpg@240w_240h_1c_1s_!web-avatar-nav.webp",
              }),
              !props.followed
                ? h(
                    "span",
                    { class: "nova-player-follow-icon" },
                    h("span", { class: "common-svg-icon" }, Plus()),
                  )
                : null,
              h(
                "span",
                { class: "nova-player-follow-text" },
                props.followed
                  ? t("player.ui.ending.following")
                  : t("player.ui.top.follow"),
              ),
            ),
          ),
          h(
            "div",
            { class: "nova-player-top-left-music" },
            h(
              "div",
              {
                class: "nova-player-music",
                /** 点击 Top 音乐条打开音乐面板（面板默认关闭） */
                onClick: (): void => props.onMusicClick?.(),
              },
              h(
                "span",
                { class: "nova-player-music-icon" },
                h(
                  "span",
                  { class: "common-svg-icon" },
                  h(
                    "svg",
                    { fill: "none", viewBox: "0 0 13 14" },
                    h("path", {
                      fill: "#fff",
                      "fill-rule": "evenodd",
                      d: "M12.358.393a1.72 1.72 0 0 0-1.427-.359l-6.658 1.07A1.686 1.686 0 0 0 2.94 2.749v6.959a2.189 2.189 0 0 0-.734-.129C.987 9.58 0 10.57 0 11.79 0 13.012.987 14 2.205 14a2.207 2.207 0 0 0 2.203-2.195L4.41 3.98c0-.097.07-.183.14-.198l6.658-1.069a.26.26 0 0 1 .224.055c.037.03.1.098.1.21v4.888a2.189 2.189 0 0 0-.736-.128c-1.217 0-2.204.99-2.204 2.21s.987 2.21 2.204 2.21A2.207 2.207 0 0 0 13 9.963L13 1.745c0-.527-.234-1.02-.642-1.352Z",
                      "clip-rule": "evenodd",
                    }),
                  ),
                ),
              ),
              h(
                "div",
                { class: "nova-player-music-marquee" },
                h(
                  "div",
                  { class: "nova-player-music-marquee-root" },
                  h(
                    "span",
                    {
                      class: "nova-player-music-marquee-content",
                      style: { opacity: "1", animationPlayState: "paused" },
                    },
                    props.musicTitle ?? "发现《雨爱》",
                  ),
                ),
              ),
              h(
                "span",
                { class: "nova-player-music-arrow" },
                h(
                  "span",
                  { class: "common-svg-icon" },
                  h(
                    "svg",
                    { viewBox: "0 0 16 16" },
                    h("path", {
                      d: "m9.188 7.999-3.359 3.359a.75.75 0 1 0 1.061 1.061l3.889-3.889a.75.75 0 0 0 0-1.061L6.89 3.58a.75.75 0 1 0-1.061 1.061l3.359 3.358z",
                    }),
                  ),
                ),
              ),
            ),
          ),
          h("div", { class: "nova-player-top-left-panorama" }),
        ),
        h(
          "div",
          { class: "nova-player-top-issue" },
          h(
            "span",
            {
              class: "nova-player-top-issue-icon",
              ref: "issueIconRef",
              onMouseEnter: handleIssueEnter,
              onMouseLeave: handleIssueLeave,
              onClick: handleIssueClick,
            },
            Issue(),
          ),
        ),
      );
    }

    if (props.tv) {
      return h(
        Fragment,
        {},
        h("div", { class: "nova-player-top-mask" }),
        h(
          "div",
          { class: "nova-player-top-title" },
          h("div", { id: "player-title" }, props.title ?? ""),
        ),
        h(
          "div",
          { class: "nova-player-top-follow" },
          h(
            "div",
            {
              id: "player-follow",
              class: "video-header-follow",
              style: { display: "flex" },
              onClick: handleFollowClick,
            },
            h(
              "span",
              { class: "video-header-icon" },
              h(
                "svg",
                { viewBox: "0 -3 16 16" },
                h("path", { d: TOP_TV_HEART_PATH }),
              ),
            ),
            h(
              "span",
              {
                class: "video-header-follow-text",
                style: { marginLeft: "2px" },
              },
              props.followed
                ? t("player.ui.ending.watching_series")
                : t("player.ui.ending.watch_series"),
            ),
          ),
        ),
        h(
          "div",
          { class: "nova-player-top-left" },
          h("div", { class: "nova-player-top-left-title" }),
          h("div", { class: "nova-player-top-left-follow" }),
          h("div", { class: "nova-player-top-left-music" }),
          h("div", { class: "nova-player-top-left-panorama" }),
        ),
        h(
          "div",
          { class: "nova-player-top-issue" },
          h(
            "span",
            {
              class: "nova-player-top-issue-icon",
              ref: "issueIconRef",
              onMouseEnter: handleIssueEnter,
              onMouseLeave: handleIssueLeave,
              onClick: handleIssueClick,
            },
            Issue(),
          ),
        ),
      );
    }

    return h(
      Fragment,
      {},
      h("div", { class: "nova-player-top-mask", hidden: true }),
      h("div", { class: "nova-player-top-title" }),
      h("div", { class: "nova-player-top-follow" }),
      h(
        "div",
        { class: "nova-player-top-left" },
        h(
          "div",
          {
            class: "nova-player-top-left-title",
            style: { fontSize: "20px" },
            ref: "titleRef",
          },
          props.embedded
            ? h("span", { class: "nova-player-top-left-logo" }, "bilibili")
            : null,
          props.embedded
            ? h(
                "span",
                { class: "nova-player-top-left-title-text" },
                props.title ?? "",
              )
            : (props.title ?? ""),
        ),
        h(
          "div",
          { class: "nova-player-top-left-follow" },
          h(
            "div",
            { class: "nova-player-follow", onClick: handleFollowClick },
            h("img", {
              class: "nova-player-follow-face",
              src:
                props.avatar ??
                "https://io.v.hblog.top/hfs/face/706353e46fe1c390d6d2cb72a704818a.jpg@240w_240h_1c_1s_!web-avatar-nav.webp",
              ref: "avatarRef",
            }),
            props.embedded && props.upName
              ? h("span", { class: "nova-player-follow-name" }, props.upName)
              : null,
            !props.followed
              ? h(
                  "span",
                  { class: "nova-player-follow-icon" },
                  h("span", { class: "common-svg-icon" }, Plus()),
                )
              : null,
            h(
              "span",
              { class: "nova-player-follow-text" },
              props.followed
                ? t("player.ui.ending.following")
                : t("player.ui.top.follow"),
            ),
          ),
        ),
      ),
      props.embedded
        ? h(
            "div",
            { class: "nova-player-top-actions" },
            h(
              "div",
              {
                class: "nova-player-top-action",
                role: "button",
                onClick: props.onLikeClick,
              },
              h(
                "span",
                { class: "nova-player-top-action-icon" },
                TopIcon(TOP_LIKE_PATH),
              ),
              h(
                "span",
                { class: "nova-player-top-action-text" },
                String(props.likeCount ?? 0),
              ),
            ),
            h(
              "div",
              {
                class: "nova-player-top-action",
                role: "button",
                onClick: props.onCommentClick,
              },
              h(
                "span",
                { class: "nova-player-top-action-icon" },
                TopIcon(TOP_COMMENT_PATH),
              ),
              h(
                "span",
                { class: "nova-player-top-action-text" },
                String(props.commentCount ?? 0),
              ),
            ),
            h(
              "div",
              {
                class: "nova-player-top-action",
                role: "button",
                onClick: props.onShareClick,
              },
              h(
                "span",
                { class: "nova-player-top-action-icon" },
                TopIcon(TOP_SHARE_PATH),
              ),
              h(
                "span",
                { class: "nova-player-top-action-text" },
                t("player.ui.ending.share"),
              ),
            ),
            h(
              "div",
              {
                class: "nova-player-top-action",
                role: "button",
                onClick: props.onMoreClick,
              },
              h(
                "span",
                { class: "nova-player-top-action-icon" },
                TopIcon(TOP_MORE_PATH),
              ),
              h(
                "span",
                { class: "nova-player-top-action-text" },
                t("player.ui.embed.more"),
              ),
            ),
          )
        : h(
            "div",
            { class: "nova-player-top-issue" },
            h(
              "span",
              {
                class: "nova-player-top-issue-icon",
                ref: "issueIconRef",
                onMouseEnter: handleIssueEnter,
                onMouseLeave: handleIssueLeave,
                onClick: handleIssueClick,
              },
              Issue(),
            ),
          ),
    );
  },
);
