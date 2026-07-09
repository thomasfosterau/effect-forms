# @thomasfosterau/effect-forms

Framework-neutral, **Effect-native** form validation and state — schema-driven
validation, nested errors, posted-value retention, status messages, and native
input constraints, built on **Effect Schema** with no framework dependency. The
Svelte 5 bindings live in
[`@thomasfosterau/effect-forms-svelte`](../effect-forms-svelte).

## Why

The app validates everything with Effect Schema (Zod is gone). The progressive
form libraries in the ecosystem are excellent, but they speak Standard Schema /
Zod and bake in a framework. This package keeps the ergonomics — one schema
drives validation, errors nest by field, posted values survive a failed submit,
native input constraints come for free — while staying on Effect Schema and free
of any framework, so the core is testable in isolation and reusable from a
Worker, the CLI, or a Svelte route.

## The shape

```ts
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { Form } from "@thomasfosterau/effect-forms";

const Signup = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(2)),
  age: Schema.optional(Schema.NumberFromString),
});

const signupForm = Form.make(Signup, {
  id: "signup",
  defaults: { name: "", age: undefined },
});

// In a server action / load:
const state = await Effect.runPromise(signupForm.validate(request));
// state: { id, valid, posted, data, errors, constraints, message? }
```

## Building a form incrementally

`Form.make` binds a hand-written `Schema.Struct`. When you'd rather compose a
form field by field — reusing field groups, merging them, and attaching
whole-form (cross-field) rules — reach for `FormBuilder`:

```ts
import * as Schema from "effect/Schema";
import { Field, Form, FormBuilder } from "@thomasfosterau/effect-forms";

const signup = FormBuilder.empty
  .addField("email", Schema.String.check(Schema.isMinLength(3)))
  .addField("password", Schema.String.check(Schema.isMinLength(8)))
  .addField("confirm", Schema.String)
  .addField(Field.makeArrayField("tags", Schema.String)) // an array field
  .refine((v) =>
    v.password === v.confirm ? undefined : { path: ["confirm"], issue: "Passwords must match" },
  );

// Bind it exactly like a schema (defaults are derived when omitted):
const form = Form.fromBuilder(signup, { id: "signup" });
const state = await Effect.runPromise(form.validate(request));
```

`FormBuilder.buildSchema` collapses the builder into an ordinary
`Schema.Struct` (array fields become `Schema.Array(item)`) with each
synchronous `refine` applied as a struct-level check — so it decodes, derives
constraints, and validates like any schema. `refineEffect` attaches an
**asynchronous** whole-form rule (a uniqueness check against a service, say);
Effect Schema has no effectful filter, so `Form.fromBuilder` runs those on the
Effect validate path and folds their failures into the same error tree.

Modules are exposed as Effect-style namespaces (`Form`, `State`, `Result`,
`Errors`, …). `Form.make(schema, { defaults })` is the server-side
validate-and-seed entry point:

- **`validate(input)`** accepts a `FormData`, `URLSearchParams`, `Request`, or a
  plain object. It parses the body (nested `author.name` / `tags[0]` / `tags[]`
  notation), decodes it through the schema collecting **every** field error
  (`errors: "all"`), and returns a serialisable [`FormState`](src/State.ts) —
  valid with the decoded data, or invalid with the nested
  [`FormErrors`](src/Errors.ts) tree and the **posted values preserved** so the
  form re-renders what the user typed. It is an `Effect`, so a schema that
  requires decoding services composes naturally; it never fails on the error
  channel (validation failures live in the returned state).
- **`empty()`** seeds a blank, unposted form from the defaults — what a `load`
  returns to render a create form.

## What's in the box

| Module                              | Purpose                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Form`](src/Form.ts)               | `make` — bind a schema to a form (validate + empty); `fromBuilder` — bind a `FormBuilder`.                                                                                                                    |
| [`FormBuilder`](src/FormBuilder.ts) | Compose a form field by field: `addField` / `merge` / `refine` / `refineEffect` / `buildSchema`.                                                                                                              |
| [`Field`](src/Field.ts)             | `makeField` / `makeArrayField` field defs + guards, and blank-default derivation from a schema.                                                                                                               |
| [`State`](src/State.ts)             | `FormState`, `makeFormState`, `setMessage`, `withError`, `FormStateSchema` (transport).                                                                                                                       |
| [`Errors`](src/Errors.ts)           | The nested `FormErrors` tree + `issuesToErrors` / `flattenErrors` / `getError` / `setError` / `mergeErrors`.                                                                                                  |
| [`Issues`](src/Issues.ts)           | `FormIssue` + the Effect Schema issue-tree walker.                                                                                                                                                            |
| [`FormData`](src/FormData.ts)       | `formDataToObject` / `parseFieldPath` — structured parsing of an HTML body.                                                                                                                                   |
| [`Path`](src/Path.ts)               | `getAt` / `setAt` (immutable) along a `FormPath`, `toString` / `fromString` notation conversion, and the type-level `FieldPath<T>` / `PathValue<T, P>` deep-key projections a typed field handle is built on. |
| [`Coerce`](src/Coerce.ts)           | Tri-state (value / `null` / `undefined`) coercers for the form boundary.                                                                                                                                      |
| [`Constraints`](src/Constraints.ts) | `constraintsFromSchema` — native input attributes derived from the schema AST, including into array items; `constraintAt` reads one field's leaf out of the derived tree.                                     |
| [`Mode`](src/Mode.ts)               | `FormMode` + `parse` — when a form validates (`onSubmit` / `onBlur` / `onChange`) and whether it auto-submits.                                                                                                |
| [`Result`](src/Result.ts)           | `FormActionResult` — the framework-neutral submission outcome (success / failure / redirect / error).                                                                                                         |
| [`Validate`](src/Validate.ts)       | `validateValue` / `validateValueSync` — ad-hoc value/field validation.                                                                                                                                        |

## Notes

- **Coercion is the schema's job.** An HTML body is all strings; build the
  schema from coercing leaves (`Schema.NumberFromString`,
  `Schema.BooleanFromString`, the `Coerce` helpers) so the parsed object decodes
  cleanly. The parser never guesses types.
- **Errors nest by field.** Leaf fields are `string[]`; nested objects / array
  indices nest; a branch's own (cross-field) message lives under `_errors`. The
  tree is plain JSON — it crosses the SSR boundary unchanged.
- **Update semantics.** The `Coerce` helpers honour the value / `null` /
  `undefined` contract (set / clear / carry-forward) the app uses for partial
  updates.
- **Constraint derivation reads schema checks, not just optionality.**
  `constraintsFromSchema` walks each property's `.check()`s for the `meta`
  annotation Effect Schema's built-in checks carry (`isMinLength`,
  `isLengthBetween`, `isPattern`, `isGreaterThanOrEqualTo`, `isBetween`,
  `isMultipleOf`, `isInt`, …), unwraps `optional` / `NullOr` unions, and
  descends into struct and array-item shapes. A check with no recognised
  `meta` tag (a bare `Schema.filter` predicate) derives nothing — there's no
  attribute to guess at. Anything the walk can't (or shouldn't) infer goes
  through the `overrides` argument, which always wins on conflict.

## File naming

Source modules use PascalCase file names, matching Effect's own convention
(`effect/Schema`, `effect/SchemaParser`), so the subpath exports read
`@thomasfosterau/effect-forms/Form`, `/Errors`, and so on.

## Development

```sh
vp exec tsc -p tsconfig.json   # typecheck
vp test run tests              # unit tests
vp test run tests --coverage   # with coverage
```
