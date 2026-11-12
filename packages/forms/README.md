# @thomasfosterau/effect-forms

Framework-neutral, **Effect-native** form validation and state: schema-driven validation, nested errors, posted-value retention and native input constraints, built on **Effect Schema** with no framework dependency. The Svelte 5 bindings live in [`@thomasfosterau/effect-forms-svelte`](https://www.npmjs.com/package/@thomasfosterau/effect-forms-svelte).

## Install

```sh
pnpm add @thomasfosterau/effect-forms effect
```

`effect` is a peer dependency; the package never bundles its own copy.

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
// state: { id, valid, posted, data, errors, constraints, message? }
```

## Guides

| Guide                                                                                                      | What it covers                                                                       |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Validation and state](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/forms/validation.md) | `Form.make`, `validate` / `empty`, coercion and update semantics.                    |
| [Building a form](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/forms/builder.md)         | `FormBuilder`: compose a form field by field, with whole-form refinements.           |
| [Errors](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/forms/errors.md)                   | The nested error tree and per-source tracking.                                       |
| [Constraints](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/forms/constraints.md)         | Native input attributes derived from the schema.                                     |
| [Modules](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/forms/modules.md)                 | Every exported namespace (`Form`, `State`, `Errors`, `Coerce`, ...) and its purpose. |

The per-export API reference is the doc comment on each export.

## License

[MIT](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/LICENSE)
