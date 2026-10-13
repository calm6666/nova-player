/**
 * ============================================
 * 互动视频插件 — 分支选择画布（响应式容器 + canvas 绘制）
 * ============================================
 * 分支时间窗内的全屏居中选项按钮组：
 * - 容器 DOM 走响应式（questionState 信号驱动 display 表达式），
 *   canvas 经 ref 回调取得元素并绑定鼠标交互；
 * - 画布完全透明，选项按钮（背景图 + 遮罩 + 描边 + 文字）由 canvas
 *   绘制：effect 读取 questionState 信号，信号变化自动重绘（首次
 *   同步执行，与框架响应式模型一致）；
 * - 两种弹出模式：
 *   · 时间窗内（ended = false）：视频仍在播，画布保持全透明，
 *     视频画面 / 弹幕从画布下层透出；
 *   · 播完弹出（ended = true）：控制栏与其余 UI 已收起，画布先以
 *     video 元素的最后一帧铺满全屏（cover 等比裁剪）再压半透明
 *     黑遮罩，视觉上「问题浮在定格画面上」；
 * - 背景图默认用插件自带 bg.png，节点可配置更换不同背景；
 * - 命中检测：mousemove 遍历选项矩形（无 DOM 元素），悬停高亮 +
 *   手型光标 + 按钮围绕中心平滑放大（rAF 指数逼近插值），
 *   移出平滑缩回，click 触发选择回调；
 * - ResizeObserver 监听容器尺寸变化，重设画布（devicePixelRatio
 *   高清缩放）并重绘
 *
 * 结构：
 * .nova-player-interaction-question（questionState 信号驱动显隐）
 *   └─ canvas（时间窗模式全透明；播完模式绘制最后一帧背景）
 */

import { h, effect } from "@/core";
import type { Signal } from "@/core";
import type { VNode } from "@/types";
import type { InteractiveQuestion } from "./types";
// 默认答案背景图（可被节点配置的 background 替换）
import defaultBgImage from "./images/bg.png";

/** 分支选择状态载荷（questionState 信号的值类型） */
export interface QuestionState {
  /** 分支选择配置 */
  question: InteractiveQuestion;
  /** 是否播完弹出（true = 绘制视频最后一帧背景） */
  ended: boolean;
}

/** 悬停缩放动画参数：目标放大倍数与每帧逼近系数（指数平滑） */
const HOVER_SCALE_TARGET = 1.07;
const HOVER_SCALE_EASE = 0.22;

// ============================================
// 模块内部绘制状态（闭包持有，随 VNode 挂载初始化）
// ============================================

/** 2D 绘制上下文（canvas ref 回调时初始化） */
let canvasCtx: CanvasRenderingContext2D | null = null;

/** 绘制画布元素（canvas ref 回调时初始化） */
let canvasElement: HTMLCanvasElement | null = null;

/** 分支选择容器元素（ref 回调时初始化，尺寸测量用） */
let containerElement: HTMLDivElement | null = null;

/** 悬停中的选项下标（-1 = 无；变化时触发缩放动画） */
let hoverIndex = -1;

/** 每个选项当前的缩放倍数（rAF 动画插值的当前值） */
let hoverScales: number[] = [];

/** 缩放动画 rAF 句柄（null = 空闲） */
let scaleAnimHandle: number | null = null;

/** 选项按钮命中矩形列表（CSS 像素坐标，绘制与命中共用；缩放前的基准矩形） */
let optionRects: Array<{
  x: number;
  y: number;
  width: number;
  height: number;
}> = [];

/** 已加载背景图缓存（URL → HTMLImageElement） */
const bgImageCache = new Map<string, HTMLImageElement>();

/** 当前显示的分支选择状态缓存（effect 与命令式重绘共用） */
let currentQuestionCache: QuestionState | null = null;

/** 选项点击回调（renderQuestion 调用时注入） */
let selectCallback: ((index: number) => void) | null = null;

/** 视频元素获取器（播完弹出时绘制最后一帧用） */
let videoGetter: (() => HTMLVideoElement | null) | null = null;

// ============================================
// 背景图管理
// ============================================

/**
 * 加载背景图（带缓存；加载完成后若正在显示则补一次重绘）
 *
 * @param url - 背景图 URL
 * @returns 已加载完成的图元素（未加载完时为 undefined）
 */
function loadBgImage(url: string): HTMLImageElement | undefined {
  const cached = bgImageCache.get(url);
  if (cached?.complete) return cached;

  if (!bgImageCache.has(url)) {
    const image = new Image();
    // 加载完成：重绘一次（首次绘制时可能未加载完，仅遮罩+描边+文字）
    image.onload = (): void => {
      redraw();
    };
    image.src = url;
    bgImageCache.set(url, image);
  }
  return undefined;
}

// ============================================
// 布局与绘制
// ============================================

/**
 * 计算选项按钮命中矩形（横向流式排列、每行居中、整体垂直居中）
 * 布局参数：按钮 300×52、间距 20（行内 / 行间一致）、题目文案高 36（存在时）
 * 一行放不下时自动换到下一行，每行按该行实际按钮数水平居中
 *
 * @param question - 分支选择配置
 * @returns 按钮组整体区域（题目行 + 全部按钮；无配置时为 null）
 */
function layoutOptionRects(question: InteractiveQuestion): {
  startY: number;
  height: number;
} | null {
  if (!containerElement) return null;

  /** 容器 CSS 尺寸 */
  const rect = containerElement.getBoundingClientRect();
  const options = question.options;

  // 按钮布局参数（横向流式：一行放不下自动换行，行内 / 行间间距一致）
  const buttonWidth = 300;
  const buttonHeight = 52;
  const gap = 20;
  const titleHeight = question.title ? 36 : 0;

  // 每行可容纳的按钮数（容器过窄时至少 1 个：单按钮独占一行）
  const columns = Math.max(
    1,
    Math.floor((rect.width + gap) / (buttonWidth + gap)),
  );
  // 总行数（按每行满载向上取整，末行可能不满）
  const rows = Math.ceil(options.length / columns);

  // 按钮组整体高度（题目行 + 各行按钮 + 行间距）
  const totalHeight = rows * buttonHeight + (rows - 1) * gap + titleHeight;

  // 垂直居中起点
  const startY = Math.max(0, (rect.height - totalHeight) / 2);

  // 选项矩形（横向流式排列：每行按实际按钮数水平居中，题目行之下；
  // 缩放动画前的基准矩形）
  optionRects = options.map((_, index) => {
    /** 所在行号与行内下标 */
    const row = Math.floor(index / columns);
    const column = index % columns;
    /** 该行实际按钮数（末行可能不满 columns 个） */
    const rowCount = Math.min(columns, options.length - row * columns);
    /** 该行内容总宽（含行内间距），居中排布的起点据此计算 */
    const rowWidth = rowCount * buttonWidth + (rowCount - 1) * gap;
    return {
      x: (rect.width - rowWidth) / 2 + column * (buttonWidth + gap),
      y: startY + titleHeight + row * (buttonHeight + gap),
      width: buttonWidth,
      height: buttonHeight,
    };
  });

  return { startY, height: totalHeight };
}

/**
 * 构建圆角矩形路径（不清空已有路径）
 *
 * @param ctx - 画布上下文
 * @param target - 目标矩形
 * @param radius - 圆角半径
 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  target: { x: number; y: number; width: number; height: number },
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(target.x + radius, target.y);
  ctx.lineTo(target.x + target.width - radius, target.y);
  ctx.arcTo(
    target.x + target.width,
    target.y,
    target.x + target.width,
    target.y + radius,
    radius,
  );
  ctx.lineTo(target.x + target.width, target.y + target.height - radius);
  ctx.arcTo(
    target.x + target.width,
    target.y + target.height,
    target.x + target.width - radius,
    target.y + target.height,
    radius,
  );
  ctx.lineTo(target.x + radius, target.y + target.height);
  ctx.arcTo(
    target.x,
    target.y + target.height,
    target.x,
    target.y + target.height - radius,
    radius,
  );
  ctx.lineTo(target.x, target.y + radius);
  ctx.arcTo(target.x, target.y, target.x + radius, target.y, radius);
  ctx.closePath();
}

/**
 * 按 cover 模式等比绘制源（视频帧或图片）到目标矩形（居中裁剪）
 *
 * @param ctx - 画布上下文
 * @param source - 源（视频元素或图元素，均支持 drawImage）
 * @param sourceWidth - 源原始宽（视频用 videoWidth）
 * @param sourceHeight - 源原始高（视频用 videoHeight）
 * @param target - 目标矩形
 * @param clip - 是否裁剪到目标矩形圆角（选项按钮用；全屏背景不裁）
 */
function drawSourceCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  target: { x: number; y: number; width: number; height: number },
  clip: boolean,
): void {
  if (sourceWidth <= 0 || sourceHeight <= 0) return;

  // 等比缩放比（取较大值保证铺满目标矩形）
  const scale = Math.max(
    target.width / sourceWidth,
    target.height / sourceHeight,
  );
  /** 缩放后的源尺寸 */
  const scaledWidth = sourceWidth * scale;
  const scaledHeight = sourceHeight * scale;
  /** 居中裁剪偏移 */
  const offsetX = (scaledWidth - target.width) / 2;
  const offsetY = (scaledHeight - target.height) / 2;

  ctx.save();
  if (clip) {
    roundRectPath(ctx, target, 8);
    ctx.clip();
  }
  ctx.drawImage(
    source,
    target.x - offsetX,
    target.y - offsetY,
    scaledWidth,
    scaledHeight,
  );
  ctx.restore();
}

/**
 * 主绘制：清屏 →（播完模式）最后一帧背景 + 全屏遮罩 → 题目文案 →
 * 选项按钮（背景图 + 遮罩 + 描边 + 文字，悬停时围绕中心放大）
 *
 * @param state - 分支选择状态（null 时仅清屏）
 */
function drawQuestion(state: QuestionState | null): void {
  if (!canvasCtx || !canvasElement || !containerElement) return;

  /** 容器 CSS 尺寸 */
  const rect = containerElement.getBoundingClientRect();
  const question = state?.question ?? null;

  // 全透明清屏（时间窗模式下画布保持全透明）
  canvasCtx.clearRect(0, 0, rect.width, rect.height);
  if (!question) return;

  // ── 播完模式：视频最后一帧铺满 + 全屏遮罩（问题浮在定格画面上）──
  if (state?.ended) {
    const video = videoGetter?.();
    if (video && video.videoWidth > 0) {
      drawSourceCover(
        canvasCtx,
        video,
        video.videoWidth,
        video.videoHeight,
        { x: 0, y: 0, width: rect.width, height: rect.height },
        false,
      );
      // 半透明黑遮罩：压暗定格画面，突出问题按钮
      canvasCtx.fillStyle = "rgba(0, 0, 0, 0.45)";
      canvasCtx.fillRect(0, 0, rect.width, rect.height);
    } else {
      // 视频元素不可用（理论不应发生）：纯黑兜底
      canvasCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
      canvasCtx.fillRect(0, 0, rect.width, rect.height);
    }
  }

  // ── 按钮组布局 ──
  const groupRect = layoutOptionRects(question);

  // 题目文案（可选，按钮组上方居中）
  if (question.title && groupRect) {
    canvasCtx.fillStyle = "#fff";
    canvasCtx.font =
      '600 18px "PingFang SC", "Microsoft YaHei", sans-serif';
    canvasCtx.textAlign = "center";
    canvasCtx.textBaseline = "middle";
    // 阴影提升在画面上的可读性
    canvasCtx.shadowColor = "rgba(0, 0, 0, 0.6)";
    canvasCtx.shadowBlur = 4;
    canvasCtx.fillText(
      question.title,
      rect.width / 2,
      groupRect.startY + 18,
    );
    canvasCtx.shadowBlur = 0;
  }

  // ── 选项按钮逐个绘制（悬停时围绕中心放大）──
  question.options.forEach((option, index) => {
    const baseRect = optionRects[index];
    if (!baseRect || !canvasCtx) return;

    const isHover = index === hoverIndex;
    /** 前缀字母（A / B / ...，缺省按下标生成） */
    const label = option.label ?? String.fromCharCode(65 + index);

    // 悬停缩放：围绕按钮中心放大（背景图 / 遮罩 / 描边 / 文字整体缩放）
    const scale = hoverScales[index] ?? 1;
    canvasCtx.save();
    if (scale !== 1) {
      const centerX = baseRect.x + baseRect.width / 2;
      const centerY = baseRect.y + baseRect.height / 2;
      canvasCtx.translate(centerX, centerY);
      canvasCtx.scale(scale, scale);
      canvasCtx.translate(-centerX, -centerY);
    }

    // 1. 背景图（节点配置优先，回落默认 bg.png；未加载完跳过底图）
    const bgImage = loadBgImage(question.background ?? defaultBgImage);
    if (bgImage) {
      drawSourceCover(canvasCtx, bgImage, bgImage.width, bgImage.height, {
        x: baseRect.x,
        y: baseRect.y,
        width: baseRect.width,
        height: baseRect.height,
      }, true);
    }

    // 2. 半透明黑遮罩（保证文字可读；悬停时减淡突出高亮）
    canvasCtx.fillStyle = isHover
      ? "rgba(0, 0, 0, 0.35)"
      : "rgba(0, 0, 0, 0.55)";
    roundRectPath(canvasCtx, baseRect, 8);
    canvasCtx.fill();

    // 3. 描边（白色边框恒定不变色：悬停反馈只保留平滑放大，边框不变成蓝色）
    canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    canvasCtx.lineWidth = isHover ? 2 : 1.5;
    roundRectPath(canvasCtx, baseRect, 8);
    canvasCtx.stroke();

    // 4. 选项文字（前缀 + 文案，居中；悬停高亮）
    canvasCtx.fillStyle = isHover ? "#00A1D6" : "#fff";
    canvasCtx.font =
      '500 16px "PingFang SC", "Microsoft YaHei", sans-serif';
    canvasCtx.textAlign = "center";
    canvasCtx.textBaseline = "middle";
    canvasCtx.fillText(
      `${label}  ${option.text}`,
      baseRect.x + baseRect.width / 2,
      baseRect.y + baseRect.height / 2,
    );

    canvasCtx.restore();
  });
}

/** 按当前状态缓存重绘（背景图加载完成 / 缩放动画帧 / 尺寸变化时调用） */
function redraw(): void {
  drawQuestion(currentQuestionCache);
}

// ============================================
// 悬停缩放动画（rAF 指数逼近：移入放大 / 移出缩回均平滑）
// ============================================

/** 缩放动画帧：每帧向各自目标倍数逼近，全部到达后自停 */
const scaleAnimTick = (): void => {
  /** 是否仍有选项未到达目标（未到达则继续下一帧） */
  let animating = false;

  for (let index = 0; index < hoverScales.length; index += 1) {
    /** 该选项的目标倍数（悬停中 = 放大目标 / 其余 = 1） */
    const target = index === hoverIndex ? HOVER_SCALE_TARGET : 1;
    const current = hoverScales[index] ?? 1;
    // 指数逼近：current += (target - current) * ease
    const next = current + (target - current) * HOVER_SCALE_EASE;
    // 到达判定（浮点比较容差）
    if (Math.abs(next - target) < 0.002) {
      hoverScales[index] = target;
    } else {
      hoverScales[index] = next;
      animating = true;
    }
  }

  redraw();

  if (animating) {
    scaleAnimHandle = requestAnimationFrame(scaleAnimTick);
  } else {
    scaleAnimHandle = null;
  }
};

/** 启动缩放动画（已在运行则复用同一 rAF 循环） */
const startScaleAnim = (): void => {
  if (scaleAnimHandle === null) {
    scaleAnimHandle = requestAnimationFrame(scaleAnimTick);
  }
};

/** 停止缩放动画（隐藏 / 销毁时调用） */
const stopScaleAnim = (): void => {
  if (scaleAnimHandle !== null) {
    cancelAnimationFrame(scaleAnimHandle);
    scaleAnimHandle = null;
  }
};

// ============================================
// 命中检测与交互
// ============================================

/**
 * 将鼠标事件坐标换算为画布 CSS 像素坐标
 *
 * @param event - 鼠标事件
 */
function getPointerPosition(event: MouseEvent): { x: number; y: number } {
  const rect = canvasElement?.getBoundingClientRect();
  if (!rect) return { x: -1, y: -1 };
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * 命中检测：返回坐标所在的选项下标（-1 = 未命中任何按钮）
 * 注意在基准矩形上外扩命中区（悬停放大后按钮实际更大，按原尺寸
 * 命中会在边缘丢失悬停），外扩量按放大目标近似
 *
 * @param x - 画布 x 坐标（CSS 像素）
 * @param y - 画布 y 坐标（CSS 像素）
 */
function hitTest(x: number, y: number): number {
  /** 放大目标下的半向外扩量（宽高各外扩 ~5px） */
  const expandX = (300 * (HOVER_SCALE_TARGET - 1)) / 2;
  const expandY = (52 * (HOVER_SCALE_TARGET - 1)) / 2;

  for (let index = 0; index < optionRects.length; index += 1) {
    const optionRect = optionRects[index];
    if (
      optionRect &&
      x >= optionRect.x - expandX &&
      x <= optionRect.x + optionRect.width + expandX &&
      y >= optionRect.y - expandY &&
      y <= optionRect.y + optionRect.height + expandY
    ) {
      return index;
    }
  }
  return -1;
}

/** mousemove：悬停命中 → 高亮 + 缩放动画 + 手型光标 */
function handleCanvasMouseMove(event: MouseEvent): void {
  if (!currentQuestionCache || !canvasElement) return;

  const position = getPointerPosition(event);
  const hitIndex = hitTest(position.x, position.y);

  // 命中变化才重绘 + 启动缩放动画（避免每帧全量重绘）
  if (hitIndex !== hoverIndex) {
    hoverIndex = hitIndex;
    startScaleAnim();
  }

  // 手型光标：仅命中按钮时（canvas 命中检测为命令式）
  canvasElement.style.cursor = hitIndex >= 0 ? "pointer" : "default";
}

/** click：命中选项 → 触发选择回调 */
function handleCanvasClick(event: MouseEvent): void {
  if (!currentQuestionCache) return;

  const position = getPointerPosition(event);
  const hitIndex = hitTest(position.x, position.y);
  if (hitIndex >= 0) {
    selectCallback?.(hitIndex);
  }
}

/** mouseleave：清除悬停态并平滑缩回 */
function handleCanvasMouseLeave(): void {
  if (hoverIndex !== -1 || hoverScales.some((s) => s !== 1)) {
    hoverIndex = -1;
    if (canvasElement) canvasElement.style.cursor = "default";
    startScaleAnim();
  }
}

// ============================================
// 画布尺寸自适应
// ============================================

/** 尺寸自适应观察器（容器尺寸变化时重设画布并重绘） */
let resizeObserver: ResizeObserver | null = null;

/** 重设画布尺寸（CSS 尺寸 + devicePixelRatio 物理尺寸） */
function setupCanvasSize(): boolean {
  if (!canvasElement || !containerElement) return false;

  /** 容器 CSS 尺寸 */
  const rect = containerElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  /** 设备像素比（高清屏保清晰） */
  const dpr = window.devicePixelRatio || 1;
  canvasElement.width = Math.round(rect.width * dpr);
  canvasElement.height = Math.round(rect.height * dpr);
  canvasElement.style.width = `${rect.width}px`;
  canvasElement.style.height = `${rect.height}px`;
  canvasCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

// ============================================
// 分支选择根组件
// ============================================

/**
 * 渲染分支选择（响应式容器 + canvas 绘制）
 *
 * 响应式链路：questionState 信号 → effect 自动重绘 + display 表达式
 * 显隐；canvas 鼠标交互（命中检测 / 缩放动画）为命令式
 * （canvas 无 DOM 元素可绑定）
 *
 * @param questionState - 分支选择状态信号（null = 隐藏并清空画布）
 * @param getVideo - 视频元素获取器（播完弹出时绘制最后一帧）
 * @param onSelect - 选项点击回调（选项下标）
 * @param cleanups - 清理函数收集列表（主类 uninstall 时统一执行，
 *                   收纳 effect dispose / 事件解绑 / 观察器断开）
 * @returns 分支选择根 VNode
 */
export function renderQuestion(
  questionState: Signal<QuestionState | null>,
  getVideo: () => HTMLVideoElement | null,
  onSelect: (index: number) => void,
  cleanups: Array<() => void>,
): VNode {
  selectCallback = onSelect;
  videoGetter = getVideo;

  // 响应式绘制：effect 读取 questionState 信号，首次同步执行，
  // 信号变化（显示 / 隐藏 / 更换题目）自动重绘；dispose 交主类清理
  const disposeDraw = effect((): void => {
    const state = questionState.value;
    currentQuestionCache = state;
    hoverIndex = -1;
    // 重置缩放状态（新题目从原尺寸开始）
    hoverScales = state
      ? state.question.options.map(() => 1)
      : [];
    stopScaleAnim();

    if (state) {
      // 预加载背景图（默认图或节点配置图，命中缓存即同步可用）
      loadBgImage(state.question.background ?? defaultBgImage);

      // 画布尺寸就绪则直接绘制；display 翻转与 effect 的执行时序
      // 不保证先后，容器量出 0 尺寸时推迟一帧再试（display 表达式
      // 属同一次信号更新，下一帧必定已翻转）
      if (!setupCanvasSize()) {
        requestAnimationFrame((): void => {
          if (currentQuestionCache && setupCanvasSize()) {
            drawQuestion(currentQuestionCache);
          }
        });
        return;
      }
    }
    // 绘制（null 时仅清屏）
    drawQuestion(state);
  });
  cleanups.push(disposeDraw);

  return h(
    "div",
    {
      class: "nova-player-interaction-question",
      // display 表达式：questionState 信号驱动显隐
      style: { display: questionState.value ? "flex" : "none" },
      // 容器 ref：初始化尺寸观察器（display 翻转后拿得到有效尺寸）
      ref: (el: Element): void => {
        if (!(el instanceof HTMLDivElement)) return;
        containerElement = el;

        // 断开旧观察器（VNode 重建时的幂等处理）
        resizeObserver?.disconnect();
        resizeObserver = new ResizeObserver((): void => {
          if (currentQuestionCache) {
            if (setupCanvasSize()) {
              redraw();
            }
          }
        });
        resizeObserver.observe(el);
        cleanups.push((): void => {
          resizeObserver?.disconnect();
          resizeObserver = null;
        });
      },
    },
    h("canvas", {
      // canvas ref：初始化上下文 + 绑定鼠标交互（命令式命中检测）
      ref: (el: Element): void => {
        if (!(el instanceof HTMLCanvasElement)) return;
        canvasElement = el;
        canvasCtx = el.getContext("2d");

        el.addEventListener("mousemove", handleCanvasMouseMove);
        el.addEventListener("click", handleCanvasClick);
        el.addEventListener("mouseleave", handleCanvasMouseLeave);
        cleanups.push((): void => {
          stopScaleAnim();
          el.removeEventListener("mousemove", handleCanvasMouseMove);
          el.removeEventListener("click", handleCanvasClick);
          el.removeEventListener("mouseleave", handleCanvasMouseLeave);
        });
      },
    }),
  );
}

// 组件销毁兜底：cleanups 由主类 uninstall 统一执行（effect dispose /
// 观察器断开）；canvas 事件随元素移除自动释放，无需逐个解绑
