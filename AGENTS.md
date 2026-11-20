# AGENTS.md

Read [README.md](README.md) and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) first; this file adds only what is specific to agents. Each package's `AGENTS.md` states its boundary and invariants: read it before changing that package.

## Process

- You may open pull requests in this repository (GitHub MCP tools or `gh`, whichever is available). GitHub writes go to `thomasfosterau/effect-forms` only.
- When you spot work outside your task, file an issue and move on.
- Write idiomatic Effect (see docs/CONTRIBUTING.md). Non-idiomatic code you find: fix it if trivial, otherwise file an issue naming the sites and the idiomatic replacement.
- Before reporting work as done, run the gates in docs/CONTRIBUTING.md and say which passed and which couldn't run.

## Pitfalls

- **Boundaries.** `packages/forms` never imports a framework; in `packages/svelte`, only `src/kit/` imports `@sveltejs/kit` or `$app/*`. Fallow zones in `.fallowrc.json` enforce both.
- **`dist/` is the product, and the bindings consume the core's `dist/`.** Run tasks through `vp run` (they build the core first); a bare `tsc` or `vp test` in `packages/svelte` on a clean checkout can't resolve the core.
- **Rune compile errors** in `*.svelte.ts` surface only in the tests (through the `svelte()` Vite plugin), not in `tsc` or svelte-check.
- **`vp run docgen` runs every `@example`** in `packages/forms` against `dist/`: an example must be complete (no `declare const`) and must not throw.
- **Updating a transitive dependency:** use `pnpm update <pkg> --depth Infinity` from the root, without `--recursive`, which drops the `catalogs.peers` block from the lockfile header.

## Fallow

The `fallow` agent skill is linked into `.claude/skills/` from the installed `fallow` package after `vp install`; repository-specific rules (the pre-commit audit, tracing before deleting) are in docs/CONTRIBUTING.md.
