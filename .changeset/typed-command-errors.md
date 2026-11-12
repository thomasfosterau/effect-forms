---
"@thomasfosterau/effect-forms-svelte": minor
"@thomasfosterau/effect-forms": minor
---

Type the command error channel of the `/kit` form actions, and the unreadable-body defect of `Form.validate`, instead of carrying `unknown`.

- **Breaking:** a Promise command's rejection, or a command's synchronous throw, now reaches the classifier as a `CommandFailure.CommandRejected` (a `Schema.TaggedError`) whose `cause` is the original value. A custom classifier that matched the raw rejection must look at `error.cause` instead, e.g. `error instanceof CommandFailure.CommandRejected && error.cause instanceof SessionCallError`. `jsonapiFailure` unwraps `CommandRejected` itself, so the default classification is unchanged. An `Effect` command's typed failure still reaches the classifier as itself.
- **Breaking:** `Command`, `ActionCommand` and `FormActionOptions` take the command's error type `E` (default `never`), `IdempotentCreateOptions` and `FormActionOptions` the re-fetch's error type `F`; `runFormAction` and `formAction` infer both. `CommandFailure.Classify` takes the error type it is handed (`Classify<E = unknown>`), and `FormActionOptions.classify` is a `Classify<E | CommandRejected>`. An existing `CommandFailure.Classify` (over `unknown`) is still accepted.
- **Breaking:** a defect in an `Effect` command (`Effect.die`) is no longer handed to the classifier: it is unrecognised, so it answers the 500 `Error` result, or under `unrecognised: "throw"` rethrows the defect as-is.
- A synchronous throw from a command is now classified like a rejection (before, it was a defect).
- The Promise boundaries (`idempotentCreate`, and `runFormAction` / `formAction` under `unrecognised: "throw"`) still reject with the original value, never the `CommandRejected` wrapper.
- **Breaking (`effect-forms`):** `Form.validate` on a `Request` whose body can't be read as a form now dies with a `Form.UnreadableBody` (newly exported, a `Schema.TaggedError`) whose `cause` is the platform's rejection, instead of the raw rejection. `validate`'s error channel stays `never`.
