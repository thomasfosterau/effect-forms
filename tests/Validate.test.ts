import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import * as SchemaParser from "effect/SchemaParser";
import { getError } from "../src/Errors.ts";
import { validateValue, validateValueSync } from "../src/Validate.ts";

const Field = Schema.String.check(Schema.isMinLength(3));

describe("validateValue", () => {
  it("succeeds with the decoded value", async () => {
    const result = await Effect.runPromise(validateValue(Field, "hello"));
    expect(result).toEqual({ valid: true, data: "hello" });
  });

  it("fails with errors and issues", async () => {
    const result = await Effect.runPromise(validateValue(Field, "hi"));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

describe("validateValueSync", () => {
  const Struct = Schema.Struct({ email: Schema.String.check(Schema.isMinLength(3)) });

  it("validates synchronously", () => {
    expect(validateValueSync(Struct, { email: "a@b.co" })).toEqual({
      valid: true,
      data: { email: "a@b.co" },
    });
  });

  it("reports field errors synchronously", () => {
    const result = validateValueSync(Struct, { email: "x" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(getError(result.errors, ["email"])).toBeDefined();
    }
  });
});

describe("schemaIssuesToFormIssues", () => {
  it("accepts a custom leaf formatter", async () => {
    const exit = SchemaParser.decodeUnknownExit(Field)("x");
    // Build issues directly from a fresh failing decode to exercise the formatter.
    const result = await Effect.runPromise(validateValue(Field, "x", () => "custom message"));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues[0]?.message).toBe("custom message");
    }
    expect(exit._tag).toBe("Failure");
  });
});
