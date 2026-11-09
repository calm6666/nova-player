/**
 * ============================================
 * 字幕生成器
 * ============================================
 * 用于生成随机字幕文件，支持多种格式
 * 包含 SRT、WebVTT、ASS 格式的生成与转换
 *
 * @module utils/subtitle/subtitleGenerator
 */

import { SubtitleFormat, type SubtitleItem, type ParsedSubtitle, type SubtitleStyle } from '../../types/subtitle';

/** 生成器配置 */
export interface SubtitleGeneratorConfig {
  /** 视频时长（秒） */
  duration: number;
  /** 字幕数量 */
  count: number;
  /** 平均每条字幕显示时长（秒） */
  avgDuration?: number;
  /** 语言 */
  language?: 'zh' | 'en' | 'mixed';
  /** 是否包含样式 */
  includeStyles?: boolean;
}

/** 中文字幕样本 */
const chineseSamples = [
  'This is a test subtitle',
  'Welcome to the video player',
  'Subtitle feature test in progress',
  'This is a very long subtitle text used to test long text display and line wrapping',
  'Short subtitle',
  'Hello, world!',
  'This is a sample dialogue',
  'Subtitle display normal',
  'Testing subtitles of various lengths',
  'This is a bottom subtitle',
  'This is a top subtitle',
  'Subtitle style test',
  'Multi-line subtitle second line text',
  'Styled subtitle',
  'Randomly generated subtitle content',
  'Video playback test',
  'Subtitle sync test',
  'Timeline calibration',
  'Subtitle render effect',
  'Font size test',
  'Color style test',
  'Alignment test',
  'Border shadow effect',
  'Opacity setting',
  'Scrolling subtitle test',
  'Static subtitle display',
  'Dynamic effect test',
  'Subtitle position adjustment',
  'Fullscreen mode test',
  'Window mode test',
];

/** 英文字幕样本 */
const englishSamples = [
  'This is a test subtitle',
  'Welcome to the video player',
  'Subtitle feature testing in progress',
  'This is a very long subtitle text to test the display effect and line wrapping of long text content',
  'Short text',
  'Hello, World!',
  'This is a sample dialogue',
  'Subtitle display normal',
  'Testing various subtitle lengths',
  'Bottom subtitle',
  'Top subtitle',
  'Subtitle style test',
  'Multi-line subtitle Second line text',
  'Styled subtitle',
  'Randomly generated subtitle content',
  'Video playback test',
  'Subtitle synchronization test',
  'Timeline calibration',
  'Subtitle rendering effect',
  'Font size test',
  'Color style test',
  'Alignment test',
  'Border shadow effect',
  'Opacity settings',
  'Scrolling subtitle test',
  'Static subtitle display',
  'Animation effect test',
  'Subtitle position adjustment',
  'Fullscreen mode test',
  'Window mode test',
];

/**
 * 生成随机字幕数据
 * @param config 生成配置
 * @returns 字幕数据
 */
export function generateSubtitleData(config: SubtitleGeneratorConfig): ParsedSubtitle {
  const { duration, count, avgDuration = 3, language = 'zh' } = config;
  const items: SubtitleItem[] = [];

  const samples = language === 'zh' ? chineseSamples : language === 'en' ? englishSamples : [...chineseSamples, ...englishSamples];

  // 生成时间区间
  const timeSlots: { start: number; end: number }[] = [];
  const slotDuration = duration / count;

  for (let i = 0; i < count; i++) {
    const baseTime = i * slotDuration;
    // 在区间内随机偏移
    const offset = Math.random() * slotDuration * 0.5;
    const startTime = baseTime + offset;
    const subtitleDuration = avgDuration + (Math.random() - 0.5) * 2; // avgDuration ± 1秒
    const endTime = Math.min(startTime + subtitleDuration, duration);

    timeSlots.push({ start: startTime, end: endTime });
  }

  // 生成字幕项
  for (let i = 0; i < count; i++) {
    const slot = timeSlots[i];
    const sample = samples[Math.floor(Math.random() * samples.length)];

    // 随机决定是否需要样式
    const hasStyle = Math.random() > 0.7;
    let style: SubtitleStyle | undefined;

    if (hasStyle) {
      style = generateRandomStyle();
    }

    items.push({
      id: i + 1,
      startTime: slot.start,
      endTime: slot.end,
      text: sample,
      style,
    });
  }

  return {
    format: SubtitleFormat.SRT,
    items,
  };
}

/**
 * 生成随机样式
 * @returns 字幕样式
 */
function generateRandomStyle(): SubtitleStyle {
  const alignments = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const colors = ['#FFFFFF', '#FFFF00', '#00FF00', '#00FFFF', '#FF00FF', '#FF0000'];

  return {
    fontSize: 16 + Math.floor(Math.random() * 10),
    primaryColor: colors[Math.floor(Math.random() * colors.length)],
    outlineColor: '#000000',
    outlineWidth: 1 + Math.random() * 2,
    bold: Math.random() > 0.7,
    italic: Math.random() > 0.8,
    alignment: alignments[Math.floor(Math.random() * alignments.length)],
  };
}

/**
 * 将字幕数据转换为 SRT 格式
 * @param data 字幕数据
 * @returns SRT 格式字符串
 */
export function toSRT(data: ParsedSubtitle): string {
  return data.items
    .map((item: SubtitleItem) => {
      const startTime = formatSRTTime(item.startTime);
      const endTime = formatSRTTime(item.endTime);
      const text = item.text.replace(/<br>/g, '\n');
      return `${item.id}\n${startTime} --> ${endTime}\n${text}`;
    })
    .join('\n\n');
}

/**
 * 将字幕数据转换为 WebVTT 格式
 * @param data 字幕数据
 * @returns WebVTT 格式字符串
 */
export function toVTT(data: ParsedSubtitle): string {
  const lines = ['WEBVTT'];

  for (const item of data.items) {
    const startTime = formatVTTTime(item.startTime);
    const endTime = formatVTTTime(item.endTime);
    lines.push(''); // 空行分隔
    lines.push(`${startTime} --> ${endTime}`);
    lines.push(item.text);
  }

  return lines.join('\n');
}

/**
 * 将字幕数据转换为 ASS 格式
 * @param data 字幕数据
 * @returns ASS 格式字符串
 */
export function toASS(data: ParsedSubtitle): string {
  const header = `[Script Info]
Title: ${data.title || 'Generated Subtitle'}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const body = data.items
    .map((item: SubtitleItem) => {
      const startTime = formatASSTime(item.startTime);
      const endTime = formatASSTime(item.endTime);
      const text = item.text.replace(/<br>/g, '\\N');
      const style = item.style || {};

      // 如果有样式，添加 ASS 标签
      let styledText = text;
      if (style.bold) styledText = `{\\b1}${styledText}{\\b0}`;
      if (style.italic) styledText = `{\\i1}${styledText}{\\i0}`;
      if (style.primaryColor) {
        const color = style.primaryColor.replace('#', '');
        const bgr = color.slice(4, 6) + color.slice(2, 4) + color.slice(0, 2);
        styledText = `{\\c&H${bgr}&}${styledText}`;
      }
      if (style.fontSize) {
        styledText = `{\\fs${style.fontSize}}${styledText}{\\fs20}`;
      }

      return `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${styledText}`;
    })
    .join('\n');

  return header + body;
}

/**
 * 格式化时间为 SRT 格式 (HH:MM:SS,mmm)
 * @param seconds 秒数
 * @returns 格式化后的时间字符串
 */
function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(ms, 3)}`;
}

/**
 * 格式化时间为 WebVTT 格式 (HH:MM:SS.mmm)
 * @param seconds 秒数
 * @returns 格式化后的时间字符串
 */
function formatVTTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${pad(ms, 3)}`;
}

/**
 * 格式化时间为 ASS 格式 (H:MM:SS.cc)
 * @param seconds 秒数
 * @returns 格式化后的时间字符串
 */
function formatASSTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);

  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(cs, 2)}`;
}

/**
 * 数字补零
 * @param num 数字
 * @param length 目标长度
 * @returns 补零后的字符串
 */
function pad(num: number, length: number = 2): string {
  return num.toString().padStart(length, '0');
}

/**
 * 生成并下载字幕文件
 * @param format 字幕格式
 * @param config 生成配置
 * @returns 字幕文件内容
 */
export function generateSubtitleFile(
  format: SubtitleFormat.SRT | SubtitleFormat.VTT | SubtitleFormat.ASS,
  config: SubtitleGeneratorConfig
): string {
  const data = generateSubtitleData(config);

  switch (format) {
    case SubtitleFormat.SRT:
      return toSRT(data);
    case SubtitleFormat.VTT:
      return toVTT(data);
    case SubtitleFormat.ASS:
      return toASS(data);
    default:
      return toSRT(data);
  }
}

/**
 * 批量生成多种格式的字幕文件
 * @param config 生成配置
 * @returns 各种格式的字幕内容
 */
export function generateAllSubtitleFormats(config: SubtitleGeneratorConfig): {
  srt: string;
  vtt: string;
  ass: string;
} {
  const data = generateSubtitleData(config);

  return {
    srt: toSRT(data),
    vtt: toVTT(data),
    ass: toASS(data),
  };
}
