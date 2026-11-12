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

import type { Errors } from "@thomasfosterau/effect-forms";
import { flow } from "effect/Function";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";

/**
 * What the readers keep of a carried `State.FormState`: each posted value
 * rendered as the string a field shows, and the nested error tree. Built by
 * {@link formStateOf}, which parses the page's raw `form` prop into it.
 */
export interface ActionFormState {
  /** Posted values by field name, as rendered; a `null` / `undefined` value is absent. */
  readonly data?: Readonly<Record<string, string>>;
  /** The nested error tree `formAction` hands back. */
  readonly errors?: Errors.FormErrors;
}

/** The wire shape of a carried error tree: `Errors.FormErrors`, checked recursively. */
const FormErrorsTree: Schema.Codec<Errors.FormErrors> = Schema.Record(
  Schema.String,
  Schema.Union([
    Schema.Array(Schema.String),
    Schema.Undefined,
    Schema.suspend((): Schema.Codec<Errors.FormErrors> => FormErrorsTree),
  ]),
);

/** Whether an error-tree node is a leaf: a field's own messages. */
const isMessages = Schema.is(Schema.Array(Schema.String));

/** The carried error tree, or `None` when the member is not a well-formed one. */
const decodeErrors = Schema.decodeUnknownOption(FormErrorsTree);

/**
 * An action result that carries a form state: an object whose `form` member
 * is itself an object. Its `data` / `errors` members are parsed by
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
 * Only the two members the readers touch: `data` kept when it is an object,
 * `errors` when it is a well-formed error tree — anything else answers as
 * absent, exactly as reading through it would.
 *
 * Each posted value is rendered as a field shows it: a string as itself,
 * `null` / `undefined` as absent, and any other value (a checkbox's boolean,
 * a number) through `String(...)` rather than dropped — the point of
 * repopulation is that the user sees what they sent.
 */
const carriedState = ({ form: state }: typeof CarriedForm.Type): ActionFormState => {
  const carried: { -readonly [K in keyof ActionFormState]: ActionFormState[K] } = {};
  if (P.isReadonlyObject(state.data)) {
    carried.data = R.getSomes(
      R.map(state.data, (value) =>
        P.isNullish(value)
          ? Option.none()
          : // oxlint-disable-next-line typescript/no-base-to-string -- posted values are form scalars (a checkbox's boolean, a number); rendering them is the point
            Option.some(P.isString(value) ? value : String(value)),
      ),
    );
  }
  const errors = decodeErrors(state.errors);
  if (Option.isSome(errors)) carried.errors = errors.value;
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
  return isMessages(issues) ? issues : [];
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
export const valueOf = (state: ActionFormState | undefined, field: string, fallback = ""): string =>
  state?.data?.[field] ?? fallback;
