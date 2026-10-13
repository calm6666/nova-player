/**
 * ============================================
 * 播放器错误面板组件 (ErrorSign)
 * ============================================
 * 视频加载 / 播放失败时覆盖整个播放器的错误提示面板
 * （.nova-player-error-sign，挂载于视频区域最后一个容器）。
 *
 * 结构与既有实现（Nova 播放器错误面板）对齐：
 * - message：主错误信息（未提供时回落到默认网络错误文案）
 * - details：错误码 / 展示 ID / 出错主机名（均为可选，无值时留空）
 * - local-network-tip：本地网络访问权限提示（网络类错误时显示）
 * - retry-btn：「刷新」按钮，点击后向 PlayerDocker 发出 retry 事件，
 *   由 VideoPlayer 落地为 reload()
 *
 * 显隐由 ErrorSignAPI 驱动：
 * PlayerDocker 订阅 PlayerEventEnum.ERROR → show()，
 * ERROR_RECOVERY / LOADED_METADATA（重新加载成功）→ hide()。
 */

import { h, defineComponent, useTemplateRef, t } from "@/core";
import type { ComponentLifecycle } from "@/types";
// 本地网络权限开启示意图（错误面板 local-network-tip 区域展示）
import errorSignImage from "@/assets/images/error-sign-image.png";

// ============================================
// 错误面板 Props 接口
// ============================================

/** 错误面板组件属性接口（骨架无 Props，预留扩展位） */
export interface ErrorSignProps {
  /** 预留：后续可支持自定义重试按钮文案等 */
}

// ============================================
// 错误信息类型
// ============================================

/** 错误面板展示信息（字段均可选，未提供时保留 / 清空对应文本） */
export interface ErrorSignInfo {
  /** 主错误信息（不传时回落到默认「网络状况异常，请刷新后重试」文案） */
  message?: string;
  /** 错误码（如 MediaError.code：1 解码失败 / 2 网络错误 / 3 解码不支持 / 4 源不支持） */
  code?: number | string;
  /** 展示 ID（视频 cid 等，供用户反馈问题时定位） */
  displayId?: string;
  /** 出错的主机名（从当前视频源 URL 提取，如 CDN 域名） */
  host?: string;
  /** 是否显示本地网络访问权限提示（默认不显示） */
  showLocalNetworkTip?: boolean;
}

// ============================================
// 错误面板 API（挂载后回传给 PlayerDocker）
// ============================================

/** 错误面板 API：show / hide 驱动面板显隐与内容填充 */
export interface ErrorSignAPI {
  /** 显示错误面板并填充错误信息 */
  show: (info?: ErrorSignInfo) => void;
  /** 隐藏错误面板 */
  hide: () => void;
}

// ============================================
// ErrorSign 组件
// ============================================

/**
 * ErrorSign 组件 - 播放器错误面板
 *
 * 显示 / 隐藏采用与既有实现一致的内联 display 切换
 * （默认 display:none，show 时置为 flex）；
 * 本地网络提示的显隐配合样式中的
 * :not([style*="display: none"]) 规则（移除内联隐藏即恢复 flex 布局）。
 */
export const ErrorSign = defineComponent<ErrorSignProps>(
  (_props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // DOM 引用
    // ============================================

    /** 错误面板根容器 DOM 引用 */
    const errorSignRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "errorSignRef",
    );

    /** 主错误信息 DOM 引用 */
    const messageRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "messageRef",
    );

    /** 错误码文本 DOM 引用 */
    const codeRef = useTemplateRef<HTMLDivElement>(lifecycle, "codeRef");

    /** 展示 ID 文本 DOM 引用 */
    const displayIdRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "displayIdRef",
    );

    /** 出错主机名文本 DOM 引用 */
    const hostRef = useTemplateRef<HTMLDivElement>(lifecycle, "hostRef");

    /** 本地网络权限提示容器 DOM 引用 */
    const localNetworkTipRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "localNetworkTipRef",
    );

    // ============================================
    // 对外 API
    // ============================================

    /**
     * 显示错误面板并填充错误信息
     *
     * @param info - 错误信息（可选；message 缺省时显示默认网络错误文案，
     *               其余字段缺省时清空对应文本）
     */
    const show = (info?: ErrorSignInfo): void => {
      const wrap = errorSignRef.value;
      if (!wrap) return;

      // 主错误信息：缺省回落到默认网络错误文案
      if (messageRef.value) {
        messageRef.value.textContent =
          info?.message ?? t("player.ui.error.networkErrorRefreshAndRetry");
      }

      // 错误码 / 展示 ID / 主机名：有值填入，无值清空
      if (codeRef.value) {
        codeRef.value.textContent =
          info?.code !== undefined && info?.code !== null
            ? `${t("player.ui.error.code")}: ${info.code}`
            : "";
      }
      if (displayIdRef.value) {
        displayIdRef.value.textContent = info?.displayId ?? "";
      }
      if (hostRef.value) {
        hostRef.value.textContent = info?.host ?? "";
      }

      // 本地网络权限提示：显示时移除内联隐藏（CSS :not 规则恢复 flex），
      // 隐藏时设置内联 display:none（优先级高于 :not 规则）
      if (localNetworkTipRef.value) {
        localNetworkTipRef.value.style.display = info?.showLocalNetworkTip
          ? ""
          : "none";
      }

      // 面板整体显示（覆盖整个播放器，z-index 高于控制栏）
      wrap.style.display = "flex";
    };

    /**
     * 隐藏错误面板
     */
    const hide = (): void => {
      const wrap = errorSignRef.value;
      if (!wrap) return;
      wrap.style.display = "none";
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    /** 组件挂载后对外暴露 show / hide API */
    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("errorSignMounted", { show, hide } satisfies ErrorSignAPI);
    };

    /** 组件销毁前无需额外清理（DOM 随组件销毁移除） */
    lifecycle.onBeforeDestroy = (): void => {
      // 引用自动释放
    };

    // ============================================
    // 主渲染函数
    // ============================================

    return h(
      "div",
      {
        class: "nova-player-error-sign",
        ref: "errorSignRef",
        // 初始隐藏，由 ERROR 事件驱动显示
        style: { display: "none" },
      },
      // 错误内容区：主信息 + 详细信息 + 本地网络权限提示
      h(
        "div",
        { class: "nova-player-error-sign-content" },
        // 主错误信息（默认文案，show 时按入参覆盖）
        h(
          "div",
          {
            class: "nova-player-error-sign-message",
            ref: "messageRef",
            "data-i18n": "networkErrorRefreshAndRetry",
          },
          t("player.ui.error.networkErrorRefreshAndRetry"),
        ),
        // 详细信息：错误码 / 展示 ID / 主机名
        h(
          "div",
          { class: "nova-player-error-sign-details" },
          h("div", {
            class: "nova-player-error-sign-code",
            ref: "codeRef",
          }),
          h("div", {
            class: "nova-player-error-sign-displayid",
            ref: "displayIdRef",
          }),
          h("div", {
            class: "nova-player-error-sign-host",
            ref: "hostRef",
          }),
        ),
        // 本地网络访问权限提示（默认隐藏，网络类错误时由 show 显示）
        h(
          "div",
          {
            class: "nova-player-error-sign-local-network-tip",
            ref: "localNetworkTipRef",
            style: { display: "none" },
          },
          h(
            "div",
            { class: "nova-player-error-sign-local-network-content" },
            h(
              "div",
              {
                class: "nova-player-error-sign-local-network-title",
                "data-i18n": "localNetworkPermissionWarning",
              },
              t("player.ui.error.localNetworkPermissionWarning"),
            ),
            h(
              "div",
              { class: "nova-player-error-sign-local-network-steps" },
              h(
                "p",
                {
                  "data-i18n": "localNetworkPermissionStepAllowAccess",
                },
                t("player.ui.error.localNetworkPermissionStepAllowAccess"),
              ),
              h(
                "p",
                {
                  "data-i18n": "localNetworkPermissionStepBrowserSettings",
                },
                t("player.ui.error.localNetworkPermissionStepBrowserSettings"),
              ),
            ),
          ),
          // 本地网络权限开启示意图
          h(
            "div",
            { class: "nova-player-error-sign-local-network-image" },
            h("img", {
              src: errorSignImage,
              alt: t("player.ui.error.localNetworkPermissionGuide"),
              "data-i18n-attr": "alt:localNetworkPermissionGuide",
            }),
          ),
        ),
      ),
      // 重试按钮：点击发出 retry 事件（由 PlayerDocker 上抛给 VideoPlayer 执行 reload）
      h(
        "button",
        {
          class: "nova-player-error-sign-retry-btn",
          "data-i18n": "refresh",
          onClick: () => {
            lifecycle.emit?.("retry");
          },
        },
        t("player.ui.error.refresh"),
      ),
    );
  },
);

export default ErrorSign;
