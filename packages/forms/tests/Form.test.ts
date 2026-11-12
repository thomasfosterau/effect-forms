import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { it } from "@effect/vitest";
import { assert, describe, expect } from "vite-plus/test";
import { getError } from "../src/Errors.ts";
import { make, UnreadableBody } from "../src/Form.ts";

const Signup = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(2)),
  age: Schema.optional(Schema.FiniteFromString),
});

const form = make(Signup, {
  id: "signup",
  defaults: { name: "", age: undefined },
});

describe("Form.make → empty", () => {
  it("seeds an unposted, invalid form from defaults", () => {
    const state = form.empty();
    expect(state).toMatchObject({
      id: "signup",
      valid: false,
      posted: false,
      data: { name: "", age: undefined },
      errors: {},
    });
  });

  it("derives constraints from the schema (required reflects optionality, minlength from isMinLength)", () => {
    expect(form.constraints).toEqual({
      name: { required: true, minlength: 2 },
      age: { required: false },
    });
  });
});

describe("Form.make → validate", () => {
  it.effect("returns a valid state with decoded (coerced) data", () =>
    Effect.gen(function* () {
      const state = yield* form.validate({ name: "Ada", age: "31" });
      expect(state.valid).toBe(true);
      expect(state.posted).toBe(true);
      expect(state.data).toEqual({ name: "Ada", age: 31 });
      expect(state.errors).toEqual({});
    }),
  );

  it.effect("returns an invalid state with field errors and retains posted values", () =>
    Effect.gen(function* () {
      const state = yield* form.validate({ name: "A" });
      expect(state.valid).toBe(false);
      expect(state.posted).toBe(true);
      // posted values are preserved so the form re-renders user input
      expect(state.data.name).toBe("A");
      expect(Option.isSome(getError(state.errors, ["name"]))).toBe(true);
    }),
  );

  it.effect("treats no input as an empty (unposted) form", () =>
    Effect.gen(function* () {
      const state = yield* form.validate();
      expect(state.posted).toBe(false);
      expect(state.valid).toBe(false);
    }),
  );

  it.effect("parses a URLSearchParams body", () =>
    Effect.gen(function* () {
      const body = new URLSearchParams({ name: "Bob", age: "40" });
      const state = yield* form.validate(body);
      expect(state.valid).toBe(true);
      expect(state.data).toEqual({ name: "Bob", age: 40 });
    }),
  );

  it.effect("validates a Request body", () =>
    Effect.gen(function* () {
      const body = new URLSearchParams({ name: "Cy", age: "5" });
      const request = new Request("https://example.test", {
        method: "POST",
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      const state = yield* form.validate(request);
      expect(state.valid).toBe(true);
      expect(state.data).toEqual({ name: "Cy", age: 5 });
    }),
  );

  it.effect("dies with UnreadableBody, carrying the rejection, on a body that isn't a form", () =>
    Effect.gen(function* () {
      const request = new Request("https://example.test", {
        method: "POST",
        body: `{"name":"Cy"}`,
        headers: { "content-type": "application/json" },
      });
      const exit = yield* Effect.exit(form.validate(request));
      assert(Exit.isFailure(exit));
      const defect = Cause.squash(exit.cause);
      assert.instanceOf(defect, UnreadableBody);
      assert.instanceOf(defect.cause, Error);
    }),
  );

  it("can opt out of constraint derivation", () => {
    const bare = make(Signup, {
      defaults: { name: "", age: undefined },
      deriveConstraints: false,
    });
    expect(bare.constraints).toEqual({});
  });
});
