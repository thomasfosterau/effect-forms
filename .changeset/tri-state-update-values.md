---
"@thomasfosterau/effect-forms": minor
"@thomasfosterau/effect-forms-svelte": minor
---

Partial-update fields are a tagged `TriState` instead of value / `null` / `undefined` in the decoded API (#160). The wire is unchanged: the `Command` adapters still post the value, `null` or an absent key. Breaking:

- New required peer `@thomasfosterau/effect-ext` (`^0.1.0 || ^0.2.0`) of both packages. `TriState` comes from it: import it as `import * as TriState from "@thomasfosterau/effect-ext/TriState"` (the models `CarryForward`, `Clear`, `Assign<A>` and `TriState<A>`, the constructors `carryForward`, `clear` and `assign`, the fold `match`, and the field schemas `clearable` / `clearableNullOr`). effect-forms does not re-export it.
- `Coerce.emptyToUndefined` is renamed `Coerce.emptyToCarryForward` and returns `TriState<T>` (was `T | undefined`).
- `Coerce.emptyToNull` is renamed `Coerce.emptyToClear` and returns `TriState<T>` (was `T | null | undefined`). It no longer accepts `null`, and both coercers now take `T extends string`.
- `Coerce.trimToUndefined` is renamed `Coerce.trimToCarryForward`, and `Coerce.trimToNull` is renamed `Coerce.trimToClear`. Both return `TriState<string>`.
- `Coerce.numberFromField(raw?, options?)` returns `TriState<number>` (was `number | null | undefined`). `raw` and `options` are now optional, `nullable` defaults to `false`, and the overloads are gone.
- `Command.jsonRowsFromField` returns `TriState<ReadonlyArray<JsonRow>>`: `CarryForward` for a blank field, and otherwise `Assign` (`"[]"` assigns an empty list). It was `ReadonlyArray<JsonRow> | undefined`.
- `Command.AdaptOverrides` functions return a `TriState<unknown>` (was `unknown`): `assign(value)`, `clear` or `carryForward`. In `effect-forms-svelte`, `defineEntityForm`'s `adaptOverrides` changes the same way.
- `Command.createAdapter` / `updateAdapter` leave a carried-forward field out of the payload. Before, the key was present with the value `undefined`. The JSON is identical, but an in-process `toStrictEqual` or `"key" in payload` check sees the difference.

Both packages now declare `engines.node` `>=22.18.0` (was `^20.19.0 || >=22.12.0`), matching the new required peer `@thomasfosterau/effect-ext`. Node 20 and Node 22 before 22.18 are no longer supported.
