---
"@thomasfosterau/effect-forms": minor
---

Redesign the published types so the values they claim are the values they hold.

**Breaking:**

- `FormBuilder.FormBuilder<F, RefineR>` is typed by its `Schema.Struct` fields `F` (an array field as `Schema.$Array<item>`), not a record of field definitions, and tracks the `refineEffect` services `RefineR` apart from the fields' decoding services. It gains `structFields`; `fields` is the erased `Field.FieldsRecord`. `FormBuilder.buildSchema` returns `Schema.Struct<F>` itself (its decoding services are the fields' own); `asyncRefinements` / `runAsyncRefinements` carry only `RefineR`. New: `FormBuilder.Values<F>`, `FormBuilder.Encoded<F>`, `FormBuilder.AnyValues`. A refinement attached before a later field checks the wider value against the fields it saw (`Schema.is`) before its predicate runs.
- `Form.Form<S, Message, Blank, R>` gains the blank-data type `Blank` (default `S["Type"]`) and the services `R` (default `S["DecodingServices"]`); `empty()` returns `FormState<Blank>` and `validate` a `State.ValidatedFormState<S["Type"], Blank>` (below). `Form.fromBuilder` is overloaded: with `defaults` (now `FormBuilder.Encoded<F>`) the blank is that type; without, it is the schema-derived `Field.Blanks<F>`, no longer claimed to be the encoded type. New: `Form.BuilderForm`. `Form.FromBuilderOptions` is keyed by struct fields.
- `Validate.validateValueSync` accepts only a `Validate.ServiceFreeSchema` (new: Effect's `Schema.ConstraintDecoder<unknown>` narrowed to full schemas) and decodes without `Effect.runSync`; `validateValue` / `validateValueSync` take a `Path.FormValue` input.
- `Command.plan`'s create / update structs must have service-free fields, all the way into its decode probes.
- `Path.getAt` takes and returns a `Path.FormValue` (new: the form data tree; `Path.FormLeaf` its leaves), reading own properties only. `Path.setAt` takes a `T extends Path.FormValue` and a `FormValue` value.
- New: `Field.Blanks<F>` (a `BlankValue` per field, keyed by `F`) and `Field.blankValues(fields)`.
- `Form.Form.validate` answers the new `State.ValidatedFormState<A, Blank, Message>`: a `State.ValidFormState` (`isValid: true`, `data` the decoded value) or a `State.InvalidFormState` (`isValid: false`, `data` the decoded type or the blank / posted shape), built by the new `State.valid` / `State.invalid`. Narrow on `isValid` to reach the decoded value.
