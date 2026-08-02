import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";
import { describe, expect, it } from "vite-plus/test";
import { getError } from "../src/Errors.ts";
import { makeArrayField } from "../src/Field.ts";
import { fromBuilder } from "../src/Form.ts";
import { buildSchema, empty, isFormBuilder } from "../src/FormBuilder.ts";

const run = <A>(eff: Effect.Effect<A>) => Effect.runSync(eff);

describe("FormBuilder composition", () => {
  it("accumulates fields via addField (key+schema, def, array) and merge", () => {
    const names = empty.addField("name", Schema.String).addField("age", Schema.FiniteFromString);
    const extra = empty.addField(makeArrayField("tags", Schema.String));
    const builder = names.merge(extra);

    expect(isFormBuilder(builder)).toBe(true);
    expect(Object.keys(builder.fields).sort()).toEqual(["age", "name", "tags"]);
  });

  it("is immutable — addField returns a new builder", () => {
    const base = empty.addField("a", Schema.String);
    const extended = base.addField("b", Schema.String);
    expect(Object.keys(base.fields)).toEqual(["a"]);
    expect(Object.keys(extended.fields)).toEqual(["a", "b"]);
  });
});

describe("FormBuilder.buildSchema", () => {
  const builder = empty
    .addField("name", Schema.String.check(Schema.isMinLength(2)))
    .addField("age", Schema.FiniteFromString)
    .addField(makeArrayField("tags", Schema.String));

  it("collapses to a schema that decodes fields and array items", () => {
    const schema = buildSchema(builder);
    const decoded = run(
      SchemaParser.decodeUnknownEffect(schema)({ name: "Ada", age: "31", tags: ["x", "y"] }),
    );
    expect(decoded).toEqual({ name: "Ada", age: 31, tags: ["x", "y"] });
  });
});

describe("FormBuilder sync refine (cross-field)", () => {
  const builder = empty
    .addField("password", Schema.String)
    .addField("confirm", Schema.String)
    .refine((v) =>
      v.password === v.confirm ? undefined : { path: ["confirm"], issue: "must match" },
    );
  const form = fromBuilder(builder);

  it("passes when the cross-field rule holds", () => {
    const state = run(form.validate({ password: "secret", confirm: "secret" }));
    expect(state.valid).toBe(true);
  });

  it("routes a cross-field failure to the targeted field", () => {
    const state = run(form.validate({ password: "secret", confirm: "nope" }));
    expect(state.valid).toBe(false);
    expect(getError(state.errors, ["confirm"])).toEqual(["must match"]);
  });
});

describe("Form.fromBuilder", () => {
  const builder = empty
    .addField("name", Schema.String.check(Schema.isMinLength(2)))
    .addField(makeArrayField("tags", Schema.String));
  const form = fromBuilder(builder, { id: "signup" });

  it("derives blank encoded defaults when none are given", () => {
    expect(form.empty().data).toEqual({ name: "", tags: [] });
  });

  it("retains posted values on a field failure", () => {
    const state = run(form.validate({ name: "A", tags: ["x"] }));
    expect(state.valid).toBe(false);
    expect(state.data.name).toBe("A");
    expect(getError(state.errors, ["name"])).toBeDefined();
  });
});

describe("FormBuilder async refineEffect", () => {
  const builder = empty
    .addField("name", Schema.String)
    .refineEffect((v) =>
      Effect.succeed(v.name === "taken" ? { path: ["name"], issue: "already taken" } : undefined),
    );
  const form = fromBuilder(builder);

  it("passes when the async rule holds", () => {
    const state = run(form.validate({ name: "free" }));
    expect(state.valid).toBe(true);
  });

  it("folds an async failure into the error tree", () => {
    const state = run(form.validate({ name: "taken" }));
    expect(state.valid).toBe(false);
    expect(getError(state.errors, ["name"])).toEqual(["already taken"]);
  });
});
