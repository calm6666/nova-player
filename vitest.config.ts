import { defineConfig } from 'vitest/config';
import * as luminaCompileV2Module from './plugins/vite-plugin-lumina-compile-v2';

/** 兼容具名 / 默认两种导出形式，避免插件入口导出形式变化导致配置加载失败 */
const luminaCompileV2 = (
  (luminaCompileV2Module as any).luminaCompileV2 ??
  (luminaCompileV2Module as any).default
) as (options?: Record<string, unknown>) => import('vite').Plugin;

export default defineConfig({
  /**
   * 必须挂载编译插件，并且让测试文件也参与转换：
   *
   * 1. 框架的属性/文本响应式依赖编译期转换，mount 才会注册对应 effect；
   *    缺了插件，signal 变化不会更新 DOM（响应式断言会失败）。
   * 2. 组件 props 的响应式同样依赖调用方被转换。
   *
   * 测试与生产构建走完全相同的 v2 编译管线。所有跨包引用均通过 workspace 包名解析。
   */
  plugins: [
    luminaCompileV2({
      transformTests: true,
      exclude: [/node_modules/, /\.spec\./],
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
