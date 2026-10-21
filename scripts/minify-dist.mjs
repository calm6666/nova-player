/**
 * 构建后统一处理 dist 产物：
 * - Terser 压缩 + 变量混淆 + 去除注释
 * - 删除 sourcemap，避免混淆结果被还原
 * - 仅处理 .js，不碰 .d.ts
 *
 * 用法：node scripts/minify-dist.mjs <dist目录>
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { minify } from 'terser';

const target = resolve(process.argv[2] ?? 'dist');
if (!existsSync(target)) {
  console.error(`[minify-dist] 目录不存在: ${target}`);
  process.exit(1);
}

const terserBase = {
  ecma: 2020,
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

/** 递归收集文件 */
function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const files = walk(target);
let minified = 0;
let removedMaps = 0;

for (const file of files) {
  if (file.endsWith('.map')) {
    rmSync(file, { force: true });
    removedMaps += 1;
    continue;
  }
  if (!file.endsWith('.js') || file.endsWith('.d.ts')) continue;

  const code = readFileSync(file, 'utf8');
  const isUmd = file.endsWith('.umd.js');
  const result = await minify(code, {
    ...terserBase,
    // UMD 依赖脚本级 this，不能按 ESM 的严格模式处理
    module: !isUmd,
  });

  if (!result.code) throw new Error(`[minify-dist] terser 未返回结果: ${file}`);
  writeFileSync(file, result.code, 'utf8');
  minified += 1;
}

console.log(
  `[minify-dist] ${target}: ${minified} 个 JS 已压缩/混淆，删除 ${removedMaps} 个 map`,
);
