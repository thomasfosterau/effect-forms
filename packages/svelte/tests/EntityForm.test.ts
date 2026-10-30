import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import type { Component } from "svelte";
import { defineEntityForm, type EntityFormEntry } from "../src/EntityForm.ts";

// Synthetic command pair shaped like the creative-work family: a required
// title, a required FK, an optional scalar, and a contributor list.

const Uuid = Schema.String.check(Schema.isUUID());
const Row = Schema.Struct({ agentId: Schema.String, orderingPosition: Schema.Finite });

const CreateThing = Schema.Struct({
  id: Schema.optional(Uuid),
  title: Schema.String,
  parentId: Uuid,
  note: Schema.optional(Schema.String),
  rows: Schema.optional(Schema.Array(Row)),
});
const UpdateThing = Schema.Struct({
  id: Uuid,
  title: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Uuid)),
  note: Schema.optional(Schema.NullOr(Schema.String)),
  rows: Schema.optional(Schema.Array(Row)),
});

// A command pair with a literal-union field (the `enum` kind) — f.select's
// target shape.
const CreateWithStatus = Schema.Struct({
  title: Schema.String,
  status: Schema.Literals(["draft", "published"]),
});
const UpdateWithStatus = Schema.Struct({
  id: Uuid,
  title: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literals(["draft", "published"])),
});
const statusOptionLabels = { draft: () => "Draft", published: () => "Published" };

// A stand-in widget: EntityForm only stores the reference, so any function
// object passes for a Component in unit scope.
const Picker: Component<never> = () => ({});
const RowsWidget: Component<never> = () => ({});

// `createInput` / `updateInput` are typed `Schema.Top`; decode them untyped.
const decodeInput = (input: Schema.Top) =>
  // SAFETY: EntityForm builds both inputs with `Command.formInputFields` (plus string
  // overrides here), a struct of string schemas that needs no decoding service.
  Schema.decodeUnknownSync(input as Schema.Codec<unknown>);

const submit = { create: () => "Create thing", update: () => "Save changes" };

const definition = defineEntityForm({ create: CreateThing, update: UpdateThing, submit }, (f) => [
  f.custom("parentId", Picker, () => ({ label: "Parent" }), { gate: true }),
  f.text("title", { label: () => "Title", required: true }),
  f.text("note", { label: () => "Note" }),
  f.rows("rows", RowsWidget, () => ({ label: "Rows" })),
]);

describe("defineEntityForm", () => {
  it("keeps declaration order and exposes the plan per entry", () => {
    expect(definition.entries.map((entry) => entry.key)).toEqual([
      "parentId",
      "title",
      "note",
      "rows",
    ]);
    expect(definition.fieldFor("parentId").kind).toBe("id");
    expect(definition.fieldFor("rows").kind).toBe("jsonArray");
    expect(definition.clientId).toBe(true);
  });

  it("filters entries by mode from the plan", () => {
    const serverAssigned = defineEntityForm(
      {
        create: Schema.Struct({ title: Schema.String }),
        update: Schema.Struct({
          id: Uuid,
          title: Schema.optional(Schema.String),
          note: Schema.optional(Schema.NullOr(Schema.String)),
        }),
        submit,
      },
      (f) => [f.text("title", { label: () => "Title" }), f.text("note", { label: () => "Note" })],
    );
    expect(serverAssigned.entriesFor("create").map((entry: EntityFormEntry) => entry.key)).toEqual([
      "title",
    ]);
    expect(serverAssigned.entriesFor("update").map((entry: EntityFormEntry) => entry.key)).toEqual([
      "title",
      "note",
    ]);
    expect(serverAssigned.clientId).toBe(false);
  });

  it("throws on an unknown, duplicate, or missing entry key", () => {
    expect(() =>
      defineEntityForm({ create: CreateThing, update: UpdateThing, submit }, (f) => [
        // SAFETY: "typo" deliberately bypasses the key type to reach the runtime
        // unknown-key guard under test; defineEntityForm throws before using it.
        f.text("typo" as never, { label: () => "x" }),
      ]),
    ).toThrow('entry "typo" is not a field');
    expect(() =>
      defineEntityForm({ create: CreateThing, update: UpdateThing, submit }, (f) => [
        f.text("title", { label: () => "x" }),
        f.text("title", { label: () => "x" }),
      ]),
    ).toThrow("declared twice");
    expect(() =>
      defineEntityForm({ create: CreateThing, update: UpdateThing, submit }, (f) => [
        f.text("title", { label: () => "x" }),
      ]),
    ).toThrow("not declared by any entry: parentId, note, rows");
  });

  it("derives working form-input schemas and defaults", () => {
    const decodeCreate = decodeInput(definition.createInput);
    expect(() => decodeCreate({ title: "", parentId: "x" })).toThrow(
      "Expected a value with a length of at least 1",
    );
    expect(definition.createDefaults).toMatchObject({ id: "", title: "", parentId: "" });
    const decodeUpdate = decodeInput(definition.updateInput);
    expect(() => decodeUpdate({ id: "nope" })).toThrow("Expected a UUID");
  });

  it("threads adapter and input overrides through", () => {
    const withOverrides = defineEntityForm(
      {
        create: CreateThing,
        update: UpdateThing,
        submit,
        inputOverrides: { create: { title: Schema.optional(Schema.String) } },
        adaptOverrides: { create: { title: (raw) => raw?.trim() || "Untitled" } },
      },
      (f) => [
        f.custom("parentId", Picker, () => ({})),
        f.text("title", { label: () => "Title" }),
        f.text("note", { label: () => "Note" }),
        f.rows("rows", RowsWidget, () => ({})),
      ],
    );
    const decode = decodeInput(withOverrides.createInput);
    expect(decode({ parentId: "p" })).toMatchObject({ parentId: "p" });
    expect(withOverrides.adaptCreate({ title: " ", parentId: "p" }).title).toBe("Untitled");
  });

  it("resolves submit labels lazily", () => {
    expect(definition.submit.create()).toBe("Create thing");
    expect(definition.submit.update()).toBe("Save changes");
  });

  it("drops an omitted field from the plan, input schema, defaults, and adapters", () => {
    // The BookSeries `editors` carve-out shape: a command field present on
    // both structs that the standalone form deliberately never surfaces.
    const withOmit = defineEntityForm(
      {
        create: CreateThing,
        update: UpdateThing,
        submit,
        omit: ["rows"],
      },
      (f) => [
        f.custom("parentId", Picker, () => ({ label: "Parent" }), { gate: true }),
        f.text("title", { label: () => "Title", required: true }),
        f.text("note", { label: () => "Note" }),
      ],
    );
    expect(withOmit.plan.fields.map((field) => field.key)).not.toContain("rows");
    expect(() => withOmit.fieldFor("rows")).toThrow('unknown field "rows"');
    const decodeCreate = decodeInput(withOmit.createInput);
    expect(
      decodeCreate({ title: "T", parentId: "9f8c1c2e-4b3a-4c5d-8e6f-0a1b2c3d4e5f" }),
    ).not.toHaveProperty("rows");
    expect(withOmit.createDefaults).not.toHaveProperty("rows");
    expect(withOmit.adaptCreate({ title: "T", parentId: "p" })).not.toHaveProperty("rows");
  });

  it("omits a kind-less field before classification, so it never throws at definition time", () => {
    // A Boolean field matches no FieldKind (Command.classify throws on it) —
    // omitting it must skip classification entirely, not just post-filter the
    // plan, or the escape hatch wouldn't actually escape the throw.
    const CreateWithFlag = Schema.Struct({ title: Schema.String, isActive: Schema.Boolean });
    const UpdateWithFlag = Schema.Struct({
      id: Uuid,
      title: Schema.optional(Schema.String),
      isActive: Schema.optional(Schema.Boolean),
    });
    expect(() =>
      defineEntityForm(
        { create: CreateWithFlag, update: UpdateWithFlag, submit, omit: ["isActive"] },
        (f) => [f.text("title", { label: () => "Title" })],
      ),
    ).not.toThrow();
    const withFlag = defineEntityForm(
      { create: CreateWithFlag, update: UpdateWithFlag, submit, omit: ["isActive"] },
      (f) => [f.text("title", { label: () => "Title" })],
    );
    expect(withFlag.plan.fields.map((field) => field.key)).not.toContain("isActive");
  });

  it("throws exhaustiveness for an omitted-then-redeclared field", () => {
    // Omitting a field removes it from the required set — declaring an entry
    // for it anyway is an unknown-key error, not silently accepted.
    expect(() =>
      defineEntityForm(
        { create: CreateThing, update: UpdateThing, submit, omit: ["rows"] },
        (f) => [
          f.custom("parentId", Picker, () => ({}), { gate: true }),
          f.text("title", { label: () => "Title" }),
          f.text("note", { label: () => "Note" }),
          f.rows("rows", RowsWidget, () => ({})),
        ],
      ),
    ).toThrow('entry "rows" is not a field');
  });

  // ── f.select over the enum kind (#1459) ──────────────────────────────

  it("declares a select entry without deriving option values on the entry itself", () => {
    const withStatus = defineEntityForm(
      { create: CreateWithStatus, update: UpdateWithStatus, submit },
      (f) => [
        f.text("title", { label: () => "Title" }),
        f.select("status", { label: () => "Status", optionLabels: statusOptionLabels }),
      ],
    );
    const entry = withStatus.entries.find((e) => e.key === "status");
    expect(entry?._tag).toBe("select");
    // Option values live on the plan (derived from the enum kind), not the entry.
    expect(entry).not.toHaveProperty("values");
    expect(withStatus.fieldFor("status").kind).toBe("enum");
    expect(withStatus.fieldFor("status").options).toEqual(["draft", "published"]);
  });

  it("throws at definition time when f.select targets a non-enum field", () => {
    expect(() =>
      defineEntityForm({ create: CreateThing, update: UpdateThing, submit }, (f) => [
        f.custom("parentId", Picker, () => ({}), { gate: true }),
        f.select("title", { label: () => "Title", optionLabels: {} }),
        f.text("note", { label: () => "Note" }),
        f.rows("rows", RowsWidget, () => ({})),
      ]),
    ).toThrow('entry "title" is f.select but its command field is "text"-kind, not enum');
  });

  it("throws at definition time when optionLabels is missing a derived value", () => {
    expect(() =>
      defineEntityForm({ create: CreateWithStatus, update: UpdateWithStatus, submit }, (f) => [
        f.text("title", { label: () => "Title" }),
        f.select("status", { label: () => "Status", optionLabels: { draft: () => "Draft" } }),
      ]),
    ).toThrow('entry "status" is missing optionLabels for: published');
  });

  it("treats an inherited Object.prototype key as a missing label, not a declared one", () => {
    // "toString" and "constructor" resolve via the prototype chain even on a
    // plain object literal — an `in` check would wrongly accept them as
    // declared without the definition actually supplying a thunk for them.
    const CreateWithBuiltinLiteral = Schema.Struct({
      title: Schema.String,
      kind: Schema.Literals(["toString", "published"]),
    });
    const UpdateWithBuiltinLiteral = Schema.Struct({
      id: Uuid,
      title: Schema.optional(Schema.String),
      kind: Schema.optional(Schema.Literals(["toString", "published"])),
    });
    expect(() =>
      defineEntityForm(
        { create: CreateWithBuiltinLiteral, update: UpdateWithBuiltinLiteral, submit },
        (f) => [
          f.text("title", { label: () => "Title" }),
          f.select("kind", { label: () => "Kind", optionLabels: { published: () => "Published" } }),
        ],
      ),
    ).toThrow('entry "kind" is missing optionLabels for: toString');
  });
});
