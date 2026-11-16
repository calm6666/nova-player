import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { resolve } from "path";
import luminaCompileV2 from "../../plugins/vite-plugin-lumina-compile-v2";


/** 生产构建统一压缩/混淆策略 */
const terserOptions = {
  ecma: 2020 as const,
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
 * 包依赖全部通过包名解析（pnpm workspace）：
 * - @lumina/framework 是独立 workspace 包，工程产物保持 external
 *   （消费者/插件/直播包共用同一份框架运行时，避免重复打包导致 i18n 等单例状态分裂）
 * - lottie-web 是运行期依赖，同样保持 external
 *
 * 双模式构建：
 * 1. 工程 ES 产物（默认 `vite build`）——供父工程 bundler 消费，不压缩；
 * 2. CDN UMD 产物（`vite build --mode lib-cdn`）——单文件自包含（框架 + 播放器），全局名 NovaPlayer。
 */
export default defineConfig(({ command, mode }) => {
  const isCdnBuild = mode === "lib-cdn";
  const frameworkExternal = /^@lumina\/framework(\/.*)?$/;

  return {
    /**
     * 库构建不拷贝 public 静态资源：根 public/ 里是 dev 沙盒（8686）的测试夹具，
     * 拷进 dist 会污染库产物。dev serve 保留 public 目录供沙盒页使用。
     */
    publicDir: command === "build" ? false : "public",
    plugins: [
      luminaCompileV2(),
      // 类型声明只在工程构建时生成（CDN 构建跳过，避免重复输出与产物覆盖）
      ...(isCdnBuild
        ? []
        : [
            dts({
              root: __dirname,
              // 根 vite-env.d.ts 声明了 *.png / *.scss?inline / *?url 等资源模块，
              // 不挂进 include 的话 dts 内部 tsc 解析资源导入会报 TS2307（构建噪音）
              include: ["src/**/*", "../../vite-env.d.ts"],
              exclude: ["**/*.test.ts"],
              insertTypesEntry: true,
              entryRoot: "src",
              // 不做声明 rollup：api-extractor 内置 TS 与项目 TS 版本不兼容；
              // 逐文件声明输出已满足类型消费
              rollupTypes: false,
            }),
          ]),
    ],
    css: {
      preprocessorOptions: {
        scss: {
          api: "modern-compiler",
        },
      },
    },
    build: isCdnBuild
      ? {
          // ===== CDN 产物：单文件自包含 + esbuild/terser 压缩混淆 =====
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
          // CDN 构建与工程构建共用 dist：不清空目录（工程产物先构建）
          emptyOutDir: false,
          sourcemap: false,
          minify: "terser",
          terserOptions,
        }
      : {
          // ===== 工程产物：无 hash / 不压缩 =====
          lib: {
            entry: resolve(__dirname, "src/index.ts"),
            formats: ["es"],
          },
          rollupOptions: {
            external: ["lottie-web", frameworkExternal],
            output: {
              // 固定文件名，不产生 hash（库文件名由包管理器引用）
              entryFileNames: "[name].js",
              assetFileNames: "[name].[ext]",
              chunkFileNames: "chunks/[name].js",
              // core / ui 分包：单一入口不变，仅按源码模块边界切 chunk
              manualChunks(id: string) {
                // 懒挂载面板：组件与其样式字符串独立成 chunk，首次打开才加载
                if (
                  /[\\/]src[\\/]components[\\/](ColorPanel|AudioPanel|VideoInfo|HotkeyPanel|FeedbackPanel)\.ts$/.test(
                    id,
                  ) ||
                  /[\\/]src[\\/]components[\\/]LazyPanelStyles\.ts$/.test(id)
                ) {
                  return "ui-panels";
                }
                if (id.includes("/src/components/") || id.includes("\\src\\components\\")) {
                  return "ui";
                }
                if (
                  id.includes("/src/player/") ||
                  id.includes("\\src\\player\\") ||
                  id.includes("/src/store/") ||
                  id.includes("\\src\\store\\") ||
                  id.includes("/src/core/") ||
                  id.includes("\\src\\core\\")
                ) {
                  return "core";
                }
                return undefined;
              },
            },
          },
          outDir: resolve(__dirname, "dist"),
          emptyOutDir: false,
          sourcemap: false,
          minify: false,
        },
    root: resolve(__dirname, "../.."),
    server: {
      port: 8686,
      open: true,
    },
  };
});
