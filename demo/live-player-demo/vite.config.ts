import { defineConfig } from 'vite';
import path from 'node:path';
import { luminaCompile } from '../../plugins/vite-plugin-lumina-compile';

const repoRoot = path.resolve(__dirname, '../..');
const at = (p: string): string => path.resolve(repoRoot, p);

export default defineConfig({
  root: __dirname,
  publicDir: false,
  // live-player 源码必须排除编译转换：本包使用运行时 h() + 显式响应式辅助函数，
  // 编译器会把 VNode 变量当成动态文本，生成 _reactiveText(() => vnode)，
  // 控制栏按钮内容会退化成 [object Object]。
  plugins: [
    luminaCompile({
      exclude: [/node_modules/, /\.test\./, /\.spec\./, /packages[\\/]live-player[\\/]/],
    }),
  ],
  resolve: {
    alias: [
      { find: /^@\/live\/(.*)/, replacement: path.resolve(repoRoot, 'packages/live-player/src/$1') },
      { find: /^@\/core$/, replacement: at('core/index.ts') },
      { find: /^@\/core\/(.*)/, replacement: at('core/$1') },
      { find: /^@\/types$/, replacement: at('types/index.ts') },
      { find: /^@\/types\/(.*)/, replacement: at('types/$1') },
      { find: /^@\/error$/, replacement: at('error/index.ts') },
      { find: /^@\/error\/(.*)/, replacement: at('error/$1') },
      { find: /^@\/utils$/, replacement: at('utils/index.ts') },
      { find: /^@\/utils\/(.*)/, replacement: at('utils/$1') },
      { find: /^@\/events$/, replacement: at('events/index.ts') },
      { find: /^@\/events\/(.*)/, replacement: at('events/$1') },
      { find: /^@\/directives$/, replacement: at('directives/index.ts') },
      { find: /^@\/directives\/(.*)/, replacement: at('directives/$1') },
      { find: /^@\/lumina\/plugins\/(.*)/, replacement: at('packages/plugins/src/$1') },
      { find: /^@\/nova\/(.*)/, replacement: at('packages/player/src/$1') },
      { find: '@lumina/nova', replacement: at('packages/player/src/index.ts') },
      { find: 'hls.js', replacement: at('packages/plugins/hls/dist/hls.mjs') },
      { find: 'flv.js', replacement: at('node_modules/.pnpm/flv.js@1.6.2/node_modules/flv.js/dist/flv.js') },
      { find: '@lumina/plugins', replacement: at('packages/plugins/src/index.ts') },
    ],
  },
  css: { preprocessorOptions: { scss: { api: 'modern-compiler' } } },
  server: { port: 8690, strictPort: true, fs: { allow: [repoRoot] } },
});

