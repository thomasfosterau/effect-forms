/**
 * Derive a SvelteKit page form action from an `@thomasfosterau/effect-forms`
 * form plus the command it submits to.
 *
 * {@link runFormAction} is the framework-neutral seam — validate the request
 * against the form's schema (every field error collected, posted values
 * retained), run the command on a valid submission, and describe the outcome
 * as a `Result.FormActionResult`. {@link formAction} maps that onto
 * SvelteKit's action protocol (`redirect()` / `fail()`), which the client
 * store applies back via `applyActionResult` / {@link enhanceForm}.
 *
 * A command is either a Promise-returning function (an API client call) or
 * an `Effect` with no requirements; a failure on either is classified by
 * {@link CommandFailure.jsonapiFailure} (or a caller's own classifier) and
 * routed onto the form's fields by each JSON:API error's `source.pointer`.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/kit/FormAction
 */

import { fail, redirect, type RequestEvent } from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type * as Schema from "effect/Schema";
import { type Form, Result, State } from "@thomasfosterau/effect-forms";
import {
  type Classify,
  type CommandFailure,
  DEFAULT_MESSAGE,
  detailOf,
  type ErrorObject,
  jsonapiFailure,
} from "./CommandFailure.ts";
import { fieldFromPointer } from "./Pointer.ts";

type FormState<A, Message = unknown> = State.FormState<A, Message>;
type FormActionResult<A, Message = unknown> = Result.FormActionResult<A, Message>;
type FormActionData<A = unknown, Message = unknown> = Result.FormActionData<A, Message>;

/**
 * A command: a Promise-returning function or one returning an `Effect` with
 * no requirements (provide them first, e.g. through a `ManagedRuntime`).
 */
export type Command<I, O> = (input: I) => Promise<O> | Effect.Effect<O, unknown>;

const toEffect = <O>(
  thunk: () => Promise<O> | Effect.Effect<O, unknown>,
): Effect.Effect<O, unknown> =>
  Effect.suspend(() => {
    const out = thunk();
    return Effect.isEffect(out)
      ? out
      : Effect.tryPromise({ try: () => out, catch: (cause) => cause });
  });

// ── Idempotent client-id create retry ──────────────────────────────────

const isConflict = (cause: unknown): boolean =>
  Predicate.isObjectOrArray(cause) &&
  (cause as { readonly status?: unknown }).status === 409 &&
  ((cause as { readonly _tag?: unknown })._tag === "JsonapiError" ||
    (cause as { readonly _tag?: unknown })._tag === "ErrorResponse");

const submittedId = (input: unknown): string | undefined => {
  const id = Predicate.isObjectOrArray(input) ? (input as { readonly id?: unknown }).id : undefined;
  return Predicate.isString(id) && id !== "" ? id : undefined;
};

const retryOwnConflict = <I, O>(
  create: Command<I, O>,
  fetchExisting: (id: string) => Promise<O> | Effect.Effect<O, unknown>,
  input: I,
): Effect.Effect<O, unknown> =>
  toEffect(() => create(input)).pipe(
    Effect.catch((cause) => {
      const id = submittedId(input);
      if (id === undefined || !isConflict(cause)) return Effect.fail(cause);
      // The re-fetch failing rethrows the ORIGINAL conflict, not its own error.
      return toEffect(() => fetchExisting(id)).pipe(Effect.mapError(() => cause));
    }),
  );

/**
 * Wrap a client-id create command so a 409 conflict on the caller's OWN
 * submitted `id` resolves as success instead of a form error — the
 * double-submit of a create whose id the client generated.
 *
 * On any 409 (a `JsonapiError` / `ErrorResponse`-tagged cause), re-fetches
 * `input.id` via `fetchExisting` and returns that. This is deliberately
 * unconditional on *why* the 409 fired: the re-fetch is the proof, not the
 * status. A 409 from an unrelated precondition never left a row at
 * `input.id`, so the re-fetch fails and the original conflict rethrows
 * unchanged. An input with no `id`, or any other failure, rethrows as is.
 *
 * `input.id` is read structurally rather than through a constraint on
 * `Input`: a constraint here would be used only contravariantly (as
 * `create`'s parameter), which makes TypeScript infer `Input` from the
 * constraint instead of from the command's own input type.
 */
export function idempotentCreate<Input, Output>(
  create: (input: Input) => Promise<Output>,
  fetchExisting: (id: string) => Promise<Output>,
): (input: Input) => Promise<Output> {
  return async (input) => {
    const exit = await Effect.runPromiseExit(retryOwnConflict(create, fetchExisting, input));
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  };
}

/**
 * Idempotent-retry wiring for a client-id create action: `clientId` gates the
 * wrap to commands whose input actually carries a client-generated `id` (an
 * entity form definition's own `clientId`, from `defineEntityForm`);
 * `fetchExisting` re-fetches the submitted id (see {@link idempotentCreate}).
 */
export interface IdempotentCreateOptions<O> {
  readonly clientId: boolean;
  readonly fetchExisting: (id: string) => Promise<O> | Effect.Effect<O, unknown>;
}

/** Options for {@link runFormAction} and {@link formAction}. */
export interface FormActionOptions<A, O> {
  /** Retry a client-id create's own 409 as success (see {@link IdempotentCreateOptions}). */
  readonly idempotent?: IdempotentCreateOptions<O> | undefined;
  /**
   * How a command failure is recognised. Defaults to
   * {@link CommandFailure.jsonapiFailure}; compose with it to add an
   * application's own failures.
   */
  readonly classify?: Classify | undefined;
  /**
   * Applied to every form state echoed back to the browser (an invalid
   * submission, a routed command failure) — e.g. blanking password fields
   * so a secret never rides a response body.
   */
  readonly redact?: ((state: FormState<A>) => FormState<A>) | undefined;
  /**
   * What happens to a command failure the classifier does not recognise:
   * `"error"` (the default) answers an `Error` result at 500 carrying the
   * cause's message; `"throw"` rethrows the cause, leaving it to SvelteKit's
   * `handleError`.
   */
  readonly unrecognised?: "error" | "throw" | undefined;
}

/** The field path an error object's pointer routes to, or `[]` (the root). */
const fieldPath = (error: ErrorObject): ReadonlyArray<string> =>
  Option.toArray(
    fieldFromPointer(
      error.source !== undefined && "pointer" in error.source ? error.source.pointer : undefined,
    ),
  );

/**
 * Route a recognised command failure onto the form state. A root issue lands
 * at the empty path, which the nested error tree exposes as `_errors` — the
 * form-level message surface (`form.errors._errors`).
 */
const routeFailure = <A>(state: FormState<A>, failure: CommandFailure): FormState<A> =>
  failure._tag === "Routed"
    ? failure.errors.reduce(
        (acc, error) => State.withError(acc, fieldPath(error), detailOf(error)),
        state,
      )
    : State.withError(state, [], failure.message);

/**
 * Validate `request` against `form`, then:
 *
 * - invalid → a `Failure` carrying the form state (nested errors + posted
 *   values), status 400, and the command never runs;
 * - valid → run the command (wrapped in the idempotent retry when
 *   `options.idempotent.clientId` is true); on success a `Redirect` (303) to
 *   `locationFor(output, input)`;
 * - a recognised command failure → a `Failure` at the failure's own status,
 *   each JSON:API error routed onto its field (or the root);
 * - an unrecognised one → an `Error` result at 500 (or a rethrow, per
 *   `options.unrecognised`).
 *
 * Posted values survive every failure, so the form re-renders what was typed.
 *
 * `locationFor` returns the redirect target as-is: `runFormAction` does not
 * check it. {@link formAction} hands it to SvelteKit's `redirect`, which
 * accepts only a same-origin location (see there).
 */
export async function runFormAction<S extends Schema.Top, O, Message = unknown>(
  form: Form.Form<S, Message>,
  request: Request,
  run: Command<S["Type"], O>,
  locationFor: (output: O, input: S["Type"]) => string,
  options: FormActionOptions<S["Type"], O> = {},
): Promise<FormActionResult<S["Type"]>> {
  const redact = options.redact ?? ((state: FormState<S["Type"]>) => state);
  // A posted form needs no decoding services at runtime; schemas projected
  // from elsewhere can still carry an unreduced `DecodingServices` type, so
  // only the requirements channel is narrowed here.
  const state = (await Effect.runPromise(
    form.validate(request) as Effect.Effect<FormState<S["Type"], Message>>,
  )) as FormState<S["Type"]>;
  if (!state.valid) return Result.failure(redact(state), 400);

  const idempotent = options.idempotent;
  const command =
    idempotent?.clientId === true
      ? retryOwnConflict(run, idempotent.fetchExisting, state.data)
      : toEffect(() => run(state.data));
  const exit = await Effect.runPromiseExit(command);
  if (Exit.isSuccess(exit)) return Result.redirect(locationFor(exit.value, state.data), 303);

  const cause = Cause.squash(exit.cause);
  const failure = (options.classify ?? jsonapiFailure)(cause);
  if (Option.isSome(failure)) {
    return Result.failure(redact(routeFailure(state, failure.value)), failure.value.status);
  }
  if (options.unrecognised === "throw") throw cause;
  return Result.errorResult(Predicate.isError(cause) ? cause.message : DEFAULT_MESSAGE, 500);
}

/**
 * A command for {@link formAction}: like {@link Command}, and also handed the
 * `RequestEvent` (for `locals`, `cookies`, `fetch`).
 */
export type ActionCommand<I, O> = (
  input: I,
  event: RequestEvent,
) => Promise<O> | Effect.Effect<O, unknown>;

/**
 * Derive a SvelteKit page form **action** from `form` plus its command. The
 * handler validates the submission, runs the command on success, and maps
 * the outcome onto SvelteKit's action protocol:
 *
 * - success → `redirect(303, locationFor(output, input))`;
 * - an invalid submission or a recognised command failure →
 *   `fail(status, { form })`, carrying the (redacted) state;
 * - an unrecognised failure → `fail(500, { message })` (or a rethrow).
 *
 * Wire it into `export const actions`; the client `createForm` store applies
 * the returned `form` via {@link enhanceForm} (or `applyActionResult`).
 *
 * `locationFor` must return a same-origin path, such as
 * `/organisations/${id}`. SvelteKit 3's `redirect` rejects an external
 * location unless it is passed `{ external }`, and `formAction` never passes
 * it, so a `locationFor` that returns an absolute URL on another origin (or a
 * protocol-relative `//host/...`) makes the action throw an `Error` instead of
 * redirecting, after the command has already run. To send the user off-site,
 * redirect to a same-origin route that performs the external redirect itself.
 *
 * @example
 * ```ts
 * // src/routes/organisations/create/+page.server.ts
 * import { formAction } from "@thomasfosterau/effect-forms-svelte/kit";
 * import { organisationForm } from "#lib/forms";
 * import { api } from "#lib/server/api";
 *
 * export const actions = {
 *   default: formAction(
 *     organisationForm,
 *     (input, { locals }) => api(locals).organisations.create(input),
 *     (id) => `/organisations/${id}`,
 *   ),
 * };
 * ```
 */
export function formAction<S extends Schema.Top, O, Message = unknown>(
  form: Form.Form<S, Message>,
  run: ActionCommand<S["Type"], O>,
  locationFor: (output: O, input: S["Type"]) => string,
  options?: FormActionOptions<S["Type"], O>,
) {
  return async (event: RequestEvent) => {
    const result = await runFormAction(
      form,
      event.request,
      (input) => run(input, event),
      locationFor,
      options,
    );
    const data = (d: FormActionData<S["Type"]>): FormActionData<S["Type"]> => d;
    switch (result._tag) {
      case "Redirect":
        return redirect(result.status, result.location);
      case "Failure":
        return fail(result.status, data({ form: result.state }));
      case "Error":
        return fail(result.status, data({ message: result.message }));
      case "Success":
        // `runFormAction` answers success with a redirect; a success result
        // carrying state is echoed back as-is.
        return data({ form: result.state });
    }
  };
}
