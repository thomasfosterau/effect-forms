# Publishing

[Changesets](https://github.com/changesets/changesets) manages versions and changelogs for `@thomasfosterau/effect-forms` and `@thomasfosterau/effect-forms-svelte`; publishing is npm trusted publishing (OIDC) from the protected `release` environment. There is no `NPM_TOKEN`.

## Release flow

1. A PR with a changeset merges into `trunk`.
2. The Release workflow ([release.yml](../.github/workflows/release.yml)) opens or updates the `chore: version packages` PR (`vp run changeset:version`), assigned to the owner.
3. Merging it makes the next run publish, after the `release` environment's approval: `vp run release` builds, runs `vp pm publish -r --access public --no-git-checks -- --ignore-scripts` (pnpm publishes each package whose version isn't on npm yet, in dependency order, does the OIDC exchange and rewrites `catalog:` / `workspace:` specifiers), then `changeset git-tag` tags each untagged version and reports the tags to the Changesets action, which pushes them and creates the GitHub releases. A failed publish stops before tagging. There is no publish script; `vp run release:dry-run` builds and lists what would be published.

`release` is an uncached task (`cache: false`), so `vp run` passes it the job's full environment, including the OIDC request variables and `CHANGESETS_OUTPUT`. `.changeset/config.json` sets `"format": false` because Changesets would otherwise run Vite+'s IDE-only `oxfmt` shim; `changeset:version` runs `vp fmt` instead.

The release jobs install with `--ignore-scripts` and set `pnpm_config_verify_deps_before_run: "false"`, so no dependency script runs in a job holding `id-token: write`.

## Version coupling

`effect-forms-svelte` depends on the core through `workspace:^`, published as `^<version>`, so a consumer's single core satisfies both. `updateInternalDependencies: "patch"` bumps the bindings whenever the core is bumped; the two are not `fixed`, so their versions may diverge.

## One-time owner setup

1. Settings → Actions → General: allow GitHub Actions to create and approve pull requests.
2. On npmjs.com, for each package: Settings → Trusted Publisher → GitHub Actions, repository `thomasfosterau/effect-forms`, workflow `release.yml`, environment `release`. A new package's first version must be published by hand once before a trusted publisher can be added: from a clean `trunk` as `thomasfosterau`, `vp install --frozen-lockfile`, `vp run release:dry-run`, then `vp run release`, then `git push origin --tags` (never from a package directory).
3. Environments → `release`: required reviewers, deployments from `trunk` only.
