---
"@thomasfosterau/effect-forms-svelte": patch
---

`FormStore` now runs a `FormBuilder`'s `refineEffect` refinements on the form data decoded through the builder's schema, as `Form.fromBuilder` does on the server, instead of on the raw encoded values. A field whose codec transforms (such as `Schema.FiniteFromString`) is therefore seen as the same decoded value in the browser and on the server. While the data doesn't decode, the refinements don't run (the field errors already report why), and errors from their previous run are cleared.
