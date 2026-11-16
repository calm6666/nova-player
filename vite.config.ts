import { defineConfig } from 'vite';
import luminaCompileV2 from './plugins/vite-plugin-lumina-compile-v2';

/**
 * 仓库根 dev server（沙盒页）。
 * 所有跨包引用一律使用 workspace 包名，不再配置任何路径别名。
 */
export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [
    // 默认全量编译：静态骨架 + 动态洞
    luminaCompileV2(),
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
