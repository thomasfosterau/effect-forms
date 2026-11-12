# effect-forms

Framework-neutral, **Effect-native** form validation and state, plus Svelte 5 (runes) bindings. Schema-driven validation, nested errors, posted-value retention, and native input constraints — all derived from a single **Effect Schema**, with the same schema used on the server and in the browser.

| Package                                                  | Source                               | Description                                                                                                    |
| -------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [`@thomasfosterau/effect-forms`](packages/forms)         | [`packages/forms`](packages/forms)   | The framework-neutral core: schema-driven validation, error trees, coercion, constraint derivation.            |
| [`@thomasfosterau/effect-forms-svelte`](packages/svelte) | [`packages/svelte`](packages/svelte) | Svelte 5 runes bindings: a reactive form store, an `enhance` action, tainted tracking, client-side validation. |

## Install

```sh
pnpm add @thomasfosterau/effect-forms @thomasfosterau/effect-ext effect
# with the Svelte bindings
pnpm add @thomasfosterau/effect-forms-svelte svelte
# with the SvelteKit `/kit` entry
pnpm add @sveltejs/kit
```

`effect` and `@thomasfosterau/effect-ext` (and `svelte`, for the bindings) are peer dependencies; the packages never bundle their own copy, and a single resolved `effect` version matters. `@thomasfosterau/effect-ext` supplies the `TriState` that partial-update coercions return; import it from `@thomasfosterau/effect-ext/TriState`.

## Example

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Form } from "@thomasfosterau/effect-forms";

const Signup = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(2)),
  age: Schema.optional(Schema.FiniteFromString),
});

const signupForm = Form.make(Signup, { id: "signup", defaults: { name: "", age: undefined } });

// On the server: decode a submission (FormData, URLSearchParams, Request or a plain object).
const body = new URLSearchParams({ name: "A", age: "forty" });
const state = await Effect.runPromise(signupForm.validate(body));
// state.valid === false; state.errors.name and state.errors.age hold the messages;
// state.data keeps what was posted, so the form re-renders it.
```

In a Svelte 5 component, `createForm(state, { schema: Signup })` from `@thomasfosterau/effect-forms-svelte` turns that state into a reactive store with progressive-enhancement submission and client-side validation against the same schema. The guides in [`docs/`](docs/README.md) cover the full API; the per-export reference is the doc comment on each export.

## Development

This repository is a pnpm workspace managed by [Vite+](https://viteplus.dev) (the `vp` CLI). [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, and [AGENTS.md](AGENTS.md) lists the commands and the verification gates. Releases are automated with [Changesets](https://github.com/changesets/changesets): see [PUBLISHING.md](PUBLISHING.md). Security reports go through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
