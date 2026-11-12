/**
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
 * `representation` annotation Effect Schema's built-in checks carry
 * (`isMinLength`, `isBetween`, `isPattern`, …), keyed by its stable
 * `effect/schema/<check>` id. A check with no recognised representation id
 * (a bare `Schema.filter` predicate, a custom `.check()`) contributes
 * nothing; there is no attribute to guess at,
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
 * @copyright Thomas Foster
 * @module effect-forms/Constraints
 */

import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type * as SchemaRepresentation from "effect/SchemaRepresentation";
import type { FormPath } from "./Issues.ts";

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

/** Whether a node in an {@link InputConstraints} tree is a leaf ({@link InputConstraint}) rather than a branch. */
export const isLeafConstraint = (
  value: InputConstraint | InputConstraints,
): value is InputConstraint =>
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
  return Arr.findFirst(
    type.types,
    (member) => !SchemaAST.isUndefined(member) && !SchemaAST.isNull(member),
  ).pipe(Option.match({ onNone: () => type, onSome: unwrapOptional }));
}

/** Flatten a `Checks` array (recursing into `FilterGroup`s) into individual filters. */
function flattenChecks(
  checks: ReadonlyArray<SchemaAST.Check<never>> | undefined,
): Array<SchemaAST.Filter<never>> {
  if (checks === undefined) return [];
  return Arr.flatMap(checks, (check) =>
    P.isTagged(check, "FilterGroup") ? flattenChecks(check.checks) : [check],
  );
}

/** A same-shape, mutable patch of {@link InputConstraint} fields. */
type ConstraintPatch = { -readonly [K in keyof InputConstraint]?: InputConstraint[K] };

/**
 * A patch from one check's `representation.payload`, decoded through
 * `payload` first: a payload without the shape the check constructor
 * publishes yields no patch rather than a malformed one.
 */
const patchFrom =
  <A>(payload: Schema.Codec<A>, toPatch: (decoded: A) => ConstraintPatch) =>
  (json: Schema.Json): Option.Option<ConstraintPatch> =>
    Option.map(Schema.decodeUnknownOption(payload)(json), toPatch);

/**
 * One constraint patch per recognised representation id — the built-in
 * checks that map onto a native HTML attribute — each decoding the payload
 * shape that check's constructor in `effect/Schema` publishes (e.g.
 * `isMinLength` writes `{ id: "effect/schema/isMinLength", payload: {
 * minLength } }`). An id with no entry here (an unannotated custom filter, or
 * a built-in check with no HTML equivalent) derives nothing. `isInt` isn't a
 * plain patch: it only sets `step` as a fallback when nothing more specific
 * already did, so it's handled separately in {@link constraintFromChecks}.
 */
const payloadPatches: R.ReadonlyRecord<
  string,
  (payload: Schema.Json) => Option.Option<ConstraintPatch>
> = {
  "effect/schema/isMinLength": patchFrom(Schema.Struct({ minLength: Schema.Finite }), (p) => ({
    minlength: p.minLength,
  })),
  "effect/schema/isMaxLength": patchFrom(Schema.Struct({ maxLength: Schema.Finite }), (p) => ({
    maxlength: p.maxLength,
  })),
  "effect/schema/isBetweenLength": patchFrom(
    Schema.Struct({ minimum: Schema.Finite, maximum: Schema.Finite }),
    (p) => ({ minlength: p.minimum, maxlength: p.maximum }),
  ),
  "effect/schema/isPattern": patchFrom(Schema.Struct({ source: Schema.String }), (p) => ({
    pattern: p.source,
  })),
  "effect/schema/isGreaterThan": patchFrom(
    Schema.Struct({ exclusiveMinimum: Schema.Finite }),
    (p) => ({ min: p.exclusiveMinimum }),
  ),
  "effect/schema/isGreaterThanOrEqualTo": patchFrom(
    Schema.Struct({ minimum: Schema.Finite }),
    (p) => ({ min: p.minimum }),
  ),
  "effect/schema/isLessThan": patchFrom(
    Schema.Struct({ exclusiveMaximum: Schema.Finite }),
    (p) => ({ max: p.exclusiveMaximum }),
  ),
  "effect/schema/isLessThanOrEqualTo": patchFrom(
    Schema.Struct({ maximum: Schema.Finite }),
    (p) => ({ max: p.maximum }),
  ),
  "effect/schema/isBetween": patchFrom(
    Schema.Struct({ minimum: Schema.Finite, maximum: Schema.Finite }),
    (p) => ({ min: p.minimum, max: p.maximum }),
  ),
  "effect/schema/isMultipleOf": patchFrom(Schema.Struct({ divisor: Schema.Finite }), (p) => ({
    step: p.divisor,
  })),
};

/**
 * Look up `payloadPatches[representation.id]` (an own key, never an inherited
 * one) and apply it to the representation's payload.
 */
const applyPayloadPatch = (
  representation: SchemaRepresentation.RepresentationAnnotation,
): Option.Option<ConstraintPatch> =>
  Option.flatMap(R.get(payloadPatches, representation.id), (patch) =>
    patch(representation.payload),
  );
/** Whether a check is `Schema.isInt` (it implies `step="1"`, not an attribute payload). */
const isIntCheck = (representation: SchemaRepresentation.RepresentationAnnotation): boolean =>
  representation.id === "effect/schema/isInt";

/**
 * Derive an {@link InputConstraint}'s refinement attributes from the checks
 * attached to `outer` (the property's own type, e.g. the union wrapping an
 * optional field) and `inner` (the unwrapped leaf) — `inner`'s checks win on
 * conflict since they're the more specific, unwrapped node. A check whose
 * `representation` annotation has no recognised id (an unannotated custom
 * filter) is skipped: there is no attribute to derive from it.
 */
function constraintFromChecks(outer: SchemaAST.AST, inner: SchemaAST.AST): InputConstraint {
  const filters =
    inner === outer
      ? flattenChecks(outer.checks)
      : [...flattenChecks(outer.checks), ...flattenChecks(inner.checks)];
  const representations = Arr.flatMap(filters, (filter) => {
    const representation = filter.annotations?.representation;
    return representation === undefined ? [] : [representation];
  });

  const empty: ConstraintPatch = {};
  const patched = Arr.reduce(representations, empty, (out, representation) =>
    isIntCheck(representation)
      ? out
      : { ...out, ...Option.getOrUndefined(applyPayloadPatch(representation)) },
  );

  return Arr.some(representations, isIntCheck) && patched.step === undefined
    ? { ...patched, step: 1 }
    : patched;
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
  return Arr.match(ast.elements, {
    onEmpty: () => item,
    onNonEmpty: (elements) => (elements.length === 1 && elements[0] === item ? item : undefined),
  });
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
  return R.fromEntries(
    Arr.map(
      ast.propertySignatures,
      (ps) => [String(ps.name), constraintsForType(ps.type)] as const,
    ),
  );
}

/** Deep-merge constraint overrides over a derived tree. */
function mergeConstraints(base: InputConstraints, overrides: InputConstraints): InputConstraints {
  const merged = Arr.flatMap(
    R.keys<string, InputConstraints[string]>(overrides),
    (key): Array<readonly [string, InputConstraint | InputConstraints]> => {
      const override = overrides[key];
      if (override === undefined) return [];
      const existing = base[key];
      if (existing !== undefined && !isLeafConstraint(existing) && !isLeafConstraint(override)) {
        return [[key, mergeConstraints(existing, override)]];
      }
      if (existing !== undefined && isLeafConstraint(existing) && isLeafConstraint(override)) {
        return [[key, { ...existing, ...override }]];
      }
      return [[key, override]];
    },
  );
  return { ...base, ...R.fromEntries(merged) };
}

/**
 * Derive the {@link InputConstraints} for a struct schema. Non-struct schemas
 * yield an empty tree. `overrides` (deep-merged over the derived tree, and
 * winning on conflict) is the seam for anything the AST walk does not infer.
 *
 * @example
 * ```ts
 * import * as Schema from "effect/Schema"
 * import { Constraints } from "@thomasfosterau/effect-forms"
 *
 * const Signup = Schema.Struct({
 *   name: Schema.String.check(Schema.isMinLength(2)),
 *   nickname: Schema.optional(Schema.String),
 * })
 * console.log(Constraints.constraintsFromSchema(Signup))
 * // { name: { required: true, minlength: 2 }, nickname: { required: false } }
 * ```
 */
export function constraintsFromSchema(
  schema: Schema.Top,
  overrides: InputConstraints = {},
): InputConstraints {
  const ast = schema.ast;
  const base = SchemaAST.isObjects(ast) ? constraintsForObjects(ast) : {};
  return mergeConstraints(base, overrides);
}

/**
 * Read the {@link InputConstraint} leaf at `path` in an {@link InputConstraints}
 * tree, defaulting to `{}` when `path` has no derived constraints. Array
 * indices in `path` are skipped rather than descended into — the tree has no
 * per-item nodes to index into, since {@link constraintsForType} derives one
 * constraint (or branch) per *field*, shared by every item at that field. A
 * bare item path (`tags[0]`) resolves to that shared leaf; a path that
 * continues past the index into a struct item's own field (`items[0].label`)
 * skips the index and resolves straight to `label`'s derived constraint.
 */
export function constraintAt(constraints: InputConstraints, path: FormPath): InputConstraint {
  // Index segments are skipped (a list's items share one constraint). Once a
  // string segment runs past a leaf or off the tree the accumulator is
  // `undefined`, and stays so for every later segment.
  const node = Arr.reduce<string | number, InputConstraint | InputConstraints | undefined>(
    path,
    constraints,
    (current, segment) => {
      if (P.isNumber(segment)) return current;
      if (current === undefined || isLeafConstraint(current)) return undefined;
      return current[segment];
    },
  );
  return node !== undefined && isLeafConstraint(node) ? node : {};
}
