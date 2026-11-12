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

import { Errors, type Focus, type Issues, Path } from "@thomasfosterau/effect-forms";
import * as Arr from "effect/Array";
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
  /**
   * Posted values by field name in flat notation (`title`, `author.name`,
   * `tags[0]`), as rendered; a `null` / `undefined` value is absent.
   */
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
 * The wire shape of carried posted values: a `Path.FormValue` tree (form
 * scalars, a `Date` or `Blob` leaf, arrays and records of trees), checked
 * recursively.
 */
const PostedTree: Schema.Codec<Path.FormValue> = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.BigInt,
  Schema.Null,
  Schema.Undefined,
  Schema.Date,
  Schema.instanceOf(Blob),
  Schema.Array(Schema.suspend((): Schema.Codec<Path.FormValue> => PostedTree)),
  Schema.Record(
    Schema.String,
    Schema.suspend((): Schema.Codec<Path.FormValue> => PostedTree),
  ),
]);

/** The carried posted values, or `None` when the member is not a well-formed tree. */
const decodePosted = Schema.decodeUnknownOption(PostedTree);

/** Whether a posted node is an array of children. */
const isList = (value: Path.FormValue): value is ReadonlyArray<Path.FormValue> =>
  Arr.isArray(value);

/** Whether a posted node is a record of children (a `Date` or `Blob` leaf is an object, but not one). */
const isRecord = (value: Path.FormValue): value is { readonly [key: string]: Path.FormValue } =>
  P.isReadonlyObject(value) && !isList(value) && !P.isDate(value) && !(value instanceof Blob);

/**
 * Every leaf of a posted value tree, keyed by its flat field name under
 * `prefix`: a nested object or array contributes one entry per leaf
 * (`author.name`, `tags[0]`), and `null` / `undefined` contributes none.
 */
const postedLeaves = (value: Path.FormValue, prefix: Issues.FormPath): Array<[string, string]> => {
  if (P.isNullish(value)) return [];
  if (isList(value)) {
    return Arr.flatMap(value, (item, i) => postedLeaves(item, [...prefix, i]));
  }
  if (isRecord(value)) {
    return Arr.flatMap(R.toEntries(value), ([key, item]) => postedLeaves(item, [...prefix, key]));
  }
  // oxlint-disable-next-line typescript/no-base-to-string -- posted values are form scalars (a checkbox's boolean, a number); rendering them is the point
  return [[Path.toString(prefix), P.isString(value) ? value : String(value)]];
};

/**
 * Only the two members the readers touch: `data` kept when it is an object,
 * `errors` when it is a well-formed error tree — anything else answers as
 * absent, exactly as reading through it would.
 *
 * Each posted value is rendered as a field shows it, under its flat field
 * name: a string as itself, `null` / `undefined` as absent, and any other
 * value (a checkbox's boolean, a number) through `String(...)` rather than
 * dropped — the point of repopulation is that the user sees what they sent.
 */
const carriedState = ({ form: state }: typeof CarriedForm.Type): ActionFormState => {
  const carried: { -readonly [K in keyof ActionFormState]: ActionFormState[K] } = {};
  const data = Option.filter(decodePosted(state.data), isRecord);
  if (Option.isSome(data)) carried.data = R.fromEntries(postedLeaves(data.value, []));
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

/**
 * Messages attached to the field a focus names (any `Focus` from
 * `@thomasfosterau/effect-forms`, e.g. `Focus.root<Input>().key("name")`),
 * or none.
 */
export const issuesFor = (
  state: ActionFormState | undefined,
  field: Focus.HasPath,
): ReadonlyArray<string> =>
  Option.getOrElse(
    Option.flatMap(Option.fromUndefinedOr(state?.errors), (errors) =>
      Errors.getError(errors, field.path),
    ),
    () => [],
  );

/**
 * Whole-form messages — the ones with no field to attach to (a 409, a
 * rejected command). {@link runFormAction} routes them to the error tree's
 * empty path, which the nested tree exposes as `_errors`.
 */
export const rootIssuesOf = (state: ActionFormState | undefined): ReadonlyArray<string> =>
  issuesFor(state, { path: [] });

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
  field: Focus.HasPath,
  fallback = "",
): string => state?.data?.[Path.toString(field.path)] ?? fallback;
