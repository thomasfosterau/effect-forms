# @thomasfosterau/effect-forms

Framework-neutral, **Effect-native** form validation and state — schema-driven validation, nested errors, posted-value retention, status messages, and native input constraints, built on **Effect Schema** with no framework dependency. The Svelte 5 bindings live in [`@thomasfosterau/effect-forms-svelte`](../svelte).

## Install

```sh
pnpm add @thomasfosterau/effect-forms effect
```

`effect` is a peer dependency; the package never bundles its own copy.

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

### Building a form incrementally

`Form.make` binds a hand-written `Schema.Struct`. When you'd rather compose a form field by field — reusing field groups, merging them, and attaching whole-form (cross-field) rules — reach for `FormBuilder`:

```ts
import * as Effect from "effect/Effect";
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
declare const request: Request; // the incoming submission
const state = await Effect.runPromise(form.validate(request));
```

`FormBuilder.buildSchema` collapses the builder into an ordinary `Schema.Struct` (array fields become `Schema.Array(item)`) with each synchronous `refine` applied as a struct-level check — so it decodes, derives constraints, and validates like any schema. `refineEffect` attaches an **asynchronous** whole-form rule (a uniqueness check against a service, say); Effect Schema has no effectful filter, so `Form.fromBuilder` runs those on the Effect validate path and folds their failures into the same error tree.

Modules are exposed as Effect-style namespaces (`Form`, `State`, `Result`, `Errors`, …). `Form.make(schema, { defaults })` is the server-side validate-and-seed entry point:

- **`validate(input)`** accepts a `FormData`, `URLSearchParams`, `Request`, or a plain object. It parses the body (nested `author.name` / `tags[0]` / `tags[]` notation), decodes it through the schema collecting **every** field error (`errors: "all"`), and returns a serialisable [`FormState`](src/State.ts) — valid with the decoded data, or invalid with the nested [`FormErrors`](src/Errors.ts) tree and the **posted values preserved** so the form re-renders what the user typed. It is an `Effect`, so a schema that requires decoding services composes naturally; it never fails on the error channel (validation failures live in the returned state).
- **`empty()`** seeds a blank, unposted form from the defaults — what a `load` returns to render a create form.

## API

| Module                              | Purpose                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Form`](src/Form.ts)               | `make` — bind a schema to a form (validate + empty); `fromBuilder` — bind a `FormBuilder`.                                                                                                                                                                                                                                                                                                                           |
| [`FormBuilder`](src/FormBuilder.ts) | Compose a form field by field: `addField` / `merge` / `refine` / `refineEffect` / `buildSchema`.                                                                                                                                                                                                                                                                                                                     |
| [`Field`](src/Field.ts)             | `makeField` / `makeArrayField` field defs + guards, and blank-default derivation from a schema — `defaultValue` / `defaultEncodedValues` for a builder field, `schemaAt` / `defaultItemAt` for any nested path.                                                                                                                                                                                                      |
| [`State`](src/State.ts)             | `FormState`, `make`, `withMessage`, `withError`, `isValid`, `FormStateSchema` (transport).                                                                                                                                                                                                                                                                                                                           |
| [`Errors`](src/Errors.ts)           | The nested `FormErrors` tree + `issuesToErrors` / `flattenErrors` / `getError` / `setError` / `mergeErrors` / `remapIndices`; `SourcedErrors` per-source tracking via `replaceAt` / `setSourceAt` / `clearSourceAt` / `mergeSourced`.                                                                                                                                                                                |
| [`Issues`](src/Issues.ts)           | `FormIssue` + the Effect Schema issue-tree walker.                                                                                                                                                                                                                                                                                                                                                                   |
| [`FormData`](src/FormData.ts)       | `formDataToObject` / `parseFieldPath` — structured parsing of an HTML body.                                                                                                                                                                                                                                                                                                                                          |
| [`Path`](src/Path.ts)               | `getAt` / `setAt` (immutable) along a `FormPath`, `toString` / `fromString` notation conversion, the type-level `FieldPath<T>` / `PathValue<T, P>` deep-key projections a typed field handle is built on, and the `IndexMap` constructors (`removeAt` / `insertAt` / `swapAt` / `moveAt` / `replaceAt` / `clearAll`) + `remapIndex` / `remapKeyedRecord` for keeping per-index state in sync with an array mutation. |
| [`Coerce`](src/Coerce.ts)           | Tri-state (value / `null` / `undefined`) coercers for the form boundary.                                                                                                                                                                                                                                                                                                                                             |
| [`Command`](src/Command.ts)         | Derive form-input schemas, blank defaults and tri-state create / update adapters from a command-struct pair: `plan`, `formInputFields`, `blankDefaults`, `createAdapter`, `updateAdapter`, `jsonRowsFromField`.                                                                                                                                                                                                      |
| [`Constraints`](src/Constraints.ts) | `constraintsFromSchema` — native input attributes (`required`, `minlength`/`maxlength`, `min`/`max`, `pattern`, `step`) derived from the schema AST, including into array items; `constraintAt` reads one field's leaf out of the derived tree.                                                                                                                                                                      |
| [`Mode`](src/Mode.ts)               | `FormMode` + `parse` — when a form validates (`onSubmit` / `onBlur` / `onChange`), whether it auto-submits, and when a posted form revalidates (`revalidate`).                                                                                                                                                                                                                                                       |
| [`Result`](src/Result.ts)           | `FormActionResult` — the framework-neutral submission outcome (success / failure / redirect / error).                                                                                                                                                                                                                                                                                                                |
| [`Validate`](src/Validate.ts)       | `validateValue` / `validateValueSync` — ad-hoc value/field validation; `FieldValidators` + `runSyncFieldValidator` / `runAsyncFieldValidator` — per-field sync/async validators (debounced, fiber-cancellable).                                                                                                                                                                                                      |

## Notes

- **Coercion is the schema's job.** An HTML body is all strings; build the schema from coercing leaves (`Schema.FiniteFromString`, `Schema.BooleanFromString`, the `Coerce` helpers) so the parsed object decodes cleanly. The parser never guesses types.
- **Errors nest by field.** Leaf fields are `string[]`; nested objects / array indices nest; a branch's own (cross-field) message lives under `_errors`. The tree is plain JSON — it crosses the SSR boundary unchanged.
- **Update semantics.** The `Coerce` helpers honour the value / `null` / `undefined` contract (set / clear / carry-forward) for partial updates.
- **Constraint derivation reads schema checks, not just optionality.** `constraintsFromSchema` walks each property's `.check()`s for the `meta` annotation Effect Schema's built-in checks carry (`isMinLength`, `isBetweenLength`, `isPattern`, `isGreaterThanOrEqualTo`, `isBetween`, `isMultipleOf`, `isInt`, …), unwraps `optional` / `NullOr` unions, and descends into struct and array-item shapes. A check with no recognised `meta` tag (a bare `Schema.filter` predicate) derives nothing — there's no attribute to guess at. Anything the walk can't (or shouldn't) infer goes through the `overrides` argument, which always wins on conflict.
- **Errors have a source.** `Errors.SourcedErrors` keeps a `client` tree (browser-side validation) parallel to a `server` tree (the last submission), merged for display by `mergeSourced`. `Errors.replaceAt` / `setSourceAt` / `clearSourceAt` update one path in one source without disturbing the rest — what a reactive store needs so a server-reported failure survives a client revalidation of some _other_ field, but clears once its own field changes.

## License

[MIT](LICENSE)
