import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

// Auto tracking minus pnpm's `.modules.yaml` churn, with the lockfile back so
// a dependency upgrade invalidates the cache.
const cacheInputs = [
  { auto: true },
  "!node_modules/**",
  "!coverage/**",
  { pattern: "!node_modules/**", base: "workspace" as const },
  { pattern: "pnpm-lock.yaml", base: "workspace" as const },
];

// The core is consumed through its `exports` (`dist/`), so build it first.
const siblingBuild = { task: "build", from: "dependencies" as const };

export default defineConfig(({ mode }) => ({
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
      // No `--fail-on-warnings`: with no `.svelte` components, svelte-check
      // always warns "No svelte input files were found".
      check: {
        command: "tsc -p tsconfig.check.json && svelte-check --tsconfig ./tsconfig.check.json",
        dependsOn: [siblingBuild],
        cache: { input: cacheInputs, output: [] },
      },
      // The API reference for GitHub Pages; examples are parsed, not compiled.
      docgen: {
        command: "docgen",
        dependsOn: [siblingBuild],
        cache: { input: [...cacheInputs, "!docs/**"], output: ["docs/**"] },
      },
    },
  },

  // `unbundle` keeps `FormStore.svelte.ts` as `.svelte.js` in `dist/`, so the
  // consumer's Svelte compiler processes its runes.
  pack: {
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

  // Compiles the runes in `FormStore.svelte.ts` for its tests.
  plugins: [svelte()],

  // `$app/forms` is a SvelteKit virtual: tests resolve it to a stub.
  resolve: {
    // Under Vitest, use Svelte's client runtime: the server build never runs
    // `$effect`.
    conditions: mode === "test" ? ["browser"] : [],
    alias: {
      "@thomasfosterau/effect-forms-svelte/kit": `${import.meta.dirname}/src/kit/index.ts`,
      "$app/forms": `${import.meta.dirname}/tests/kit/app-forms.stub.ts`,
    },
  },

  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      // The thresholds gate the pure modules, not the rune store.
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
}));
