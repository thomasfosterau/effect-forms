---
"@thomasfosterau/effect-forms-svelte": minor
---

Redesign the store's types so they hold without `any` or unchecked assertions where a sound type exists.

**Breaking:**

- `FormStore<S, A, Message, R>` requires `S extends Validate.ServiceFreeSchema` and `A extends Path.FormValue` (`A` no longer defaults). Its constructor takes `StoreOptions` (new: `FormOptions` with a required `layer`).
- `createForm` is overloaded by source and by whether `layer` is given: without `layer`, `R` is `never` and the store uses `Layer.empty`; with it, `R` is the layer's. A builder store's data is `FormBuilder.Encoded<F>` with `defaults`, and `DraftData<F>` (new: one `Path.FormValue` per field) without. A bound schema must be a `FormSchema` (new; a builder's fields `FormFields`). `FormBuilderOptions` is keyed by struct fields.
- `FormOptions.builder` is replaced by `FormOptions.refinements` (new `FormRefinements<R>`, built by the new `refinementsOf(builder)`); `createForm` still wires it from a builder automatically.
- `FormOptions.validators` and `setFieldValidators` take `FieldValidators<Path.FormValue, R>`: a validator receives the field's runtime value and narrows it.
- `setValue`, `append`, `insertItem` and `replaceItem` take a `Path.FormValue`; `valueAt` returns one. `FieldHandle<V>` requires `V extends Path.FormValue`, and `field(path)` returns `FieldHandle<Extract<PathValue<A, P>, FormValue>>`.
- `validateData` / `validateField` take a `Validate.ServiceFreeSchema` and `Path.FormValue` data; `objectToEntries` / `objectToFormData` take a `Path.FormValue` (a function, symbol, `Map` or `Set` is now a type error).
- `changeEvents` / `dispatchChange` require `A extends Path.FormValue`; `CommandStructLike` (`defineEntityForm`) requires service-free fields.
- `applyActionResult<A>(form, result)` takes any `ServerStateTarget<A>` (new) and a `ServerActionResult<A>`; `enhanceForm` (`/kit`) takes an `EnhanceTarget<A>` (new). Neither needs `FormStore<any, any, any>`.
- `/kit`'s `ServiceFreeSchema` is now the core's `Validate.ServiceFreeSchema`. `runFormAction` / `formAction` still take a `Form.Form<S, Message>`, so a `Form.fromBuilder` form (whose blank is not `S["Type"]`) no longer fits them.
