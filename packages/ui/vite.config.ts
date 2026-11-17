import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { resolve } from "path";
import luminaCompileV2 from "../../plugins/vite-plugin-lumina-compile-v2";

const frameworkExternal = /^@lumina\/framework(\/.*)?$/;

export default defineConfig({
  plugins: [
    luminaCompileV2(),
    dts({
      root: __dirname,
      include: ["src/**/*", "../../vite-env.d.ts"],
      exclude: ["**/*.test.ts"],
      insertTypesEntry: true,
      entryRoot: "src",
      rollupTypes: false,
    }),
  ],
  css: {
    preprocessorOptions: {
      scss: { api: "modern-compiler" },
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
    },
    rollupOptions: {
      external: [frameworkExternal],
      output: {
        entryFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        chunkFileNames: "chunks/[name].js",
      },
    },
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
  },
});
