import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

export default defineConfig({
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
