import { defineConfig } from 'vitest/config';
import { luminaCompile } from './plugins/vite-plugin-lumina-compile';

export default defineConfig({
  /**
   * ⚠️ 必须挂载 luminaCompile，并且**让测试文件也参与转换**：
   *
   * 1. 框架的属性/文本响应式依赖编译期转换——只有插件把
   *    `style: { display: sig.value ? '' : 'none' }` 提取为
   *    `__reactiveAttrs: { style: () => (...) }`、把内联箭头子节点包装为
   *    `_reactiveText`，mount 才会注册对应 effect。缺了插件，测试里
   *    signal 变化**不会**更新 DOM（响应式断言会失败）。
   *
   * 2. 组件 props 的响应式同样依赖**调用方**被转换：`h(C, { visible: sig.value })`
   *    会被包装成惰性 thunk（`_rp`）。因此若测试文件本身不转换，
   *    就无法在测试中验证「父组件写 signal → 子组件 DOM 更新」这条链路。
   *
   * 测试与生产构建走完全相同的编译管线。所有跨包引用均通过 workspace 包名解析。
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
        'packages/framework/src/**/*.ts',
        'packages/player/src/**/*.ts',
        'packages/plugins/src/**/*.ts',
        'packages/live-player/src/**/*.ts',
      ],
    },
  },
});
