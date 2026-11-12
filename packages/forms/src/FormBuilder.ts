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
 * A builder tracks two kinds of service separately: the decoding services of
 * its field schemas live in the built `Schema.Struct`'s own
 * `DecodingServices`, and the services its `refineEffect` refinements need
 * accumulate in its `RefineR` parameter.
 *
 * @copyright Thomas Foster
 * @module effect-forms/FormBuilder
 */

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import type { FieldsRecord } from "./Field.ts";
import * as Field from "./Field.ts";
import type * as Issues from "./Issues.ts";
import type { FormIssue } from "./Issues.ts";
import { filterOutputToFormIssues as issuesFromFilterOutput } from "./Issues.ts";

/** Brand for a {@link FormBuilder}. */
export const TypeId: unique symbol = Symbol.for("@thomasfosterau/effect-forms/FormBuilder");
export type TypeId = typeof TypeId;

/** The decoded values of a builder over the struct fields `F`: what its refinements see. */
export type Values<F extends Schema.Struct.Fields> = Schema.Struct.Type<F>;

/** The decoded values of any builder: every builder's {@link Values} is one. */
export type AnyValues = Values<Schema.Struct.Fields>;

/** The encoded (form-input) values of a builder over the struct fields `F`. */
export type Encoded<F extends Schema.Struct.Fields> = Schema.Struct.Encoded<F>;

/**
 * A synchronous cross-field refinement — becomes a struct-level schema check.
 * It accepts any later, wider builder's values: it first checks them against
 * the type side of the fields it was attached over (`Schema.is`), which a
 * successfully decoded value of a wider struct always passes, and only then
 * runs its predicate.
 */
interface SyncRefinement {
  readonly _tag: "sync";
  readonly run: (values: AnyValues) => Schema.FilterOutput;
  readonly annotations?: Schema.Annotations.Filter;
}

/**
 * An asynchronous cross-field refinement — run by the Effect validate path.
 * Accepts a wider builder's values the same way as {@link SyncRefinement}.
 */
interface AsyncRefinement<R> {
  readonly _tag: "async";
  readonly run: (values: AnyValues) => Effect.Effect<Schema.FilterOutput, never, R>;
}

/** Either refinement, with the services `R` an asynchronous one needs. */
type Refinement<R> = SyncRefinement | AsyncRefinement<R>;

/**
 * A form assembled field by field. `F` accumulates the `Schema.Struct` fields
 * (an array field as `Schema.Array(item)`), so {@link buildSchema} returns
 * `Schema.Struct<F>` with its own computed types; `RefineR` accumulates the
 * services the `refineEffect` refinements need. Immutable — every method
 * returns a new builder.
 */
export interface FormBuilder<F extends Schema.Struct.Fields, RefineR = never> {
  readonly [TypeId]: TypeId;
  /** Each field's definition (a scalar or array field), keyed by name. */
  readonly fields: FieldsRecord;
  /** The `Schema.Struct` fields {@link buildSchema} collapses the builder to. */
  readonly structFields: F;
  /**
   * The refinements attached so far, in order. Each accepts this builder's
   * decoded values: one attached before a later field checks the wider value
   * against the fields it saw before its predicate runs.
   */
  readonly refinements: ReadonlyArray<Refinement<RefineR>>;

  /** Add a scalar field from a key and schema. */
  addField<K extends string, S extends Schema.Top>(
    key: K,
    schema: S,
  ): FormBuilder<F & { readonly [key in K]: S }, RefineR>;

  /** Add an array field from a key and its item schema; the field is a list of items. */
  addArrayField<K extends string, S extends Schema.Top>(
    key: K,
    itemSchema: S,
  ): FormBuilder<F & { readonly [key in K]: Schema.$Array<S> }, RefineR>;

  /** Fold another builder's fields and refinements into this one. */
  merge<F2 extends Schema.Struct.Fields, R2>(
    other: FormBuilder<F2, R2>,
  ): FormBuilder<F & F2, RefineR | R2>;

  /**
   * Attach a synchronous whole-form validation. The predicate sees the decoded
   * values and returns a {@link Schema.FilterOutput} (`undefined` / `true` to
   * pass, a message / `{ path, issue }` / list to fail). `annotations`
   * (`identifier`, `title`, `description`, …) describe the check in the
   * resulting schema; without them the check stays anonymous.
   */
  refine(
    predicate: (values: Values<F>) => Schema.FilterOutput,
    annotations?: Schema.Annotations.Filter,
  ): FormBuilder<F, RefineR>;

  /** Attach an asynchronous whole-form validation (run by the validate path). */
  refineEffect<RD>(
    predicate: (values: Values<F>) => Effect.Effect<Schema.FilterOutput, never, RD>,
  ): FormBuilder<F, RefineR | RD>;
}

/** A builder over `fields` / `structFields` carrying `refinements`, its methods closing over all three. */
function build<F extends Schema.Struct.Fields, RefineR>(
  fields: FieldsRecord,
  structFields: F,
  refinements: ReadonlyArray<Refinement<RefineR>>,
): FormBuilder<F, RefineR> {
  return {
    [TypeId]: TypeId,
    fields,
    structFields,
    refinements,
    addField: <K extends string, S extends Schema.Top>(key: K, schema: S) =>
      build<F & { readonly [key in K]: S }, RefineR>(
        { ...fields, ...R.singleton(key, Field.makeField(key, schema)) },
        { ...structFields, ...R.singleton(key, schema) },
        refinements,
      ),
    addArrayField: <K extends string, S extends Schema.Top>(key: K, itemSchema: S) =>
      build<F & { readonly [key in K]: Schema.$Array<S> }, RefineR>(
        { ...fields, ...R.singleton(key, Field.makeArrayField(key, itemSchema)) },
        { ...structFields, ...R.singleton(key, Schema.Array(itemSchema)) },
        refinements,
      ),
    merge: <F2 extends Schema.Struct.Fields, R2>(other: FormBuilder<F2, R2>) =>
      build<F & F2, RefineR | R2>(
        { ...fields, ...other.fields },
        { ...structFields, ...other.structFields },
        [...refinements, ...other.refinements],
      ),
    refine: (predicate, annotations) => {
      const isValues = Schema.is(Schema.Struct(structFields));
      const run = (values: AnyValues): Schema.FilterOutput =>
        isValues(values) ? predicate(values) : undefined;
      return build(fields, structFields, [
        ...refinements,
        annotations === undefined ? { _tag: "sync", run } : { _tag: "sync", run, annotations },
      ]);
    },
    refineEffect: <RD>(
      predicate: (values: Values<F>) => Effect.Effect<Schema.FilterOutput, never, RD>,
    ) => {
      const isValues = Schema.is(Schema.Struct(structFields));
      const run = (values: AnyValues): Effect.Effect<Schema.FilterOutput, never, RD> =>
        isValues(values) ? predicate(values) : Effect.succeed(true);
      return build<F, RefineR | RD>(fields, structFields, [...refinements, { _tag: "async", run }]);
    },
  };
}

/** Whether `u` is a {@link FormBuilder}. */
export const isFormBuilder = (u: unknown): u is FormBuilder<Schema.Struct.Fields, unknown> =>
  P.isObjectOrArray(u) && P.hasProperty(u, TypeId);

/** The struct fields of a builder with no fields yet — what {@link make} starts from. */
export type NoFields = { readonly [key in never]: Schema.Top };

/** The empty builder — the starting point for {@link FormBuilder.addField}. */
export const make: FormBuilder<NoFields> = build<NoFields, never>({}, {}, []);

/** Alias of {@link make} — the empty builder. */
export const empty = make;

/**
 * Collapse a builder into an Effect Schema: the `Schema.Struct` of its fields
 * (array fields as `Schema.Array(item)`) with every synchronous refinement
 * applied as a struct-level check. Ready for {@link module:effect-forms/Form}.
 * Its decoding services are the field schemas' own; the `refineEffect`
 * refinements' services are not part of it (see {@link runAsyncRefinements}).
 */
export function buildSchema<F extends Schema.Struct.Fields, RefineR>(
  self: FormBuilder<F, RefineR>,
): Schema.Struct<F> {
  // Checks leave `Type` and `Encoded` unchanged.
  return Arr.reduce(self.refinements, Schema.Struct(self.structFields), (refined, refinement) =>
    P.isTagged(refinement, "sync")
      ? refined.check(Schema.makeFilter(refinement.run, refinement.annotations))
      : refined,
  );
}

/** The asynchronous refinements carried on a builder, as bare predicates. */
export function asyncRefinements<F extends Schema.Struct.Fields, RefineR>(
  self: FormBuilder<F, RefineR>,
): ReadonlyArray<(values: Values<F>) => Effect.Effect<Schema.FilterOutput, never, RefineR>> {
  return Arr.flatMap(self.refinements, (refinement) =>
    P.isTagged(refinement, "async") ? [refinement.run] : [],
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
 * concurrently; their services propagate on the `RefineR` channel.
 */
export function runAsyncRefinements<F extends Schema.Struct.Fields, RefineR>(
  self: FormBuilder<F, RefineR>,
  values: Values<F>,
): Effect.Effect<ReadonlyArray<FormIssue>, never, RefineR> {
  return Arr.match(asyncRefinements(self), {
    onEmpty: (): Effect.Effect<ReadonlyArray<FormIssue>, never, RefineR> => Effect.succeed([]),
    onNonEmpty: (refinements) =>
      Effect.forEach(refinements, (fn) => fn(values), { concurrency: "unbounded" }).pipe(
        Effect.map((outputs) => Arr.flatMap(outputs, issuesFromFilterOutput)),
      ),
  });
}
