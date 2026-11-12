# Errors

The shape of the error tree and how errors are tracked per source. See [Validation and state](validation.md) for where the tree comes from.

- **Errors nest by field.** Leaf fields are `string[]`; nested objects / array indices nest; a branch's own (cross-field) message lives under `_errors`. The tree is plain JSON — it crosses the SSR boundary unchanged.
- **Errors are read by path.** `Errors.getError(errors, path)` answers the messages attached directly to a path (a leaf's list, or a branch's own `_errors`), and `Errors.issuesUnder(errors, path)` everything at or beneath it. A typed [`Focus`](modules.md) carries its field's path (`focus.path`), so typed code reads `Errors.getError(errors, Focus.root<Post>().key("author").key("name").path)`; the result is `readonly string[]` whatever the form's type, so no cast is ever needed. The Svelte store wraps this as `form.errorsAt(focus)` and `form.formErrors`.
- **Errors have a source.** `Errors.SourcedErrors` keeps a `client` tree (browser-side validation) parallel to a `server` tree (the last submission), merged for display by `mergeSourced`. `Errors.replaceAt` / `setSourceAt` / `clearSourceAt` update one path in one source without disturbing the rest — what a reactive store needs so a server-reported failure survives a client revalidation of some _other_ field, but clears once its own field changes.
