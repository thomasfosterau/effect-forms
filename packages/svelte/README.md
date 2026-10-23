# @thomasfosterau/effect-forms-svelte

Svelte 5 (runes) bindings for [`@thomasfosterau/effect-forms`](https://www.npmjs.com/package/@thomasfosterau/effect-forms): a reactive form store with progressive-enhancement submission, tainted tracking, lifecycle events, and optional client-side validation against the **same Effect Schema the server uses**.

The root entry depends only on `svelte` and the framework-neutral core, not SvelteKit, so it works in any Svelte 5 app. The [`/kit` entry](#kit) (`@thomasfosterau/effect-forms-svelte/kit`) is the SvelteKit-only half: derived form actions, JSON:API error routing and `$app/forms` glue.

## Install

```sh
pnpm add @thomasfosterau/effect-forms-svelte @thomasfosterau/effect-forms effect svelte
# for the /kit entry
pnpm add @sveltejs/kit
```

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

## The store

`createForm(source, options)` returns a [`FormStore`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/FormStore.svelte.ts). `source` is a server-produced `FormState`, a `{ schema, defaults }` seed, or a [`FormBuilder`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/src/FormBuilder.ts) — the builder derives its schema, blank defaults, and array-item defaults for you:

```ts
import { createForm } from "@thomasfosterau/effect-forms-svelte";
import { signup } from "#lib/forms"; // a FormBuilder

const form = createForm(signup, { mode: { validation: "onChange", debounce: 300 } });
```

**Reactive state** — `data` (mutable, bind inputs to it), `errors` (merged client + server), `clientErrors` / `serverErrors` (per-source views), `message`, `constraints`, `submitting`, `delayed`, `posted`, `valid`, `canSubmit`, `isValidating`, `isSubmitted`, `isSubmitSuccessful`, `submissionAttempts`, `tainted`, `isTainted`, and (against the last submission) `changedSinceSubmit` / `hasChangedSinceSubmit`.

**Methods** — `enhance(node)` (the form action), `validate()` / `validateField(path)` (client-side, needs `schema`; also runs a builder's `refineEffect` refinements, on the decoded values as the server does, once they decode), `errorsAt(path)` / `taintedAt(path)` / `isValidatingAt(path)`, `setValue(path, v)` / `valueAt(path)`, `handleBlur(path)` / `setTouched(path)` / `isTouchedAt(path)`, `isDirtyAt(path)` / `isDefaultValueAt(path)` (persistent per-field dirty tracking — see [Field handles](#field-handles)), `setFieldValidators(path, validators)` (register a field's validators dynamically), `shouldShowError(path)` / `visibleErrorsAt(path)` (mode-aware display gating), `constraintAt(path)`, `revertToLastSubmit()`, `reset()`, `capture()` / `restore()` (SvelteKit snapshots), `setServerState(data, errors)` (apply a result received some other way), `toFormData()`.

**Field arrays** — `append(path, value?)`, `insertItem(path, i, value?)`, `replaceItem(path, i, value)`, `removeItem(path, i)`, `clearItems(path)`, `swap(path, a, b)`, `move(path, from, to)` mutate the array at `path` immutably. `append` / `insertItem` derive a blank item by walking the bound schema's AST at `path` (any nesting depth, e.g. `authors[0].emails`), falling back to the top-level `FormBuilder` field when no schema is bound. Every index-shifting mutation (`insertItem` / `removeItem` / `swap` / `move` / `clearItems`) remaps per-index touched flags and errors so they keep following their row — `replaceItem` drops only the replaced index's own touched flag / errors.

## Field handles

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

**Validation modes** — the `mode` option (see [`Mode`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/src/Mode.ts)) drives when the form validates: `onSubmit` (default), `onBlur` (call `handleBlur` from an input's blur), or `onChange` (debounced). `onBlur` / `onChange` may `autoSubmit`, turning the form into a live-saving surface. `revalidate` (`"onChange"` default / `"onBlur"` / `"never"`) governs what happens _after_ a failed post in `onSubmit` mode: fixing a field re-validates just that field, clearing its error without a resubmit. Errors are computed for the whole form; gate their display per field with `visibleErrorsAt(path)` (shown only once the field is tainted / touched, or after a submit).

**Per-field validators** — the `validators` option (or `setFieldValidators`) attaches TanStack-Form-style `{ onChange?, onBlur?, onChangeAsync?, onBlurAsync?, asyncDebounceMs? }` per field, keyed by `Path.toString` (e.g. `"author.name"`, `"tags[0]"`). Sync validators return a `Schema.FilterOutput`; async ones are `Effect`s, run as a fiber per field — a new value interrupts the field's in-flight fiber before forking the next run, which is what gives the debounce + "latest wins" cancellation (no timer bookkeeping needed). Pass `layer` when a validator (or a builder's `refineEffect` refinement) needs services on its `R` channel:

```ts
const form = createForm(
  { schema: Signup, defaults: { username: "" } },
  {
    validators: {
      username: {
        onChangeAsync: (value) => Api.checkUsernameAvailable(value as string),
        asyncDebounceMs: 300,
      },
    },
    layer: ApiClient.layer,
  },
);
```

**Error sources** — a field's server-reported error (from the last submission) survives a client-side revalidation of some _other_ field; it clears once _that_ field's own value changes (or the server clears it on the next submit). `errors` is the merged view; `clientErrors` / `serverErrors` expose the two trees separately for a UI that wants to style them differently.

**Lifecycle options** — `onSubmit` (with `cancel()`), `onResult`, `onUpdate`, `onUpdated`, `onError`, `onRedirect`, plus `resetForm`, `taintedMessage`, `delayMs`, and a `submit` transport override (defaults to `fetch` to the form's action, parsing a JSON [`FormActionResult`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/forms/src/Result.ts) or a bare `FormState`).

## API

Everything below is exported flat from the root entry (`@thomasfosterau/effect-forms-svelte`).

| Module                                                                                                              | Exports                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`FormStore`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/FormStore.svelte.ts)    | `createForm`, `FormStore`, `FieldHandle`, `FieldMeta`, `FormOptions`, `FormSeed` — the reactive store above.                                                                                    |
| [`EntityForm`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/EntityForm.ts)         | `defineEntityForm` — an ordered, key-checked field list over a core `Command.plan`, walked by one generic renderer component; its entry types (`ScalarEntry`, `SelectEntry`, `WidgetEntry`, …). |
| [`SvelteKit`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/SvelteKit.ts)           | `applyActionResult` — apply a SvelteKit `ActionResult` (`ServerActionResult`) to a store; returns whether it consumed a validation failure.                                                     |
| [`Listeners`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/Listeners.ts)           | `changeEvents` / `dispatchChange` and the `FormListeners` / `FieldListener` types — per-field and form-wide change listeners (linked fields).                                                   |
| [`Tainted`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/Tainted.ts)               | Deep-diff the data to compute the tainted tree.                                                                                                                                                 |
| [`ClientValidate`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/ClientValidate.ts) | `validateData` / `validateField` — validate the form, or one field, against the schema.                                                                                                         |
| [`EnhanceCore`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/src/EnhanceCore.ts)       | Serialise data → form body, parse the response, compute the store update.                                                                                                                       |

The reactive store (`FormStore.svelte.ts`, rune-compiled) delegates its logic to the pure, unit-tested modules. The store itself is type-checked (by `vp check` and by `svelte-check`); its submitter-aware submit path (`enhance` → the posted `FormData`) is unit-tested in [`FormStore.svelte.test.ts`](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/tests/FormStore.svelte.test.ts).

## /kit

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
  _password: Schema.String,
  redirectTo: Schema.optional(Schema.String),
});

const signInForm = Form.make(SignInFields, {
  defaults: { email: "", _password: "", redirectTo: undefined },
  id: "sign-in",
});

type SignIn = typeof SignInFields.Type;

/** Blank the password before a state is echoed back to the browser. */
const blankPassword = (state: State.FormState<SignIn>): State.FormState<SignIn> => ({
  ...state,
  data: { ...state.data, _password: "" },
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
      locals.session.signIn({ email: input.email, password: input._password, rememberMe: true }),
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
  <input name="_password" type="password" />
</form>
```

With a client store, spread `enhanceForm(form)` onto the `<form>` instead.

## License

[MIT](https://github.com/thomasfosterau/effect-forms/blob/trunk/packages/svelte/LICENSE)
