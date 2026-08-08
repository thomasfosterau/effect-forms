import { defineConfig } from "vite-plus";

/**
 * Workspace-root Vite+ configuration.
 *
 * Per-package `pack` / `test` config lives in each package's own
 * `vite.config.ts` (`packages/forms`, `packages/svelte`). This root config
 * holds the workspace-wide concerns: monorepo task caching, and the
 * lint/format settings applied across every package.
 */
export default defineConfig({
  run: {
    cache: true,
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
