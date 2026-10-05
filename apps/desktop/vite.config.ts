import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./renderer", import.meta.url)),
  plugins: [vue()],
  base: "./",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./renderer/src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {input:{comparison:fileURLToPath(new URL("./renderer/atomic-comparison.html",import.meta.url)),main:fileURLToPath(new URL("./renderer/index.html",import.meta.url)),atomic:fileURLToPath(new URL("./renderer/atomic-viewer.html",import.meta.url))}},
    outDir: fileURLToPath(new URL("../../dist/apps/desktop/renderer", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
