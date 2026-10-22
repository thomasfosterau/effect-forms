# Publishing & releases

Releases are automated with [Changesets](https://github.com/changesets/changesets) and the **Release** GitHub workflow ([`.github/workflows/release.yml`](.github/workflows/release.yml)), and published to npm via [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers) — there is no `NPM_TOKEN`. See [SECURITY.md](SECURITY.md) for the security rationale behind the pipeline. Two packages are published from this monorepo:

- `@thomasfosterau/effect-forms` (`packages/forms`)
- `@thomasfosterau/effect-forms-svelte` (`packages/svelte`)

## The release flow

1. **Add a changeset with your change.** Run `pnpm changeset`, pick the packages and the bump (`patch` / `minor` / `major`) and write a user-facing summary, then commit the generated file alongside your change. Which changes need one is set out in [AGENTS.md](AGENTS.md#branches-and-pull-requests); a doc-comment change that reaches the emitted `.d.ts` takes a `patch`. Preview what is pending with `vp exec changeset status`.
2. **Merge to `trunk`.** The Release workflow runs (after the `release` environment approval) and, while changesets are pending, opens or updates a **"chore: version packages"** PR from the `changeset-release/trunk` branch. Its version step, `pnpm run version` (`changeset version && pnpm install --lockfile-only && vp fmt`), applies the version bumps and rolls the changesets into each package's `CHANGELOG.md`. `.changeset/config.json` sets `"format": false`: Changesets 3 otherwise auto-detects the `oxfmt` binary Vite+ installs and runs it on the new changelogs, but that binary is Vite+'s IDE-only shim and exits 1 outside LSP mode, which would fail the release before the PR is opened. `vp fmt` formats the changelogs instead, so the version PR passes `vp check`.
3. **Merge the version PR.** With no changesets left, the workflow runs `pnpm run release` (`vp run -r build && pnpm -r --filter './packages/*' publish --access public --no-git-checks --ignore-scripts && changeset tag`): it builds every package, publishes the ones whose versions changed, and tags them; the action then pushes the tags and creates the GitHub releases.

The publish step uses `pnpm publish`, never `npm publish`: it rewrites each package's `workspace:^` and `catalog:peers` specifiers into concrete ranges (npm would publish the literal protocols), and since pnpm 11 it publishes natively, fetching the GitHub Actions OIDC token (audience `npm:registry.npmjs.org`) and exchanging it for a short-lived npm token itself, so npm is never upgraded in the job. The scripts run under `pnpm run`, not `vp run`, because `vp run` does not forward the `ACTIONS_ID_TOKEN_REQUEST_*` variables OIDC needs. `--ignore-scripts` keeps any publish lifecycle script out of the job holding `id-token: write`; no package defines one today. Provenance is pnpm's call: with no `pnpm_config_provenance` set it attaches provenance only when the OIDC token reports a public repository **and** the registry reports the package as public.

## Version coupling

`@thomasfosterau/effect-forms-svelte` depends on `@thomasfosterau/effect-forms` via `workspace:^`, and both declare their peers as `catalog:peers`. On publish, pnpm rewrites those to `^<the version being released>` and the ranges under `catalogs.peers` in `pnpm-workspace.yaml`. `workspace:^` (not `workspace:*`, which would publish an exact pin) lets a consumer's single core resolve both the bindings' dependency and its own direct one, and `updateInternalDependencies: "patch"` in `.changeset/config.json` means a bump to the core also bumps the bindings. The two are **not** in `fixed`, so their version numbers may diverge.

## Maintainer setup (one-time)

1. **Create the protected `release` environment.** _Settings → Environments → New environment_ named `release`, with **Required reviewers** (yourself) and deployments restricted to the `trunk` branch. The release job declares `environment: release`, so every version-PR update and every publish waits for that approval.
2. **Allow Actions to open the version PR.** _Settings → Actions → General → Workflow permissions_ → enable **"Allow GitHub Actions to create and approve pull requests"**. Without this the built-in `GITHUB_TOKEN` is forbidden from opening pull requests: the workflow pushes `changeset-release/trunk` and then fails with `GitHub Actions is not permitted to create or approve pull requests` — even though the job grants `pull-requests: write`.
3. **Configure a trusted publisher for each package on npmjs.com.** For **both** packages, open the package's _Settings → Trusted Publisher_ and add a GitHub Actions publisher:
   - Organization or user: `thomasfosterau`
   - Repository: `effect-forms`
   - Workflow filename: `release.yml`
   - Environment: `release`

   Then remove any classic automation tokens for the package. Both packages are already on npm. A **new** package must be published once by hand, because npm only accepts a trusted publisher for a package that already exists: authenticate with a short-lived [granular access token](https://docs.npmjs.com/creating-and-viewing-access-tokens), run `vp run -r build`, then `pnpm publish --access public --no-git-checks` from the package's directory. Then add its trusted publisher.

4. **Protect `trunk`.** Require pull requests and the passing `build` check (CI) before merge, and disallow direct pushes, so a release can only be triggered by merging the reviewed version PR.

## Manual fallback

If the workflow can't open the PR (e.g. setting 2 above is still off), the `changeset-release/trunk` branch is still pushed with the correct version bump — open the version PR from that branch by hand. You can also run the version step locally:

```sh
pnpm run version          # apply pending changesets -> bumps + CHANGELOGs
git switch -c changeset-release/trunk
git commit -am "chore: version packages"
# open a PR against trunk; merging it triggers the publish
```
