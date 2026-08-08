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
    entry: ["src/index.ts"],
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

  /** `vp test` (Vitest) */
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      // The reactive store lives in `FormStore.svelte.ts` (rune-compiled,
      // checked by svelte-check); coverage gates the pure modules.
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
