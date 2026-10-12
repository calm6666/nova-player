/**
 * ============================================
 * 视频统计信息组件 (VideoInfo)
 * ============================================
 */

import {
  h,
  defineComponent,
  useContext,
  useReactiveState,
  useTemplateRef,
  signal,
  onEffect,
  For,
} from "@/core";
import type { Signal } from "@/core";
import type { ComponentLifecycle } from "@/types";
import type { VNode } from "@/types";
import type { TypedStateManager } from "@/core/state";
import {
  StateContext,
  PlayerStateKeyEnum,
  type PlayerStateMap,
} from "@/store/runtimeState";
import {
  generateBitrateChart,
  generateBufferChart,
  generateFPSChart,
} from "../utils/media/chart";
import { readNativeBitrate } from "../utils/media/monitor";
import { renderSvgMarkup } from "../utils/svgMarkup";
import type {
  BitrateDataPoint,
  BufferDataPoint,
  FrameRateDataPoint,
} from "../utils/media/types";

/**
 * 视频信息项接口
 * 描述单条视频统计信息的标题和数据
 */
export interface VideoInfoItem {
  /** 信息项标题 */
  title: string;
  /** 信息项数据内容 */
  data: string;
}

/**
 * 视频信息组件 Props 接口
 */
export interface VideoInfoProps {
  /** 视频源地址（用于解析视频 Host） */
  src?: string;
  /**
   * 原生流媒体播放器实例提供者（dash.js / hls.js / flv.js 实例）
   *
   * 由 PlayerDocker 注入（转发 VideoPlayer 持有的 StreamMiddleware 当前
   * 生效插件）；码率曲线优先从该实例读取当前选中清晰度的静态码率，
   * 原生播放（非流媒体模式）返回 null 时回退 webkitDecodedByteCount 差分。
   */
  getNativePlayer?: () => unknown;
  /** 信息项数组，未提供时使用默认信息项 */
  items?: VideoInfoItem[];
  /** 关闭面板的回调函数 */
  onClose?: () => void;
}

/**
 * 视频信息面板对外暴露的 API
 */
export interface VideoInfoApi {
  /** 打开面板 */
  open: () => void;
  /** 关闭面板 */
  close: () => void;
  /** 更新指定标题的信息项数据 */
  updateItem: (title: string, data: string) => void;
}

/** 刷新间隔（毫秒），Host 信息非响应式，仍需定时刷新；图表采样同频复用 */
const REFRESH_INTERVAL = 1000;

/** 曲线图最多保留的采样点数（1Hz 采样下即 60 秒窗口） */
const MAX_CHART_POINTS = 60;

/** 曲线图尺寸（px）：宽取面板内容区宽度，高与旧版媒体面板一致 */
const CHART_SIZE = { width: 280, height: 80 };

/**
 * 支持 Chrome 解码字节计数的 video 元素（webkitDecodedByteCount 非
 * W3C 标准属性，lib.dom 无声明，经类型谓词而非 as 断言收窄）
 */
interface DecodedBytesVideo extends HTMLVideoElement {
  /** 累计已解码视频字节数（Chrome 扩展），差分除以时间即估算码率 */
  webkitDecodedByteCount?: number;
}

/** 类型谓词：判断 video 是否支持解码字节计数 */
const hasDecodedBytes = (video: HTMLVideoElement): video is DecodedBytesVideo =>
  "webkitDecodedByteCount" in video;

/** 关闭图标（与既有实现的 Close 图标一致） */
const CloseIcon = (): VNode =>
  h(
    "svg",
    {
      viewBox: "0 0 1024 1024",
      version: "1.1",
      xmlns: "http://www.w3.org/2000/svg",
    },
    h("path", {
      d: "M512 444.16l297.088-297.088c17.088-17.152 46.208-15.872 64.96 2.88 18.752 18.752 20.032 47.872 2.88 64.96L579.904 512l297.024 297.088c17.152 17.088 15.872 46.208-2.88 64.96-18.752 18.752-47.872 20.032-64.96 2.88L512 579.904l-297.088 297.024c-17.088 17.152-46.208 15.872-64.96-2.88-18.752-18.752-20.032-47.872-2.88-64.96L444.096 512 147.072 214.912c-17.152-17.088-15.872-46.208 2.88-64.96 18.752-18.752 47.872-20.032 64.96-2.88L512 444.096z",
    }),
  );

/**
 * 默认信息项列表（标题与既有实现一致）
 */
const DEFAULT_INFO_ITEMS: VideoInfoItem[] = [
  {
    title: "媒体类型:",
    data: 'video/mp4;codecs="av01.0.00M.10.0.110.01.01.01.0",audio/mp4;codecs="mp4a.40.2"',
  },
  { title: "播放器类型:", data: "DashPlayer" },
  { title: "分辨率:", data: "1280 x 720@30.000" },
  { title: "视频码率:", data: "1223 Kbps" },
  { title: "音频码率:", data: "112 Kbps" },
  { title: "视频 Host:", data: "io.v.hblog.top" },
  { title: "音频 Host:", data: "io.v.hblog.top" },
  { title: "视频缓存速度:", data: "9900 Kbps" },
  { title: "音频缓冲速度:", data: "4507 Kbps" },
];

/**
 * 视频信息组件
 */
export const VideoInfo = defineComponent<VideoInfoProps>(
  (props, lifecycle: ComponentLifecycle) => {
    // ============================================
    // 状态管理器（通过 Context 获取）
    // ============================================

    /** 运行时状态管理器，用于读取分辨率 / 缓冲等实时数据 */
    const stateMgr = useContext<TypedStateManager<PlayerStateMap> | null>(
      StateContext,
    );

    // ============================================
    // 响应式状态 Signal（useReactiveState 返回 Signal，读取 .value 自动建立依赖）
    // 在 onEffect / _reactiveText 内读取 .value，signal 变化时自动更新
    // ============================================

    /** 面板可见性 Signal（驱动 nova-player-active 类） */
    const visibleSignal = signal<boolean>(false);

    /** 视频分辨率 Signal（驱动分辨率信息行文本） */
    const videoWidthSignal = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.VIDEO_WIDTH, lifecycle)
      : signal<unknown>(undefined);
    const videoHeightSignal = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.VIDEO_HEIGHT, lifecycle)
      : signal<unknown>(undefined);

    /** 缓冲进度 Signal（驱动缓存速度信息行文本） */
    const bufferedSignal = stateMgr
      ? useReactiveState(stateMgr, PlayerStateKeyEnum.BUFFERED, lifecycle)
      : signal<unknown>(undefined);

    /**
     * 信息项数据 Signal 映射
     * key = 信息项标题，value = 对应的 signal
     * updateItem 时写入 signal，_reactiveText 自动更新 Text 节点
     */
    const itemDataSignals = new Map<string, Signal<string>>();

    /**
     * 获取或创建指定标题的信息项数据 Signal
     * @param title - 信息项标题
     * @param initialData - 初始数据
     * @returns 该信息项的 data Signal
     */
    const getItemDataSignal = (title: string, initialData: string) => {
      let sig = itemDataSignals.get(title);
      if (!sig) {
        sig = signal<string>(initialData);
        itemDataSignals.set(title, sig);
      }
      return sig;
    };

    // ============================================
    // DOM 引用（仅保留响应式系统无法替代的部分）
    // ============================================

    /** 定时刷新计时器 ID（仅 Host 信息非响应式，需定时刷新） */
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    /** 实际渲染的信息项列表 */
    const infoItems: VideoInfoItem[] = props.items ?? DEFAULT_INFO_ITEMS;

    // ============================================
    // 数据更新（信号驱动，无需 querySelector）
    // ============================================

    /**
     * 更新指定标题的信息项数据
     * 写入对应的 signal，_reactiveText 自动更新 Text 节点（无需 querySelector）
     * @param title - 要更新的信息项标题
     * @param data - 新的数据内容
     */
    const updateItem = (title: string, data: string): void => {
      const sig = itemDataSignals.get(title);
      if (sig) sig.value = data;
    };

    // ============================================
    // 响应式刷新：状态数据（signal 变化自动更新信息项文本）
    // ============================================

    if (stateMgr) {
      /**
       * 视频分辨率变化时自动刷新「分辨率:」信息项
       * signal 变化 → onEffect 重跑 → updateItem 写入 signal → _reactiveText 自动更新文本
       */
      onEffect(lifecycle, () => {
        const width = (videoWidthSignal.value as number | undefined) ?? 0;
        const height = (videoHeightSignal.value as number | undefined) ?? 0;
        if (width > 0 && height > 0) {
          updateItem("分辨率:", `${width} x ${height}`);
        }
      });

      /**
       * 缓冲进度变化时自动刷新「视频缓存速度:」信息项
       */
      onEffect(lifecycle, () => {
        const buffered = (bufferedSignal.value as number | undefined) ?? 0;
        if (buffered > 0) {
          updateItem("视频缓存速度:", `已缓冲 ${buffered.toFixed(1)}s`);
        }
      });
    }

    // ============================================
    // Host 解析（非响应式，定时刷新）
    // ============================================

    /**
     * 从视频源地址解析主机名（非响应式，定时刷新时调用）
     * @returns 主机名；解析失败时返回空字符串
     */
    const resolveHost = (): string => {
      if (!props.src) return "";
      try {
        return new URL(props.src).hostname;
      } catch {
        return "";
      }
    };

    /**
     * 定时刷新 Host 信息（非状态数据，无法响应式，保留定时器）
     */
    const refreshHostInfo = (): void => {
      const host = resolveHost();
      if (host) {
        updateItem("视频 Host:", host);
        updateItem("音频 Host:", host);
      }
    };

    // ============================================
    // 曲线图（码率 / 缓冲区 / 帧率，1Hz 采样 + SVG 重绘）
    // 图表为命令式渲染：generateXxxChart 生成 SVG 标记串，
    // renderSvgMarkup 解析后替换容器子节点（响应式系统不参与）
    // ============================================

    /** 面板根元素引用（用于向上定位播放器容器内的 video 元素） */
    const rootRef = useTemplateRef<HTMLDivElement>(lifecycle, "infoRootRef");

    /** 三个图表容器引用（SVG 渲染目标） */
    const bitrateChartRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "bitrateChartRef",
    );
    const bufferChartRef = useTemplateRef<HTMLDivElement>(
      lifecycle,
      "bufferChartRef",
    );
    const fpsChartRef = useTemplateRef<HTMLDivElement>(lifecycle, "fpsChartRef");

    /** 三条曲线的采样数据（环形窗口：超限丢弃最旧点） */
    const bitrateData: BitrateDataPoint[] = [];
    const bufferData: BufferDataPoint[] = [];
    const fpsData: FrameRateDataPoint[] = [];

    /** 差分基线（null 表示首次采样，只记基线不出数据点） */
    let videoEl: HTMLVideoElement | null = null;
    let lastSampleTime = 0;
    let lastDecodedBytes: number | null = null;
    let lastTotalFrames: number | null = null;
    let lastDroppedFrames: number | null = null;

    /**
     * 定位播放器内的 video 元素：面板根向上找 .nova-player-container
     * 再向下查 video（与 VideoPlayer 内部 closest 定位同一约定）
     */
    const findVideo = (): HTMLVideoElement | null => {
      const root = rootRef.value;
      if (!root) return null;
      const container = root.closest(".nova-player-container");
      const video = container?.querySelector("video");
      return video instanceof HTMLVideoElement ? video : null;
    };

    /** 采样数据点入窗（环形窗口） */
    const pushPoint = <T extends { timestamp: number }>(
      data: T[],
      point: T,
    ): void => {
      data.push(point);
      if (data.length > MAX_CHART_POINTS) {
        data.shift();
      }
    };

    /**
     * 一次采样 tick：差分三个指标（码率 / 缓冲秒数 / FPS）并重绘三张图
     * - 码率：优先读流媒体插件的原生实例（hls.js/dash.js 当前选中
     *   清晰度的静态码率，见 readNativeBitrate）；无实例（原生播放 /
     *   flv.js）时回退 webkitDecodedByteCount 差分（Chrome 扩展，
     *   非 Chrome 内核无该字段 → 码率曲线保持空图「等待数据...」）
     * - 缓冲：buffered 末段与当前播放位置的差（缓冲秒数）
     * - FPS / 丢帧：getVideoPlaybackQuality 标准接口的帧计数差分
     */
    const sampleCharts = (): void => {
      if (!videoEl) {
        videoEl = findVideo();
        // video 就位（或切换清晰度换元素）时重置差分基线，避免跨元素差分
        if (videoEl) {
          lastDecodedBytes = null;
          lastTotalFrames = null;
          lastDroppedFrames = null;
        }
      }
      if (!videoEl) return;

      const now = Date.now();
      const elapsed = lastSampleTime > 0 ? (now - lastSampleTime) / 1000 : 0;
      lastSampleTime = now;

      // 视频缓冲秒数（buffered 末段 - 当前播放位置）
      const buffered = videoEl.buffered;
      const bufferAhead =
        buffered.length > 0
          ? Math.max(0, buffered.end(buffered.length - 1) - videoEl.currentTime)
          : 0;
      pushPoint(bufferData, {
        timestamp: now,
        videoBuffer: bufferAhead,
        audioBuffer: 0,
      });

      // 帧率 / 丢帧率（getVideoPlaybackQuality 为标准接口）
      if (typeof videoEl.getVideoPlaybackQuality === "function") {
        const quality = videoEl.getVideoPlaybackQuality();
        const total = quality.totalVideoFrames;
        const dropped = quality.droppedVideoFrames;
        if (lastTotalFrames !== null && lastDroppedFrames !== null && elapsed > 0) {
          pushPoint(fpsData, {
            timestamp: now,
            fps: Math.max(0, (total - lastTotalFrames) / elapsed),
            droppedFrames: Math.max(0, dropped - lastDroppedFrames),
          });
        }
        lastTotalFrames = total;
        lastDroppedFrames = dropped;
      }

      // 码率：优先读流媒体插件的原生实例（hls.js/dash.js 静态码率，
      // 与播放器实际选中的清晰度一致）；无实例时回退 Chrome 扩展属性差分
      const nativeBitrate = readNativeBitrate(props.getNativePlayer?.() ?? null);
      if (nativeBitrate) {
        pushPoint(bitrateData, {
          timestamp: now,
          totalBitrate: nativeBitrate.totalBitrate,
          videoBitrate: nativeBitrate.videoBitrate,
          audioBitrate: nativeBitrate.audioBitrate,
        });
        // 原生实例数据源生效期间同步刷新差分基线，切换回差分时不产生跳变点
        lastDecodedBytes = null;
      } else if (hasDecodedBytes(videoEl)) {
        const bytes = videoEl.webkitDecodedByteCount;
        if (typeof bytes === "number") {
          if (lastDecodedBytes !== null && elapsed > 0) {
            const bps = Math.max(0, ((bytes - lastDecodedBytes) * 8) / elapsed);
            pushPoint(bitrateData, {
              timestamp: now,
              totalBitrate: bps,
              videoBitrate: bps,
              audioBitrate: 0,
            });
          }
          lastDecodedBytes = bytes;
        }
      }

      // 重绘三张图（renderSvgMarkup 负责解析与挂载，空数据时图表自绘占位）
      renderSvgMarkup(
        bitrateChartRef.value,
        generateBitrateChart(bitrateData, CHART_SIZE),
      );
      renderSvgMarkup(
        bufferChartRef.value,
        generateBufferChart(bufferData, CHART_SIZE),
      );
      renderSvgMarkup(
        fpsChartRef.value,
        generateFPSChart(fpsData, CHART_SIZE),
      );
    };

    // ============================================
    // 显隐控制（signal 驱动根节点 class，编译器自动 __reactiveAttrs + normalizeClass）
    // ============================================

    /**
     * 定时刷新 tick：Host 刷新 + 曲线图采样（同一频率，共用定时器）
     */
    const refreshTick = (): void => {
      refreshHostInfo();
      sampleCharts();
    };

    /**
     * 显示信息面板，并启动定时刷新（Host + 图表采样）
     */
    const open = (): void => {
      visibleSignal.value = true;
      if (refreshTimer === null) {
        // 重置采样时钟：面板重开时 elapsed 从本次算起，避免休眠期大跳变
        lastSampleTime = 0;
        refreshTick();
        refreshTimer = setInterval(refreshTick, REFRESH_INTERVAL);
      }
    };

    /** 隐藏信息面板，并停止定时刷新 */
    const close = (): void => {
      visibleSignal.value = false;
      if (refreshTimer !== null) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    };

    // ============================================
    // 生命周期钩子
    // ============================================

    /**
     * 组件挂载后，通过事件向外暴露控制方法
     */
    lifecycle.onMounted = (): void => {
      lifecycle.emit?.("videoInfoMounted", {
        open,
        close,
        updateItem,
      } satisfies VideoInfoApi);
    };

    /**
     * 组件销毁前，停止定时刷新
     */
    lifecycle.onBeforeDestroy = (): void => {
      if (refreshTimer !== null) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    };

    // ============================================
    // 组件渲染（DOM 结构与既有实现一致）
    // ============================================

    return h(
      "div",
      {
        class: [
          "nova-player-info-container",
          { "nova-player-active": visibleSignal.value },
        ],
        // 面板根引用：曲线图采样时向上定位播放器容器内的 video 元素
        ref: "infoRootRef",
      },
      h(
        "div",
        { class: "nova-player-info-title" },
        "统计信息",
        h(
          "span",
          {
            class: "nova-player-info-close",
            onClick: () => {
              close();
              props.onClose?.();
            },
          },
          h("span", { class: "common-svg-icon" }, CloseIcon()),
        ),
      ),
      h(
        "div",
        { class: "nova-player-info-panel" },
        // For 组件：key-based 精准更新，每个信息项只渲染一次
        // _reactiveText 在 signal 变化时自动更新对应 Text 节点，不重渲染
        h(For, {
          each: infoItems,
          key: (item: unknown, _index: number) => (item as VideoInfoItem).title,
          render: (item: unknown, _index: number) => {
            const infoItem = item as VideoInfoItem;
            const dataSignal = getItemDataSignal(infoItem.title, infoItem.data);
            return h(
              "div",
              { class: "info-line" },
              h("span", { class: "info-title" }, infoItem.title),
              h(
                "span",
                { class: "info-data" },
                // 编译器自动检测动态表达式 dataSignal.value 并包装为 _reactiveText
                dataSignal.value,
              ),
            );
          },
        }),
        // ===== 三个曲线图（信息行下方，1Hz 采样差分：码率 / 缓冲 / 帧率） =====
        // 命令式 SVG 渲染区：容器 ref 供 sampleCharts 写入，首次采样前为空
        h(
          "div",
          { class: "info-chart-section" },
          h("div", { class: "info-chart-title" }, "码率曲线"),
          h("div", { class: "info-chart-container", ref: "bitrateChartRef" }),
        ),
        h(
          "div",
          { class: "info-chart-section" },
          h("div", { class: "info-chart-title" }, "缓冲区曲线"),
          h("div", { class: "info-chart-container", ref: "bufferChartRef" }),
        ),
        h(
          "div",
          { class: "info-chart-section" },
          h("div", { class: "info-chart-title" }, "帧率曲线"),
          h("div", { class: "info-chart-container", ref: "fpsChartRef" }),
        ),
      ),
    );
  },
);
