import { defineConfig } from "vite-plus";
import { packageTest } from "../../tooling/test-config";

export default defineConfig({
  test: packageTest({
    thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    // The reactive store lives in `FormStore.svelte.ts` (rune-compiled, checked
    // by svelte-check, not unit-tested here); coverage gates the pure modules.
    coverageInclude: ["src/Tainted.ts", "src/ClientValidate.ts", "src/EnhanceCore.ts"],
  }),
});
