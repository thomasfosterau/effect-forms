/**
 * Command failures shaped as the transports raise them, built with
 * `Schema.TaggedError` rather than imported from an application:
 *
 * - {@link JsonapiError} — effect-jsonapi's `ServerErrors.JsonapiError` and
 *   the applications' own (`{ _tag, status, errors }`);
 * - {@link ErrorResponse} — effect-jsonapi's client-side `Client.ErrorResponse`
 *   (`{ _tag, status, message, document: Option }`);
 * - {@link ApiError} — the applications' untagged transport status error.
 *
 * The error-object schema mirrors effect-jsonapi's `Document.ErrorObject`;
 * `tests/kit/CommandFailure.types.test.ts` pins that the two stay assignable.
 */
import type { RequestEvent } from "@sveltejs/kit";
import * as Schema from "effect/Schema";

const ErrorObject = Schema.Struct({
  status: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.Struct({ pointer: Schema.String })),
});

export type ErrorObject = typeof ErrorObject.Type;

export class JsonapiError extends Schema.TaggedError<
  JsonapiError,
  { readonly brand: unique symbol }
>()("JsonapiError", {
  status: Schema.Finite,
  errors: Schema.Array(ErrorObject),
}) {}

export class ErrorResponse extends Schema.TaggedError<
  ErrorResponse,
  { readonly brand: unique symbol }
>()("ErrorResponse", {
  status: Schema.Finite,
  message: Schema.String,
  document: Schema.Option(Schema.Struct({ errors: Schema.Array(ErrorObject) })),
}) {}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

class TestFailure extends Schema.TaggedError<TestFailure, { readonly brand: unique symbol }>()(
  "TestFailure",
  {
    message: Schema.String,
  },
) {}

export const testFailure = (message: string): TestFailure => new TestFailure({ message });

export const conflict409 = (detail?: string): JsonapiError => {
  const error: ErrorObject = { status: "409", code: "conflict", title: "Conflict" };
  return new JsonapiError({
    status: 409,
    errors: [detail === undefined ? error : { ...error, detail }],
  });
};

export const post = (body: Record<string, string>): Request =>
  new Request("https://example.test/organisations/create", {
    method: "POST",
    body: new URLSearchParams(body),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

class UnusedMember extends Schema.TaggedError<UnusedMember, { readonly brand: unique symbol }>()(
  "UnusedMember",
  { member: Schema.String },
) {}

const unused = (member: string) => (): never => {
  throw new UnusedMember({ member });
};

/**
 * A complete SvelteKit `RequestEvent` around `request` and `locals`. The
 * members `formAction` never reads throw if a test reaches for them.
 */
export const requestEvent = (request: Request, locals: App.Locals): RequestEvent => ({
  cookies: {
    get: unused("cookies.get"),
    getAll: unused("cookies.getAll"),
    set: unused("cookies.set"),
    delete: unused("cookies.delete"),
    serialize: unused("cookies.serialize"),
    parse: unused("cookies.parse"),
  },
  fetch: unused("fetch"),
  getClientAddress: unused("getClientAddress"),
  locals,
  params: {},
  platform: undefined,
  request,
  route: { id: null },
  setHeaders: unused("setHeaders"),
  url: new URL(request.url),
  isDataRequest: false,
  isSubRequest: false,
  tracing: {
    enabled: false,
    get root(): never {
      return unused("tracing.root")();
    },
    get current(): never {
      return unused("tracing.current")();
    },
  },
  isRemoteRequest: false,
});
