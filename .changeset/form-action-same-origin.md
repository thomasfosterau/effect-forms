---
"@thomasfosterau/effect-forms-svelte": patch
---

Document that `formAction`'s `locationFor` must return a same-origin path. SvelteKit 3's `redirect` rejects an external location unless it is passed `{ external }`, which `formAction` does not pass, so an absolute URL on another origin (or a protocol-relative `//host/...`) makes the action throw an `Error` after the command has run. `runFormAction` returns the location unchecked. The `formAction` example now imports from `#lib`, SvelteKit 3's replacement for `$lib`.
