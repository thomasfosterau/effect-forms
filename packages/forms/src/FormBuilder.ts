/**
 * Compose a form schema one field at a time, with cross-field refinements.
 *
 * {@link make} (aliased {@link empty}) starts an empty builder;
 * {@link FormBuilder.addField} adds a scalar or array field, {@link
 * FormBuilder.merge} folds another builder in, and {@link FormBuilder.refine} /
 * {@link FormBuilder.refineEffect} attach cross-field validations. The point is
 * incremental composition — assemble a large form from small, reusable
 * field-group builders — plus a home for whole-form rules (`password ===
 * confirmPassword`) that a single field schema can't express.
 *
 * {@link buildSchema} collapses the accumulated fields into an ordinary
 * `Schema.Struct` (array fields become `Schema.Array(item)`) and applies every
 * *synchronous* refinement as a struct-level `check`, so the result decodes,
 * derives constraints, and validates exactly like a hand-written schema — hand
 * it straight to {@link module:effect-forms/Form}'s `make`. *Asynchronous*
 * refinements can't be schema checks (Effect Schema has no effectful filter),
 * so they're carried on the builder and run by the Effect-returning validate
 * path — {@link asyncRefinements} exposes them and {@link runAsyncRefinements}
 * runs them into a {@link FormIssue} list.
 *
 * @copyright Thomas Foster
 * @module effect-forms/FormBuilder
 */

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import * as Schema from "effect/Schema";
import type {
  AnyFieldDef,
  ArrayFieldDef,
  DecodedFromFields,
  EncodedFromFields,
  FieldDef,
  FieldsRecord,
} from "./Field.ts";
import * as Field from "./Field.ts";
import type * as Issues from "./Issues.ts";
import type { FormIssue } from "./Issues.ts";
import { filterOutputToFormIssues as issuesFromFilterOutput } from "./Issues.ts";

/** Brand for a {@link FormBuilder}. */
export const TypeId: unique symbol = Symbol.for("@thomasfosterau/effect-forms/FormBuilder");
export type TypeId = typeof TypeId;

/** A synchronous cross-field refinement — becomes a struct-level schema check. */
interface SyncRefinement {
  readonly _tag: "sync";
  readonly fn: (values: unknown) => Schema.FilterOutput;
}

/** An asynchronous cross-field refinement — run by the Effect validate path. */
interface AsyncRefinement {
  readonly _tag: "async";
  readonly fn: (values: unknown) => Effect.Effect<Schema.FilterOutput, never, unknown>;
}

type Refinement = SyncRefinement | AsyncRefinement;

/**
 * A form assembled field by field. `TFields` accumulates the field record;
 * `R` accumulates the schemas' decoding-service requirements. Immutable — every
 * method returns a new builder.
 */
export interface FormBuilder<TFields extends FieldsRecord, R> {
  readonly [TypeId]: TypeId;
  readonly fields: TFields;
  readonly refinements: ReadonlyArray<Refinement>;
  readonly _R?: R;

  /** Add a scalar field from a {@link FieldDef}. */
  addField<K extends string, S extends Schema.Top>(
    field: FieldDef<K, S>,
  ): FormBuilder<TFields & { readonly [key in K]: FieldDef<K, S> }, R | S["DecodingServices"]>;
  /** Add an array field from an {@link ArrayFieldDef}. */
  addField<K extends string, S extends Schema.Top>(
    field: ArrayFieldDef<K, S>,
  ): FormBuilder<TFields & { readonly [key in K]: ArrayFieldDef<K, S> }, R | S["DecodingServices"]>;
  /** Add a scalar field from a key and schema. */
  addField<K extends string, S extends Schema.Top>(
    key: K,
    schema: S,
  ): FormBuilder<TFields & { readonly [key in K]: FieldDef<K, S> }, R | S["DecodingServices"]>;

  /** Fold another builder's fields and refinements into this one. */
  merge<TFields2 extends FieldsRecord, R2>(
    other: FormBuilder<TFields2, R2>,
  ): FormBuilder<TFields & TFields2, R | R2>;

  /**
   * Attach a synchronous whole-form validation. The predicate sees the decoded
   * values and returns a {@link Schema.FilterOutput} (`undefined` / `true` to
   * pass, a message / `{ path, issue }` / list to fail).
   */
  refine(
    predicate: (values: DecodedFromFields<TFields>) => Schema.FilterOutput,
  ): FormBuilder<TFields, R>;

  /** Attach an asynchronous whole-form validation (run by the validate path). */
  refineEffect<RD>(
    predicate: (
      values: DecodedFromFields<TFields>,
    ) => Effect.Effect<Schema.FilterOutput, never, RD>,
  ): FormBuilder<TFields, R | RD>;
}

/** `addField`'s overloads as one argument list: a field definition, or a key with its schema. */
type AddFieldArgs = readonly [field: AnyFieldDef] | readonly [key: string, schema: Schema.Top];

/** Whether `addField` was called with the `(key, schema)` overload — the only one whose first argument is a string. */
const isKeyedArgs = (args: AddFieldArgs): args is readonly [key: string, schema: Schema.Top] =>
  Predicate.isString(args[0]);

const proto = {
  [TypeId]: TypeId,
  addField(
    this: FormBuilder<FieldsRecord, unknown>,
    ...args: AddFieldArgs
  ): FormBuilder<FieldsRecord, unknown> {
    const field = isKeyedArgs(args) ? Field.makeField(...args) : args[0];
    return build({ ...this.fields, [field.key]: field }, this.refinements);
  },
  merge(
    this: FormBuilder<FieldsRecord, unknown>,
    other: FormBuilder<FieldsRecord, unknown>,
  ): FormBuilder<FieldsRecord, unknown> {
    return build({ ...this.fields, ...other.fields }, [...this.refinements, ...other.refinements]);
  },
  refine(
    this: FormBuilder<FieldsRecord, unknown>,
    predicate: (values: unknown) => Schema.FilterOutput,
  ): FormBuilder<FieldsRecord, unknown> {
    return build(this.fields, [...this.refinements, { _tag: "sync", fn: predicate }]);
  },
  refineEffect(
    this: FormBuilder<FieldsRecord, unknown>,
    predicate: (values: unknown) => Effect.Effect<Schema.FilterOutput, never, unknown>,
  ): FormBuilder<FieldsRecord, unknown> {
    return build(this.fields, [...this.refinements, { _tag: "async", fn: predicate }]);
  },
};

function build(
  fields: FieldsRecord,
  refinements: ReadonlyArray<Refinement>,
): FormBuilder<FieldsRecord, unknown> {
  const self = Object.create(proto);
  self.fields = fields;
  self.refinements = refinements;
  return self;
}

/** Whether `u` is a {@link FormBuilder}. */
export const isFormBuilder = (u: unknown): u is FormBuilder<FieldsRecord, unknown> =>
  Predicate.isObjectOrArray(u) && Predicate.hasProperty(u, TypeId);

/** The empty builder — the starting point for {@link FormBuilder.addField}. */
// SAFETY: a builder with no fields and no refinements is exactly
// `FormBuilder<{}, never>`; `build` merely erases the field-record and `R`
// types its shared implementation works over.
export const make = build({}, []) as FormBuilder<Record<never, never>, never>;

/** Alias of {@link make} — the empty builder. */
export const empty = make;

/**
 * Collapse a builder into an Effect Schema: a `Schema.Struct` of the fields
 * (array fields as `Schema.Array(item)`) with every synchronous refinement
 * applied as a struct-level check. Ready for {@link module:effect-forms/Form}.
 */
export function buildSchema<TFields extends FieldsRecord, R>(
  self: FormBuilder<TFields, R>,
): Schema.Codec<DecodedFromFields<TFields>, EncodedFromFields<TFields>, R> {
  const structFields = Rec.fromEntries(
    Arr.flatMap(Rec.toEntries(self.fields), ([key, def]): Array<readonly [string, Schema.Top]> => {
      if (Field.isArrayFieldDef(def)) return [[key, Schema.Array(def.itemSchema)]];
      if (Field.isFieldDef(def)) return [[key, def.schema]];
      return [];
    }),
  );

  const struct: Schema.Top = Schema.Struct(structFields);
  const schema = Arr.reduce(self.refinements, struct, (refined, refinement) =>
    Predicate.isTagged(refinement, "sync")
      ? refined.check(Schema.makeFilter(refinement.fn))
      : refined,
  );

  // SAFETY: the struct has exactly one property per entry of `self.fields` —
  // a scalar field's schema, or an array field's item schema under
  // `Schema.Array` — which is the shape `DecodedFromFields` /
  // `EncodedFromFields` compute; checks leave `Type` and `Encoded` unchanged;
  // and `R` is by construction the union of those schemas' decoding services.
  return schema as Schema.Codec<DecodedFromFields<TFields>, EncodedFromFields<TFields>, R>;
}

/** The asynchronous refinements carried on a builder, as bare predicates. */
export function asyncRefinements<TFields extends FieldsRecord, R>(
  self: FormBuilder<TFields, R>,
): ReadonlyArray<
  (values: DecodedFromFields<TFields>) => Effect.Effect<Schema.FilterOutput, never, R>
> {
  return Arr.flatMap(self.refinements, (refinement) => {
    if (!Predicate.isTagged(refinement, "async")) return [];
    // SAFETY: `refineEffect` stores a predicate typed against this builder's
    // decoded values, with its requirements folded into `R`; the builder keeps
    // it as `(values: unknown) => Effect<…, unknown>` only to share one
    // `Refinement` type across builders, so this restores the original type.
    const fn = refinement.fn as (
      values: DecodedFromFields<TFields>,
    ) => Effect.Effect<Schema.FilterOutput, never, R>;
    return [fn];
  });
}

/**
 * Normalise a filter predicate's `Schema.FilterOutput` into a flat list of
 * {@link FormIssue}s (empty on success).
 *
 * @deprecated Use `Issues.filterOutputToFormIssues`; this re-export remains
 * only for callers that imported it from `FormBuilder`.
 */
export const filterOutputToFormIssues: typeof Issues.filterOutputToFormIssues =
  issuesFromFilterOutput;

/**
 * Run every asynchronous refinement on `self` against `values` and collect
 * their failures as {@link FormIssue}s (empty when all pass). Runs them
 * concurrently; requirements propagate on the `R` channel.
 */
export function runAsyncRefinements<TFields extends FieldsRecord, R>(
  self: FormBuilder<TFields, R>,
  values: DecodedFromFields<TFields>,
): Effect.Effect<ReadonlyArray<FormIssue>, never, R> {
  return Arr.match(asyncRefinements(self), {
    onEmpty: (): Effect.Effect<ReadonlyArray<FormIssue>, never, R> => Effect.succeed([]),
    onNonEmpty: (refinements) =>
      Effect.forEach(refinements, (fn) => fn(values), { concurrency: "unbounded" }).pipe(
        Effect.map((outputs) => Arr.flatMap(outputs, issuesFromFilterOutput)),
      ),
  });
}
