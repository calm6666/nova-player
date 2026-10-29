#!/usr/bin/env node
// dist d.ts 自包含修补。
//
// 背景：nova 各包 dist 里的声明引用会逃出包边界，一部分指回 nova 根框架源码
// （core/types/error/events/utils），一部分指回 player 包源码树。消费方经
// node_modules 安装（或 workspace 软链 + package.json types 直连）后这些路径
// 必然断链。本脚本做两件事：
//   1) 用根 tsconfig.framework.json 把根框架声明 emit 到 <pkg>/dist/framework/
//   2) 遍历 <pkg>/dist/**/*.d.ts，把逃出包边界的引用改写为
//        框架文件    -> 包内 dist/framework 相对路径
//        player 源码 -> '@lumina/nova'（要求对应名字是 nova 公开导出）
// 有无法闭合的引用时报错退出（exit 1），防止新增泄漏静默溜过构建。
//
// 用法：node scripts/patch-dts.mjs packages/player
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const novaRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgArg = process.argv[2];
if (!pkgArg) {
  console.error('usage: node scripts/patch-dts.mjs <package-dir-relative-to-nova-root>');
  process.exit(1);
}
const pkgDir = resolve(novaRoot, pkgArg);
const distDir = join(pkgDir, 'dist');
const frameworkDir = join(distDir, 'framework');
const FRAMEWORK_DOMAINS = ['types', 'core', 'error', 'events', 'utils'];

function walkDts(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkDts(p, out);
    else if (name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// 1) 框架声明 emit（CLI --outDir 绝对路径覆盖 tsconfig 默认 outDir）
const require = createRequire(import.meta.url);
const tscBin = join(
  dirname(require.resolve('typescript/package.json', { paths: [novaRoot] })),
  'bin',
  'tsc',
);
const emit = spawnSync(
  process.execPath,
  [tscBin, '-p', join(novaRoot, 'tsconfig.framework.json'), '--outDir', frameworkDir],
  { cwd: novaRoot, encoding: 'utf8' },
);
if (emit.status !== 0) {
  console.error(emit.stdout);
  console.error(emit.stderr);
  process.exit(1);
}

// 2) 引用改写
let frameworkRewrites = 0;
let novaRewrites = 0;
const leftovers = [];
for (const file of walkDts(distDir)) {
  const rel = relative(distDir, file);
  const src = readFileSync(file, 'utf8');
  let out = src;
  const specs = new Set();
  const re = /['"]((?:\.\.\/)+[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) specs.add(m[1]);

  for (const spec of specs) {
    const ups = spec.match(/^(?:\.\.\/)+/)[0].length / 3;
    const rest = spec.slice(ups * 3);
    let replacement = null;

    if (/^(?:player|packages\/player)\/src\//.test(rest)) {
      replacement = '@lumina/nova';
    } else if (FRAMEWORK_DOMAINS.some((d) => rest === d || rest.startsWith(d + '/'))) {
      const target = join(frameworkDir, rest.replace(/\.ts$/, ''));
      const asFile = target + '.d.ts';
      if (existsSync(asFile) || (existsSync(target) && statSync(target).isDirectory())) {
        let relPath = relative(dirname(file), target).split('\\').join('/');
        if (!relPath.startsWith('.')) relPath = './' + relPath;
        replacement = relPath;
      }
    }

    if (replacement) {
      out = out
        .split("'" + spec + "'")
        .join("'" + replacement + "'")
        .split('"' + spec + '"')
        .join('"' + replacement + '"');
      if (replacement === '@lumina/nova') novaRewrites++;
      else frameworkRewrites++;
    } else {
      // 引用解析到包外且无法闭合 -> 遗留（构建失败）
      const resolved = resolve(dirname(file), spec);
      if (!resolved.startsWith(pkgDir)) leftovers.push(rel + ' -> ' + spec);
    }
  }

  if (out !== src) writeFileSync(file, out);
}

console.log(
  'patch-dts ' + pkgArg + ': framework=' + frameworkRewrites + ' nova=' + novaRewrites +
  ' leftovers=' + leftovers.length,
);
if (leftovers.length > 0) {
  console.error(leftovers.join('\n'));
  process.exit(1);
}
