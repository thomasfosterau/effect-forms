---
"@thomasfosterau/effect-forms": patch
"@thomasfosterau/effect-forms-svelte": patch
---

Internal cleanup to the Effect lint rules (`@mpsuesser/oxlint-plugin-effect`) with no API change; the emitted `.d.ts` is unchanged apart from doc comments. Observable edge differences:

- `Command`'s developer-facing errors (an unclassifiable field, invalid JSON rows) and `EntityForm`'s definition-time errors are now tagged error classes. They still extend `Error` with the same `message`; only `name` differs.
- Record helpers read own keys only, so an inherited or `__proto__` key in a posted object or schema field set no longer reaches a prototype.
- `FormData.formDataToObject` given a non-iterable object outside its `FormBodySource` type now parses as an empty body instead of throwing.

Also: runnable `@example`s for `Form.make`, `FormData.formDataToObject`, `Path.setAt` and `Constraints.constraintsFromSchema`; README links that resolve on npmjs.com; `homepage` points at the `trunk` branch.
