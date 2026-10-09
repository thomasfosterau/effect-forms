import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // This package imports `@thomasfosterau/effect-forms`, whose `exports`
      // point at `dist/` — so the sibling must be built before anything here
      // can resolve it. `from: "dependencies"` runs `build` in each direct
      // workspace dependency that defines one.
      build: {
        command: "vp pack",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
      test: {
        command: "vp test run",
        dependsOn: [{ task: "build", from: "dependencies" }],
      },
      // svelte-check type-checks the package (TS6 + Svelte's language
      // tooling) against `tsconfig.json`. No `--fail-on-warnings`: with no
      // `.svelte` components here it always warns "No svelte input files
      // were found", and no option silences that warning alone
      // (`--threshold error` would hide every warning). `vp run -r check`
      // runs it alongside the root `check` task (`vp check`).
      check: {
        command: "svelte-check --tsconfig ./tsconfig.json",
        dependsOn: [{ task: "build", from: "dependencies" }],
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
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      // The reactive store lives in `FormStore.svelte.ts` (rune-compiled,
      // type-checked by `vp check` and by svelte-check, both run by
      // `vp run -r check`);
      // coverage gates the pure modules.
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
