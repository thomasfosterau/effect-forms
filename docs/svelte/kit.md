# /kit

`@thomasfosterau/effect-forms-svelte/kit` holds the SvelteKit form-action glue: the derived page action, the JSON:API error routing, the idempotent create retry, the `$app/forms` enhance, the `PageProps["form"]` readers, and failure routing for action-only routes. The root entry (`@thomasfosterau/effect-forms-svelte`) stays framework-neutral Svelte; only `/kit` imports `@sveltejs/kit` and `$app/forms`.

| Export                                                     | What it does                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `formAction(form, run, locationFor, options?)`             | A page action: validate, run the command, then `redirect(303)`, `fail(status, { form })` or `fail(500, { message })` |
| `runFormAction(form, request, run, locationFor, options?)` | The same, as a framework-neutral `Result.FormActionResult`                                                           |
| `fieldFromPointer(pointer)`                                | `/data/attributes/<field>…` → `Option<field>`                                                                        |
| `idempotentCreate(create, fetchExisting)`                  | A 409 on the caller's own client id resolves as success                                                              |
| `CommandFailure.*`, `jsonapiFailure`                       | Classify a command failure into routed JSON:API errors or a root message                                             |
| `enhanceForm(store)`                                       | Spreadable `<form>` props on `$app/forms` `enhance`                                                                  |
| `formStateOf` / `issuesFor` / `rootIssuesOf` / `valueOf`   | Total readers over `PageProps["form"]`                                                                               |
| `userFixableMessage` / `withFailureParams`                 | Redirect-with-query failure routing for routes that have no page                                                     |

### Peers

- `@sveltejs/kit` (`^3.0.0`) is an **optional** peer of the package and **required** by `/kit`. SvelteKit 2 is not supported. The repository's tests run against the SvelteKit version pinned in its `pnpm-workspace.yaml`.
- `$app/forms` is a SvelteKit virtual module, not a dependency. It resolves because SvelteKit compiles this package (its `exports` carry the `svelte` condition), so `/kit` only works inside a SvelteKit build.
- `@thomasfosterau/effect-jsonapi` (`>=0.16.0`) is an **optional** peer used **for its types only**. `CommandFailure.ErrorObject` is `Document.ErrorObject.Type`. At runtime a failure is recognised by its `_tag`, so an application's own `JsonapiError` with the same shape is recognised too.

### Commands and failures

A command is `(input, event) => Promise<O> | Effect<O, E>`. An Effect command must have no requirements left. Provide them first, e.g. with the application's `ManagedRuntime`. `locationFor(output, input)` builds the redirect, and must return a same-origin path such as `/organisations/${id}`. SvelteKit 3's `redirect` rejects an external location unless it is given `{ external }`, which `formAction` never passes, so an absolute URL on another origin (or a protocol-relative `//host/...`) makes the action throw an `Error` after the command has run. To send the user off-site, redirect to a same-origin route that performs the external redirect itself. `runFormAction` returns the location unchecked.

`jsonapiFailure`, the default classifier, recognises:

- `{ _tag: "JsonapiError", status, errors }`: effect-jsonapi's `ServerErrors.JsonapiError`, or any error of the same shape. Each error object goes to the field its `source.pointer` names, or to the root (`form.errors._errors`), at the cause's own status.
- `{ _tag: "ErrorResponse", status, message, document }`: effect-jsonapi's client-side decoded error. The document's error objects are routed as above. With no document, the message goes to the root.
- An `Error` with a numeric `status`, such as a transport's 413: its message goes to the root.

Anything else is unexpected. By default it becomes `fail(500, { message })`. Pass `unrecognised: "throw"` to hand it to `handleError` instead. `classify` replaces the classifier; compose with `CommandFailure.jsonapiFailure` to extend it. `redact` runs on every state echoed back to the browser. `idempotent: { clientId, fetchExisting }` turns on the client-id retry.

### Worked example: a login action

A hand-written sign-in action typically hand-rolls validation, password blanking, 401 → generic message, a rethrow for anything else, and a same-origin redirect. With `/kit` it becomes:

```ts
// src/routes/login/+page.server.ts
import { Form, State } from "@thomasfosterau/effect-forms";
import { CommandFailure, formAction } from "@thomasfosterau/effect-forms-svelte/kit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { SessionCallError } from "#lib/server/api/binding";
import { safeRedirect } from "#lib/redirects";

const SignInFields = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
  redirectTo: Schema.optional(Schema.String),
});

const signInForm = Form.make(SignInFields, {
  defaults: { email: "", password: "", redirectTo: undefined },
  id: "sign-in",
});

type SignIn = typeof SignInFields.Type;

/** Blank the password before a state is echoed back to the browser. */
const blankPassword = (state: State.FormState<SignIn>): State.FormState<SignIn> => ({
  ...state,
  data: { ...state.data, password: "" },
});

/** A 401 → one generic whole-form message (never reveal whether the email exists). */
const classify: CommandFailure.Classify = (cause) =>
  cause instanceof SessionCallError && cause.status === 401
    ? Option.some(CommandFailure.message(401, "Invalid email or password"))
    : Option.none();

export const actions = {
  default: formAction(
    signInForm,
    (input, { locals }) =>
      locals.session.signIn({ email: input.email, password: input.password, rememberMe: true }),
    (_, input) => safeRedirect(input.redirectTo, "/"),
    { classify, redact: blankPassword, unrecognised: "throw" },
  ),
};
```

The runnable copy is [`packages/svelte/tests/kit/examples/login.page.server.ts`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/tests/kit/examples/login.page.server.ts). [`login.example.test.ts`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/tests/kit/login.example.test.ts) runs it against the real `@sveltejs/kit`, covering the success redirect, the off-site `redirectTo` guard, the 401 with a blanked password, and the rethrow.

The page renders server state without a client store:

```svelte
<script lang="ts">
  import { formStateOf, issuesFor, rootIssuesOf, valueOf } from "@thomasfosterau/effect-forms-svelte/kit";
  let { form } = $props();
  const state = $derived(formStateOf(form));
</script>

<form method="post">
  {#each rootIssuesOf(state) as message}<p role="alert">{message}</p>{/each}
  <input name="email" value={valueOf(state, "email")} />
  {#each issuesFor(state, "email") as message}<small>{message}</small>{/each}
  <input name="password" type="password" />
</form>
```

With a client store, spread `enhanceForm(form)` onto the `<form>` instead.
