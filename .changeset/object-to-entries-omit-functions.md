---
"@thomasfosterau/effect-forms-svelte": patch
---

`objectToEntries` (and so `objectToFormData` and `FormStore.toFormData()`) now omits `function` and `symbol` values, as `JSON.stringify` omits such object properties; in an array such an item is omitted too, and the remaining items keep their indices. It used to stringify them, so a callback left in form data was sent as its source code and a symbol as `"Symbol(…)"`. `string`, `number`, `boolean` and `bigint` values are still stringified, `null` still becomes `""`, and `undefined` is still skipped.
