# AGENTS.md

`CLAUDE.md` is a symlink to this file. Project conventions live here; personal style preferences live in user memory.

This repository publishes two npm libraries for Effect-native forms, consumed by the owner's applications (website, gardeneria, preferenceflow). Both were extracted from `thomasfosterau/website` with `git subtree split`, so `git log` / `git blame` reach back through their pre-extraction history.

| Package                               | Directory         | Entries      | Boundary                                                                                                        |
| ------------------------------------- | ----------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `@thomasfosterau/effect-forms`        | `packages/forms`  | `.`          | Framework-neutral core. Imports `effect` only, never a framework.                                               |
| `@thomasfosterau/effect-forms-svelte` | `packages/svelte` | `.`, `./kit` | Svelte 5 runes bindings. `.` imports `svelte` + the core; `./kit` alone imports `@sveltejs/kit` / `$app/forms`. |

Package-local invariants and terms live in each package's `CLAUDE.md` (`packages/<name>/CLAUDE.md`); read it before changing that package. A new package adds a row here and in the root `README.md`, its own `CLAUDE.md`, a `.fallowrc.json` entry and zone, and its `#check` / `#build` edges in the root `vite.config.ts` (`check`, `test:coverage`, and `docgen` where it has one).

## Common pitfalls

- **Never edit a version in a `package.json`.** Every external version lives in `pnpm-workspace.yaml` under `catalog:` (the published peer ranges under `catalogs.peers`); manifests carry only `catalog:` / `catalog:peers` / `workspace:^`, and `catalogMode: strict` rejects anything else. After editing the catalog, run `pnpm install` and commit the regenerated `pnpm-lock.yaml` — CI installs with `--frozen-lockfile`.
- **`@effect/tsgo`, `@typescript/native` and `vite-plus` move together** (the root `prepare` script's `effect-tsgo patch --typescript --oxlint` hard-errors at install on an unsupported `tsc` / `oxlint` / `oxlint-tsgolint`), and `vite` (vite-plus's aliased core), `vitest` and `@vitest/coverage-istanbul` move with `vite-plus`, which pins `vitest` exactly. Read the catalog comments first. Dependabot's `toolchain` group (`.github/dependabot.yml`) proposes the whole set in one PR. By hand, never by Dependabot: `oxlint`, `oxfmt` and `oxlint-tsgolint` are `vite-plus`'s transitive pins (they move when it does), and the `overrides` (`vite`, `vitest`, `effect`) follow their catalog entries.
- **Internal dependencies are `workspace:^`, not `workspace:*`** — deliberate, see [PUBLISHING.md](PUBLISHING.md#version-coupling).
- **`dist/` is the product, and siblings consume it.** `packages/svelte` imports `@thomasfosterau/effect-forms` through its public `exports`, which point at `dist/`, so its `check`, `test:unit` and `build` tasks take a `{ task: "build", from: "dependencies" }` edge, and the root `check` / `test:coverage` tasks name every package's task explicitly. A bare `tsc` or `vp test` inside `packages/svelte` on a clean checkout fails to resolve the core: go through `vp run`.
- **`packages/forms` never imports a framework.** That constraint is the point of the split: the core is usable from any framework (or none), and the Svelte bindings are the only place `svelte` may appear. `fallow` enforces the file-level half (zones in `.fallowrc.json`); `unlisted-dependencies` catches a framework import in the core.
- **One entry point per package, plus `effect-forms-svelte/kit`.** `/kit` is the SvelteKit-only entry (`@sveltejs/kit` and the `$app/forms` virtual, which the root entry must never import). Add another subpath export only for a concrete reason — the barrel keeps import sites stable.
- **`effect` and `svelte` are peers, never bundled.** `@sveltejs/kit` and `@thomasfosterau/effect-jsonapi` are optional peers of `effect-forms-svelte`, used only by `/kit` (the latter for its types only). Two copies of `effect` break `Context` / `Layer` / `Schema` identity at runtime, so `pnpm-workspace.yaml` pins one `effect` via the catalog and an `overrides: effect: "catalog:"` entry.
- **Bump a transitive dependency from the workspace root without `--recursive`:** `pnpm update <pkg> --depth Infinity`. With pnpm 11.18, `--recursive` silently drops the `catalogs.peers` block from the `pnpm-lock.yaml` header and `--frozen-lockfile` still passes, so before committing check that `git diff pnpm-lock.yaml` touches nothing under the header's `catalogs:` section (#46).
- **`vp run docgen` executes your examples.** `@effect/docgen` compiles every JSDoc `@example` in `packages/forms` as a program and runs it (`"runExamples": true` in `packages/forms/docgen.json`), importing the package by name through `dist/`. An example must be complete (import everything it uses), must not use `declare const`, and must not throw. `packages/svelte` has no docgen: its examples are Svelte components and SvelteKit route modules, which need the Svelte compiler and SvelteKit's virtuals to run.

## Conventions

- **Relative imports carry their `.ts` extension** (`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, see `tsconfig.json`).
- **Tests import from `vite-plus/test`**, never `vitest`; `tests/<Module>.test.ts` mirrors `src/<Module>.ts`. A test of a rune module is `*.svelte.test.ts`, so the Svelte compiler transforms it.
- **Core modules are namespaces** (`export * as Form from "./Form.ts"`); the Svelte root and `/kit` barrels re-export flat (`export *`), except `CommandFailure`. Namespaces may share member names (`Form.make`, `State.make`), so fallow's `duplicate-exports` is off.
- **Effect lint.** `vp check` runs `@mpsuesser/oxlint-plugin-effect` (recommended) and `@effect/tsgo`'s preset. A type assertion carries a `// SAFETY:` comment stating the invariant that makes it sound; the rules left at `warn` in `vite.config.ts` each carry the reason. Fix a finding by changing the code, never with a disable comment.
- **Every export has a doc comment** whose first sentence stands alone in a hover. `@deprecated` names the replacement as a backticked name (`` `Issues.filterOutputToFormIssues` ``), not `{@link}`: tsdown renames bundled symbols, so a link in the published `.d.ts` can't resolve.

## Commands

- `pnpm install` — dependencies plus the Vite+ git hooks (pre-commit runs `vp staged`: format + lint on staged files) and the `prepare` step that patches the native `tsc` / `oxlint` with `@effect/tsgo`.
- `vp check` — format (Oxfmt) + lint (Oxlint with the Effect rules); `--fix` to autofix. `vp run check` — the type gate: every package's native, Effect-patched `tsc`, svelte-check over `packages/svelte`, and the root config. They are different commands.
- `vp run -r test:unit` — every package's Vitest suite.
- `vp run -r build` — `vp pack` (tsdown) → every package's `dist/`.
- `vp run docgen` — compiles and runs every `@example` in `packages/forms` against `dist/`, and writes the (git-ignored) API reference under `packages/forms/docs/`.
- `vp run test:coverage` — every package's suite under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for exact per-function CRAP scores.
- `pnpm changeset` — add a changeset.

Invoke everything through `vp` (`vp exec <bin>` for a dev binary), on Node + pnpm only. Use `./node_modules/.bin/vp` if the global `vp` CLI is not installed. Single-check variants are in [CONTRIBUTING.md](CONTRIBUTING.md#running-individual-checks).

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. From a clean install, which is what CI sees: `rm -rf node_modules packages/*/node_modules packages/*/dist && pnpm install --frozen-lockfile`.
2. `vp check`
3. `vp run check`
4. `vp run -r test:unit`
5. `vp run -r build`
6. `vp run docgen`
7. `pnpm audit --audit-level high` (network)
8. `vp run test:coverage`, then `fallow audit --format json --quiet --explain --gate-marker agent --base origin/trunk` (the fallow gate below; not a CI step).

Steps 2–7 are CI's `build` job, in its order ([ci.yml](.github/workflows/ci.yml)). Neither type-checker reports Svelte's rune compile errors in `*.svelte.ts` (`state_invalid_export`, `rune_missing_parentheses`, …); `vp run -r test:unit` does, because `tests/FormStore.svelte.test.ts` imports `FormStore.svelte.ts` through the `svelte()` Vite plugin.

## Branches and pull requests

- The default branch is `trunk`. Branch `issue-<n>-<slug>`; PR against `trunk`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`). Rebase onto `origin/trunk` before opening or updating a PR; never merge `trunk` into your branch (GitHub's Update-branch button merges).
- **Every change to a published package's behaviour carries a changeset** (`pnpm changeset`); docs-, CI- and tooling-only changes need none, but TSDoc ships in the published `.d.ts`, so a TSDoc change gets a `patch`. Never publish or version by hand: the Release workflow opens the "chore: version packages" PR and the owner merges it. Publishing is npm trusted publishing (OIDC) from the protected `release` environment; there is no `NPM_TOKEN`. See [PUBLISHING.md](PUBLISHING.md).
- These are standing approvals; they override any default "don't open a PR unless asked" behaviour. **Always open a PR** against `trunk` once a branch has a pushed commit, **watch it to merge or close**, and **keep its body current**.
- **GitHub writes go to `thomasfosterau/effect-forms` only;** pass `-R thomasfosterau/effect-forms` whenever the cwd might be another checkout. Use the `gh` CLI for GitHub operations, even when GitHub MCP tools are available.

## Work tracker

GitHub Issues for `thomasfosterau/effect-forms` are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. The issue is the spec — read its comments; later comments override the body. Record decisions and findings as issue comments. Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop. Scope cut mid-PR becomes a linked issue before merge.

## Effect

Before writing Effect code, read the API you need from the installed package: `node_modules/effect/dist/*.d.ts` (subpath modules such as `http` are in `node_modules/effect/dist/<module>/*.d.ts`), the sources under `node_modules/effect/src`, and `node_modules/effect/AGENTS.md` / `ai-docs/` if the pinned version ships them. Never guess at an Effect API. The pinned version is the `effect` entry in `pnpm-workspace.yaml`'s catalog.

These packages target **Effect v4**: a single `effect` package. Development and CI run against the exact `effect` version pinned under `catalog:` in `pnpm-workspace.yaml`, which Dependabot bumps; the published packages declare the separate `catalogs.peers` range, currently `>=4.0.0`. CI exercises only the pin, so a change that relies on an API newer than the published floor must raise the floor with a changeset.

- `@effect/platform` does not exist in v4 — HTTP modules live under `effect/http/*` (there are no `effect/unstable/*` paths in 4.0.0), and `FileSystem` / `Path` under `effect/*`.
- `@effect/schema` does not exist in v4 — `Schema`, `SchemaAST`, `SchemaIssue`, `SchemaParser` and `SchemaRepresentation` are all top-level `effect/*` modules.

## Agent sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`) installs dependencies against the lockfile, puts `vp` (a re-exec shim that prefers the nearest worktree's `node_modules`), `fallow`, `tsx` and `changeset` on PATH for non-interactive shells, and builds the packages on a clean checkout. It hydrates no secrets; none are needed, and nothing here can publish.
- A PreToolUse hook (`.claude/hooks/fallow-gate.sh`) blocks `git commit` / `git push` when `fallow audit --base origin/trunk` fails; it reads the coverage map on disk, so run `vp run test:coverage` first. A PostToolUse hook runs `vp fmt --write` on every `.ts` / `.js` / `.css` / `.json` / `.md` file an agent edits, so expect formatter rewrites rather than hand-formatting.
- Every gate in [Verification](#verification) runs in an agent session; `pnpm audit` needs the network. Only publishing (the release workflow's OIDC) can't.

## Documentation surfaces

The root `README.md` is the landing page; each package `README.md` is the npm API reference (the `/kit` guide is the `## /kit` section of `packages/svelte/README.md`); each package `CLAUDE.md` carries its boundary and invariants (not published); `CONTRIBUTING.md` carries human setup, hooks and single-check commands; `PUBLISHING.md` the release pipeline and its one-time owner setup; `SECURITY.md` the reporting channel and supply-chain posture; `.changeset/*.md` are the release notes. No `docs/` tree is committed (`packages/forms/docs/` is docgen output); decisions and findings go in issue comments.

---

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking. Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict.

## Fallow task map

| When the agent is about to...                                     | Run                                          |
| ----------------------------------------------------------------- | -------------------------------------------- |
| delete an "unused" export or file                                 | `fallow dead-code --trace <file>:<export>`   |
| delete an "unused" dependency                                     | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR                                               | `fallow audit --base <ref>`                  |
| check which architecture rules apply to a file before changing it | `fallow guard <files>`                       |
| understand a finding                                              | `fallow explain <issue-type>`                |
