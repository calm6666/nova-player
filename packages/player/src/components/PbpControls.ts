/**
 * ============================================
 * 高能进度条组件 (PbpControls)
 * ============================================
 * 独立的函数组件，拥有自己的生命周期。
 * 图钉两种状态：
 * - 未常驻：斜杠图钉，提示「打开《高能进度条》常驻」
 * - 已常驻：实心图钉，提示「关闭《高能进度条》常驻」
 * 两个图标与两条提示都常驻 DOM，靠根节点上的 nova-player-pbp-permanent 切换显隐。
 *
 * 响应式迁移：
 *   - setShow/setPermanent 的 classList.toggle 改为 signal + 响应式 class（数组+对象形式）
 *   - 保留命令式：SVG 路径绘制（setAttribute('d', ...)）、render() 重绘、
 *     setEnergy/setProgress/setDuration（性能关键的逐帧更新，调用 render 重绘曲线）
 */

import { h, defineComponent, useTemplateRef, t, signal } from "@/core";
import {
  buildEnergyAreaPath,
  ENERGY_VIEW_HEIGHT,
  ENERGY_VIEW_WIDTH,
} from "@/nova/utils/media/energyProgress";
import type { EnergyProgressData } from "@/nova/utils/media/energyProgress";

export interface PbpControlsProps {
  visible?: boolean;
  permanent?: boolean;
}

export type PbpControlsEvents = {
  /** 点击曲线区域（跳转到对应时间点），payload 为目标时间（秒） */
  pbpClick: { time: number };
  pbpPinClick: undefined;
  pbpControlsMounted: {
    setShow: (show: boolean) => void;
    setPermanent: (permanent: boolean) => void;
    setEnergy: (data: EnergyProgressData | null) => void;
    setProgress: (time: number) => void;
    setDuration: (duration: number) => void;
  };
};

/** 未常驻时的斜杠图钉图标 */
const PIN_ICON_OFF =
  "m85.333 224.853 54.614-54.186 713.386 713.386-54.186 54.614-253.014-253.014v253.014h-68.266v-256H256v-85.334L341.333 512v-31.147l-256-256M682.667 512 768 597.333v85.334h-7.68L341.333 263.68v-93.013h-42.666V85.333h426.666v85.334h-42.666V512Z";

/** 已常驻时的实心图钉图标 */
const PIN_ICON_ON =
  "M726.646 466.708H716.8l-66.954-311.139h17.723c31.508 0 57.108-25.6 57.108-57.107s-25.6-57.108-57.108-57.108H356.431c-31.508 0-57.108 25.6-57.108 57.108s25.6 57.107 57.108 57.107h17.723l-64.985 311.139h-9.846c-31.508 0-57.108 25.6-57.108 57.107s25.6 57.108 57.108 57.108h165.415V923.57c0 31.508 25.6 59.077 59.077 59.077s59.077-25.6 59.077-59.077V582.892h145.723c31.508 0 57.108-25.6 57.108-57.107s-27.57-59.077-59.077-59.077z";

export const PbpControls = defineComponent<PbpControlsProps, PbpControlsEvents>(
  (props, lifecycle) => {
    const pbpRef = useTemplateRef<HTMLDivElement>(lifecycle, "pbpRef");
    const curveRef = useTemplateRef<SVGPathElement>(lifecycle, "pbpCurveRef");
    const curveClipRef = useTemplateRef<SVGPathElement>(
      lifecycle,
      "pbpCurveClipRef",
    );
    const playedRef = useTemplateRef<SVGPathElement>(lifecycle, "pbpPlayedRef");
    const playedClipRef = useTemplateRef<SVGRectElement>(
      lifecycle,
      "pbpPlayedClipRef",
    );
    const cursorLineRef = useTemplateRef<SVGPathElement>(
      lifecycle,
      "pbpCursorLineRef",
    );

    /** 高能数据（未到达前为 null，此时不绘制曲线） */
    let energy: EnergyProgressData | null = null;

    /** 当前播放进度（秒） */
    let currentTime = 0;

    /** 视频总时长（秒） */
    let duration = 0;

    /**
     * 响应式信号：展开态
     * 替代旧的 pbpRef.value?.classList.toggle('show', show) 命令式操作
     * 信号在根节点 class 数组+对象形式中被读取，编译期提取到 __reactiveAttrs，
     * mount 时注册 effect，信号变化时自动 normalizeClass 重新应用 class
     */
    const showSignal = signal<boolean>(props.visible === true);

    /**
     * 响应式信号：常驻态（决定图钉图标与提示文字）
     */
    const permanentSignal = signal<boolean>(props.permanent === true);

    /** 重绘曲线与已播放裁切窗口（保留命令式：SVG 路径绘制，性能关键） */
    const render = (): void => {
      const barWidthPx = pbpRef.value?.clientWidth ?? 0;
      const d = energy
        ? buildEnergyAreaPath(energy.data, undefined, barWidthPx)
        : "";
      curveRef.value?.setAttribute("d", d);
      curveClipRef.value?.setAttribute("d", d);
      playedRef.value?.setAttribute("d", d);

      const total = duration > 0 ? duration : (energy?.duration ?? 0);
      const ratio =
        total > 0 ? Math.max(0, Math.min(1, currentTime / total)) : 0;
      const playedWidth = ratio * ENERGY_VIEW_WIDTH;
      playedClipRef.value?.setAttribute("width", String(playedWidth));

      // 当前位置指示线：跟随播放进度横坐标
      cursorLineRef.value?.setAttribute(
        "d",
        `M${playedWidth},0 V${ENERGY_VIEW_HEIGHT}`,
      );
    };

    /**
     * 设置高能进度条的展开态（响应式：更新信号，根节点 class effect 自动同步）
     * @param show - 是否展开
     */
    const setShow = (show: boolean): void => {
      showSignal.value = show;
    };

    /**
     * 设置常驻态（响应式：更新信号，根节点 class effect 自动同步，切换图钉图标与提示文字）
     * @param value - 是否常驻
     */
    const setPermanent = (value: boolean): void => {
      permanentSignal.value = value;
    };

    /**
     * 写入高能进度条数据
     * @param data - 高能数据；null 表示清除曲线
     */
    const setEnergy = (data: EnergyProgressData | null): void => {
      energy = data;
      if (data?.duration && duration <= 0) duration = data.duration;
      render();
    };

    /**
     * 更新播放进度
     * @param time - 当前播放时间（秒）
     */
    const setProgress = (time: number): void => {
      currentTime = time;
      render();
    };

    /**
     * 更新总时长
     * @param value - 视频总时长（秒）
     */
    const setDuration = (value: number): void => {
      duration = value;
      render();
    };

    const handlePbpClick = (event: MouseEvent): void => {
      const bar = pbpRef.value;
      if (!bar || duration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / rect.width),
      );
      const time = ratio * duration;
      lifecycle.emit?.("pbpClick", { time });
    };

    const handlePinClick = (event: MouseEvent): void => {
      event.stopPropagation();
      lifecycle.emit?.("pbpPinClick");
    };

    lifecycle.onMounted = (): void => {
      // setShow/setPermanent 已由信号 + onEffect 自动同步首帧 class，无需手动调用
      lifecycle.emit?.("pbpControlsMounted", {
        setShow,
        setPermanent,
        setEnergy,
        setProgress,
        setDuration,
      });
    };

    return h(
      "div",
      {
        // 响应式 class：编译期将含 signal.value 的数组提取到 __reactiveAttrs，
        // mount 时注册 effect，showSignal/permanentSignal 变化时自动 normalizeClass 重新应用
        class: [
          "nova-player-pbp",
          {
            show: showSignal.value,
            "nova-player-pbp-permanent": permanentSignal.value,
          },
        ],
        ref: "pbpRef",
        onClick: handlePbpClick,
      },
      h(
        "svg",
        {
          class: "nova-player-pbp-curve-svg",
          viewBox: `0 0 ${ENERGY_VIEW_WIDTH} ${ENERGY_VIEW_HEIGHT}`,
          preserveAspectRatio: "none",
          width: "100%",
          height: "100%",
          "aria-hidden": "true",
        },
        h(
          "defs",
          {},
          h(
            "clipPath",
            {
              id: "nova-player-pbp-curve-path",
              clipPathUnits: "userSpaceOnUse",
            },
            h("path", { d: "", ref: "pbpCurveClipRef" }),
          ),
          h(
            "clipPath",
            {
              id: "nova-player-pbp-played-path",
              clipPathUnits: "userSpaceOnUse",
            },
            h("rect", {
              x: "0",
              y: "0",
              width: "0",
              height: String(ENERGY_VIEW_HEIGHT),
              ref: "pbpPlayedClipRef",
            }),
          ),
        ),
        h("path", {
          class: "nova-player-pbp-curve",
          d: "",
          ref: "pbpCurveRef",
          "clip-path": "url(#nova-player-pbp-curve-path)",
        }),
        h("path", {
          class: "nova-player-pbp-played",
          d: "",
          ref: "pbpPlayedRef",
          "clip-path": "url(#nova-player-pbp-played-path)",
        }),
        h("path", {
          class: "nova-player-pbp-cursor-line",
          d: `M0,0 V${ENERGY_VIEW_HEIGHT}`,
          ref: "pbpCursorLineRef",
        }),
      ),
      h(
        "div",
        { class: "nova-player-pbp-pin", onClick: handlePinClick },
        h(
          "div",
          { class: "nova-player-pbp-pin-icon nova-player-pbp-pin-icon-off" },
          h(
            "svg",
            {
              xmlns: "http://www.w3.org/2000/svg",
              "data-pointer": "none",
              viewBox: "0 0 1024 1024",
            },
            h("path", { fill: "#fff", d: PIN_ICON_OFF }),
          ),
        ),
        h(
          "div",
          { class: "nova-player-pbp-pin-icon nova-player-pbp-pin-icon-on" },
          h(
            "svg",
            {
              xmlns: "http://www.w3.org/2000/svg",
              "data-pointer": "none",
              viewBox: "0 0 1024 1024",
            },
            h("path", { fill: "#fff", d: PIN_ICON_ON }),
          ),
        ),
        h(
          "span",
          { class: "nova-player-pbp-pin-tip nova-player-pbp-pin-tip-off" },
          t("player.ui.pbp.open_permanent"),
        ),
        h(
          "span",
          { class: "nova-player-pbp-pin-tip nova-player-pbp-pin-tip-on" },
          t("player.ui.pbp.close_permanent"),
        ),
      ),
    );
  },
);
