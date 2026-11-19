# effect-forms

Framework-neutral, [Effect](https://effect.website)-native form validation and state, plus Svelte 5 (runes) bindings. Validation, nested errors, posted-value retention and native input constraints all derive from one Effect Schema, shared by server and browser.

> [!CAUTION]
> Experimental and pre-1.0, largely written with Claude Code. The API may change between minor versions.

## Install

```sh
pnpm add @thomasfosterau/effect-forms @thomasfosterau/effect-ext effect
pnpm add @thomasfosterau/effect-forms-svelte svelte   # Svelte bindings
```

`effect`, `@thomasfosterau/effect-ext` and `svelte` are peers: keep a single copy of each in your app.

## Usage

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Form } from "@thomasfosterau/effect-forms";

const Signup = Schema.Struct({ name: Schema.String.check(Schema.isMinLength(2)) });
const signupForm = Form.make(Signup, { id: "signup", defaults: { name: "" } });

const state = await Effect.runPromise(signupForm.validate(new URLSearchParams({ name: "A" })));
// state.isValid === false; state.errors.name holds the message; state.data keeps what was posted.
```

In a component, `createForm(state, { schema: Signup })` from the Svelte bindings turns that state into a reactive store with progressive enhancement and client-side validation.

## Packages

| Package                                                            | What it is                                                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| [`@thomasfosterau/effect-forms`](packages/forms/README.md)         | The framework-neutral core: validation, error trees, coercion, constraints                    |
| [`@thomasfosterau/effect-forms-svelte`](packages/svelte/README.md) | Svelte 5 runes bindings: form store, `enhance` action, tainted tracking; `/kit` for SvelteKit |

## More

- Guides: [`docs/`](docs/README.md); the per-export reference is each export's doc comment.
- [Contributing](docs/CONTRIBUTING.md) · [Publishing](docs/PUBLISHING.md) · [Security](docs/SECURITY.md)

MIT © Thomas Foster
