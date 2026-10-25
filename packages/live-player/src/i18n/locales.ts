/**
 * live-player 国际化词条。
 *
 * 词条按面板划分，所有面板文案都必须经 `t()` 读取；
 * 根元素挂载时会合并框架内置语言包与本文件词条并把默认语言设为简体中文。
 */

import enUS from '@/core/locales/en-US.json';
import zhCN from '@/core/locales/zh-CN.json';

/** 简体中文词条。 */
const ZH_CN: Record<string, string> = {
  // 控制条
  'livePlayer.control.play': '播放',
  'livePlayer.control.pause': '暂停',
  'livePlayer.control.refresh': '刷新',
  'livePlayer.control.volume': '音量',
  'livePlayer.control.mute': '静音',
  'livePlayer.control.unmute': '取消静音',
  'livePlayer.control.quality': '清晰度',
  'livePlayer.control.speed': '倍速',
  'livePlayer.control.danmaku': '弹幕开关',
  'livePlayer.control.danmakuOn': '开启弹幕',
  'livePlayer.control.danmakuOff': '关闭弹幕',
  'livePlayer.control.danmakuSetting': '弹幕设置',
  'livePlayer.control.send': '发送弹幕',
  'livePlayer.control.webscreen': '网页全屏',
  'livePlayer.control.exitWebscreen': '退出网页全屏',
  'livePlayer.control.fullscreen': '全屏',
  'livePlayer.control.exitFullscreen': '退出全屏',
  'livePlayer.control.pip': '画中画',
  'livePlayer.control.exitPip': '退出画中画',

  // 小窗
  'livePlayer.mini.label': '小窗播放器',
  'livePlayer.mini.close': '关闭悬浮播放器',

  // 通用
  'livePlayer.common.close': '关闭',
  'livePlayer.common.cancel': '取消',
  'livePlayer.common.submit': '提交',
  'livePlayer.common.reset': '恢复默认',
  'livePlayer.common.confirm': '确定',

  // 清晰度面板
  'livePlayer.quality.title': '清晰度',
  'livePlayer.quality.enhance': '画质增强',
  'livePlayer.quality.empty': '暂无可切换的清晰度',
  'livePlayer.quality.auto': '自动',
  'livePlayer.line.title': '线路',
  'livePlayer.quality.latency': '当前为直播流，延迟约 {seconds} 秒',
  'livePlayer.quality.smooth': '切档后画面更流畅，适合网络波动时使用',
  'livePlayer.quality.hintHigh': '高清晰度，占用带宽较高',
  'livePlayer.quality.hintSmooth': '低清晰度，延迟更低更流畅',
  'livePlayer.quality.hintAuto': '自动跟随网络选择档位',
  'livePlayer.toast.lineSwitched': '线路已经切换至 {label}',

  // 弹幕设置面板（与 player 面板结构一致）
  'livePlayer.dmSetting.filterType': '按类型过滤',
  'livePlayer.dmSetting.filterScroll': '滚动',
  'livePlayer.dmSetting.filterFixed': '固定',
  'livePlayer.dmSetting.filterColorful': '彩色',
  'livePlayer.dmSetting.filterAdvanced': '高级',
  'livePlayer.dmSetting.autoScale': '弹幕随屏幕缩放',
  'livePlayer.dmSetting.preventShade': '防挡字幕',
  'livePlayer.dmSetting.mask': '智能防挡弹幕',
  'livePlayer.dmSetting.area': '显示区域',
  'livePlayer.dmSetting.opacity': '不透明度',
  'livePlayer.dmSetting.fontsize': '弹幕字号',
  'livePlayer.dmSetting.speed': '弹幕速度',
  'livePlayer.dmSetting.speedSlow': '慢',
  'livePlayer.dmSetting.speedNormal': '适中',
  'livePlayer.dmSetting.speedFast': '快',
  'livePlayer.dmSetting.density': '弹幕密度',
  'livePlayer.dmSetting.densityNormal': '正常',
  'livePlayer.dmSetting.densityMore': '较多',
  'livePlayer.dmSetting.densityOverlap': '重叠',
  'livePlayer.dmSetting.smartMask': '智能防挡',
  'livePlayer.dmSetting.advanced': '高级设置',
  'livePlayer.dmSetting.more': '更多弹幕设置',
  'livePlayer.dmSetting.speedSync': '速度同步',
  'livePlayer.dmSetting.font': '弹幕字体',
  'livePlayer.dmSetting.bold': '加粗',
  'livePlayer.dmSetting.color': '弹幕颜色',
  'livePlayer.dmSetting.stroke': '描边类型',
  'livePlayer.dmSetting.strokeHeavy': '重量',
  'livePlayer.dmSetting.strokeOutline': '描边',
  'livePlayer.dmSetting.strokeProjection': '45°投影',
  'livePlayer.dmSetting.blockWordsPlaceholder': '多个屏蔽词用逗号分隔',
  'livePlayer.dmSetting.applyBlockWords': '同步屏蔽词',
  'livePlayer.dmSetting.font.simhei': '黑体',
  'livePlayer.dmSetting.font.simsun': '宋体',
  'livePlayer.dmSetting.font.newsimsun': '新宋体',
  'livePlayer.dmSetting.font.fangsong': '仿宋',
  'livePlayer.dmSetting.font.msyh': '微软雅黑',
  'livePlayer.dmSetting.font.msyhLight': '微软雅黑 Light',
  'livePlayer.dmSetting.font.notoDemi': 'Noto Sans DemiLight',
  'livePlayer.dmSetting.font.notoRegular': 'Noto Sans Regular',

  // 弹幕设置面板
  'livePlayer.danmaku.title': '弹幕设置',
  'livePlayer.danmaku.visible': '显示弹幕',
  'livePlayer.danmaku.opacity': '不透明度',
  'livePlayer.danmaku.fontsize': '字体大小',
  'livePlayer.danmaku.speed': '弹幕速度',
  'livePlayer.danmaku.area': '显示区域',
  'livePlayer.danmaku.blockWords': '屏蔽词',
  'livePlayer.danmaku.blockWordsPlaceholder': '多个屏蔽词用逗号分隔',
  'livePlayer.danmaku.resetDone': '弹幕设置已恢复默认',
  'livePlayer.danmaku.slow': '慢',
  'livePlayer.danmaku.fast': '快',

  // 播放信息面板
  'livePlayer.info.title': '直播信息',
  'livePlayer.info.room': '房间',
  'livePlayer.info.status': '状态',
  'livePlayer.info.quality': '清晰度',
  'livePlayer.info.line': '线路',
  'livePlayer.info.buffer': '缓冲',
  'livePlayer.info.dropped': '丢帧',
  'livePlayer.info.resolution': '分辨率',
  'livePlayer.info.fps': '帧率',
  'livePlayer.info.player': '播放内核',
  'livePlayer.info.time': '播放进度',
  'livePlayer.info.liveDuration': '已开播',
  'livePlayer.info.close': '关闭信息面板',
  'livePlayer.info.chartBuffer': '缓冲 (ms)',
  'livePlayer.info.chartDropped': '丢帧',

  // 快捷键面板
  'livePlayer.hotkey.title': '快捷键说明',
  'livePlayer.hotkey.playPause': '播放 / 暂停',
  'livePlayer.hotkey.mute': '静音切换',
  'livePlayer.hotkey.volume': '音量增减',
  'livePlayer.hotkey.fullscreen': '全屏切换',
  'livePlayer.hotkey.webscreen': '网页全屏切换',
  'livePlayer.hotkey.danmaku': '弹幕开关',
  'livePlayer.hotkey.send': '发送弹幕',
  'livePlayer.hotkey.help': '快捷键说明',
  'livePlayer.hotkey.escape': '关闭面板 / 退出全屏',

  // 右键菜单
  'livePlayer.menu.toggleOn': '开启弹幕',
  'livePlayer.menu.toggleOff': '关闭弹幕',
  'livePlayer.menu.moreSetting': '更多弹幕设置',
  'livePlayer.menu.info': '视频信息',
  'livePlayer.menu.codec': '视频编码',

  // 视频编码面板
  'livePlayer.codec.title': '视频编码',
  'livePlayer.codec.empty': '暂无可切换的视频编码',

  // 弹幕发送
  'livePlayer.send.placeholder': '发个弹幕呗~',
  'livePlayer.send.submit': '发送',

  // 直播状态
  'livePlayer.status.live': '直播中',
  'livePlayer.status.round': '轮播中',
  'livePlayer.status.preparing': '准备中',
  'livePlayer.status.off': '未开播',

  // 线路
  'livePlayer.line.main': '主线',
  'livePlayer.line.auto': '自动',

  // 播放内核
  'livePlayer.player.hls': 'HLS',
  'livePlayer.player.flv': 'FLV',
  'livePlayer.player.native': 'HTML5',

  // 提示
  'livePlayer.toast.qualitySwitched': '清晰度已经切换至 {label}',
  'livePlayer.toast.speed': '倍速 {rate}x',
  'livePlayer.toast.muted': '已静音',
  'livePlayer.toast.unmuted': '已取消静音',
  'livePlayer.toast.volume': '音量 {volume}',
  'livePlayer.toast.reloaded': '正在重新加载直播流',
  'livePlayer.toast.danmakuOn': '已开启弹幕',
  'livePlayer.toast.danmakuOff': '已关闭弹幕',
  'livePlayer.toast.danmakuSettingBlocked': '弹幕已关闭，无法打开弹幕设置',
  'livePlayer.toast.danmakuPluginMissing': '未提供弹幕插件',
  'livePlayer.toast.streamPluginMissing': '未提供对应流插件',
  'livePlayer.toast.codecSwitched': '视频编码已切换至 {label}',
  'livePlayer.toast.pipUnsupported': '当前浏览器不支持画中画',
  'livePlayer.toast.fullscreenUnsupported': '当前浏览器不支持全屏',
  'livePlayer.toast.streamError': '直播流出错，请尝试刷新',
  'livePlayer.toast.playBlocked': '浏览器阻止了自动播放，请点击播放',

  // 错误面板
  'livePlayer.error.title': '播放出错',
  'livePlayer.error.retry': '重试',
  'livePlayer.error.noStream': '暂无可播放的直播流',
  'livePlayer.error.media': '当前流媒体格式不受支持，请更换浏览器或稍后重试',
};

/** 英文词条。 */
const EN_US: Record<string, string> = {
  'livePlayer.control.play': 'Play',
  'livePlayer.control.pause': 'Pause',
  'livePlayer.control.refresh': 'Refresh',
  'livePlayer.control.volume': 'Volume',
  'livePlayer.control.mute': 'Mute',
  'livePlayer.control.unmute': 'Unmute',
  'livePlayer.control.quality': 'Quality',
  'livePlayer.control.speed': 'Speed',
  'livePlayer.control.danmaku': 'Danmaku',
  'livePlayer.control.danmakuOn': 'Turn on danmaku',
  'livePlayer.control.danmakuOff': 'Turn off danmaku',
  'livePlayer.control.danmakuSetting': 'Danmaku settings',
  'livePlayer.control.send': 'Send danmaku',
  'livePlayer.control.webscreen': 'Web fullscreen',
  'livePlayer.control.exitWebscreen': 'Exit web fullscreen',
  'livePlayer.control.fullscreen': 'Fullscreen',
  'livePlayer.control.exitFullscreen': 'Exit fullscreen',
  'livePlayer.control.pip': 'Picture in picture',
  'livePlayer.control.exitPip': 'Exit picture in picture',

  'livePlayer.mini.label': 'Mini player',
  'livePlayer.mini.close': 'Close floating player',

  'livePlayer.common.close': 'Close',
  'livePlayer.common.cancel': 'Cancel',
  'livePlayer.common.submit': 'Submit',
  'livePlayer.common.reset': 'Reset',
  'livePlayer.common.confirm': 'OK',

  'livePlayer.quality.title': 'Quality',
  'livePlayer.quality.enhance': 'Quality enhance',
  'livePlayer.quality.empty': 'No switchable quality',
  'livePlayer.quality.auto': 'Auto',
  'livePlayer.line.title': 'Line',
  'livePlayer.quality.latency': 'Live stream, latency about {seconds}s',
  'livePlayer.quality.smooth': 'Lower quality is smoother on unstable networks',
  'livePlayer.quality.hintHigh': 'High quality, higher bandwidth',
  'livePlayer.quality.hintSmooth': 'Low quality, lower latency',
  'livePlayer.quality.hintAuto': 'Automatically follows network',
  'livePlayer.toast.lineSwitched': 'Line switched to {label}',

  'livePlayer.dmSetting.filterType': 'Filter by type',
  'livePlayer.dmSetting.filterScroll': 'Scroll',
  'livePlayer.dmSetting.filterFixed': 'Fixed',
  'livePlayer.dmSetting.filterColorful': 'Colorful',
  'livePlayer.dmSetting.filterAdvanced': 'Advanced',
  'livePlayer.dmSetting.autoScale': 'Scale with screen',
  'livePlayer.dmSetting.preventShade': 'Reserve area',
  'livePlayer.dmSetting.mask': 'Smart mask',
  'livePlayer.dmSetting.area': 'Display area',
  'livePlayer.dmSetting.opacity': 'Opacity',
  'livePlayer.dmSetting.fontsize': 'Font size',
  'livePlayer.dmSetting.speed': 'Speed',
  'livePlayer.dmSetting.speedSlow': 'Slow',
  'livePlayer.dmSetting.speedNormal': 'Normal',
  'livePlayer.dmSetting.speedFast': 'Fast',
  'livePlayer.dmSetting.density': 'Density',
  'livePlayer.dmSetting.densityNormal': 'Normal',
  'livePlayer.dmSetting.densityMore': 'More',
  'livePlayer.dmSetting.densityOverlap': 'Overlap',
  'livePlayer.dmSetting.smartMask': 'Smart mask',
  'livePlayer.dmSetting.advanced': 'Advanced',
  'livePlayer.dmSetting.more': 'More settings',
  'livePlayer.dmSetting.speedSync': 'Speed sync',
  'livePlayer.dmSetting.font': 'Font',
  'livePlayer.dmSetting.bold': 'Bold',
  'livePlayer.dmSetting.color': 'Color',
  'livePlayer.dmSetting.stroke': 'Stroke type',
  'livePlayer.dmSetting.strokeHeavy': 'Heavy',
  'livePlayer.dmSetting.strokeOutline': 'Outline',
  'livePlayer.dmSetting.strokeProjection': '45° Projection',
  'livePlayer.dmSetting.blockWordsPlaceholder': 'Separate words with commas',
  'livePlayer.dmSetting.applyBlockWords': 'Sync blocked words',
  'livePlayer.dmSetting.font.simhei': 'SimHei',
  'livePlayer.dmSetting.font.simsun': 'SimSun',
  'livePlayer.dmSetting.font.newsimsun': 'NSimSun',
  'livePlayer.dmSetting.font.fangsong': 'FangSong',
  'livePlayer.dmSetting.font.msyh': 'Microsoft YaHei',
  'livePlayer.dmSetting.font.msyhLight': 'Microsoft YaHei Light',
  'livePlayer.dmSetting.font.notoDemi': 'Noto Sans DemiLight',
  'livePlayer.dmSetting.font.notoRegular': 'Noto Sans Regular',

  'livePlayer.danmaku.title': 'Danmaku settings',
  'livePlayer.danmaku.visible': 'Show danmaku',
  'livePlayer.danmaku.opacity': 'Opacity',
  'livePlayer.danmaku.fontsize': 'Font size',
  'livePlayer.danmaku.speed': 'Speed',
  'livePlayer.danmaku.area': 'Display area',
  'livePlayer.danmaku.blockWords': 'Blocked words',
  'livePlayer.danmaku.blockWordsPlaceholder': 'Separate words with commas',
  'livePlayer.danmaku.resetDone': 'Danmaku settings reset',
  'livePlayer.danmaku.slow': 'Slow',
  'livePlayer.danmaku.fast': 'Fast',

  'livePlayer.info.title': 'Live info',
  'livePlayer.info.room': 'Room',
  'livePlayer.info.status': 'Status',
  'livePlayer.info.quality': 'Quality',
  'livePlayer.info.line': 'Line',
  'livePlayer.info.buffer': 'Buffer',
  'livePlayer.info.dropped': 'Dropped',
  'livePlayer.info.resolution': 'Resolution',
  'livePlayer.info.fps': 'Frame rate',
  'livePlayer.info.player': 'Player',
  'livePlayer.info.time': 'Progress',
  'livePlayer.info.liveDuration': 'Live for',
  'livePlayer.info.close': 'Close info panel',
  'livePlayer.info.chartBuffer': 'Buffer (ms)',
  'livePlayer.info.chartDropped': 'Dropped',

  'livePlayer.hotkey.title': 'Keyboard shortcuts',
  'livePlayer.hotkey.playPause': 'Play / pause',
  'livePlayer.hotkey.mute': 'Toggle mute',
  'livePlayer.hotkey.volume': 'Volume up / down',
  'livePlayer.hotkey.fullscreen': 'Toggle fullscreen',
  'livePlayer.hotkey.webscreen': 'Toggle web fullscreen',
  'livePlayer.hotkey.danmaku': 'Toggle danmaku',
  'livePlayer.hotkey.send': 'Send danmaku',
  'livePlayer.hotkey.help': 'Keyboard shortcuts',
  'livePlayer.hotkey.escape': 'Close panel / exit fullscreen',

  'livePlayer.menu.toggleOn': 'Turn on danmaku',
  'livePlayer.menu.toggleOff': 'Turn off danmaku',
  'livePlayer.menu.moreSetting': 'More danmaku settings',
  'livePlayer.menu.info': 'Video info',
  'livePlayer.menu.codec': 'Video codec',

  'livePlayer.codec.title': 'Video codec',
  'livePlayer.codec.empty': 'No switchable video codec',

  'livePlayer.send.placeholder': 'Say something',
  'livePlayer.send.submit': 'Send',

  'livePlayer.status.live': 'Live',
  'livePlayer.status.round': 'Round',
  'livePlayer.status.preparing': 'Preparing',
  'livePlayer.status.off': 'Offline',

  'livePlayer.line.main': 'Main',
  'livePlayer.line.auto': 'Auto',

  'livePlayer.player.hls': 'HLS',
  'livePlayer.player.flv': 'FLV',
  'livePlayer.player.native': 'HTML5',

  'livePlayer.toast.qualitySwitched': 'Quality switched to {label}',
  'livePlayer.toast.speed': 'Playback rate {rate}x',
  'livePlayer.toast.muted': 'Muted',
  'livePlayer.toast.unmuted': 'Unmuted',
  'livePlayer.toast.volume': 'Volume {volume}',
  'livePlayer.toast.reloaded': 'Reloading live stream',
  'livePlayer.toast.danmakuOn': 'Danmaku on',
  'livePlayer.toast.danmakuOff': 'Danmaku off',
  'livePlayer.toast.danmakuSettingBlocked': 'Danmaku is off, cannot open danmaku settings',
  'livePlayer.toast.danmakuPluginMissing': 'No danmaku plugin provided',
  'livePlayer.toast.streamPluginMissing': 'No matching stream plugin provided',
  'livePlayer.toast.codecSwitched': 'Video codec switched to {label}',
  'livePlayer.toast.pipUnsupported': 'Picture in picture is not supported',
  'livePlayer.toast.fullscreenUnsupported': 'Fullscreen is not supported',
  'livePlayer.toast.streamError': 'Stream error, please refresh',
  'livePlayer.toast.playBlocked': 'Autoplay is blocked, click play to start',

  'livePlayer.error.title': 'Playback error',
  'livePlayer.error.retry': 'Retry',
  'livePlayer.error.noStream': 'No playable live stream',
  'livePlayer.error.media': 'This stream format is unsupported in the current browser',
};

/** live-player 全部内置词条。 */
export const LIVE_PLAYER_MESSAGES: Record<string, Record<string, string>> = {
  'zh-CN': ZH_CN,
  'en-US': EN_US,
};

/** 框架内置语言包（用于合并基线）。 */
const BUILTIN: Record<string, Record<string, string>> = {
  'zh-CN': zhCN as Record<string, string>,
  'en-US': enUS as Record<string, string>,
};

/**
 * 合并「框架内置语言包 + 播放器词条 + 上层覆盖」。
 *
 * @param locale - 语言代码。
 * @param base - 上层提供的覆盖词条。
 * @returns 可直接交给 initI18n / registerLocale 的完整语言包。
 */
export function mergeLivePlayerMessages(
  locale: string,
  base?: Record<string, string>,
): Record<string, string> {
  const builtin = BUILTIN[locale] ?? {};
  const own = LIVE_PLAYER_MESSAGES[locale] ?? LIVE_PLAYER_MESSAGES['zh-CN'];
  return { ...builtin, ...own, ...(base ?? {}) };
}

/**
 * 取本包全部词条（不含框架内置语言包）。
 *
 * @param locale - 语言代码。
 * @returns 词条副本。
 */
export function getLivePlayerMessages(locale: string): Record<string, string> {
  const own = LIVE_PLAYER_MESSAGES[locale] ?? LIVE_PLAYER_MESSAGES['zh-CN'];
  return { ...own };
}
