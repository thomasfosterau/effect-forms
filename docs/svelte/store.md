# The store

Guide to `@thomasfosterau/effect-forms-svelte`. Related: [Field handles](field-handles.md), [Validation](validation.md), [Modules](modules.md), [/kit](kit.md).

The root entry depends only on `svelte` and the framework-neutral core, not SvelteKit, so it works in any Svelte 5 app. The [`/kit` entry](kit.md) (`@thomasfosterau/effect-forms-svelte/kit`) is the SvelteKit-only half: derived form actions, JSON:API error routing and `$app/forms` glue.

`effect` and `svelte` are required peers. `@sveltejs/kit` is an optional peer, required by `/kit`; `@thomasfosterau/effect-jsonapi` is an optional, type-only peer of `/kit`.

## Usage

Server (`+page.server.ts` or any action) produces a `FormState` with the core's `Form.make(schema, …).validate(request)`, and returns it to the page. The component hydrates it:

```svelte
<script lang="ts">
  import { createForm } from "@thomasfosterau/effect-forms-svelte";
  import { Signup } from "#lib/schemas";

  let { data } = $props(); // data.form is the server FormState

  const form = createForm(data.form, {
    schema: Signup,        // enables client-side validation
    resetForm: true,
    taintedMessage: "You have unsaved changes.",
    onUpdated: ({ form }) => form.isValid && toast("Saved"),
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

`createForm(source, options)` returns a [`FormStore`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/FormStore.svelte.ts). `source` is a server-produced `FormState`, a `{ schema, defaults }` seed, or a [`FormBuilder`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/src/FormBuilder.ts) — the builder derives its schema, blank defaults, and array-item defaults for you:

```ts
import { createForm } from "@thomasfosterau/effect-forms-svelte";
import { signup } from "#lib/forms"; // a FormBuilder

const form = createForm(signup, { mode: { validation: "onChange", debounce: 300 } });
```

**Reactive state** — `data` (mutable, bind inputs to it), `errors` (merged client + server), `clientErrors` / `serverErrors` (per-source views), `message`, `constraints`, `submitting`, `delayed`, `isPosted`, `isValid`, `canSubmit`, `isValidating`, `isSubmitted`, `isSubmitSuccessful`, `submissionAttempts`, `tainted`, `isTainted`, and (against the last submission) `changedSinceSubmit` / `hasChangedSinceSubmit`.

**Methods** — `enhance(node)` (the form action), `validate()` / `validateField(path)` (client-side, needs `schema`; also runs a builder's `refineEffect` refinements, on the decoded values as the server does, once they decode), `errorsAt(path)` / `taintedAt(path)` / `isValidatingAt(path)`, `setValue(path, v)` / `valueAt(path)`, `handleBlur(path)` / `setTouched(path)` / `isTouchedAt(path)`, `isDirtyAt(path)` / `isDefaultValueAt(path)` (persistent per-field dirty tracking — see [Field handles](field-handles.md)), `setFieldValidators(path, validators)` (register a field's validators dynamically), `shouldShowError(path)` / `visibleErrorsAt(path)` (mode-aware display gating), `constraintAt(path)`, `revertToLastSubmit()`, `reset()`, `capture()` / `restore()` (SvelteKit snapshots), `setServerState(data, errors)` (apply a result received some other way), `toFormData()`.

**Field arrays** — `append(path, value?)`, `insertItem(path, i, value?)`, `replaceItem(path, i, value)`, `removeItem(path, i)`, `clearItems(path)`, `swap(path, a, b)`, `move(path, from, to)` mutate the array at `path` immutably. `append` / `insertItem` derive a blank item by walking the bound schema's AST at `path` (any nesting depth, e.g. `authors[0].emails`), falling back to the top-level `FormBuilder` field when no schema is bound. Every index-shifting mutation (`insertItem` / `removeItem` / `swap` / `move` / `clearItems`) remaps per-index touched flags and errors so they keep following their row — `replaceItem` drops only the replaced index's own touched flag / errors.

**Lifecycle options** — `onSubmit` (with `cancel()`), `onResult`, `onUpdate`, `onUpdated`, `onError`, `onRedirect`, plus `resetForm`, `taintedMessage`, `delayMs`, and a `submit` transport override (defaults to `fetch` to the form's action, parsing a JSON [`FormActionResult`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/src/Result.ts) or a bare `FormState`).
