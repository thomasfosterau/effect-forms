import { defineConfig } from "vite-plus";

/**
 * Workspace-root Vite+ configuration.
 *
 * Per-package `pack` / `test` config lives in each package's own
 * `vite.config.ts` (`packages/forms`, `packages/svelte`). This root config
 * holds the workspace-wide concerns: monorepo task caching, the root `check`
 * task, and the lint/format settings applied across every package.
 */
export default defineConfig({
  run: {
    cache: true,
    tasks: {
      // `vp check` type-checks `packages/svelte`, which imports
      // `@thomasfosterau/effect-forms` through its `exports` (`dist/`). As a
      // task (not a package.json script) it can wait for every package's
      // `build`, so `vp run -r check` — this plus each package's `check` task —
      // never type-checks while `packages/forms/dist` is being rewritten. The
      // root lists no workspace packages as dependencies, so the `build`s are
      // named one by one: add a new package here. A task name can come from
      // `vite.config.ts` or `package.json`, not both, so there is no `check`
      // script (`pnpm check` is gone; `vp run check` or `vp check` replace it).
      check: {
        command: "vp check",
        dependsOn: [
          "@thomasfosterau/effect-forms#build",
          "@thomasfosterau/effect-forms-svelte#build",
        ],
      },
    },
  },

  /** `vp check` (Oxlint + tsgolint) — type-aware across all packages. */
  lint: {
    ignorePatterns: ["**/dist/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },

  /** `vp check` (Oxfmt) */
  fmt: {
    ignorePatterns: ["**/dist/**"],
  },
});
