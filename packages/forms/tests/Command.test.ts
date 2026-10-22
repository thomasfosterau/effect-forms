import { describe, expect, it } from "vite-plus/test";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
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
// Mirrors `Visibility` (packages/models/src/models/content.ts) — a plain
// string-literal union, never nullable.
const Visibility = Schema.Literals(["public", "private", "unlisted"]);
// Mirrors `InlineDocumentShape` / `BlockDocumentShape` (@thomasfosterau/editor)
// structurally: a struct, not a `Schema.declare`.
const Doc = Schema.Struct({ type: Schema.Literal("doc"), text: Schema.String });

const CreateThing = Schema.Struct({
  id: Schema.optional(Uuid),
  title: Schema.String,
  parentId: ParentId,
  note: Schema.optional(Schema.String),
  count: Schema.optional(Schema.Finite),
  publishedOn: Schema.optional(Schema.DateFromString),
  rows: Schema.optional(Schema.Array(Row)),
  // Bare, like `CreateQuestion.pinned` — required at create, defaults `false`.
  isPinned: Schema.Boolean,
  visibility: Schema.optional(Visibility),
  // Bare, like `CreateQuestion.title` — required at create.
  caption: Doc,
  document: Schema.optional(Doc),
});

const UpdateThing = Schema.Struct({
  id: Uuid,
  title: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(ParentId)),
  note: Schema.optional(Schema.NullOr(Schema.String)),
  count: Schema.optional(Schema.NullOr(Schema.Finite)),
  publishedOn: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  rows: Schema.optional(Schema.Array(Row)),
  // Not `NullOr` — like `UpdateQuestion.pinned`, boolean fields skip rather
  // than clear.
  isPinned: Schema.optional(Schema.Boolean),
  visibility: Schema.optional(Visibility),
  caption: Schema.optional(Schema.NullOr(Doc)),
  document: Schema.optional(Schema.NullOr(Doc)),
});

const thing = plan(CreateThing, UpdateThing);
const byKey = Record.fromEntries(Arr.map(thing.fields, (field) => [field.key, field] as const));

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
      "isPinned",
      "visibility",
      "caption",
      "document",
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

  it("classifies a bare Schema.Boolean field as boolean (decode probe)", () => {
    expect(byKey.isPinned.kind).toBe("boolean");
  });

  it("classifies a literal union as enum and reads its options off the AST", () => {
    expect(byKey.visibility.kind).toBe("enum");
    expect(byKey.visibility.options).toEqual(["public", "private", "unlisted"]);
    // Non-enum kinds carry no `options`.
    expect(byKey.title.options).toBeUndefined();
  });

  it("classifies a struct-shaped field (inline/block document JSON) as structured", () => {
    expect(byKey.caption.kind).toBe("structured");
    expect(byKey.document.kind).toBe("structured");
  });

  it("still throws at plan time on a Schema.declare'd field (uploads, images)", () => {
    const Upload = Schema.declare(
      (u): u is { readonly bytes: Uint8Array } => Predicate.isObjectOrArray(u) && "bytes" in u,
    );
    expect(() =>
      plan(
        Schema.Struct({ title: Schema.String, file: Upload }),
        Schema.Struct({ id: Uuid, file: Schema.optional(Upload) }),
      ),
    ).toThrow('field "file" matches no known kind');
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
    // Bare boolean/struct fields are create-required like any other bare field.
    expect(byKey.isPinned.createRequired).toBe(true);
    expect(byKey.isPinned.updateClearable).toBe(false);
    expect(byKey.visibility.createRequired).toBe(false);
    expect(byKey.visibility.updateClearable).toBe(false);
    expect(byKey.caption.createRequired).toBe(true);
    expect(byKey.caption.updateClearable).toBe(true);
    expect(byKey.document.createRequired).toBe(false);
    expect(byKey.document.updateClearable).toBe(true);
  });
});

type FormInputField = Schema.String | Schema.optional<Schema.String>;

const decodeFormInput = (fields: { readonly [key: string]: Schema.Top }) => {
  // SAFETY: formInputFields emits only `Schema.String` (possibly `.check`ed) or
  // `Schema.optional(Schema.String)` per key, and the overrides passed below are too.
  const stringFields = fields as { readonly [key: string]: FormInputField };
  return Schema.decodeUnknownSync(Schema.Struct(stringFields));
};

describe("Command.formInputFields / blankDefaults", () => {
  it("derives the all-string create shape with min-length on required fields", () => {
    const fields = formInputFields(thing, "create");
    const decode = decodeFormInput(fields);
    expect(() => decode({ title: "", parentId: "x", isPinned: "true", caption: "{}" })).toThrow();
    expect(
      decode({
        title: "T",
        parentId: "x",
        note: "n",
        isPinned: "true",
        caption: "{}",
      }),
    ).toMatchObject({ title: "T", parentId: "x", note: "n" });
  });

  it("derives the update shape keyed by a UUID id", () => {
    const fields = formInputFields(thing, "update");
    const decode = decodeFormInput(fields);
    expect(() => decode({ id: "not-a-uuid" })).toThrow();
    expect(decode({ id: "9f8c1c2e-4b3a-4c5d-8e6f-0a1b2c3d4e5f" })).toMatchObject({
      id: "9f8c1c2e-4b3a-4c5d-8e6f-0a1b2c3d4e5f",
    });
  });

  it("supports per-field schema overrides, spread last", () => {
    const fields = formInputFields(thing, "create", { title: Schema.optional(Schema.String) });
    const decode = decodeFormInput(fields);
    expect(decode({ parentId: "x", isPinned: "true", caption: "{}" })).toMatchObject({
      parentId: "x",
    });
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
      isPinned: "",
      visibility: "",
      caption: "",
      document: "",
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
      // Boolean create-required defaults `false`; the rest skip (`undefined`)
      // — structured ignores required-ness, see coerceBoolean / structuredFromField.
      isPinned: false,
      visibility: undefined,
      caption: undefined,
      document: undefined,
    });
  });

  it("coerces numbers, trims dates, and parses row lists", () => {
    const out = adapt({
      title: "T",
      parentId: "p1",
      count: "7",
      publishedOn: " 2024-01-02 ",
      rows: '[{"agentId":"a1"}]',
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
      // Not clearable (isPinned/visibility) skip; clearable structured fields
      // (caption/document) clear on blank, unlike jsonArray's rows.
      isPinned: undefined,
      visibility: undefined,
      caption: null,
      document: null,
    });
    expect(adapt({ id: "u1" })).toStrictEqual({
      id: "u1",
      title: undefined,
      parentId: undefined,
      note: undefined,
      count: undefined,
      publishedOn: undefined,
      rows: undefined,
      isPinned: undefined,
      visibility: undefined,
      caption: null,
      document: null,
    });
  });

  it("sets values and keeps dates encoded", () => {
    const out = adapt({ id: "u1", title: " T ", count: "3", publishedOn: "2024-01-02" });
    expect(out.title).toBe("T");
    expect(out.count).toBe(3);
    expect(out.publishedOn).toBe("2024-01-02");
  });
});

describe("Command.createAdapter / updateAdapter — boolean, enum, structured kinds", () => {
  const create = createAdapter(thing);
  const update = updateAdapter(thing);

  it("boolean: create defaults an absent/blank field to false, never skips", () => {
    expect(create({ title: "T", parentId: "p1" }).isPinned).toBe(false);
    expect(create({ title: "T", parentId: "p1", isPinned: "" }).isPinned).toBe(false);
    expect(create({ title: "T", parentId: "p1", isPinned: "true" }).isPinned).toBe(true);
    expect(create({ title: "T", parentId: "p1", isPinned: "false" }).isPinned).toBe(false);
  });

  it('boolean: update skips an absent field (carries forward); only the literal "true" reads true', () => {
    expect(update({ id: "u1" }).isPinned).toBeUndefined();
    expect(update({ id: "u1", isPinned: "true" }).isPinned).toBe(true);
    expect(update({ id: "u1", isPinned: "false" }).isPinned).toBe(false);
    // Not a checkbox — a bare "on" (the HTML checkbox default value) is not
    // truthy here, unlike Coerce.booleanFromCheckbox.
    expect(update({ id: "u1", isPinned: "on" }).isPinned).toBe(false);
  });

  it("enum: passes the raw select value through untouched — validity is the command's decode's job", () => {
    expect(create({ title: "T", parentId: "p1", visibility: "public" }).visibility).toBe("public");
    expect(create({ title: "T", parentId: "p1" }).visibility).toBeUndefined();
    expect(update({ id: "u1", visibility: "unlisted" }).visibility).toBe("unlisted");
  });

  it("structured: JSON.parses a present value; blank skips (create) or clears (update, clearable)", () => {
    expect(
      create({ title: "T", parentId: "p1", caption: '{"type":"doc","text":"hi"}' }).caption,
    ).toEqual({ type: "doc", text: "hi" });
    expect(create({ title: "T", parentId: "p1", caption: "{}" }).document).toBeUndefined();
    expect(update({ id: "u1" }).caption).toBeNull();
    expect(update({ id: "u1", document: '{"type":"doc","text":"hi"}' }).document).toEqual({
      type: "doc",
      text: "hi",
    });
  });

  it("structured: throws on malformed JSON — same failure mode as jsonRowsFromField, left to the caller", () => {
    expect(() => create({ title: "T", parentId: "p1", caption: "not json" })).toThrow(SyntaxError);
  });
});

describe("Command.jsonRowsFromField", () => {
  it("skips blank, clears on empty array, falls back to index ordering", () => {
    expect(jsonRowsFromField(undefined, "rows")).toBeUndefined();
    expect(jsonRowsFromField("  ", "rows")).toBeUndefined();
    expect(jsonRowsFromField("[]", "rows")).toEqual([]);
    expect(
      jsonRowsFromField('[{"agentId":"a","orderingPosition":4},{"agentId":"b"}]', "rows"),
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
