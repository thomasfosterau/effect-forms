---
"@thomasfosterau/effect-forms": minor
---

Absent values are `Option`s instead of `null` / `undefined` across the core's readers and internal state (#149). Breaking:

- `Errors.getError` returns `Option.Option<readonly string[]>` (was `readonly string[] | undefined`).
- `Field.schemaAt` returns `Option.Option<SchemaAST.AST>` (was `SchemaAST.AST | undefined`).
- `Path.IndexMap` is `(index: number) => Option.Option<number>` (was `number | null`), so a hand-written index map returns `Option.none()` to drop an index; `removeAt` / `insertAt` / `swapAt` / `moveAt` / `replaceAt` / `clearAll` build the new shape.
- `Path.remapIndex` returns `Option.Option<FormPath>` (was `FormPath | null`).
- `Mode.ParsedMode.debounce` is `Option.Option<number>` (was `number | null`).
- `Validate.resolveFieldTrigger(trigger, validators?)` takes the trigger first and the validators as an optional second argument (was `(validators | undefined, trigger)`); `Validate.ResolvedFieldTrigger.sync` / `.async` are `Option`s (were `| undefined`).
- `Form.FormInput` no longer includes `null` / `undefined`; `Form.validate(input?)` takes an optional argument instead, so `validate(null)` becomes `validate()`.
- `State.FormState.message` / `.constraints` and `State.MakeFormStateOptions` are `readonly x?: T` with no explicit `| undefined`: under `exactOptionalPropertyTypes`, omit the key rather than setting it to `undefined`.
- `Command.jsonRowsFromField` returns `ReadonlyArray<Command.JsonRow> | undefined` (was a mutable array of an inline row type); `JsonRow` and `FormInputValue` are new exported types, and `FormInputRecord` is now derived from a `Schema.Record` (same shape). `Command.AdaptOverrides` functions take `raw: FormInputValue` (`string | undefined`, unchanged).
- `Coerce.emptyToUndefined`, `trimToUndefined`, `trimToNull` and `booleanFromCheckbox` take their argument as optional (`value?: …`); every existing call still compiles.
