# Field handles and focuses

Every store method that addresses one field takes a **focus**: a typed [`Focus`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/src/Focus.ts) from the core, built on Effect's `effect/Optic`. Build one from the store's `root` (`form.root.key("author").key("name")`), or pass a function of it (`(o) => o.key("author").key("name")`). The names follow `Optic`:

- `.key("name")` focuses a property. A misspelt key is a compile error. So is `.key` through an optional (`X | undefined`) value: step through that with `.defined()` first.
- `.at(i)` focuses an array item. Use it also for a record entry that may be absent. It is an _optional_ focus: out of range it reads as `None` and a write leaves the data unchanged.
- `.orElse(fallback)` turns an optional focus into one that always reads a value (`fallback` where it finds none). Use it on the focus of an input that needs something to render.

A focus also carries its path, so the input's `name` attribute (`author.name`, `tags[0]`), the error tree and the touched / dirty bookkeeping all use the same segments.

## `form.field(focus)`

`form.field(focus)` (modelled on TanStack Form's `FieldApi`) returns a typed, reactive [`FieldHandle`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/FormStore.svelte.ts). It bundles everything one input needs, so you don't wire `bind:value` / `name` / `handleBlur` / `visibleErrorsAt` / `constraints` against the store separately:

```svelte
<script lang="ts">
  const name = form.field((o) => o.key("author").key("name")); // FieldHandle<A, string>
  const tags = form.root.key("tags");
</script>

<input
  name={name.name}
  bind:value={name.value}
  onblur={name.handleBlur}
  {...name.constraints}
/>
{#each name.visibleErrors as message}<small>{message}</small>{/each}

{#each form.data.tags as _, i (i)}
  {@const tag = form.field(tags.at(i).orElse(""))}
  <input name={tag.name} bind:value={tag.value} onblur={tag.handleBlur} />
  {#each tag.visibleErrors as message}<small>{message}</small>{/each}
{/each}
```

`field.value` has the field's own type, read and written through the focus's optic, so no cast is involved. `field` takes a focus that always finds its value (a lens). For an array item, add a fallback with `.orElse(…)` as above.

`field.meta` exposes TanStack-style field state:

- `isBlurred`: lost focus at least once.
- `isTouched`: `isBlurred || isDirty`.
- `isDirty`: changed away from the default at some point. It is **persistent**: unlike `taintedAt`, it does not clear when the value reverts to the default. Only `reset()` clears it.
- `isDefaultValue`: the current value equals the default. Flips back on revert.

`isDirty` only tracks writes made through `field.value = …`, `form.set(focus, value)` or the array mutators. A form that binds `bind:value={form.data.x}` directly, bypassing them, never marks that field dirty.

## Errors

`form.errorsAt(focus)` returns the messages attached to that field, as `readonly string[]`:

| What                                             | Read                                                    |
| ------------------------------------------------ | ------------------------------------------------------- |
| A nested field                                   | `form.errorsAt((o) => o.key("author").key("name"))`     |
| An array item (`tags[0]`)                        | `form.errorsAt((o) => o.key("tags").at(0))`             |
| An array's own messages ("at least one tag")     | `form.errorsAt((o) => o.key("tags"))`                   |
| A branch's own (cross-field) messages            | `form.errorsAt((o) => o.key("author"))`                 |
| The form as a whole (`_errors`: a 409, a rejected command) | `form.formErrors`                             |
| Everything in a section                          | `form.errorsUnder((o) => o.key("author"))` / `form.hasErrorsAt(…)` |
| Gated by the validation mode                     | `form.visibleErrorsAt(focus)` / `field.visibleErrors`   |

`form.errors` (and `clientErrors` / `serverErrors`) is the plain `Errors.FormErrors` JSON tree, for code that walks it. A path that arrives at runtime (a server pointer, say) is read with the core's `Errors.getError(form.errors, path)`.

See [The store](store.md) for the rest of the store API and [Validation](validation.md) for modes and per-field validators.
