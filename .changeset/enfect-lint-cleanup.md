---
"@thomasfosterau/effect-forms": patch
"@thomasfosterau/effect-forms-svelte": patch
---

Internal cleanup for the stricter lint set (`@enfect/oxlint` plus Oxlint's `suspicious` / `perf` categories) with no behaviour change: module-level helpers are hoisted out of the functions that used them, shadowed names are renamed, and the parameter of `CommandFailure.message` is now named `text` in the emitted `.d.ts` (positional, so callers are unaffected).
