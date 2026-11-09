/**
 * ============================================
 * 控制条组件类型定义
 * ============================================
 * 定义 Controls 组件所需的所有类型和接口
 */

import type { AnimationFrameID } from "@lumina/framework/utils/rafTimeout";

/**
 * 音量进度状态
 */
export interface VolumeProgress {
  isDragging: boolean;
  startY: number;
  isMuted: boolean;
}

/**
 * 弹出层状态
 */
export interface Popup {
  isActive: boolean;
  left: number;
  delay: AnimationFrameID | null;
  currentTime: number;
  prevTime: number;
}

/**
 * 提示按钮
 */
export interface Tooltip {
  element: HTMLElement | null;
  name: string;
  dataName: string;
}

/**
 * 切换按钮
 */
export interface SwitchBtn {
  icon?: string;
  label?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * 切换按钮组
 */
export interface SwitchBtns {
  btn1?: SwitchBtn;
  btn2?: SwitchBtn;
  btn3?: SwitchBtn;
}
