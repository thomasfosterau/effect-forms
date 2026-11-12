---
"@thomasfosterau/effect-forms": minor
---

`FormBuilder.make` (and `FormBuilder.empty`) is now typed `FormBuilder<FormBuilder.NoFields, never>` instead of `FormBuilder<{}, never>`. `NoFields` is the new exported name for a builder's empty field record. It's structurally the same empty record, so `addField` chains infer exactly as before, but code that spells out `FormBuilder<{}, never>` must use `FormBuilder<FormBuilder.NoFields, never>`.
