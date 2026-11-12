---
"@thomasfosterau/effect-forms": minor
"@thomasfosterau/effect-forms-svelte": minor
---

Partial-update fields are a tagged `TriState` instead of value / `null` / `undefined` in the decoded API (#160). The wire is unchanged: the `Command` adapters still post the value, `null` or an absent key. Breaking:

- New `TriState` module, mirroring `@thomasfosterau/effect-ext`'s `TriState` (same names and semantics, no new dependency): the models `CarryForward`, `Clear`, `Assign<A>` and `TriState<A>`; the constructors `carryForward`, `clear` and `assign`; the fold `match`; the field schemas `clearable` (`optionalKey(OptionFromNullOr(X))`) and `clearableNullOr` (`optional(NullOr(X))`); and the readers `read`, `readNullOr`, `suppliedValue` and `suppliedNullOr`.
- `Coerce.emptyToUndefined` is renamed `Coerce.emptyToCarryForward` and returns `TriState<T>` (was `T | undefined`).
- `Coerce.emptyToNull` is renamed `Coerce.emptyToClear` and returns `TriState<T>` (was `T | null | undefined`). It no longer accepts `null`, and both coercers now take `T extends string`.
- `Coerce.trimToUndefined` is renamed `Coerce.trimToCarryForward`, and `Coerce.trimToNull` is renamed `Coerce.trimToClear`. Both return `TriState<string>`.
- `Coerce.numberFromField(raw?, options?)` returns `TriState<number>` (was `number | null | undefined`). `raw` and `options` are now optional, `nullable` defaults to `false`, and the overloads are gone.
- `Command.jsonRowsFromField` returns `TriState<ReadonlyArray<JsonRow>>`: `CarryForward` for a blank field, and otherwise `Assign` (`"[]"` assigns an empty list). It was `ReadonlyArray<JsonRow> | undefined`.
- `Command.AdaptOverrides` functions return a `TriState<unknown>` (was `unknown`): `assign(value)`, `clear` or `carryForward`. In `effect-forms-svelte`, `defineEntityForm`'s `adaptOverrides` changes the same way.
- `Command.createAdapter` / `updateAdapter` leave a carried-forward field out of the payload. Before, the key was present with the value `undefined`. The JSON is identical, but an in-process `toStrictEqual` or `"key" in payload` check sees the difference.
