---
"@thomasfosterau/effect-forms-svelte": patch
---

Drop redundant default type arguments in `FormStore.svelte.ts` (found by type-aware linting): `FieldHandle`'s constructor now declares its store as `FormStore<Schema.Top, object>`, the same type as before written without the default `Message = unknown`. No runtime change.
