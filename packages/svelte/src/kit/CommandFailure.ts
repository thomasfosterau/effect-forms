/**
 * @copyright Thomas Foster
 *
 * Classifying what a form action's command failed with.
 *
 * A command (an API client call, an Effect program) fails with whatever its
 * transport raises. The form layer only needs to know two things about it:
 * which JSON:API error objects it carried (so each can be routed onto a
 * field by its `source.pointer`), or, failing that, a status and a single
 * message for the whole form. {@link CommandFailure} is that view, and
 * {@link jsonapiFailure} is the default classifier.
 *
 * The error-object shape is `@thomasfosterau/effect-jsonapi`'s
 * `Document.ErrorObject` — an optional peer imported for its type only, so
 * nothing here depends on it at runtime and no application type leaks in.
 * Causes are recognised structurally by their `_tag`, so an application's
 * own `JsonapiError` with the same shape is recognised too.
 *
 * @module effect-forms-svelte/kit/CommandFailure
 */

import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type { Document } from "@thomasfosterau/effect-jsonapi";

/** One JSON:API error object: `@thomasfosterau/effect-jsonapi`'s `Document.ErrorObject`. */
export type ErrorObject = typeof Document.ErrorObject.Type;

/** A failure carrying JSON:API error objects, each routed to a field (or the root) by its pointer. */
export interface RoutedFailure {
  readonly _tag: "Routed";
  readonly status: number;
  readonly errors: ReadonlyArray<ErrorObject>;
}

/** A failure with no error objects to route: one whole-form message. */
export interface MessageFailure {
  readonly _tag: "Message";
  readonly status: number;
  readonly message: string;
}

/**
 * What a form action needs to know about a recognised command failure. An
 * unrecognised failure is not a `CommandFailure` at all: the classifier
 * answers `None` and the action treats it as unexpected.
 */
export type CommandFailure = RoutedFailure | MessageFailure;

/** Construct a {@link RoutedFailure}. */
export const routed = (status: number, errors: ReadonlyArray<ErrorObject>): CommandFailure => ({
  _tag: "Routed",
  status,
  errors,
});

/** Construct a {@link MessageFailure}. */
export const message = (status: number, message: string): CommandFailure => ({
  _tag: "Message",
  status,
  message,
});

/** A classifier: `Some` for a failure the form can show, `None` for an unexpected one. */
export type Classify = (cause: unknown) => Option.Option<CommandFailure>;

/** The fallback message for an error object with neither `detail` nor `title`. */
export const DEFAULT_MESSAGE = "Request could not be completed";

/** An error object's human message: its `detail`, else its `title`, else `fallback`. */
export const detailOf = (error: ErrorObject | undefined, fallback = DEFAULT_MESSAGE): string =>
  error?.detail ?? error?.title ?? fallback;

interface TaggedLike {
  readonly _tag?: unknown;
  readonly status?: unknown;
  readonly message?: unknown;
  readonly errors?: unknown;
  readonly document?: unknown;
}

const isStatus = (u: unknown): u is number => Predicate.isNumber(u) && Number.isInteger(u);

// `ServerErrors.JsonapiError` (effect-jsonapi) and the applications' own
// `JsonapiError`: `{ _tag: "JsonapiError", status, errors }`.
const fromJsonapiError = (cause: TaggedLike): Option.Option<CommandFailure> =>
  isStatus(cause.status) && Array.isArray(cause.errors)
    ? Option.some(routed(cause.status, cause.errors as ReadonlyArray<ErrorObject>))
    : Option.none();

// `Client.ErrorResponse` (effect-jsonapi): `{ _tag: "ErrorResponse", status,
// message, document: Option<ErrorDocument> }`. A decoded document routes its
// error objects; a response with none is its message alone.
const fromErrorResponse = (cause: TaggedLike): Option.Option<CommandFailure> => {
  if (!isStatus(cause.status)) return Option.none();
  const errors = Option.isOption(cause.document)
    ? Option.flatMap(cause.document as Option.Option<unknown>, (document) =>
        Predicate.hasProperty(document, "errors") &&
        Array.isArray(document.errors) &&
        document.errors.length > 0
          ? Option.some(document.errors as ReadonlyArray<ErrorObject>)
          : Option.none(),
      )
    : Option.none<ReadonlyArray<ErrorObject>>();
  const status = cause.status;
  return Option.some(
    Option.match(errors, {
      onSome: (errors) => routed(status, errors),
      onNone: () =>
        message(status, Predicate.isString(cause.message) ? cause.message : DEFAULT_MESSAGE),
    }),
  );
};

/**
 * The default classifier:
 *
 * - a `JsonapiError`-tagged cause (`{ status, errors }`) → its error objects,
 *   at its own status;
 * - an `ErrorResponse`-tagged cause (effect-jsonapi's client-side decoded
 *   error) → its document's error objects, or its message when the response
 *   carried no document;
 * - an `Error` carrying a numeric `status` (a transport's status error, e.g.
 *   a 413 oversize upload the transport did not map to a document) → its
 *   message, at its own status;
 * - anything else → `None` (unexpected).
 */
export const jsonapiFailure: Classify = (cause) => {
  if (!Predicate.isObjectOrArray(cause)) return Option.none();
  const tagged = cause as TaggedLike;
  if (tagged._tag === "JsonapiError") return fromJsonapiError(tagged);
  if (tagged._tag === "ErrorResponse") return fromErrorResponse(tagged);
  if (Predicate.isError(cause) && isStatus(tagged.status)) {
    return Option.some(message(tagged.status, cause.message));
  }
  return Option.none();
};
