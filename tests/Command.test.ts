import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  blankDefaults,
  createAdapter,
  formInputFields,
  jsonRowsFromField,
  plan,
  updateAdapter,
} from "../src/Command.ts";

// Synthetic command pair exercising every field kind and both tri-state
// shapes — mirrors the host app's flat Create*/Update* structs (required
// bare fields at create; `optional(NullOr(...))` = clearable at update).

const Uuid = Schema.String.check(Schema.isUUID());
const ParentId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ParentId"));
const Row = Schema.Struct({
  id: Schema.optional(Uuid),
  agentId: Schema.String,
  creditedName: Schema.optional(Schema.String),
  orderingPosition: Schema.Finite,
});

const CreateThing = Schema.Struct({
  id: Schema.optional(Uuid),
  title: Schema.String,
  parentId: ParentId,
  note: Schema.optional(Schema.String),
  count: Schema.optional(Schema.Finite),
  publishedOn: Schema.optional(Schema.DateFromString),
  rows: Schema.optional(Schema.Array(Row)),
});

const UpdateThing = Schema.Struct({
  id: Uuid,
  title: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(ParentId)),
  note: Schema.optional(Schema.NullOr(Schema.String)),
  count: Schema.optional(Schema.NullOr(Schema.Finite)),
  publishedOn: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  rows: Schema.optional(Schema.Array(Row)),
});

const thing = plan(CreateThing, UpdateThing);
const byKey = Object.fromEntries(thing.fields.map((field) => [field.key, field]));

describe("Command.plan", () => {
  it("detects the client-generated create id", () => {
    expect(thing.clientId).toBe(true);
    const serverAssigned = plan(
      Schema.Struct({ title: Schema.String }),
      Schema.Struct({ id: Uuid, title: Schema.optional(Schema.String) }),
    );
    expect(serverAssigned.clientId).toBe(false);
  });

  it("keeps update-struct declaration order and excludes id", () => {
    expect(thing.fields.map((field) => field.key)).toEqual([
      "title",
      "parentId",
      "note",
      "count",
      "publishedOn",
      "rows",
    ]);
  });

  it("classifies kinds by decode probes (brands and date transforms included)", () => {
    expect(byKey.title.kind).toBe("text");
    expect(byKey.parentId.kind).toBe("id");
    expect(byKey.note.kind).toBe("text");
    expect(byKey.count.kind).toBe("number");
    expect(byKey.publishedOn.kind).toBe("date");
    expect(byKey.rows.kind).toBe("jsonArray");
  });

  it("throws at plan time on a field kind it cannot derive (boolean)", () => {
    expect(() =>
      plan(
        Schema.Struct({ title: Schema.String, pinned: Schema.optional(Schema.Boolean) }),
        Schema.Struct({ id: Uuid, pinned: Schema.optional(Schema.NullOr(Schema.Boolean)) }),
      ),
    ).toThrow('field "pinned" matches no known kind');
  });

  it("passes required create ids through raw and never trims id fields", () => {
    const adaptCreate = createAdapter(thing);
    expect(adaptCreate({ title: "T", parentId: " p1 " }).parentId).toBe(" p1 ");
    const adaptUpdate = updateAdapter(thing);
    expect(adaptUpdate({ id: "u1", parentId: " p1 " }).parentId).toBe(" p1 ");
  });

  it("reads required-at-create and clearable-at-update off the struct shapes", () => {
    expect(byKey.title.createRequired).toBe(true);
    expect(byKey.parentId.createRequired).toBe(true);
    expect(byKey.note.createRequired).toBe(false);
    expect(byKey.note.updateClearable).toBe(true);
    expect(byKey.title.updateClearable).toBe(false);
    expect(byKey.rows.updateClearable).toBe(false);
  });
});

describe("Command.formInputFields / blankDefaults", () => {
  it("derives the all-string create shape with min-length on required fields", () => {
    const fields = formInputFields(thing, "create");
    const CreateInput = Schema.Struct(fields as Record<string, never>);
    const decode = Schema.decodeUnknownSync(CreateInput as Schema.Codec<unknown>);
    expect(() => decode({ title: "", parentId: "x" })).toThrow();
    expect(
      decode({ title: "T", parentId: "x", note: "n" }) as Record<string, unknown>,
    ).toMatchObject({ title: "T", parentId: "x", note: "n" });
  });

  it("derives the update shape keyed by a UUID id", () => {
    const fields = formInputFields(thing, "update");
    const UpdateInput = Schema.Struct(fields as Record<string, never>);
    const decode = Schema.decodeUnknownSync(UpdateInput as Schema.Codec<unknown>);
    expect(() => decode({ id: "not-a-uuid" })).toThrow();
    expect(decode({ id: "9f8c1c2e-4b3a-4c5d-8e6f-0a1b2c3d4e5f" })).toMatchObject({
      id: "9f8c1c2e-4b3a-4c5d-8e6f-0a1b2c3d4e5f",
    });
  });

  it("supports per-field schema overrides, spread last", () => {
    const fields = formInputFields(thing, "create", { title: Schema.optional(Schema.String) });
    const CreateInput = Schema.Struct(fields as Record<string, never>);
    const decode = Schema.decodeUnknownSync(CreateInput as Schema.Codec<unknown>);
    expect(decode({ parentId: "x" })).toMatchObject({ parentId: "x" });
  });

  it("emits blank defaults for every in-mode field", () => {
    expect(blankDefaults(thing, "create")).toEqual({
      id: "",
      title: "",
      parentId: "",
      note: "",
      count: "",
      publishedOn: "",
      rows: "",
    });
    expect(blankDefaults(thing, "update").id).toBe("");
  });
});

describe("Command.createAdapter", () => {
  const adapt = createAdapter(thing);

  it("trims required text, skips blanks, passes required ids through raw", () => {
    expect(
      adapt({
        id: " u1 ",
        title: " T ",
        parentId: "p1",
        note: "  ",
        count: "",
        publishedOn: "",
        rows: "",
      }),
    ).toStrictEqual({
      id: "u1",
      title: "T",
      parentId: "p1",
      note: undefined,
      count: undefined,
      publishedOn: undefined,
      rows: undefined,
    });
  });

  it("coerces numbers, trims dates, and parses row lists", () => {
    const out = adapt({
      title: "T",
      parentId: "p1",
      count: "7",
      publishedOn: " 2024-01-02 ",
      rows: JSON.stringify([{ agentId: "a1" }]),
    });
    expect(out.count).toBe(7);
    expect(out.publishedOn).toBe("2024-01-02");
    expect(out.rows).toEqual([
      { id: undefined, agentId: "a1", creditedName: undefined, orderingPosition: 0 },
    ]);
  });

  it("applies per-field overrides", () => {
    const withDefault = createAdapter(thing, {
      title: (raw) => raw?.trim() || "Untitled",
    });
    expect(withDefault({ title: " ", parentId: "p1" }).title).toBe("Untitled");
  });
});

describe("Command.updateAdapter", () => {
  const adapt = updateAdapter(thing);

  it("encodes the tri-state: value sets, blank clears clearables, absent skips", () => {
    expect(
      adapt({ id: "u1", title: "", note: "", count: "", publishedOn: "", parentId: "" }),
    ).toStrictEqual({
      id: "u1",
      title: undefined,
      parentId: null,
      note: null,
      count: null,
      publishedOn: null,
      rows: undefined,
    });
    expect(adapt({ id: "u1" })).toStrictEqual({
      id: "u1",
      title: undefined,
      parentId: undefined,
      note: undefined,
      count: undefined,
      publishedOn: undefined,
      rows: undefined,
    });
  });

  it("sets values and keeps dates encoded", () => {
    const out = adapt({ id: "u1", title: " T ", count: "3", publishedOn: "2024-01-02" });
    expect(out.title).toBe("T");
    expect(out.count).toBe(3);
    expect(out.publishedOn).toBe("2024-01-02");
  });
});

describe("Command.jsonRowsFromField", () => {
  it("skips blank, clears on empty array, falls back to index ordering", () => {
    expect(jsonRowsFromField(undefined, "rows")).toBeUndefined();
    expect(jsonRowsFromField("  ", "rows")).toBeUndefined();
    expect(jsonRowsFromField("[]", "rows")).toEqual([]);
    expect(
      jsonRowsFromField(
        JSON.stringify([{ agentId: "a", orderingPosition: 4 }, { agentId: "b" }]),
        "rows",
      ),
    ).toEqual([
      { id: undefined, agentId: "a", creditedName: undefined, orderingPosition: 4 },
      { id: undefined, agentId: "b", creditedName: undefined, orderingPosition: 1 },
    ]);
  });

  it("throws plain errors on malformed payloads", () => {
    expect(() => jsonRowsFromField("{not json", "rows")).toThrow("expected JSON array");
    expect(() => jsonRowsFromField("{}", "rows")).toThrow("expected array");
    expect(() => jsonRowsFromField("[1]", "rows")).toThrow("entry at index 0");
    expect(() => jsonRowsFromField('[{"creditedName":"x"}]', "rows")).toThrow("missing agentId");
  });
});
