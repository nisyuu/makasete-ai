import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 各テストファイルは先頭の `// @vitest-environment` コメントで
    // 環境を上書きできる（ウィジェットのDOMテストは happy-dom を使用）。
    environment: "node",
    include: ["server/**/*.test.ts", "widget/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["server/**/*.ts", "widget/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        // エントリーポイント / ブートストラップ（import時にサーバ起動・DOM副作用）
        "server/index.ts",
        "widget/main.ts",
        "widget/vite.config.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
