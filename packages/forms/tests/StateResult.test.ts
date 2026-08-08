import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";
import { describe, expect, it } from "vite-plus/test";
import { getError } from "../src/Errors.ts";
import { errorResult, failure, type FormActionResult, redirect, success } from "../src/Result.ts";
import { FormStateSchema, isValid, make, withError, withMessage } from "../src/State.ts";

describe("State.make", () => {
  it("defaults valid to no-errors and posted to false", () => {
    const state = make({ name: "" });
    expect(state).toMatchObject({ id: "default", valid: true, posted: false, data: { name: "" } });
  });

  it("derives valid=false when errors are present", () => {
    const state = make({ name: "" }, { errors: { name: ["Required"] } });
    expect(state.valid).toBe(false);
    expect(isValid(state)).toBe(false);
  });

  it("only includes message/constraints when provided", () => {
    const state = make({ a: 1 });
    expect("message" in state).toBe(false);
    expect("constraints" in state).toBe(false);
  });
});

describe("withMessage / withError", () => {
  it("withMessage attaches a status payload", () => {
    const state = withMessage(make({ a: 1 }), { text: "Saved", type: "success" });
    expect(state.message).toEqual({ text: "Saved", type: "success" });
  });

  it("withError adds a field error and forces invalid", () => {
    const state = withError(make({ email: "x" }), ["email"], "Already taken");
    expect(state.valid).toBe(false);
    expect(getError(state.errors, ["email"])).toEqual(["Already taken"]);
  });
});

describe("FormStateSchema", () => {
  it("round-trips a state across encode/decode", () => {
    const schema = FormStateSchema(Schema.Struct({ name: Schema.String }));
    const state = make({ name: "Ada" }, { errors: { name: ["x"] } });
    const decoded = Effect.runSync(SchemaParser.decodeUnknownEffect(schema)(state));
    expect(decoded.data).toEqual({ name: "Ada" });
    expect(decoded.valid).toBe(false);
  });
});

describe("FormActionResult", () => {
  it("constructs and matches each variant", () => {
    const results: FormActionResult<{ a: number }>[] = [
      success(make({ a: 1 })),
      failure(make({ a: 2 })),
      redirect("/done"),
      errorResult("boom"),
    ];
    const tags = results.map((r) =>
      Match.value(r).pipe(
        Match.tag("Success", () => "ok"),
        Match.tag("Failure", () => "bad"),
        Match.tag("Redirect", (x) => x.location),
        Match.tag("Error", (x) => x.message),
        Match.exhaustive,
      ),
    );
    expect(tags).toEqual(["ok", "bad", "/done", "boom"]);
  });

  it("applies sensible default statuses", () => {
    expect(success(make({}, {})).status).toBe(200);
    expect(failure(make({}, {})).status).toBe(400);
    expect(redirect("/x").status).toBe(303);
    expect(errorResult("x").status).toBe(500);
  });
});
