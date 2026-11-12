# @thomasfosterau/effect-forms-svelte

## 0.4.0

### Minor Changes

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

- eee1c01: `validateData` / `validateField` take `schema: Schema.Top` instead of a type parameter `S`, and `EntryBuilders.custom` / `.rows` take `props: () => Readonly<Record<string, unknown>>` instead of a type parameter `P`. Each parameter appeared only once in its signature, so inference is unchanged. A call that passed the type argument explicitly (`validateData<typeof Schema>(…)`, `custom<Props>(…)`) must drop it.
- dcf51d7: **Breaking:** the `/kit` form-state readers model "no submission" as `Option`. `formStateOf(form)` answers `Option<ActionFormState>` (`None` for a first render, a redirecting success, or a result that carried no form state) instead of `ActionFormState | undefined`, and `issuesFor`, `rootIssuesOf` and `valueOf` take that `Option`. A template that passes `formStateOf(form)` straight to the readers is unchanged; a call that passed `undefined` passes `Option.none()`.
- 9b2194c: `FormStore`'s default submit POSTs through Effect's `HttpClient` (`effect/http`, on the platform `fetch` through `FetchHttpClient`) instead of calling `fetch` directly. The submission (`handler`, `submit` or the default POST, then `onResult` and the update) runs as one Effect on a store-owned `ManagedRuntime`, so an `HttpClient` in the store's `layer` doesn't reroute the default POST.

  The request is the same: the form body, `Accept: application/json`, and no `traceparent` / `b3` headers. `submitting`, `delayed`, `onResult` and `onError` behave as before, and a network failure still reports `fetch`'s own rejection message.

  One visible change: when the response body isn't JSON, the `Error` result's `message` is now always `"Request failed"`. It used to be the response's `statusText` when that was non-empty. Effect's `HttpClientResponse` doesn't expose `statusText` at the `effect` 4.0 peer floor. Over HTTP/2 and HTTP/3, `statusText` is always empty, so the message there was already `"Request failed"`. `status` is unchanged.

  Bundle cost: the `effect/http` client modules add about 40 KB minified (about 13.5 KB gzipped) to a consumer bundle that includes the store.

- 1902c32: Boolean state fields now carry an `is` prefix. `FormState.valid` / `posted` (and `FormStateSchema`, `State.make`'s options) become `isValid` / `isPosted`, `Validate`'s result union discriminates on `isValid` instead of `valid`, and in the Svelte bindings `FormStore.valid` / `posted`, `onUpdated`'s `form.valid` and `FormUpdate.valid` become `isValid` / `isPosted`. Wire shape: the JSON keys of a serialised `FormState` change (`valid` → `isValid`, `posted` → `isPosted`), so a form action's `fail(status, { form })` payload and any persisted state use the new keys, and `EnhanceCore` recognises a bare `FormState` response by `isValid`. `State.isValid(state)` keeps its name and now reads the renamed field.
- 91d69a5: Raise the optional `@thomasfosterau/effect-jsonapi` peer floor from `>=0.16.0` to `>=0.18.0`, the first release that exports the `Document.ErrorObject` type.

  - **Breaking:** `CommandFailure.ErrorObject` (`/kit`) is now spelled `Document.ErrorObject` instead of `typeof Document.ErrorObject.Type`. It is the same type, but effect-jsonapi 0.16 and 0.17 don't export it, so `/kit`'s declarations no longer type-check against them.

- 75ad5ff: Type the parameters that took `unknown`, parsing untyped input at its boundary.

  **Breaking (`effect-forms-svelte`):** `parseActionResult(body, status)` now takes an `ActionResponse<A, Message>` (a tagged `FormActionResult` or a bare `FormState`) rather than `unknown`. Check a raw JSON body with the new `isActionResponse(body)` guard first; a body it rejects is yours to report (the store's default `fetch` submit still answers it with an `Error` result, "Unrecognised form response").

  - `effect-forms-svelte`: `deepEqual`, `computeTainted`, `changeEvents` and `dispatchChange` take both snapshots as one type parameter `A` instead of two `unknown`s.
  - `effect-forms-svelte/kit`: `formStateOf` decodes the page's `form` prop with a Schema; its behaviour is unchanged.
  - `effect-forms`: `FormData.formDataToObject` treats a posted `File` as a leaf, like a string, so a later field whose path runs through the same name replaces it instead of setting a property on the `File`.

- 848787b: Every store method that addresses a field now takes a typed `Focus` (from `@thomasfosterau/effect-forms`) in place of a path. The field handle's value and the error reads need no type assertion.

  A focus is `form.root.key("author").key("name")`, or a function of the root: `(o) => o.key("author").key("name")`. The store types this as `At<A, V>`, or `LensAt<A, V>` for a focus that always finds its value.

  **Breaking:**

  - **Renamed:** `setValue(path, v)` / `valueAt(path)` become `set(focus, v)` / `get(lensFocus)`. `set` checks `v` against the field's type. `getOption(focus)` is new.
  - **Field handles:** `field("author.name")` becomes `field((o) => o.key("author").key("name"))`, which returns a `FieldHandle<A, V>` (the type was `FieldHandle<V>`). `field` takes a focus that always finds its value; for an array item, add a fallback: `field((o) => o.key("tags").at(i).orElse(""))`. `FieldHost` is now `FieldHost<A>`.
  - **Focus-taking methods:** `errorsAt`, `visibleErrorsAt`, `shouldShowError`, `taintedAt`, `isValidatingAt`, `validateField`, `setTouched`, `isTouchedAt`, `isDirtyAt`, `isDefaultValueAt`, `constraintAt`, `handleBlur` and `setFieldValidators` take a focus.
  - **Plain error trees:** `errors`, `clientErrors` and `serverErrors` are plain `FormErrors` (they were `TypedFormErrors<A>`).
    - Read one field with `errorsAt(focus)`; an array's or a branch's own messages with `errorsAt` on the array or branch.
    - Read the form-level `_errors` with the new `formErrors`.
    - Read a section with the new `errorsUnder(focus)` / `hasErrorsAt(focus)`.
  - **Array mutators:** `append`, `insertItem`, `replaceItem`, `removeItem`, `clearItems`, `swap` and `move` take a focus on a readonly array, with the item typed.
    - `append` and `insertItem` require the item. The new `blankItemAt(focus)` returns the schema-derived blank as the `Field.BlankValue` it is, so `append(tags, form.blankItemAt(tags))` compiles only where the items admit a blank (`DraftData`).
  - **Writes where nothing is found:** a write through an optional focus that finds nothing leaves the data unchanged. Before, a write below an absent optional branch created the missing containers.
  - **Validators:** `FormOptions.validators` is a function of the root focus returning `Validate.on(focus, validators)` bindings: `validators: (o) => [Validate.on(o.key("username"), { onChange })]`. Each validator receives the field's typed value.
  - **`/kit` readers:** `issuesFor(state, focus)` and `valueOf(state, focus, fallback?)` take a focus (any `Focus.HasPath`), and read nested fields and array items too. `ActionFormState.data` is keyed by flat field name (`author.name`, `tags[0]`).
  - **`/kit` routing:** a JSON:API error's `source.pointer` routes to its whole attribute path (`/data/attributes/address/street` → `address.street`). It used to route to the top-level field. The new `pathFromPointer` exposes that mapping.

- ac81ca3: Absent values are `Option`s instead of `null` / `undefined` in the store's callbacks and pure helpers (#149). Breaking:

  - `Submission.submitter` (the `onSubmit` context) is `Option.Option<HTMLElement>` (was `HTMLElement | null`); pass `Option.getOrNull(submitter)` where a DOM API wants the element.
  - `DataApplication.data` / `.rebaseTo` (returned by `computeDataApplication`) are `Option.Option<A>` (were `A | undefined`).
  - `FormUpdate`'s members are `readonly x?: T` with no explicit `| undefined`; `resultToUpdate` omits `message` when the state carries none.
  - `/kit`: `CommandFailure.detailOf(error, fallback?)` takes a defined `ErrorObject` (was `ErrorObject | undefined`).
  - `/kit`: `FormActionOptions`' members are `readonly x?: T` with no explicit `| undefined`; `fieldFromPointer(pointer?)` takes an optional argument.
  - `dispatchChange<A>(before: A, after: A, listeners?)` takes the listeners as an optional argument (was a required `FormListeners | undefined`).

  `errorsAt`, `validateField` and the store follow the core's `Option`-returning `Errors.getError`, `Path.IndexMap` and `Mode.ParsedMode.debounce`; their own results are unchanged.

- 03a7a96: Remove unchecked type assertions from the Svelte bindings, tightening a few published types.

  - **Breaking:** `runFormAction` and `formAction` (`/kit`) now require a schema whose decoding needs no services: `S extends ServiceFreeSchema` (newly exported, `Schema.Top & { readonly DecodingServices: never }`). They decode the submission with nothing to provide, so a schema with a non-`never` `DecodingServices` (including one typed as plain `Schema.Top`) used to compile and then fail at runtime; it is now a type error.
  - `formStateOf` (`/kit`) returns a new object holding only the carried state's `data` and `errors`, each kept only when it is a non-array object. A `form` value that is an array now reads as `undefined`. `issuesFor`, `rootIssuesOf` and `valueOf` return the same results as before for any input.
  - `EntryBuilders.custom` / `rows` (`defineEntityForm`) are generic in the widget's `Props` (`component: Component<Props>`), so the component's own type is inferred rather than widened. Every component, including a `Component<never>`, is still accepted.
  - `FieldHandle`'s constructor takes a `FieldHost` (newly exported): the path-addressed methods of a `FormStore` it calls. Any `FormStore` is a `FieldHost`.
  - Spreading `FormStore.props` onto an element other than a `<form>` now throws a `TypeError` when the attachment runs. Before, the store attached anyway and failed later, at submit.
  - The array mutators (`append`, `insertItem`, `replaceItem`, `removeItem`, `swap`, `move`) treat a non-array value at `path` as an empty array. Before, they spread whatever was there.
  - `EntityFormDefinition.createInput` / `updateInput` are typed `Command.FormInputField` (a schema with no services) instead of `Schema.Top`, and `inputOverrides.create` / `.update` accept only such schemas. `Schema.decodeUnknownSync(definition.createInput)` and `Form.make(definition.createInput)` with `formAction` now type-check without a cast.

- dcf51d7: **Breaking:** `deepEqual` and `computeTainted` take form data trees: their type parameter is constrained to `Path.FormValue` (from `@thomasfosterau/effect-forms`), which every store's data already is. Their results are unchanged.
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

- 2379d49: Redesign the store's types so they hold without `any` or unchecked assertions where a sound type exists.

  **Breaking:**

  - `FormStore<S, A, Message, R>` requires `S extends Validate.ServiceFreeSchema` and `A extends Path.FormValue` (`A` no longer defaults). Its constructor takes `StoreOptions` (new: `FormOptions` with a required `layer`).
  - `createForm` is overloaded by source and by whether `layer` is given: without `layer`, `R` is `never` and the store uses `Layer.empty`; with it, `R` is the layer's. A builder store's data is `FormBuilder.Encoded<F>` with `defaults`, and `DraftData<F>` (new: one `Path.FormValue` per field) without. A bound schema must be a `FormSchema` (new; a builder's fields `FormFields`). `FormBuilderOptions` is keyed by struct fields.
  - `FormOptions.builder` is replaced by `FormOptions.refinements` (new `FormRefinements<R>`, built by the new `refinementsOf(builder)`); `createForm` still wires it from a builder automatically.
  - `FormOptions.validators` and `setFieldValidators` take `FieldValidators<Path.FormValue, R>`: a validator receives the field's runtime value and narrows it.
  - `setValue`, `append`, `insertItem` and `replaceItem` take a `Path.FormValue`; `valueAt` returns one. `FieldHandle<V>` requires `V extends Path.FormValue`, and `field(path)` returns `FieldHandle<Extract<PathValue<A, P>, FormValue>>`.
  - `validateData` / `validateField` take a `Validate.ServiceFreeSchema` and `Path.FormValue` data; `objectToEntries` / `objectToFormData` take a `Path.FormValue` (a function, symbol, `Map` or `Set` is now a type error).
  - `changeEvents` / `dispatchChange` require `A extends Path.FormValue`; `CommandStructLike` (`defineEntityForm`) requires service-free fields.
  - `applyActionResult<A>(form, result)` takes any `ServerStateTarget<A>` (new) instead of `FormStore<any, any, any>`; `enhanceForm` (`/kit`) takes an `EnhanceTarget<A>` (new).
  - `/kit`'s `ServiceFreeSchema` is now the core's `Validate.ServiceFreeSchema`. `runFormAction` / `formAction` take any `Form.Form<S, Message, Blank, never>`, so a `Form.fromBuilder` form fits: a failure echoes `FormState<S["Type"] | Blank>`, and the command receives only the decoded value from the valid branch.

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
- 5dd1839: `enhanceForm` no longer leaves a stale `page.form` on screen after a validation failure. It used to apply a `fail(400, { form })` to the store and then return without calling SvelteKit's `update`, so `page.form` kept whatever an earlier submit had set: for example a `fail(500, { message })` from an unrecognised fault, which then showed beside the new field errors. It now always runs `update({ reset: false })` after applying the failure to the store, so SvelteKit replaces `page.form` with the current result.
- 64eec51: `formStateOf` / `valueOf` (`/kit`) no longer repopulate a field from a posted `File` / `Blob`: a file input can't be refilled, and the value used to read back as `[object File]`. The field falls back like a posted `null`.
- 308fb49: The README's SvelteKit login example names its password field `password` (it was `_password`).
- 08c5799: The README is now a short landing page; the detailed guides moved to docs/ in the repository.
- Updated dependencies [f2fc5ff]
- Updated dependencies [11987ea]
- Updated dependencies [40348f7]
- Updated dependencies [7662234]
- Updated dependencies [6ed4a04]
- Updated dependencies [af6dbfe]
- Updated dependencies [c36e487]
- Updated dependencies [521c309]
- Updated dependencies [1902c32]
- Updated dependencies [75ad5ff]
- Updated dependencies [848787b]
- Updated dependencies [ac81ca3]
- Updated dependencies [08c5799]
- Updated dependencies [a8991b6]
- Updated dependencies [2379d49]
- Updated dependencies [fc20988]
- Updated dependencies [4d8b301]
  - @thomasfosterau/effect-forms@0.4.0

## 0.3.2

### Patch Changes

- 1ef75b1: The `effect` peer range is now `^4.0.0` (was `>=4.0.0`), per the peer-range policy. Only the form of the range changes: every 4.x release from 4.0.0 stays supported, and the floor is raised only when a dependency requires it.
- cd4a425: Internal cleanup for the stricter lint set (`@enfect/oxlint` plus Oxlint's `suspicious` / `perf` categories) with no behaviour change: module-level helpers are hoisted out of the functions that used them, shadowed names are renamed, and the parameter of `CommandFailure.message` is now named `text` in the emitted `.d.ts` (positional, so callers are unaffected).
- 19690ba: Drop redundant default type arguments in `FormStore.svelte.ts` (found by type-aware linting): `FieldHandle`'s constructor now declares its store as `FormStore<Schema.Top, object>`, the same type as before written without the default `Message = unknown`. No runtime change.
- Updated dependencies [1ef75b1]
- Updated dependencies [cd4a425]
  - @thomasfosterau/effect-forms@0.3.2

## 0.3.1

### Patch Changes

- 58cebf7: `FormStore` now runs a `FormBuilder`'s `refineEffect` refinements on the form data decoded through the builder's schema, as `Form.fromBuilder` does on the server, instead of on the raw encoded values. A field whose codec transforms (such as `Schema.FiniteFromString`) is therefore seen as the same decoded value in the browser and on the server. While the data doesn't decode, the refinements don't run (the field errors already report why), and errors from their previous run are cleared.
- 21fc910: Internal cleanup to the Effect lint rules (`@mpsuesser/oxlint-plugin-effect`) with no API change; the emitted `.d.ts` is unchanged apart from doc comments. Observable edge differences:

  - `Command`'s developer-facing errors (an unclassifiable field, invalid JSON rows) and `EntityForm`'s definition-time errors are now tagged error classes. They still extend `Error` with the same `message`; only `name` differs.
  - Record helpers read own keys only, so an inherited or `__proto__` key in a posted object or schema field set no longer reaches a prototype.
  - `FormData.formDataToObject` given a non-iterable object outside its `FormBodySource` type now parses as an empty body instead of throwing.

  Also: runnable `@example`s for `Form.make`, `FormData.formDataToObject`, `Path.setAt` and `Constraints.constraintsFromSchema`; README links that resolve on npmjs.com; `homepage` points at the `trunk` branch.

- Updated dependencies [21fc910]
  - @thomasfosterau/effect-forms@0.3.1

## 0.3.0

### Minor Changes

- 39b96f2: **Breaking:** the `effect` peer floor is now `>=4.0.0` (it was `>=4.0.0-rc.118`). An application still on an `effect` 4.0.0 release candidate must upgrade `effect` to 4.0.0 or later. Nothing else changes.

### Patch Changes

- 598ec6f: `objectToEntries` (and so `objectToFormData` and `FormStore.toFormData()`) now omits `function` and `symbol` values, as `JSON.stringify` omits such object properties; in an array such an item is omitted too, and the remaining items keep their indices. It used to stringify them, so a callback left in form data was sent as its source code and a symbol as `"Symbol(…)"`. `string`, `number`, `boolean` and `bigint` values are still stringified, `null` still becomes `""`, and `undefined` is still skipped.
- 6807a7b: `objectToFormData` (and so `FormStore.toFormData()`) now keeps `File` and `Blob` values: each is appended as a file, and a `File` keeps its name, so a file held in form data reaches the server and `FormData.formDataToObject` passes it through unchanged. It used to drop them silently. `objectToEntries` still returns string entries only, so it omits a `File` or `Blob` (an array item leaves a gap, and the other items keep their indices).

  `objectToEntries`, `objectToFormData` and `FormStore.toFormData()` now encode a `Date` as the `YYYY-MM-DD` of its UTC calendar day, as `<input type="date">` submits it and `Schema.DateFromString` decodes it back to UTC midnight. The time of day is dropped, and an invalid `Date` is omitted. A `Date` used to be dropped silently. A `Map`, a `Set` and any other object with no own enumerable fields still contribute no entries, which the TSDoc now says.

- Updated dependencies [39b96f2]
  - @thomasfosterau/effect-forms@0.3.0

## 0.2.0

### Minor Changes

- e11326d: **Breaking:** SvelteKit 2 is not supported. The optional `@sveltejs/kit` peer that the `/kit` entry needs is `^3.0.0`; SvelteKit 2 and the SvelteKit 3 prereleases are outside it (the unreleased `main` branch had declared `^2.20.0 || ^3.0.0-next.27 || ^3.0.0`). Upgrade to SvelteKit 3.0.0 or later before using `/kit`. The root entry does not import SvelteKit and is unaffected. The `/kit` entry is type-checked and tested against SvelteKit 3.0.0.
- 4c4a823: **Breaking:** require `effect@>=4.0.0-rc.118` (the peer was `^4.0.0-beta.102`), and `@thomasfosterau/effect-jsonapi@>=0.16.0` for the optional `/kit` types peer. The library is built and tested against `effect@4.0.0-rc.118` and `@thomasfosterau/effect-jsonapi@0.16.0`.

  - `constraintsFromSchema` recognises the rc.118 check id `effect/schema/isBetweenLength` (it was `effect/schema/isLengthBetween`), so `Schema.isBetweenLength(min, max)` still derives `minlength` / `maxlength`. On older Effect that id is no longer matched; a consumer that persists or compares these ids needs the new one.
  - **Default error message text changes for every user.** The default leaf formatter now renders through `SchemaIssue.makeFormatterDefault()` (an issue's `toString` prints `[object Object]` as of rc.118, so the old `String(issue)` could not be kept):
    - the `, got <value>` suffix is gone: `Expected string, got 1` becomes `Expected string`;
    - a failed schema check shows the check's own message instead of `Invalid data <value>`: `Invalid data "x"` becomes `Expected a value with a length of at least 3` (for `Schema.isMinLength(3)`);
    - custom `message` annotations on a schema or check now surface as the field's message.

    Anything that asserts on the old text (tests, snapshots, e2e selectors) needs updating, or pass your own `leafFormatter`.

  - **`LeafFormatter` migration.** A failed check now reaches a custom `LeafFormatter` as the wrapping `Filter` issue (the check's message lives on it), not as the bare leaf `InvalidValue`. Match on `issue._tag === "Filter"` (read `issue.issue` for the inner leaf), as well as on `InvalidValue`. The symptom of not migrating: a custom branch on `InvalidValue` silently stops matching for check failures and falls through to your default case.

- 8d08a4d: Add the `@thomasfosterau/effect-forms-svelte/kit` entry, the SvelteKit form-action glue the consuming applications each wrote by hand:

  - `formAction` / `runFormAction`: validate a submission against an effect-forms form, run a Promise or Effect command, and answer `redirect(303)`, `fail(status, { form })` or `fail(500, { message })`. A command failure's JSON:API error objects are routed onto fields by `source.pointer`. Options cover `classify`, `redact`, `unrecognised: "throw"`, and the idempotent client-id retry.
  - `fieldFromPointer`, `idempotentCreate`, and `CommandFailure` / `jsonapiFailure`. The error shape is `@thomasfosterau/effect-jsonapi`'s `Document.ErrorObject`, an optional, type-only peer.
  - `enhanceForm`: spreadable `<form>` props on `$app/forms` `enhance`. `$app/forms` stays a SvelteKit virtual.
  - `formStateOf` / `issuesFor` / `rootIssuesOf` / `valueOf`: total readers over `PageProps["form"]`.
  - `userFixableMessage` / `withFailureParams`, for action-only routes.

  `@sveltejs/kit` (`^3.0.0`) and `@thomasfosterau/effect-jsonapi` (`>=0.16.0`) are new optional peers. The root entry is unchanged.

### Patch Changes

- 6220180: Documentation fixes in the published READMEs and type declarations:

  - `FormBuilder.filterOutputToFormIssues` is now marked `@deprecated`; import `Issues.filterOutputToFormIssues` instead. It is the same function, and the re-export still works.
  - `Form.make` and `State.MakeFormStateOptions` document their contract and defaults in the hover; the svelte docs name the real `Form.make` rather than an internal alias, and `EntityForm` drops application-specific wording.
  - The package READMEs gain Install and License sections, list every export (the core's `Command`; the Svelte root entry's `defineEntityForm`, `applyActionResult` and listeners), fix broken links and names of exports that do not exist, and the `effect-forms-svelte` README now carries the `/kit` guide.

- ddb184a: Tested against effect 4.0.0; peer floor unchanged (`>=4.0.0-rc.118`).
- 92b0c17: `enhanceForm` (from `/kit`) now applies each non-validation action result once. It used to call SvelteKit's `update` and then `applyAction` on the same result, so a redirect navigated twice (running the destination's `load` functions twice), an error page was set twice, and a same-page result updated `form` and focus twice; on SvelteKit 3, a result from a cross-page action also navigated and then had its `form` and `status` rewritten on the destination page. It now relies on SvelteKit's default `update({ reset: false })` alone. The doc comments of `enhanceForm` and `applyActionResult` say so.
- ba2d25d: Document that `formAction`'s `locationFor` must return a same-origin path. SvelteKit 3's `redirect` rejects an external location unless it is passed `{ external }`, which `formAction` does not pass, so an absolute URL on another origin (or a protocol-relative `//host/...`) makes the action throw an `Error` after the command has run. `runFormAction` returns the location unchecked. The `formAction` example now imports from `#lib`, SvelteKit 3's replacement for `$lib`.
- Updated dependencies [6220180]
- Updated dependencies [ddb184a]
- Updated dependencies [4c4a823]
  - @thomasfosterau/effect-forms@0.2.0

## 0.1.0

### Minor Changes

- 4405359: Initial release.

  `@thomasfosterau/effect-forms` is a framework-neutral, Effect-native form toolkit: `Form.make` binds an Effect Schema to a form and returns a serialisable `FormState` carrying every field error, the posted values, and constraints derived from the schema's own checks. `FormBuilder` composes a form field by field, with synchronous and effectful whole-form refinements.

  `@thomasfosterau/effect-forms-svelte` adds the Svelte 5 (runes) bindings: a reactive form store, a progressive-enhancement `enhance` attachment, tainted tracking, lifecycle listeners, and client-side validation against the same schema the server uses.

  Both were extracted from `thomasfosterau/website`, where they had been in production use; their pre-extraction git history is preserved.

### Patch Changes

- Updated dependencies [4405359]
  - @thomasfosterau/effect-forms@0.1.0
