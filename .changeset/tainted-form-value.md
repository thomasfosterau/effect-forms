---
"@thomasfosterau/effect-forms-svelte": minor
---

**Breaking:** `deepEqual` and `computeTainted` take form data trees: their type parameter is constrained to `Path.FormValue` (from `@thomasfosterau/effect-forms`), which every store's data already is. Their results are unchanged.
