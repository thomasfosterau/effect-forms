---
"@thomasfosterau/effect-forms-svelte": patch
---

`enhanceForm` no longer leaves a stale `page.form` on screen after a validation failure. It used to apply a `fail(400, { form })` to the store and then return without calling SvelteKit's `update`, so `page.form` kept whatever an earlier submit had set: for example a `fail(500, { message })` from an unrecognised fault, which then showed beside the new field errors. It now always runs `update({ reset: false })` after applying the failure to the store, so SvelteKit replaces `page.form` with the current result.
