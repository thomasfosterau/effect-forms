# AGENTS.md

`CLAUDE.md` is a symlink to this file.

## Repository Workflow

This repository is managed by [Vite+](https://viteplus.dev): a pnpm monorepo of two published packages, with all tooling configured in `vite.config.ts`.

- `vp install` — install dependencies (delegates to pnpm)
- `vp run -r build` — build every package with tsdown into `dist/`
- `vp check` — format (Oxfmt), lint (Oxlint), and type-check (tsgolint); `--fix` to autofix
- `vp run -r test` — run every package's Vitest suite

**Build before checking or testing on a clean checkout.** `packages/svelte` imports `@thomasfosterau/effect-forms` through its public `exports`, which point at `dist/` — so the sibling must be built first. The `test` task declares this (`dependsOn: [{ task: "build", from: "dependencies" }]`), and CI orders the steps build → check → test.

Use `./node_modules/.bin/vp` if the global `vp` CLI is not installed.

## Layout

| Path              | Package                               | Notes                                         |
| ----------------- | ------------------------------------- | --------------------------------------------- |
| `packages/forms`  | `@thomasfosterau/effect-forms`        | Framework-neutral core. No framework imports. |
| `packages/svelte` | `@thomasfosterau/effect-forms-svelte` | Svelte 5 runes bindings.                      |

Each package has a **single entry point** (`.`), with one deliberate exception: `effect-forms-svelte/kit`, the SvelteKit-only entry (`@sveltejs/kit` and the `$app/forms` virtual, which the root entry must never import). Don't add other subpath exports without a concrete reason — the barrel is what keeps import sites stable.

`packages/forms` must never import a framework. That constraint is the whole point of the split: the core is usable from any framework (or none), and the Svelte bindings are the only place `svelte` may appear.

## Peer dependencies

`effect` and `svelte` are **peer** dependencies, never bundled. `@sveltejs/kit` and `@thomasfosterau/effect-jsonapi` are **optional** peers of `effect-forms-svelte`, used only by `/kit` (the latter for its types only). Two copies of `effect` break `Context` / `Layer` / `Schema` identity at runtime, so `pnpm-workspace.yaml` pins a single `effect` via the catalog and an `overrides: effect: "catalog:"` entry.

**Never edit a version in a `package.json`.** Every external version lives in `pnpm-workspace.yaml` under `catalog:` (the published peer ranges under `catalogs.peers`); manifests carry only `catalog:` / `catalog:peers` / `workspace:^`, and `catalogMode: strict` rejects anything else. After editing the catalog, run `pnpm install` and commit the regenerated `pnpm-lock.yaml` — CI installs with `--frozen-lockfile`.

`vite-plus`, `vite` (its aliased core) and `vitest` bump as a set: vite-plus pins `vitest` exactly, and the `vitest: "catalog:"` override forces the singleton.

## Releasing

Changesets (CLI v3, `changesets/action` v2) + npm Trusted Publishing (OIDC), behind the protected `release` environment. Every user-visible change ships with a changeset (`vp run changeset`). Never publish by hand; the owner merges the Version Packages PR. See [docs/RELEASING.md](docs/RELEASING.md).

## Agent sessions

`.claude/hooks/session-start.sh` (the SessionStart hook) syncs dependencies against the lockfile, links `vp` so it resolves from a non-interactive shell, and builds the packages on a clean checkout. It hydrates no secrets; none are needed.

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns — check the guide first.

<!-- effect-solutions:end -->

## Effect v4

These packages target **Effect v4 (release candidate)**: a single `effect` package, developed against `4.0.0-rc.118` and published with a `>=4.0.0-rc.118` peer floor.

- `@effect/platform` does not exist in v4 — HTTP modules live under `effect/http/*` (no longer `effect/unstable/*` as of rc.118), and `FileSystem`/`Path` under `effect/*`.
- `@effect/schema` does not exist in v4 — `Schema`, `SchemaAST`, `SchemaIssue`, `SchemaParser`, and `SchemaRepresentation` are all top-level `effect/*` modules.
- The v3 → v4 migration maps live in `~/.local/share/effect-solutions/effect/migration/` (start with `v3-to-v4.md`).

## History

Both packages were extracted from `thomasfosterau/website` (where they lived as `packages/effect-forms` and `packages/effect-forms-svelte`) with `git subtree split`, so their pre-extraction history is intact — `git log` and `git blame` reach back through it.
