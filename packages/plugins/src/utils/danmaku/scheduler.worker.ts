/**
 * Worker 内部只保存调度所需的最小数据。
 *
 * 文本、颜色、字号等渲染字段仍保留在主线程，Worker 只传递稳定 key，
 * 这样可以显著减少 structured clone 的数据量，也避免 Worker 参与 DOM/Canvas 绘制。
 */
type WorkerItem = { key: string; time: number };

/** 按时间排序的弹幕索引。数组越界和查找均只发生在 Worker 线程。 */
const items: WorkerItem[] = [];

/**
 * 已经发给主线程的弹幕 key。
 * 时间窗口会在多帧之间重叠，因此必须在 Worker 内去重，避免主线程重复创建弹幕。
 */
const emitted = new Set<string>();

/**
 * Worker 消息入口。
 * 消息协议：
 * - add：批量追加时间索引；
 * - markEmitted：主线程已立即渲染的弹幕 key，标记后查询不再重复发射；
 * - query：查询时间窗口内尚未发射的弹幕；
 * - reset：只清理发射状态，保留已加载数据（用于 seek/clear 渲染层）；
 * - clear：清理数据和发射状态（用于 scheduler.reset）；
 * - dispose：关闭 Worker。
 */
self.onmessage = (event: MessageEvent): void => {
  const message = event.data as {
    type: 'add' | 'markEmitted' | 'query' | 'reset' | 'clear' | 'dispose';
    items?: WorkerItem[];
    keys?: string[];
    startTime?: number;
    endTime?: number;
    limit?: number;
    requestId?: number;
  };

  if (message.type === 'add' && message.items) {
    // 主线程会尽量批量发送，减少 Worker 消息数量。
    items.push(...message.items);
    // add 可能来自不同分段，保持全局有序才能使用二分查找。
    items.sort((a, b) => a.time - b.time);
    return;
  }

  if (message.type === 'markEmitted' && message.keys) {
    // 本地发送的弹幕已由主线程立即渲染，标记后查询窗口不会再次发射，
    // 避免「发送一条弹幕、屏幕显示两条」的重复渲染问题。
    for (const key of message.keys) {
      emitted.add(key);
    }
    return;
  }

  if (message.type === 'reset') {
    emitted.clear();
    return;
  }

  if (message.type === 'clear') {
    items.length = 0;
    emitted.clear();
    return;
  }

  if (message.type === 'dispose') {
    self.close();
    return;
  }

  if (message.type === 'query') {
    const start = message.startTime ?? 0;
    const end = message.endTime ?? start;
    const limit = message.limit ?? 10;
    // 找到第一个 time >= start 的元素，避免从分段头部线性扫描。
    let low = 0;
    let high = items.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (items[mid].time < start) low = mid + 1;
      else high = mid;
    }

    const result: string[] = [];
    for (let i = low; i < items.length && result.length < limit; i++) {
      const item = items[i];
      if (item.time > end) break;
      // 同一条弹幕可能连续多个帧处于查询窗口中，只允许发射一次。
      if (emitted.has(item.key)) continue;
      emitted.add(item.key);
      result.push(item.key);
    }
    // 只回传 key；主线程通过 key 找回完整 DanmakuItem，再交给渲染引擎。
    self.postMessage({ type: 'result', requestId: message.requestId, keys: result });
  }
};
