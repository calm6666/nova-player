/**
 * ============================================
 * 播放器状态组件
 * ============================================
 */

import { h, defineComponent, signal, t, Show } from "@/core";
import type { ComponentLifecycle } from "@/types";

/**
 * 状态组件 Props 接口
 */
export interface StateProps {
  /** 缓冲速度（字节/秒） */
  bufferSpeed?: number;
  /** 是否显示缓冲状态 */
  buffering?: boolean;
}

/**
 * 播放器状态组件
 */
export const State = defineComponent<StateProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 响应式信号（驱动缓冲图标/文本/速度的显隐与内容自动更新）
    // ============================================

    /**
     * 缓冲速度信号（字节/秒）
     * 替代旧的 lastValidSpeed + bufferSpeedRef.textContent/style.display 命令式操作
     * 信号在 _reactiveText 与 Show when getter 中被读取，编译期/mount 时注册 effect，
     * 信号变化时自动更新 Text 节点与 Show 分支切换
     */
    const bufferSpeedSignal = signal<number>(props.bufferSpeed ?? 0);

    /**
     * 缓冲态信号
     * 替代旧的 bufferIconRef.style.display / bufferTextRef.style.display 命令式操作
     * 信号在 Show when 中被读取，mount 时注册 effect，信号变化时自动 mount/destroy 子节点
     */
    const bufferingSignal = signal<boolean>(props.buffering ?? false);
    // ============================================
    // 工具函数
    // ============================================

    /**
     * 将缓冲速度格式化为可读字符串（按量级自适应 KB/S 与 MB/S）
     *
     * 单位说明：入参为「字节/秒」（与 StreamStats.downloadSpeed 的单位一致），
     * 1024 进制下除以 1024 得到的是 KB/S，除以 1024² 才是 MB/S。
     * @param speed - 缓冲速度（字节/秒）
     * @returns 格式化后的速度字符串；无有效数据（非正数 / NaN）时返回空串
     */
    const formatBufferSpeed = (speed: number): string => {
      if (!Number.isFinite(speed) || speed <= 0) return "";
      const kb = speed / 1024;
      // 1MB/S（1024KB/S）以下按 KB/S 显示，避免出现「0.0MB/S」这类无信息量的文本
      return kb < 1024
        ? `${kb.toFixed(1)}KB/S`
        : `${(kb / 1024).toFixed(1)}MB/S`;
    };

    // ============================================
    // 对外 API（更新信号，由响应式系统自动驱动 DOM 更新）
    // ============================================

    /**
     * 更新缓冲速度显示文本
     * @param speed - 缓冲速度（字节/秒）；无效（0 / NaN / 负数）时由 Show 隐藏速度文本
     */
    const updateBufferSpeed = (speed: number): void => {
      bufferSpeedSignal.value = speed;
    };

    /**
     * 显示缓冲状态图标和文本（信号变化后 Show 自动 mount 子节点）
     */
    const showBuffering = (): void => {
      bufferingSignal.value = true;
    };

    /**
     * 隐藏缓冲状态图标和文本（信号变化后 Show 自动 destroy 子节点）
     */
    const hideBuffering = (): void => {
      bufferingSignal.value = false;
    };

    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("stateMounted", {
        updateBufferSpeed,
        showBuffering,
        hideBuffering,
      });
    };

    lifecycle.onBeforeDestroy = (): void => {
      // 组件销毁时引用自动释放
    };

    // ============================================
    // 主渲染函数
    // ============================================

    return h(
      "div",
      { class: "nova-player-state-wrap" },
      h("div", { class: "nova-player-state-play" }),
      // 缓冲图标与文本：由 bufferingSignal 控制 mount/destroy
      // 替代旧的 bufferIconRef.style.display / bufferTextRef.style.display 命令式操作
      h(
        Show,
        { when: bufferingSignal },
        h("div", { class: "nova-player-state-buff-icon" }),
        h(
          "div",
          { class: "nova-player-state-buff-text" },
          h(
            "span",
            { class: "nova-player-state-buff-title" },
            t("player.ui.state.buffering"),
          ),
          // 速度文本：仅在缓冲态且有有效速度时显示
          // 外层 Show 由 bufferingSignal 控制；内层 Show 由速度有效性控制
          h(
            Show,
            {
              when: () =>
                Number.isFinite(bufferSpeedSignal.value) &&
                bufferSpeedSignal.value > 0,
            },
            h(
              "span",
              { class: "nova-player-state-buff-speed" },
              // 零参箭头函数 = 显式响应式 getter 协议（与 Solid 的 {() => expr} 一致）：
              // 编译器包装为 _reactiveText(() => formatBufferSpeed(...))，mount 建 Text 节点 + effect，
              // bufferSpeedSignal 变化时自动更新 textContent
              () => formatBufferSpeed(bufferSpeedSignal.value),
            ),
          ),
        ),
      ),
    );
  },
);
