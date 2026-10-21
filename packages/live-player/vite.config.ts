import { defineConfig } from 'vite';
import path from 'node:path';
import dts from 'vite-plugin-dts';
import { luminaCompile } from '../../plugins/vite-plugin-lumina-compile';

const repoRoot = path.resolve(__dirname, '../..');
const at = (p: string): string => path.resolve(repoRoot, p);

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
    luminaCompile({ exclude: [/node_modules/, /\.test\./, /\.spec\./, /packages[\\/]live-player[\\/]/] }),
    dts({
      include: ['src'],
      entryRoot: 'src',
      outDir: 'dist',
      insertTypesEntry: true,
      rollupTypes: false,
      // 声明文件生成只做 emit：类型检查由 `tsc --noEmit -p tsconfig.json` 负责。
      // 不跳过诊断时，插件宿主引入的点播播放器类型图谱会撑爆 dts worker 的堆。
      skipDiagnostics: true,
      logLevel: 'silent',
    }),
  ],
  resolve: {
    alias: [
      { find: /^@\/live\/(.*)/, replacement: path.resolve(__dirname, 'src/$1') },
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
      {
        find: 'flv.js',
        replacement: at('node_modules/.pnpm/flv.js@1.6.2/node_modules/flv.js/dist/flv.js'),
      },
      { find: '@lumina/plugins', replacement: at('packages/plugins/src/index.ts') },
    ],
  },
  css: { preprocessorOptions: { scss: { api: 'modern-compiler' } } },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'LuminaLivePlayer',
      fileName: () => 'index.js',
      formats: ['es'],
    },
    cssCodeSplit: false,
    emptyOutDir: true,
    sourcemap: false,
    minify: 'terser',
    terserOptions,
    cssMinify: true,
  },
});

