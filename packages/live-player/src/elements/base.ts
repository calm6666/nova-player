/**
 * 自定义元素基类。
 *
 * 所有自定义元素内部统一使用 Lumina 框架的声明式 VNode 写法：
 * `render()` 返回 VNode，由基类负责 `mount` / `destroy`，
 * 元素自身不再手写 `document.createElement` 与手工拼装 DOM。
 *
 * 服务端没有 `HTMLElement` 时退化为空基类，注册函数为 no-op。
 */

import { destroy as destroyVNode, mount as mountVNode } from '@/core';
import type { VNode } from '@/types';

/**
 * SSR 安全的 HTMLElement 基类（浏览器中就是原生 `HTMLElement`）。
 */
export const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

/** 自定义元素基类。 */
export abstract class NovaLiveUiElement extends HTMLElementBase {
  /** 当前挂载的视图。 */
  private viewVNode: VNode | null = null;

  /** 子类返回视图（框架 VNode）。 */
  protected abstract render(): VNode;

  /** 元素连接到文档后的副作用（非渲染）。 */
  protected onConnect(): void {
    // 默认无副作用。
  }

  /** 元素离开文档或销毁时的副作用。 */
  protected onDisconnect(): void {
    // 默认无副作用。
  }

  /** 连接到文档：挂载视图并执行连接副作用。 */
  connectedCallback(): void {
    if (typeof window === 'undefined') return;
    this.mountView();
    this.onConnect();
  }

  /** 离开文档：释放视图与连接副作用。 */
  disconnectedCallback(): void {
    this.onDisconnect();
    this.destroyView();
  }

  /** 挂载视图。 */
  protected mountView(): void {
    if (this.viewVNode || typeof window === 'undefined') return;
    this.viewVNode = this.render();
    mountVNode(this.viewVNode, this);
  }

  /** 销毁视图。 */
  protected destroyView(): void {
    if (this.viewVNode) {
      destroyVNode(this.viewVNode);
      this.viewVNode = null;
    }
    this.replaceChildren();
  }

  /** 重建视图（用于语言切换或外部数据整体替换）。 */
  protected remountView(): void {
    this.destroyView();
    this.mountView();
  }
}
