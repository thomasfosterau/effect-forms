import { defineConfig } from "vite-plus";

// Auto tracking minus pnpm's `.modules.yaml` churn (and docgen's output),
// with the lockfile back so a dependency upgrade invalidates the cache.
const cacheInputs = [
  { auto: true },
  "!node_modules/**",
  "!docs/**",
  "!coverage/**",
  { pattern: "!node_modules/**", base: "workspace" as const },
  { pattern: "pnpm-lock.yaml", base: "workspace" as const },
];

export default defineConfig({
  run: {
    tasks: {
      check: {
        command: "tsc -p tsconfig.json",
        cache: { input: cacheInputs, output: [] },
      },
      build: {
        command: "vp pack",
        cache: { input: cacheInputs, output: ["dist/**"] },
      },
      "test:unit": {
        command: "vp test run",
        cache: { env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"], input: cacheInputs, output: [] },
      },
      // Compiles and runs every `@example`, importing the package by name
      // through `dist/`.
      docgen: {
        command: "docgen",
        dependsOn: ["build"],
        cache: { input: cacheInputs, output: ["docs/**"] },
      },
    },
  },

  pack: {
    entry: ["src/*.ts"],
    unbundle: true,
    format: ["esm"],
    platform: "neutral",
    dts: true,
    sourcemap: true,
  },

  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
