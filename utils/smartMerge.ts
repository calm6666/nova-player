/**
 * ============================================
 * 配置合并工具函数
 * ============================================
 * 提供对象深度合并功能，并返回变更的属性列表。
 *
 * 合并语义：
 *   - 仅对「纯对象」递归合并；数组与原始值一律**整体替换**，
 *     不做按下标逐元素合并（lodash.merge 的行为会让多个 progressSegments
 *     按下标互相污染，属于已知陷阱，这里刻意规避）。
 *   - 源对象中值为 `undefined` 的键视为「未提供」，不覆盖默认值。
 *   - 不修改任何入参（defaults / source 都保持原样）。
 */

import type { MergeResult } from '@/nova/types';

/**
 * 判断是否为可递归合并的纯对象
 *
 * 排除：null、数组、Date、RegExp、Map/Set、DOM 节点等。
 * 其余带原型的对象（如 class 实例）也不递归，避免破坏其内部状态。
 *
 * @param value - 待判断的值
 * @returns 是否为可递归合并的纯对象
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date || value instanceof RegExp) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 深度合并两个对象
 *
 * - defaults 提供兜底值，source 中显式提供的值优先；
 * - 嵌套纯对象递归合并，因此传入部分字段不会丢掉同层的其他默认值；
 * - 数组整体替换（例如只传一个 progressSegments，结果就是这一个）。
 *
 * @param defaults - 默认值对象
 * @param source - 用户提供的覆盖值（可为 undefined）
 * @returns 合并后的新对象
 */
export function deepMerge<T extends Record<string, unknown>>(
  defaults: T,
  source?: Record<string, unknown> | null
): T {
  // 先把 defaults 复制一层，保证返回的是新对象、不污染入参
  const result: Record<string, unknown> = {};
  for (const key in defaults) {
    if (Object.prototype.hasOwnProperty.call(defaults, key)) {
      result[key] = defaults[key];
    }
  }

  if (source === undefined || source === null) {
    return result as T;
  }

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;

    const sourceValue = (source as Record<string, unknown>)[key];
    // undefined 视为「未提供」，保留默认值
    if (sourceValue === undefined) continue;

    const targetValue = result[key];

    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      // 数组、原始值、函数、类实例等一律整体替换
      result[key] = sourceValue;
    }
  }

  return result as T;
}

/**
 * 智能合并两个对象
 *
 * 在深合并的基础上，额外返回「顶层被覆盖的属性列表」，
 * 便于调用方只对变化项做后续处理（如增量更新 DOM）。
 *
 * @param target - 目标对象（默认值）
 * @param source - 源对象（覆盖值）
 * @returns 合并结果，包含合并后的对象与变更的属性列表
 */
export function smartMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>
): MergeResult<T> {
  const merged = deepMerge(target, source);

  const changedProps: Array<{
    key: string;
    oldVal: string | number | boolean | null;
    newVal: string | number | boolean | null;
  }> = [];

  for (const key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const newVal = source[key];
    if (newVal === undefined) continue;

    // 顶层值有实际变化才记录（嵌套对象按引用比较，语义为「被覆盖过」）
    const oldVal = target[key];
    if (oldVal !== newVal) {
      changedProps.push({
        key,
        oldVal: oldVal as string | number | boolean | null,
        newVal: newVal as string | number | boolean | null,
      });
    }
  }

  return { target: merged, changedProps };
}
