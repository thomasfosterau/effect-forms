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

`createForm(initialState, options)` returns a [`FormStore`](src/FormStore.svelte.ts):

**Reactive state** — `data` (mutable, bind inputs to it), `errors`, `message`,
`constraints`, `submitting`, `delayed`, `posted`, `valid`, `tainted`,
`isTainted`.

**Methods** — `enhance(node)` (the form action), `validate()` /
`validateField(path)` (client-side, needs `schema`), `errorsAt(path)` /
`taintedAt(path)`, `reset()`, `capture()` / `restore()` (SvelteKit snapshots),
`toFormData()`.

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
