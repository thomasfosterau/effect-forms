/**
 * `formAction` (the derived SvelteKit page action) — ported from the
 * applications' `form-action-derive.test.ts`, against the real
 * `@sveltejs/kit` `redirect()` / `fail()`.
 */
import type { RequestEvent } from "@sveltejs/kit";
import { Form } from "@thomasfosterau/effect-forms";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { formAction } from "../../src/kit/index.ts";
import { post, testFailure } from "./fixtures.ts";

// A stand-in entity command schema: one trimmed, required field.
const Org = Schema.Struct({ name: Schema.Trim.check(Schema.isMinLength(1)) });
const form = Form.make(Org, { defaults: { name: "" } });

// Minimal RequestEvent — formAction only reads `request`, and hands the event
// to the command.
const event = (body: Record<string, string>) =>
  ({ request: post(body), locals: { user: "u-1" } }) as unknown as RequestEvent;

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
    expect((result as { data: { form: { errors: object } } }).data.form.errors).toHaveProperty(
      "name",
    );
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
