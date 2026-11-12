/**
 * Total readers over the form state a failed form action hands back on
 * `PageProps["form"]`.
 *
 * {@link formAction} answers an invalid submission with
 * `fail(status, { form: state })`, where `state` carries the posted values
 * and a nested error tree. A server-rendered page (no client store) needs
 * three things per field off a value SvelteKit types as `ActionData | null`:
 * what the user typed, what was wrong with it, and what was wrong with the
 * form as a whole.
 *
 * Every reader is deliberately **total**: it answers sensibly for a first
 * render (`form` is `null`), for a successful submission, and for a shape
 * that is not a form state at all. A create page that threw on
 * `form === null` would fail on the one render it does most.
 *
 * `undefined` rather than `Option` for "no submission": these are called from
 * Svelte templates, where `Option` has no rendering.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/kit/FormStateReaders
 */

import { flow } from "effect/Function";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";

/**
 * The subset of `State.FormState` the readers touch: the posted values and
 * the nested error tree. Structural rather than imported so a page can hand
 * in its raw `ActionData` without a cast.
 */
export interface ActionFormState {
  readonly data?: Readonly<Record<string, unknown>>;
  readonly errors?: Readonly<Record<string, unknown>>;
}

/**
 * An action result that carries a form state: an object whose `form` member
 * is itself an object. Its `data` / `errors` members are checked by
 * {@link carriedState}, so a malformed member reads as absent rather than
 * rejecting the whole state.
 */
const CarriedForm = Schema.Struct({
  form: Schema.Struct({
    data: Schema.optionalKey(Schema.Unknown),
    errors: Schema.optionalKey(Schema.Unknown),
  }),
});

/**
 * Only the two members the readers touch, each kept only when it is an
 * object — anything else answers as absent, exactly as reading through it
 * would.
 */
const carriedState = ({ form: state }: typeof CarriedForm.Type): ActionFormState => {
  const carried: { -readonly [K in keyof ActionFormState]: ActionFormState[K] } = {};
  if (P.isReadonlyObject(state.data)) carried.data = state.data;
  if (P.isReadonlyObject(state.errors)) carried.errors = state.errors;
  return carried;
};

/**
 * The carried form state, or `undefined` when there is none — a first
 * render, a successful submission (which redirects), or an action result
 * that carried a bare message instead. Decodes the page's `form` prop (typed
 * by SvelteKit as the route's `ActionData | null`) at this boundary.
 */
export const formStateOf = flow(
  Schema.decodeUnknownOption(CarriedForm),
  Option.map(carriedState),
  Option.getOrUndefined,
);

/** Messages attached to a named field, or none. */
export const issuesFor = (
  state: ActionFormState | undefined,
  field: string,
): ReadonlyArray<string> => {
  const issues = state?.errors?.[field];
  // SAFETY: the error tree `formAction` hands back holds the form's messages
  // at each field, and these readers serve pages whose messages are strings.
  return Array.isArray(issues) ? (issues as ReadonlyArray<string>) : [];
};

/**
 * Whole-form messages — the ones with no field to attach to (a 409, a
 * rejected command). {@link runFormAction} routes them to the error tree's
 * empty path, which the nested tree exposes as `_errors`.
 */
export const rootIssuesOf = (state: ActionFormState | undefined): ReadonlyArray<string> =>
  issuesFor(state, "_errors");

/**
 * What to render in a field: the value the user posted if this is a failed
 * submission, else `fallback` (the row's stored value on an edit form, or
 * the empty string on a create form). A posted blank stays blank.
 *
 * Non-string posted values (a checkbox's boolean, a number) render through
 * `String(...)` rather than being dropped: the point of repopulation is that
 * the user sees what they sent.
 */
export const valueOf = (
  state: ActionFormState | undefined,
  field: string,
  fallback = "",
): string => {
  const value = state?.data?.[field];
  if (value === undefined || value === null) return fallback;
  // oxlint-disable-next-line typescript/no-base-to-string -- posted values are form scalars (a checkbox's boolean, a number); rendering them is the point
  return P.isString(value) ? value : String(value);
};
