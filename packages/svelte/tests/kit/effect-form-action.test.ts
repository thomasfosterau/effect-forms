/**
 * `runFormAction` — ported from the applications' `effect-form-action.test.ts`
 * (website's cases, plus gardeneria's decoded-input case), driven with a fake
 * command rather than an API client.
 */
import { Form, State } from "@thomasfosterau/effect-forms";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { assert, describe, expect, it, vi } from "vite-plus/test";
import { CommandFailure, runFormAction } from "../../src/kit/index.ts";
import {
  ApiError,
  conflict409,
  ErrorResponse,
  JsonapiError,
  post,
  testFailure,
} from "./fixtures.ts";

// A stand-in for an entity command schema: a single trimmed, required field.
const Org = Schema.Struct({ name: Schema.Trim.check(Schema.isMinLength(1)) });
const form = Form.make(Org, { defaults: { name: "" } });

// A stand-in for a client-id create command schema: an optional
// client-generated `id` alongside the trimmed required field.
const OrgWithClientId = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.Trim.check(Schema.isMinLength(1)),
});
const formWithClientId = Form.make(OrgWithClientId, { defaults: { id: "", name: "" } });

describe("runFormAction", () => {
  it("redirects to the resource on a valid submission", async () => {
    const result = await runFormAction(
      form,
      post({ name: "Acme" }),
      async (input) => {
        expect(input).toEqual({ name: "Acme" });
        return "org-1";
      },
      (id) => `/organisations/${id}`,
    );
    expect(result).toEqual({ _tag: "Redirect", status: 303, location: "/organisations/org-1" });
  });

  it("hands the command the decoded submission", async () => {
    let seen: unknown;
    await runFormAction(
      form,
      post({ name: "  Acme  " }),
      async (input) => {
        seen = input;
        return "org-1";
      },
      (id: string) => `/${id}`,
    );
    // Trimmed by the schema, so the command never sees the stray spaces.
    expect(seen).toEqual({ name: "Acme" });
  });

  it("hands locationFor the command's output and the decoded input", async () => {
    const result = await runFormAction(
      form,
      post({ name: "Acme" }),
      async () => ({ slug: "acme" }),
      (out, input) => `/organisations/${out.slug}?name=${input.name}`,
    );
    expect(result).toMatchObject({ location: "/organisations/acme?name=Acme" });
  });

  it("returns a Failure carrying field errors on invalid input", async () => {
    const ran = { called: false };
    const result = await runFormAction(
      form,
      post({ name: "  " }),
      async () => {
        ran.called = true;
        return "x";
      },
      (id: string) => `/${id}`,
    );
    expect(ran.called).toBe(false); // the command never runs on invalid input
    expect(result._tag).toBe("Failure");
    assert(Predicate.isTagged(result, "Failure"));
    expect(result.status).toBe(400);
    expect(result.state.errors.name).toBeDefined();
  });

  it("maps a thrown command into an Error result", async () => {
    const result = await runFormAction(
      form,
      post({ name: "Acme" }),
      async () => {
        throw testFailure("boom");
      },
      (id: string) => `/${id}`,
    );
    expect(result).toEqual({ _tag: "Error", status: 500, message: "boom" });
  });

  it("maps a non-Error rejection into an Error result with the default message", async () => {
    const result = await runFormAction(
      form,
      post({ name: "Acme" }),
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the point of the case
      () => Promise.reject("nope"),
      (id: string) => `/${id}`,
    );
    expect(result).toEqual({
      _tag: "Error",
      status: 500,
      message: "Request could not be completed",
    });
  });

  it("rethrows an unrecognised failure when asked to", async () => {
    const cause = testFailure("the database is on fire");
    await expect(
      runFormAction(
        form,
        post({ name: "Acme" }),
        async () => {
          throw cause;
        },
        (id: string) => `/${id}`,
        { unrecognised: "throw" },
      ),
    ).rejects.toBe(cause);
  });

  // ── JSON:API error routing ─────────────────────────────────────────────

  it("routes a 422 JsonapiError with a source.pointer to its field, preserving status", async () => {
    const result = await runFormAction(
      form,
      post({ name: "Acme" }),
      async () => {
        throw new JsonapiError({
          status: 422,
          errors: [
            {
              status: "422",
              code: "invalid-value",
              detail: "Name is already taken by another organisation.",
              source: { pointer: "/data/attributes/name" },
            },
          ],
        });
      },
      (id: string) => `/${id}`,
    );
    expect(result._tag).toBe("Failure");
    assert(Predicate.isTagged(result, "Failure"));
    expect(result.status).toBe(422);
    expect(result.state.errors.name).toEqual(["Name is already taken by another organisation."]);
    // The posted value survives the failure so the form re-renders what was typed.
    expect(result.state.data).toEqual({ name: "Acme" });
  });

  it("routes a 409 JsonapiError with no source.pointer to the root message surface", async () => {
    const result = await runFormAction(
      form,
      post({ name: "Acme" }),
      async () => {
        throw new JsonapiError({
          status: 409,
          errors: [
            {
              status: "409",
              code: "conflict",
              title: "Conflict",
              detail: "That value is already in use.",
            },
          ],
        });
      },
      (id: string) => `/${id}`,
    );
    expect(result._tag).toBe("Failure");
    assert(Predicate.isTagged(result, "Failure"));
    expect(result.status).toBe(409);
    expect(result.state.errors._errors).toEqual(["That value is already in use."]);
    expect(result.state.errors.name).toBeUndefined();
  });

  it("routes a 413 ApiError (an oversize upload) to the root message surface, preserving status", async () => {
    const result = await runFormAction(
      form,
      post({ name: "Acme" }),
      async () => {
        throw new ApiError(413, "The uploaded file exceeds the 10 MiB limit.");
      },
      (id: string) => `/${id}`,
    );
    expect(result._tag).toBe("Failure");
    assert(Predicate.isTagged(result, "Failure"));
    expect(result.status).toBe(413);
    expect(result.state.errors._errors).toEqual(["The uploaded file exceeds the 10 MiB limit."]);
  });

  it("routes an ErrorResponse's document errors, and its message when it has none", async () => {
    const withDocument = await runFormAction(
      form,
      post({ name: "Acme" }),
      async () => {
        throw new ErrorResponse({
          status: 422,
          message: "Name taken",
          document: Option.some({
            errors: [{ detail: "Name taken", source: { pointer: "/data/attributes/name" } }],
          }),
        });
      },
      (id: string) => `/${id}`,
    );
    expect(withDocument).toMatchObject({ _tag: "Failure", status: 422 });
    assert(Predicate.isTagged(withDocument, "Failure"));
    expect(withDocument.state.errors.name).toEqual(["Name taken"]);

    const bare = await runFormAction(
      form,
      post({ name: "Acme" }),
      async () => {
        throw new ErrorResponse({
          status: 502,
          message: "Request failed (502)",
          document: Option.none(),
        });
      },
      (id: string) => `/${id}`,
    );
    expect(bare).toMatchObject({ _tag: "Failure", status: 502 });
    assert(Predicate.isTagged(bare, "Failure"));
    expect(bare.state.errors._errors).toEqual(["Request failed (502)"]);
  });

  // ── Effect commands ────────────────────────────────────────────────────

  it("runs an Effect command, routing its typed failure like a thrown one", async () => {
    const ok = await runFormAction(
      form,
      post({ name: "Acme" }),
      (input) => Effect.succeed(`org-${input.name}`),
      (id) => `/organisations/${id}`,
    );
    expect(ok).toEqual({ _tag: "Redirect", status: 303, location: "/organisations/org-Acme" });

    const failed = await runFormAction(
      form,
      post({ name: "Acme" }),
      () =>
        Effect.fail(
          new JsonapiError({
            status: 422,
            errors: [{ detail: "Taken", source: { pointer: "/data/attributes/name" } }],
          }),
        ),
      (id: string) => `/${id}`,
    );
    expect(failed).toMatchObject({ _tag: "Failure", status: 422 });
    assert(Predicate.isTagged(failed, "Failure"));
    expect(failed.state.errors.name).toEqual(["Taken"]);
  });

  it("maps a defect in an Effect command into an Error result", async () => {
    const result = await runFormAction(
      form,
      post({ name: "Acme" }),
      () => Effect.die(testFailure("invariant broken")),
      (id: string) => `/${id}`,
    );
    expect(result).toEqual({ _tag: "Error", status: 500, message: "invariant broken" });
  });

  // ── Options: classify, redact ──────────────────────────────────────────

  it("uses a caller's classifier, composed with the default", async () => {
    class SessionCallError extends Error {
      constructor(readonly code: number) {
        super(`session call failed (${code})`);
      }
    }
    const classify: CommandFailure.Classify = (cause) =>
      cause instanceof SessionCallError && cause.code === 401
        ? Option.some(CommandFailure.message(401, "Invalid email or password"))
        : CommandFailure.jsonapiFailure(cause);
    const result = await runFormAction(
      form,
      post({ name: "Acme" }),
      async () => {
        throw new SessionCallError(401);
      },
      (id: string) => `/${id}`,
      { classify },
    );
    expect(result).toMatchObject({ _tag: "Failure", status: 401 });
    assert(Predicate.isTagged(result, "Failure"));
    expect(result.state.errors._errors).toEqual(["Invalid email or password"]);
  });

  it("redacts every echoed state: an invalid submission and a routed failure", async () => {
    const redact = vi.fn((state: State.FormState<{ readonly name: string }>) => ({
      ...state,
      data: { name: "" },
    }));
    const invalid = await runFormAction(form, post({ name: " " }), async () => "x", String, {
      redact,
    });
    const routed = await runFormAction(
      form,
      post({ name: "Acme" }),
      async () => {
        throw conflict409("Taken");
      },
      String,
      { redact },
    );
    expect(redact).toHaveBeenCalledTimes(2);
    Arr.forEach([invalid, routed], (result) => {
      expect(result._tag).toBe("Failure");
      assert(Predicate.isTagged(result, "Failure"));
      expect(result.state.data).toEqual({ name: "" });
    });
  });

  // ── Idempotent client-id create retry, driven by `idempotent.clientId` ──

  it("re-fetches and redirects on a 409 conflict when clientId is true (a double-submit retry)", async () => {
    const fetchExisting = vi.fn(async (id: string) => id);
    const result = await runFormAction(
      formWithClientId,
      post({ id: "org-1", name: "Acme" }),
      async (): Promise<string> => {
        throw conflict409();
      },
      (id) => `/organisations/${id}`,
      { idempotent: { clientId: true, fetchExisting } },
    );
    expect(fetchExisting).toHaveBeenCalledWith("org-1");
    expect(result).toEqual({ _tag: "Redirect", status: 303, location: "/organisations/org-1" });
  });

  it("surfaces the original 409 when the re-fetch can't confirm the retry (an unrelated conflict)", async () => {
    const fetchExisting = vi.fn(async (): Promise<string> => {
      throw testFailure("not found");
    });
    const result = await runFormAction(
      formWithClientId,
      post({ id: "org-1", name: "Acme" }),
      async (): Promise<string> => {
        throw conflict409("Position collision.");
      },
      (id) => `/organisations/${id}`,
      { idempotent: { clientId: true, fetchExisting } },
    );
    expect(result._tag).toBe("Failure");
    assert(Predicate.isTagged(result, "Failure"));
    expect(result.status).toBe(409);
    expect(result.state.errors._errors).toEqual(["Position collision."]);
  });

  it("does not wrap the command when clientId is false, even with fetchExisting supplied", async () => {
    const fetchExisting = vi.fn(async (id: string) => id);
    const result = await runFormAction(
      formWithClientId,
      post({ id: "org-1", name: "Acme" }),
      async (): Promise<string> => {
        throw conflict409();
      },
      (id) => `/organisations/${id}`,
      { idempotent: { clientId: false, fetchExisting } },
    );
    expect(fetchExisting).not.toHaveBeenCalled();
    expect(result._tag).toBe("Failure");
    assert(Predicate.isTagged(result, "Failure"));
    expect(result.status).toBe(409);
  });

  it("runs the command directly when no idempotent option is passed", async () => {
    const result = await runFormAction(
      formWithClientId,
      post({ id: "org-1", name: "Acme" }),
      async (input) => {
        expect(input).toEqual({ id: "org-1", name: "Acme" });
        return "org-1";
      },
      (id) => `/organisations/${id}`,
    );
    expect(result).toEqual({ _tag: "Redirect", status: 303, location: "/organisations/org-1" });
  });
});
