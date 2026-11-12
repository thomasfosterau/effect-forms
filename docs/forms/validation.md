# Validation and state

How a schema becomes a form: `Form.make` binds an Effect Schema to a server-side validate-and-seed entry point. To compose a form field by field instead, see [Building a form incrementally](builder.md). Every module is listed in [Modules](modules.md).

## Usage

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

Modules are exposed as Effect-style namespaces (`Form`, `State`, `Result`, `Errors`, …). `Form.make(schema, { defaults })` is the server-side validate-and-seed entry point:

- **`validate(input)`** accepts a `FormData`, `URLSearchParams`, `Request`, or a plain object. It parses the body (nested `author.name` / `tags[0]` / `tags[]` notation), decodes it through the schema collecting **every** field error (`errors: "all"`), and returns a serialisable [`FormState`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/src/State.ts) — valid with the decoded data, or invalid with the nested [`FormErrors`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/src/Errors.ts) tree and the **posted values preserved** so the form re-renders what the user typed. It is an `Effect`, so a schema that requires decoding services composes naturally; it never fails on the error channel (validation failures live in the returned state). A `Request` whose body can't be read as a form dies with `Form.UnreadableBody`, carrying the platform's rejection in `cause`.
- **`empty()`** seeds a blank, unposted form from the defaults — what a `load` returns to render a create form.

## Notes

- **Coercion is the schema's job.** An HTML body is all strings; build the schema from coercing leaves (`Schema.FiniteFromString`, `Schema.BooleanFromString`, the `Coerce` helpers) so the parsed object decodes cleanly. The parser never guesses types.
- **Update semantics.** A partial update says, per field, one of three things: set, clear or carry forward. The `Coerce` helpers and the `Command` coercions return it as a `TriState` (`Assign` / `Clear` / `CarryForward`); the `Command` adapters encode it onto the wire as the value, `null`, or an absent key, which is what an `optional(NullOr(...))` (effect-ext's `TriState.clearableNullOr`) update field decodes. `AdaptOverrides` return a `TriState` too.

See also [Errors](errors.md) and [Constraints](constraints.md).
