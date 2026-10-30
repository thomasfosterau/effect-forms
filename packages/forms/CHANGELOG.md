# @thomasfosterau/effect-forms

## 0.3.2

### Patch Changes

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
