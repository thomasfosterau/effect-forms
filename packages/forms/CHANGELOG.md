# @thomasfosterau/effect-forms

## 0.1.0

### Minor Changes

- 4405359: Initial release.

  `@thomasfosterau/effect-forms` is a framework-neutral, Effect-native form toolkit: `Form.make` binds an Effect Schema to a form and returns a serialisable `FormState` carrying every field error, the posted values, and constraints derived from the schema's own checks. `FormBuilder` composes a form field by field, with synchronous and effectful whole-form refinements.

  `@thomasfosterau/effect-forms-svelte` adds the Svelte 5 (runes) bindings: a reactive form store, a progressive-enhancement `enhance` attachment, tainted tracking, lifecycle listeners, and client-side validation against the same schema the server uses.

  Both were extracted from `thomasfosterau/website`, where they had been in production use; their pre-extraction git history is preserved.
