import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
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

  it("derives minlength / maxlength from isMinLength / isMaxLength", () => {
    const schema = Schema.Struct({
      name: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(50)),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      name: { required: true, minlength: 2, maxlength: 50 },
    });
  });

  it("derives minlength and maxlength together from isLengthBetween", () => {
    const schema = Schema.Struct({
      code: Schema.String.check(Schema.isLengthBetween(4, 8)),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      code: { required: true, minlength: 4, maxlength: 8 },
    });
  });

  it("derives pattern from isPattern", () => {
    const schema = Schema.Struct({
      slug: Schema.String.check(Schema.isPattern(/^[a-z-]+$/)),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      slug: { required: true, pattern: "^[a-z-]+$" },
    });
  });

  it("derives min / max from the number order checks", () => {
    const schema = Schema.Struct({
      exclusive: Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThan(10)),
      inclusive: Schema.Number.check(
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(10),
      ),
      between: Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 5 })),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      exclusive: { required: true, min: 0, max: 10 },
      inclusive: { required: true, min: 0, max: 10 },
      between: { required: true, min: 1, max: 5 },
    });
  });

  it("derives step from isMultipleOf, and from isInt when no divisor is set", () => {
    const schema = Schema.Struct({
      multiple: Schema.Number.check(Schema.isMultipleOf(5)),
      integer: Schema.Int,
      both: Schema.Number.check(Schema.isMultipleOf(5), Schema.isInt),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      multiple: { required: true, step: 5 },
      integer: { required: true, step: 1 },
      both: { required: true, step: 5 },
    });
  });

  it("derives nothing beyond required for an unannotated custom filter", () => {
    const schema = Schema.Struct({
      value: Schema.String.check(new SchemaAST.Filter(() => undefined)),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      value: { required: true },
    });
  });

  it("unwraps an optional union to derive checks on the wrapped leaf", () => {
    const schema = Schema.Struct({
      bio: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      bio: { required: false, maxlength: 200 },
    });
  });

  it("descends into array items for a struct item schema", () => {
    const schema = Schema.Struct({
      contributors: Schema.Array(
        Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)) }),
      ),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      contributors: { name: { required: true, minlength: 1 } },
    });
  });

  it("descends into array items for a leaf item schema, applying the item's checks", () => {
    const schema = Schema.Struct({
      tags: Schema.Array(Schema.String.check(Schema.isMaxLength(20))),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      tags: { required: true, maxlength: 20 },
    });
  });

  it("folds an optional array's own optionality into the item's required", () => {
    const schema = Schema.Struct({
      tags: Schema.optional(Schema.Array(Schema.String.check(Schema.isMaxLength(20)))),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      tags: { required: false, maxlength: 20 },
    });
  });

  it("derives only required for a fixed-shape tuple, not one element's checks", () => {
    const schema = Schema.Struct({
      pair: Schema.Tuple([
        Schema.String.check(Schema.isMinLength(3)),
        Schema.Number.check(Schema.isGreaterThan(0)),
      ]),
    });
    expect(constraintsFromSchema(schema)).toEqual({
      pair: { required: true },
    });
  });

  it("lets overrides win over derived checks on conflict", () => {
    const schema = Schema.Struct({
      name: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(50)),
    });
    expect(constraintsFromSchema(schema, { name: { maxlength: 10 } })).toEqual({
      name: { required: true, minlength: 2, maxlength: 10 },
    });
  });
});
