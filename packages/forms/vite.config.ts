import { defineConfig } from "vite-plus";

/**
 * Input fingerprint for this package's cached tasks: auto tracking minus
 * node_modules bookkeeping churn (pnpm rewrites `.modules.yaml` on every
 * install) and docgen's output, with the lockfile back explicitly so a
 * dependency upgrade still invalidates a type-check or a test run.
 */
const cacheInputs = [
  { auto: true },
  "!node_modules/**",
  "!docs/**",
  "!coverage/**",
  { pattern: "!node_modules/**", base: "workspace" as const },
  { pattern: "pnpm-lock.yaml", base: "workspace" as const },
];

export default defineConfig({
  // Defined as Vite+ tasks rather than package.json scripts: a package.json
  // script can never be cached, however pure it is.
  run: {
    tasks: {
      // `src`, the tests and this config under the native, Effect-patched
      // `tsc` (TS7). The root `check` task depends on it.
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
      // Compiles AND RUNS every JSDoc `@example` (see docgen.json). Examples
      // import the package by name exactly as a consumer would, which
      // resolves through `exports` to `dist/` — hence the build edge.
      docgen: {
        command: "docgen",
        dependsOn: ["build"],
        cache: { input: cacheInputs, output: ["docs/**"] },
      },
    },
  },

  /**
   * `vp pack` (tsdown) builds the publishable, framework-neutral library.
   *
   * `platform: "neutral"` because nothing here touches Node or the DOM — the
   * package is pure Effect Schema plumbing and must stay usable in a browser,
   * a Worker, and Node alike.
   */
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "neutral",
    dts: true,
    sourcemap: true,
  },

  /** `vp test` (Vitest) */
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      // `json` writes coverage-final.json, the Istanbul map `fallow audit`
      // reads for exact per-function CRAP scores.
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
