import { defineConfig } from "vite";
import { resolve } from "path";
import luminaCompileV2 from "../../../plugins/vite-plugin-lumina-compile-v2";

export default defineConfig({
  root: resolve(__dirname),
  publicDir: false,
  plugins: [luminaCompileV2()],
  server: { port: 8687, open: true },
  build: { outDir: resolve(__dirname, "dist"), emptyOutDir: true },
});
