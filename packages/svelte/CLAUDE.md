# packages/svelte — `@thomasfosterau/effect-forms-svelte`

Svelte 5 runes bindings for the core. Read the root [AGENTS.md](../../AGENTS.md) first.

## Boundary

- **Root entry (`src/index.ts`)** imports `svelte` and `@thomasfosterau/effect-forms` only — never `@sveltejs/kit` or `$app/*`, so it works in any Svelte 5 app. fallow's `svelte` zone may import `forms`, never `kit`.
- **`/kit` entry (`src/kit/index.ts`)** is the only place `@sveltejs/kit` and the `$app/forms` virtual appear (both optional peers; `@thomasfosterau/effect-jsonapi` is a type-only optional peer). `$app/*` is never bundled (`deps.neverBundle`) and resolves to `tests/kit/app-forms.stub.ts` in tests.
- The core is consumed through its `exports` (`dist/`), as a consumer would; every task here has a `build` edge on it.

## Invariants

- **`FormStore.svelte.ts` stays a `.svelte.ts` module.** `vp pack` runs `unbundle: true` so it keeps its `.svelte.js` extension in `dist/`, which the consumer's Svelte compiler needs to process its runes. Rune compile errors only surface in `tests/FormStore.svelte.test.ts` (through the `svelte()` Vite plugin), not in `tsc` or svelte-check.
- **Client and server errors are separate sources** (`Errors.SourcedErrors`): a client revalidation never clears a server error on another field; a field's own change does.
- **Index-shifting array mutations remap per-index state** (touched flags, errors) so it keeps following its row.
- **Public Promise / action boundaries** (`idempotentCreate`, `runFormAction`, `formAction`, the store's default `fetch` submit) are where Effects run; everything inside them stays an `Effect`.

## Coverage

`vite.config.ts` gates the pure modules at 80% (`test.coverage.thresholds`); the rune store is exercised by its own suite but excluded from the threshold.
