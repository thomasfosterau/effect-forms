/**
 * {@link make} — the core entry point: bind an Effect Schema to a form and
 * get back a validator and an empty-state factory.
 *
 * This is the framework-neutral validate-and-seed entry point,
 * expressed as a small object bound to one schema:
 *
 * - `validate(input)` parses an HTML form body (or a plain object) and decodes
 *   it through the schema, returning a {@link FormState} — valid with the
 *   decoded data, or invalid with the nested {@link FormErrors} and the posted
 *   values preserved so the form re-renders what the user typed. It is an
 *   `Effect`, so a schema requiring decoding services composes naturally; it
 *   has no error channel — validation failures live in the returned state.
 * - `empty()` seeds an unposted, invalid-by-default form from the supplied
 *   defaults — what a `load` returns to render a blank create form.
 *
 * Coercion (strings → numbers / booleans / dates) is the schema's job: build
 * the schema from coercing leaves (`Schema.FiniteFromString`, the
 * {@link module:effect-forms/Coerce} helpers, …) so a multipart body decodes
 * cleanly.
 *
 * @copyright Thomas Foster
 * @module effect-forms/Form
 */

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";
import { constraintsFromSchema, type InputConstraints } from "./Constraints.ts";
import { defaultEncodedValues } from "./Field.ts";
import { issuesToErrors } from "./Errors.ts";
import { buildSchema, type FormBuilder, runAsyncRefinements } from "./FormBuilder.ts";
import type { DecodedFromFields, EncodedFromFields, FieldsRecord } from "./Field.ts";
import { formDataToObject, requestToObject } from "./FormData.ts";
import { type LeafFormatter, schemaIssuesToFormIssues } from "./Issues.ts";
import { type FormState, make as makeFormState, type MakeFormStateOptions } from "./State.ts";

/** Everything {@link Form.validate} accepts. `null` / `undefined` mean "no submission". */
export type FormInput =
  | FormData
  | URLSearchParams
  | Request
  | Record<string, unknown>
  | null
  | undefined;

/** Options for {@link make}. */
export interface MakeFormOptions<S extends Schema.Top> {
  /** Distinguishes multiple forms on a page. Defaults to `"default"`. */
  readonly id?: string;
  /** The blank-form values — what {@link Form.empty} seeds and the merge base on failure. */
  readonly defaults: S["Type"];
  /** Override the per-leaf message rendering. */
  readonly leafFormatter?: LeafFormatter;
  /** Constraint overrides deep-merged over the AST-derived tree. */
  readonly constraints?: InputConstraints;
  /** Derive {@link InputConstraints} from the schema AST (default `true`). */
  readonly deriveConstraints?: boolean;
}

/** A schema bound to a form: a validator plus an empty-state factory. */
export interface Form<S extends Schema.Top, Message = unknown> {
  readonly schema: S;
  readonly id: string;
  readonly constraints: InputConstraints;
  /** Seed a blank, unposted form from the defaults. */
  empty(overrides?: MakeFormStateOptions<Message>): FormState<S["Type"], Message>;
  /** Parse a form body (no decode) into a structured object. */
  parse(input: FormData | URLSearchParams | Record<string, unknown>): Record<string, unknown>;
  /**
   * Validate a submission into a {@link FormState}. Never fails on the error
   * channel — schema failures become `errors` on the returned (invalid) state.
   */
  validate(
    input: FormInput,
  ): Effect.Effect<FormState<S["Type"], Message>, never, S["DecodingServices"]>;
}

const toStructured = (input: FormInput): Effect.Effect<Record<string, unknown> | null> => {
  if (input === null || input === undefined) return Effect.succeed(null);
  if (input instanceof Request) {
    // A body that can't be read as a form (e.g. a wrong content-type) is a
    // defect, not a validation failure: `validate` never fails, so the
    // rejection reason dies as-is.
    return Effect.tryPromise({ try: () => requestToObject(input), catch: (cause) => cause }).pipe(
      Effect.orDie,
    );
  }
  if (input instanceof FormData || input instanceof URLSearchParams) {
    return Effect.succeed(formDataToObject(input));
  }
  return Effect.succeed(input);
};

/**
 * Bind `schema` to a form: `validate(input)` decodes a submission into a
 * {@link FormState} (it never fails — validation failures live in the state;
 * its requirements are the schema's decoding services) and `empty()` seeds a
 * blank form from `defaults`. The returned {@link Form} is stateless and
 * reusable across requests.
 */
export function make<S extends Schema.Top, Message = unknown>(
  schema: S,
  options: MakeFormOptions<S>,
): Form<S, Message> {
  const id = options.id ?? "default";
  const { defaults, leafFormatter } = options;
  const constraints =
    options.deriveConstraints === false
      ? (options.constraints ?? {})
      : constraintsFromSchema(schema, options.constraints ?? {});
  // `errors: "all"` collects every field failure (collect-all) rather
  // than stopping at the first, so the whole form lights up at once.
  const decode = SchemaParser.decodeUnknownEffect(schema, { errors: "all" });

  const empty: Form<S, Message>["empty"] = (overrides = {}) =>
    makeFormState<S["Type"], Message>(defaults, {
      id,
      valid: false,
      posted: false,
      constraints,
      ...overrides,
    });

  const parse: Form<S, Message>["parse"] = (input) =>
    input instanceof FormData || input instanceof URLSearchParams ? formDataToObject(input) : input;

  const validate: Form<S, Message>["validate"] = (input) =>
    toStructured(input).pipe(
      Effect.flatMap((object) => {
        if (object === null) return Effect.succeed(empty());
        return decode(object).pipe(
          Effect.matchEffect({
            onSuccess: (data) =>
              Effect.succeed(
                makeFormState<S["Type"], Message>(data, {
                  id,
                  valid: true,
                  posted: true,
                  constraints,
                }),
              ),
            onFailure: (issue) => {
              // SAFETY: `FormState.data` on a failed decode is, by its documented
              // contract, the posted values merged over the defaults (so the form
              // re-renders what the user typed), typed as `S["Type"]` though not
              // decoded. `defaults` is widened to `object` only so it can be
              // spread; spreading copies its own enumerable properties either way.
              const posted = { ...(defaults as object), ...object } as S["Type"];
              return Effect.succeed(
                makeFormState<S["Type"], Message>(posted, {
                  id,
                  valid: false,
                  posted: true,
                  constraints,
                  errors: issuesToErrors(schemaIssuesToFormIssues(issue, leafFormatter)),
                }),
              );
            },
          }),
        );
      }),
    );

  return { schema, id, constraints, empty, parse, validate };
}

/** Options for {@link fromBuilder}. Like {@link MakeFormOptions} but `defaults` is optional. */
export interface FromBuilderOptions<TFields extends FieldsRecord> {
  /** Distinguishes multiple forms on a page. Defaults to `"default"`. */
  readonly id?: string;
  /** Blank-form values. Defaults to a schema-derived encoded blank per field. */
  readonly defaults?: EncodedFromFields<TFields>;
  /** Override the per-leaf message rendering. */
  readonly leafFormatter?: LeafFormatter;
  /** Constraint overrides deep-merged over the AST-derived tree. */
  readonly constraints?: InputConstraints;
  /** Derive {@link InputConstraints} from the schema AST (default `true`). */
  readonly deriveConstraints?: boolean;
}

/**
 * Bind a {@link FormBuilder} to a {@link Form}. Collapses the builder to a
 * schema (see {@link buildSchema}), then behaves like {@link make} — except its
 * `validate` also runs the builder's *asynchronous* refinements after a
 * successful decode, folding any failures into the same nested error tree. When
 * `defaults` is omitted it is derived from the fields (blank encoded values).
 */
export function fromBuilder<TFields extends FieldsRecord, R, Message = unknown>(
  builder: FormBuilder<TFields, R>,
  options: FromBuilderOptions<TFields> = {},
): Form<Schema.Codec<DecodedFromFields<TFields>, EncodedFromFields<TFields>, R>, Message> {
  const schema = buildSchema(builder);
  // SAFETY: `defaultEncodedValues` seeds exactly one entry per field of
  // `builder.fields` — `[]` for an array field, the schema's blank form input
  // otherwise — the documented "schema-derived encoded blank per field" that
  // stands in for `EncodedFromFields<TFields>`.
  const defaults =
    options.defaults ?? (defaultEncodedValues(builder.fields) as EncodedFromFields<TFields>);
  const base = make<typeof schema, Message>(schema, { ...options, defaults });

  const decode = SchemaParser.decodeUnknownEffect(schema, { errors: "all" });

  const validate: Form<typeof schema, Message>["validate"] = (input) =>
    toStructured(input).pipe(
      Effect.flatMap((object) => {
        if (object === null) return Effect.succeed(base.empty());
        // SAFETY: `FormState.data` on a failed validation is, by its documented
        // contract, the posted values merged over the defaults (so the form
        // re-renders what the user typed), typed as the decoded type though
        // not decoded.
        const posted = { ...defaults, ...object } as DecodedFromFields<TFields>;
        return decode(object).pipe(
          Effect.matchEffect({
            onSuccess: (data) =>
              runAsyncRefinements(builder, data).pipe(
                Effect.map((issues) =>
                  Arr.match(issues, {
                    onEmpty: () =>
                      makeFormState<DecodedFromFields<TFields>, Message>(data, {
                        id: base.id,
                        valid: true,
                        posted: true,
                        constraints: base.constraints,
                      }),
                    onNonEmpty: (failures) =>
                      makeFormState<DecodedFromFields<TFields>, Message>(posted, {
                        id: base.id,
                        valid: false,
                        posted: true,
                        constraints: base.constraints,
                        errors: issuesToErrors(failures),
                      }),
                  }),
                ),
              ),
            onFailure: (issue) =>
              Effect.succeed(
                makeFormState<DecodedFromFields<TFields>, Message>(posted, {
                  id: base.id,
                  valid: false,
                  posted: true,
                  constraints: base.constraints,
                  errors: issuesToErrors(schemaIssuesToFormIssues(issue, options.leafFormatter)),
                }),
              ),
          }),
        );
      }),
    );

  return { ...base, validate };
}
