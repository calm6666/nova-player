import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const src = resolve(__dirname, 'src');

/**
 * 框架库构建
 *
 * 产物必须保留源码目录结构（dist/core/h.js、dist/utils/rafTimeout.js …），
 * 因为 package.json exports 暴露了 "./core/*"、"./utils/*" 等子路径。
 * 因此使用 rollup 的 preserveModules 而不是单文件 bundle。
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    lib: {
      entry: {
        index: resolve(src, 'index.ts'),
        i18n: resolve(src, 'i18n.ts'),
        'core/index': resolve(src, 'core/index.ts'),
        'types/index': resolve(src, 'types/index.ts'),
        'types/plugin': resolve(src, 'types/plugin.ts'),
        'utils/index': resolve(src, 'utils/index.ts'),
        'events/index': resolve(src, 'events/index.ts'),
        'error/index': resolve(src, 'error/index.ts'),
        'directives/index': resolve(src, 'directives/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      /**
       * 框架的子路径导出（./core/*、./utils/* …）会被编译期插件直接引用，
       * 因此不能依赖 tree-shaking 决定模块导出：关闭 treeshake，保证每个模块
       * 的导出（如 _tmpl）都完整保留。
       */
      treeshake: false,
      output: {
        preserveModules: true,
        preserveModulesRoot: src,
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
