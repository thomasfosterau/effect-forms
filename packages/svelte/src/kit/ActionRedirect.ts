/**
 * Failure routing for **action-only** routes: a route with no page of its
 * own (a restore, a confirm) always answers a submission with a redirect, so
 * a *user-fixable* command failure rides back to the submitting page as
 * query parameters instead of a `fail()` (which would try to render the
 * action route's nonexistent page for a no-JS submitter). Everything else —
 * auth denials, infrastructure faults — stays a hard error at the caller.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/kit/ActionRedirect
 */

import * as Arr from "effect/Array";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import { detailOf, jsonapiFailure } from "./CommandFailure.ts";

/** The statuses whose failure the submitter can act on (the form layer's set). */
const USER_FIXABLE_STATUSES: HashSet.HashSet<number> = HashSet.make(400, 409, 422);

/**
 * A user-fixable failure's message; `None` takes the hard-error path.
 *
 * - a `JsonapiError` / `ErrorResponse`-tagged cause at 400 / 409 / 422 → its
 *   first error object's `detail`, else `title`, else `fallback` (an
 *   `ErrorResponse` with no document → its own message);
 * - an `HttpError`-tagged 400 → its message (or `fallback`);
 * - anything else → `None`.
 *
 * `Some("")` is a deliberate *present* answer: an error object carrying a
 * blank `detail` redirects with an empty parameter rather than escalating.
 */
export const userFixableMessage = (cause: unknown, fallback: string): Option.Option<string> => {
  if (!Predicate.isObjectOrArray(cause)) return Option.none();
  if (Predicate.isTagged(cause, "HttpError")) {
    if (!Predicate.hasProperty(cause, "status") || cause.status !== 400) return Option.none();
    return Option.some(
      Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)
        ? cause.message
        : fallback,
    );
  }
  if (!Predicate.isTagged(cause, "JsonapiError") && !Predicate.isTagged(cause, "ErrorResponse")) {
    return Option.none();
  }
  return jsonapiFailure(cause).pipe(
    Option.filter((failure) => HashSet.has(USER_FIXABLE_STATUSES, failure.status)),
    Option.map((failure) =>
      Predicate.isTagged(failure, "Routed")
        ? detailOf(failure.errors[0], fallback)
        : failure.message,
    ),
  );
};

/**
 * Append the failure's query parameters to a same-origin return target,
 * answering the path and query only (never an origin).
 */
export const withFailureParams = (
  target: string,
  params: Readonly<Record<string, string>>,
): string => {
  const url = new URL(target, "http://localhost");
  Arr.forEach(Record.toEntries(params), ([key, value]) => url.searchParams.set(key, value));
  return url.pathname + url.search;
};
