/**
 * {@link FormState} — the serialisable snapshot of a form.
 *
 * This is the single object a
 * server produces (validate a submission, or seed an empty form) and hands to
 * the client to hydrate from. It is plain JSON so it survives the SSR → client
 * boundary, and {@link FormStateSchema} gives it an Effect Schema so it can be
 * decoded back on arrival.
 *
 * @copyright Thomas Foster
 * @module effect-forms/State
 */

import * as Schema from "effect/Schema";
import type * as Types from "effect/Types";
import type { InputConstraints } from "./Constraints.ts";
import { type FormErrors, hasErrors, noErrors, setError } from "./Errors.ts";
import type { FormPath } from "./Issues.ts";

/**
 * A form snapshot.
 *
 * - `id` distinguishes multiple forms on one page.
 * - `isValid` is whether the last validation succeeded.
 * - `isPosted` is whether this snapshot came from a submission (vs. a seeded
 *   empty form) — drives "show errors only after submit" UIs.
 * - `data` is the current values (typed output on success; posted values
 *   merged over defaults on failure, so the form re-renders what the user
 *   typed).
 * - `errors` is the nested {@link FormErrors} tree.
 * - `message` is an optional status payload (a free-form status payload).
 * - `constraints` is the optional derived {@link InputConstraints} tree.
 */
export interface FormState<A, Message = unknown> {
  readonly id: string;
  readonly isValid: boolean;
  readonly isPosted: boolean;
  readonly data: A;
  readonly errors: FormErrors;
  readonly message?: Message;
  readonly constraints?: InputConstraints;
}

/** Options for {@link make}. */
export interface MakeFormStateOptions<Message> {
  /** The form's id, distinguishing several forms on one page. Defaults to `"default"`. */
  readonly id?: string;
  /** Whether the state is valid. Defaults to `true` exactly when `errors` is empty. */
  readonly isValid?: boolean;
  /** Whether the state comes from a submission. Defaults to `false`. */
  readonly isPosted?: boolean;
  /** The nested error tree. Defaults to no errors. */
  readonly errors?: FormErrors;
  /** A status message to render with the form. Omitted by default. */
  readonly message?: Message;
  /** Native input constraints. Omitted by default. */
  readonly constraints?: InputConstraints;
}

/** Build a {@link FormState} from data plus overrides. `isValid` defaults to "no errors". */
export function make<A, Message = unknown>(
  data: A,
  options: MakeFormStateOptions<Message> = {},
): FormState<A, Message> {
  const errors = options.errors ?? noErrors;
  const state: Types.Mutable<FormState<A, Message>> = {
    id: options.id ?? "default",
    isValid: options.isValid ?? !hasErrors(errors),
    isPosted: options.isPosted ?? false,
    data,
    errors,
  };
  if (options.message !== undefined) state.message = options.message;
  if (options.constraints !== undefined) state.constraints = options.constraints;
  return state;
}

/** A {@link FormState} that passed validation: its `data` is the decoded value `A`. */
export interface ValidFormState<A, Message = unknown> extends FormState<A, Message> {
  readonly isValid: true;
}

/**
 * A {@link FormState} that did not pass validation (or was never submitted):
 * its `data` is whatever the form holds, `D` — the posted values merged over
 * the blank, or the blank itself.
 */
export interface InvalidFormState<D, Message = unknown> extends FormState<D, Message> {
  readonly isValid: false;
}

/**
 * What a validation answers: a {@link ValidFormState} carrying the decoded
 * `A`, or an {@link InvalidFormState} carrying `A` or the blank / posted
 * shape `Blank`. Narrow on `isValid` to reach the decoded value.
 */
export type ValidatedFormState<A, Blank = A, Message = unknown> =
  | ValidFormState<A, Message>
  | InvalidFormState<A | Blank, Message>;

/** {@link make} a {@link ValidFormState}: the decoded `data`, with no errors. */
export function valid<A, Message = unknown>(
  data: A,
  options: Omit<MakeFormStateOptions<Message>, "isValid" | "errors"> = {},
): ValidFormState<A, Message> {
  return { ...make<A, Message>(data, options), isValid: true };
}

/** {@link make} an {@link InvalidFormState}: the held `data`, carrying `errors`. */
export function invalid<D, Message = unknown>(
  data: D,
  options: Omit<MakeFormStateOptions<Message>, "isValid"> = {},
): InvalidFormState<D, Message> {
  return { ...make<D, Message>(data, options), isValid: false };
}

/** Return a new state carrying `message` (and not otherwise changed). */
export function withMessage<A, Message>(
  state: FormState<A, Message>,
  message: Message,
): FormState<A, Message> {
  return { ...state, message };
}

/**
 * Return a new state with `message` added at `path` and `isValid` forced to
 * `false` — for attaching a
 * server-side validation failure to a specific field after the schema passed.
 */
export function withError<A, Message>(
  state: FormState<A, Message>,
  path: FormPath,
  message: string,
): FormState<A, Message> {
  return { ...state, isValid: false, errors: setError(state.errors, path, message) };
}

/** Whether the state is valid. Equivalent to reading `state.isValid`, for use as a function (`Array.filter(states, State.isValid)`). */
export const isValid = <A, Message>(state: FormState<A, Message>): boolean => state.isValid;

/** Effect Schema describing the JSON shape of {@link FormState} for transport. */
export function FormStateSchema<DataSchema extends Schema.Top>(data: DataSchema) {
  return Schema.Struct({
    id: Schema.String,
    isValid: Schema.Boolean,
    isPosted: Schema.Boolean,
    data,
    errors: Schema.Record(Schema.String, Schema.Unknown),
    message: Schema.optional(Schema.Unknown),
    constraints: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  });
}
