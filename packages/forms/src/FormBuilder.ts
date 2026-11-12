/**
 * Compose a form schema one field at a time, with cross-field refinements.
 *
 * {@link make} (aliased {@link empty}) starts an empty builder;
 * {@link FormBuilder.addField} adds a scalar field and {@link
 * FormBuilder.addArrayField} an array field, {@link FormBuilder.merge} folds
 * another builder in, and {@link FormBuilder.refine} /
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
import * as P from "effect/Predicate";
import * as R from "effect/Record";
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

/** A synchronous cross-field refinement over values `A` — becomes a struct-level schema check. */
interface SyncRefinement<A> {
  readonly _tag: "sync";
  readonly fn: (values: A) => Schema.FilterOutput;
}

/** An asynchronous cross-field refinement over values `A` — run by the Effect validate path. */
interface AsyncRefinement<A, R> {
  readonly _tag: "async";
  readonly fn: (values: A) => Effect.Effect<Schema.FilterOutput, never, R>;
}

/** Either refinement, typed against the decoded values `A` it checks and the services `R` it needs. */
type Refinement<A, R> = SyncRefinement<A> | AsyncRefinement<A, R>;

/**
 * A form assembled field by field. `TFields` accumulates the field record;
 * `R` accumulates the schemas' decoding-service requirements. Immutable — every
 * method returns a new builder.
 */
export interface FormBuilder<TFields extends FieldsRecord, R> {
  readonly [TypeId]: TypeId;
  readonly fields: TFields;
  /**
   * The refinements attached so far, in order, each typed against this
   * builder's decoded values (a refinement added before a later field still
   * accepts the wider value, which carries every field it saw).
   */
  readonly refinements: ReadonlyArray<Refinement<DecodedFromFields<TFields>, R>>;
  readonly _R?: R;

  /** Add a scalar field from a key and schema. */
  addField<K extends string, S extends Schema.Top>(
    key: K,
    schema: S,
  ): FormBuilder<TFields & { readonly [key in K]: FieldDef<K, S> }, R | S["DecodingServices"]>;

  /** Add an array field from a key and its item schema; the field is a list of items. */
  addArrayField<K extends string, S extends Schema.Top>(
    key: K,
    itemSchema: S,
  ): FormBuilder<TFields & { readonly [key in K]: ArrayFieldDef<K, S> }, R | S["DecodingServices"]>;

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

/** A builder over `fields` carrying `refinements`, its methods closing over both. */
function build<TFields extends FieldsRecord, R>(
  fields: TFields,
  refinements: ReadonlyArray<Refinement<DecodedFromFields<TFields>, R>>,
): FormBuilder<TFields, R> {
  return {
    [TypeId]: TypeId,
    fields,
    refinements,
    addField: (key, schema) =>
      build({ ...fields, ...R.singleton(key, Field.makeField(key, schema)) }, refinements),
    addArrayField: (key, itemSchema) =>
      build({ ...fields, ...R.singleton(key, Field.makeArrayField(key, itemSchema)) }, refinements),
    merge: <TFields2 extends FieldsRecord, R2>(other: FormBuilder<TFields2, R2>) =>
      build<TFields & TFields2, R | R2>({ ...fields, ...other.fields }, [
        ...refinements,
        ...other.refinements,
      ]),
    refine: (predicate) => build(fields, [...refinements, { _tag: "sync", fn: predicate }]),
    refineEffect: <RD>(
      predicate: (
        values: DecodedFromFields<TFields>,
      ) => Effect.Effect<Schema.FilterOutput, never, RD>,
    ) => build<TFields, R | RD>(fields, [...refinements, { _tag: "async", fn: predicate }]),
  };
}

/** Whether `u` is a {@link FormBuilder}. */
export const isFormBuilder = (u: unknown): u is FormBuilder<FieldsRecord, unknown> =>
  P.isObjectOrArray(u) && P.hasProperty(u, TypeId);

/** The field record of a builder with no fields yet — what {@link make} starts from. */
export type NoFields = { readonly [key in never]: AnyFieldDef };

/** The empty builder — the starting point for {@link FormBuilder.addField}. */
export const make: FormBuilder<NoFields, never> = build<NoFields, never>({}, []);

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
  const structFields = R.fromEntries(
    Arr.flatMap(R.toEntries(self.fields), ([key, def]): Array<readonly [string, Schema.Top]> => {
      if (Field.isArrayFieldDef(def)) return [[key, Schema.Array(def.itemSchema)]];
      if (Field.isFieldDef(def)) return [[key, def.schema]];
      return [];
    }),
  );

  const erased: Schema.Top = Schema.Struct(structFields);
  // SAFETY: the struct has exactly one property per entry of `self.fields` —
  // a scalar field's schema, or an array field's item schema under
  // `Schema.Array` — which is the shape `DecodedFromFields` /
  // `EncodedFromFields` compute, and `R` is by construction the union of
  // those schemas' decoding services. TypeScript can't relate `Schema.Struct`'s
  // own computed types to those mapped types over the unresolved `TFields`,
  // nor witness the phantom `R`, so this is asserted once, here.
  const struct = erased as Schema.Codec<DecodedFromFields<TFields>, EncodedFromFields<TFields>, R>;
  // Checks leave `Type` and `Encoded` unchanged.
  return Arr.reduce(self.refinements, struct, (refined, refinement) =>
    P.isTagged(refinement, "sync") ? refined.check(Schema.makeFilter(refinement.fn)) : refined,
  );
}

/** The asynchronous refinements carried on a builder, as bare predicates. */
export function asyncRefinements<TFields extends FieldsRecord, R>(
  self: FormBuilder<TFields, R>,
): ReadonlyArray<
  (values: DecodedFromFields<TFields>) => Effect.Effect<Schema.FilterOutput, never, R>
> {
  return Arr.flatMap(self.refinements, (refinement) =>
    P.isTagged(refinement, "async") ? [refinement.fn] : [],
  );
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
