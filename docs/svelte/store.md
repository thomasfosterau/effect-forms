# The store

Guide to `@thomasfosterau/effect-forms-svelte`. Related: [Field handles](field-handles.md), [Validation](validation.md), [Modules](modules.md), [/kit](kit.md).

The root entry depends only on `svelte` and the framework-neutral core, not SvelteKit, so it works in any Svelte 5 app. The [`/kit` entry](kit.md) (`@thomasfosterau/effect-forms-svelte/kit`) is the SvelteKit-only half: derived form actions, JSON:API error routing and `$app/forms` glue.

`effect`, `svelte` and `@thomasfosterau/effect-ext` are required peers. `@sveltejs/kit` is an optional peer, required by `/kit`; `@thomasfosterau/effect-jsonapi` is an optional, type-only peer of `/kit`.

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
  {#each form.errorsAt((o) => o.key("name")) as message}<small>{message}</small>{/each}

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

The bound schema must be service-free with `FormValue` decoded and encoded sides (`FormSchema`; a builder's fields are `FormFields`), since the browser validates synchronously and the store walks and posts the data as a `Path.FormValue` tree. A builder store's `data` is the builder's encoded type when you pass `defaults`, and `DraftData<F>` (one `FormValue` per field) when the blanks are schema-derived.

**Reactive state** — `data` (mutable, bind inputs to it), `root` (the focus every field focus is built from — see [Field handles](field-handles.md)), `errors` (the merged client + server `FormErrors` tree), `clientErrors` / `serverErrors` (per-source views), `formErrors` (the form-level messages), `message`, `constraints`, `submitting`, `delayed`, `isPosted`, `isValid`, `canSubmit`, `isValidating`, `isSubmitted`, `isSubmitSuccessful`, `submissionAttempts`, `tainted`, `isTainted`, and (against the last submission) `changedSinceSubmit` / `hasChangedSinceSubmit`.

**Methods** — every field-addressed method takes a focus (`form.root.key("name")`, or `(o) => o.key("name")`; see [Field handles](field-handles.md)): `enhance(node)` (the form action), `validate()` / `validateField(focus)` (client-side, needs `schema`; also runs a builder's `refineEffect` refinements, on the decoded values as the server does, once they decode), `field(focus)` (a typed field handle), `get(focus)` / `getOption(focus)` / `set(focus, value)` (typed reads and writes; a write where an optional focus finds nothing leaves the data unchanged, including a write below an absent optional branch, which used to create the missing containers), `errorsAt(focus)` / `errorsUnder(focus)` / `hasErrorsAt(focus)` / `taintedAt(focus)` / `isValidatingAt(focus)`, `handleBlur(focus)` / `setTouched(focus)` / `isTouchedAt(focus)`, `isDirtyAt(focus)` / `isDefaultValueAt(focus)` (persistent per-field dirty tracking), `setFieldValidators(focus, validators)` (register a field's validators dynamically), `shouldShowError(focus)` / `visibleErrorsAt(focus)` (mode-aware display gating), `constraintAt(focus)`, `revertToLastSubmit()`, `reset()`, `capture()` / `restore()` (SvelteKit snapshots), `setServerState(data, errors)` (apply a result received some other way), `toFormData()`.

**Field arrays** — `append(focus, value)`, `insertItem(focus, i, value)`, `replaceItem(focus, i, value)`, `removeItem(focus, i)`, `clearItems(focus)`, `swap(focus, a, b)`, `move(focus, from, to)` mutate the array `focus` names immutably, with `value` typed as its item. The focus must name a `ReadonlyArray` field (every schema-derived array type is one); a hand-written `FormState<A>` whose `A` declares a mutable `T[]` field is rejected, because Optic's types are invariant, so declare it `ReadonlyArray<T>` (`.at(i)` itself works on either). `append` and `insertItem` always take the item. `blankItemAt(focus)` derives a blank item by walking the bound schema's AST there (any nesting depth, e.g. `authors[0].emails`), falling back to the top-level `FormBuilder` field when no schema is bound. It is typed as the `Field.BlankValue` it is (a blank need not be a valid item), so `form.append(tags, form.blankItemAt(tags))` compiles exactly where the items admit a blank (a `DraftData` array of `FormValue`s); a typed row passes its own blank (`form.append(tags, "")`). Every index-shifting mutation (`insertItem` / `removeItem` / `swap` / `move` / `clearItems`) remaps per-index touched flags and errors so they keep following their row — `replaceItem` drops only the replaced index's own touched flag / errors.

**Lifecycle options** — `onSubmit` (with `cancel()`), `onResult`, `onUpdate`, `onUpdated`, `onError`, `onRedirect`, plus `resetForm`, `taintedMessage`, `delayMs`, and a `submit` transport override (defaults to a POST to the form's action through Effect's `HttpClient` on the platform `fetch`, run on a store-owned `ManagedRuntime` so a custom `layer` does not reroute it; a response body that is not JSON yields an `Error` result with the message `"Request failed"`; the body is parsed as a JSON [`FormActionResult`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/src/Result.ts) or a bare `FormState`).
