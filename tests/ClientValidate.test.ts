import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { validateData, validateField } from "../src/ClientValidate.ts";

const Signup = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(2)),
  email: Schema.String.check(Schema.isMinLength(3)),
});

describe("validateData", () => {
  it("returns no errors for valid data", () => {
    expect(validateData(Signup, { name: "Ada", email: "a@b" })).toEqual({});
  });

  it("returns the nested error tree for invalid data", () => {
    const errors = validateData(Signup, { name: "A", email: "x" });
    expect(errors.name).toBeDefined();
    expect(errors.email).toBeDefined();
  });
});

describe("validateField", () => {
  it("returns just one field's messages", () => {
    const messages = validateField(Signup, { name: "A", email: "ok@x" }, ["name"]);
    expect(messages.length).toBeGreaterThan(0);
  });

  it("returns an empty list for a valid field", () => {
    expect(validateField(Signup, { name: "Ada", email: "ok@x" }, ["name"])).toEqual([]);
  });
});
