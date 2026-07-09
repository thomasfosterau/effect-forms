# @thomasfosterau/effect-forms-svelte

Svelte 5 (runes) bindings for
[`@thomasfosterau/effect-forms`](../effect-forms). A reactive form store with
progressive-enhancement submission, tainted tracking, lifecycle events, and
optional client-side validation against the **same Effect Schema the server
uses**.

This package depends only on `svelte` (a peer) and the framework-neutral core —
not SvelteKit — so it works in any Svelte 5 app.

## Usage

Server (`+page.server.ts` or any action) produces a `FormState` with the core's
`makeForm`, and returns it to the page. The component hydrates it:

```svelte
<script lang="ts">
  import { createForm } from "@thomasfosterau/effect-forms-svelte";
  import { Signup } from "$lib/schemas";

  let { data } = $props(); // data.form is the server FormState

  const form = createForm(data.form, {
    schema: Signup,        // enables client-side validation
    resetForm: true,
    taintedMessage: "You have unsaved changes.",
    onUpdated: ({ form }) => form.valid && toast("Saved"),
  });
</script>

<form method="post" use:form.enhance>
  <input name="name" bind:value={form.data.name} />
  {#each form.errorsAt(["name"]) as message}<small>{message}</small>{/each}

  <button disabled={form.submitting}>
    {form.delayed ? "Saving…" : "Save"}
  </button>
</form>
```

## The store

`createForm(source, options)` returns a [`FormStore`](src/FormStore.svelte.ts).
`source` is a server-produced `FormState`, a `{ schema, defaults }` seed, or a
[`FormBuilder`](../effect-forms/src/FormBuilder.ts) — the builder derives its
schema, blank defaults, and array-item defaults for you:

```ts
import { createForm } from "@thomasfosterau/effect-forms-svelte";
import { signup } from "$lib/forms"; // a FormBuilder

const form = createForm(signup, { mode: { validation: "onChange", debounce: 300 } });
```

**Reactive state** — `data` (mutable, bind inputs to it), `errors`, `message`,
`constraints`, `submitting`, `delayed`, `posted`, `valid`, `tainted`,
`isTainted`, and (against the last submission) `changedSinceSubmit` /
`hasChangedSinceSubmit`.

**Methods** — `enhance(node)` (the form action), `validate()` /
`validateField(path)` (client-side, needs `schema`), `errorsAt(path)` /
`taintedAt(path)`, `setValue(path, v)` / `valueAt(path)`, `handleBlur(path)` /
`setTouched(path)` / `isTouchedAt(path)`, `isDirtyAt(path)` /
`isDefaultValueAt(path)` (persistent per-field dirty tracking —
see [Field handles](#field-handles)), `shouldShowError(path)` /
`visibleErrorsAt(path)` (mode-aware display gating), `constraintAt(path)`,
`revertToLastSubmit()`, `reset()`, `capture()` / `restore()` (SvelteKit
snapshots), `toFormData()`.

**Field arrays** — `append(path, value?)`, `removeItem(path, i)`,
`swap(path, a, b)`, `move(path, from, to)` mutate the array at `path`
immutably. `append` derives a blank item from the field's schema when the form
was seeded from a `FormBuilder`.

## Field handles

`form.field(path)` (modelled on TanStack Form's `FieldApi`) returns a typed,
reactive [`FieldHandle`](src/FormStore.svelte.ts) bundling everything one input
needs, instead of wiring `bind:value` / `name` / `handleBlur` /
`visibleErrorsAt` / `constraints` against the store separately:

```svelte
<script lang="ts">
  const name = form.field("author.name"); // deep paths are type-checked
</script>

<input
  name={name.name}
  bind:value={name.value}
  onblur={name.handleBlur}
  {...name.constraints}
/>
{#each name.visibleErrors as message}<small>{message}</small>{/each}
```

`path` is checked against the form data's shape via `Path.FieldPath<A>` — a
typo'd segment (`"authr.name"`) or a path into a field that doesn't exist is a
compile error, and `field.value` is the leaf's actual type, not `unknown`. This
replaced the core's unconsumed `FieldRef` seam — see [the trade-off
decision](../../docs/decisions/typed-field-path-over-fieldref.md).

`field.meta` exposes TanStack-style field state: `isBlurred` (lost focus at
least once), `isTouched` (`isBlurred || isDirty`), `isDirty` (changed away from
the default at some point — **persistent**, unlike `taintedAt` it does not
clear on reverting to the default; only `reset()` clears it), and
`isDefaultValue` (current value equals the default — flips back on revert).
`isDirty` only tracks writes made through `field.value = …` / `setValue` /
the array mutators (`append` / `removeItem` / `swap` / `move`) — a form that
still binds `bind:value={form.data.x}` directly, bypassing `field()`, never
marks that field dirty.

**Validation modes** — the `mode` option (see
[`Mode`](../effect-forms/src/Mode.ts)) drives when the form validates:
`onSubmit` (default), `onBlur` (call `handleBlur` from an input's blur), or
`onChange` (debounced). `onBlur` / `onChange` may `autoSubmit`, turning the
form into a live-saving surface. Errors are computed for the whole form; gate
their display per field with `visibleErrorsAt(path)` (shown only once the field
is tainted / touched, or after a submit).

**Lifecycle options** — `onSubmit` (with `cancel()`), `onResult`, `onUpdate`,
`onUpdated`, `onError`, `onRedirect`, plus `resetForm`, `taintedMessage`,
`delayMs`, and a `submit` transport override (defaults to `fetch` to the form's
action, parsing a JSON [`FormActionResult`](../effect-forms/src/Result.ts) or a
bare `FormState`).

## Layout

The reactive store lives in `FormStore.svelte.ts` (rune-compiled, checked by
`svelte-check`). Its logic is delegated to pure, unit-tested modules:

| Module                                    | Purpose                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| [`Tainted`](src/Tainted.ts)               | Deep-diff the data to compute the tainted tree.                           |
| [`ClientValidate`](src/ClientValidate.ts) | Validate the form / one field against the schema.                         |
| [`EnhanceCore`](src/EnhanceCore.ts)       | Serialise data → form body, parse the response, compute the store update. |

## Development

```sh
vp exec svelte-check --tsconfig ./tsconfig.json   # typecheck (incl. runes)
vp test run tests                                 # unit tests (pure modules)
```
