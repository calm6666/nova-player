/**
 * ============================================
 * 流媒体插件私有事件总线
 * ============================================
 * HLS / DASH / FLV 三个流媒体插件共用的私有事件载体。
 *
 * 为什么需要它与播放器总线分开：
 * - 播放器总线的事件契约（PlayerEventEnum / PlayerEventMap）是唯一对外承诺，
 *   规则 R3 要求实现里不得向 player.events emit 契约未声明的事件；
 * - StreamPluginEventEnum（@/types/streamPlugin）里的键多为大写前缀形式
 *   （如 STREAM_STATS_UPDATE），不属于契约键；
 * - 因此插件把这类上报发到本私有总线，只把契约事件
 *   （PlayerEventEnum.STREAM_ERROR / PlayerEventEnum.STREAM_QUALITY_CHANGE）
 *   继续发给 player.events。
 *
 * 消费方式：插件实例上的 getStreamEventBus() 返回本总线的只读入口。
 *
 * @module stream/streamEventBus
 */

import { createTypedEventBus } from '@lumina/framework/core/eventBus';
import type { TypedEventBus } from '@lumina/framework/core/eventBus';
import { StreamPluginEventEnum } from '@lumina/nova';
import type { MediaManifestSource, StreamStats } from '@lumina/nova';

/**
 * 无业务含义的事件载荷
 * 这些事件改造前实际 emit 的就是空对象 `{}`，此处保持同一形态，
 * 避免消费方收到的载荷发生变化
 */
export type EmptyStreamPayload = Record<string, never>;

/**
 * 流媒体插件私有事件映射表
 * 键取自 StreamPluginEventEnum（大写前缀值），值为改造前实际 emit 的载荷类型
 *
 * 注意：StreamPluginEventEnum.QUALITY_CHANGE 的值 'streamQualityChange'
 * 恰好等于契约键，因此它不属于私有总线（下方刻意不收录该键，
 * 误用会在编译期报错），而是走 PlayerEventEnum.STREAM_QUALITY_CHANGE。
 */
export type StreamPluginEventMap = {
  /** 加载完成（URL 模式 / 对象注入 / 原生 HLS 回退），payload 为源 */
  [StreamPluginEventEnum.LOAD_COMPLETE]: { url: string | MediaManifestSource };
  /** 元数据就绪（各库原生数据：hls.js 清单数据 / flv.js mediaInfo / 空对象） */
  [StreamPluginEventEnum.METADATA_LOADED]: unknown;
  /** 开始播放 */
  [StreamPluginEventEnum.PLAY_START]: EmptyStreamPayload;
  /** 播放暂停 */
  [StreamPluginEventEnum.PLAY_PAUSE]: EmptyStreamPayload;
  /** 缓冲开始 */
  [StreamPluginEventEnum.BUFFER_START]: EmptyStreamPayload;
  /** 缓冲结束 */
  [StreamPluginEventEnum.BUFFER_END]: EmptyStreamPayload;
  /** 统计信息更新（getStats() 的返回值） */
  [StreamPluginEventEnum.STATS_UPDATE]: Partial<StreamStats>;
  /** 网络错误（透传各库原生错误数据） */
  [StreamPluginEventEnum.NETWORK_ERROR]: unknown;
  /** 解码错误（透传各库原生错误数据） */
  [StreamPluginEventEnum.DECODE_ERROR]: unknown;
  /** 通用流媒体错误（既有形态：{ message } / { type, detail, retryCount } 等） */
  [StreamPluginEventEnum.ERROR]: unknown;
};

/** 流媒体插件私有事件总线类型 */
export type StreamPluginEventBus = TypedEventBus<StreamPluginEventMap>;

/**
 * 创建流媒体插件私有事件总线
 * 每个插件实例各持一条，互不串扰；事件只在插件内部与显式订阅者之间流转
 *
 * @returns 受 StreamPluginEventMap 约束的类型安全事件总线
 */
export function createStreamPluginEventBus(): StreamPluginEventBus {
  return createTypedEventBus<StreamPluginEventMap>();
}
