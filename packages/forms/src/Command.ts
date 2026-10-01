/**
 * Command-struct introspection and form derivation.
 *
 * A host app's write surface is a pair of flat command `Schema.Struct`s per
 * entity — a create struct (required fields bare, the rest `optional`) and an
 * update struct (keyed by a required `id`, every field `optional`, clearable
 * fields `optional(NullOr(...))` carrying the value / `null` / `undefined`
 * tri-state). This module reads that pair into a plain-data {@link CommandPlan}
 * and derives the three per-entity form artefacts that were previously
 * hand-written per entity: the all-string Form-Input schema fields, the blank
 * defaults, and the tri-state adapters that map a validated multipart input
 * onto the encoded command payload.
 *
 * Classification leads with behavioural decode probes — date codecs are
 * transformations and branded ids erase to `String`, so "what does this
 * schema accept" is the only robust signal for those (the same approach the
 * host app's model walkers use). Two kinds fall back to AST matching instead,
 * because no decode probe can name what they are: `enum`'s literal option set
 * (needed anyway for the renderer, not just the classification) and
 * `structured`'s "this is a nested object, not a scalar" shape. Neither
 * shadows a probe-classified kind — see {@link classify}.
 *
 * The derived adapters emit the **encoded** command payload (dates stay
 * `YYYY-MM-DD` strings, ids stay plain strings) — the command's canonical
 * decode downstream owns branding and validation. Genuinely irregular fields
 * (a create-time default, an asymmetric coercion) stay expressible via the
 * per-field {@link AdaptOverrides} escape hatch instead of forcing ejection.
 *
 * @copyright Thomas Foster
 * @module effect-forms/Command
 */

import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import {
  emptyToNull,
  emptyToUndefined,
  numberFromField,
  trimToNull,
  trimToUndefined,
} from "./Coerce.ts";

/** How a command field renders and coerces at the form boundary. */
export type FieldKind =
  | "text"
  | "id"
  | "number"
  | "date"
  | "jsonArray"
  | "boolean"
  | "enum"
  | "structured";

/** One command field's derived plan, as plain data. */
export interface FieldPlan {
  readonly key: string;
  readonly kind: FieldKind;
  /** Present on the create struct. */
  readonly inCreate: boolean;
  /** Bare (non-optional) on the create struct. */
  readonly createRequired: boolean;
  /** Present on the update struct. */
  readonly inUpdate: boolean;
  /** `optional(NullOr(...))` on the update struct — blank clears (`null`). */
  readonly updateClearable: boolean;
  /**
   * The field's literal option values, read off the AST — present only when
   * `kind` is `"enum"`. In declaration order, stringified (a `<select>`'s
   * option values are always strings at the form boundary, whatever the
   * decoded literal's own type).
   */
  readonly options?: readonly string[];
}

/** The derived plan for one entity's create/update command pair. */
export interface CommandPlan {
  /** Every field except `id`, in update-struct declaration order (create-only fields appended). */
  readonly fields: readonly FieldPlan[];
  /** The create struct carries an optional client-generated `id` (idempotent retries). */
  readonly clientId: boolean;
}

/** Per-field adapter overrides — the escape hatch for genuinely irregular coercion. */
export type AdaptOverrides = Readonly<Record<string, (raw: string | undefined) => unknown>>;

/** A validated all-string multipart input, as the Form-Input schemas produce it. */
export type FormInputRecord = Readonly<Record<string, string | undefined>>;

// ── probes ────────────────────────────────────────────────────────────

/**
 * Run one decode probe: whether the schema accepts the input, plus the decoded
 * value for instance checks (the date probe needs to see a `Date` come out,
 * not just a successful decode).
 */
const probe = (
  schema: Schema.Top,
  input: unknown,
): { readonly ok: boolean; readonly value?: unknown } => {
  try {
    return { ok: true, value: Schema.decodeUnknownSync(schema as Schema.Codec<unknown>)(input) };
  } catch {
    return { ok: false };
  }
};

/** True when a schema decodes the given input without throwing. */
const decodes = (schema: Schema.Top, input: unknown): boolean => probe(schema, input).ok;

/** A syntactically valid UUID no other field kind accepts as non-text. */
const PROBE_UUID = "9f8c1c2e-4b3a-4c5d-8e6f-0a1b2c3d4e5f";

/**
 * Peel exactly the `optional` / `NullOr` wrapper layers off a property's type
 * AST, stopping at the first union that isn't itself a pure wrapper. A wrapper
 * union carries exactly one non-`null`/`undefined` member (the wrapped type);
 * a union with zero or several such members is a real value-level union (an
 * `enum` field's own literal set, say) rather than another layer to peel, so
 * the loop stops there. Unlike {@link module:effect-forms/Constraints}'s
 * `unwrapOptional` (which only ever needs the *first* real member), this
 * walks every wrapper layer and preserves a multi-member union intact —
 * `enumOptions` below needs the full literal set, not just one branch of it.
 */
function unwrapWrapperUnion(ast: SchemaAST.AST): SchemaAST.AST {
  let current = ast;
  while (SchemaAST.isUnion(current)) {
    const real = current.types.filter((t) => !SchemaAST.isUndefined(t) && !SchemaAST.isNull(t));
    if (real.length !== 1 || real.length === current.types.length) break;
    current = real[0];
  }
  return current;
}

/**
 * The literal option values of a field shaped like `Schema.Literal(...)` or
 * `Schema.Literals([...])` (optionally `optional` / `NullOr`-wrapped) —
 * `undefined` when the field isn't literal-shaped. Stringified: a `<select>`'s
 * option values are strings at the form boundary regardless of the literal's
 * own type.
 */
function enumOptions(ast: SchemaAST.AST): readonly string[] | undefined {
  const inner = unwrapWrapperUnion(ast);
  if (SchemaAST.isLiteral(inner)) return [String(inner.literal)];
  if (SchemaAST.isUnion(inner)) {
    const literals = inner.types.filter(SchemaAST.isLiteral);
    if (literals.length === inner.types.length && literals.length > 0) {
      return literals.map((literal) => String(literal.literal));
    }
  }
  return undefined;
}

/**
 * Whether a field is itself an object/struct schema (optionally `optional` /
 * `NullOr`-wrapped) — the `structured` kind's shape (inline / block ProseKit
 * JSON: `{ type, content }`). Mirrors {@link module:effect-forms/Field}'s and
 * {@link module:effect-forms/Constraints}'s own `SchemaAST.isObjects` struct
 * check. A `Schema.declare`d type (`UploadedDocument`, `Image`) has no
 * `Objects` AST node, so it is never caught here — the default-throw the
 * derivation relies on stays intact.
 */
function isStructured(ast: SchemaAST.AST): boolean {
  return SchemaAST.isObjects(unwrapWrapperUnion(ast));
}

/** One field's classification: its {@link FieldKind}, plus `options` for `"enum"`. */
interface Classification {
  readonly kind: FieldKind;
  readonly options?: readonly string[];
}

/**
 * The scalar kinds classified purely by what a schema decodes, with no AST
 * inspection: array → boolean → number → date → id → text. `undefined` when
 * the schema accepts none of them, so {@link classify} can fall through to
 * its AST-based checks (`enum`, `structured`).
 */
const probeKind = (schema: Schema.Top): FieldKind | undefined => {
  if (decodes(schema, [])) return "jsonArray";
  if (decodes(schema, true)) return "boolean";
  if (decodes(schema, 42)) return "number";
  const date = probe(schema, "2024-01-02T03:04:05.000Z");
  if (date.ok && date.value instanceof Date) return "date";
  if (decodes(schema, PROBE_UUID) && !decodes(schema, "not-a-uuid")) return "id";
  if (decodes(schema, "plain text")) return "text";
  return undefined;
};

/**
 * Classify one field schema: by its AST shape first, then by what it accepts.
 * `enum` is checked before {@link probeKind} rather than after, since a
 * decode probe can't tell "the literal set an enum accepts" from any other
 * shape (worse, a numeric-literal enum whose set happens to include the `42`
 * probe value would otherwise misclassify as `number`) — reading the literal
 * set off the AST is unambiguous, and it's needed anyway for the renderer.
 * `structured` is checked last, after every probe has failed: an object
 * schema never decodes any of `probeKind`'s scalar probes, so there is no
 * real ordering hazard, but putting the broadest, AST-only check last keeps
 * every more specific kind first in line. A field that matches nothing
 * (`Schema.declare`d — `UploadedDocument`, `Image`) throws at module load so
 * the gap surfaces when the plan is declared, not on a live submission.
 */
const classify = (key: string, schema: Schema.Top): Classification => {
  const options = enumOptions(schema.ast);
  if (options !== undefined) return { kind: "enum", options };
  const probed = probeKind(schema);
  if (probed !== undefined) return { kind: probed };
  if (isStructured(schema.ast)) return { kind: "structured" };
  throw new Error(
    `Command.plan: field "${key}" matches no known kind (text/id/number/date/jsonArray/boolean/enum/structured) — a Schema.declare'd type needs an explicit form-level treatment before it can derive`,
  );
};

// ── plan ──────────────────────────────────────────────────────────────

/** Minimal runtime shape of a command `Schema.Struct`. */
interface StructLike {
  readonly fields: Record<string, Schema.Top>;
}

/**
 * Read a create/update command struct pair into a {@link CommandPlan}.
 * Runs once at module load — probe cost is a handful of tiny decodes per
 * field, never per render or per request.
 */
export const plan = (create: StructLike, update: StructLike): CommandPlan => {
  const createFields = create.fields;
  const updateFields = update.fields;
  const keys: string[] = [];
  for (const key in updateFields) if (key !== "id") keys.push(key);
  for (const key in createFields) if (key !== "id" && !(key in updateFields)) keys.push(key);

  const fields = keys.map((key): FieldPlan => {
    const createField = createFields[key];
    const updateField = updateFields[key];
    const probeTarget = (createField ?? updateField) as Schema.Top;
    const { kind, options } = classify(key, probeTarget);
    return {
      key,
      kind,
      inCreate: createField !== undefined,
      createRequired: createField !== undefined && !decodes(createField, undefined),
      inUpdate: updateField !== undefined,
      updateClearable: updateField !== undefined && decodes(updateField, null),
      ...(options !== undefined ? { options } : {}),
    };
  });

  return { fields, clientId: "id" in createFields };
};

// ── Form-Input schema fields ──────────────────────────────────────────

/**
 * Derive the all-string Form-Input schema fields for one mode — every value is
 * a string at the multipart boundary. Create-required fields get a min-length
 * check so blankness surfaces as an inline field error; the update `id` gets
 * the UUID check. Spread into `Schema.Struct({ ...Command.formInputFields(plan,
 * "create") })`, with `overrides` spread last for irregular fields.
 */
export const formInputFields = (
  commandPlan: CommandPlan,
  mode: "create" | "update",
  overrides: Readonly<Record<string, Schema.Top>> = {},
): Record<string, Schema.Top> => {
  const fields: Record<string, Schema.Top> = {};
  if (mode === "create" && commandPlan.clientId) fields.id = Schema.optional(Schema.String);
  if (mode === "update") fields.id = Schema.String.check(Schema.isUUID());
  for (const field of commandPlan.fields) {
    if (mode === "create" ? !field.inCreate : !field.inUpdate) continue;
    fields[field.key] =
      mode === "create" && field.createRequired
        ? Schema.String.check(Schema.isMinLength(1))
        : Schema.optional(Schema.String);
  }
  return { ...fields, ...overrides };
};

/**
 * Blank string defaults for one mode's Form-Input shape. Client-id entities
 * override `id` at the call site (`{ ...blankDefaults(plan, "create"), id:
 * crypto.randomUUID() }`) so retries stay idempotent.
 */
export const blankDefaults = (
  commandPlan: CommandPlan,
  mode: "create" | "update",
): Record<string, string> => {
  const defaults: Record<string, string> = {};
  if (mode === "update" || commandPlan.clientId) defaults.id = "";
  for (const field of commandPlan.fields) {
    if (mode === "create" ? !field.inCreate : !field.inUpdate) continue;
    defaults[field.key] = "";
  }
  return defaults;
};

// ── adapters ──────────────────────────────────────────────────────────

/**
 * Parse a JSON-encoded row list (a contributor list) from a multipart form
 * field. A blank or absent field yields `undefined` (skip — leave the existing
 * list untouched); an empty JSON array (`"[]"`) clears the list. Rows keep
 * `id` / `creditedName` when present; `orderingPosition` falls back to the
 * row's array index. Throws a plain `Error` on a malformed payload — mapping
 * that onto a framework response is the caller's concern.
 */
export const jsonRowsFromField = (
  raw: string | undefined,
  label: string,
):
  | {
      id?: string | undefined;
      agentId: string;
      creditedName?: string | undefined;
      orderingPosition: number;
    }[]
  | undefined => {
  if (raw === undefined || raw.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid ${label} payload — expected JSON array`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} payload — expected array`);
  }
  return parsed.map((row, index) => {
    if (typeof row !== "object" || row === null) {
      throw new Error(`Invalid ${label} entry at index ${index}`);
    }
    const r = row as Record<string, unknown>;
    if (typeof r.agentId !== "string") {
      throw new Error(`${label} entry at index ${index} missing agentId`);
    }
    return {
      id: typeof r.id === "string" ? r.id : undefined,
      agentId: r.agentId,
      creditedName: typeof r.creditedName === "string" ? r.creditedName : undefined,
      orderingPosition: typeof r.orderingPosition === "number" ? r.orderingPosition : index,
    };
  });
};

/** Coercion context for one field in one mode. */
interface CoerceContext {
  /** Required at create: emit the raw value's canonical form, never skip. */
  readonly required: boolean;
  /** Blank clears (`null`) rather than skips (`undefined`). */
  readonly clearable: boolean;
  /** Trim before the create-mode blank check (dates trim only at create). */
  readonly trimCreate: boolean;
}

/** Text fields: trim always; required create fields never skip. */
const coerceText = (ctx: CoerceContext, raw: string | undefined): unknown =>
  ctx.required ? (raw ?? "").trim() : ctx.clearable ? trimToNull(raw) : trimToUndefined(raw);

/** Id fields: no trimming (pickers emit `""` or a UUID); required create FKs pass through raw. */
const coerceId = (ctx: CoerceContext, raw: string | undefined): unknown =>
  ctx.required ? raw : ctx.clearable ? emptyToNull(raw) : emptyToUndefined(raw);

/** Numeric text fields: blank clears on the clearable path, skips otherwise. */
const coerceNumber = (ctx: CoerceContext, raw: string | undefined): unknown =>
  ctx.clearable
    ? numberFromField(raw, { nullable: true })
    : numberFromField(raw, { nullable: false });

/** Date fields stay encoded (`YYYY-MM-DD` strings); create trims, update passes through. */
const coerceDate = (ctx: CoerceContext, raw: string | undefined): unknown => {
  const value = ctx.trimCreate ? raw?.trim() : raw;
  return ctx.clearable ? emptyToNull(value) : emptyToUndefined(value);
};

/**
 * Boolean fields: a `<select>`'s value set, not a checkbox — the only truthy
 * raw value is the literal string `"true"`, everything else (`"false"`,
 * blank, absent) reads as `false`. Create defaults an absent/blank field to
 * `false` (never skips); update skips absent/blank unless clearable, in which
 * case it clears (`null`) instead — the create-defaults / update-skips
 * asymmetry the Content family already hand-writes.
 */
const coerceBoolean = (ctx: CoerceContext, raw: string | undefined): unknown => {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === "") {
    return ctx.required ? false : ctx.clearable ? null : undefined;
  }
  return trimmed === "true";
};

/**
 * Parse a JSON-encoded structured document (inline / block ProseKit JSON)
 * from a multipart field. Blank or absent skips (`undefined`) or, on the
 * clearable path, clears (`null`); a present value is `JSON.parse`d and
 * passed through as-is — shape validation is the command's own decode's job,
 * exactly as {@link jsonRowsFromField} leaves row-shape validation to itself
 * rather than duplicating it here. `JSON.parse` throws a `SyntaxError` on
 * malformed JSON, same as {@link jsonRowsFromField} does on a malformed row
 * list — mapping that onto a framework response is the caller's concern.
 */
const structuredFromField = (raw: string | undefined, clearable: boolean): unknown => {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === "") return clearable ? null : undefined;
  return JSON.parse(trimmed);
};

/** Build one field's {@link CoerceContext} for one mode. */
const coerceContextFor = (field: FieldPlan, mode: "create" | "update"): CoerceContext => ({
  required: mode === "create" && field.createRequired,
  clearable: mode === "update" && field.updateClearable,
  trimCreate: mode === "create",
});

/** The default coercion for one field in one mode. */
const coerce = (field: FieldPlan, mode: "create" | "update", raw: string | undefined): unknown => {
  const ctx = coerceContextFor(field, mode);
  switch (field.kind) {
    case "text":
    case "enum":
      return coerceText(ctx, raw);
    case "id":
      return coerceId(ctx, raw);
    case "number":
      return coerceNumber(ctx, raw);
    case "date":
      return coerceDate(ctx, raw);
    case "jsonArray":
      return jsonRowsFromField(raw, field.key);
    case "boolean":
      return coerceBoolean(ctx, raw);
    case "structured":
      return structuredFromField(raw, ctx.clearable);
  }
};

/**
 * Derive the create adapter: validated all-string input → encoded create
 * command payload. `overrides` replace the default per-field coercion for
 * genuinely irregular fields (e.g. a create-time fallback default).
 */
export const createAdapter =
  (commandPlan: CommandPlan, overrides: AdaptOverrides = {}) =>
  (input: FormInputRecord): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (commandPlan.clientId) out.id = trimToUndefined(input.id);
    for (const field of commandPlan.fields) {
      if (!field.inCreate) continue;
      const override = overrides[field.key];
      out[field.key] = override
        ? override(input[field.key])
        : coerce(field, "create", input[field.key]);
    }
    return out;
  };

/**
 * Derive the update adapter: validated all-string input → encoded update
 * command payload (value sets, `null` clears a clearable field, `undefined`
 * skips). The required `id` passes through as-is — the command's canonical
 * decode brands it.
 */
export const updateAdapter =
  (commandPlan: CommandPlan, overrides: AdaptOverrides = {}) =>
  (input: FormInputRecord): Record<string, unknown> => {
    const out: Record<string, unknown> = { id: input.id };
    for (const field of commandPlan.fields) {
      if (!field.inUpdate) continue;
      const override = overrides[field.key];
      out[field.key] = override
        ? override(input[field.key])
        : coerce(field, "update", input[field.key]);
    }
    return out;
  };
