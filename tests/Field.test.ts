import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  defaultEncodedValues,
  defaultItemAt,
  defaultValue,
  isArrayFieldDef,
  isFieldDef,
  makeArrayField,
  makeField,
  schemaAt,
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
    expect(defaultValue(Schema.FiniteFromString)).toBe("");
    expect(defaultValue(Schema.String.check(Schema.isMinLength(2)))).toBe("");
  });

  it("seeds arrays to [] and recurses into structs", () => {
    expect(defaultValue(Schema.Array(Schema.String))).toEqual([]);
    expect(
      defaultValue(Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })),
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

describe("Field.schemaAt / defaultItemAt", () => {
  const Author = Schema.Struct({
    name: Schema.String,
    emails: Schema.Array(Schema.Struct({ address: Schema.String, label: Schema.String })),
  });
  const Form = Schema.Struct({
    title: Schema.String,
    tags: Schema.Array(Schema.String),
    authors: Schema.Array(Author),
  });

  it("resolves a top-level array field's item schema", () => {
    expect(defaultItemAt(Form, ["tags"])).toBe("");
    expect(defaultItemAt(Form, ["authors"])).toEqual({ name: "", emails: [] });
  });

  it("walks through a struct into a nested array field", () => {
    // authors[0].emails is an array nested two levels deep under a top-level array.
    expect(defaultItemAt(Form, ["authors", 0, "emails"])).toEqual({ address: "", label: "" });
  });

  it("resolves a struct property's schema", () => {
    const ast = schemaAt(Form, ["authors", 0, "name"]);
    expect(ast).toBeDefined();
  });

  it("returns '' when the path doesn't resolve to an array", () => {
    expect(defaultItemAt(Form, ["title"])).toBe("");
    expect(defaultItemAt(Form, ["missing"])).toBe("");
    expect(defaultItemAt(Form, ["authors", 0, "name"])).toBe("");
  });

  it("resolves through an optional / nullable wrapper", () => {
    const WithOptionalAuthors = Schema.Struct({
      authors: Schema.optional(Schema.Array(Author)),
    });
    expect(defaultItemAt(WithOptionalAuthors, ["authors"])).toEqual({ name: "", emails: [] });

    const WithNullableAuthors = Schema.Struct({
      authors: Schema.NullOr(Schema.Array(Author)),
    });
    expect(defaultItemAt(WithNullableAuthors, ["authors"])).toEqual({ name: "", emails: [] });
  });
});
