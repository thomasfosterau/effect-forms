---
"@thomasfosterau/effect-forms": minor
"@thomasfosterau/effect-forms-svelte": minor
---

**Breaking:** require `effect@>=4.0.0-rc.118` (the peer was `^4.0.0-beta.102`), and `@thomasfosterau/effect-jsonapi@>=0.16.0` for the optional `/kit` types peer. The library is built and tested against `effect@4.0.0-rc.118` and `@thomasfosterau/effect-jsonapi@0.16.0`.

- `constraintsFromSchema` recognises the rc.118 check id `effect/schema/isBetweenLength` (it was `effect/schema/isLengthBetween`), so `Schema.isBetweenLength(min, max)` still derives `minlength` / `maxlength`. On older Effect that id is no longer matched; a consumer that persists or compares these ids needs the new one.
- **Default error message text changes for every user.** The default leaf formatter now renders through `SchemaIssue.makeFormatterDefault()` (an issue's `toString` prints `[object Object]` as of rc.118, so the old `String(issue)` could not be kept):
  - the `, got <value>` suffix is gone: `Expected string, got 1` becomes `Expected string`;
  - a failed schema check shows the check's own message instead of `Invalid data <value>`: `Invalid data "x"` becomes `Expected a value with a length of at least 3` (for `Schema.isMinLength(3)`);
  - custom `message` annotations on a schema or check now surface as the field's message.

  Anything that asserts on the old text (tests, snapshots, e2e selectors) needs updating, or pass your own `leafFormatter`.

- **`LeafFormatter` migration.** A failed check now reaches a custom `LeafFormatter` as the wrapping `Filter` issue (the check's message lives on it), not as the bare leaf `InvalidValue`. Match on `issue._tag === "Filter"` (read `issue.issue` for the inner leaf), as well as on `InvalidValue`. The symptom of not migrating: a custom branch on `InvalidValue` silently stops matching for check failures and falls through to your default case.
