---
"@thomasfosterau/effect-forms": minor
"@thomasfosterau/effect-forms-svelte": minor
---

Boolean state fields now carry an `is` prefix. `FormState.valid` / `posted` (and `FormStateSchema`, `State.make`'s options) become `isValid` / `isPosted`, `Validate`'s result union discriminates on `isValid` instead of `valid`, and in the Svelte bindings `FormStore.valid` / `posted`, `onUpdated`'s `form.valid` and `FormUpdate.valid` become `isValid` / `isPosted`. Wire shape: the JSON keys of a serialised `FormState` change (`valid` → `isValid`, `posted` → `isPosted`), so a form action's `fail(status, { form })` payload and any persisted state use the new keys, and `EnhanceCore` recognises a bare `FormState` response by `isValid`. `State.isValid(state)` keeps its name and now reads the renamed field.
