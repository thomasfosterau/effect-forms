---
"@thomasfosterau/effect-forms-svelte": minor
---

Raise the optional `@thomasfosterau/effect-jsonapi` peer floor from `>=0.16.0` to `>=0.18.0`, the first release that exports the `Document.ErrorObject` type.

- **Breaking:** `CommandFailure.ErrorObject` (`/kit`) is now spelled `Document.ErrorObject` instead of `typeof Document.ErrorObject.Type`. It is the same type, but effect-jsonapi 0.16 and 0.17 don't export it, so `/kit`'s declarations no longer type-check against them.
