/**
 * @copyright Thomas Foster
 *
 * Low-level validation helpers — decode a value through a schema and get back
 * the {@link FormErrors} tree (or the list of {@link FormIssue}s) instead of a
 * raised failure. `Form.make` is the high-level entry; these are for ad
 * hoc field- or value-level validation (e.g. a Svelte client validating a
 * single field on blur).
 *
 * @module effect-forms/Validate
 */

import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as SchemaParser from "effect/SchemaParser";
import { type FormErrors, issuesToErrors } from "./Errors.ts";
import { type FormIssue, type LeafFormatter, schemaIssuesToFormIssues } from "./Issues.ts";

/** The outcome of validating a value against a schema. */
export type ValidationResult<A> =
  | { readonly valid: true; readonly data: A }
  | {
      readonly valid: false;
      readonly errors: FormErrors;
      readonly issues: ReadonlyArray<FormIssue>;
    };

/**
 * Decode `input` through `schema`, returning a {@link ValidationResult} on the
 * success channel (decode failures become `valid: false`, not an Effect
 * failure). Decoding-service requirements propagate on the `R` channel.
 */
export function validateValue<S extends Schema.Top>(
  schema: S,
  input: unknown,
  format?: LeafFormatter,
): Effect.Effect<ValidationResult<S["Type"]>, never, S["DecodingServices"]> {
  return SchemaParser.decodeUnknownEffect(schema, { errors: "all" })(input).pipe(
    Effect.matchEffect({
      onSuccess: (data): Effect.Effect<ValidationResult<S["Type"]>> =>
        Effect.succeed({ valid: true, data }),
      onFailure: (issue): Effect.Effect<ValidationResult<S["Type"]>> => {
        const issues = schemaIssuesToFormIssues(issue, format);
        return Effect.succeed({ valid: false, errors: issuesToErrors(issues), issues });
      },
    }),
  );
}

/**
 * Synchronous {@link validateValue} for schemas with no decoding-service
 * requirements (`R = never`) and no async decoding — the common case for plain
 * form schemas. {@link validateValue} never fails on the error channel, so
 * running it with {@link Effect.runSync} is total.
 */
export function validateValueSync<S extends Schema.Top>(
  schema: S,
  input: unknown,
  format?: LeafFormatter,
): ValidationResult<S["Type"]> {
  // `validateValue` never fails on the error channel; the cast drops the
  // decoding-service requirement, which the caller asserts is `never` (the
  // common case for plain form schemas — a service-requiring schema must use
  // the async {@link validateValue}).
  return Effect.runSync(
    validateValue(schema, input, format) as Effect.Effect<ValidationResult<S["Type"]>>,
  );
}
