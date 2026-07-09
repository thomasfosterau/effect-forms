import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite-plus";
import { packageTest } from "@thomasfosterau/test-config";

export default defineConfig({
  // Needed to compile the rune syntax in `FormStore.svelte.ts` for
  // `FormStore.svelte.test.ts` (a `.svelte.ts` file is only valid JS once the
  // Svelte compiler has transformed its runes).
  plugins: [svelte()],
  test: packageTest({
    thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    // The reactive store lives in `FormStore.svelte.ts` (rune-compiled, checked
    // by svelte-check); coverage gates the pure modules. `FormStore.svelte.test.ts`
    // exercises the submitter-aware submit path directly but isn't coverage-gated —
    // most of the class (validate, append/removeItem/swap/move, capture/restore, …)
    // stays untested here.
    coverageInclude: [
      "src/Tainted.ts",
      "src/ClientValidate.ts",
      "src/EnhanceCore.ts",
      "src/Listeners.ts",
    ],
  }),
});
