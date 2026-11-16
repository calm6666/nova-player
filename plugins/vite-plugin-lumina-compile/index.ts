/**
 * vite-plugin-lumina-compile
 *
 * 零配置 Vite 编译插件
 * 参照 Vue/Solid/Svelte 插件设计模式：
 * - 自动检测 dev/prod 环境（configResolved）
 * - 自动注入 __LUMINA_DEV__ 常量（config.define）
 * - Dev/Prod 同一套编译产物（与 Vue/Solid 一致）：h() → _create* 专用函数
 * - Prod 额外启用静态提升（hoistStatic，与 Vue plugin-vue 一致）
 * - 静态提升常量通过 _cloneHoisted() 克隆复用，避免共享节点污染
 *
 * 智能文件过滤：
 * - Vue 只处理 .vue 文件，Solid 只处理含 JSX 的文件
 * - 本插件只处理「真正使用了框架 API」的文件：
 *   通过检测 import 语句判断文件是否引入了 h/defineComponent 等
 *   纯工具函数文件（即使有 class）不会被转换
 * - 所有转换都通过 babel scope 校验标识符来源，
 *   只转换来自框架模块（@/core、@/nova）的 h/defineComponent，
 *   不误伤其他库的同名导出（如 preact 的 h）
 *
 * 使用方式：
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { luminaCompile } from './plugins/vite-plugin-lumina-compile';
 *
 * export default defineConfig({
 *   plugins: [luminaCompile()],  // 零配置，自动检测环境
 * });
 * ```
 */

import type { Plugin, ResolvedConfig, UserConfig, TransformResult } from "vite";
import { transformCode } from "./transform";
import type { LuminaCompileOptions } from "./types";

/**
 * 默认配置
 */
const DEFAULT_OPTIONS: Required<LuminaCompileOptions> = {
  hoistStatic: true,
  // ★ 静态子树模板化默认开启（编译期 DOM 化阶段 1）：
  // 静态子树 → HTML 字符串 + _tmpl() 惰性 <template> cloneNode，
  // mount 一次克隆直达 DOM / SSR 直拼 / 水合直接采用 SSR DOM。
  // dev 与 prod 走同一模板路径（与 Solid/Svelte 编译真实 DOM 的策略一致）；
  // 不适用模板的场景（裸 SVG 子标签/ref/表格标签等）自动回退 VNode 提升路径
  tmplStatic: true,
  compileComponentType: true,
  compileAttrs: true,
  // ★ 默认开发环境也执行转换（与 Vue/Solid 一致）：
  // dev/prod 使用同一套编译产物，消除双路径行为差异，
  // 编译路径的 Bug（__events/__ref/__providers）在 dev 即可暴露
  dev: true,
  include: [/\.tsx?$/],
  exclude: [
    /node_modules/,
    /\.test\./,
    /\.spec\./,
    // 框架源码目录不转换（框架自身 export API，不是消费者）
    // 与 Solid 排除 node_modules/solid-js 的逻辑一致
    // 应用代码在 demo/、packages/ 等目录中
    /[\\/]core[\\/]/,
    // 插件自身源码不转换
    /plugins[/\\]vite-plugin-lumina-compile/,
  ],
  internalImportSource: "@lumina/framework/core/internal",
};

/**
 * 框架 API 标识符
 * 只有 import 这些标识符的文件才被视为组件文件
 * 与 Vue 只处理 .vue、Solid 只处理 JSX 的思路一致：
 * 通过文件内容特征判断，而非硬编码路径
 */
const FRAMEWORK_IMPORTS = [
  "h",               // h() VNode 创建函数
  "defineComponent", // defineComponent() 组件定义
  "Fragment",        // Fragment 标签
  "show",            // show() 条件渲染
  "each",            // each() 列表渲染
];

/**
 * 预编译的框架 API 检测正则（模块级，避免每次 transform 重新创建）
 * 匹配 import { h, defineComponent, ... } from '...' 或 import { h as alias } from '...'
 */
const FRAMEWORK_REGEXPS: RegExp[] = FRAMEWORK_IMPORTS.map(
  (name) =>
    new RegExp(
      `\\bimport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]`,
    ),
);

/**
 * 快速检测文件是否真正使用了框架 API
 *
 * 通过检查 import 语句判断：
 * - 如果文件 import 了 h/defineComponent 等，说明是组件文件，需要转换
 * - 如果文件没有 import 这些，说明是纯工具/类型文件，跳过
 *
 * @param code - 源码内容
 * @returns true 表示文件使用了框架 API，需要转换
 */
function usesFrameworkAPI(code: string): boolean {
  for (const regex of FRAMEWORK_REGEXPS) {
    if (regex.test(code)) return true;
  }
  return false;
}

/**
 * 创建 lumina-compile Vite 插件
 *
 * @param options - 可选配置（全部可选，零配置时使用默认值）
 * @returns Vite 插件对象
 */
export function luminaCompile(options?: LuminaCompileOptions): Plugin {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 闭包变量：存储环境信息
  let isServe = false;
  let isProduction = false;

  return {
    name: "lumina-compile",

    /**
     * config 钩子：自动注入环境变量
     *
     * 与 Solid 插件模式一致：使用 config 第二参数的 command 判断环境
     * 注意：config 钩子运行在 configResolved 之前，此时闭包变量还未设置，
     * 所以必须使用 command 参数而非闭包变量
     */
    config(_userConfig, { command }): UserConfig {
      const isBuild = command === "build";
      return {
        define: {
          __LUMINA_DEV__: JSON.stringify(!isBuild),
        },
      };
    },

    /**
     * configResolved 钩子：自动检测当前环境
     *
     * 与 Vue/Svelte 插件完全一致的模式：
     * - serve: vite dev 启动开发服务器
     * - build: vite build 生产打包
     */
    configResolved(resolvedConfig: ResolvedConfig): void {
      isServe = resolvedConfig.command === "serve";
      isProduction = resolvedConfig.isProduction;
    },

    /**
     * transform 钩子：dev/prod 统一编译（与 Vue/Solid 一致）
     *
     * 三层过滤策略：
     * 1. 文件扩展名过滤（include/exclude）
     * 2. 内容过滤：检测文件是否真正 import 了框架 API
     * 3. 环境过滤：默认 dev/prod 都执行转换；dev: false 时开发模式跳过
     *
     * - Dev：转换（h() → _create*、组件标记、属性预分类），保留 HMR 容错
     * - Prod：全量优化（额外启用静态提升）
     * 开发警告由 __LUMINA_DEV__ 在运行时控制（dev true / prod false 触发 DCE）
     */
    transform(code: string, id: string): TransformResult | null {
      // 第一层：文件扩展名过滤
      const isIncluded = opts.include.some((pattern) => pattern.test(id));
      if (!isIncluded) return null;

      const isExcluded = opts.exclude.some((pattern) => pattern.test(id));
      if (isExcluded) return null;

      // v2 已在 pre 阶段处理过的文件仍继续走 v1：
      // v2 只替换命中的 h()，剩余调用交给 v1 编译，避免混合文件退化到运行时 h()。
      // v2 自身通过 @lumina-compiled:v2 标记保证幂等。

      // 第二层：内容过滤 —— 只转换真正使用了框架 API 的文件
      // 参照 Vue 只处理 .vue、Solid 只处理 JSX 的思路
      // 纯工具/类型文件即使有 class 也不会被转换
      if (!usesFrameworkAPI(code)) return null;

      // 第三层：环境过滤
      // 默认 dev/prod 都编译（dev: false 显式回到旧行为）
      if (isServe && !isProduction && !opts.dev) {
        return null;
      }

      // 执行 AST 转换（dev/prod 同一套编译，静态提升仅生产构建生效）
      // tmplStatic 开启时 dev 也激活静态提升：便于 dev server 即验证模板路径
      // （hoistStaticCall 内部按 tmplStatic 分流：模板化 / VNode 克隆回退）
      const result = transformCode(code, id, {
        isProduction,
        hoistStatic: opts.hoistStatic && (isProduction || opts.tmplStatic),
        tmplStatic: opts.tmplStatic,
        compileComponentType: opts.compileComponentType,
        compileAttrs: opts.compileAttrs,
        internalImportSource: opts.internalImportSource,
      });

      if (!result) return null;

      return {
        code: result.code,
        map: result.map as never,
      };
    },
  };
}

export type { LuminaCompileOptions };
