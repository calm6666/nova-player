// 用于存储定时器相关信息的对象类型定义
interface TimerInfo {
  startTime: number | null;
  timerId: number | null;
  isCancelled: boolean;
}

// 存储所有正在运行的定时器信息的对象，以定时器ID作为键，对应的定时器信息对象作为值
const activeTimers: { [key: number]: TimerInfo } = {};

// 自定义的类似setInterval的函数，用于启动定时器，接收回调函数和时间间隔（单位毫秒）作为参数
export function rafInterval(callback: () => void, interval: number): number {
  const startTime: number | null = null;
  let timerId: number | null = null;
  const isCancelled: boolean = false;

  // 定义内部循环函数，实现定时执行的逻辑
  const loop = (timestamp: number): void => {
    if (timerId === null) return; // 确保 timerId 不为 null
    // 先判断activeTimers[timerId]是否存在且已初始化，如果不存在则直接返回，避免后续报错
    if (!activeTimers[timerId]) {
      return;
    }

    if (activeTimers[timerId].isCancelled) {
      return;
    }

    if (activeTimers[timerId].startTime === null) {
      activeTimers[timerId].startTime = timestamp;
    }

    // const elapsed = timestamp - activeTimers[timerId].startTime!;
    // if (elapsed >= interval) {
    //   callback();
    //   // 新增判断，确保定时器未被取消且对应的定时器信息对象存在且timerId不为null（完整性检查）
    //   if (
    //     activeTimers[timerId] && !activeTimers[timerId].isCancelled &&activeTimers[timerId].timerId !== null
    //   ) {
    //     activeTimers[timerId].startTime = timestamp;
    //   }
    // }

    // if (activeTimers[timerId] && !activeTimers[timerId].isCancelled) {
    //   activeTimers[timerId].timerId = requestAnimationFrame(loop);
    // }

    const timer = activeTimers[timerId];
    if (!timer || timer.isCancelled) {
      // 定时器不存在或已取消，停止继续调度
      return;
    }
    // if (timer.startTime === null) return
    if (timer.startTime === null) {
      timer.startTime = timestamp;
    }

    const elapsed = timestamp - timer.startTime;
    if (elapsed >= interval) {
      callback();
      // 回调可能已取消定时器，需要再次检查
      if (activeTimers[timerId] && !activeTimers[timerId].isCancelled) {
        activeTimers[timerId].startTime = timestamp;
      }
    }

    // 继续下一帧调度
    timer.timerId = requestAnimationFrame(loop);
  };

  // 启动定时器，获取并保存动画帧请求ID
  timerId = requestAnimationFrame(loop);

  // 将定时器相关信息存储到activeTimers对象中，方便后续查找和管理
  activeTimers[timerId] = { startTime, timerId, isCancelled };

  // 返回定时器的ID，这个ID将用于后续取消定时器时的标识
  return timerId;
}

// 自定义的类似clearRafInterval的函数，用于取消指定ID的定时器
export function clearRafInterval(timerId: number): void {
  if (activeTimers[timerId]) {
    // 将对应定时器的取消标记置为true
    activeTimers[timerId].isCancelled = true;
    if (activeTimers[timerId].timerId !== null) {
      // 取消动画帧请求
      cancelAnimationFrame(activeTimers[timerId].timerId);
      // 清除定时器相关信息对象中的timerId属性
      activeTimers[timerId].timerId = null;
      // 清除定时器相关信息对象中的startTime属性
      activeTimers[timerId].startTime = null;
    }
    // 从存储所有定时器信息的对象中删除该定时器的记录
    delete activeTimers[timerId];
  }
}
