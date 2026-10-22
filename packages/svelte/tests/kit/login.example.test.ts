/**
 * Runs the worked example in `examples/login.page.server.ts` (website's login
 * action) against the real `@sveltejs/kit` `redirect()` / `fail()`.
 */
import type { RequestEvent } from "@sveltejs/kit";
import { describe, expect, it, vi } from "vite-plus/test";
import { actions, SessionCallError, type SessionTransport } from "./examples/login.page.server.ts";
import { post } from "./fixtures.ts";

const event = (body: Record<string, string>, session: SessionTransport) =>
  // SAFETY: formAction reads only `request`; the example's command reads `locals.session`.
  ({ request: post(body), locals: { session } }) as RequestEvent;

const transport = (signIn: SessionTransport["signIn"]): SessionTransport => ({
  signIn: vi.fn(signIn),
});

describe("the login example", () => {
  it("signs in and 303s to a same-origin redirectTo", async () => {
    const session = transport(async () => {});
    await expect(
      actions.default(
        event({ email: "a@example.test", _password: "hunter2", redirectTo: "/drafts" }, session),
      ),
    ).rejects.toMatchObject({ status: 303, location: "/drafts" });
    expect(session.signIn).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "hunter2",
      rememberMe: true,
    });
  });

  it("refuses an off-site redirectTo", async () => {
    const session = transport(async () => {});
    await expect(
      actions.default(
        event({ email: "a@example.test", _password: "x", redirectTo: "//evil.test" }, session),
      ),
    ).rejects.toMatchObject({ location: "/" });
  });

  it("answers a 401 with a generic root message and a blanked password", async () => {
    const session = transport(async () => {
      throw new SessionCallError({ status: 401, message: "Unauthorized" });
    });
    const result = await actions.default(
      event({ email: "a@example.test", _password: "wrong" }, session),
    );
    expect(result).toMatchObject({
      status: 401,
      data: {
        form: {
          data: { email: "a@example.test", _password: "" },
          errors: { _errors: ["Invalid email or password"] },
        },
      },
    });
  });

  it("rethrows any other failure to handleError", async () => {
    const outage = new SessionCallError({ status: 503, message: "auth Worker unavailable" });
    const session = transport(async () => {
      throw outage;
    });
    await expect(
      actions.default(event({ email: "a@example.test", _password: "x" }, session)),
    ).rejects.toBe(outage);
  });
});
