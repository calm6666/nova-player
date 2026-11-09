/**
 * ============================================
 * 字幕处理工具
 * ============================================
 * 支持主流字幕格式：SRT、ASS/SSA、WebVTT
 * 提供格式检测、解析、查询等核心功能
 *
 * @module utils/subtitle
 */

import { createLogger } from '@lumina/framework/utils';
const logger = createLogger('Subtitle');

import { SubtitleFormat, type SubtitleItem, type SubtitleStyle, type ParsedSubtitle } from '../../types/subtitle';


/**
 * 检测字幕格式
 * @param content 字幕文件内容
 * @returns 字幕格式
 */
export function detectSubtitleFormat(content: string): SubtitleFormat {
  const trimmed = content.trim().toLowerCase();

  // WebVTT 以 WEBVTT 开头
  if (trimmed.startsWith('webvtt')) {
    return SubtitleFormat.VTT;
  }

  // ASS/SSA 包含 [Script Info] 和 [V4+ Styles]
  if (trimmed.includes('[script info]') && trimmed.includes('[v4+ styles]')) {
    return SubtitleFormat.ASS;
  }

  // SRT 格式：数字 + 时间码 --> 时间码
  const srtPattern = /^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/m;
  if (srtPattern.test(content)) {
    return SubtitleFormat.SRT;
  }

  return SubtitleFormat.UNKNOWN;
}

/**
 * 解析时间字符串为秒数
 * @param timeStr 时间字符串 (如 "00:01:23,456" 或 "00:01:23.456")
 * @returns 秒数
 */
function parseTime(timeStr: string): number {
  // 处理 SRT 格式: 00:01:23,456
  // 处理 VTT 格式: 00:01:23.456
  const match = timeStr.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const milliseconds = parseInt(match[4], 10);

  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

/**
 * 解析 SRT 格式字幕
 * @param content SRT 字幕内容
 * @returns 解析后的字幕数据
 */
export function parseSRT(content: string): ParsedSubtitle {
  const items: SubtitleItem[] = [];

  // 标准化换行符并分割条目
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // SRT 条目格式：数字 + 换行 + 时间码 --> 时间码 + 换行 + 文本
  const entryPattern = /(\d+)\s*\n(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})\s*\n([\s\S]*?)(?=\n\n|\n\d+\s*\n|$)/g;

  let match;
  while ((match = entryPattern.exec(normalized)) !== null) {
    const id = parseInt(match[1], 10);
    const startTime = parseTime(match[2]);
    const endTime = parseTime(match[3]);
    const text = match[4].trim().replace(/\n/g, '<br>');

    items.push({
      id,
      startTime,
      endTime,
      text,
    });
  }

  return {
    format: SubtitleFormat.SRT,
    items,
  };
}

/**
 * 解析 WebVTT 格式字幕
 * @param content VTT 字幕内容
 * @returns 解析后的字幕数据
 */
export function parseVTT(content: string): ParsedSubtitle {
  const items: SubtitleItem[] = [];

  // 标准化换行符
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 移除 WEBVTT 头部
  const lines = normalized.split('\n');
  let startIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '' || lines[i].startsWith('NOTE')) {
      startIndex = i + 1;
    } else if (lines[i].includes('-->')) {
      startIndex = i;
      break;
    }
  }

  // 解析条目
  let id = 1;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();

    // 跳过空行
    if (!line) continue;

    // 检查是否是时间戳行
    const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (timeMatch) {
      const startTime = parseTime(timeMatch[1]);
      const endTime = parseTime(timeMatch[2]);

      // 获取文本（下一行或多行）
      let text = '';
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '' && !lines[j].includes('-->')) {
        if (text) text += '\n';
        text += lines[j].trim();
        j++;
      }

      if (text) {
        items.push({
          id: id++,
          startTime,
          endTime,
          text: text.replace(/\n/g, '<br>'),
        });
      }

      i = j - 1;
    }
  }

  return {
    format: SubtitleFormat.VTT,
    items,
  };
}

/**
 * 解析 ASS/SSA 格式字幕
 * @param content ASS/SSA 字幕内容
 * @returns 解析后的字幕数据
 */
export function parseASS(content: string): ParsedSubtitle {
  const items: SubtitleItem[] = [];
  let title = '';
  const styles = new Map<string, SubtitleStyle>();

  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 提取标题
  const titleMatch = normalized.match(/Title:\s*(.+)/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // 解析样式
  const stylesSection = normalized.match(/\[V4\+? Styles\]([\s\S]*?)(?=\[|$)/i);
  if (stylesSection) {
    const styleLines = stylesSection[1].trim().split('\n');
    const formatLine = styleLines.find(line => line.startsWith('Format:'));

    if (formatLine) {
      const formatFields = formatLine.replace('Format:', '').split(',').map(f => f.trim().toLowerCase());

      styleLines.forEach(line => {
        if (line.startsWith('Style:')) {
          const values = line.replace('Style:', '').split(',').map(v => v.trim());
          const styleName = values[0];
          const style: SubtitleStyle = {};

          formatFields.forEach((field, index) => {
            const value = values[index];
            if (!value) return;

            switch (field) {
              case 'fontname':
                style.fontName = value;
                break;
              case 'fontsize':
                style.fontSize = parseFloat(value);
                break;
              case 'primarycolour':
              case 'primarycolor':
                style.primaryColor = parseASSColor(value);
                break;
              case 'outlinecolour':
              case 'outlinecolor':
                style.outlineColor = parseASSColor(value);
                break;
              case 'outline':
                style.outlineWidth = parseFloat(value);
                break;
              case 'bold':
                style.bold = value === '1' || value === '-1';
                break;
              case 'italic':
                style.italic = value === '1' || value === '-1';
                break;
              case 'underline':
                style.underline = value === '1' || value === '-1';
                break;
              case 'strikeout':
                style.strikeout = value === '1' || value === '-1';
                break;
              case 'alignment':
                style.alignment = parseInt(value, 10);
                break;
              case 'marginl':
                style.marginL = parseInt(value, 10);
                break;
              case 'marginr':
                style.marginR = parseInt(value, 10);
                break;
              case 'marginv':
                style.marginV = parseInt(value, 10);
                break;
            }
          });

          styles.set(styleName, style);
        }
      });
    }
  }

  // 解析事件（字幕条目）
  const eventsSection = normalized.match(/\[Events\]([\s\S]*?)(?=\[|$)/i);
  if (eventsSection) {
    const eventLines = eventsSection[1].trim().split('\n');
    const formatLine = eventLines.find(line => line.startsWith('Format:'));

    if (formatLine) {
      const formatFields = formatLine.replace('Format:', '').split(',').map(f => f.trim().toLowerCase());

      let id = 1;
      eventLines.forEach(line => {
        if (line.startsWith('Dialogue:')) {
          const values = line.replace('Dialogue:', '').split(',').map(v => v.trim());
          const item: SubtitleItem = {
            id: id++,
            startTime: 0,
            endTime: 0,
            text: '',
          };

          formatFields.forEach((field, index) => {
            const value = values[index];
            if (!value) return;

            switch (field) {
              case 'start':
                item.startTime = parseASSTime(value);
                break;
              case 'end':
                item.endTime = parseASSTime(value);
                break;
              case 'style':
                item.style = styles.get(value);
                break;
              case 'text':
                // 剩余部分都是文本
                item.text = values.slice(index).join(',').replace(/\\N/g, '<br>').replace(/\{[^}]*\}/g, '');
                break;
            }
          });

          items.push(item);
        }
      });
    }
  }

  return {
    format: SubtitleFormat.ASS,
    items,
    title,
    globalStyle: styles.get('Default'),
  };
}

/**
 * 解析 ASS 时间格式 (H:MM:SS.cc)
 * @param timeStr 时间字符串
 * @returns 秒数
 */
function parseASSTime(timeStr: string): number {
  const match = timeStr.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const centiseconds = parseInt(match[4], 10);

  return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
}

/**
 * 解析 ASS 颜色格式 (&HBBGGRR& 或 &HAABBGGRR&)
 * @param colorStr 颜色字符串
 * @returns CSS 颜色值
 */
function parseASSColor(colorStr: string): string {
  // 移除 &H 和 &
  const hex = colorStr.replace(/&H|&/g, '');

  if (hex.length === 8) {
    // 带透明度的颜色 AABBGGRR
    const alpha = parseInt(hex.slice(0, 2), 16);
    const blue = parseInt(hex.slice(2, 4), 16);
    const green = parseInt(hex.slice(4, 6), 16);
    const red = parseInt(hex.slice(6, 8), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
  } else if (hex.length === 6) {
    // 不带透明度的颜色 BBGGRR
    const blue = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const red = parseInt(hex.slice(4, 6), 16);
    return `rgb(${red}, ${green}, ${blue})`;
  }

  return '#FFFFFF';
}

/**
 * 自动解析字幕文件
 * @param content 字幕文件内容
 * @returns 解析后的字幕数据
 */
export function parseSubtitle(content: string): ParsedSubtitle {
  const format = detectSubtitleFormat(content);

  switch (format) {
    case SubtitleFormat.SRT:
      return parseSRT(content);
    case SubtitleFormat.VTT:
      return parseVTT(content);
    case SubtitleFormat.ASS:
    case SubtitleFormat.SSA:
      return parseASS(content);
    default:
      // 尝试按 SRT 解析
      try {
        return parseSRT(content);
      } catch (e) {
        logger.warn('Subtitle parse failed:', e);
        return {
          format: SubtitleFormat.UNKNOWN,
          items: [],
        };
      }
  }
}

/**
 * 获取当前时间应该显示的字幕
 * @param items 字幕列表
 * @param currentTime 当前时间（秒）
 * @returns 当前应该显示的字幕，如果没有则返回 null
 */
export function getCurrentSubtitle(items: SubtitleItem[], currentTime: number): SubtitleItem | null {
  for (const item of items) {
    if (currentTime >= item.startTime && currentTime <= item.endTime) {
      return item;
    }
  }
  return null;
}

/**
 * 获取当前时间前后范围内的字幕（用于预加载）
 * @param items 字幕列表
 * @param currentTime 当前时间（秒）
 * @param range 时间范围（秒，默认5秒）
 * @returns 范围内的字幕列表
 */
export function getSubtitlesInRange(
  items: SubtitleItem[],
  currentTime: number,
  range: number = 5
): SubtitleItem[] {
  return items.filter(
    item =>
      item.endTime >= currentTime - range && item.startTime <= currentTime + range
  );
}

// 导出字幕生成器
export * from './subtitleGenerator';
