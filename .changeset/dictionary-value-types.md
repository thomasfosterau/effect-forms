---
"@thomasfosterau/effect-forms": minor
"@thomasfosterau/effect-forms-svelte": minor
---

Replace open `Record<string, unknown>` dictionaries in the published types with owner- or schema-derived value types.

`@thomasfosterau/effect-forms`:

- `FormData.formDataToObject` / `requestToObject` return the new exported `FormData.FormBodyRecord` (values are `FormData.FormBodyValue`: a posted string or `File`, a nested record, or an array).
- `Form.FormInput` is now generic, `FormInput<Encoded>`: a plain-object submission to `validate` is typed as the schema's `Encoded` type, and `Form.parse` returns `FormBodyRecord | S["Encoded"]`. Parse an external payload with the schema before handing it in.
- `Field.defaultEncodedValues` returns the new exported `Field.BlankStruct`, and `Field.defaultValue` returns `Field.BlankValue`.
- `Command.createAdapter` / `updateAdapter` return the new `Command.CommandPayload`, a record of `Command.CommandPayloadValue` (a JSON value, a `JsonRow` list, or `undefined` to skip). An `AdaptOverrides` function must now return a `CommandPayloadValue`.

`@thomasfosterau/effect-forms-svelte`:

- `FormStore.props` returns the new `FormProps` (`method`, optional `action`, and the attachment under a symbol key).
- `EntityFormDefinition.adaptCreate` / `adaptUpdate` return `Command.CommandPayload`.
- `WidgetEntry` is generic over the widget's props, and the `custom` / `rows` builders type a `props()` thunk as `WidgetOwnProps<Props>`: the component's own props, partial, minus the renderer-owned `WidgetBridgeKey`s (`name`, `value`, `onChange`, `errors`).
- `ServerActionResult.data` is `unknown`: `applyActionResult` checks it before reading it.
- `/kit`: `ActionFormState.data` holds each posted value as rendered (`Readonly<Record<string, string>>`, a `null` / `undefined` value absent), and `ActionFormState.errors` is an `Errors.FormErrors` tree that `formStateOf` checks; a malformed tree reads as absent.
