/** flv.js test stub：仅用于 Node SSR 导入，不执行播放逻辑 */
const flvjs = {
  isSupported: (): boolean => false,
  createPlayer: (): never => {
    throw new Error('flv.js stub: runtime playback not available in tests');
  },
};
export default flvjs;
