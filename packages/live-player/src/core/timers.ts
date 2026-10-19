/**
 * 统一计时器注册表。
 *
 * 直播播放器里的所有延时任务（控制条自动隐藏、面板 hover 关闭、Toast、
 * 信息面板采样、音量浮层）都登记到同一张按 key 索引的表里：
 * - 同一个 key 只保留一个待执行任务，重复调度前先清除旧任务；
 * - 组件 `disconnectedCallback()` / `destroy()` 时调用 `clearAll()` 统一清理，
 *   不会出现「元素已移除、计时器还在回写状态」的悬挂任务；
 * - `debounce()` 与点播播放器 `@/nova/utils` 的 debounce 语义一致（延迟期间
 *   重复调用重新计时），额外提供统一清理能力。
 */

/** 计时器键（每个延时任务一个稳定 key）。 */
export type LiveTimerKey = string;

/** 计时器注册表。 */
export class LiveTimerRegistry {
  /** 延时任务（key → handle）。 */
  private readonly timeouts = new Map<LiveTimerKey, ReturnType<typeof setTimeout>>();

  /** 周期任务（key → handle）。 */
  private readonly intervals = new Map<LiveTimerKey, ReturnType<typeof setInterval>>();

  /**
   * 登记一个延时任务；同 key 的旧任务会先被清除。
   *
   * @param key - 任务键。
   * @param handler - 到期执行的回调。
   * @param delay - 延时（毫秒）。
   */
  setTimeout(key: LiveTimerKey, handler: () => void, delay: number): void {
    this.clearTimeout(key);
    const handle = setTimeout((): void => {
      this.timeouts.delete(key);
      handler();
    }, delay);
    this.timeouts.set(key, handle);
  }

  /**
   * 清除一个延时任务。
   *
   * @param key - 任务键。
   */
  clearTimeout(key: LiveTimerKey): void {
    const handle = this.timeouts.get(key);
    if (handle === undefined) return;
    clearTimeout(handle);
    this.timeouts.delete(key);
  }

  /**
   * 判断某个延时任务是否仍在等待执行。
   *
   * @param key - 任务键。
   * @returns 是否存在待执行任务。
   */
  hasPendingTimeout(key: LiveTimerKey): boolean {
    return this.timeouts.has(key);
  }

  /**
   * 登记一个周期任务；同 key 的旧任务会先被清除。
   *
   * @param key - 任务键。
   * @param handler - 每个周期执行的回调。
   * @param delay - 周期（毫秒）。
   */
  setInterval(key: LiveTimerKey, handler: () => void, delay: number): void {
    this.clearInterval(key);
    this.intervals.set(
      key,
      setInterval((): void => {
        handler();
      }, delay),
    );
  }

  /**
   * 清除一个周期任务。
   *
   * @param key - 任务键。
   */
  clearInterval(key: LiveTimerKey): void {
    const handle = this.intervals.get(key);
    if (handle === undefined) return;
    clearInterval(handle);
    this.intervals.delete(key);
  }

  /**
   * 生成一个受管理的防抖函数。
   *
   * 与点播播放器 `debounce` 的差异只有两点：任务登记在注册表里、
   * 卸载时可被 `clearAll()` 取消；延迟期间重复调用仍然重新计时。
   *
   * @param key - 任务键。
   * @param handler - 防抖后执行的回调。
   * @param delay - 防抖延时（毫秒）。
   * @returns 防抖包装函数。
   */
  debounce<TArgs extends unknown[]>(
    key: LiveTimerKey,
    handler: (...args: TArgs) => void,
    delay: number,
  ): (...args: TArgs) => void {
    return (...args: TArgs): void => {
      this.setTimeout(key, (): void => handler(...args), delay);
    };
  }

  /** 清除全部任务（延时 + 周期）。 */
  clearAll(): void {
    for (const handle of this.timeouts.values()) clearTimeout(handle);
    this.timeouts.clear();
    for (const handle of this.intervals.values()) clearInterval(handle);
    this.intervals.clear();
  }
}
