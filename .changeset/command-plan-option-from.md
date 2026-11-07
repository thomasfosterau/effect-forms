---
"@thomasfosterau/effect-forms": minor
---

`Command.plan` now classifies `Schema.OptionFrom*` fields (`OptionFromNullOr`, `OptionFromUndefinedOr`, `OptionFromNullishOr`, …) by their encoded side, so a `date`, `structured` or `enum` field keeps its kind when it moves from `optional(NullOr(X))` to `optional(OptionFromNullOr(X))`. Before, those fields threw `matches no known kind` at plan time. Fields that don't decode to an `Option` classify exactly as before.
