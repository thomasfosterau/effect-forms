---
"@thomasfosterau/effect-forms": patch
---

`Validate.validateValueSync` decodes through `SchemaParser.decodeUnknownResult`, Schema's own synchronous adapter, instead of running `validateValue` with `Effect.runSync`. Results are unchanged: a decode failure is still `isValid: false`, and a defect or async decoding work still throws. Its TSDoc now says so.
