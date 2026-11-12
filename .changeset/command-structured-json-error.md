---
"@thomasfosterau/effect-forms": minor
---

`Command`'s default coercion of a `structured` field now throws a tagged error (`_tag: "InvalidStructuredJsonError"`, message `Invalid <field> payload — expected JSON`) on malformed JSON, instead of the platform `SyntaxError` from `JSON.parse`. It matches `jsonRowsFromField`, which throws an `InvalidJsonRowsError`. Callers that matched `SyntaxError` must match the `_tag` or the message instead.
