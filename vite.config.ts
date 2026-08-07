import { defineConfig } from "vite-plus";

export default defineConfig({
  // Promoted from package.json scripts (#1549 Phase 1b). Vite+'s global
  // default is `run.cache = { scripts: false, tasks: true }`, so a
  // package.json script can never be cached however pure it is — which is
  // why CI reported 0/81 cache hits with most tasks never even eligible.
  run: {
    tasks: {
      check: {
        command: "tsc -p tsconfig.json",
        output: [],
      },
      "test:unit": {
        command: "vp test run tests",
        env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
        output: [],
      },
      "test:coverage": {
        command: "vp test run tests --coverage",
        env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
        output: ["coverage/**"],
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    ...(process.env.VITEST_MAX_WORKERS
      ? { maxWorkers: Number(process.env.VITEST_MAX_WORKERS) }
      : {}),
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: { statements: 80, branches: 78, functions: 80, lines: 80 },
    },
  },
});
