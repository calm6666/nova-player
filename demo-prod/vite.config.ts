import { defineConfig } from 'vite';
import path from 'node:path';
import { luminaCompile } from '../plugins/vite-plugin-lumina-compile';

/**
 * 生产构建验证 demo：全部通过 workspace 包名导入构建产物
 * （@lumina/framework / @lumina/nova / @lumina/plugins），无任何路径别名。
 */
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [luminaCompile()],
  build: {
    target: 'esnext',
  },
});
