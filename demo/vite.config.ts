import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname),
  resolve: {
    alias: {
      "@saturn9/scribeframe/styles.css": resolve(
        __dirname,
        "../src/styles.css",
      ),
      "@saturn9/scribeframe": resolve(__dirname, "../src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
  },
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
  },
});
