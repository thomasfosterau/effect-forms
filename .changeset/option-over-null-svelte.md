---
"@thomasfosterau/effect-forms-svelte": minor
---

Absent values are `Option`s instead of `null` / `undefined` in the store's callbacks and pure helpers (#149). Breaking:

- `Submission.submitter` (the `onSubmit` context) is `Option.Option<HTMLElement>` (was `HTMLElement | null`); pass `Option.getOrNull(submitter)` where a DOM API wants the element.
- `DataApplication.data` / `.rebaseTo` (returned by `computeDataApplication`) are `Option.Option<A>` (were `A | undefined`).
- `FormUpdate`'s members are `readonly x?: T` with no explicit `| undefined`; `resultToUpdate` omits `message` when the state carries none.
- `/kit`: `CommandFailure.detailOf(error, fallback?)` takes a defined `ErrorObject` (was `ErrorObject | undefined`).
- `/kit`: `FormActionOptions`' members are `readonly x?: T` with no explicit `| undefined`; `fieldFromPointer(pointer?)` takes an optional argument.
- `dispatchChange<A>(before: A, after: A, listeners?)` takes the listeners as an optional argument (was a required `FormListeners | undefined`).

`errorsAt`, `validateField` and the store follow the core's `Option`-returning `Errors.getError`, `Path.IndexMap` and `Mode.ParsedMode.debounce`; their own results are unchanged.
