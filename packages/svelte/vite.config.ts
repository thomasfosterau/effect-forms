import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

/**
 * Input fingerprint for this package's cached tasks.
 *
 * Auto tracking otherwise records node_modules bookkeeping that pnpm rewrites
 * on every install (`.modules.yaml`) and vitest's own `.vite/vitest` scratch
 * dirs. That churn busted 24 of 43 cacheable tasks on an EXACT-key cache
 * restore of an identical commit (#1549 Phase 2, run 31166569075 attempt 2) —
 * the cache was working, it was the fingerprint that was wrong.
 *
 * Excluding node_modules alone would be unsafe: a dependency upgrade genuinely
 * must invalidate a type-check or a test run. So the lockfile comes back
 * explicitly, capturing the real dependency state without the bookkeeping
 * noise. Verified: node_modules churn no longer busts, while a pnpm-lock.yaml
 * edit and a source edit both still do, each naming the file responsible.
 */
const cacheInputs = [
  { auto: true },
  "!node_modules/**",
  { pattern: "!node_modules/**", base: "workspace" as const },
  { pattern: "pnpm-lock.yaml", base: "workspace" as const },
];

export default defineConfig({
  // Promoted from package.json scripts (#1549 Phase 1b). Vite+'s global
  // default is `run.cache = { scripts: false, tasks: true }`, so a
  // package.json script can never be cached however pure it is — which is
  // why CI reported 0/81 cache hits with most tasks never even eligible.
  run: {
    tasks: {
      check: {
        command: "NODE_OPTIONS=--max-old-space-size=6144 svelte-check --tsconfig ./tsconfig.json",
        env: ["NODE_OPTIONS"],
        input: cacheInputs,
        output: [],
      },
      "test:unit": {
        command: "vp test run tests",
        env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
        input: cacheInputs,
        output: [],
      },
      "test:coverage": {
        command: "vp test run tests --coverage",
        env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
        input: cacheInputs,
        output: ["coverage/**"],
      },
    },
  },
  // Needed to compile the rune syntax in `FormStore.svelte.ts` for
  // `FormStore.svelte.test.ts` (a `.svelte.ts` file is only valid JS once the
  // Svelte compiler has transformed its runes).
  plugins: [svelte()],
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
      // The reactive store lives in `FormStore.svelte.ts` (rune-compiled, checked
      // by svelte-check); coverage gates the pure modules. `FormStore.svelte.test.ts`
      // exercises the submitter-aware submit path directly but isn't coverage-gated —
      // most of the class (validate, append/removeItem/swap/move, capture/restore, …)
      // stays untested here.
      include: [
        "src/Tainted.ts",
        "src/ClientValidate.ts",
        "src/EnhanceCore.ts",
        "src/Listeners.ts",
      ],
      exclude: ["**/*.d.ts"],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
