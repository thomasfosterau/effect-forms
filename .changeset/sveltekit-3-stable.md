---
"@thomasfosterau/effect-forms-svelte": patch
---

The optional `@sveltejs/kit` peer range now names the stable SvelteKit 3 line explicitly: `^2.20.0 || ^3.0.0-next.27 || ^3.0.0`. SvelteKit 3.0.0 already satisfied the previous range, so nothing a consumer can install changes, and Kit 2 (`^2.20.0`) is still accepted. The `/kit` entry is now type-checked and tested against SvelteKit 3.0.0 instead of a 3.0.0 prerelease.
