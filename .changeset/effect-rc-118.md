---
"@thomasfosterau/effect-forms": minor
"@thomasfosterau/effect-forms-svelte": minor
---

**Breaking:** require `effect@>=4.0.0-rc.118` (the peer was `^4.0.0-beta.102`), and `@thomasfosterau/effect-jsonapi@>=0.16.0` for the optional `/kit` types peer. The library is built and tested against `effect@4.0.0-rc.118` and `@thomasfosterau/effect-jsonapi@0.16.0`.

- `constraintsFromSchema` recognises the rc.118 check id `effect/schema/isBetweenLength` (it was `effect/schema/isLengthBetween`), so `Schema.isBetweenLength(min, max)` still derives `minlength` / `maxlength`. On older Effect that id is no longer matched; a consumer that persists or compares these ids needs the new one.
- The default leaf formatter renders issues through `SchemaIssue.makeFormatterDefault()`. An issue's `toString` prints `[object Object]` as of rc.118, which would have shown up as every field's error message. A failed schema check is now handed to a custom `LeafFormatter` as its wrapping `Filter` issue (it carries the check's message), not the bare leaf.
