# Contributing

Maintained by Thomas Foster, with a workflow meant to be approachable for both humans and coding agents. Conventions are in [AGENTS.md](AGENTS.md).

## Setup

You need Node.js (`^22.18.0 || ^24.11.0 || >=26.0.0`, the range Vite+ supports) and pnpm 11 (pinned by `packageManager`; `corepack enable` provides it).

```sh
pnpm install          # dependencies, the git hooks, and the @effect/tsgo patch
vp run -r build       # dist/ for every package (packages/svelte consumes the core's dist/)
```

The `vp` CLI ships with the `vite-plus` dev dependency; use `./node_modules/.bin/vp` if no global `vp` is installed.

## Branches

Branch off `trunk`, rebase rather than merge, squash-merge with a conventional prefix: see [AGENTS.md](AGENTS.md#branches-and-pull-requests).

## Git hooks

Hooks are managed by Vite+ (`vp config`, run by `prepare`); the editable [.vite-hooks/pre-commit](.vite-hooks/pre-commit) is committed. **pre-commit** runs `vp staged` (format with fixes, then a type-aware lint _without_ fixes, on staged files: a type-aware autofix applied at commit time would make the commit differ from the tree you verified). There is no pre-push hook: run the gates yourself.

## CI expectations

[ci.yml](.github/workflows/ci.yml) runs one required job, `build`, whose steps are the gate list in [AGENTS.md](AGENTS.md#verification). [release.yml](.github/workflows/release.yml) runs changesets/action on `trunk`: it opens the version PR while unreleased changesets exist and publishes once it merges, via npm OIDC trusted publishing (see [PUBLISHING.md](PUBLISHING.md)). Both workflows are hardened for Dependabot PRs: `permissions: {}` at the top with per-job grants (only the release job holds `id-token: write`, and it never runs for Dependabot), every action pinned to a commit SHA, `persist-credentials: false` where nothing pushes, no secrets in CI, and `zizmor` clean.

## Pre-PR checklist

1. The gates in [AGENTS.md](AGENTS.md#verification), each with its final pass/fail.
2. A changeset (`pnpm changeset`) where [AGENTS.md](AGENTS.md#branches-and-pull-requests) requires one.
3. `git fetch origin trunk && git rebase origin/trunk`
4. Docs: the package `README.md` for any exported change; the package `CLAUDE.md` for a new term or invariant.

## Running individual checks

```sh
vp fmt                                       # oxfmt
vp lint                                      # oxlint (+ @enfect/oxlint's Effect rules)
vp check --fix                               # both, autofixing
vp run check                                 # the whole type gate
vp run --filter ./packages/svelte check      # one package's type gate
vp run -r test:unit                          # unit tests
vp test run tests/Path.test.ts               # a single file (from inside the package)
vp run -r build                              # emit dist/
vp run docgen                                # compile and run packages/forms' @examples
vp run test:coverage                         # one Istanbul map for fallow
pnpm run fallow                              # fallow's dead-code / duplication / health summary
pnpm run fallow:audit                        # change-set review (not a CI gate)
```
