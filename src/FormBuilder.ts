/**
 * @copyright Thomas Foster
 *
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
 * @module effect-forms/FormBuilder
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  AnyFieldDef,
  ArrayFieldDef,
  DecodedFromFields,
  EncodedFromFields,
  FieldDef,
  FieldsRecord,
} from "./Field.ts";
import { isArrayFieldDef, isFieldDef, makeField } from "./Field.ts";
import type { FormIssue } from "./Issues.ts";
import { schemaIssuesToFormIssues } from "./Issues.ts";

/** Brand for a {@link FieldRef} — an opaque, typed handle to one field. */
export const FieldTypeId: unique symbol = Symbol.for("@thomasfosterau/effect-forms/FieldRef");
export type FieldTypeId = typeof FieldTypeId;

/**
 * A typed reference to a field, carrying its *encoded* value type as a phantom.
 * A reactive store hands these out so a component can bind to one field without
 * stringly-typed paths.
 */
export interface FieldRef<E> {
  readonly [FieldTypeId]: FieldTypeId;
  readonly _E: E;
  readonly key: string;
}

/** Construct a {@link FieldRef} for `key`. */
export const makeFieldRef = <E>(key: string): FieldRef<E> => ({
  [FieldTypeId]: FieldTypeId,
  _E: undefined as never,
  key,
});

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

const proto = {
  [TypeId]: TypeId,
  addField(
    this: FormBuilder<FieldsRecord, unknown>,
    keyOrField: string | AnyFieldDef,
    schema?: Schema.Top,
  ): FormBuilder<FieldsRecord, unknown> {
    const field = typeof keyOrField === "string" ? makeField(keyOrField, schema!) : keyOrField;
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
  typeof u === "object" && u !== null && TypeId in u;

/** The empty builder — the starting point for {@link FormBuilder.addField}. */
export const make: FormBuilder<Record<never, never>, never> = build({}, []) as never;

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
  const structFields: Record<string, Schema.Top> = {};
  for (const [key, def] of Object.entries(self.fields)) {
    if (isArrayFieldDef(def)) structFields[key] = Schema.Array(def.itemSchema);
    else if (isFieldDef(def)) structFields[key] = def.schema;
  }

  let schema: Schema.Top = Schema.Struct(structFields);
  for (const refinement of self.refinements) {
    if (refinement._tag === "sync") schema = schema.check(Schema.makeFilter(refinement.fn));
  }

  return schema as unknown as Schema.Codec<
    DecodedFromFields<TFields>,
    EncodedFromFields<TFields>,
    R
  >;
}

/** The asynchronous refinements carried on a builder, as bare predicates. */
export function asyncRefinements<TFields extends FieldsRecord, R>(
  self: FormBuilder<TFields, R>,
): ReadonlyArray<
  (values: DecodedFromFields<TFields>) => Effect.Effect<Schema.FilterOutput, never, R>
> {
  return self.refinements
    .filter((r): r is AsyncRefinement => r._tag === "async")
    .map((r) => r.fn as never);
}

/**
 * Normalise a filter predicate's {@link Schema.FilterOutput} into a flat list of
 * {@link FormIssue}s (empty on success). Shared by the async-refinement path so
 * whole-form failures fold into the same nested error tree as field failures.
 */
export function filterOutputToFormIssues(output: Schema.FilterOutput): FormIssue[] {
  if (output === undefined || output === true) return [];
  if (output === false) return [{ path: [], message: "Invalid value" }];
  if (Array.isArray(output)) return output.flatMap(filterIssueToFormIssues);
  return filterIssueToFormIssues(output as Schema.FilterIssue);
}

function filterIssueToFormIssues(issue: Schema.FilterIssue): FormIssue[] {
  if (typeof issue === "string") return [{ path: [], message: issue }];
  if ("path" in issue && "issue" in issue) {
    const prefix = issue.path.map((s) => (typeof s === "symbol" ? s.toString() : s));
    const inner =
      typeof issue.issue === "string"
        ? [{ path: [], message: issue.issue }]
        : schemaIssuesToFormIssues(issue.issue);
    return inner.map((i) => ({ path: [...prefix, ...i.path], message: i.message }));
  }
  return schemaIssuesToFormIssues(issue);
}

/**
 * Run every asynchronous refinement on `self` against `values` and collect
 * their failures as {@link FormIssue}s (empty when all pass). Runs them
 * concurrently; requirements propagate on the `R` channel.
 */
export function runAsyncRefinements<TFields extends FieldsRecord, R>(
  self: FormBuilder<TFields, R>,
  values: DecodedFromFields<TFields>,
): Effect.Effect<ReadonlyArray<FormIssue>, never, R> {
  const refinements = asyncRefinements(self);
  if (refinements.length === 0) return Effect.succeed([]);
  return Effect.forEach(refinements, (fn) => fn(values), { concurrency: "unbounded" }).pipe(
    Effect.map((outputs) => outputs.flatMap(filterOutputToFormIssues)),
  );
}
