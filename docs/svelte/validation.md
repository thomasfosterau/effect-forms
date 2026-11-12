# Validation modes, validators and error sources

**Validation modes** — the `mode` option (see [`Mode`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/src/Mode.ts)) drives when the form validates: `onSubmit` (default), `onBlur` (call `handleBlur` from an input's blur), or `onChange` (debounced). `onBlur` / `onChange` may `autoSubmit`, turning the form into a live-saving surface. `revalidate` (`"onChange"` default / `"onBlur"` / `"never"`) governs what happens _after_ a failed post in `onSubmit` mode: fixing a field re-validates just that field, clearing its error without a resubmit. Errors are computed for the whole form; gate their display per field with `visibleErrorsAt(focus)` (shown only once the field is tainted / touched, or after a submit).

**Per-field validators** — the `validators` option (or `setFieldValidators`) attaches TanStack-Form-style `{ onChange?, onBlur?, onChangeAsync?, onBlurAsync?, asyncDebounceMs? }` per field, each bound to the field's focus with the core's `Validate.on(focus, validators)`. `validators` is a function of the store's root focus, so the focuses are typed against the form's data, and a validator receives the field's value with the type its focus gives it. Sync validators return a `Schema.FilterOutput`; async ones are `Effect`s, run as a fiber per field — a new value interrupts the field's in-flight fiber before forking the next run, which is what gives the debounce + "latest wins" cancellation (no timer bookkeeping needed). Pass `layer` exactly when a validator (or a builder's `refineEffect` refinement) needs services on its `R` channel; without one, the store's `R` is `never`:

```ts
const form = createForm(
  { schema: Signup, defaults: { username: "" } },
  {
    validators: (o) => [
      Validate.on(o.key("username"), {
        onChangeAsync: (username) => Api.checkUsernameAvailable(username), // username: string
        asyncDebounceMs: 300,
      }),
    ],
    layer: ApiClient.layer,
  },
);
```

**Error sources** — a field's server-reported error (from the last submission) survives a client-side revalidation of some _other_ field; it clears once _that_ field's own value changes (or the server clears it on the next submit). `errors` is the merged view; `clientErrors` / `serverErrors` expose the two trees separately for a UI that wants to style them differently.

See [The store](store.md) and [Field handles](field-handles.md).
