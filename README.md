# effect-forms

Framework-neutral, **Effect-native** form validation and state, plus Svelte 5 (runes) bindings. Schema-driven validation, nested errors, posted-value retention, and native input constraints — all derived from a single **Effect Schema**, with the same schema used on the server and in the browser.

| Package                                                  | Source                               | Description                                                                                                    |
| -------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [`@thomasfosterau/effect-forms`](packages/forms)         | [`packages/forms`](packages/forms)   | The framework-neutral core: schema-driven validation, error trees, coercion, constraint derivation.            |
| [`@thomasfosterau/effect-forms-svelte`](packages/svelte) | [`packages/svelte`](packages/svelte) | Svelte 5 runes bindings: a reactive form store, an `enhance` action, tainted tracking, client-side validation. |

## Install

```sh
pnpm add @thomasfosterau/effect-forms effect
# with the Svelte bindings
pnpm add @thomasfosterau/effect-forms-svelte svelte
# with the SvelteKit `/kit` entry
pnpm add @sveltejs/kit
```

`effect` (and `svelte`, for the bindings) are peer dependencies — the packages never bundle their own copy. Two copies of `effect` break `Context` / `Layer` / `Schema` identity at runtime, so a single resolved version matters. Each package's README is its API reference.

## Development

This repository is managed by [Vite+](https://viteplus.dev) (the `vp` CLI).

```sh
vp install                            # install dependencies
vp run -r build                       # build every package with tsdown
vp check                              # format (Oxfmt), lint (Oxlint), type-check (tsgolint)
vp run --filter './packages/*' check  # svelte-check over packages/svelte
vp run -r test                        # run every package's Vitest suite
```

Build before checking or testing on a clean checkout: `packages/svelte` imports `@thomasfosterau/effect-forms` through its public `exports`, which point at `dist/`.

Releases are automated with [Changesets](https://github.com/changesets/changesets) — see [docs/RELEASING.md](docs/RELEASING.md).

## License

[MIT](LICENSE)
