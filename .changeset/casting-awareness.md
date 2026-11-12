---
"@thomasfosterau/effect-forms": patch
"@thomasfosterau/effect-forms-svelte": patch
---

Drop three type assertions in favour of checked code. `jsonapiFailure` (`/kit`) now checks a `JsonapiError`- or `ErrorResponse`-tagged cause's `errors` against the JSON:API error-object schema before routing them: a `JsonapiError` with malformed `errors` is no longer recognised (`None`), and an `ErrorResponse` whose document's errors are malformed falls back to its message. `Form.make(...).validate` keeps a non-object blank as the failed state's `data` instead of a copy of the posted fields typed as the schema's value.
