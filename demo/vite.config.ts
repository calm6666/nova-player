import { defineConfig } from 'vite';
import path from 'path';
import { luminaCompile } from '../plugins/vite-plugin-lumina-compile';

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [
    // 静态子树模板化（tmplStatic）已默认开启：dev/prod 同一模板路径
    luminaCompile(),
  ],
  resolve: {
    alias: [
      { find: /^@lumina\/nova$/, replacement: path.resolve(__dirname, '../packages/player/src/index.ts') },
      { find: /^@\/core$/, replacement: path.resolve(__dirname, '../core/index.ts') },
      { find: /^@\/types$/, replacement: path.resolve(__dirname, '../types/index.ts') },
      { find: /^@\/utils$/, replacement: path.resolve(__dirname, '../utils/index.ts') },
      { find: /^@\/events$/, replacement: path.resolve(__dirname, '../events/index.ts') },
      { find: /^@\/error$/, replacement: path.resolve(__dirname, '../error/index.ts') },
      { find: /^@\/directives$/, replacement: path.resolve(__dirname, '../directives/index.ts') },

      { find: /^@\/lumina\/plugins\/(.*)/, replacement: path.resolve(__dirname, '../packages/plugins/src/$1') },
      { find: /^@\/nova\/(.*)/, replacement: path.resolve(__dirname, '../packages/player/src/$1') },
      { find: /^@\/locales\/(.*)/, replacement: path.resolve(__dirname, '../locales/$1') },
      { find: /^@\/core\/(.*)/, replacement: path.resolve(__dirname, '../core/$1') },
      { find: /^@\/types\/(.*)/, replacement: path.resolve(__dirname, '../types/$1') },
      { find: /^@\/utils\/(.*)/, replacement: path.resolve(__dirname, '../utils/$1') },
      { find: /^@\/directives\/(.*)/, replacement: path.resolve(__dirname, '../directives/$1') },
      { find: /^@\/events\/(.*)/, replacement: path.resolve(__dirname, '../events/$1') },
      { find: /^@\/error\/(.*)/, replacement: path.resolve(__dirname, '../error/$1') },

      { find: /^@\/(.*)/, replacement: path.resolve(__dirname, '../packages/player/src/$1') },

      { find: 'hls.js', replacement: path.resolve(__dirname, '../packages/plugins/hls/dist/hls.mjs') },
    ],
  },
  server: {
    port: 5174,
    open: true,
  },
});
