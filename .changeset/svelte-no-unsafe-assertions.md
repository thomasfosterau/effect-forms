---
"@thomasfosterau/effect-forms-svelte": minor
---

Remove unchecked type assertions from the Svelte bindings, tightening a few published types.

- **Breaking:** `runFormAction` and `formAction` (`/kit`) now require a schema whose decoding needs no services: `S extends ServiceFreeSchema` (newly exported, `Schema.Top & { readonly DecodingServices: never }`). They decode the submission with nothing to provide, so a schema with a non-`never` `DecodingServices` (including one typed as plain `Schema.Top`) used to compile and then fail at runtime; it is now a type error.
- `formStateOf` (`/kit`) returns a new object holding only the carried state's `data` and `errors`, each kept only when it is a non-array object. A `form` value that is an array now reads as `undefined`. `issuesFor`, `rootIssuesOf` and `valueOf` return the same results as before for any input.
- `EntryBuilders.custom` / `rows` (`defineEntityForm`) are generic in the widget's `Props` (`component: Component<Props>`), so the component's own type is inferred rather than widened. Every component, including a `Component<never>`, is still accepted.
- `FieldHandle`'s constructor takes a `FieldHost` (newly exported): the path-addressed methods of a `FormStore` it calls. Any `FormStore` is a `FieldHost`.
- Spreading `FormStore.props` onto an element other than a `<form>` now throws a `TypeError` when the attachment runs. Before, the store attached anyway and failed later, at submit.
- The array mutators (`append`, `insertItem`, `replaceItem`, `removeItem`, `swap`, `move`) treat a non-array value at `path` as an empty array. Before, they spread whatever was there.
