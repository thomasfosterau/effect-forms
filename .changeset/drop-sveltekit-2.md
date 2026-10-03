---
"@thomasfosterau/effect-forms-svelte": minor
---

**Breaking:** SvelteKit 2 is not supported. The optional `@sveltejs/kit` peer that the `/kit` entry needs is `^3.0.0`; SvelteKit 2 and the SvelteKit 3 prereleases are outside it (the unreleased `main` branch had declared `^2.20.0 || ^3.0.0-next.27 || ^3.0.0`). Upgrade to SvelteKit 3.0.0 or later before using `/kit`. The root entry does not import SvelteKit and is unaffected. The `/kit` entry is type-checked and tested against SvelteKit 3.0.0.
