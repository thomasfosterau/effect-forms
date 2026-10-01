/**
 * @copyright Thomas Foster
 *
 * {@link FormState} — the serialisable snapshot of a form.
 *
 * This is the single object a
 * server produces (validate a submission, or seed an empty form) and hands to
 * the client to hydrate from. It is plain JSON so it survives the SSR → client
 * boundary, and {@link FormStateSchema} gives it an Effect Schema so it can be
 * decoded back on arrival.
 *
 * @module effect-forms/State
 */

import * as Schema from "effect/Schema";
import type { InputConstraints } from "./Constraints.ts";
import { type FormErrors, hasErrors, noErrors, setError } from "./Errors.ts";
import type { FormPath } from "./Issues.ts";

/**
 * A form snapshot.
 *
 * - `id` distinguishes multiple forms on one page.
 * - `valid` is whether the last validation succeeded.
 * - `posted` is whether this snapshot came from a submission (vs. a seeded
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
  readonly valid: boolean;
  readonly posted: boolean;
  readonly data: A;
  readonly errors: FormErrors;
  readonly message?: Message | undefined;
  readonly constraints?: InputConstraints | undefined;
}

/** Options for {@link make}. */
export interface MakeFormStateOptions<Message> {
  /** The form's id, distinguishing several forms on one page. Defaults to `"default"`. */
  readonly id?: string;
  /** Whether the state is valid. Defaults to `true` exactly when `errors` is empty. */
  readonly valid?: boolean;
  /** Whether the state comes from a submission. Defaults to `false`. */
  readonly posted?: boolean;
  /** The nested error tree. Defaults to no errors. */
  readonly errors?: FormErrors;
  /** A status message to render with the form. Omitted by default. */
  readonly message?: Message;
  /** Native input constraints. Omitted by default. */
  readonly constraints?: InputConstraints;
}

/** Build a {@link FormState} from data plus overrides. `valid` defaults to "no errors". */
export function make<A, Message = unknown>(
  data: A,
  options: MakeFormStateOptions<Message> = {},
): FormState<A, Message> {
  const errors = options.errors ?? noErrors;
  return {
    id: options.id ?? "default",
    valid: options.valid ?? !hasErrors(errors),
    posted: options.posted ?? false,
    data,
    errors,
    ...(options.message !== undefined ? { message: options.message } : {}),
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
  };
}

/** Return a new state carrying `message` (and not otherwise changed). */
export function withMessage<A, Message>(
  state: FormState<A, Message>,
  message: Message,
): FormState<A, Message> {
  return { ...state, message };
}

/**
 * Return a new state with `message` added at `path` and `valid` forced to
 * `false` — for attaching a
 * server-side validation failure to a specific field after the schema passed.
 */
export function withError<A, Message>(
  state: FormState<A, Message>,
  path: FormPath,
  message: string,
): FormState<A, Message> {
  return { ...state, valid: false, errors: setError(state.errors, path, message) };
}

/** Whether the state is valid. */
export const isValid = <A, Message>(state: FormState<A, Message>): boolean => state.valid;

/** Effect Schema describing the JSON shape of {@link FormState} for transport. */
export function FormStateSchema<DataSchema extends Schema.Top>(data: DataSchema) {
  return Schema.Struct({
    id: Schema.String,
    valid: Schema.Boolean,
    posted: Schema.Boolean,
    data,
    errors: Schema.Record(Schema.String, Schema.Unknown),
    message: Schema.optional(Schema.Unknown),
    constraints: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  });
}
