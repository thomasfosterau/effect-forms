# @thomasfosterau/effect-forms-svelte

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
