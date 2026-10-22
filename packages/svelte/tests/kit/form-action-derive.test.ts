/**
 * `formAction` (the derived SvelteKit page action) — ported from the
 * applications' `form-action-derive.test.ts`, against the real
 * `@sveltejs/kit` `redirect()` / `fail()`.
 */
import { isRedirect, type RequestEvent } from "@sveltejs/kit";
import { Form } from "@thomasfosterau/effect-forms";
import * as Schema from "effect/Schema";
import { assert, describe, expect, it } from "vite-plus/test";
import { formAction, runFormAction } from "../../src/kit/index.ts";
import { post, testFailure } from "./fixtures.ts";

// A stand-in entity command schema: one trimmed, required field.
const Org = Schema.Struct({ name: Schema.Trim.check(Schema.isMinLength(1)) });
const form = Form.make(Org, { defaults: { name: "" } });

// Minimal RequestEvent — formAction only reads `request`, and hands the event
// to the command.
const event = (body: Record<string, string>) => {
  const stub: Pick<RequestEvent, "request"> & { readonly locals: object } = {
    request: post(body),
    locals: { user: "u-1" },
  };
  // SAFETY: formAction reads only `request` and hands `locals` to the command.
  return stub as RequestEvent;
};

describe("formAction (derived SvelteKit page action)", () => {
  it("redirects (throws) to the resource on a valid submission", async () => {
    const action = formAction(
      form,
      async () => "org-1",
      (id) => `/organisations/${id}`,
    );
    await expect(action(event({ name: "Acme" }))).rejects.toMatchObject({
      status: 303,
      location: "/organisations/org-1",
    });
  });

  it("hands the command the RequestEvent", async () => {
    let seen: unknown;
    const action = formAction(
      form,
      async (_input, { locals }) => {
        seen = locals;
        return "org-1";
      },
      (id) => `/organisations/${id}`,
    );
    await expect(action(event({ name: "Acme" }))).rejects.toMatchObject({ status: 303 });
    expect(seen).toEqual({ user: "u-1" });
  });

  it("returns fail({ form }) with field errors on invalid input", async () => {
    let ran = false;
    const action = formAction(
      form,
      async () => {
        ran = true;
        return "x";
      },
      (id: string) => `/${id}`,
    );
    const result = await action(event({ name: "  " }));
    expect(ran).toBe(false); // command never runs on invalid input
    expect(result).toMatchObject({ status: 400, data: { form: { valid: false } } });
    expect(result).toHaveProperty(["data", "form", "errors", "name"]);
  });

  it("returns fail({ message }) when the command throws", async () => {
    const action = formAction(
      form,
      async () => {
        throw testFailure("boom");
      },
      (id: string) => `/${id}`,
    );
    const result = await action(event({ name: "Acme" }));
    expect(result).toMatchObject({ status: 500, data: { message: "boom" } });
  });
});

// SvelteKit 3's `redirect` refuses an external location unless it is passed
// `{ external }`; `formAction` passes none, so `locationFor` must answer a
// same-origin path (#32). Outside a request there is no origin to compare
// against, so here every absolute URL counts as external.
describe("formAction: locationFor must return a same-origin path", () => {
  it("redirects to a same-origin path, query included", async () => {
    const action = formAction(
      form,
      async () => "org-1",
      (id) => `/organisations/${id}?tab=members`,
    );
    const thrown = await action(event({ name: "Acme" })).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({ status: 303, location: "/organisations/org-1?tab=members" });
  });

  it.each([
    ["an absolute URL on another origin", "https://elsewhere.test/organisations/org-1"],
    ["a protocol-relative URL", "//elsewhere.test/organisations/org-1"],
  ])("throws an Error, not a redirect, for %s, after the command ran", async (_, location) => {
    let ran = false;
    const action = formAction(
      form,
      async () => {
        ran = true;
        return "org-1";
      },
      () => location,
    );
    const thrown = await action(event({ name: "Acme" })).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(ran).toBe(true);
    expect(isRedirect(thrown)).toBe(false);
    assert.instanceOf(thrown, Error);
    expect(thrown.message).toMatch(/redirect_external_not_allowed/);
  });

  it("leaves the location unchecked in runFormAction's framework-neutral result", async () => {
    const result = await runFormAction(
      form,
      post({ name: "Acme" }),
      async () => "org-1",
      () => "https://elsewhere.test/organisations/org-1",
    );
    expect(result).toEqual({
      _tag: "Redirect",
      status: 303,
      location: "https://elsewhere.test/organisations/org-1",
    });
  });
});
