import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

/**
 * Input fingerprint for this package's cached tasks: auto tracking minus
 * node_modules bookkeeping churn (pnpm rewrites `.modules.yaml` on every
 * install), with the lockfile back explicitly so a dependency upgrade still
 * invalidates a type-check or a test run.
 */
const cacheInputs = [
  { auto: true },
  "!node_modules/**",
  "!coverage/**",
  { pattern: "!node_modules/**", base: "workspace" as const },
  { pattern: "pnpm-lock.yaml", base: "workspace" as const },
];

/**
 * This package imports `@thomasfosterau/effect-forms`, whose `exports` point
 * at `dist/` — so the sibling must be built before anything here can resolve
 * it. `from: "dependencies"` runs `build` in each direct workspace dependency
 * that defines one.
 */
const siblingBuild = { task: "build", from: "dependencies" as const };

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "vp pack",
        dependsOn: [siblingBuild],
        cache: { input: cacheInputs, output: ["dist/**"] },
      },
      "test:unit": {
        command: "vp test run",
        dependsOn: [siblingBuild],
        cache: { env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"], input: cacheInputs, output: [] },
      },
      // The native, Effect-patched `tsc` (TS7) over `src`, the tests and this
      // config, then svelte-check (TS6 + Svelte's language tooling) over the
      // same config. Both read `tsconfig.check.json`, which resolves the core
      // through its built `dist/` declarations (the `siblingBuild` edge). No
      // `--fail-on-warnings`: with no `.svelte` components here svelte-check
      // always warns "No svelte input files were found", and no option
      // silences that warning alone (`--threshold error` would hide every
      // warning). The root `check`
      // task depends on it.
      check: {
        command: "tsc -p tsconfig.check.json && svelte-check --tsconfig ./tsconfig.check.json",
        dependsOn: [siblingBuild],
        cache: { input: cacheInputs, output: [] },
      },
    },
  },

  /**
   * `vp pack` (tsdown) builds the publishable Svelte runes library.
   *
   * `unbundle` keeps a 1:1 mapping between source modules and output files so
   * `FormStore.svelte.ts` keeps its `.svelte.js` extension in `dist/`, which
   * the Svelte compiler relies on to process runes inside published packages.
   */
  pack: {
    // `.` is the framework-neutral Svelte bindings; `./kit` is the
    // SvelteKit-only entry (`$app/forms`, `@sveltejs/kit`).
    entry: ["src/index.ts", "src/kit/index.ts"],
    // SvelteKit's virtual modules resolve only inside the consumer's
    // SvelteKit build; they are never bundled or resolved here.
    deps: { neverBundle: [/^\$app\//] },
    format: ["esm"],
    platform: "neutral",
    unbundle: true,
    dts: true,
    sourcemap: true,
  },

  // Needed to compile the rune syntax in `FormStore.svelte.ts` for
  // `FormStore.svelte.test.ts` (a `.svelte.ts` file is only valid JS once the
  // Svelte compiler has transformed its runes).
  plugins: [svelte()],

  // `$app/forms` is a SvelteKit virtual: tests resolve it to a stub. The
  // worked examples import this package's `/kit` entry by name, as a
  // consumer would; it resolves to the sources (tsconfig `paths` agrees).
  resolve: {
    // Under Vitest, resolve `svelte` to its client runtime (Svelte's documented
    // Vitest setup): the default `node` condition picks the server build, where
    // `$effect` never runs, so the store's change watchers and listeners would
    // be untestable. Builds keep the default conditions.
    ...(process.env.VITEST ? { conditions: ["browser"] } : {}),
    alias: {
      "@thomasfosterau/effect-forms-svelte/kit": fileURLToPath(
        new URL("./src/kit/index.ts", import.meta.url),
      ),
      "$app/forms": fileURLToPath(new URL("./tests/kit/app-forms.stub.ts", import.meta.url)),
    },
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
      // The reactive store lives in `FormStore.svelte.ts` (rune-compiled,
      // type-checked by `tsc` and svelte-check in this package's `check`
      // task); coverage gates the pure modules.
      include: [
        "src/Tainted.ts",
        "src/ClientValidate.ts",
        "src/EnhanceCore.ts",
        "src/Listeners.ts",
        "src/kit/ActionRedirect.ts",
        "src/kit/CommandFailure.ts",
        "src/kit/FormAction.ts",
        "src/kit/FormStateReaders.ts",
        "src/kit/Pointer.ts",
      ],
      exclude: ["**/*.d.ts"],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
