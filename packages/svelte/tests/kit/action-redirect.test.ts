/**
 * The action-only-route failure router — ported from website's
 * `action-redirect-failures.test.ts`, plus effect-jsonapi's `ErrorResponse`.
 */
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";
import { userFixableMessage, withFailureParams } from "../../src/kit/index.ts";
import { ErrorResponse } from "./fixtures.ts";

describe("userFixableMessage", () => {
  it("is None for a non-object cause", () => {
    expect(userFixableMessage("boom", "fallback")).toEqual(Option.none());
    expect(userFixableMessage(null, "fallback")).toEqual(Option.none());
    expect(userFixableMessage(42, "fallback")).toEqual(Option.none());
  });

  it("is None for an object with an unrecognised _tag", () => {
    expect(userFixableMessage({ _tag: "SomethingElse" }, "fallback")).toEqual(Option.none());
  });

  it("is None for a JsonapiError at a status the form layer doesn't route", () => {
    const cause = { _tag: "JsonapiError", status: 500, errors: [{ detail: "oops" }] };
    expect(userFixableMessage(cause, "fallback")).toEqual(Option.none());
  });

  it("resolves a JsonapiError's message from the first error's detail", () => {
    const cause = {
      _tag: "JsonapiError",
      status: 422,
      errors: [{ detail: "That version has already changed", title: "Conflict" }],
    };
    expect(userFixableMessage(cause, "fallback")).toEqual(
      Option.some("That version has already changed"),
    );
  });

  it("falls back to the first error's title when detail is absent", () => {
    const cause = { _tag: "JsonapiError", status: 409, errors: [{ title: "Conflict" }] };
    expect(userFixableMessage(cause, "fallback")).toEqual(Option.some("Conflict"));
  });

  it("falls back to the caller's fallback when the error has neither detail nor title", () => {
    const cause = { _tag: "JsonapiError", status: 400, errors: [{}] };
    expect(userFixableMessage(cause, "fallback")).toEqual(Option.some("fallback"));
  });

  it("falls back to the caller's fallback when the errors array is empty", () => {
    const cause = { _tag: "JsonapiError", status: 400, errors: [] };
    expect(userFixableMessage(cause, "fallback")).toEqual(Option.some("fallback"));
  });

  it("preserves a deliberately blank detail rather than falling back", () => {
    const cause = { _tag: "JsonapiError", status: 400, errors: [{ detail: "" }] };
    expect(userFixableMessage(cause, "fallback")).toEqual(Option.some(""));
  });

  it("resolves a tagged 400's string message", () => {
    const cause = { _tag: "HttpError", status: 400, message: "Bad slug" };
    expect(userFixableMessage(cause, "fallback")).toEqual(Option.some("Bad slug"));
  });

  it("falls back when a tagged 400's message isn't a string", () => {
    const cause = { _tag: "HttpError", status: 400, message: { not: "a string" } };
    expect(userFixableMessage(cause, "fallback")).toEqual(Option.some("fallback"));
  });

  it("is None for an HttpError at a status other than 400", () => {
    const cause = { _tag: "HttpError", status: 401, message: "nope" };
    expect(userFixableMessage(cause, "fallback")).toEqual(Option.none());
  });

  it("resolves an ErrorResponse at a user-fixable status, with or without a document", () => {
    const withDocument = new ErrorResponse({
      status: 409,
      message: "Conflict",
      document: Option.some({ errors: [{ detail: "Already restored" }] }),
    });
    expect(userFixableMessage(withDocument, "fallback")).toEqual(Option.some("Already restored"));
    const bare = new ErrorResponse({
      status: 422,
      message: "Request failed (422)",
      document: Option.none(),
    });
    expect(userFixableMessage(bare, "fallback")).toEqual(Option.some("Request failed (422)"));
    const server = new ErrorResponse({
      status: 503,
      message: "Unavailable",
      document: Option.none(),
    });
    expect(userFixableMessage(server, "fallback")).toEqual(Option.none());
  });
});

describe("withFailureParams", () => {
  it("appends a single param as a query string onto the target path", () => {
    expect(withFailureParams("/books/123/edits", { restoreError: "conflict" })).toBe(
      "/books/123/edits?restoreError=conflict",
    );
  });

  it("appends multiple params", () => {
    const result = withFailureParams("/books/123/edits", {
      restoreError: "conflict",
      restoreVersion: "4",
    });
    expect(result).toBe("/books/123/edits?restoreError=conflict&restoreVersion=4");
  });

  it("percent-encodes param values that need it", () => {
    expect(
      withFailureParams("/books/123/edits", { restoreError: "That version has already changed" }),
    ).toBe("/books/123/edits?restoreError=That+version+has+already+changed");
  });

  it("keeps an existing query and never answers an origin", () => {
    expect(withFailureParams("https://evil.test/x?a=1", { b: "2" })).toBe("/x?a=1&b=2");
  });
});
