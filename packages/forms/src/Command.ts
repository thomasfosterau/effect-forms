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

import * as Arr from "effect/Array";
import * as Exit from "effect/Exit";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaParser from "effect/SchemaParser";
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

// ── errors ────────────────────────────────────────────────────────────

/** A command field {@link plan} cannot classify into any {@link FieldKind}. */
class UnclassifiableFieldError extends Schema.TaggedError<UnclassifiableFieldError>()(
  "UnclassifiableFieldError",
  { message: Schema.String },
) {}

/** A malformed `jsonArray` field payload, as {@link jsonRowsFromField} rejects it. */
class InvalidJsonRowsError extends Schema.TaggedError<InvalidJsonRowsError>()(
  "InvalidJsonRowsError",
  { message: Schema.String },
) {}

// ── probes ────────────────────────────────────────────────────────────

/**
 * Run one decode probe: whether the schema accepts the input, plus the decoded
 * value for instance checks (the date probe needs to see a `Date` come out,
 * not just a successful decode).
 */
const probe = (schema: Schema.Top, input: unknown): Exit.Exit<unknown, unknown> => {
  // SAFETY: the cast only drops `schema`'s decoding-service requirement. The
  // decode runs to an `Exit`, so a schema that does need a service (or decodes
  // asynchronously, or throws) yields a failed `Exit` — which a probe reads as
  // "does not decode", exactly as it reads an ordinary schema issue.
  const decoder = schema as Schema.Codec<unknown>;
  return SchemaParser.decodeUnknownExit(decoder)(input);
};

/** True when a schema decodes the given input without failing. */
const decodes = (schema: Schema.Top, input: unknown): boolean =>
  Exit.isSuccess(probe(schema, input));

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
  if (!SchemaAST.isUnion(ast)) return ast;
  const real = Arr.filter(ast.types, (t) => !SchemaAST.isUndefined(t) && !SchemaAST.isNull(t));
  if (real.length !== 1 || real.length === ast.types.length) return ast;
  return unwrapWrapperUnion(real[0]);
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
    const literals = Arr.filter(inner.types, SchemaAST.isLiteral);
    if (Arr.isReadonlyArrayNonEmpty(literals) && literals.length === inner.types.length) {
      return Arr.map(literals, (literal) => String(literal.literal));
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
  if (Exit.isSuccess(date) && date.value instanceof Date) return "date";
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
  throw new UnclassifiableFieldError({
    message: `Command.plan: field "${key}" matches no known kind (text/id/number/date/jsonArray/boolean/enum/structured) — a Schema.declare'd type needs an explicit form-level treatment before it can derive`,
  });
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
  const keys = [
    ...Arr.filter(Rec.keys(updateFields), (key) => key !== "id"),
    ...Arr.filter(Rec.keys(createFields), (key) => key !== "id" && !(key in updateFields)),
  ];

  const fields = Arr.map(keys, (key): FieldPlan => {
    const createField = createFields[key];
    const updateField = updateFields[key];
    const { kind, options } = classify(key, createField ?? updateField);
    const fieldPlan: FieldPlan = {
      key,
      kind,
      inCreate: createField !== undefined,
      createRequired: createField !== undefined && !decodes(createField, undefined),
      inUpdate: updateField !== undefined,
      updateClearable: updateField !== undefined && decodes(updateField, null),
    };
    return options === undefined ? fieldPlan : { ...fieldPlan, options };
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
  const idField: Array<readonly [string, Schema.Top]> =
    mode === "update"
      ? [["id", Schema.String.check(Schema.isUUID())]]
      : commandPlan.clientId
        ? [["id", Schema.optional(Schema.String)]]
        : [];
  const planFields = Arr.flatMap(
    commandPlan.fields,
    (field): Array<readonly [string, Schema.Top]> => {
      if (mode === "create" ? !field.inCreate : !field.inUpdate) return [];
      return [
        [
          field.key,
          mode === "create" && field.createRequired
            ? Schema.String.check(Schema.isMinLength(1))
            : Schema.optional(Schema.String),
        ],
      ];
    },
  );
  // Overrides come last, so an override replaces a derived field in place.
  return Rec.fromEntries([...idField, ...planFields, ...Rec.toEntries(overrides)]);
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
  const keys = [
    ...(mode === "update" || commandPlan.clientId ? ["id"] : []),
    ...Arr.flatMap(commandPlan.fields, (field) =>
      (mode === "create" ? field.inCreate : field.inUpdate) ? [field.key] : [],
    ),
  ];
  return Rec.fromEntries(Arr.map(keys, (key) => [key, ""] as const));
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
  const decoded = decodeJson(raw);
  if (Exit.isFailure(decoded)) {
    throw new InvalidJsonRowsError({ message: `Invalid ${label} payload — expected JSON array` });
  }
  const parsed = decoded.value;
  if (!Arr.isArray(parsed)) {
    throw new InvalidJsonRowsError({ message: `Invalid ${label} payload — expected array` });
  }
  return Arr.map(parsed, (row, index) => {
    if (!Predicate.isObjectOrArray(row)) {
      throw new InvalidJsonRowsError({ message: `Invalid ${label} entry at index ${index}` });
    }
    // `row[key]`, `undefined` when absent — what a plain property read gives.
    const propertyOf = (key: string): unknown =>
      Predicate.hasProperty(row, key) ? row[key] : undefined;
    const agentId = propertyOf("agentId");
    if (!Predicate.isString(agentId)) {
      throw new InvalidJsonRowsError({
        message: `${label} entry at index ${index} missing agentId`,
      });
    }
    const id = propertyOf("id");
    const creditedName = propertyOf("creditedName");
    const orderingPosition = propertyOf("orderingPosition");
    return {
      id: Predicate.isString(id) ? id : undefined,
      agentId,
      creditedName: Predicate.isString(creditedName) ? creditedName : undefined,
      orderingPosition: Predicate.isNumber(orderingPosition) ? orderingPosition : index,
    };
  });
};

/** Parse a JSON text (`JSON.parse` semantics) to a success or a failed `Exit`. */
const decodeJson = SchemaParser.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

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
  return Match.value(field.kind).pipe(
    Match.when(Match.is("text", "enum"), () => coerceText(ctx, raw)),
    Match.when("id", () => coerceId(ctx, raw)),
    Match.when("number", () => coerceNumber(ctx, raw)),
    Match.when("date", () => coerceDate(ctx, raw)),
    Match.when("jsonArray", () => jsonRowsFromField(raw, field.key)),
    Match.when("boolean", () => coerceBoolean(ctx, raw)),
    Match.when("structured", () => structuredFromField(raw, ctx.clearable)),
    Match.exhaustive,
  );
};

/**
 * Adapt every field of `commandPlan` present in `mode`, in plan order, to a
 * `[key, value]` entry: through the field's override when it has one, else
 * the default {@link coerce}.
 */
const adaptFields = (
  commandPlan: CommandPlan,
  overrides: AdaptOverrides,
  mode: "create" | "update",
  input: FormInputRecord,
): Array<readonly [string, unknown]> =>
  Arr.flatMap(commandPlan.fields, (field): Array<readonly [string, unknown]> => {
    if (mode === "create" ? !field.inCreate : !field.inUpdate) return [];
    const override = overrides[field.key];
    const raw = input[field.key];
    return [[field.key, override ? override(raw) : coerce(field, mode, raw)]];
  });

/**
 * Derive the create adapter: validated all-string input → encoded create
 * command payload. `overrides` replace the default per-field coercion for
 * genuinely irregular fields (e.g. a create-time fallback default).
 */
export const createAdapter =
  (commandPlan: CommandPlan, overrides: AdaptOverrides = {}) =>
  (input: FormInputRecord): Record<string, unknown> =>
    Rec.fromEntries([
      ...(commandPlan.clientId ? [["id", trimToUndefined(input.id)] as const] : []),
      ...adaptFields(commandPlan, overrides, "create", input),
    ]);

/**
 * Derive the update adapter: validated all-string input → encoded update
 * command payload (value sets, `null` clears a clearable field, `undefined`
 * skips). The required `id` passes through as-is — the command's canonical
 * decode brands it.
 */
export const updateAdapter =
  (commandPlan: CommandPlan, overrides: AdaptOverrides = {}) =>
  (input: FormInputRecord): Record<string, unknown> =>
    Rec.fromEntries([
      ["id", input.id] as const,
      ...adaptFields(commandPlan, overrides, "update", input),
    ]);
