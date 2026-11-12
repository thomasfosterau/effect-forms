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
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";
import { constraintsFromSchema, type InputConstraints } from "./Constraints.ts";
import { blankValues, type Blanks } from "./Field.ts";
import { issuesToErrors } from "./Errors.ts";
import {
  buildSchema,
  type Encoded,
  type FormBuilder,
  runAsyncRefinements,
  type Values,
} from "./FormBuilder.ts";
import { formDataToObject, requestToObject } from "./FormData.ts";
import { type LeafFormatter, schemaIssuesToFormIssues } from "./Issues.ts";
import { type FormState, make as makeFormState, type MakeFormStateOptions } from "./State.ts";

/** Everything {@link Form.validate} accepts. Omitting the input means "no submission". */
export type FormInput = FormData | URLSearchParams | Request | Record<string, unknown>;

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

/**
 * A schema bound to a form: a validator plus an empty-state factory. `Blank`
 * is the type of the blank form's data ({@link make}'s `defaults`, the
 * schema's decoded type; a builder form's encoded defaults or derived
 * blanks), and `R` the services `validate` needs (the schema's decoding
 * services, plus a builder's `refineEffect` services).
 */
export interface Form<
  S extends Schema.Top,
  Message = unknown,
  Blank = S["Type"],
  R = S["DecodingServices"],
> {
  readonly schema: S;
  readonly id: string;
  readonly constraints: InputConstraints;
  /** Seed a blank, unposted form from the defaults. */
  empty(overrides?: MakeFormStateOptions<Message>): FormState<Blank, Message>;
  /** Parse a form body (no decode) into a structured object. */
  parse(input: FormData | URLSearchParams | Record<string, unknown>): Record<string, unknown>;
  /**
   * Validate a submission into a {@link FormState}. Never fails on the error
   * channel — schema failures become `errors` on the returned (invalid) state.
   * With no `input` (no submission) it answers the {@link Form.empty} state.
   * A `Request` whose body can't be read as a form dies with
   * {@link UnreadableBody}.
   */
  validate(input?: FormInput): Effect.Effect<FormState<S["Type"] | Blank, Message>, never, R>;
}

/** {@link Form.parse}: flatten a posted body, pass a plain record through. */
const parseInput: Form<Schema.Top>["parse"] = (input) =>
  input instanceof FormData || input instanceof URLSearchParams ? formDataToObject(input) : input;

/**
 * The defect {@link Form.validate} dies with when a `Request`'s body can't be
 * read as a form (e.g. a JSON body, or a wrong content-type).
 *
 * `validate` never fails, and an unreadable body is not a validation failure
 * but a caller bug, so it dies; `cause` is the platform's original rejection
 * (from `request.formData()`).
 */
export class UnreadableBody extends Schema.TaggedError<
  UnreadableBody,
  { readonly brand: unique symbol }
>()("UnreadableBody", {
  cause: Schema.Defect(),
}) {}

/** The submission as a structured object, or `None` for no submission. */
const toStructured = (input?: FormInput): Effect.Effect<Option.Option<Record<string, unknown>>> => {
  if (input === undefined) return Effect.succeedNone;
  if (input instanceof Request) {
    return Effect.tryPromise({
      try: () => requestToObject(input),
      catch: (cause) => new UnreadableBody({ cause }),
    }).pipe(Effect.asSome, Effect.orDie);
  }
  if (input instanceof FormData || input instanceof URLSearchParams) {
    return Effect.succeedSome(formDataToObject(input));
  }
  return Effect.succeedSome(input);
};

/**
 * Bind `schema` to a form: `validate(input)` decodes a submission into a
 * {@link FormState} (it never fails — validation failures live in the state;
 * its requirements are the schema's decoding services) and `empty()` seeds a
 * blank form from `defaults`. The returned {@link Form} is stateless and
 * reusable across requests.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect"
 * import * as Schema from "effect/Schema"
 * import { Form } from "@thomasfosterau/effect-forms"
 *
 * const signup = Form.make(
 *   Schema.Struct({ name: Schema.String.check(Schema.isMinLength(2)) }),
 *   { id: "signup", defaults: { name: "" } },
 * )
 *
 * const state = Effect.runSync(signup.validate(new URLSearchParams({ name: "A" })))
 * console.log(state.valid) // false
 * console.log(state.data) // { name: "A" } — the posted value, kept for re-render
 * ```
 */
export function make<S extends Schema.Top, Message = unknown>(
  schema: S,
  options: MakeFormOptions<S>,
): Form<S, Message> {
  return bind<S, Message, S["Type"]>(schema, options, options.defaults);
}

/** {@link make} over blank-form values `defaults` of any type `Blank`. */
function bind<S extends Schema.Top, Message, Blank>(
  schema: S,
  options: Omit<MakeFormOptions<S>, "defaults">,
  defaults: Blank,
): Form<S, Message, Blank> {
  const id = options.id ?? "default";
  const { leafFormatter } = options;
  const constraints =
    options.deriveConstraints === false
      ? (options.constraints ?? {})
      : constraintsFromSchema(schema, options.constraints ?? {});
  // `errors: "all"` collects every field failure (collect-all) rather
  // than stopping at the first, so the whole form lights up at once.
  const decode = SchemaParser.decodeUnknownEffect(schema, { errors: "all" });

  const empty: Form<S, Message, Blank>["empty"] = (overrides = {}) =>
    makeFormState<Blank, Message>(defaults, {
      id,
      valid: false,
      posted: false,
      constraints,
      ...overrides,
    });

  const parse: Form<S, Message, Blank>["parse"] = parseInput;

  const validate: Form<S, Message, Blank>["validate"] = (input) =>
    toStructured(input).pipe(
      Effect.flatMap((submitted) =>
        Option.match(submitted, {
          onNone: () => Effect.succeed<FormState<S["Type"] | Blank, Message>>(empty()),
          onSome: (object) =>
            decode(object).pipe(
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
                  // decoded. Only object defaults have properties to merge.
                  const posted = (
                    P.isObjectKeyword(defaults) ? { ...defaults, ...object } : { ...object }
                  ) as S["Type"];
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
            ),
        }),
      ),
    );

  return { schema, id, constraints, empty, parse, validate };
}

/** Options for {@link fromBuilder}. Like {@link MakeFormOptions} but `defaults` is optional. */
export interface FromBuilderOptions<F extends Schema.Struct.Fields> {
  /** Distinguishes multiple forms on a page. Defaults to `"default"`. */
  readonly id?: string;
  /** Blank-form values. Defaults to a schema-derived blank per field ({@link Blanks}). */
  readonly defaults?: Encoded<F>;
  /** Override the per-leaf message rendering. */
  readonly leafFormatter?: LeafFormatter;
  /** Constraint overrides deep-merged over the AST-derived tree. */
  readonly constraints?: InputConstraints;
  /** Derive {@link InputConstraints} from the schema AST (default `true`). */
  readonly deriveConstraints?: boolean;
}

/**
 * The {@link Form} {@link fromBuilder} binds a builder over the struct fields
 * `F` to: its schema is the builder's `Schema.Struct<F>`, its blank data is
 * `Blank`, and `validate` needs the fields' decoding services plus the
 * `refineEffect` refinements' `RefineR`.
 */
export type BuilderForm<F extends Schema.Struct.Fields, RefineR, Message, Blank> = Form<
  Schema.Struct<F>,
  Message,
  Blank,
  Schema.Struct<F>["DecodingServices"] | RefineR
>;

/**
 * Bind a {@link FormBuilder} to a {@link Form}. Collapses the builder to a
 * schema (see {@link buildSchema}), then behaves like {@link make} — except its
 * `validate` also runs the builder's *asynchronous* refinements after a
 * successful decode, folding any failures into the same nested error tree.
 *
 * Given `defaults` (encoded values), the blank form holds them. Without, it
 * holds a schema-derived blank per field, typed as what it is ({@link Blanks}:
 * `""`, `[]` or a struct of blanks), since a blank need not be a valid encoded
 * value.
 */
export function fromBuilder<F extends Schema.Struct.Fields, RefineR, Message = unknown>(
  builder: FormBuilder<F, RefineR>,
  options: FromBuilderOptions<F> & { readonly defaults: Encoded<F> },
): BuilderForm<F, RefineR, Message, Encoded<F>>;
export function fromBuilder<F extends Schema.Struct.Fields, RefineR, Message = unknown>(
  builder: FormBuilder<F, RefineR>,
  options?: FromBuilderOptions<F> & { readonly defaults?: never },
): BuilderForm<F, RefineR, Message, Blanks<F>>;
export function fromBuilder<F extends Schema.Struct.Fields, RefineR, Message = unknown>(
  builder: FormBuilder<F, RefineR>,
  options: FromBuilderOptions<F> = {},
): BuilderForm<F, RefineR, Message, Encoded<F> | Blanks<F>> {
  const schema = buildSchema(builder);
  const defaults: Encoded<F> | Blanks<F> = options.defaults ?? blankValues(builder.structFields);
  const base = bind<Schema.Struct<F>, Message, Encoded<F> | Blanks<F>>(schema, options, defaults);

  const decode = SchemaParser.decodeUnknownEffect(schema, { errors: "all" });

  const validate: BuilderForm<F, RefineR, Message, Encoded<F> | Blanks<F>>["validate"] = (input) =>
    toStructured(input).pipe(
      Effect.flatMap((submitted) =>
        Option.match(submitted, {
          onNone: () =>
            Effect.succeed<FormState<Values<F> | Encoded<F> | Blanks<F>, Message>>(base.empty()),
          onSome: (object) => {
            // On a failed validation the state carries the posted values merged
            // over the blank, so the form re-renders what the user typed.
            const posted = { ...defaults, ...object };
            return decode(object).pipe(
              Effect.matchEffect({
                onSuccess: (data) =>
                  runAsyncRefinements(builder, data).pipe(
                    Effect.map((issues) =>
                      Arr.match(issues, {
                        onEmpty: () =>
                          makeFormState<Values<F>, Message>(data, {
                            id: base.id,
                            valid: true,
                            posted: true,
                            constraints: base.constraints,
                          }),
                        onNonEmpty: (failures) =>
                          makeFormState<Encoded<F> | Blanks<F>, Message>(posted, {
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
                    makeFormState<Encoded<F> | Blanks<F>, Message>(posted, {
                      id: base.id,
                      valid: false,
                      posted: true,
                      constraints: base.constraints,
                      errors: issuesToErrors(
                        schemaIssuesToFormIssues(issue, options.leafFormatter),
                      ),
                    }),
                  ),
              }),
            );
          },
        }),
      ),
    );

  return { ...base, validate };
}
