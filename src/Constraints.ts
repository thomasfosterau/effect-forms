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
 * The derivation is intentionally conservative — it reads `required` (a
 * struct field whose type is not optional) and descends into nested structs.
 * Refinement-derived attributes (`minlength` / `max` / `pattern`) vary by how
 * a check is annotated, so rather than guess, callers layer them in via the
 * `overrides` argument to {@link constraintsFromSchema}.
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

/** Build the constraint tree for one object AST node. */
function constraintsForObjects(ast: SchemaAST.Objects): InputConstraints {
  const out: Record<string, InputConstraint | InputConstraints> = {};
  for (const ps of ast.propertySignatures) {
    const key = String(ps.name);
    const type = ps.type;
    if (SchemaAST.isObjects(type)) {
      out[key] = constraintsForObjects(type);
    } else {
      out[key] = { required: !isOptional(type) };
    }
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
 * yield an empty tree. `overrides` (deep-merged over the derived tree) is the
 * seam for refinement-derived attributes the AST walk does not infer.
 */
export function constraintsFromSchema(
  schema: Schema.Top,
  overrides: InputConstraints = {},
): InputConstraints {
  const ast = schema.ast;
  const base = SchemaAST.isObjects(ast) ? constraintsForObjects(ast) : {};
  return mergeConstraints(base, overrides);
}
