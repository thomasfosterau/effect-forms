import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  defaultEncodedValues,
  defaultValue,
  isArrayFieldDef,
  isFieldDef,
  makeArrayField,
  makeField,
} from "../src/Field.ts";

describe("Field constructors and guards", () => {
  it("builds scalar and array field defs with matching guards", () => {
    const scalar = makeField("name", Schema.String);
    const array = makeArrayField("tags", Schema.String);
    expect(isFieldDef(scalar)).toBe(true);
    expect(isArrayFieldDef(scalar)).toBe(false);
    expect(isArrayFieldDef(array)).toBe(true);
    expect(isFieldDef(array)).toBe(false);
  });
});

describe("Field.defaultValue", () => {
  it("seeds scalars to empty string (including coercing leaves)", () => {
    expect(defaultValue(Schema.String)).toBe("");
    expect(defaultValue(Schema.NumberFromString)).toBe("");
    expect(defaultValue(Schema.String.check(Schema.isMinLength(2)))).toBe("");
  });

  it("seeds arrays to [] and recurses into structs", () => {
    expect(defaultValue(Schema.Array(Schema.String))).toEqual([]);
    expect(
      defaultValue(Schema.Struct({ name: Schema.String, age: Schema.NumberFromString })),
    ).toEqual({
      name: "",
      age: "",
    });
  });

  it("recurses into a struct wrapped in a union (optional / nullable)", () => {
    const Address = Schema.Struct({ street: Schema.String });
    expect(defaultValue(Schema.NullOr(Address))).toEqual({ street: "" });
    expect(defaultValue(Schema.optional(Address))).toEqual({ street: "" });
  });
});

describe("Field.defaultEncodedValues", () => {
  it("seeds a blank encoded value per field", () => {
    const fields = {
      name: makeField("name", Schema.String),
      tags: makeArrayField("tags", Schema.String),
    };
    expect(defaultEncodedValues(fields)).toEqual({ name: "", tags: [] });
  });
});
