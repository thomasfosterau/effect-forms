---
"@thomasfosterau/effect-forms": minor
---

Remove unchecked type assertions from the core, so more of its published types are checked by the compiler instead of asserted.

Breaking changes:

- `FormBuilder.addField` no longer accepts a `FieldDef` / `ArrayFieldDef` object. Add a scalar field with `addField(key, schema)` and an array field with the new `addArrayField(key, itemSchema)` (replacing `addField(Field.makeArrayField(key, itemSchema))`).
- `FormBuilder.refinements` is now typed against the builder's decoded values and services (`ReadonlyArray<Refinement<DecodedFromFields<TFields>, R>>`) instead of erasing them to `unknown`. Builders are plain objects whose methods close over their fields and refinements; they no longer share a prototype.
- `Command.formInputFields` now returns `Readonly<Record<string, Command.FormInputField>>`, where the new `Command.FormInputField` is a schema with no decoding or encoding services (`Schema.Codec<unknown, unknown>`), and its `overrides` must be such schemas too. A `Schema.Struct` of the result decodes synchronously without a cast.

Behaviour changes:

- `Constraints.constraintsFromSchema` now decodes each built-in check's `representation.payload` with a schema before mapping it to an HTML attribute. A payload without the expected shape, or with a non-finite number (`NaN`, `±Infinity`), now derives no attribute instead of a malformed or meaningless one.
- `Errors.setError` and `Errors.replaceAt` build their result immutably instead of deep-cloning the input and mutating the copy. Branches they don't touch are shared with the input, and the input itself comes back when nothing changes, such as clearing a path that holds no messages. Message order and key order are unchanged.
- `Path.setAt` with a non-empty path on a root that is not an object or array (a string, say) now starts from an empty object instead of copying the boxed primitive's index properties. The same applies to `Form.make`'s merge of posted values over non-object `defaults` when a decode fails.
