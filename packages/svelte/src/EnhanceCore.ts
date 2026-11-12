/**
 * Pure plumbing for the `enhance` action: serialise the store's data back into
 * a form body, interpret a server response into a {@link FormActionResult}, and
 * compute the store update a result implies. Kept framework-free and side-
 * effect-free so it is unit-testable in isolation; the rune store
 * (`FormStore.svelte.ts`) wires these to the DOM.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/EnhanceCore
 */

import { Errors, type Path, Result, State } from "@thomasfosterau/effect-forms";
import * as Arr from "effect/Array";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import type * as Types from "effect/Types";

// Terse local aliases onto the namespaced core exports.
type FormActionResult<A, Message = unknown> = Result.FormActionResult<A, Message>;
type FormErrors = Errors.FormErrors;
type FormState<A, Message = unknown> = State.FormState<A, Message>;
const { failure, success } = Result;

/** A form-body entry: a stringified leaf, or a `Blob` / `File` passed through. */
type BodyEntry = [string, string | Blob];

/**
 * Whether a value is a `Blob` (a `File` is one). Guards on `globalThis.Blob`
 * so it holds in any runtime, including one without a global `Blob`.
 */
const isBlob = (value: Path.FormValue): value is Blob =>
  !P.isUndefined(globalThis.Blob) && value instanceof Blob;

/**
 * Encode a `Date` as the `YYYY-MM-DD` of its UTC calendar day, or `None` for
 * an invalid `Date`. The UTC day round-trips: a `YYYY-MM-DD` string
 * decodes to UTC midnight. Taking everything before the `T` keeps
 * `toISOString`'s expanded form for a year outside 0000–9999
 * (`+010000-01-01`), where a fixed 10-character slice would cut it off.
 */
const encodeDate = (value: Date): Option.Option<string> => {
  if (Number.isNaN(value.getTime())) return Option.none();
  const iso = value.toISOString();
  return Option.some(iso.slice(0, iso.indexOf("T")));
};

/** Append the entries for one named value to `out`, recursing into containers. */
function appendEntries(out: Array<BodyEntry>, key: string, value: Path.FormValue): void {
  if (value === null) {
    out.push([key, ""]);
  } else if (isBlob(value)) {
    out.push([key, value]);
  } else if (value instanceof Date) {
    const encoded = encodeDate(value);
    if (Option.isSome(encoded)) out.push([key, encoded.value]);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => appendEntries(out, `${key}[${i}]`, item));
  } else if (P.isObject(value)) {
    appendFields(out, value, key);
  } else if (P.isString(value) || P.isNumber(value) || P.isBoolean(value) || P.isBigInt(value)) {
    out.push([key, String(value)]);
  }
  // `undefined` leaves are omitted.
}

/** Append an object's own enumerable fields to `out`, as `prefix.key` names. */
function appendFields(
  out: Array<BodyEntry>,
  data: R.ReadonlyRecord<string, Path.FormValue>,
  prefix: string,
): void {
  Arr.forEach(R.toEntries(data), ([key, value]) =>
    appendEntries(out, prefix ? `${prefix}.${key}` : key, value),
  );
}

/** Flatten `data` into form-body entries, `Blob` / `File` leaves included. */
function toBodyEntries(data: Path.FormValue, prefix: string): Array<BodyEntry> {
  const out: Array<BodyEntry> = [];
  if (prefix) appendEntries(out, prefix, data);
  else if (P.isObject(data)) {
    appendFields(out, data, "");
  }
  return out;
}

/**
 * Flatten a nested data object into `[name, value]` string entries using path
 * notation.
 *
 * Nested objects become dotted names (`author.name`) and array items indexed
 * names (`tags[0]`). Each leaf kind is handled as follows:
 *
 * - A `string`, `number`, `boolean` or `bigint` is stringified.
 * - `null` becomes `""`.
 * - A `Date` becomes the `YYYY-MM-DD` of its **UTC** calendar day (what
 *   `<input type="date">` submits, and what `Schema.DateFromString` decodes
 *   back to UTC midnight); the time of day is dropped, so a datetime needs its
 *   own string field. An invalid `Date` is omitted.
 * - A `Blob` or `File` is omitted here, since a string entry can't carry it;
 *   {@link objectToFormData} keeps it.
 * - An `undefined` is omitted, as `JSON.stringify` omits such object
 *   properties.
 * - A record contributes its own enumerable fields, so an empty one contributes
 *   no entries. (`data` is a {@link Path.FormValue}, so a function, symbol,
 *   `Map` or `Set` is a type error.)
 *
 * An omitted array item leaves a gap (where `JSON.stringify` would write
 * `null`), so the remaining items keep their indices (`tags[0]`, `tags[2]`).
 */
export function objectToEntries(data: Path.FormValue, prefix = ""): Array<[string, string]> {
  return toBodyEntries(data, prefix).filter((entry): entry is [string, string] =>
    P.isString(entry[1]),
  );
}

/**
 * Serialise the store's data into a {@link FormData} body for submission.
 *
 * Names and leaves follow {@link objectToEntries}, except that a `Blob` or
 * `File` leaf is appended as a file (a `File` keeps its name; a bare `Blob`
 * arrives as a `File` named `"blob"`, the `FormData` default), as an
 * `<input type="file">` would submit it, so it reaches the core's
 * `FormData.formDataToObject` (`@thomasfosterau/effect-forms`) unchanged.
 */
export function objectToFormData(data: Path.FormValue): FormData {
  const formData = new FormData();
  Arr.forEach(toBodyEntries(data, ""), ([key, value]) => formData.append(key, value));
  return formData;
}

/** The `_tag`s of the four {@link FormActionResult} variants. */
const ACTION_RESULT_TAGS = ["Success", "Failure", "Redirect", "Error"] as const;

/**
 * Whether a value looks like a {@link FormActionResult} (carries a known
 * `_tag`). Only the tag is checked: `A` / `Message` are the caller's declared
 * expectation of the server's response, not verified here.
 */
function isActionResult<A, Message>(value: unknown): value is FormActionResult<A, Message> {
  return P.isObjectOrArray(value) && Arr.some(ACTION_RESULT_TAGS, (tag) => P.isTagged(value, tag));
}

/**
 * Whether a value looks like a bare {@link FormState}. Only the keys are
 * checked: `A` / `Message` are the caller's declared expectation, not verified.
 */
function isFormState<A, Message>(value: unknown): value is FormState<A, Message> {
  return P.isObjectOrArray(value) && "isValid" in value && "data" in value && "errors" in value;
}

/**
 * A form response body the store understands: a full {@link FormActionResult}
 * (`{ _tag, … }`) or a bare {@link FormState}.
 */
export type ActionResponse<A, Message> = FormActionResult<A, Message> | FormState<A, Message>;

/**
 * Whether a parsed JSON response body is an {@link ActionResponse} — the
 * check to run at the response boundary before {@link parseActionResult}.
 * Only the `_tag` (or a bare state's keys) is checked: `A` / `Message` are
 * the caller's declared expectation of the server's response, not verified
 * here.
 */
export function isActionResponse<A, Message>(body: unknown): body is ActionResponse<A, Message> {
  return isActionResult<A, Message>(body) || isFormState<A, Message>(body);
}

/**
 * Normalise an {@link ActionResponse} into a {@link FormActionResult}. A full
 * action result passes through; a bare {@link FormState} maps to `Success` /
 * `Failure` by its `isValid` flag, using `status` for the failure code. Check a
 * raw body with {@link isActionResponse} first.
 */
export function parseActionResult<A, Message>(
  body: ActionResponse<A, Message>,
  status = 200,
): FormActionResult<A, Message> {
  if ("_tag" in body) return body;
  return body.isValid ? success(body, status) : failure(body, status);
}

/** The mutation a {@link FormActionResult} implies for the store. */
export interface FormUpdate<A, Message> {
  readonly data?: A;
  readonly errors?: FormErrors;
  readonly message?: Message;
  readonly redirect?: string;
  readonly error?: string;
  readonly isValid?: boolean;
}

/** The update a submitted {@link FormState} implies: its data, errors and (when set) message. */
const stateUpdate = <A, Message>(
  state: FormState<A, Message>,
  isValid: boolean,
): FormUpdate<A, Message> => {
  const update: Types.Mutable<FormUpdate<A, Message>> = {
    data: state.data,
    errors: state.errors,
    isValid,
  };
  if (state.message !== undefined) update.message = state.message;
  return update;
};

/**
 * Compute the store update implied by a {@link FormActionResult}. Pure: the
 * caller applies the returned fields to its reactive state and acts on
 * `redirect` / `error`.
 */
export function resultToUpdate<A, Message>(
  result: FormActionResult<A, Message>,
): FormUpdate<A, Message> {
  return Match.valueTags(result, {
    Success: ({ state }) => stateUpdate(state, true),
    Failure: ({ state }) => stateUpdate(state, false),
    Redirect: ({ location }): FormUpdate<A, Message> => ({ redirect: location }),
    Error: ({ message }): FormUpdate<A, Message> => ({ error: message, isValid: false }),
  });
}

/** How a successful/failed submit's data should land on `data` and the tainted baseline. */
export interface DataApplication<A> {
  /** The next value for `data`, or `None` to leave it untouched (an auto-submit keeps local edits). */
  readonly data: Option.Option<A>;
  /** The next tainted baseline (`#initial`), or `None` when this isn't a successful submit. */
  readonly rebaseTo: Option.Option<A>;
}

/**
 * Decide how a submit result's data applies to the store, given a defined
 * `update.data` (redirects/errors never reach this — see {@link resultToUpdate}).
 * Pure so the save-then-navigate baseline rebase is unit-testable without
 * compiling the rune store: on a successful submit the tainted baseline
 * rebases to whatever was actually persisted, so `isTainted` goes back to
 * `false` for values that were just saved, not just the original seed. An
 * auto-submitting (live-save) form keeps its local `data` as the source of
 * truth while a request is in flight — adopting the server's echo would
 * discard keystrokes made during the round-trip — but on success rebases to
 * `submittedData` (the snapshot actually sent), not the live value, since the
 * user may have typed further edits that haven't been submitted yet.
 */
export function computeDataApplication<A>(params: {
  readonly isSuccess: boolean;
  readonly appliedData: A;
  readonly initial: A;
  readonly submittedData: A;
  readonly resetForm: boolean;
  readonly autoSubmit: boolean;
}): DataApplication<A> {
  const { isSuccess, appliedData, initial, submittedData, resetForm, autoSubmit } = params;
  if (resetForm && isSuccess) return { data: Option.some(initial), rebaseTo: Option.some(initial) };
  if (autoSubmit) {
    return {
      data: Option.none(),
      rebaseTo: isSuccess ? Option.some(submittedData) : Option.none(),
    };
  }
  return {
    data: Option.some(appliedData),
    rebaseTo: isSuccess ? Option.some(appliedData) : Option.none(),
  };
}
