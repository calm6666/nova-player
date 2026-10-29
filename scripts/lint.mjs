#!/usr/bin/env node
// 外层 monorepo 根有 eslint.config.js（flat），ESLint 8 的 auto 探测会向上
// 查到它并进入 flat 模式，拒绝 --ext 旗标。这里强制 eslintrc 模式后调用本地 eslint。
process.env.ESLINT_USE_FLAT_CONFIG = 'false';

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const eslintBin = join(dirname(require.resolve('eslint/package.json')), 'bin', 'eslint.js');

const result = spawnSync(process.execPath, [eslintBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
