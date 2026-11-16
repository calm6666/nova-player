import { defineConfig } from 'vite';
import path from 'path';
import luminaCompileV2 from '../plugins/vite-plugin-lumina-compile-v2';

/**
 * 开发态 demo：所有跨包引用均走 workspace 包名
 * （@lumina/framework / @lumina/nova / @lumina/plugins / @lumina/live-player），
 * 不再使用任何路径别名。
 */
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [
    // v2 默认全量；vite 类型来自不同安装实例，这里做一次跨实例兼容转换
    luminaCompileV2() as never,
  ],
  build: {
    // demo 入口使用顶层 await（按需加载播放器样式 / SSR 数据预取）
    target: 'esnext',
  },
  server: {
    port: 5174,
    open: true,
  },
});
