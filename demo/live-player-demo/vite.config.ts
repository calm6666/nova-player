import { defineConfig } from 'vite';
import luminaCompileV2 from '../../plugins/vite-plugin-lumina-compile-v2';


const repoRoot = new URL('../..', import.meta.url).pathname;

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  publicDir: false,
  // live-player 源码必须排除编译转换：本包使用运行时 h() + 显式响应式辅助函数，
  // 编译器会把 VNode 变量当成动态文本，控制栏按钮内容会退化成 [object Object]。
  plugins: [
    // live-player runtime h() + 显式响应式函数，保持排除
    luminaCompileV2({
      exclude: [/packages[\\/]live-player[\\/]/],
    }) as never,
  ],
  css: { preprocessorOptions: { scss: { api: 'modern-compiler' } } },
  server: { port: 8690, strictPort: true, fs: { allow: [repoRoot] } },
});
