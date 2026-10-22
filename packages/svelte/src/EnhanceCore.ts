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

import { Errors, Result, State } from "@thomasfosterau/effect-forms";
import * as Arr from "effect/Array";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";

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
const isBlob = (value: unknown): value is Blob =>
  !Predicate.isUndefined(globalThis.Blob) && value instanceof Blob;

/**
 * Encode a `Date` as the `YYYY-MM-DD` of its UTC calendar day, or `undefined`
 * for an invalid `Date`. The UTC day round-trips: a `YYYY-MM-DD` string
 * decodes to UTC midnight. Taking everything before the `T` keeps
 * `toISOString`'s expanded form for a year outside 0000–9999
 * (`+010000-01-01`), where a fixed 10-character slice would cut it off.
 */
const encodeDate = (value: Date): string | undefined => {
  if (Number.isNaN(value.getTime())) return undefined;
  const iso = value.toISOString();
  return iso.slice(0, iso.indexOf("T"));
};

/** Append the entries for one named value to `out`, recursing into containers. */
function appendEntries(out: Array<BodyEntry>, key: string, value: unknown): void {
  if (value === null) {
    out.push([key, ""]);
  } else if (isBlob(value)) {
    out.push([key, value]);
  } else if (value instanceof Date) {
    const encoded = encodeDate(value);
    if (encoded !== undefined) out.push([key, encoded]);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => appendEntries(out, `${key}[${i}]`, item));
  } else if (Predicate.isObject(value)) {
    appendFields(out, value, key);
  } else if (
    Predicate.isString(value) ||
    Predicate.isNumber(value) ||
    Predicate.isBoolean(value) ||
    Predicate.isBigInt(value)
  ) {
    out.push([key, String(value)]);
  }
  // `undefined`, `function` and `symbol` leaves are omitted.
}

/** Append an object's own enumerable fields to `out`, as `prefix.key` names. */
function appendFields<V>(
  out: Array<BodyEntry>,
  data: Record.ReadonlyRecord<string, V>,
  prefix: string,
): void {
  Arr.forEach(Record.toEntries(data), ([key, value]) =>
    appendEntries(out, prefix ? `${prefix}.${key}` : key, value),
  );
}

/** Flatten `data` into form-body entries, `Blob` / `File` leaves included. */
function toBodyEntries(data: unknown, prefix: string): Array<BodyEntry> {
  const out: Array<BodyEntry> = [];
  if (prefix) appendEntries(out, prefix, data);
  else if (Predicate.isObject(data)) {
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
 * - An `undefined`, `function` or `symbol` is omitted, as `JSON.stringify`
 *   omits such object properties, so a callback or symbol left in form data
 *   never reaches the form body as `"Symbol(…)"` or function source.
 * - Any other object contributes its own enumerable fields, so one with none
 *   (a `Map`, a `Set`, an empty object) contributes no entries.
 *
 * An omitted array item leaves a gap (where `JSON.stringify` would write
 * `null`), so the remaining items keep their indices (`tags[0]`, `tags[2]`).
 */
export function objectToEntries(data: unknown, prefix = ""): Array<[string, string]> {
  return toBodyEntries(data, prefix).filter((entry): entry is [string, string] =>
    Predicate.isString(entry[1]),
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
export function objectToFormData(data: unknown): FormData {
  const formData = new FormData();
  Arr.forEach(toBodyEntries(data, ""), ([key, value]) => formData.append(key, value));
  return formData;
}

/**
 * Whether a value looks like a {@link FormActionResult} (carries a known
 * `_tag`). Only the tag is checked: `A` / `Message` are the caller's declared
 * expectation of the server's response, not verified here.
 */
function isActionResult<A, Message>(value: unknown): value is FormActionResult<A, Message> {
  return (
    Predicate.isObjectOrArray(value) &&
    Predicate.hasProperty(value, "_tag") &&
    Predicate.isString(value._tag) &&
    ["Success", "Failure", "Redirect", "Error"].includes(value._tag)
  );
}

/**
 * Whether a value looks like a bare {@link FormState}. Only the keys are
 * checked: `A` / `Message` are the caller's declared expectation, not verified.
 */
function isFormState<A, Message>(value: unknown): value is FormState<A, Message> {
  return (
    Predicate.isObjectOrArray(value) && "valid" in value && "data" in value && "errors" in value
  );
}

/**
 * Normalise a parsed JSON response body into a {@link FormActionResult}. The
 * server may return a full action result (`{ _tag, … }`) or a bare
 * {@link FormState} — a bare state maps to `Success` / `Failure` by its `valid`
 * flag, using `status` for the failure code.
 */
export function parseActionResult<A, Message>(
  body: unknown,
  status = 200,
): FormActionResult<A, Message> {
  if (isActionResult<A, Message>(body)) return body;
  if (isFormState<A, Message>(body)) {
    return body.valid ? success(body, status) : failure(body, status);
  }
  return { _tag: "Error", status, message: "Unrecognised form response" };
}

/** The mutation a {@link FormActionResult} implies for the store. */
export interface FormUpdate<A, Message> {
  readonly data?: A | undefined;
  readonly errors?: FormErrors | undefined;
  readonly message?: Message | undefined;
  readonly redirect?: string | undefined;
  readonly error?: string | undefined;
  readonly valid?: boolean | undefined;
}

/**
 * Compute the store update implied by a {@link FormActionResult}. Pure: the
 * caller applies the returned fields to its reactive state and acts on
 * `redirect` / `error`.
 */
export function resultToUpdate<A, Message>(
  result: FormActionResult<A, Message>,
): FormUpdate<A, Message> {
  return Match.valueTags(result, {
    Success: ({ state }): FormUpdate<A, Message> => ({
      data: state.data,
      errors: state.errors,
      message: state.message,
      valid: true,
    }),
    Failure: ({ state }): FormUpdate<A, Message> => ({
      data: state.data,
      errors: state.errors,
      message: state.message,
      valid: false,
    }),
    Redirect: ({ location }): FormUpdate<A, Message> => ({ redirect: location }),
    Error: ({ message }): FormUpdate<A, Message> => ({ error: message, valid: false }),
  });
}

/** How a successful/failed submit's data should land on `data` and the tainted baseline. */
export interface DataApplication<A> {
  /** The next value for `data`, or `undefined` to leave it untouched (an auto-submit keeps local edits). */
  readonly data: A | undefined;
  /** The next tainted baseline (`#initial`), or `undefined` when this isn't a successful submit. */
  readonly rebaseTo: A | undefined;
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
  if (resetForm && isSuccess) return { data: initial, rebaseTo: initial };
  if (autoSubmit) return { data: undefined, rebaseTo: isSuccess ? submittedData : undefined };
  return { data: appliedData, rebaseTo: isSuccess ? appliedData : undefined };
}
