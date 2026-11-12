/**
 * `CommandFailure.jsonapiFailure` — the structural recognition of JSON:API
 * causes, including causes whose `errors` are not well-formed error objects.
 */
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";
import { CommandFailure } from "../../src/kit/index.ts";

const pointerError = {
  status: "422",
  detail: "is taken",
  source: { pointer: "/data/attributes/name" },
};

describe("jsonapiFailure", () => {
  it("routes a JsonapiError-tagged cause's well-formed error objects", () => {
    const cause = { _tag: "JsonapiError", status: 422, errors: [pointerError] };
    expect(CommandFailure.jsonapiFailure(cause)).toEqual(
      Option.some(CommandFailure.routed(422, [pointerError])),
    );
  });

  it("does not recognise a JsonapiError-tagged cause whose errors are malformed", () => {
    const cause = { _tag: "JsonapiError", status: 422, errors: [{ detail: 42 }] };
    expect(CommandFailure.jsonapiFailure(cause)).toEqual(Option.none());
  });

  it("falls back to an ErrorResponse's message when its document's errors are malformed", () => {
    const cause = {
      _tag: "ErrorResponse",
      status: 400,
      message: "Bad Request",
      document: Option.some({ errors: [{ source: { pointer: 7 } }] }),
    };
    expect(CommandFailure.jsonapiFailure(cause)).toEqual(
      Option.some(CommandFailure.message(400, "Bad Request")),
    );
  });

  it("routes an ErrorResponse's well-formed, linked error objects", () => {
    const linked = { ...pointerError, links: { about: new URL("https://example.com/e") } };
    const cause = {
      _tag: "ErrorResponse",
      status: 422,
      message: "Unprocessable",
      document: Option.some({ errors: [linked] }),
    };
    expect(CommandFailure.jsonapiFailure(cause)).toEqual(
      Option.some(CommandFailure.routed(422, [linked])),
    );
  });
});
