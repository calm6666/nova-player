/**
 * ============================================
 * 播放器问题反馈面板
 * ============================================
 * 结构与交互对齐 bpx 的 b-back 面板：
 * - 默认不显示，由 Top 的问题反馈图标打开；
 * - 面板只在首次打开时挂载（PlayerDocker.ensurePanel），之后复用；
 * - 反馈类型单选、联系方式校验、100 字描述上限、提交成功 / 失败页。
 *
 * 提交接口、外链打开均通过 props 注入，不在组件内写死请求。
 */

import {
  h,
  defineComponent,
  signal,
  Show,
  t,
  useTemplateRef,
} from "@lumina/framework/core";

/** 回执类型：0 表示成功，其它为业务失败码 */
export type FeedbackSubmitResult = number;

/** 提交数据 */
export interface FeedbackSubmitData {
  /** 反馈类型 id（300 / 301 / 302 ... / 307 其它） */
  tagId: number;
  /** 问题描述（仅 307 其它类型填写） */
  content: string;
  /** 联系方式：QQ 或邮箱，可空 */
  contact: string;
}

/** 反馈面板 Props */
export interface FeedbackPanelProps {
  /** 初始是否显示（默认隐藏） */
  visible?: boolean;
  /** 提交回调：返回 0 成功，其它为失败码；未提供时仅对外 emit 事件 */
  submit?: (data: FeedbackSubmitData) => Promise<FeedbackSubmitResult> | FeedbackSubmitResult;
  /** 外链打开方式（默认 window.open） */
  openWindow?: (url: string) => void;
  /** 面板关闭回调 */
  onClose?: () => void;
}

/** 对外暴露的控制 API */
export interface FeedbackPanelApi {
  /** 打开面板 */
  open: () => void;
  /** 关闭面板 */
  close: () => void;
}

interface FeedbackTag {
  value: number;
  key: string;
}

/** 反馈类型（与 bpx 面板一致，顺序也保持一致） */
const FEEDBACK_TAGS: FeedbackTag[] = [
  { value: 300, key: "player.ui.feedback.tag.playback_stuttering" },
  { value: 304, key: "player.ui.feedback.tag.floating_ad" },
  { value: 301, key: "player.ui.feedback.tag.progress_drag_failed" },
  { value: 305, key: "player.ui.feedback.tag.video_unplayable" },
  { value: 354, key: "player.ui.feedback.tag.campus_network" },
  { value: 302, key: "player.ui.feedback.tag.audio_video_async" },
  { value: 303, key: "player.ui.feedback.tag.danmaku_not_displaying" },
  { value: 311, key: "player.ui.feedback.tag.video_artifacts" },
  { value: 312, key: "player.ui.feedback.tag.quality_not_clear" },
  { value: 307, key: "player.ui.feedback.tag.other" },
];

const EMAIL_RE = /^[A-Za-z0-9\u4e00-\u9fa5]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;
const QQ_RE = /^[1-9]\d{4,11}$/;

const CloseIcon = (): ReturnType<typeof h> =>
  h(
    "svg",
    { viewBox: "0 0 16 16" },
    h("path", {
      d: "m8 6.939 3.182-3.182a.75.75 0 1 1 1.061 1.061L9.061 8l3.182 3.182a.75.75 0 1 1-1.061 1.061L8 9.061l-3.182 3.182a.75.75 0 1 1-1.061-1.061L6.939 8 3.757 4.818a.75.75 0 1 1 1.061-1.061L8 6.939z",
    }),
  );

export const FeedbackPanel = defineComponent<FeedbackPanelProps>(
  (props, lifecycle) => {
    /** 面板显隐（nova-player-panel-active 由响应式 class 同步） */
    const activeSignal = signal(Boolean(props.visible));
    /** 当前页：default / success / fail */
    const statusSignal = signal<"default" | "success" | "fail">("default");
    /** 选中的反馈类型 id，0 表示未选 */
    const tagSignal = signal(0);
    /** 其它类型的描述 / 联系方式（同时写入输入框，打开时清空） */
    const descSignal = signal("");
    const contactSignal = signal("");
    /** 错误提示 */
    const overrangeSignal = signal(false);
    const typeErrorSignal = signal(false);
    /** 提交失败码 */
    const failCodeSignal = signal("");
    /** 悬浮提示文案，空字符串表示不显示 */
    const tipSignal = signal("");

    const descInputRef = useTemplateRef<HTMLInputElement>(
      lifecycle,
      "feedbackDescInputRef",
    );
    const contactInputRef = useTemplateRef<HTMLInputElement>(
      lifecycle,
      "feedbackContactInputRef",
    );

    let tipTimer: ReturnType<typeof setTimeout> | null = null;

    const showTip = (text: string): void => {
      tipSignal.value = text;
      if (tipTimer !== null) clearTimeout(tipTimer);
      tipTimer = setTimeout(() => {
        tipSignal.value = "";
        tipTimer = null;
      }, 3000);
    };

    const reset = (): void => {
      statusSignal.value = "default";
      tagSignal.value = 0;
      descSignal.value = "";
      contactSignal.value = "";
      overrangeSignal.value = false;
      typeErrorSignal.value = false;
      failCodeSignal.value = "";
      tipSignal.value = "";
      if (tipTimer !== null) {
        clearTimeout(tipTimer);
        tipTimer = null;
      }
      if (descInputRef.value) descInputRef.value.value = "";
      if (contactInputRef.value) contactInputRef.value.value = "";
    };

    const open = (): void => {
      reset();
      activeSignal.value = true;
    };

    const hide = (): void => {
      activeSignal.value = false;
    };

    const close = (): void => {
      hide();
      props.onClose?.();
    };

    const selectTag = (tag: number): void => {
      if (tagSignal.value === tag) return;
      tagSignal.value = tag;
      if (tag !== 307) overrangeSignal.value = false;
    };

    const openExternal = (url: string): void => {
      if (props.openWindow) {
        props.openWindow(url);
      } else {
        window.open(url, "_blank", "noopener");
      }
    };

    const submit = async (): Promise<void> => {
      if (tagSignal.value === 0) {
        showTip(t("player.ui.feedback.tip.select_reason"));
        return;
      }
      const contact = contactSignal.value.trim();
      if (contact && !EMAIL_RE.test(contact) && !QQ_RE.test(contact)) {
        typeErrorSignal.value = true;
        return;
      }
      typeErrorSignal.value = false;
      const content = tagSignal.value === 307 ? descSignal.value.trim() : "";
      if (tagSignal.value === 307) {
        if (content.length === 0) {
          showTip(t("player.ui.feedback.tip.describe_required"));
          return;
        }
        if (content.length >= 100) return;
      }

      const payload: FeedbackSubmitData = {
        tagId: tagSignal.value,
        content,
        contact,
      };

      try {
        let result = 0;
        if (props.submit) {
          result = await props.submit(payload);
        } else {
          // 未注入提交实现时仅对外广播，视作成功，便于宿主自行接管
          lifecycle.emit?.("feedbackSubmit", payload);
        }
        if (result === 0) {
          statusSignal.value = "success";
        } else {
          failCodeSignal.value = String(result);
          statusSignal.value = "fail";
        }
      } catch {
        failCodeSignal.value = "";
        statusSignal.value = "fail";
      }
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("feedbackPanelMounted", { open, close });
    };

    lifecycle.onBeforeDestroy = (): void => {
      if (tipTimer !== null) {
        clearTimeout(tipTimer);
        tipTimer = null;
      }
    };

    const renderTabmenu = (): ReturnType<typeof h> =>
      h(
        "div",
        { class: "nova-player-feedback-tabmenu" },
        ...FEEDBACK_TAGS.map((item) =>
          h(
            "div",
            {
              class: [
                "nova-player-feedback-tabmenu-list",
                {
                  "nova-player-feedback-tabmenu-list-active":
                    tagSignal.value === item.value,
                },
              ],
              onClick: (): void => selectTag(item.value),
            },
            t(item.key),
          ),
        ),
      );

    const renderContact = (): ReturnType<typeof h> =>
      h(
        "div",
        { class: "nova-player-feedback-contact" },
        h(
          "span",
          { class: "nova-player-feedback-contact-tip" },
          t("player.ui.feedback.contact"),
        ),
        h("input", {
          class: "nova-player-feedback-contact-input",
          type: "text",
          placeholder: t("player.ui.feedback.contact_placeholder"),
          ref: "feedbackContactInputRef",
          onInput: (event: Event): void => {
            const target = event.target;
            if (target instanceof HTMLInputElement) {
              contactSignal.value = target.value;
              typeErrorSignal.value = false;
            }
          },
        }),
        h(Show, 
          { when: (): boolean => typeErrorSignal.value },
          h(
            "div",
            { class: "nova-player-feedback-type-error" },
            t("player.ui.feedback.invalid_contact"),
          ),
        ),
      );

    const renderVersionLinks = (): ReturnType<typeof h> =>
      h(
        "div",
        { class: "nova-player-feedback-version" },
        h(
          "a",
          {
            href: "//www.bilibili.com/blackboard/webplayer_history.html#html5",
            target: "_blank",
            onClick: (event: Event): void => {
              event.preventDefault();
              openExternal(
                "//www.bilibili.com/blackboard/webplayer_history.html#html5",
              );
            },
          },
          t("player.ui.feedback.version_history"),
        ),
        h(
          "a",
          {
            href: "//www.bilibili.com/blackboard/help.html",
            target: "_blank",
            onClick: (event: Event): void => {
              event.preventDefault();
              openExternal("//www.bilibili.com/blackboard/help.html");
            },
          },
          t("player.ui.feedback.self_help"),
        ),
        h(
          "a",
          {
            href: "//www.bilibili.com/blackboard/video-diagnostics.html",
            target: "_blank",
            onClick: (event: Event): void => {
              event.preventDefault();
              openExternal(
                "//www.bilibili.com/blackboard/video-diagnostics.html",
              );
            },
          },
          t("player.ui.feedback.speed_test"),
        ),
      );

    const renderDefaultPage = (): ReturnType<typeof h> =>
      h(
        "div",
        { class: "nova-player-feedback-content-default" },
        renderTabmenu(),
        h(Show, 
          { when: (): boolean => tagSignal.value === 307 },
          h(
            "div",
            { class: "nova-player-feedback-content-input" },
            h("input", {
              class: "nova-player-feedback-input",
              type: "text",
              placeholder: t("player.ui.feedback.desc_placeholder"),
              ref: "feedbackDescInputRef",
              onInput: (event: Event): void => {
                const target = event.target;
                if (target instanceof HTMLInputElement) {
                  descSignal.value = target.value;
                  overrangeSignal.value = target.value.length >= 100;
                }
              },
            }),
            h(Show, 
              { when: (): boolean => overrangeSignal.value },
              h(
                "div",
                { class: "nova-player-feedback-input-overrange" },
                t("player.ui.feedback.over_100"),
              ),
            ),
          ),
        ),
        renderContact(),
        h(Show, 
          { when: (): boolean => tagSignal.value !== 0 },
          h(
            "div",
            { class: "nova-player-feedback-submit-wrap" },
            h(
              "div",
              {
                class: "nova-player-feedback-submit",
                onClick: (): void => {
                  void submit();
                },
              },
              t("player.ui.feedback.confirm"),
            ),
          ),
        ),
        renderVersionLinks(),
      );

    const renderSuccessPage = (): ReturnType<typeof h> =>
      h(
        "div",
        { class: "nova-player-feedback-content-success" },
        h("div", { class: "nova-player-feedback-success-image" }),
        h(
          "div",
          { class: "nova-player-feedback-success-title" },
          t("player.ui.feedback.success_thanks"),
        ),
        h(
          "div",
          { class: "nova-player-feedback-tips-wrap" },
          h(
            "div",
            { class: "nova-player-feedback-tips" },
            `${t("player.ui.feedback.email")}: `,
            h(
              "a",
              { href: "mailto:feedback@bilibili.com" },
              "feedback@bilibili.com",
            ),
          ),
          h(
            "div",
            { class: "nova-player-feedback-tips" },
            `${t("player.ui.feedback.qq_group")}: 418984413`,
          ),
        ),
      );

    const renderFailPage = (): ReturnType<typeof h> =>
      h(
        "div",
        { class: "nova-player-feedback-content-fail" },
        h(
          "div",
          { class: "nova-player-feedback-fail-title" },
          h("span", {}, t("player.ui.feedback.fail_oops")),
          h(
            "span",
            { class: "nova-player-feedback-fail-code" },
            failCodeSignal.value,
          ),
        ),
        h("div", { class: "nova-player-feedback-fail-image" }),
        h(
          "div",
          { class: "nova-player-feedback-tips-wrap" },
          h(
            "div",
            { class: "nova-player-feedback-tips" },
            `${t("player.ui.feedback.email")}: `,
            h(
              "a",
              { href: "mailto:feedback@bilibili.com" },
              "feedback@bilibili.com",
            ),
          ),
          h(
            "div",
            { class: "nova-player-feedback-tips" },
            `${t("player.ui.feedback.qq_group")}: 418984413`,
          ),
        ),
        h(
          "div",
          {
            class: "nova-player-feedback-resubmit",
            onClick: (): void => {
              void submit();
            },
          },
          t("player.ui.feedback.resubmit"),
        ),
      );

    return h(
      "div",
      {
        class: [
          "nova-player-feedback-panel",
          {
            "nova-player-panel-active": activeSignal.value,
          },
        ],
      },
      h(
        "div",
        { class: "nova-player-feedback-title" },
        h(
          "span",
          { class: "nova-player-feedback-title-content" },
          t("player.ui.feedback.title"),
        ),
        h(
          "span",
          {
            class: "nova-player-feedback-close",
            onClick: close,
          },
          h("span", { class: "common-svg-icon" }, CloseIcon()),
        ),
      ),
      h(
        "div",
        { class: "nova-player-feedback-content" },
        h(Show, 
          { when: (): boolean => statusSignal.value === "default" },
          renderDefaultPage(),
        ),
        h(Show, 
          { when: (): boolean => statusSignal.value === "success" },
          renderSuccessPage(),
        ),
        h(Show, 
          { when: (): boolean => statusSignal.value === "fail" },
          renderFailPage(),
        ),
      ),
      h(
        Show,
        { when: (): boolean => tipSignal.value.length > 0 },
        h(
          "div",
          { class: "nova-player-feedback-tooltip" },
          tipSignal.value,
        ),
      ),
    );
  },
);
