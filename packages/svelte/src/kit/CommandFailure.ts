/**
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
 * A Promise command's rejection (or a synchronous throw) reaches the Effect
 * error channel as a {@link CommandRejected} carrying the original value in
 * `cause`; an `Effect` command's typed failure arrives as itself.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/kit/CommandFailure
 */

import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { Document } from "@thomasfosterau/effect-jsonapi";

/** One JSON:API error object: `@thomasfosterau/effect-jsonapi`'s `Document.ErrorObject`. */
export type ErrorObject = Document.ErrorObject;

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
export const message = (status: number, text: string): CommandFailure => ({
  _tag: "Message",
  status,
  message: text,
});

/**
 * A Promise command's rejection, or a command's synchronous throw, in the
 * Effect error channel: `cause` is the original rejection reason, unchanged.
 *
 * The form actions' Promise boundaries (`idempotentCreate`, `runFormAction`
 * under `unrecognised: "throw"`) rethrow `cause`, not this wrapper, so a
 * caller awaiting them sees what the command rejected with.
 */
export class CommandRejected extends Schema.TaggedError<
  CommandRejected,
  { readonly brand: unique symbol }
>()("CommandRejected", {
  cause: Schema.Defect(),
}) {}

/**
 * A classifier: `Some` for a failure the form can show, `None` for an
 * unexpected one. It is handed the command's typed error `E` — a Promise
 * command's rejection as a {@link CommandRejected}, whose `cause` is the
 * rejection reason.
 */
export type Classify<E = unknown> = (error: E) => Option.Option<CommandFailure>;

/** The fallback message for an error object with neither `detail` nor `title`. */
export const DEFAULT_MESSAGE = "Request could not be completed";

/** An error object's human message: its `detail`, else its `title`, else `fallback`. */
export const detailOf = (error: ErrorObject | undefined, fallback = DEFAULT_MESSAGE): string =>
  error?.detail ?? error?.title ?? fallback;

const isStatus = (u: unknown): u is number => P.isNumber(u) && Number.isInteger(u);

/** A cause recognised by its `_tag` as effect-jsonapi's (or an application's) `JsonapiError`. */
interface JsonapiErrorLike {
  readonly _tag: "JsonapiError";
}

/** A cause recognised by its `_tag` as effect-jsonapi's client-side `ErrorResponse`. */
interface ErrorResponseLike {
  readonly _tag: "ErrorResponse";
}

/** The cause's `status`, when it carries an integer one. */
const statusOf = (cause: JsonapiErrorLike | ErrorResponseLike | Error): Option.Option<number> =>
  P.hasProperty(cause, "status") && isStatus(cause.status)
    ? Option.some(cause.status)
    : Option.none();

// `ServerErrors.JsonapiError` (effect-jsonapi) and the applications' own
// `JsonapiError`: `{ _tag: "JsonapiError", status, errors }`.
const fromJsonapiError = (cause: JsonapiErrorLike): Option.Option<CommandFailure> =>
  Option.flatMap(statusOf(cause), (status) =>
    P.hasProperty(cause, "errors") && Array.isArray(cause.errors)
      ? // SAFETY: a `JsonapiError`-tagged cause carries JSON:API error objects in
        // `errors` by that tag's contract (effect-jsonapi's `ServerErrors.JsonapiError`
        // and the applications' own); causes are recognised structurally, not decoded.
        Option.some(routed(status, cause.errors as ReadonlyArray<ErrorObject>))
      : Option.none(),
  );

// `Client.ErrorResponse` (effect-jsonapi): `{ _tag: "ErrorResponse", status,
// message, document: Option<ErrorDocument> }`. A decoded document routes its
// error objects; a response with none is its message alone.
const fromErrorResponse = (cause: ErrorResponseLike): Option.Option<CommandFailure> =>
  Option.map(statusOf(cause), (status) => {
    const errors =
      P.hasProperty(cause, "document") && Option.isOption(cause.document)
        ? Option.flatMap(cause.document, (document) =>
            P.hasProperty(document, "errors") &&
            Array.isArray(document.errors) &&
            Arr.isReadonlyArrayNonEmpty(document.errors)
              ? // SAFETY: an `ErrorResponse`'s `document` is effect-jsonapi's decoded
                // `ErrorDocument`, whose `errors` are JSON:API error objects.
                Option.some(document.errors as ReadonlyArray<ErrorObject>)
              : Option.none(),
          )
        : Option.none<ReadonlyArray<ErrorObject>>();
    return Option.match(errors, {
      onSome: (routedErrors) => routed(status, routedErrors),
      onNone: () =>
        message(
          status,
          P.hasProperty(cause, "message") && P.isString(cause.message)
            ? cause.message
            : DEFAULT_MESSAGE,
        ),
    });
  });

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
 * - a {@link CommandRejected} → its `cause`, classified by the rules above;
 * - anything else → `None` (unexpected).
 */
export const jsonapiFailure: Classify = (error) => {
  const cause = error instanceof CommandRejected ? error.cause : error;
  if (!P.isObjectOrArray(cause)) return Option.none();
  if (P.isTagged(cause, "JsonapiError")) return fromJsonapiError(cause);
  if (P.isTagged(cause, "ErrorResponse")) return fromErrorResponse(cause);
  return P.isError(cause)
    ? Option.map(statusOf(cause), (status) => message(status, cause.message))
    : Option.none();
};
