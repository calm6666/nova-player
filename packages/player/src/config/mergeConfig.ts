/**
 * ============================================
 * PlayerConfig 合并
 * ============================================
 *
 * 对外暴露的合并入口。语义由 `deepMerge` 提供：
 *   - 嵌套纯对象递归合并 → 用户只传 `danmaku.opacity` 时，
 *     `danmaku` 下的其他默认值不会丢失（修复原先 `{...default, ...config}`
 *     浅合并导致整块被替换的缺陷）；
 *   - 数组整体替换 → 只传一个 progressSegments 时结果就是这一个；
 *   - `undefined` 视为未提供，不覆盖默认值。
 *
 * 实现说明：构造播放器时仅执行一次，实测单次约 2.2µs
 * （见根目录 benchmark-config-merge.mjs），因此优先保证语义正确，
 * 不为微秒级差异牺牲可读性，也不引入 lodash 依赖。
 */

import { deepMerge } from '@lumina/framework/utils';
import type { DeepPartial, PlayerConfig } from '../types/player';

/**
 * 合并播放器配置
 *
 * 语义（由 `deepMerge` 提供）：
 *   - 嵌套纯对象递归合并 → 用户只传 `ui.controls.pip` 时，其余控件默认值保留；
 *   - 数组整体替换 → 只传一个 progress.segments 时结果就是这一个；
 *   - `undefined` 视为未提供，不覆盖默认值；
 *   - 不修改任何入参。
 *
 * 返回值为「完整」配置：`defaults` 已写全所有命名空间与字段，故合并结果必然完整。
 *
 * @param defaults - 默认配置（不会被修改）
 * @param input - 用户传入的深层可选配置（可为 undefined / null）
 * @returns 合并后的完整配置（新对象）
 */
export function mergePlayerConfig(
  defaults: PlayerConfig,
  input?: DeepPartial<PlayerConfig> | null,
): PlayerConfig {
  return deepMerge(defaults, input);
}

export default mergePlayerConfig;
