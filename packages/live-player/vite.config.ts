import { defineConfig } from 'vite';
import path from 'node:path';
import dts from 'vite-plugin-dts';
import { luminaCompile } from '../../plugins/vite-plugin-lumina-compile';

/** 生产构建统一压缩/混淆策略 */
const terserOptions = {
  ecma: 2020 as const,
  compress: {
    passes: 2,
    drop_debugger: true,
  },
  mangle: {
    toplevel: true,
  },
  format: {
    comments: false,
  },
};

export default defineConfig({
  root: __dirname,
  publicDir: false,
  plugins: [
    // live-player 必须排除在编译转换之外：本包刻意使用运行时 h() + 显式
    // reactive()/text() 辅助函数，编译器会把「VNode 变量」误判为动态文本，
    // 生成 _reactiveText(() => vnode)，导致按钮内容渲染成 [object Object]。
    luminaCompile({ exclude: [/node_modules/, /\.test\./, /\.spec\./, /packages[\\/]live-player[\\/]/] }),
    dts({
      include: ['src'],
      entryRoot: 'src',
      outDir: 'dist',
      insertTypesEntry: true,
      rollupTypes: false,
      // 声明文件生成只做 emit：类型检查由 `tsc --noEmit -p tsconfig.json` 负责。
      skipDiagnostics: true,
      logLevel: 'silent',
    }),
  ],
  css: { preprocessorOptions: { scss: { api: 'modern-compiler' } } },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'LuminaLivePlayer',
      fileName: () => 'index.js',
      formats: ['es'],
    },
    rollupOptions: {
      // 框架与播放器契约经 workspace 包依赖提供，保持 external
      external: ['@lumina/nova', /^@lumina\/framework(\/.*)?$/],
    },
    cssCodeSplit: false,
    emptyOutDir: true,
    sourcemap: false,
    minify: 'terser',
    terserOptions,
    cssMinify: true,
  },
});
