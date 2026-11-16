/**
 * Lumina h() 编译插件（v2 静态骨架 + v1 收尾）
 *
 * 用法：
 * ```ts
 * import luminaCompileV2 from "@lumina/vite-plugin-lumina-compile";
 * plugins: [
 *   luminaCompileV2({
 *     compileFiles: [/nova-cross-slots\.ts$/],
 *     internalImportSource: "@lumina/framework/core/internal-dom",
 *     v1InternalImportSource: "@lumina/framework/core/internal",
 *   }),
 * ]
 * ```
 */
import type { Plugin } from "vite";

/** 与 plugins/vite-plugin-lumina-compile-v2/types.ts 保持一致 */
export interface LuminaCompileV2Options {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 文件头 pragma；默认 @lumina:compile */
  pragma?: string;
  /** 显式白名单：为空表示全量；支持 RegExp / 绝对路径 / 项目相对路径 / 后缀 */
  compileFiles?: Array<string | RegExp>;
  /** 排除规则 */
  exclude?: Array<string | RegExp>;
  /** v2 运行时内部模块导入源 */
  internalImportSource?: string;
  /** v1 收尾运行时内部模块导入源 */
  v1InternalImportSource?: string;
  /** v1 是否按 production 模式编译（默认跟随 vite command） */
  v1IsProduction?: boolean;
  /** 是否编译测试文件（默认 false） */
  transformTests?: boolean;
  [key: string]: unknown;
}

/** 编译插件（默认导出同时提供具名导出） */
export default function luminaCompileV2(
  options?: LuminaCompileV2Options,
): Plugin;

export declare function luminaCompileV2(
  options?: LuminaCompileV2Options,
): Plugin;
