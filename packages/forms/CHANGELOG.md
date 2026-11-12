# @thomasfosterau/effect-forms

## 0.4.0

### Minor Changes

- 40348f7: `Command.plan` now classifies `Schema.OptionFrom*` fields (`OptionFromNullOr`, `OptionFromUndefinedOr`, `OptionFromNullishOr`, …) by their encoded side, so a `date`, `structured` or `enum` field keeps its kind when it moves from `optional(NullOr(X))` to `optional(OptionFromNullOr(X))`. Before, those fields threw `matches no known kind` at plan time. Fields that don't decode to an `Option` classify exactly as before.
- 7662234: `Command`'s default coercion of a `structured` field now throws a tagged error (`_tag: "InvalidStructuredJsonError"`, message `Invalid <field> payload — expected JSON`) on malformed JSON, instead of the platform `SyntaxError` from `JSON.parse`. It matches `jsonRowsFromField`, which throws an `InvalidJsonRowsError`. Callers that matched `SyntaxError` must match the `_tag` or the message instead.
- 6ed4a04: Replace open `Record<string, unknown>` dictionaries in the published types with owner- or schema-derived value types.

  `@thomasfosterau/effect-forms`:

  - `FormData.formDataToObject` / `requestToObject` return the new exported `FormData.FormBodyRecord` (values are `FormData.FormBodyValue`: a posted string or `File`, a nested record, or an array).
  - `Form.FormInput` is now generic, `FormInput<Encoded>`: a plain-object submission to `validate` is typed as the schema's `Encoded` type, and `Form.parse` returns `FormBodyRecord | S["Encoded"]`. Parse an external payload with the schema before handing it in.
  - `Field.defaultEncodedValues` returns the new exported `Field.BlankStruct`, and `Field.defaultValue` returns `Field.BlankValue`.
  - `Command.createAdapter` / `updateAdapter` return the new `Command.CommandPayload`, a record of `Command.CommandPayloadValue` (a JSON value, a `JsonRow` list, or `undefined` to skip). An `AdaptOverrides` function must now return a `CommandPayloadValue`.

  `@thomasfosterau/effect-forms-svelte`:

  - `FormStore.props` returns the new `FormProps` (`method`, optional `action`, and the attachment under a symbol key).
  - `EntityFormDefinition.adaptCreate` / `adaptUpdate` return `Command.CommandPayload`.
  - `WidgetEntry` is generic over the widget's props, and the `custom` / `rows` builders type a `props()` thunk as `WidgetOwnProps<Props>`: the component's own props, partial, minus the renderer-owned `WidgetBridgeKey`s (`name`, `value`, `onChange`, `errors`).
  - `ServerActionResult.data` is `unknown`: `applyActionResult` checks it before reading it.
  - `/kit`: `ActionFormState.data` holds each posted value as rendered (`Readonly<Record<string, string>>`, a `null` / `undefined` value absent), and `ActionFormState.errors` is an `Errors.FormErrors` tree that `formStateOf` checks; a malformed tree reads as absent.

- af6dbfe: `FormBuilder.make` (and `FormBuilder.empty`) is now typed `FormBuilder<FormBuilder.NoFields, never>` instead of `FormBuilder<{}, never>`. `NoFields` is the new exported name for a builder's empty field record. It's structurally the same empty record, so `addField` chains infer exactly as before, but code that spells out `FormBuilder<{}, never>` must use `FormBuilder<FormBuilder.NoFields, never>`.
- c36e487: `FormBuilder.refine` takes an optional second argument of filter annotations (`identifier`, `title`, `description`, …) that the check carries into the built schema. Without it the check stays anonymous, as before.
- 521c309: Remove unchecked type assertions from the core, so more of its published types are checked by the compiler instead of asserted.

  Breaking changes:

  - `FormBuilder.addField` no longer accepts a `FieldDef` / `ArrayFieldDef` object. Add a scalar field with `addField(key, schema)` and an array field with the new `addArrayField(key, itemSchema)` (replacing `addField(Field.makeArrayField(key, itemSchema))`).
  - `FormBuilder.refinements` is now typed against the builder's decoded values and services (`ReadonlyArray<Refinement<DecodedFromFields<TFields>, R>>`) instead of erasing them to `unknown`. Builders are plain objects whose methods close over their fields and refinements; they no longer share a prototype.
  - `Command.formInputFields` now returns `Readonly<Record<string, Command.FormInputField>>`, where the new `Command.FormInputField` is a schema with no decoding or encoding services (`Schema.Codec<unknown, unknown>`), and its `overrides` must be such schemas too. A `Schema.Struct` of the result decodes synchronously without a cast.

  Behaviour changes:

  - `Constraints.constraintsFromSchema` now decodes each built-in check's `representation.payload` with a schema before mapping it to an HTML attribute. A payload without the expected shape, or with a non-finite number (`NaN`, `±Infinity`), now derives no attribute instead of a malformed or meaningless one.
  - `Errors.setError` and `Errors.replaceAt` build their result immutably instead of deep-cloning the input and mutating the copy. Branches they don't touch are shared with the input, and the input itself comes back when nothing changes, such as clearing a path that holds no messages. Message order and key order are unchanged.
  - `Path.setAt` with a non-empty path on a root that is not an object or array (a string, say) now starts from an empty object instead of copying the boxed primitive's index properties. The same applies to `Form.make`'s merge of posted values over non-object `defaults` when a decode fails.

- 1902c32: Boolean state fields now carry an `is` prefix. `FormState.valid` / `posted` (and `FormStateSchema`, `State.make`'s options) become `isValid` / `isPosted`, `Validate`'s result union discriminates on `isValid` instead of `valid`, and in the Svelte bindings `FormStore.valid` / `posted`, `onUpdated`'s `form.valid` and `FormUpdate.valid` become `isValid` / `isPosted`. Wire shape: the JSON keys of a serialised `FormState` change (`valid` → `isValid`, `posted` → `isPosted`), so a form action's `fail(status, { form })` payload and any persisted state use the new keys, and `EnhanceCore` recognises a bare `FormState` response by `isValid`. `State.isValid(state)` keeps its name and now reads the renamed field.
- 848787b: Add `Focus`: typed field focuses on Effect's `effect/Optic`. They replace the string-path types, so reading and writing form data at a field needs no type assertion.

  **New:**

  - `Focus.root<S>()`, then `.key(k)` / `.at(i)` / `.defined()` / `.orElse(fallback)`, builds a `Focus.Lens<S, A>` or a `Focus.Optional<S, A>`. Each pairs an `Optic` lens or optional (`get` / `getOption` / `replace` / `modify`, typed) with the field's `FormPath` (`focus.path`).
  - `Focus.name(focus)` is the field's `name` attribute (`author.name`, `tags[0]`).
  - `.at` reads `None` out of range or for an absent record key, and a write there leaves the data unchanged.
  - `Validate.on(focus, validators)` binds a field's `FieldValidators` to its focus. The validators receive the field's typed value, and the result is a `Validate.BoundFieldValidators<S, R>` (resolved per trigger as a `Validate.FieldRun<R>`).
  - `Errors.issuesUnder(errors, path)` returns every message at or beneath a path, with paths relative to it.

  **Breaking:**

  - `Path.FieldPath` and `Path.PathValue` are removed. Use a `Focus`.
  - `Errors.TypedFormErrors` is removed. `FormErrors` is the only error-tree type. Read a field's messages with `Errors.getError(errors, focus.path)`, which returns `readonly string[]` for every form type.
  - `Path.setAt` is untyped: `setAt(obj: FormValue, path, value: FormValue): FormValue`. It no longer claims to return the input's type. A typed write is `focus.replace(value, data)`.

- ac81ca3: Absent values are `Option`s instead of `null` / `undefined` across the core's readers and internal state (#149). Breaking:

  - `Errors.getError` returns `Option.Option<readonly string[]>` (was `readonly string[] | undefined`).
  - `Field.schemaAt` returns `Option.Option<SchemaAST.AST>` (was `SchemaAST.AST | undefined`).
  - `Path.IndexMap` is `(index: number) => Option.Option<number>` (was `number | null`), so a hand-written index map returns `Option.none()` to drop an index; `removeAt` / `insertAt` / `swapAt` / `moveAt` / `replaceAt` / `clearAll` build the new shape.
  - `Path.remapIndex` returns `Option.Option<FormPath>` (was `FormPath | null`).
  - `Mode.ParsedMode.debounce` is `Option.Option<number>` (was `number | null`).
  - `Validate.resolveFieldTrigger(trigger, validators?)` takes the trigger first and the validators as an optional second argument (was `(validators | undefined, trigger)`); `Validate.ResolvedFieldTrigger.sync` / `.async` are `Option`s (were `| undefined`).
  - `Form.FormInput` no longer includes `null` / `undefined`; `Form.validate(input?)` takes an optional argument instead, so `validate(null)` becomes `validate()`.
  - `State.FormState.message` / `.constraints` and `State.MakeFormStateOptions` are `readonly x?: T` with no explicit `| undefined`: under `exactOptionalPropertyTypes`, omit the key rather than setting it to `undefined`.
  - `Command.jsonRowsFromField` returns `ReadonlyArray<Command.JsonRow> | undefined` (was a mutable array of an inline row type); `JsonRow` and `FormInputValue` are new exported types, and `FormInputRecord` is now derived from a `Schema.Record` (same shape). `Command.AdaptOverrides` functions take `raw: FormInputValue` (`string | undefined`, unchanged).
  - `Coerce.emptyToUndefined`, `trimToUndefined`, `trimToNull` and `booleanFromCheckbox` take their argument as optional (`value?: …`); every existing call still compiles.

- a8991b6: Partial-update fields are a tagged `TriState` instead of value / `null` / `undefined` in the decoded API (#160). The wire is unchanged: the `Command` adapters still post the value, `null` or an absent key. Breaking:

  - New required peer `@thomasfosterau/effect-ext` (`^0.1.0 || ^0.2.0`) of both packages. `TriState` comes from it: import it as `import * as TriState from "@thomasfosterau/effect-ext/TriState"` (the models `CarryForward`, `Clear`, `Assign<A>` and `TriState<A>`, the constructors `carryForward`, `clear` and `assign`, the fold `match`, and the field schemas `clearable` / `clearableNullOr`). effect-forms does not re-export it.
  - `Coerce.emptyToUndefined` is renamed `Coerce.emptyToCarryForward` and returns `TriState<T>` (was `T | undefined`).
  - `Coerce.emptyToNull` is renamed `Coerce.emptyToClear` and returns `TriState<T>` (was `T | null | undefined`). It no longer accepts `null`, and both coercers now take `T extends string`.
  - `Coerce.trimToUndefined` is renamed `Coerce.trimToCarryForward`, and `Coerce.trimToNull` is renamed `Coerce.trimToClear`. Both return `TriState<string>`.
  - `Coerce.numberFromField(raw?, options?)` returns `TriState<number>` (was `number | null | undefined`). `raw` and `options` are now optional, `nullable` defaults to `false`, and the overloads are gone.
  - `Command.jsonRowsFromField` returns `TriState<ReadonlyArray<JsonRow>>`: `CarryForward` for a blank field, and otherwise `Assign` (`"[]"` assigns an empty list). It was `ReadonlyArray<JsonRow> | undefined`.
  - `Command.AdaptOverrides` functions return a `TriState<Command.CommandPayloadValue>` (was `unknown`): `assign(value)`, `clear` or `carryForward`. This is the final shape: it supersedes the bare `CommandPayloadValue` return that the `Record<string, unknown>` change in this release describes. In `effect-forms-svelte`, `defineEntityForm`'s `adaptOverrides` changes the same way.
  - `Command.createAdapter` / `updateAdapter` leave a carried-forward field out of the payload. Before, the key was present with the value `undefined`. The JSON is identical, but an in-process `toStrictEqual` or `"key" in payload` check sees the difference.

  Both packages now declare `engines.node` `>=22.18.0` (was `^20.19.0 || >=22.12.0`), matching the new required peer `@thomasfosterau/effect-ext`. Node 20 and Node 22 before 22.18 are no longer supported.

- 2379d49: Redesign the published types so the values they claim are the values they hold.

  **Breaking:**

  - `FormBuilder.FormBuilder<F, RefineR>` is typed by its `Schema.Struct` fields `F` (an array field as `Schema.$Array<item>`), not a record of field definitions, and tracks the `refineEffect` services `RefineR` apart from the fields' decoding services. It gains `structFields`; `fields` is the erased `Field.FieldsRecord`. `FormBuilder.buildSchema` returns `Schema.Struct<F>` itself (its decoding services are the fields' own); `asyncRefinements` / `runAsyncRefinements` carry only `RefineR`. New: `FormBuilder.Values<F>`, `FormBuilder.Encoded<F>`, `FormBuilder.AnyValues`. A refinement attached before a later field checks the wider value against the fields it saw (`Schema.is`) before its predicate runs.
  - `Form.Form<S, Message, Blank, R>` gains the blank-data type `Blank` (default `S["Type"]`) and the services `R` (default `S["DecodingServices"]`); `empty()` returns `FormState<Blank>` and `validate` a `State.ValidatedFormState<S["Type"], Blank>` (below). `Form.fromBuilder` is overloaded: with `defaults` (now `FormBuilder.Encoded<F>`) the blank is that type; without, it is the schema-derived `Field.Blanks<F>`, no longer claimed to be the encoded type. New: `Form.BuilderForm`. `Form.FromBuilderOptions` is keyed by struct fields.
  - `Validate.validateValueSync` accepts only a `Validate.ServiceFreeSchema` (new: Effect's `Schema.ConstraintDecoder<unknown>` narrowed to full schemas) and decodes without `Effect.runSync`; `validateValue` / `validateValueSync` take a `Path.FormValue` input.
  - `Command.plan`'s create / update structs must have service-free fields, all the way into its decode probes.
  - `Path.getAt` takes and returns a `Path.FormValue` (new: the form data tree; `Path.FormLeaf` its leaves), reading own properties only. `Path.setAt` takes a `T extends Path.FormValue` and a `FormValue` value.
  - New: `Field.Blanks<F>` (a `BlankValue` per field, keyed by `F`) and `Field.blankValues(fields)`.
  - `Form.Form.validate` answers the new `State.ValidatedFormState<A, Blank, Message>`: a `State.ValidFormState` (`isValid: true`, `data` the decoded value) or a `State.InvalidFormState` (`isValid: false`, `data` the decoded type or the blank / posted shape), built by the new `State.valid` / `State.invalid`. Narrow on `isValid` to reach the decoded value.

- fc20988: Type the command error channel of the `/kit` form actions, and the unreadable-body defect of `Form.validate`, instead of carrying `unknown`.

  - **Breaking:** a Promise command's rejection, or a command's synchronous throw, now reaches the classifier as a `CommandFailure.CommandRejected` (a `Schema.TaggedError`) whose `cause` is the original value. A custom classifier that matched the raw rejection must look at `error.cause` instead, e.g. `error instanceof CommandFailure.CommandRejected && error.cause instanceof SessionCallError`. `jsonapiFailure` unwraps `CommandRejected` itself, so the default classification is unchanged. An `Effect` command's typed failure still reaches the classifier as itself.
  - **Breaking:** `Command`, `ActionCommand` and `FormActionOptions` take the command's error type `E` (default `never`), `IdempotentCreateOptions` and `FormActionOptions` the re-fetch's error type `F`; `runFormAction` and `formAction` infer both. `CommandFailure.Classify` takes the error type it is handed (`Classify<E = unknown>`), and `FormActionOptions.classify` is a `Classify<E | CommandRejected>`. An existing `CommandFailure.Classify` (over `unknown`) is still accepted.
  - **Breaking:** a defect in an `Effect` command (`Effect.die`) is no longer handed to the classifier: it is unrecognised, so it answers the 500 `Error` result, or under `unrecognised: "throw"` rethrows the defect as-is.
  - A synchronous throw from a command is now classified like a rejection (before, it was a defect).
  - The Promise boundaries (`idempotentCreate`, and `runFormAction` / `formAction` under `unrecognised: "throw"`) still reject with the original value, never the `CommandRejected` wrapper.
  - **Breaking (`effect-forms`):** `Form.validate` on a `Request` whose body can't be read as a form now dies with a `Form.UnreadableBody` (newly exported, a `Schema.TaggedError`) whose `cause` is the platform's rejection, instead of the raw rejection. `validate`'s error channel stays `never`.

### Patch Changes

- f2fc5ff: Drop three type assertions in favour of checked code. `jsonapiFailure` (`/kit`) now checks a `JsonapiError`- or `ErrorResponse`-tagged cause's `errors` against the JSON:API error-object schema before routing them: a `JsonapiError` with malformed `errors` is no longer recognised (`None`), and an `ErrorResponse` whose document's errors are malformed falls back to its message. `Form.make(...).validate` keeps a non-object blank as the failed state's `data` instead of a copy of the posted fields typed as the schema's value.
- 11987ea: Ship `CHANGELOG.md` in the published tarballs, so the release notes are readable from `node_modules`.
- 75ad5ff: Type the parameters that took `unknown`, parsing untyped input at its boundary.

  **Breaking (`effect-forms-svelte`):** `parseActionResult(body, status)` now takes an `ActionResponse<A, Message>` (a tagged `FormActionResult` or a bare `FormState`) rather than `unknown`. Check a raw JSON body with the new `isActionResponse(body)` guard first; a body it rejects is yours to report (the store's default `fetch` submit still answers it with an `Error` result, "Unrecognised form response").

  - `effect-forms-svelte`: `deepEqual`, `computeTainted`, `changeEvents` and `dispatchChange` take both snapshots as one type parameter `A` instead of two `unknown`s.
  - `effect-forms-svelte/kit`: `formStateOf` decodes the page's `form` prop with a Schema; its behaviour is unchanged.
  - `effect-forms`: `FormData.formDataToObject` treats a posted `File` as a leaf, like a string, so a later field whose path runs through the same name replaces it instead of setting a property on the `File`.

- 08c5799: The README is now a short landing page; the detailed guides moved to docs/ in the repository.
- 4d8b301: `Validate.validateValueSync` decodes through `SchemaParser.decodeUnknownResult`, Schema's own synchronous adapter, instead of running `validateValue` with `Effect.runSync`. Results are unchanged: a decode failure is still `isValid: false`, and a defect or async decoding work still throws. Its TSDoc now says so.

## 0.3.2

### Patch Changes

- 1ef75b1: The `effect` peer range is now `^4.0.0` (was `>=4.0.0`), per the peer-range policy. Only the form of the range changes: every 4.x release from 4.0.0 stays supported, and the floor is raised only when a dependency requires it.
- cd4a425: Internal cleanup for the stricter lint set (`@enfect/oxlint` plus Oxlint's `suspicious` / `perf` categories) with no behaviour change: module-level helpers are hoisted out of the functions that used them, shadowed names are renamed, and the parameter of `CommandFailure.message` is now named `text` in the emitted `.d.ts` (positional, so callers are unaffected).

## 0.3.1

### Patch Changes

- 21fc910: Internal cleanup to the Effect lint rules (`@mpsuesser/oxlint-plugin-effect`) with no API change; the emitted `.d.ts` is unchanged apart from doc comments. Observable edge differences:

  - `Command`'s developer-facing errors (an unclassifiable field, invalid JSON rows) and `EntityForm`'s definition-time errors are now tagged error classes. They still extend `Error` with the same `message`; only `name` differs.
  - Record helpers read own keys only, so an inherited or `__proto__` key in a posted object or schema field set no longer reaches a prototype.
  - `FormData.formDataToObject` given a non-iterable object outside its `FormBodySource` type now parses as an empty body instead of throwing.

  Also: runnable `@example`s for `Form.make`, `FormData.formDataToObject`, `Path.setAt` and `Constraints.constraintsFromSchema`; README links that resolve on npmjs.com; `homepage` points at the `trunk` branch.

## 0.3.0

### Minor Changes

- 39b96f2: **Breaking:** the `effect` peer floor is now `>=4.0.0` (it was `>=4.0.0-rc.118`). An application still on an `effect` 4.0.0 release candidate must upgrade `effect` to 4.0.0 or later. Nothing else changes.

## 0.2.0

### Minor Changes

- 4c4a823: **Breaking:** require `effect@>=4.0.0-rc.118` (the peer was `^4.0.0-beta.102`), and `@thomasfosterau/effect-jsonapi@>=0.16.0` for the optional `/kit` types peer. The library is built and tested against `effect@4.0.0-rc.118` and `@thomasfosterau/effect-jsonapi@0.16.0`.

  - `constraintsFromSchema` recognises the rc.118 check id `effect/schema/isBetweenLength` (it was `effect/schema/isLengthBetween`), so `Schema.isBetweenLength(min, max)` still derives `minlength` / `maxlength`. On older Effect that id is no longer matched; a consumer that persists or compares these ids needs the new one.
  - **Default error message text changes for every user.** The default leaf formatter now renders through `SchemaIssue.makeFormatterDefault()` (an issue's `toString` prints `[object Object]` as of rc.118, so the old `String(issue)` could not be kept):
    - the `, got <value>` suffix is gone: `Expected string, got 1` becomes `Expected string`;
    - a failed schema check shows the check's own message instead of `Invalid data <value>`: `Invalid data "x"` becomes `Expected a value with a length of at least 3` (for `Schema.isMinLength(3)`);
    - custom `message` annotations on a schema or check now surface as the field's message.

    Anything that asserts on the old text (tests, snapshots, e2e selectors) needs updating, or pass your own `leafFormatter`.

  - **`LeafFormatter` migration.** A failed check now reaches a custom `LeafFormatter` as the wrapping `Filter` issue (the check's message lives on it), not as the bare leaf `InvalidValue`. Match on `issue._tag === "Filter"` (read `issue.issue` for the inner leaf), as well as on `InvalidValue`. The symptom of not migrating: a custom branch on `InvalidValue` silently stops matching for check failures and falls through to your default case.

### Patch Changes

- 6220180: Documentation fixes in the published READMEs and type declarations:

  - `FormBuilder.filterOutputToFormIssues` is now marked `@deprecated`; import `Issues.filterOutputToFormIssues` instead. It is the same function, and the re-export still works.
  - `Form.make` and `State.MakeFormStateOptions` document their contract and defaults in the hover; the svelte docs name the real `Form.make` rather than an internal alias, and `EntityForm` drops application-specific wording.
  - The package READMEs gain Install and License sections, list every export (the core's `Command`; the Svelte root entry's `defineEntityForm`, `applyActionResult` and listeners), fix broken links and names of exports that do not exist, and the `effect-forms-svelte` README now carries the `/kit` guide.

- ddb184a: Tested against effect 4.0.0; peer floor unchanged (`>=4.0.0-rc.118`).

## 0.1.0

### Minor Changes

- 4405359: Initial release.

  `@thomasfosterau/effect-forms` is a framework-neutral, Effect-native form toolkit: `Form.make` binds an Effect Schema to a form and returns a serialisable `FormState` carrying every field error, the posted values, and constraints derived from the schema's own checks. `FormBuilder` composes a form field by field, with synchronous and effectful whole-form refinements.

  `@thomasfosterau/effect-forms-svelte` adds the Svelte 5 (runes) bindings: a reactive form store, a progressive-enhancement `enhance` attachment, tainted tracking, lifecycle listeners, and client-side validation against the same schema the server uses.

  Both were extracted from `thomasfosterau/website`, where they had been in production use; their pre-extraction git history is preserved.
