/**
 * Worked example: website's `routes/login/+page.server.ts` (its default
 * action, `signInAction`) written with `formAction`. Executed by
 * `login.example.test.ts`, so it stays a program that runs, not prose.
 *
 * The app's version hand-rolls what `formAction` now owns: validate, blank
 * the password before any state rides back, turn the session transport's
 * 401 into a whole-form message that never reveals whether the email exists,
 * rethrow any other failure to `handleError`, and 303 to a same-origin
 * `redirectTo`.
 *
 * @module examples/login.page.server
 */
import { Form, State } from "@thomasfosterau/effect-forms";
import { CommandFailure, formAction } from "@thomasfosterau/effect-forms-svelte/kit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// ── What the application provides (`#lib/server/...`) ──────────────────

/** The session transport's failure: a status from the auth Worker. */
export class SessionCallError extends Schema.TaggedError<SessionCallError>()("SessionCallError", {
  status: Schema.Number,
  message: Schema.String,
}) {}

/** Raised when the app's hooks never put a session transport on `event.locals`. */
class MissingSessionTransport extends Schema.TaggedError<MissingSessionTransport>()(
  "MissingSessionTransport",
  { message: Schema.String },
) {}

/** The session transport, reached through `event.locals` in this example. */
export interface SessionTransport {
  readonly signIn: (credentials: {
    readonly email: string;
    readonly password: string;
    readonly rememberMe: boolean;
  }) => Promise<void>;
}

declare global {
  // oxlint-disable-next-line typescript/no-namespace -- SvelteKit's app-level type augmentation
  namespace App {
    interface Locals {
      session?: SessionTransport;
    }
  }
}

/** A same-origin redirect target, or `fallback`. */
const safeRedirect = (target: string | undefined, fallback: string): string =>
  target !== undefined && target.startsWith("/") && !target.startsWith("//") ? target : fallback;

// ── The page ───────────────────────────────────────────────────────────

const SignInFields = Schema.Struct({
  email: Schema.String,
  // `_password`, so devtools don't auto-fill it from the wrong context.
  _password: Schema.String,
  redirectTo: Schema.optional(Schema.String),
});

const signInForm = Form.make(SignInFields, {
  defaults: { email: "", _password: "", redirectTo: undefined },
  id: "sign-in",
});

type SignIn = typeof SignInFields.Type;

/** Blank the password before a state is echoed back to the browser. */
const blankPassword = (state: State.FormState<SignIn>): State.FormState<SignIn> => ({
  ...state,
  data: { ...state.data, _password: "" },
});

/** A 401 → one generic whole-form message; everything else is unexpected. */
const classify: CommandFailure.Classify = (cause) =>
  cause instanceof SessionCallError && cause.status === 401
    ? Option.some(CommandFailure.message(401, "Invalid email or password"))
    : Option.none();

export const actions = {
  default: formAction(
    signInForm,
    (input, { locals }) => {
      if (locals.session === undefined)
        throw new MissingSessionTransport({ message: "no session transport" });
      return locals.session.signIn({
        email: input.email,
        password: input._password,
        rememberMe: true,
      });
    },
    (_, input) => safeRedirect(input.redirectTo, "/"),
    { classify, redact: blankPassword, unrecognised: "throw" },
  ),
};
