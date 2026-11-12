# @thomasfosterau/effect-forms-svelte

Svelte 5 (runes) bindings for [`@thomasfosterau/effect-forms`](https://www.npmjs.com/package/@thomasfosterau/effect-forms): a reactive form store with progressive-enhancement submission, tainted tracking, lifecycle events, and optional client-side validation against the **same Effect Schema the server uses**. The `/kit` entry adds the SvelteKit form-action glue.

## Install

```sh
pnpm add @thomasfosterau/effect-forms-svelte @thomasfosterau/effect-forms @thomasfosterau/effect-ext effect svelte
# for the /kit entry
pnpm add @sveltejs/kit
```

`effect`, `svelte` and `@thomasfosterau/effect-ext` are required peers. `@sveltejs/kit` is an optional peer, required by `/kit`.

## Example

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

## Entries

| Entry                                     | Purpose                                                                                                  | Guides                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@thomasfosterau/effect-forms-svelte`     | Svelte 5 runes bindings: `createForm`, field handles, tainted tracking, client validation, `EntityForm`. | [Store](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/svelte/store.md), [Field handles](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/svelte/field-handles.md), [Validation](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/svelte/validation.md), [Modules](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/svelte/modules.md) |
| `@thomasfosterau/effect-forms-svelte/kit` | SvelteKit only: `formAction`, JSON:API failure routing, `enhanceForm`, page-state readers.               | [/kit](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/svelte/kit.md)                                                                                                                                                                                                                                                                                                             |

## Links

- [Documentation index](https://github.com/thomasfosterau/effect-forms/blob/trunk/docs/README.md)
- [Changelog](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/CHANGELOG.md)
- The per-export API reference is the doc comment on each export.

## License

[MIT](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/LICENSE)
