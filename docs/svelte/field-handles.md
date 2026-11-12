# Field handles

`form.field(path)` (modelled on TanStack Form's `FieldApi`) returns a typed, reactive [`FieldHandle`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/FormStore.svelte.ts) bundling everything one input needs, instead of wiring `bind:value` / `name` / `handleBlur` / `visibleErrorsAt` / `constraints` against the store separately:

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

`path` is checked against the form data's shape via `Path.FieldPath<A>` — a typo'd segment (`"authr.name"`) or a path into a field that doesn't exist is a compile error, and `field.value` is the leaf's actual type, not `unknown`.

`field.meta` exposes TanStack-style field state: `isBlurred` (lost focus at least once), `isTouched` (`isBlurred || isDirty`), `isDirty` (changed away from the default at some point — **persistent**, unlike `taintedAt` it does not clear on reverting to the default; only `reset()` clears it), and `isDefaultValue` (current value equals the default — flips back on revert). `isDirty` only tracks writes made through `field.value = …` / `setValue` / the array mutators (`append` / `removeItem` / `swap` / `move`) — a form that still binds `bind:value={form.data.x}` directly, bypassing `field()`, never marks that field dirty.

See [The store](store.md) for the rest of the store API and [Validation](validation.md) for modes and per-field validators.
