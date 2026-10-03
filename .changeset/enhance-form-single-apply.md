---
"@thomasfosterau/effect-forms-svelte": patch
---

`enhanceForm` (from `/kit`) now applies each non-validation action result once. It used to call SvelteKit's `update` and then `applyAction` on the same result, so a redirect navigated twice (running the destination's `load` functions twice), an error page was set twice, and a same-page result updated `form` and focus twice; on SvelteKit 3, a result from a cross-page action also navigated and then had its `form` and `status` rewritten on the destination page. It now relies on SvelteKit's default `update({ reset: false })` alone. The doc comments of `enhanceForm` and `applyActionResult` say so.
