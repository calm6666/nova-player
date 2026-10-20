/**
 * ============================================
 * 组件模块统一导出
 * ============================================
 */

/** 复选框组件 */
export { Checkbox } from './Checkbox';
/** 复选框组件 Props 类型 */
export type { CheckboxProps } from './Checkbox';

/** 开关组件 */
export { Switch } from './Switch';
/** 开关组件 Props 及尺寸类型 */
export type { SwitchProps, SwitchSize } from './Switch';

/** 滑块组件 */
export { Slider } from './Slider';
/** 滑块组件 Props 及标记类型 */
export type { SliderProps, SliderMark } from './Slider';

/** 加载动画组件 */
export { Loading } from './Loading';
/** 加载动画组件 Props 类型 */
export type { LoadingProps } from './Loading';

/** 轻提示组件 */
export { Toast } from './Toast';
/** 轻提示组件 Props 类型 */
export type { ToastProps } from './Toast';

/** 工具提示组件 */
export { Tooltips } from './Tooltips';
/** 工具提示组件 Props 及提示项类型 */
export type { TooltipsProps, TooltipItem } from './Tooltips';

/** 状态指示组件 */
export { State } from './State';
/** 状态指示组件 Props 类型 */
export type { StateProps } from './State';

/** 迷你播放器组件 */
export { Mini } from './Mini';
/** 迷你播放器组件 Props 类型 */
export type { MiniProps } from './Mini';

/** 音量提示组件 */
export { VolumeHint } from './VolumeHint';
/** 音量提示组件 Props 类型 */
export type { VolumeHintProps } from './VolumeHint';

/** 视频统计信息组件 */
export { VideoInfo } from './VideoInfo';
/** 视频统计信息组件 Props 及信息项类型 */
export type { VideoInfoProps, VideoInfoItem } from './VideoInfo';

/** 对话框组件 */
export { Dialog } from './Dialog';
/** 对话框组件 Props 及弹幕提示数据类型 */
export type { DialogProps, DmTipData } from './Dialog';


/** 色彩调整面板组件 */
export { ColorPanel } from './ColorPanel';
/** 色彩调整面板组件 Props 类型 */
export type { ColorPanelProps } from './ColorPanel';

/** 快捷键面板组件 */
export { HotkeyPanel } from './HotkeyPanel';
/** 快捷键面板组件 Props 及快捷键项类型 */
export type { HotkeyPanelProps, HotkeyItem } from './HotkeyPanel';

/** 弹幕设置组件 */
export { DmSetting } from './DmSetting';
/** 弹幕设置组件 Props 类型 */
export type { DmSettingProps } from './DmSetting';


/** 选集组件 */
export { Selection } from './Selection';
/** 选集组件 Props 类型 */
export type { SelectionProps } from './Selection';

/** 发送栏组件 */
export { SendBar } from './SendBar';
/** 发送栏组件 Props 类型 */
export type { SendBarProps } from './SendBar';

/** 右键菜单组件 */
export { Context } from './Context';
/** 右键菜单组件 Props、菜单项及偏移量类型 */
export type { ContextProps, ContextMenuItem, ContextOffset } from './Context';

/** 弹幕行组件 */
export { RowDm } from './RowDm';
/** 弹幕行组件 Props 类型 */
export type { RowDmProps } from './RowDm';

/** 控制栏组件 */
export { Controls } from './Controls';
/** 控制栏组件 Props 类型 */
export type { ControlsProps } from './Controls';

/** 播放器停靠组件 */
export { PlayerDocker } from './PlayerDocker';
/** 播放器停靠组件 Props 类型 */
export type { PlayerDockerProps } from './PlayerDocker';

/** Lottie 动画图标组件 */
export { LottieIcon } from './LottieIcon';
/** Lottie 动画图标组件 Props 类型 */
export type { LottieIconProps, AnimationSlot, AnimationSlotCompleteAction } from './LottieIcon';

/** 交互层组件 */
export { InteractionLayer } from './InteractionLayer';
/** 交互层组件 Props 类型 */
export type { InteractionLayerProps } from './InteractionLayer';

/** 互动视频层组件（仅空容器，内容与样式由互动视频插件注入） */
export { InteractiveVideoLayer } from './InteractiveVideoLayer';
/** 互动视频层 API 类型（暴露根容器引用给插件） */
export type { InteractiveVideoLayerAPI } from './InteractiveVideoLayer';

/** 错误面板组件 */
export { ErrorSign } from './ErrorSign';
/** 错误面板组件 Props / API / 错误信息类型 */
export type {
  ErrorSignProps,
  ErrorSignAPI,
  ErrorSignInfo,
} from './ErrorSign';

/** 字幕层组件 */
export { SubtitleLayer } from './SubtitleLayer';
/** 字幕层组件 Props 及字幕位置类型 */
export type { SubtitleLayerProps, SubtitlePosition } from './SubtitleLayer';

/** 进度条组件 */
export { ProgressBar } from './ProgressBar';
/** 进度条组件 Props 类型 */
export type { ProgressBarProps } from './ProgressBar';

/** 底部影子进度条组件 */
export { ShadowProgressArea } from './ShadowProgressArea';
/** 底部影子进度条组件 Props 及挂载后 API 类型 */
export type { ShadowProgressAreaProps, ShadowProgressAreaApi } from './ShadowProgressArea';

/** 音量滑块组件 */
export { VolumeSlider } from './VolumeSlider';
/** 音量滑块组件 Props 类型 */
export type { VolumeSliderProps } from './VolumeSlider';

/** 画质菜单组件 */
export { QualityMenu } from './QualityMenu';
/** 画质菜单组件 Props 及画质项类型 */
export type { QualityMenuProps, QualityItem } from './QualityMenu';

/** 播放速度菜单组件 */
export { PlaybackRateMenu } from './PlaybackRateMenu';
/** 播放速度菜单组件 Props 类型 */
export type { PlaybackRateMenuProps } from './PlaybackRateMenu';

/** 设置菜单组件 */
export { SettingMenu } from './SettingMenu';
/** 设置菜单组件 Props 类型 */
export type { SettingMenuProps } from './SettingMenu';

/** 视角菜单组件 */
export { ViewpointMenu } from './ViewpointMenu';
/** 视角菜单组件 Props 及视角项类型 */
export type { ViewpointMenuProps, ViewpointItem } from './ViewpointMenu';
