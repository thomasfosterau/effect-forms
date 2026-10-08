# AGENTS.md

`CLAUDE.md` is a symlink to this file. This repository publishes two npm libraries for Effect-native forms, consumed by the owner's applications (website, gardeneria, preferenceflow). Both were extracted from `thomasfosterau/website` with `git subtree split`, so `git log` / `git blame` reach back through their pre-extraction history.

Toolchain differences from the sibling libraries: unit tests are the `test` task (`vp run -r test`, not `test:unit`); `vp check` type-checks through tsgolint (`lint.options.typeCheck: true`), and `vp run --filter './packages/*' check` adds svelte-check over `packages/svelte`; there is no docgen and no fallow gate; TypeScript is split 6/7 (`typescript` is the TS6 alias that svelte-check, the language service and tsdown's declaration emit load; `@typescript/native` is TS7, bin `tsc`), and the root `prepare` script runs `effect-tsgo patch --typescript --oxlint` — `@effect/tsgo`, `@typescript/native` and `vite-plus` bump as a set; internal dependencies are `workspace:^`, not `workspace:*` (deliberate, see [docs/RELEASING.md](docs/RELEASING.md) "Version coupling").

| Package                               | Directory         | Boundary                                                                                                                  |
| ------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@thomasfosterau/effect-forms`        | `packages/forms`  | Framework-neutral core. Imports `effect` only, never a framework.                                                         |
| `@thomasfosterau/effect-forms-svelte` | `packages/svelte` | Svelte 5 runes bindings. Root entry `.` imports `svelte` + the core; `/kit` alone imports `@sveltejs/kit` / `$app/forms`. |

## Common pitfalls

- **Build before checking or testing on a clean checkout.** `packages/svelte` imports `@thomasfosterau/effect-forms` through its public `exports`, which point at `dist/`. The `test` and `check` tasks declare this (`dependsOn: [{ task: "build", from: "dependencies" }]`), and CI orders the steps build → check → svelte-check → test.
- **`packages/forms` never imports a framework.** That constraint is the point of the split: the core is usable from any framework (or none), and the Svelte bindings are the only place `svelte` may appear.
- **One entry point per package, plus `effect-forms-svelte/kit`.** `/kit` is the SvelteKit-only entry (`@sveltejs/kit` and the `$app/forms` virtual, which the root entry must never import). Add another subpath export only for a concrete reason — the barrel keeps import sites stable.
- **`effect` and `svelte` are peers, never bundled.** `@sveltejs/kit` and `@thomasfosterau/effect-jsonapi` are optional peers of `effect-forms-svelte`, used only by `/kit` (the latter for its types only). Two copies of `effect` break `Context` / `Layer` / `Schema` identity at runtime, so `pnpm-workspace.yaml` pins one `effect` via the catalog and an `overrides: effect: "catalog:"` entry.
- **Never edit a version in a `package.json`.** Every external version lives in `pnpm-workspace.yaml` under `catalog:` (the published peer ranges under `catalogs.peers`); manifests carry only `catalog:` / `catalog:peers` / `workspace:^`, and `catalogMode: strict` rejects anything else. After editing the catalog, run `pnpm install` and commit the regenerated `pnpm-lock.yaml` — CI installs with `--frozen-lockfile`.
- **`vite-plus`, `vite` (its aliased core) and `vitest` bump as a set:** vite-plus pins `vitest` exactly, and the `vitest: "catalog:"` override forces the singleton.
- **Bump a transitive dependency from the workspace root without `--recursive`:** `pnpm update <pkg> --depth Infinity`. With pnpm 11.18, `--recursive` silently drops the `catalogs.peers` block from the `pnpm-lock.yaml` header and `--frozen-lockfile` still passes, so before committing check that `git diff pnpm-lock.yaml` touches nothing under the header's `catalogs:` section (#46).

## Conventions

- **Relative imports carry their `.ts` extension** (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, see `tsconfig.json`).
- **Tests import from `vite-plus/test`**, never `vitest`; `tests/<Module>.test.ts` mirrors `src/<Module>.ts`. A test of a rune module is `*.svelte.test.ts`, so the Svelte compiler transforms it.
- **Core modules are namespaces** (`export * as Form from "./Form.ts"`); the Svelte root and `/kit` barrels re-export flat (`export *`), except `CommandFailure`.
- **Every export has a doc comment** whose first sentence stands alone in a hover. `@deprecated` names the replacement as a backticked name (`` `Issues.filterOutputToFormIssues` ``), not `{@link}`: tsdown renames bundled symbols, so a link in the published `.d.ts` can't resolve.

## Commands

- `vp install` — install dependencies (delegates to pnpm).
- `vp run -r build` — build every package with tsdown into `dist/`.
- `vp check` — format (Oxfmt), lint (Oxlint) and type-check (tsgolint); `--fix` to autofix. It is also the main type gate.
- `vp run --filter './packages/*' check` — every package's `check` task: svelte-check (TS6 + Svelte's language tooling) over `packages/svelte`, after building `packages/forms`. Not `vp run -r check`: `-r` also selects the root `check` script (`vp check`), which runs concurrently with that build and fails with spurious `TS2307` errors whenever the build isn't a cache hit.
- `vp run -r test` — run every package's Vitest suite.
- `pnpm changeset` — add a changeset.

Use `./node_modules/.bin/vp` if the global `vp` CLI is not installed.

## Verification

Before you report work as done, run the gates below in CI's order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. `vp run -r build`
2. `vp check`
3. `vp run --filter './packages/*' check`
4. `vp run -r test`

All four run offline with no credentials. Neither type-checker reports Svelte's rune compile errors in `*.svelte.ts` (`state_invalid_export`, `rune_missing_parentheses`, …); `vp run -r test` does, because `tests/FormStore.svelte.test.ts` imports `FormStore.svelte.ts` through the `svelte()` Vite plugin.

## Branches and pull requests

- The default branch is `main`. Branch `issue-<n>-<slug>`; PR against `main`; squash-merge. Rebase onto `origin/main` before opening or updating a PR; never merge `main` into your branch (GitHub's Update-branch button merges).
- **Every change to a published package's behaviour carries a changeset** (`pnpm changeset`); docs-, CI- and tooling-only changes need none, but TSDoc ships in the published `.d.ts`, so a TSDoc change gets a `patch`. Never publish or version by hand: the Release workflow opens the "Version Packages" PR and the owner merges it. Publishing is npm trusted publishing (OIDC) from the protected `release` environment; there is no `NPM_TOKEN`. See [docs/RELEASING.md](docs/RELEASING.md).
- Always open a PR once a branch has a pushed commit, watch it to merge or close, and keep its body current.
- **GitHub writes go to `thomasfosterau/effect-forms` only;** pass `-R thomasfosterau/effect-forms` whenever the cwd might be another checkout. Use the `gh` CLI for GitHub operations, even when GitHub MCP tools are available.

## Work tracker

GitHub Issues for `thomasfosterau/effect-forms` are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. The issue is the spec — read its comments; later comments override the body. Record decisions and findings as issue comments. Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop. Scope cut mid-PR becomes a linked issue before merge.

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns — check the guide first.

<!-- effect-solutions:end -->

`effect-solutions` is not provisioned in this repository yet (#20): neither the CLI nor `~/.local/share/effect-solutions` exists in an agent session. Until it is, read the API from `node_modules/effect/dist/*.d.ts`.

### Effect v4

These packages target **Effect v4**: a single `effect` package. Development runs against the `effect` 4.0.0 release pinned under `catalog:` in `pnpm-workspace.yaml`; the published packages declare the `catalogs.peers` range, `>=4.0.0`, whose floor is that same release so the range claims nothing the suite does not run against.

- `@effect/platform` does not exist in v4 — HTTP modules live under `effect/http/*` (there are no `effect/unstable/*` paths in 4.0.0), and `FileSystem` / `Path` under `effect/*`.
- `@effect/schema` does not exist in v4 — `Schema`, `SchemaAST`, `SchemaIssue`, `SchemaParser` and `SchemaRepresentation` are all top-level `effect/*` modules.

## Agent sessions

The SessionStart hook (`.claude/hooks/session-start.sh`) installs dependencies against the lockfile, puts `vp` on PATH for non-interactive shells, and builds the packages on a clean checkout. It hydrates no secrets; none are needed. A PostToolUse hook (`.claude/settings.json`) runs `vp fmt --write` on every `.ts` / `.js` / `.css` / `.json` / `.md` file an agent edits, so expect formatter rewrites rather than hand-formatting. Every gate runs here; only publishing (the release workflow's OIDC) can't.

## Documentation surfaces

Each package `README.md` is the npm API reference (the `/kit` guide is the `## /kit` section of `packages/svelte/README.md`); the root `README.md` is the landing page and development quick-start; `docs/RELEASING.md` holds the release pipeline and its one-time owner setup; `.changeset/*.md` are the release notes; decisions and findings go in issue comments.
