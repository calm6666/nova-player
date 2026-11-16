/**
 * 打包入口：直接复用 plugins/ 下的 v1 / v2 编译器实现，
 * 由 esbuild 打成单文件 ESM（babel / magic-string 一起打进去），
 * 消费方（apps/web 的 vite 配置）无需再安装这些依赖。
 */
export { default, default as luminaCompileV2 } from "../../../plugins/vite-plugin-lumina-compile-v2/index";
export type { LuminaCompileV2Options } from "../../../plugins/vite-plugin-lumina-compile-v2/types";
