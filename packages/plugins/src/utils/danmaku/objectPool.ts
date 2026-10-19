/**
 * 高性能弹幕系统 - 对象池
 * 用于复用弹幕DOM元素和Canvas对象，减少GC压力
 */

import { type DanmakuRenderItem, DanmakuType } from './types';

/** 对象池配置 */
interface ObjectPoolConfig {
  /** 初始容量 */
  initialCapacity: number;
  /** 最大容量 */
  maxCapacity: number;
  /** 自动扩展步长 */
  expandStep: number;
}

/** DOM元素对象池 */
export class DOMElementPool {
  private pool: HTMLElement[] = [];
  private inUse: Set<HTMLElement> = new Set();
  private config: ObjectPoolConfig;

  constructor(config: Partial<ObjectPoolConfig> = {}) {
    this.config = {
      initialCapacity: 100,
      maxCapacity: 1000,
      expandStep: 50,
      ...config,
    };
    this.initPool();
  }

  /** 初始化池 */
  private initPool(): void {
    for (let i = 0; i < this.config.initialCapacity; i++) {
      this.pool.push(this.createElement());
    }
  }

  /** 创建新元素（外观由使用方 danmaku.scss 的 .danmaku-x-dm 类体系提供） */
  private createElement(): HTMLElement {
    const el = document.createElement('div');
    // 仅作池内标记类，不携带任何样式
    el.className = 'danmaku-item';
    return el;
  }

  /** 获取元素 */
  acquire(): HTMLElement {
    let el: HTMLElement | undefined;

    if (this.pool.length > 0) {
      el = this.pool.pop();
    } else if (this.inUse.size < this.config.maxCapacity) {
      el = this.createElement();
    } else {
      // 达到最大容量，复用最旧的元素
      const oldest = this.inUse.values().next().value;
      if (oldest) {
        this.inUse.delete(oldest);
        el = oldest;
      }
    }
    if (!el) {
      // 理论上不应该执行到这里，但作为兜底逻辑
      throw new Error('Failed to acquire element from pool');
    }

    if (el) {
      this.inUse.add(el);
      // 重置元素状态：清空全部内联样式与 CSS 变量，外观由使用方重新以类+变量设置
      el.removeAttribute('style');
      el.textContent = '';
      el.className = 'danmaku-item';
    }

    return el;
  }

  /** 释放元素 */
  release(el: HTMLElement): void {
    if (this.inUse.has(el)) {
      this.inUse.delete(el);
      // 清理元素：清空全部内联样式与 CSS 变量（含动画进度等运行态），防止复用残留
      el.removeAttribute('style');
      el.textContent = '';
      el.className = 'danmaku-item';

      if (this.pool.length < this.config.maxCapacity) {
        this.pool.push(el);
      }
    }
  }

  /** 释放所有元素 */
  releaseAll(): void {
    this.inUse.forEach((el) => {
      el.removeAttribute('style');
      el.textContent = '';
      el.className = 'danmaku-item';
      this.pool.push(el);
    });
    this.inUse.clear();
  }

  /** 获取使用率 */
  getUsage(): number {
    return this.inUse.size / (this.pool.length + this.inUse.size);
  }

  /** 获取统计信息 */
  getStats(): { poolSize: number; inUse: number; total: number } {
    return {
      poolSize: this.pool.length,
      inUse: this.inUse.size,
      total: this.pool.length + this.inUse.size,
    };
  }

  /** 销毁池 */
  destroy(): void {
    this.pool.forEach((el) => {
      el.remove();
    });
    this.inUse.forEach((el) => {
      el.remove();
    });
    this.pool = [];
    this.inUse.clear();
  }
}

/** 弹幕渲染项对象池 */
export class DanmakuItemPool {
  private pool: DanmakuRenderItem[] = [];
  private inUse: Map<string, DanmakuRenderItem> = new Map();
  private config: ObjectPoolConfig;
  private idCounter = 0;

  constructor(config: Partial<ObjectPoolConfig> = {}) {
    this.config = {
      initialCapacity: 200,
      maxCapacity: 2000,
      expandStep: 100,
      ...config,
    };
    this.initPool();
  }

  /** 初始化池 */
  private initPool(): void {
    for (let i = 0; i < this.config.initialCapacity; i++) {
      this.pool.push(this.createItem());
    }
  }

  /** 创建新项 */
  private createItem(): DanmakuRenderItem {
    return {
      id: '',
      text: '',
      time: 0,
      type: DanmakuType.SCROLL,
      renderId: '',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      speed: 0,
      trackIndex: -1,
      isRendering: false,
      createTime: 0,
      duration: 0,
    };
  }

  /** 生成渲染ID */
  private generateRenderId(): string {
    return `dm_${Date.now()}_${++this.idCounter}`;
  }

  /** 获取渲染项 */
  acquire(source: Partial<DanmakuRenderItem>): DanmakuRenderItem | null {
    let item: DanmakuRenderItem | undefined;

    // 1. 从空闲池取
    const pooled = this.pool.pop();
    if (pooled) {
      item = pooled;
    }
    // 2. 未达上限则新建
    else if (this.inUse.size < this.config.maxCapacity) {
      item = this.createItem();
    }

    // 3. 池满，无法获取
    else {
      return null;
    }

    // if (this.pool.length > 0) {
    //   item = this.pool.pop()!;
    // } else if (this.inUse.size < this.config.maxCapacity) {
    //   item = this.createItem();
    // } else {
    //   // 达到最大容量，返回null
    //   return null as any;
    // }

    // 重置并填充数据
    // getElapsedTime 显式随 source 赋值：回收项可能残留上一个引擎（DOM）的
    // 动画进度读取器，被 Canvas 引擎复用时必须清空，否则轨道占用会读到
    // 已不属于该渲染项的 DOM 动画进度。
    Object.assign(item, source, {
      renderId: this.generateRenderId(),
      isRendering: true,
      createTime: performance.now(),
      getElapsedTime: source.getElapsedTime,
    });

    this.inUse.set(item.renderId, item);
    return item;
  }

  /** 释放渲染项 */
  release(renderId: string): void {
    const item = this.inUse.get(renderId);
    if (item) {
      this.inUse.delete(renderId);

      // 重置状态
      item.isRendering = false;
      item.element = undefined;
      // 动画进度读取器随渲染项生命周期结束：避免闭包继续持有已回收的 DOM 元素
      item.getElapsedTime = undefined;

      if (this.pool.length < this.config.maxCapacity) {
        this.pool.push(item);
      }
    }
  }

  /** 根据渲染ID获取项 */
  get(renderId: string): DanmakuRenderItem | undefined {
    return this.inUse.get(renderId);
  }

  /** 获取所有正在使用的项 */
  getAllInUse(): DanmakuRenderItem[] {
    return Array.from(this.inUse.values());
  }

  /** 获取使用率 */
  getUsage(): number {
    return this.inUse.size / (this.pool.length + this.inUse.size);
  }

  /** 获取统计信息 */
  getStats(): { poolSize: number; inUse: number; total: number } {
    return {
      poolSize: this.pool.length,
      inUse: this.inUse.size,
      total: this.pool.length + this.inUse.size,
    };
  }

  /** 清理 */
  clear(): void {
    this.inUse.clear();
    this.pool = [];
    this.initPool();
  }
}

/** Canvas对象池 */
export class CanvasPool {
  private pool: HTMLCanvasElement[] = [];
  private contexts: Map<HTMLCanvasElement, CanvasRenderingContext2D> = new Map();
  private config: ObjectPoolConfig;

  constructor(config: Partial<ObjectPoolConfig> = {}) {
    this.config = {
      initialCapacity: 5,
      maxCapacity: 20,
      expandStep: 3,
      ...config,
    };
    this.initPool();
  }

  /** 初始化池 */
  private initPool(): void {
    for (let i = 0; i < this.config.initialCapacity; i++) {
      this.pool.push(this.createCanvas());
    }
  }

  /** 创建Canvas */
  private createCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', {
      alpha: true,
      willReadFrequently: false,
    });
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context from canvas');
    }
    this.contexts.set(canvas, ctx);
    return canvas;
  }

  /** 获取Canvas */
  acquire(
    width: number,
    height: number
  ): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    let canvas: HTMLCanvasElement;

    // if (this.pool.length > 0) {
    //   canvas = this.pool.pop()!;
    // } else {
    //   canvas = this.createCanvas();
    // }

    // 1. 安全地获取 canvas
    const pooled = this.pool.pop();
    if (pooled) {
      canvas = pooled;
    } else {
      canvas = this.createCanvas();
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = this.contexts.get(canvas);
    if (!ctx) {
      const newCtx = canvas.getContext('2d', {
        alpha: true,
        willReadFrequently: false,
      });
      if (!newCtx) {
        throw new Error('Failed to get 2D context from canvas');
      }
      this.contexts.set(canvas, newCtx);
      newCtx.clearRect(0, 0, width, height);
      return { canvas, ctx: newCtx };
    }
    ctx.clearRect(0, 0, width, height);

    return { canvas, ctx };
  }

  /** 释放Canvas */
  release(canvas: HTMLCanvasElement): void {
    if (this.pool.length < this.config.maxCapacity) {
      this.pool.push(canvas);
    }
  }

  /** 销毁池 */
  destroy(): void {
    this.pool = [];
    this.contexts.clear();
  }
}
