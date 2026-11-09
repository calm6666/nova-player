import { defineConfig } from 'vite';
import { luminaCompile } from './plugins/vite-plugin-lumina-compile';

/**
 * 仓库根 dev server（沙盒页）。
 * 所有跨包引用一律使用 workspace 包名，不再配置任何路径别名。
 */
export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [
    // 零配置编译插件：自动检测 dev/prod，dev 模式零开销，prod 模式全量优化
    luminaCompile(),
  ],
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
