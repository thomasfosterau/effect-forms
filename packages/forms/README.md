# @thomasfosterau/effect-forms

Framework-neutral, **Effect-native** form validation and state: schema-driven validation, nested errors, posted-value retention and native input constraints, built on **Effect Schema** with no framework dependency. The Svelte 5 bindings live in [`@thomasfosterau/effect-forms-svelte`](https://www.npmjs.com/package/@thomasfosterau/effect-forms-svelte).

## Install

```sh
pnpm add @thomasfosterau/effect-forms @thomasfosterau/effect-ext effect
```

`effect` and `@thomasfosterau/effect-ext` (`^0.1.0 || ^0.2.0`) are peer dependencies; the package never bundles its own copy. `Coerce` and `Command` return effect-ext's `TriState`: import it as `import * as TriState from "@thomasfosterau/effect-ext/TriState"` (this package does not re-export it).

## Example

```ts
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { Form } from "@thomasfosterau/effect-forms";

const Signup = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(2)),
  age: Schema.optional(Schema.FiniteFromString),
});

const signupForm = Form.make(Signup, {
  id: "signup",
  defaults: { name: "", age: undefined },
});

// In a server action / load:
declare const request: Request;
const state = await Effect.runPromise(signupForm.validate(request));
// state: { id, isValid, isPosted, data, errors, constraints, message? }
```

## Entries

| Entry                          | Purpose                                                                                                                                                                                 | Guides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@thomasfosterau/effect-forms` | The only entry. Namespaces: `Form`, `FormBuilder`, `Field`, `Focus`, `State`, `Errors`, `Issues`, `FormData`, `Path`, `Coerce`, `Command`, `Constraints`, `Mode`, `Result`, `Validate`. | [Validation](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/forms/validation.md), [Builder](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/forms/builder.md), [Errors](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/forms/errors.md), [Constraints](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/forms/constraints.md), [Modules](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/forms/modules.md) |

## Links

- [Documentation index](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/README.md)
- [Changelog](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/CHANGELOG.md)
- The per-export API reference is the doc comment on each export.

## License

[MIT](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/LICENSE)
