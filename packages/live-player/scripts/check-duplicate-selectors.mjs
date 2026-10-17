/**
 * 校验脚本：统计 SCSS 中重复的完整选择器块。
 *
 * 会把嵌套与 `&` 展开成完整选择器后再比较，避免把不同父级下的
 * `&:hover` 误判为重复。
 *
 * 用法：node scripts/check-duplicate-selectors.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

/** 需要检查的样式文件。 */
const files = [
  'src/styles/base.scss',
  'src/styles/control-bar.scss',
  'src/styles/panels.scss',
  'src/styles/context-menu.scss',
  'src/styles/style.scss',
];

const counts = new Map();
const locations = new Map();

/** 把嵌套选择器展开为完整选择器。 */
const resolveSelector = (stack, selector) => {
  const parent = stack.length > 0 ? stack[stack.length - 1] : '';
  if (selector.includes('&')) {
    return selector.replace(/&/g, parent);
  }
  if (!parent) return selector;
  return `${parent} ${selector}`;
};

for (const file of files) {
  const absolute = path.resolve(root, file);
  const source = fs.readFileSync(absolute, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = source.split(/\r?\n/);
  const stack = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const openCount = (trimmed.match(/\{/g) ?? []).length;
    const closeCount = (trimmed.match(/\}/g) ?? []).length;

    if (openCount > 0 && !trimmed.startsWith('@')) {
      const selectorPart = trimmed.split('{')[0].trim();
      if (selectorPart) {
        const full = resolveSelector(stack, selectorPart);
        counts.set(full, (counts.get(full) ?? 0) + 1);
        const key = `${file}:${index + 1}`;
        const list = locations.get(full) ?? [];
        list.push(key);
        locations.set(full, list);
        stack.push(full);
      }
    } else if (openCount > 0) {
      stack.push(stack.length > 0 ? stack[stack.length - 1] : '');
    }

    for (let i = 0; i < closeCount; i += 1) stack.pop();
  });
}

const duplicated = [...counts.entries()].filter(([, count]) => count > 1);
if (duplicated.length === 0) {
  console.log('duplicate selectors: 0');
  process.exit(0);
}

for (const [selector, count] of duplicated) {
  console.log(`${selector} x${count} -> ${locations.get(selector).join(', ')}`);
}
console.log(`duplicate selectors: ${duplicated.length} group(s)`);
process.exit(1);
