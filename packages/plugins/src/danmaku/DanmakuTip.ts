/**
 * ============================================
 * 弹幕悬停操作条 Tip（原版 player-dm-tip / Dialog.showDmTip 移植）
 * ============================================
 * 行为：
 * - 悬停命中瞬间挂 danmaku-x-paused 暂停该弹幕（移上去立即停止），
 *   300ms 防抖后展示操作条（点赞 / 复制 / 举报；本人弹幕额外显示撤回）
 * - 操作条底板双形态（svgl / svgm 为同一外框的两场景形态）：
 *   默认 svgm（尾尖居中指向弹幕中心）；弹幕靠画面左侧、操作条被左边界
 *   钳制导致中心尾尖无法对准弹幕时切换 svgl（尾尖偏左），由 position()
 *   挂 nova-player-dm-tip-left 类经 CSS 切换两底板
 * - 鼠标移入操作条后不自动隐藏、也不被路过的弹幕劫持（inTip 守卫），
 *   移出操作条才恢复滚动并 200ms 后隐藏 Tip
 * - 离开弹幕时 200ms 内才解除暂停（原版时序）：给鼠标从弹幕移向操作条
 *   留出通道（movingToTip 守卫：通道期内路过的弹幕不得劫持 Tip，否则
 *   Tip 跳走会被观感为「移到 tip 上就消失」）；立即解除会让弹幕飞走
 * - 按钮悬停显示文字气泡（纯 CSS 底板：黑底圆角 + 上三角尾尖指向按钮，
 *   svgl/svgm 不用于子图标气泡）
 * - 点赞：显示当前弹幕点赞数，点击切换点赞态（图标填充白色）并外抛回调；
 *   复制：写剪贴板后 toast 提示「复制成功」；撤回：外抛回调并由插件层
 *   从画面移除该弹幕；举报：外抛回调
 * - 左右边界钳制（操作条宽 162px，半宽 81px），避免溢出画面
 * 样式唯一来源：danmaku.scss 的 .nova-player-dm-tip 家族，TS 内零内联样式
 */

import { rafTimeout, cancelRaf } from "@/utils/rafTimeout";
import type { AnimationFrameID } from "@/utils/rafTimeout";
import type { DanmakuRenderItem } from "../utils/danmaku/types";

/** 操作条主体装饰（原版 TipSvgm：气泡底板描边，尾尖在顶部中间） */
const TIP_SVG_M = `
<svg xmlns="http://www.w3.org/2000/svg" fill="none" data-pointer="none" viewBox="0 0 162 48">
  <path fill="#000" fill-opacity=".703" fill-rule="evenodd" d="M1 27.075C1 16.07 9.92 7.149 20.925 7.149h55.91L81.522 1l4.741 6.15h54.812C152.079 7.15 161 16.07 161 27.074 161 38.079 152.079 47 141.075 47H20.925C9.921 47 1 38.08 1 27.075Z" clip-rule="evenodd"></path>
  <path stroke="#fff" stroke-linejoin="round" stroke-opacity=".496" d="M81.918.695a.5.5 0 0 0-.794.002l-4.536 5.952H20.925C9.645 6.65.5 15.794.5 27.075.5 38.355 9.645 47.5 20.925 47.5h120.15c11.28 0 20.425-9.145 20.425-20.425 0-11.281-9.145-20.426-20.425-20.426H86.509L81.918.695Z"></path>
</svg>
`;

/** 操作条左侧装饰（原版 TipSvgl：尾尖在顶部左侧） */
const TIP_SVG_L = `
<svg xmlns="http://www.w3.org/2000/svg" fill="none" data-pointer="none" viewBox="0 0 145 42">
  <path fill="#000" fill-opacity=".703" fill-rule="evenodd" d="M1 23.562c0-9.63 7.807-17.438 17.438-17.438h4.372L26.65 1l3.887 5.124h96.025c9.631 0 17.438 7.808 17.438 17.438C144 33.192 136.193 41 126.562 41H18.438C8.808 41 1 33.193 1 23.562Z" clip-rule="evenodd"></path>
  <path stroke="#fff" stroke-linejoin="round" stroke-opacity=".496" d="M27.05.698a.5.5 0 0 0-.8.002l-3.69 4.924h-4.122C8.53 5.624.5 13.655.5 23.562.5 33.47 8.531 41.5 18.438 41.5h108.124c9.907 0 17.938-8.031 17.938-17.938 0-9.907-8.031-17.938-17.938-17.938H30.785L27.05.698Z"></path>
</svg>
`;

/** 点赞图标（原版 TipLike，描边版：拇指轮廓 + 内部细节镂空） */
const TIP_LIKE = `
<svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 20 20">
  <path fill="#FFF" fill-rule="nonzero" d="M11.187 1.943c.985.475 1.582 1.646 1.582 3.116 0 .721-.075 1.457-.225 2.208l-.032.144h3.518a2.25 2.25 0 0 1 2.229 1.938l.016.158.005.154c0 .12-.01.241-.03.36l-.035.178-1.263 5.123a3.85 3.85 0 0 1-3.542 2.924l-.196.005H4.026a2.243 2.243 0 0 1-2.24-2.087l-.006-.153V9.65c0-1.186.924-2.156 2.092-2.235l.154-.005 2.26.013C7.85 6.89 8.732 5.48 8.948 3.087c.102-1.126 1.192-1.649 2.238-1.144Zm-.943 1.261C10 5.89 9.209 7.681 7.378 8.491l-.056.023.011 8.436h5.881a2.55 2.55 0 0 0 2.428-1.771l.048-.168 1.262-5.123a.95.95 0 0 0-.811-1.17l-.111-.007h-3.828a1.05 1.05 0 0 1-1.021-1.293 10.2 10.2 0 0 0 .288-2.359c0-.986-.342-1.702-.847-1.946-.258-.124-.363-.081-.378.091ZM5.769 8.711H4.026a.944.944 0 0 0-.94.83l-.006.11v6.36c0 .481.365.879.835.933l.11.007 1.755-.001-.011-8.24Z"></path>
</svg>
`;

/**
 * 点赞图标（实心版）：取原版 TipLike path 的首个子路径——即整个拇指的
 * 外轮廓（fill-rule nonzero 下自相交区域仍填充），去掉内部镂空细节，
 * 得到点赞后「图标填充白色」的实心形态
 */
const TIP_LIKE_FILLED = `
<svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 20 20">
  <path fill="#FFF" fill-rule="nonzero" d="M11.187 1.943c.985.475 1.582 1.646 1.582 3.116 0 .721-.075 1.457-.225 2.208l-.032.144h3.518a2.25 2.25 0 0 1 2.229 1.938l.016.158.005.154c0 .12-.01.241-.03.36l-.035.178-1.263 5.123a3.85 3.85 0 0 1-3.542 2.924l-.196.005H4.026a2.243 2.243 0 0 1-2.24-2.087l-.006-.153V9.65c0-1.186.924-2.156 2.092-2.235l.154-.005 2.26.013C7.85 6.89 8.732 5.48 8.948 3.087c.102-1.126 1.192-1.649 2.238-1.144Z"></path>
</svg>
`;

/** 复制图标（原版 TipCopy） */
const TIP_COPY = `
<svg xmlns="http://www.w3.org/2000/svg" fill="none" data-pointer="none" viewBox="0 0 20 20">
  <path fill="#fff" fill-rule="evenodd" d="M13.067 18.35c1.222 0 2.213-.99 2.213-2.213a2.213 2.213 0 0 0 2.213-2.214v-9.96c0-1.222-.99-2.213-2.213-2.213H6.427c-1.223 0-2.214.99-2.214 2.213C2.991 3.963 2 4.954 2 6.177v9.96c0 1.222.99 2.213 2.213 2.213h8.854ZM3.107 6.177c0-.611.495-1.107 1.106-1.107h8.854c.61 0 1.106.495 1.106 1.107v9.96c0 .61-.495 1.106-1.106 1.106H4.213a1.107 1.107 0 0 1-1.106-1.106v-9.96Zm13.28-2.214c0-.61-.496-1.106-1.107-1.106H6.427c-.612 0-1.107.495-1.107 1.106h7.747c1.222 0 2.213.991 2.213 2.214v8.853c.611 0 1.107-.495 1.107-1.107v-9.96Zm-4.963 3.874h-6.07v1.106h6.07V7.837Zm-1.107 3.873H5.354v-1.107h4.963v1.107Zm-4.963 2.767H7.55V13.37H5.354v1.107Z" clip-rule="evenodd"></path>
</svg>
`;

/** 撤回图标（原版 TipRecall，仅本人弹幕模式展示） */
const TIP_RECALL = `
<svg xmlns="http://www.w3.org/2000/svg" fill="none" data-pointer="none" viewBox="0 0 20 20">
  <path fill="#fff" d="M12.531 6.563H4.125l2.5-2.5a.604.604 0 0 0 0-.876.604.604 0 0 0-.875 0L2.187 6.72A.617.617 0 0 0 2 7.156c0 .157.062.313.187.438l3.532 3.531c.25.25.625.25.875 0a.604.604 0 0 0 0-.875L4.156 7.813h8.375a4.201 4.201 0 0 1 4.219 4.219 4.201 4.201 0 0 1-4.219 4.218H6.125a.627.627 0 0 0-.625.625c0 .344.281.625.625.625h6.406A5.455 5.455 0 0 0 18 12.031a5.455 5.455 0 0 0-5.469-5.468Z"></path>
</svg>
`;

/** 举报图标（原版 TipBack） */
const TIP_BACK = `
<svg xmlns="http://www.w3.org/2000/svg" data-pointer="none" viewBox="0 0 21 20">
  <path fill="#FFF" fill-rule="nonzero" d="m10.673 1.5.297.022c1.202.132 2.273.817 2.842 1.815l6.026 9.504c.385.587.594 1.259.612 2.008 0 2.011-1.676 3.482-3.792 3.482H4.542C2.417 18.33.75 16.851.75 14.784a3.666 3.666 0 0 1 .594-1.916l6.014-9.482a3.776 3.776 0 0 1 3.088-1.881l.081-.005h.146ZM10.6 2.748l-.081.005a2.53 2.53 0 0 0-2.076 1.254L2.4 13.537c-.251.383-.39.824-.4 1.277 0 1.317 1.083 2.266 2.542 2.267h12.116c1.46 0 2.542-.95 2.542-2.232a2.492 2.492 0 0 0-.407-1.323L12.66 3.853a2.54 2.54 0 0 0-1.98-1.1l-.081-.005Zm.026 10.73a1 1 0 1 1-.006 2 1 1 0 0 1 .006-2ZM10.6 5.815c.54 0 .977.436.977.972-.113 2.57-.177 4.037-.191 4.4-.022.542-.45.76-.786.76s-.774-.21-.794-.76c-.013-.368-.074-1.834-.183-4.399 0-.537.436-.973.977-.973Z"></path>
</svg>
`;

/** 操作条宽度（px），用于左右边界钳制（原版 162px 定宽） */
const TIP_WIDTH = 162;

/**
 * Tip 操作回调（由 DanmakuPlugin 注入，转发到插件 callbacks 通道）
 * 参数为引擎内部渲染项（DanmakuRenderItem 是 DanmakuItem 的超集，
 * renderId 供撤回时从画面移除）
 */
export interface DanmakuTipHandlers {
  /** 点赞 / 取消点赞（liked 为点击后的新状态） */
  onLike?: (danmaku: DanmakuRenderItem, liked: boolean) => void;
  /** 复制成功（剪贴板写入完成后触发） */
  onCopy?: (danmaku: DanmakuRenderItem) => void;
  /** 撤回（本人弹幕，插件层负责从画面移除） */
  onRecall?: (danmaku: DanmakuRenderItem) => void;
  /** 举报 */
  onReport?: (danmaku: DanmakuRenderItem) => void;
}

export class DanmakuTip {
  /** 操作条覆盖层（nova-player-dm-tip-wrap），挂载于弹幕容器 */
  private wrap: HTMLDivElement;
  /** 操作条本体（nova-player-dm-tip），懒创建 */
  private tip: HTMLDivElement | null = null;
  /** 当前关联的弹幕（展示中才有值） */
  private currentItem: DanmakuRenderItem | null = null;
  /** 是否正在展示 */
  private isShow = false;
  /** 鼠标是否在操作条内（inTip 守卫：内交互期间不自动隐藏、不被劫持） */
  private inTip = false;
  /**
   * 鼠标是否处于「弹幕 → 操作条」移动通道中（outTimer 200ms 窗口内）
   * 通道期内路过的其他弹幕不得劫持 Tip（show 守卫）：劫持会让 Tip 跳到
   * 新弹幕下方、原弹幕恢复飞行，观感即「移到 tip 上 tip 就消失了」
   */
  private movingToTip = false;
  /** 展示延迟定时器（300ms 防抖） */
  private delayTimer: AnimationFrameID | null = null;
  /** 自动隐藏定时器（2s） */
  private inTimer: AnimationFrameID | null = null;
  /** 移出隐藏定时器（200ms） */
  private outTimer: AnimationFrameID | null = null;
  /** 点赞按钮（点赞数与填充态的载体） */
  private likeBtn: HTMLDivElement | null = null;
  /** 点赞数文本节点 */
  private likeNumEl: HTMLDivElement | null = null;
  /** 已点赞的弹幕 id 集合（跨悬停保留点赞态，重新悬停时恢复图标形态） */
  private likedIds = new Set<string>();
  /** toast 提示元素（懒创建，挂载于覆盖层） */
  private toast: HTMLDivElement | null = null;
  /** 操作回调（插件层注入） */
  private handlers: DanmakuTipHandlers;

  constructor(container: HTMLElement, handlers: DanmakuTipHandlers = {}) {
    this.wrap = document.createElement("div");
    this.wrap.className = "nova-player-dm-tip-wrap";
    container.appendChild(this.wrap);
    this.handlers = handlers;
  }

  /**
   * 展示操作条（悬停回调触发）
   *
   * 暂停时序：hover 命中瞬间立即挂 danmaku-x-paused（"移上去立即停止"），
   * 弹幕停在鼠标下方不动，锚点即最终停点；300ms 防抖仅控制 Tip 显隐。
   * inTip 守卫：鼠标在操作条内交互期间，路过的弹幕不得劫持 Tip
   * （重定位/换目标会打断按钮点击与气泡展示）。
   * @param item 悬停的弹幕（引擎内部渲染项）
   * @param position 弹幕底部中心坐标（相对弹幕容器，命中瞬间计算，弹幕已停不漂移）
   */
  show(item: DanmakuRenderItem, position: { x: number; y: number }): void {
    // inTip 守卫：操作条内交互中——不被新弹幕劫持
    if (this.inTip) return;
    // movingToTip 通道守卫：移向操作条途中（200ms 窗口）仅放行原弹幕
    // 回归（快速移回时 Tip 恢复展示），其他弹幕不得劫持
    if (this.movingToTip) {
      if (item !== this.currentItem) return;
      this.movingToTip = false;
    }
    // 取消移出隐藏（快速 out→in 切换时保证展示不中断）
    cancelRaf(this.outTimer!);
    // 取消旧展示防抖（连续 hover 命中时旧回调存活会重复触发显示逻辑
    // 并连锁覆盖 inTimer，造成新一套泄漏，同样无法被 mouseenter 取消）
    cancelRaf(this.delayTimer!);
    // 立即挂起该弹幕：先暂停后展示 Tip，位置与鼠标所见一致
    this.bindItem(item);
    this.delayTimer = rafTimeout(() => {
      if (!this.isShow) {
        if (!this.tip) {
          this.initTip();
        }
        if (this.tip) {
          this.position(position);
          this.applyItemState();
          this.tip.classList.remove("nova-player-hide");
        }
        this.isShow = true;
      } else {
        // 已展示：直接换目标位置并同步身份/点赞态
        this.position(position);
        this.applyItemState();
      }
      cancelRaf(this.inTimer!);
      this.inTimer = rafTimeout(() => this.hide(), 2000);
    }, 300);
  }

  /**
   * 隐藏操作条（离开弹幕 / 超时 / 离开操作条触发）
   *
   * 恢复时序对齐原版：200ms 防抖回调内才解除暂停并隐藏 Tip——
   * 立即解除会让弹幕在鼠标移向 Tip 的途中飞走（观感即「Tip 被关闭」），
   * 200ms 也正好覆盖「弹幕 → Tip」的鼠标移动通道（Tip mouseenter 会
   * 取消本定时器）。
   * inTip 守卫：鼠标在操作条内交互期间不隐藏（引擎 hover 空回调 /
   * 自动隐藏定时器均不得打断按钮点击与气泡展示）。
   */
  hide(): void {
    if (this.inTip) return;
    cancelRaf(this.delayTimer!);
    cancelRaf(this.inTimer!);
    // 取消旧 outTimer：移向 Tip 途中 mouseout(弹幕) 与 mouseleave(弹幕层)
    // 会连续两次触发 hide()，若直接覆盖引用则旧定时器成为无法被 Tip
    // mouseenter 取消的「幽灵定时器」，200ms 后照样强制隐藏——观感即
    // 「移到 Tip 上约 0.2 秒后消失、按钮图标全部点不了」
    cancelRaf(this.outTimer!);
    // 打开「弹幕 → 操作条」移动通道：200ms 内鼠标进入操作条则由
    // mouseenter 取消本定时器保持展示；通道内路过的弹幕被 show 守卫忽略
    this.movingToTip = true;
    this.outTimer = rafTimeout(() => {
      this.movingToTip = false;
      // inTip 兜底守卫：即便存在未取消干净的历史定时器（竞态），
      // 鼠标在操作条内交互期间也绝不隐藏——按钮点击与气泡展示不被打断
      if (this.inTip) return;
      this.tip?.classList.add("nova-player-hide");
      this.isShow = false;
      this.releaseItem();
    }, 200);
  }

  /** 销毁：清理定时器并移除覆盖层 */
  destroy(): void {
    cancelRaf(this.delayTimer!);
    cancelRaf(this.inTimer!);
    cancelRaf(this.outTimer!);
    this.inTip = false;
    this.movingToTip = false;
    this.releaseItem();
    this.wrap.remove();
  }

  /**
   * 懒创建操作条 DOM
   * 结构与原版一致：svgm/svgl 为底板装饰，like/likeNum/copy/recall/back
   * 为操作按钮；新增 bubbles（按钮悬停文字气泡）与实心点赞图标。
   * 样式全部由 danmaku.scss 的 .nova-player-dm-tip 家族提供。
   */
  private initTip(): void {
    const tip = document.createElement("div");
    tip.className = "nova-player-dm-tip nova-player-showB";
    // 结构与原版一致：svgm/svgl 为底板装饰，like/copy/recall/back 为操作按钮
    const svgM = document.createElement("div");
    svgM.className = "nova-player-dm-tip-svgm";
    svgM.innerHTML = TIP_SVG_M;
    const svgL = document.createElement("div");
    svgL.className = "nova-player-dm-tip-svgl";
    svgL.innerHTML = TIP_SVG_L;

    const like = document.createElement("div");
    like.className = "nova-player-dm-tip-like";
    // 描边版 + 实心版双 SVG：默认展示描边版，点赞后经
    // nova-player-dm-tip-liked 类切换为实心填充白（CSS 控制显隐）
    like.innerHTML = TIP_LIKE + TIP_LIKE_FILLED;
    const likeNum = document.createElement("div");
    likeNum.className = "nova-player-dm-tip-like-num";
    likeNum.textContent = "0";

    // 点赞点击：切换点赞态（+1 / -1）、切换图标填充形态、同步弹幕文字
    // 前置的点赞图标（挂/摘 danmaku-x-liked 类，初始渲染 like>0 同一
    // 机制）并外抛回调
    const handleLikeClick = (e: Event): void => {
      e.stopPropagation();
      const item = this.currentItem;
      if (!item) return;
      const key = String(item.id);
      const liked = !this.likedIds.has(key);
      if (liked) {
        this.likedIds.add(key);
      } else {
        this.likedIds.delete(key);
      }
      item.like = Math.max(0, (item.like ?? 0) + (liked ? 1 : -1));
      // 同步弹幕元素上的点赞图标：点赞即点亮；取消后计数归零才熄灭
      // （他人点赞数仍在的弹幕，仅撤销本人那一次时不熄灭图标）
      if (item.element) {
        if (liked) {
          item.element.classList.add("danmaku-x-liked");
        } else if ((item.like ?? 0) <= 0) {
          item.element.classList.remove("danmaku-x-liked");
        }
      }
      this.applyLikeState();
      this.handlers.onLike?.(item, liked);
    };
    like.addEventListener("click", handleLikeClick);
    likeNum.addEventListener("click", handleLikeClick);

    const copy = document.createElement("div");
    copy.className = "nova-player-dm-tip-copy";
    copy.innerHTML = TIP_COPY;
    copy.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.copyText();
    });

    const recall = document.createElement("div");
    recall.className = "nova-player-dm-tip-recall";
    recall.innerHTML = TIP_RECALL;
    recall.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = this.currentItem;
      if (!item) return;
      // 撤回后弹幕即从画面移除，Tip 直接走隐藏流程
      this.handlers.onRecall?.(item);
      this.inTip = false;
      this.hide();
    });

    const back = document.createElement("div");
    back.className = "nova-player-dm-tip-back";
    back.innerHTML = TIP_BACK;
    back.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = this.currentItem;
      if (item) {
        this.handlers.onReport?.(item);
      }
    });

    // 按钮悬停文字气泡：纯 CSS 底板（黑底圆角 + 上三角尾尖指向按钮），
    // 经 CSS 定位在对应按钮正下方按按钮中心对齐；
    // svgl/svgm 是弹幕操作条本体外框的两场景形态，不用于子图标气泡
    const bubbles = document.createElement("div");
    bubbles.className = "nova-player-dm-tip-bubbles";
    const makeBubble = (name: string, label: string): HTMLDivElement => {
      const bubble = document.createElement("div");
      bubble.className = `nova-player-dm-tip-bubble nova-player-dm-tip-bubble-${name}`;
      const text = document.createElement("span");
      text.className = "nova-player-dm-tip-bubble-text";
      text.textContent = label;
      bubble.appendChild(text);
      return bubble;
    };
    const likeBubble = makeBubble("like", "点赞");
    const copyBubble = makeBubble("copy", "复制");
    const recallBubble = makeBubble("recall", "撤回");
    const reportBubble = makeBubble("report", "举报");
    bubbles.append(likeBubble, copyBubble, recallBubble, reportBubble);

    // 悬停触发气泡显隐（点赞数与点赞图标同属一个热区）
    const bindBubble = (targets: HTMLElement[], bubble: HTMLElement): void => {
      targets.forEach((target) => {
        target.addEventListener("mouseenter", () => {
          this.hideBubbles();
          bubble.classList.add("nova-player-dm-tip-bubble-show");
        });
        target.addEventListener("mouseleave", () => {
          bubble.classList.remove("nova-player-dm-tip-bubble-show");
        });
      });
    };
    bindBubble([like, likeNum], likeBubble);
    bindBubble([copy], copyBubble);
    bindBubble([recall], recallBubble);
    bindBubble([back], reportBubble);

    tip.append(svgM, svgL, like, likeNum, copy, recall, back, bubbles);
    // 点击不冒泡到播放器（避免误触播放/暂停），原版同款处理
    tip.addEventListener("click", (e) => e.stopPropagation());
    // 鼠标移入操作条（原版 inTip）：取消移出/自动隐藏定时器并关闭移动
    // 通道——Tip 内部交互期间不自动隐藏、不被路过的弹幕劫持（此前 2s
    // 定时器在按钮间移动时不续期，操作到一半 Tip 被强制隐藏）
    tip.addEventListener("mouseenter", () => {
      this.inTip = true;
      this.movingToTip = false;
      cancelRaf(this.outTimer!);
      cancelRaf(this.inTimer!);
    });
    // 鼠标移出操作条：恢复常规隐藏流程（原版 mouseleave → hideDmTip）
    tip.addEventListener("mouseleave", () => {
      this.inTip = false;
      this.hide();
    });

    this.wrap.appendChild(tip);
    this.tip = tip;
    this.likeBtn = like;
    this.likeNumEl = likeNum;
  }

  /** 隐藏全部按钮气泡（切换按钮前先清场） */
  private hideBubbles(): void {
    this.tip
      ?.querySelectorAll(".nova-player-dm-tip-bubble-show")
      .forEach((node) => node.classList.remove("nova-player-dm-tip-bubble-show"));
  }

  /**
   * 同步当前弹幕在 Tip 上的展示态：本人弹幕身份（撤回图标）+ 点赞数与填充形态
   */
  private applyItemState(): void {
    const item = this.currentItem;
    if (!this.tip || !item) return;
    // 本人弹幕（uid=1）：挂 tip-master 显示撤回图标、隐藏举报图标
    const isSelf = item.uid === 1 || item.uid === "1";
    this.tip.classList.toggle("nova-player-dm-tip-master", isSelf);
    this.applyLikeState();
  }

  /** 同步点赞数文本与图标填充形态（按 likedIds 中当前弹幕的点赞态） */
  private applyLikeState(): void {
    const item = this.currentItem;
    if (!this.likeBtn || !this.likeNumEl || !item) return;
    this.likeNumEl.textContent = String(item.like ?? 0);
    this.likeBtn.classList.toggle(
      "nova-player-dm-tip-liked",
      this.likedIds.has(String(item.id)),
    );
  }

  /**
   * 定位操作条：锚点为弹幕底部中心，尾尖指向弹幕
   * - 常规场景：svgm 底板（尾尖在操作条中心 x≈81.5），操作条中心对准
   *   弹幕，左右边界钳制半宽 81px（原版逻辑）
   * - 弹幕靠左场景（pos.x < 半宽，中心尾尖会被钳制拉离弹幕）：切换 svgl
   *   底板（尾尖偏左，SVG 145×42 经 162/145 宽度缩放后位于条内 x≈29.8），
   *   操作条左移使尾尖对准弹幕中心，再做边界钳制（盒不越出画面）
   */
  private position(pos: { x: number; y: number }): void {
    if (!this.tip) return;
    const halfWidth = TIP_WIDTH / 2;
    const width = this.wrap.clientWidth || halfWidth * 2;
    // svgl 尾尖对准偏移：尾尖容器坐标 = left - halfWidth + tailOffset，
    // 令尾尖 = 弹幕 x → left = pos.x + (halfWidth - tailOffset)
    const svglTailOffset = 26.65 * (TIP_WIDTH / 145);
    // 弹幕靠画面左侧：svgm 中心尾尖无法对准 → 切 svgl（尾尖偏左）
    const useLeft = pos.x < halfWidth;
    this.tip.classList.toggle("nova-player-dm-tip-left", useLeft);
    // svgl 场景操作条左移使尾尖对准弹幕中心；svgm 场景操作条中心对准弹幕
    const center = useLeft ? pos.x + (halfWidth - svglTailOffset) : pos.x;
    // 左右边界钳制：操作条中心不许越出画面半宽
    const left = Math.min(
      Math.max(center, halfWidth),
      Math.max(width - halfWidth, halfWidth),
    );
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${pos.y}px`;
  }

  /**
   * 绑定新弹幕：解除旧弹幕的暂停类，给新弹幕挂 danmaku-x-paused（原版类机制）
   */
  private bindItem(item: DanmakuRenderItem): void {
    if (this.currentItem && this.currentItem !== item) {
      this.currentItem.element?.classList.remove("danmaku-x-paused");
    }
    this.currentItem = item;
    item.element?.classList.add("danmaku-x-paused");
  }

  /** 解除当前弹幕的暂停类并清空引用 */
  private releaseItem(): void {
    this.currentItem?.element?.classList.remove("danmaku-x-paused");
    this.currentItem = null;
  }

  /**
   * 复制当前弹幕文本：优先剪贴板 API，不可用时降级 execCommand；
   * 结果经 toast 提示（「复制成功」），成功后外抛回调
   */
  private async copyText(): Promise<void> {
    const text = this.currentItem?.text;
    const item = this.currentItem;
    if (!text || !item) return;
    let success = false;
    try {
      await navigator.clipboard.writeText(text);
      success = true;
    } catch {
      success = this.legacyCopy(text);
    }
    this.showToast(success ? "复制成功" : "复制失败");
    if (success) {
      this.handlers.onCopy?.(item);
    }
  }

  /** 剪贴板 API 不可用时的兜底（非安全上下文 / 权限被拒） */
  private legacyCopy(text: string): boolean {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    textarea.remove();
    return ok;
  }

  /** 展示 toast 提示（覆盖层居中，动画结束自动回到隐藏态） */
  private showToast(text: string): void {
    if (!this.toast) {
      this.toast = document.createElement("div");
      this.toast.className = "nova-player-dm-toast";
      this.wrap.appendChild(this.toast);
    }
    this.toast.textContent = text;
    this.toast.classList.remove("nova-player-dm-toast-show");
    // 读取 offsetWidth 强制回流，保证连续触发时动画能重新起播
    void this.toast.offsetWidth;
    this.toast.classList.add("nova-player-dm-toast-show");
  }
}
