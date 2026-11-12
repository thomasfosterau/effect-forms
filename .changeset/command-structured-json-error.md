---
"@thomasfosterau/effect-forms": minor
---

`Command`'s default coercion of a `structured` field now throws a plain `Error` (`Invalid <field> payload — expected JSON`), like `jsonRowsFromField`, on malformed JSON, instead of the platform `SyntaxError` from `JSON.parse`. Callers that matched `SyntaxError` must match the message or catch broadly.
