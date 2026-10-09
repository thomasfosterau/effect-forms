---
"@thomasfosterau/effect-forms-svelte": patch
---

`objectToFormData` (and so `FormStore.toFormData()`) now keeps `File` and `Blob` values: each is appended as a file, and a `File` keeps its name, so a file held in form data reaches the server and `FormData.formDataToObject` passes it through unchanged. It used to drop them silently. `objectToEntries` still returns string entries only, so it omits a `File` or `Blob` (an array item leaves a gap, and the other items keep their indices).

`objectToEntries`, `objectToFormData` and `FormStore.toFormData()` now encode a `Date` as the `YYYY-MM-DD` of its UTC calendar day, as `<input type="date">` submits it and `Schema.DateFromString` decodes it back to UTC midnight. The time of day is dropped, and an invalid `Date` is omitted. A `Date` used to be dropped silently. A `Map`, a `Set` and any other object with no own enumerable fields still contribute no entries, which the TSDoc now says.
