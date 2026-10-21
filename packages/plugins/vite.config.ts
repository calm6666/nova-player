import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

/** 生产构建统一压缩/混淆策略 */
const terserOptions = {
  ecma: 2020,
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
  plugins: [
    dts({
      include: ['src/**/*'],
      // 注意：hls.js 现指向包内的独立 fork 仓库 hls/（git submodule，独立双远程维护）。
      // dts 插件会按导入图把 fork 源文件也镜像输出（路径镜像成 dist/hls/...），
      // 与 rollup 要写出的入口 chunk（entryFileNames 的 hls → dist/hls.js）**同名冲突**，
      // 导致 EISDIR 构建失败。故必须把 fork 目录排除在声明输出之外；
      // 'hls/**' 锚定包根的 fork 目录，不会误伤插件源码 src/hls/**。
      exclude: ['**/*.test.ts', 'hls/**'],
      insertTypesEntry: true,
      entryRoot: 'src',
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        danmaku: resolve(__dirname, 'src/danmaku/index.ts'),
        subtitle: resolve(__dirname, 'src/subtitle/index.ts'),
        dash: resolve(__dirname, 'src/dash/index.ts'),
        hls: resolve(__dirname, 'src/hls/index.ts'),
        flv: resolve(__dirname, 'src/flv/index.ts'),
        top: resolve(__dirname, 'src/top/index.ts'),
        ending: resolve(__dirname, 'src/ending/index.ts'),
        audioeffect: resolve(__dirname, 'src/audioeffect/index.ts'),
        interaction: resolve(__dirname, 'src/interaction/index.ts'),
        'interactive-video': resolve(
          __dirname,
          'src/interactive-video/index.ts',
        ),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['@lumina/nova', 'dashjs', 'flv.js'],
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
    },
    outDir: resolve(__dirname, 'dist'),
    sourcemap: false,
    minify: 'terser',
    terserOptions,
    cssMinify: true,
  },
  resolve: {
    alias: [
      { find: /^@\/lumina\/plugins/, replacement: resolve(__dirname, 'src') },
      { find: /^@\/nova/, replacement: resolve(__dirname, '../player/src') },
      { find: /^@\//, replacement: resolve(__dirname, '../..') + '/' },
      { find: 'hls.js', replacement: resolve(__dirname, 'hls/dist/hls.mjs') },
    ],
  },
});
