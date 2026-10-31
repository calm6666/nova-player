import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';
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
  /**
   * 库产物使用相对 base：
   * Worker 入口（弹幕调度 / 智能防挡分割）会以 `new URL(..., import.meta.url)` 形式
   * 留在 dist 中，绝对 base 会生成 `/assets/xxx.js`，消费方无法按包内路径解析；
   * 相对 base 生成「相对当前模块」的路径，dist 自包含，任何 bundler 都能接着打包。
   */
  base: './',
  plugins: [
    /**
     * 编译期 h() 改写（与播放器包一致）：
     * 把响应式属性包装成 __reactiveAttrs、响应式文本包装成 _reactiveText。
     * 缺了它，组件里 `class: `xxx${signal.value}`` 这类写法会在挂载时求值一次，
     * 展开/折叠、菜单开关等状态就不再响应（插件本身是响应式写法）。
     */
    luminaCompile(),
    {
      /**
       * i18n 必须与 @lumina/nova 共用同一个实例：插件 dist 若自带一份
       * core/i18n，应用注册的语言包（VideoPlayer 的 i18n.messages）插件读不到，
       * 弹幕列表面板就只能显示 i18n key。
       * 这里把 core 内部的 ./i18n 导入重定向到 shared/novaI18n（t 来自 nova）。
       */
      name: 'nova-shared-i18n',
      enforce: 'pre',
      resolveId(source, importer) {
        if (!importer) return null;
        const normalized = importer.replace(/\\/g, '/');
        const shim = resolve(__dirname, 'src/shared/novaI18n.ts').replace(/\\/g, '/');
        if (normalized === shim) return null;
        const fromCore = normalized.includes('/nova-player/core/');
        if (fromCore && (source === './i18n' || source === '../i18n')) return shim;
        if (source === '@/core/i18n') return shim;
        return null;
      },
    },
    dts({
      // 根 vite-env.d.ts 声明了 *.png / *.scss?inline / *?url 等资源模块，
      // 不挂进 include 的话 dts 内部 tsc 解析资源导入会报 TS2307（构建噪音）
      include: ['src/**/*', '../../vite-env.d.ts'],
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
        music: resolve(__dirname, 'src/music/index.ts'),
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
