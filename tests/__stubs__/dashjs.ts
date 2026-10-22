/** dashjs test stub：仅用于 Node SSR 导入，不执行播放逻辑 */
export const MediaPlayer = {
  create: (): never => {
    throw new Error('dashjs stub: runtime playback not available in tests');
  },
};
export default { MediaPlayer };
