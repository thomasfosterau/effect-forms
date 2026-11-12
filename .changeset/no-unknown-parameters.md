---
"@thomasfosterau/effect-forms": patch
"@thomasfosterau/effect-forms-svelte": minor
---

Type the parameters that took `unknown`, parsing untyped input at its boundary.

**Breaking (`effect-forms-svelte`):** `parseActionResult(body, status)` now takes an `ActionResponse<A, Message>` (a tagged `FormActionResult` or a bare `FormState`) rather than `unknown`. Check a raw JSON body with the new `isActionResponse(body)` guard first; a body it rejects is yours to report (the store's default `fetch` submit still answers it with an `Error` result, "Unrecognised form response").

- `effect-forms-svelte`: `deepEqual`, `computeTainted`, `changeEvents` and `dispatchChange` take both snapshots as one type parameter `A` instead of two `unknown`s.
- `effect-forms-svelte/kit`: `formStateOf` decodes the page's `form` prop with a Schema; its behaviour is unchanged.
- `effect-forms`: `FormData.formDataToObject` treats a posted `File` as a leaf, like a string, so a later field whose path runs through the same name replaces it instead of setting a property on the `File`.
