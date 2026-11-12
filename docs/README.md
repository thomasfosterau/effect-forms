# Documentation

Guides for the two packages in this repository. The per-export API reference is the doc comment on each export (shown in your editor, and generated for `@thomasfosterau/effect-forms` by `vp run docgen`). The package READMEs are the short npm landing pages; contributor docs are [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md).

## `@thomasfosterau/effect-forms`

| Guide                                       | What it covers                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Validation and state](forms/validation.md) | `Form.make`, `validate` / `empty`, coercion and update semantics.                    |
| [Building a form](forms/builder.md)         | `FormBuilder`: compose a form field by field, with sync and async whole-form rules.  |
| [Errors](forms/errors.md)                   | The nested error tree and per-source (client / server) tracking.                     |
| [Constraints](forms/constraints.md)         | Native input attributes derived from the schema's checks.                            |
| [Modules](forms/modules.md)                 | Every namespace the root entry exports, with its purpose.                            |

## `@thomasfosterau/effect-forms-svelte`

| Guide                                    | What it covers                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| [The store](svelte/store.md)             | `createForm`, reactive state, methods, field arrays, lifecycle options.            |
| [Field handles](svelte/field-handles.md) | `form.field(path)`: a typed, reactive handle bundling one input's wiring.          |
| [Validation](svelte/validation.md)       | Validation modes, per-field validators, client / server error sources.             |
| [Modules](svelte/modules.md)             | The modules behind the store (`EntityForm`, `Tainted`, `EnhanceCore`, ...).        |
| [/kit](svelte/kit.md)                    | The SvelteKit entry: `formAction`, failure routing, `enhanceForm`, readers.        |
