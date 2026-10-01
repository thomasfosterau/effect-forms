/**
 * {@link FormActionResult} — the framework-neutral outcome of a form
 * submission handler.
 *
 * SvelteKit's `ActionResult` (`success` / `failure` / `redirect` / `error`) is
 * Svelte-specific; this is the same idea expressed as a plain tagged union so
 * a server handler in any framework can describe what happened, and a client
 * adapter can interpret it uniformly. A Svelte adapter maps this onto
 * SvelteKit's `ActionResult`; a fetch client reads the JSON shape directly.
 *
 * @copyright Thomas Foster
 * @module effect-forms/Result
 */

import type { FormState } from "./State.ts";

/** The submission validated and the command ran; carries the resulting state. */
export interface FormSuccess<A, Message> {
  readonly _tag: "Success";
  readonly status: number;
  readonly state: FormState<A, Message>;
}

/** The submission was rejected (validation or a user-fixable command failure). */
export interface FormFailure<A, Message> {
  readonly _tag: "Failure";
  readonly status: number;
  readonly state: FormState<A, Message>;
}

/** The handler asks the client to navigate elsewhere (post-success redirect). */
export interface FormRedirect {
  readonly _tag: "Redirect";
  readonly status: number;
  readonly location: string;
}

/** An unexpected (non-user-fixable) error: surface it, don't bind it to fields. */
export interface FormErrorResult {
  readonly _tag: "Error";
  readonly status: number;
  readonly message: string;
}

/** The outcome of a form submission. */
export type FormActionResult<A, Message = unknown> =
  | FormSuccess<A, Message>
  | FormFailure<A, Message>
  | FormRedirect
  | FormErrorResult;

/**
 * The data a server form action returns to the client on a non-redirect
 * outcome — the wire contract a client adapter applies back to its store. A
 * validation failure carries the {@link FormState} (`form`); an unexpected
 * error carries a root `message`.
 */
export interface FormActionData<A = unknown, Message = unknown> {
  /** The form state (nested errors + posted values) for the client to apply. */
  readonly form?: FormState<A, Message>;
  /** A root-level message for an unexpected (non-field) failure. */
  readonly message?: string;
}

/** Construct a {@link FormSuccess} (default status 200). */
export const success = <A, Message>(
  state: FormState<A, Message>,
  status = 200,
): FormActionResult<A, Message> => ({ _tag: "Success", status, state });

/** Construct a {@link FormFailure} (default status 400). */
export const failure = <A, Message>(
  state: FormState<A, Message>,
  status = 400,
): FormActionResult<A, Message> => ({ _tag: "Failure", status, state });

/** Construct a {@link FormRedirect} (default status 303). */
export const redirect = <A, Message>(
  location: string,
  status = 303,
): FormActionResult<A, Message> => ({ _tag: "Redirect", status, location });

/** Construct a {@link FormErrorResult} (default status 500). */
export const errorResult = <A, Message>(
  message: string,
  status = 500,
): FormActionResult<A, Message> => ({ _tag: "Error", status, message });
