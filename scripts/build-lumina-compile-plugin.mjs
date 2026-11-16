#!/usr/bin/env node
// 打包 @lumina/vite-plugin-lumina-compile：把 v1 / v2 编译器 + babel 依赖
// 打成单文件 ESM，供 apps/web 的 vite 配置直接引入（无需额外安装 babel）。
//
// 说明：nova-player 自身没有顶层依赖 esbuild（由 vite 传递安装），
// 这里从 pnpm store 中定位 esbuild 再加载，避免额外添加 devDependency。
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "../packages/vite-plugin-lumina-compile");
const distDir = join(packageDir, "dist");

/** 在 node_modules/.pnpm 中找到 esbuild 包目录并动态加载 */
async function loadEsbuild() {
  const storeDir = join(here, "..", "node_modules", ".pnpm");
  const entries = await readdir(storeDir);
  const dir = entries
    .filter((name) => /^esbuild@/.test(name))
    .sort()
    .pop();
  if (!dir) throw new Error("未在 node_modules/.pnpm 中找到 esbuild");
  const entry = join(storeDir, dir, "node_modules", "esbuild", "lib", "main.js");
  return import(pathToFileURL(entry).href);
}

const { build } = await loadEsbuild();

await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [join(packageDir, "src/index.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  outfile: join(distDir, "index.mjs"),
  // vite 只在类型层面使用；运行期插件对象不需要 vite 运行时
  external: ["vite"],
  resolveExtensions: [".ts", ".tsx", ".mjs", ".js", ".json"],
  loader: { ".json": "json" },
  logLevel: "info",
  banner: {
    js: "// @lumina/vite-plugin-lumina-compile (bundled: v2 skeleton + v1 finish)",
  },
});

await copyFile(join(packageDir, "src/types.d.ts"), join(distDir, "index.d.ts"));

console.log("[lumina-compile-plugin] dist/index.mjs + dist/index.d.ts 已生成");

