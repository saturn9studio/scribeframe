import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@saturn9/scribeframe": resolve(__dirname, "src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["test/*.test.ts"],
  },
});
