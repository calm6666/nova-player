import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { resolve } from "path";
import { luminaCompile } from "../../plugins/vite-plugin-lumina-compile";

/** 生产构建统一压缩/混淆策略 */
const terserOptions = {
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

/**
 * 双模式库构建（三方库标准做法）：
 *
 * 1. 工程 ES 产物（默认 `vite build`）——供父工程 bundler 消费：
 *    - 框架（Lumina core）与播放器（Nova）核心运行时打包为不同的 js 文件
 *      （index.js / lumina.js），文件名固定无 hash
 *    - 不压缩不混淆：产物可读、可调试、可 tree-shake，
 *      压缩混淆由父工程生产构建统一处理
 *    - sourcemap 保留
 *
 * 2. CDN UMD 产物（`vite build --mode lib-cdn`）——供 <script> 直接引用：
 *    - 单文件自包含（框架 + 播放器 + 样式注入），全局名 NovaPlayer
 *    - esbuild 压缩混淆（体积优先，触发 __LUMINA_DEV__ 死代码消除）
 */
export default defineConfig(({ command, mode }) => {
  // CDN 单文件构建模式
  const isCdnBuild = mode === "lib-cdn";

  return {
    /**
     * 库构建不拷贝 public 静态资源：root 指向仓库根，public/ 里的
     * test-*.json 是 dev 沙盒页（8686）的测试夹具，拷进 dist 会污染库产物。
     * dev serve 保留 public 目录供沙盒页的视频源列表使用。
     */
    publicDir: command === "build" ? false : "public",
    plugins: [
      luminaCompile(),
      // 类型声明只在工程构建时生成（CDN 构建跳过，避免重复输出与产物覆盖）
      ...(isCdnBuild
        ? []
        : [
            dts({
              root: __dirname,
              include: ["src/**/*"],
              exclude: ["**/*.test.ts"],
              insertTypesEntry: true,
              entryRoot: "src",
              // ★ 不做声明 rollup：api-extractor 内置 TS 5.4.2 与项目 TS 6.0.3
              // 不兼容（core/h.ts 语义分析崩溃）；逐文件声明输出已满足类型消费
              rollupTypes: false,
            }),
          ]),
    ],
    css: {
      preprocessorOptions: {
        scss: {
          api: "modern-compiler", // 或 'modern'
        },
      },
    },
    build: isCdnBuild
      ? {
          // ===== CDN 产物：单文件自包含 + esbuild 压缩混淆 =====
          lib: {
            entry: resolve(__dirname, "src/index.ts"),
            name: "NovaPlayer",
            formats: ["umd"],
            fileName: () => "index.umd.js",
          },
          rollupOptions: {
            external: [],
            output: {
              globals: {},
            },
          },
          outDir: resolve(__dirname, "dist"),
          // CDN 构建与工程构建共用 dist：不清空目录（工程产物先构建，CDN 后构建）
          emptyOutDir: false,
          sourcemap: false,
          // CDN 纯 JS：terser 压缩 + 变量混淆 + 去除注释
          minify: "terser",
          terserOptions,
        }
      : {
          // ===== 工程产物：无 hash / 不压缩 / 框架与播放器分文件 =====
          lib: {
            entry: resolve(__dirname, "src/index.ts"),
            formats: ["es"],
          },
          rollupOptions: {
            // lottie-web 是运行时依赖（package.json dependencies 已声明）：
            // 工程产物保持 external，由父工程安装提供；CDN 构建才打进单文件
            external: ["lottie-web"],
            output: {
              // 固定文件名，不产生 hash（库文件名由包管理器引用，hash 会破坏 import）
              entryFileNames: "[name].js",
              assetFileNames: "[name].[ext]",
              /**
               * 框架核心运行时（core/types/utils/events/error/directives）
               * 强制划入 lumina chunk → 输出为独立的 lumina.js：
               * 编译产物直接 import '@/core/internal' 等具体模块（不经 core/index.ts），
               * 框架模块被播放器与（潜在的）多入口共同引用，不强制归属会被
               * rollup 逐模块拆散到共享 chunk，破坏「框架与播放器分文件」的目标
               */
              manualChunks: (id: string): string | undefined => {
                const normalized = id.replace(/\\/g, "/");
                const frameworkRoots = [
                  resolve(__dirname, "../../core"),
                  resolve(__dirname, "../../types"),
                  resolve(__dirname, "../../utils"),
                  resolve(__dirname, "../../events"),
                  resolve(__dirname, "../../error"),
                  resolve(__dirname, "../../directives"),
                ].map((root) => root.replace(/\\/g, "/"));
                if (
                  frameworkRoots.some((root) => normalized.startsWith(root))
                ) {
                  return "lumina";
                }
                return undefined;
              },
              chunkFileNames: (chunk): string =>
                // lumina chunk 提升到 dist 根目录（与入口平级，作为框架运行时文件），
                // 其余共享 chunk 放 chunks/ 子目录
                chunk.name === "lumina" ? "lumina.js" : "chunks/[name].js",
            },
          },
          outDir: resolve(__dirname, "dist"),
          // CDN 构建与工程构建共用 dist：不清空目录（工程产物先构建，CDN 后构建）
          emptyOutDir: false,
          sourcemap: false,
          // 工程产物同样压缩 + 混淆 + 去注释
          minify: "esbuild",
          terserOptions,
        },
    resolve: {
      alias: [
        {
          find: /^@\/core$/,
          replacement: resolve(__dirname, "../../core/index.ts"),
        },
        {
          find: /^@\/types$/,
          replacement: resolve(__dirname, "../../types/index.ts"),
        },
        {
          find: /^@\/utils$/,
          replacement: resolve(__dirname, "../../utils/index.ts"),
        },
        {
          find: /^@\/events$/,
          replacement: resolve(__dirname, "../../events/index.ts"),
        },
        {
          find: /^@\/error$/,
          replacement: resolve(__dirname, "../../error/index.ts"),
        },
        {
          find: /^@\/directives$/,
          replacement: resolve(__dirname, "../../directives/index.ts"),
        },
        {
          find: /^@\/core\/(.*)/,
          replacement: resolve(__dirname, "../../core/$1"),
        },
        {
          find: /^@\/utils\/(.*)/,
          replacement: resolve(__dirname, "../../utils/$1"),
        },
        {
          find: /^@\/types\/(.*)/,
          replacement: resolve(__dirname, "../../types/$1"),
        },
        {
          find: /^@\/events\/(.*)/,
          replacement: resolve(__dirname, "../../events/$1"),
        },
        {
          find: /^@\/error\/(.*)/,
          replacement: resolve(__dirname, "../../error/$1"),
        },
        {
          find: /^@\/directives\/(.*)/,
          replacement: resolve(__dirname, "../../directives/$1"),
        },
        {
          find: /^@\/lumina\/plugins\/(.*)/,
          replacement: resolve(__dirname, "../plugins/src/$1"),
        },
        { find: /^@\/nova\/(.*)/, replacement: resolve(__dirname, "src/$1") },
        { find: /^@\/(.*)/, replacement: resolve(__dirname, "src/$1") },
      ],
    },
    root: resolve(__dirname, "../.."),
    server: {
      port: 8686,
      open: true,
    },
  };
});
