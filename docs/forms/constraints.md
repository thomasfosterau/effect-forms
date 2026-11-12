# Constraints

Native input attributes (`required`, `minlength`/`maxlength`, `min`/`max`, `pattern`, `step`) derived from the schema AST by `Constraints.constraintsFromSchema`. See [Validation and state](validation.md) for where `constraints` appears in the form state.

- **Constraint derivation reads schema checks, not just optionality.** `constraintsFromSchema` walks each property's `.check()`s for the `meta` annotation Effect Schema's built-in checks carry (`isMinLength`, `isBetweenLength`, `isPattern`, `isGreaterThanOrEqualTo`, `isBetween`, `isMultipleOf`, `isInt`, …), unwraps `optional` / `NullOr` unions, and descends into struct and array-item shapes. A check with no recognised `meta` tag (a bare `Schema.filter` predicate) derives nothing — there's no attribute to guess at. Anything the walk can't (or shouldn't) infer goes through the `overrides` argument, which always wins on conflict.
