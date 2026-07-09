/**
 * @copyright Thomas Foster
 *
 * HTML input constraints derived from an Effect Schema.
 *
 * Native validation attributes can be read (`required`, `minlength`, …)
 * off the schema so a form can apply them to its inputs for free, layering
 * browser-native validation under the schema-driven validation. This module
 * does the framework-neutral half: walk the schema AST and emit an
 * {@link InputConstraints} tree a UI can spread onto its `<input>`s.
 *
 * `required` comes from a struct field's optionality; `minlength` /
 * `maxlength` / `min` / `max` / `pattern` / `step` are derived from the
 * `meta` annotation Effect Schema's built-in checks carry (`isMinLength`,
 * `isBetween`, `isPattern`, …) — see `Schema.Annotations.BuiltInMetaDefinitions`.
 * A check with no recognised `meta` tag (a bare `Schema.filter` predicate, a
 * custom `.check()`) contributes nothing; there is no attribute to guess at,
 * so the derivation stays silent rather than wrong. The walk descends into
 * nested structs and into a homogeneous array's item type (folding the
 * array's own optionality into the item's `required`); a fixed-shape tuple
 * with differently-typed elements has no single item schema to represent as
 * one constraint, so it derives only `required`. Like
 * {@link module:effect-forms/Field}'s `fromAst`, an `optional` / `NullOr`
 * union is unwrapped by taking its first non-`null`/`undefined` member —
 * scoped to that wrapping pattern, not general discriminated unions, whose
 * branches can't be flattened into one constraint either. The `overrides`
 * argument to {@link constraintsFromSchema} remains the seam for anything the
 * walk cannot infer (or should not — a check that's semantically stronger
 * than any HTML attribute).
 *
 * @module effect-forms/Constraints
 */

import type * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";

/** Native validation attributes for a single input. */
export interface InputConstraint {
  readonly required?: boolean;
  readonly min?: number | string;
  readonly max?: number | string;
  readonly minlength?: number;
  readonly maxlength?: number;
  readonly pattern?: string;
  readonly step?: number;
}

/** A nested tree of {@link InputConstraint}s mirroring the schema's shape. */
export interface InputConstraints {
  readonly [key: string]: InputConstraint | InputConstraints | undefined;
}

const isLeafConstraint = (value: InputConstraint | InputConstraints): value is InputConstraint =>
  "required" in value ||
  "min" in value ||
  "max" in value ||
  "minlength" in value ||
  "maxlength" in value ||
  "pattern" in value ||
  "step" in value;

/** Whether a property's type AST is optional (so the field is not required). */
const isOptional = (type: SchemaAST.AST): boolean => type.context?.isOptional === true;

/**
 * Unwrap an `optional` / `NullOr` union the way {@link module:effect-forms/Field}'s
 * `fromAst` does: recurse into the first member that isn't a bare `undefined`
 * / `null` literal, so a wrapped struct / array / refined leaf still yields
 * its own shape instead of falling through to an empty constraint.
 */
function unwrapOptional(type: SchemaAST.AST): SchemaAST.AST {
  if (!SchemaAST.isUnion(type)) return type;
  for (const member of type.types) {
    if (SchemaAST.isUndefined(member) || SchemaAST.isNull(member)) continue;
    return unwrapOptional(member);
  }
  return type;
}

/** Flatten a `Checks` array (recursing into `FilterGroup`s) into individual filters. */
function flattenChecks(
  checks: SchemaAST.Checks | undefined,
  out: Array<SchemaAST.Filter<unknown>>,
): void {
  if (!checks) return;
  for (const check of checks) {
    if (check._tag === "FilterGroup") {
      flattenChecks(check.checks as SchemaAST.Checks, out);
    } else {
      out.push(check as SchemaAST.Filter<unknown>);
    }
  }
}

/** A same-shape, mutable patch of {@link InputConstraint} fields. */
type ConstraintPatch = { -readonly [K in keyof InputConstraint]?: InputConstraint[K] };

/** The `meta` payload a built-in (or user-augmented) Effect Schema check carries. */
type CheckMeta = Schema.Annotations.Meta;

/**
 * One constraint patch per recognised `meta._tag` — the built-in checks that
 * map onto a native HTML attribute. A tag with no entry here (an unannotated
 * custom filter, or a built-in check with no HTML equivalent) derives
 * nothing. `isInt` isn't a plain patch: it only sets `step` as a fallback
 * when nothing more specific already did, so it's handled separately in
 * {@link constraintFromChecks}.
 */
const metaPatches: {
  readonly [K in CheckMeta["_tag"]]?: (meta: Extract<CheckMeta, { _tag: K }>) => ConstraintPatch;
} = {
  isMinLength: (meta) => ({ minlength: meta.minLength }),
  isMaxLength: (meta) => ({ maxlength: meta.maxLength }),
  isLengthBetween: (meta) => ({ minlength: meta.minimum, maxlength: meta.maximum }),
  isPattern: (meta) => ({ pattern: meta.regExp.source }),
  isGreaterThan: (meta) => ({ min: meta.exclusiveMinimum }),
  isGreaterThanOrEqualTo: (meta) => ({ min: meta.minimum }),
  isLessThan: (meta) => ({ max: meta.exclusiveMaximum }),
  isLessThanOrEqualTo: (meta) => ({ max: meta.maximum }),
  isBetween: (meta) => ({ min: meta.minimum, max: meta.maximum }),
  isMultipleOf: (meta) => ({ step: meta.divisor }),
};

/**
 * Look up and apply `metaPatches[meta._tag]`. The cast is sound: each entry's
 * parameter type is keyed to the same tag `meta` is dispatched on, so the
 * record is never called with a mismatched payload.
 */
function applyMetaPatch(meta: CheckMeta): ConstraintPatch | undefined {
  const patch = metaPatches[meta._tag] as ((meta: CheckMeta) => ConstraintPatch) | undefined;
  return patch?.(meta);
}

/**
 * Derive an {@link InputConstraint}'s refinement attributes from the checks
 * attached to `outer` (the property's own type, e.g. the union wrapping an
 * optional field) and `inner` (the unwrapped leaf) — `inner`'s checks win on
 * conflict since they're the more specific, unwrapped node. A check whose
 * `meta` annotation has no recognised `_tag` (an unannotated custom filter)
 * is skipped: there is no attribute to derive from it.
 */
function constraintFromChecks(outer: SchemaAST.AST, inner: SchemaAST.AST): InputConstraint {
  const filters: Array<SchemaAST.Filter<unknown>> = [];
  flattenChecks(outer.checks, filters);
  if (inner !== outer) flattenChecks(inner.checks, filters);

  let out: ConstraintPatch = {};
  let hasIntCheck = false;
  for (const filter of filters) {
    const meta = filter.annotations?.meta;
    if (!meta) continue;
    if (meta._tag === "isInt") {
      hasIntCheck = true;
      continue;
    }
    out = { ...out, ...applyMetaPatch(meta) };
  }
  if (hasIntCheck && out.step === undefined) out.step = 1;

  return out;
}

/**
 * Whether `ast` is a homogeneous array/list — `Schema.Array(item)` or
 * `Schema.NonEmptyArray(item)` — as opposed to a fixed-shape tuple with
 * differently-typed positional elements. Only a homogeneous array has a
 * single item schema to descend into; a tuple's elements each need their own
 * constraint, which this leaf-per-key tree can't represent, so it's left to
 * `overrides`.
 */
function homogeneousItem(ast: SchemaAST.Arrays): SchemaAST.AST | undefined {
  if (ast.rest.length !== 1) return undefined;
  const [item] = ast.rest;
  if (ast.elements.length === 0) return item;
  if (ast.elements.length === 1 && ast.elements[0] === item) return item;
  return undefined;
}

/**
 * Derive the constraint (or nested tree) for one property/item type: a
 * struct descends into its properties, a homogeneous array descends into its
 * item type (the array's own length checks have no native equivalent for a
 * repeated field, so they're not derived) while folding the array's own
 * optionality into the item's `required`, and anything else is a leaf whose
 * `required` comes from optionality and whose refinement attributes come
 * from {@link constraintFromChecks}.
 */
function constraintsForType(type: SchemaAST.AST): InputConstraint | InputConstraints {
  const required = !isOptional(type);
  const inner = unwrapOptional(type);
  if (SchemaAST.isObjects(inner)) {
    return constraintsForObjects(inner);
  }
  if (SchemaAST.isArrays(inner)) {
    const item = homogeneousItem(inner);
    if (!item) return { required };
    const itemConstraints = constraintsForType(item);
    return isLeafConstraint(itemConstraints)
      ? { ...itemConstraints, required: required && itemConstraints.required !== false }
      : itemConstraints;
  }
  return { required, ...constraintFromChecks(type, inner) };
}

/** Build the constraint tree for one object AST node. */
function constraintsForObjects(ast: SchemaAST.Objects): InputConstraints {
  const out: Record<string, InputConstraint | InputConstraints> = {};
  for (const ps of ast.propertySignatures) {
    out[String(ps.name)] = constraintsForType(ps.type);
  }
  return out;
}

/** Deep-merge constraint overrides over a derived tree. */
function mergeConstraints(base: InputConstraints, overrides: InputConstraints): InputConstraints {
  const out: Record<string, InputConstraint | InputConstraints | undefined> = { ...base };
  for (const key of Object.keys(overrides)) {
    const override = overrides[key];
    if (override === undefined) continue;
    const existing = out[key];
    if (existing !== undefined && !isLeafConstraint(existing) && !isLeafConstraint(override)) {
      out[key] = mergeConstraints(existing, override);
    } else if (existing !== undefined && isLeafConstraint(existing) && isLeafConstraint(override)) {
      out[key] = { ...existing, ...override };
    } else {
      out[key] = override;
    }
  }
  return out;
}

/**
 * Derive the {@link InputConstraints} for a struct schema. Non-struct schemas
 * yield an empty tree. `overrides` (deep-merged over the derived tree, and
 * winning on conflict) is the seam for anything the AST walk does not infer.
 */
export function constraintsFromSchema(
  schema: Schema.Top,
  overrides: InputConstraints = {},
): InputConstraints {
  const ast = schema.ast;
  const base = SchemaAST.isObjects(ast) ? constraintsForObjects(ast) : {};
  return mergeConstraints(base, overrides);
}
