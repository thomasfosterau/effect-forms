---
"@thomasfosterau/effect-forms-svelte": minor
---

`validateData` / `validateField` take `schema: Schema.Top` instead of a type parameter `S`, and `EntryBuilders.custom` / `.rows` take `props: () => Readonly<Record<string, unknown>>` instead of a type parameter `P`. Each parameter appeared only once in its signature, so inference is unchanged. A call that passed the type argument explicitly (`validateData<typeof Schema>(…)`, `custom<Props>(…)`) must drop it.
