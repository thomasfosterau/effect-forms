import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { constraintsFromSchema } from "../src/Constraints.ts";

describe("constraintsFromSchema", () => {
  it("marks non-optional fields as required and optional as not", () => {
    const schema = Schema.Struct({
      title: Schema.String,
      subtitle: Schema.optional(Schema.String),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      title: { required: true },
      subtitle: { required: false },
    });
  });

  it("descends into nested structs", () => {
    const schema = Schema.Struct({
      author: Schema.Struct({ name: Schema.String, bio: Schema.optional(Schema.String) }),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      author: { name: { required: true }, bio: { required: false } },
    });
  });

  it("deep-merges overrides over the derived tree", () => {
    const schema = Schema.Struct({ title: Schema.String });
    expect(constraintsFromSchema(schema, { title: { maxlength: 80 } })).toEqual({
      title: { required: true, maxlength: 80 },
    });
  });

  it("returns an empty tree for non-struct schemas", () => {
    expect(constraintsFromSchema(Schema.String)).toEqual({});
  });
});
