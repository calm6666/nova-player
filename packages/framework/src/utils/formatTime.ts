/**
 * ============================================
 * 时间格式化工具函数
 * ============================================
 * 提供视频播放时间格式化的功能
 * 将秒数转换为时:分:秒或分:秒的格式
 */

/**
 * 格式化时间显示
 * 将秒数转换为可读的时分秒格式
 *
 * @param seconds - 需要格式化的秒数
 * @param forceHours - 是否强制显示小时位（视频总时长超过一小时时，
 *                     当前播放时间即使为 0 也应显示 "00:00:00"，
 *                     避免播放过程中当前时间与总时长格式来回切换）
 * @returns 格式化后的时间字符串
 *
 * @example
 * formatTime(65)              // 返回 "01:05"
 * formatTime(3665)            // 返回 "01:01:05"
 * formatTime(0)               // 返回 "00:00"
 * formatTime(0, true)         // 返回 "00:00:00"
 * formatTime(65, true)        // 返回 "00:01:05"
 *
 * @description
 * 当时间超过1小时或 forceHours 为 true 时，返回格式为 "HH:MM:SS"（小时补齐两位）
 * 当时间不足1小时且 forceHours 为 false 时，返回格式为 "MM:SS"
 * 分钟和秒数始终保证两位数显示
 */
export function formatTime(seconds: number, forceHours: boolean = false): string {
    // 创建Date对象，将秒数转换为毫秒
    // 使用UTC时间避免时区影响
    const date = new Date(seconds * 1000);

    // 获取小时数
    const hours = date.getUTCHours();

    // 获取分钟数，并格式化为两位数（不足两位前面补0）
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');

    // 获取秒数，并格式化为两位数（不足两位前面补0）
    const secondsFormatted = date.getUTCSeconds().toString().padStart(2, '0');

    // 判断是否有小时部分
    if (hours > 0 || forceHours) {
        // 带小时位：小时补齐两位（如 00:00:00 / 01:01:05），
        // 超过 99 小时自然扩展为三位，不做截断
        const hoursFormatted = hours.toString().padStart(2, '0');
        return `${hoursFormatted}:${minutes}:${secondsFormatted}`;
    } else {
        // 不足1小时，返回简写格式：分:秒
        return `${minutes}:${secondsFormatted}`;
    }
}
