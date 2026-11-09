/**
 * ============================================
 * 播放器类型定义模块
 * ============================================
 * 统一导出所有播放器相关类型
 */

export type {
  VolumeProgress,
  Popup,
  Tooltip,
  SwitchBtns,
} from './controls';

// 控制条配置（`ControlsConfig` 与 `PlayerConfig` 同源，定义在根类型模块）
export type { ControlsConfig } from './player';

export type {
  CardType,
  PositionEvent,
  InteractionType,
  InteractionOptions,
  VoteOption,
  InteractionGuideThree,
  InteractionLink,
  InteractionVote,
  InteractionScore,
  InteractionCard,
  MergeResult,
} from './interaction';
