/**
 * @copyright Thomas Foster
 *
 * Field definitions for the {@link module:effect-forms/FormBuilder}.
 *
 * A {@link FormBuilder} composes a form one field at a time. Each field is
 * either a **scalar** {@link FieldDef} (bound to a leaf schema) or an
 * **array** {@link ArrayFieldDef} (bound to an item schema — the field is a
 * list of that item). This module is the small vocabulary the builder is made
 * of: the two field shapes, their guards, the type-level projections that turn
 * a record of fields into the form's encoded / decoded data types, and the
 * default-value derivation used to seed a blank form (or a freshly-appended
 * array item).
 *
 * Defaults are *encoded* — an HTML form holds strings, so a scalar seeds to
 * `""`, an array to `[]`, and a nested struct recurses. Coercion back to the
 * decoded type is the schema's job at validate time (see
 * {@link module:effect-forms/Coerce}).
 *
 * @module effect-forms/Field
 */

import type * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

/** A scalar field: a key bound to a leaf (or nested struct) schema. */
export interface FieldDef<K extends string, S extends Schema.Top> {
  readonly _tag: "field";
  readonly key: K;
  readonly schema: S;
}

/** An array field: a key bound to an item schema; the field is a list of items. */
export interface ArrayFieldDef<K extends string, S extends Schema.Top> {
  readonly _tag: "array";
  readonly key: K;
  readonly itemSchema: S;
}

/** Either field shape, with the key / schema types erased. */
export type AnyFieldDef = FieldDef<string, Schema.Top> | ArrayFieldDef<string, Schema.Top>;

/** A record of fields, keyed by field name — the builder's accumulated shape. */
export type FieldsRecord = Record<string, AnyFieldDef>;

/** Whether `def` is an {@link ArrayFieldDef}. */
export const isArrayFieldDef = (def: AnyFieldDef): def is ArrayFieldDef<string, Schema.Top> =>
  def._tag === "array";

/** Whether `def` is a scalar {@link FieldDef}. */
export const isFieldDef = (def: AnyFieldDef): def is FieldDef<string, Schema.Top> =>
  def._tag === "field";

/** Construct a scalar {@link FieldDef}. */
export const makeField = <K extends string, S extends Schema.Top>(
  key: K,
  schema: S,
): FieldDef<K, S> => ({ _tag: "field", key, schema });

/** Construct an {@link ArrayFieldDef}. */
export const makeArrayField = <K extends string, S extends Schema.Top>(
  key: K,
  itemSchema: S,
): ArrayFieldDef<K, S> => ({ _tag: "array", key, itemSchema });

/** The encoded (form-input) data type for a record of fields. */
export type EncodedFromFields<T extends FieldsRecord> = {
  readonly [K in keyof T]: T[K] extends FieldDef<string, infer S>
    ? S["Encoded"]
    : T[K] extends ArrayFieldDef<string, infer S>
      ? ReadonlyArray<S["Encoded"]>
      : never;
};

/** The decoded (validated) data type for a record of fields. */
export type DecodedFromFields<T extends FieldsRecord> = {
  readonly [K in keyof T]: T[K] extends FieldDef<string, infer S>
    ? S["Type"]
    : T[K] extends ArrayFieldDef<string, infer S>
      ? ReadonlyArray<S["Type"]>
      : never;
};

/**
 * Derive a blank *encoded* default from a schema AST: a struct recurses into
 * its properties, an array seeds to `[]`, and any scalar seeds to `""` (an
 * HTML input's empty value). Conservative by design — a value that will not
 * decode cleanly is still a valid *starting* value the user edits.
 */
export function defaultValue(schema: Schema.Top): unknown {
  return fromAst(schema.ast);
}

function fromAst(ast: SchemaAST.AST): unknown {
  // Unwrap a union (an `optional` / `NullOr` struct arrives as `Struct | undefined`
  // / `Struct | null`): recurse into the first structured member so a wrapped
  // struct still seeds its shape rather than the scalar `""` fallback.
  if (SchemaAST.isUnion(ast)) {
    for (const member of ast.types) {
      const inner = fromAst(member);
      if (inner !== "") return inner;
    }
    return "";
  }
  if (SchemaAST.isObjects(ast)) {
    const out: Record<string, unknown> = {};
    for (const ps of ast.propertySignatures) out[String(ps.name)] = fromAst(ps.type);
    return out;
  }
  if (SchemaAST.isArrays(ast)) return [];
  return "";
}

/** Seed a blank encoded value for every field: `[]` for arrays, `""` otherwise. */
export function defaultEncodedValues(fields: FieldsRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(fields)) {
    out[key] = isArrayFieldDef(def) ? [] : defaultValue(def.schema);
  }
  return out;
}
