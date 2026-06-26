import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { getError } from "../src/Errors.ts";
import { make } from "../src/Form.ts";

const Signup = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(2)),
  age: Schema.optional(Schema.NumberFromString),
});

const form = make(Signup, {
  id: "signup",
  defaults: { name: "", age: undefined },
});

const run = <A>(eff: Effect.Effect<A>) => Effect.runSync(eff);

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

  it("derives constraints from the schema (required reflects optionality)", () => {
    expect(form.constraints).toEqual({ name: { required: true }, age: { required: false } });
  });
});

describe("Form.make → validate", () => {
  it("returns a valid state with decoded (coerced) data", () => {
    const state = run(form.validate({ name: "Ada", age: "31" }));
    expect(state.valid).toBe(true);
    expect(state.posted).toBe(true);
    expect(state.data).toEqual({ name: "Ada", age: 31 });
    expect(state.errors).toEqual({});
  });

  it("returns an invalid state with field errors and retains posted values", () => {
    const state = run(form.validate({ name: "A" }));
    expect(state.valid).toBe(false);
    expect(state.posted).toBe(true);
    // posted values are preserved so the form re-renders user input
    expect(state.data.name).toBe("A");
    expect(getError(state.errors, ["name"])).toBeDefined();
  });

  it("treats null input as an empty (unposted) form", () => {
    const state = run(form.validate(null));
    expect(state.posted).toBe(false);
    expect(state.valid).toBe(false);
  });

  it("parses a URLSearchParams body", () => {
    const body = new URLSearchParams({ name: "Bob", age: "40" });
    const state = run(form.validate(body));
    expect(state.valid).toBe(true);
    expect(state.data).toEqual({ name: "Bob", age: 40 });
  });

  it("validates a Request body", async () => {
    const body = new URLSearchParams({ name: "Cy", age: "5" });
    const request = new Request("https://example.test", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const state = await Effect.runPromise(form.validate(request));
    expect(state.valid).toBe(true);
    expect(state.data).toEqual({ name: "Cy", age: 5 });
  });

  it("can opt out of constraint derivation", () => {
    const bare = make(Signup, {
      defaults: { name: "", age: undefined },
      deriveConstraints: false,
    });
    expect(bare.constraints).toEqual({});
  });
});
