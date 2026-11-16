# @lumina/vite-plugin-lumina-compile

Lumina `h()` 编译插件（v2 静态骨架 + v1 收尾），用于把 **指定文件** 里的运行时 `h()`
编译成「静态骨架 + 响应式洞」。播放器自身的源码在 nova-player 内构建时使用同一套
编译器；本包把编译器打成单文件 ESM，方便其它应用（如 apps/web）按白名单引入。

## 构建

```bash
pnpm --filter @lumina/vite-plugin-lumina-compile build
```

产物：`dist/index.mjs`（v1/v2 转换器 + babel 依赖已打包）、`dist/index.d.ts`。

## 在应用 vite 配置中使用

```ts
import luminaCompileV2 from "@lumina/vite-plugin-lumina-compile";

plugins: [
  luminaCompileV2({
    // 只编译指定文件（RegExp / 绝对路径 / 项目相对路径 / 后缀均可）
    compileFiles: [/apps[\\/]web[\\/]src[\\/].*nova-cross-slots\.ts$/],
    internalImportSource: "@lumina/framework/core/internal-dom",
    v1InternalImportSource: "@lumina/framework/core/internal",
    v1IsProduction: command === "build",
  }),
  // ...其它插件（例如 SolidStart）
]
```

- 插件 `enforce: 'pre'`，应放在插件数组最前面，先于其它框架的编译转换。
- 目标文件也可以加文件头 pragma `/* @lumina:compile */` 作为额外放行条件。
- 只处理 `.ts/.tsx` 且必须真实 `import { h } from '@lumina/...'` 的文件；
  其它文件（Solid JSX / 普通 TS）完全不受影响。

## 编译后的写法约定

- 响应式文本：`() => expr` 或成员访问 `.value`（编译为 text 洞 + effect）。
- 响应式属性：`class` / `style` 等数组/表达式（编译为 attr 洞 + effect）。
- 条件 / 循环：使用 Lumina 的 `Show` / `For` / `Switch` / `Match` / `Dynamic`。
- 不要在同一文件混用 Solid 的 `createSignal/createMemo/JSX`：两套响应式系统互不可见。
