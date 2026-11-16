import { defineConfig } from 'vite';
import path from 'node:path';
import luminaCompileV2 from '../plugins/vite-plugin-lumina-compile-v2';

/**
 * 生产构建验证 demo：全部通过 workspace 包名导入构建产物
 * （@lumina/framework / @lumina/nova / @lumina/plugins），无任何路径别名。
 */
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [luminaCompileV2() as never],
  build: {
    target: 'esnext',
  },
});
