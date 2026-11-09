import { defineConfig } from 'vite';
import path from 'path';
import { luminaCompile } from '../plugins/vite-plugin-lumina-compile';

/**
 * 开发态 demo：所有跨包引用均走 workspace 包名
 * （@lumina/framework / @lumina/nova / @lumina/plugins / @lumina/live-player），
 * 不再使用任何路径别名。
 */
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [
    // 静态子树模板化（tmplStatic）已默认开启：dev/prod 同一模板路径
    luminaCompile(),
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
