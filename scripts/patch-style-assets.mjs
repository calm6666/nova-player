/**
 * 修补 @lumina/nova 的 dist/style.css 静态资源（构建后置步骤）
 * ============================================================
 * 播放器样式由 `sass src/styles/style.scss dist/style.css` 直出，sass 不处理
 * 工程里的 `@/...` 路径别名，产物里会残留：
 *   background-image: url(@/assets/images/play.svg)
 *   background: url(@/nova/assets/images/ploading.png)
 * 浏览器会按 CSS 文件所在目录解析成 `<css目录>/@/assets/...` → 404；
 * 消费方 bundler 也无法解析这种「包内别名路径」。
 *
 * 这里把 `src/assets/images` 复制到 `dist/assets/images`，并把 URL 改写成
 * 相对 CSS 的 `./assets/images/xxx`，让 dist 自身自包含：消费方（Vite/webpack）
 * 能按相对路径解析并正确打包，不依赖任何消费侧 alias。
 *
 * 用法：node ../../scripts/patch-style-assets.mjs packages/player
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const target = process.argv[2] ?? 'packages/player';
const pkgDir = resolve(root, target);
const srcImages = resolve(pkgDir, 'src/assets/images');
const distDir = resolve(pkgDir, 'dist');
const distImages = resolve(distDir, 'assets/images');
const cssPath = resolve(distDir, 'style.css');

if (!existsSync(cssPath) || !existsSync(srcImages)) {
  console.error(
    `[patch-style-assets] 跳过：缺少 ${cssPath} 或 ${srcImages}`,
  );
  process.exit(0);
}

// 1) 复制图片资源到 dist/assets/images
mkdirSync(distImages, { recursive: true });
let copied = 0;
for (const name of readdirSync(srcImages)) {
  const from = resolve(srcImages, name);
  if (!statSync(from).isFile()) continue;
  copyFileSync(from, resolve(distImages, name));
  copied += 1;
}

// 2) 把包内别名 URL 改写成相对 CSS 的路径
const before = readFileSync(cssPath, 'utf8');
const after = before.replace(
  /url\((["']?)@\/(?:nova\/)?assets\/images\/([^)"']+)\1\)/g,
  'url(./assets/images/$2)',
);
const remaining = (after.match(/url\((["']?)@\//g) ?? []).length;
writeFileSync(cssPath, after, 'utf8');

console.log(
  `[patch-style-assets] images=${copied} rewritten=${(before.match(/url\((["']?)@\//g) ?? []).length - remaining} remaining=${remaining}`,
);
