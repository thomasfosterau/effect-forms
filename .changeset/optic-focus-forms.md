---
"@thomasfosterau/effect-forms": minor
---

Add `Focus`: typed field focuses on Effect's `effect/Optic`. They replace the string-path types, so reading and writing form data at a field needs no type assertion.

**New:**

- `Focus.root<S>()`, then `.key(k)` / `.at(i)` / `.defined()` / `.orElse(fallback)`, builds a `Focus.Lens<S, A>` or a `Focus.Optional<S, A>`. Each pairs an `Optic` lens or optional (`get` / `getOption` / `replace` / `modify`, typed) with the field's `FormPath` (`focus.path`).
- `Focus.name(focus)` is the field's `name` attribute (`author.name`, `tags[0]`).
- `.at` reads `None` out of range or for an absent record key, and a write there leaves the data unchanged.
- `Validate.on(focus, validators)` binds a field's `FieldValidators` to its focus. The validators receive the field's typed value, and the result is a `Validate.BoundFieldValidators<S, R>` (resolved per trigger as a `Validate.FieldRun<R>`).
- `Errors.issuesUnder(errors, path)` returns every message at or beneath a path, with paths relative to it.

**Breaking:**

- `Path.FieldPath` and `Path.PathValue` are removed. Use a `Focus`.
- `Errors.TypedFormErrors` is removed. `FormErrors` is the only error-tree type. Read a field's messages with `Errors.getError(errors, focus.path)`, which returns `readonly string[]` for every form type.
- `Path.setAt` is untyped: `setAt(obj: FormValue, path, value: FormValue): FormValue`. It no longer claims to return the input's type. A typed write is `focus.replace(value, data)`.
