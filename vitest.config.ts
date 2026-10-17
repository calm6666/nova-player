import { defineConfig } from 'vitest/config';
import path from 'path';
import { luminaCompile } from './plugins/vite-plugin-lumina-compile';

export default defineConfig({
  /**
   * ⚠️ 必须挂载 luminaCompile，并且**让测试文件也参与转换**：
   *
   * 1. 框架的属性/文本响应式依赖编译期转换——只有插件把
   *    `style: { display: sig.value ? '' : 'none' }` 提取为
   *    `__reactiveAttrs: { style: () => (...) }`、把内联箭头子节点包装为
   *    `_reactiveText`，mount 才会注册对应 effect。缺了插件，测试里
   *    signal 变化**不会**更新 DOM，响应式断言会失败（而非响应式断言则假性通过）。
   *
   * 2. 组件 props 的响应式同样依赖**调用方**被转换：`h(C, { visible: sig.value })`
   *    会被包装成惰性 thunk（`_rp`）。因此若测试文件本身不转换，
   *    就无法在测试中验证「父组件写 signal → 子组件 DOM 更新」这条链路。
   *    故此处覆盖默认 exclude，仅保留 node_modules / spec / 框架 core / 插件自身。
   *
   * 结果：测试环境与生产构建走完全相同的编译管线，断言才有意义。
   */
  plugins: [
    luminaCompile({
      exclude: [
        /node_modules/,
        /\.spec\./,
        // 框架源码目录不转换（与插件默认一致）
        /[\\/]core[\\/]/,
        // 插件自身源码不转换（与插件默认一致）
        /plugins[/\\]vite-plugin-lumina-compile/,
      ],
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'core/**/*.ts',
        'packages/player/src/**/*.ts',
        'packages/plugins/src/**/*.ts',
        'packages/live-player/src/**/*.ts',
      ],
    },
  },
  resolve: {
    alias: [
      // ===== 精确匹配正则（必须放在子路径和 catch-all 之前）=====
      { find: /^@\/core$/, replacement: path.resolve(__dirname, 'core/index.ts') },
      { find: /^@\/types$/, replacement: path.resolve(__dirname, 'types/index.ts') },
      { find: /^@\/utils$/, replacement: path.resolve(__dirname, 'utils/index.ts') },
      { find: /^@\/events$/, replacement: path.resolve(__dirname, 'events/index.ts') },
      { find: /^@\/error$/, replacement: path.resolve(__dirname, 'error/index.ts') },
      { find: /^@\/directives$/, replacement: path.resolve(__dirname, 'directives/index.ts') },

      // ===== 子路径正则（从具体到一般排序）=====
      { find: /^@\/lumina\/plugins\/(.*)/, replacement: path.resolve(__dirname, 'packages/plugins/src/$1') },
      { find: /^@\/live\/(.*)/, replacement: path.resolve(__dirname, 'packages/live-player/src/$1') },
      { find: /^@\/nova\/(.*)/, replacement: path.resolve(__dirname, 'packages/player/src/$1') },
      { find: /^@\/core\/(.*)/, replacement: path.resolve(__dirname, 'core/$1') },
      { find: /^@\/types\/(.*)/, replacement: path.resolve(__dirname, 'types/$1') },
      { find: /^@\/utils\/(.*)/, replacement: path.resolve(__dirname, 'utils/$1') },
      { find: /^@\/directives\/(.*)/, replacement: path.resolve(__dirname, 'directives/$1') },
      { find: /^@\/events\/(.*)/, replacement: path.resolve(__dirname, 'events/$1') },
      { find: /^@\/error\/(.*)/, replacement: path.resolve(__dirname, 'error/$1') },

      // ===== catch-all（必须放最后）=====
      { find: /^@\/(.*)/, replacement: path.resolve(__dirname, 'packages/player/src/$1') },

      // ===== 外部库别名 =====
      { find: 'hls.js', replacement: path.resolve(__dirname, 'packages/plugins/hls/dist/hls.mjs') },
      { find: 'dashjs', replacement: path.resolve(__dirname, 'tests/__stubs__/dashjs.ts') },
      { find: 'flv.js', replacement: path.resolve(__dirname, 'tests/__stubs__/flvjs.ts') },
    ],
  },
});
