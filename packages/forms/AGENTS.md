# packages/forms — `@thomasfosterau/effect-forms`

The framework-neutral core. Read the root [AGENTS.md](../../AGENTS.md) first.

## Boundary

- Imports `effect` and `@thomasfosterau/effect-ext` (both peers; effect-ext for its `/TriState` subpath) and nothing else at runtime: no framework, no DOM-only or Node-only API beyond the platform types every runtime has (`FormData`, `URLSearchParams`, `Request`, `Blob`). `vp pack` builds it with `platform: "neutral"`. fallow's `forms` zone may import no other zone.
- One entry, `src/index.ts`, re-exporting every module as a namespace (`export * as Form from "./Form.ts"`). A new module joins the barrel and the API table in `README.md`.

## Invariants

- **`validate` never fails.** `Form.make(...).validate(input)` returns `Effect<FormState, never, R>`: validation failures live in the returned state, collected with `errors: "all"`, and the posted values are preserved.
- **The error tree is plain JSON.** `FormErrors` (leaf `string[]`, a branch's own message under `_errors`) and `FormState` cross the SSR boundary unchanged; nothing in them may be a class instance, `Option` or `Map`.
- **The body parser never guesses types.** `FormData.formDataToObject` builds strings / arrays / objects from the `a.b` / `a[0]` / `a[]` notation; coercion is the schema's job (`Coerce`, `*FromString` leaves).
- **Tri-state update values.** `Coerce` and the `Command` coercions return a `TriState.TriState` (`Assign` / `Clear` / `CarryForward` — set / clear / carry forward), never a bare value / `null` / `undefined`. Only the wire keeps the nullable form: the `Command` adapters encode `Assign` as the value, `Clear` as `null` and `CarryForward` as an absent key, so the posted payload matches the command's `optional(NullOr(...))` (`TriState.clearableNullOr`) decode. `TriState` is `@thomasfosterau/effect-ext/TriState` (a required peer), never a local copy and never re-exported from the barrel: consumers import it from effect-ext. A gap in it is an effect-ext issue, not a fork here.
- **`@deprecated` aliases stay** until a major release removes them, naming the replacement as a backticked name.

## Docs

`docgen.json` runs every `@example` (`vp run docgen`); examples import `@thomasfosterau/effect-forms` by name and run against `dist/`.
