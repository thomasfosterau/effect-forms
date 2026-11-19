# Security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's [Report a vulnerability](https://github.com/thomasfosterau/effect-forms/security/advisories/new) button or to me@thomasfoster.au, not through public issues. Include a description, reproduction steps and the affected package and version.

## Supply chain

- Releases use npm trusted publishing; there is no long-lived npm token. The publish job runs in a protected environment with manual approval.
- Release jobs install with `--ignore-scripts`. Workflows default to `permissions: {}`, never persist checkout credentials, and pin actions by `.github/workflows/actions.lock`.
- `minimumReleaseAge` holds new versions for 8 hours; Dependabot waits 1 day. CI runs `pnpm audit --audit-level high`.
- The only runtime dependency is the core, from the bindings; `effect`, `svelte`, `@sveltejs/kit` and `@thomasfosterau/effect-ext` are peers.
