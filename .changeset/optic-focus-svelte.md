---
"@thomasfosterau/effect-forms-svelte": minor
---

Every store method that addresses a field now takes a typed `Focus` (from `@thomasfosterau/effect-forms`) in place of a path. The field handle's value and the error reads need no type assertion.

A focus is `form.root.key("author").key("name")`, or a function of the root: `(o) => o.key("author").key("name")`. The store types this as `At<A, V>`, or `LensAt<A, V>` for a focus that always finds its value.

**Breaking:**

- **Renamed:** `setValue(path, v)` / `valueAt(path)` become `set(focus, v)` / `get(lensFocus)`. `set` checks `v` against the field's type. `getOption(focus)` is new.
- **Field handles:** `field("author.name")` becomes `field((o) => o.key("author").key("name"))`, which returns a `FieldHandle<A, V>` (the type was `FieldHandle<V>`). `field` takes a focus that always finds its value; for an array item, add a fallback: `field((o) => o.key("tags").at(i).orElse(""))`. `FieldHost` is now `FieldHost<A>`.
- **Focus-taking methods:** `errorsAt`, `visibleErrorsAt`, `shouldShowError`, `taintedAt`, `isValidatingAt`, `validateField`, `setTouched`, `isTouchedAt`, `isDirtyAt`, `isDefaultValueAt`, `constraintAt`, `handleBlur` and `setFieldValidators` take a focus.
- **Plain error trees:** `errors`, `clientErrors` and `serverErrors` are plain `FormErrors` (they were `TypedFormErrors<A>`).
  - Read one field with `errorsAt(focus)`; an array's or a branch's own messages with `errorsAt` on the array or branch.
  - Read the form-level `_errors` with the new `formErrors`.
  - Read a section with the new `errorsUnder(focus)` / `hasErrorsAt(focus)`.
- **Array mutators:** `append`, `insertItem`, `replaceItem`, `removeItem`, `clearItems`, `swap` and `move` take a focus on a readonly array, with the item typed.
  - `append` and `insertItem` require the item. The new `blankItemAt(focus)` returns the schema-derived blank as the `Field.BlankValue` it is, so `append(tags, form.blankItemAt(tags))` compiles only where the items admit a blank (`DraftData`).
- **Writes where nothing is found:** a write through an optional focus that finds nothing leaves the data unchanged. Before, a write below an absent optional branch created the missing containers.
- **Validators:** `FormOptions.validators` is a function of the root focus returning `Validate.on(focus, validators)` bindings: `validators: (o) => [Validate.on(o.key("username"), { onChange })]`. Each validator receives the field's typed value.
- **`/kit` readers:** `issuesFor(state, focus)` and `valueOf(state, focus, fallback?)` take a focus (any `Focus.HasPath`), and read nested fields and array items too. `ActionFormState.data` is keyed by flat field name (`author.name`, `tags[0]`).
- **`/kit` routing:** a JSON:API error's `source.pointer` routes to its whole attribute path (`/data/attributes/address/street` → `address.street`). It used to route to the top-level field. The new `pathFromPointer` exposes that mapping.
