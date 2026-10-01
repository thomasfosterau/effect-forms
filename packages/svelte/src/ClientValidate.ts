/**
 * Client-side validation helpers — validate the whole form or a single field
 * against the same Effect Schema the server uses, returning the nested
 * {@link FormErrors} tree (or one field's messages).
 *
 * Re-running the schema in the browser gives instant feedback; this is
 * the framework-neutral plumbing the Svelte store calls. Schemas used here must
 * have no decoding-service requirements (the common case for form schemas) so
 * validation can run synchronously in an event handler.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/ClientValidate
 */

import { Errors, Issues, Validate } from "@thomasfosterau/effect-forms";

// Terse local aliases onto the namespaced core exports.
type FormErrors = Errors.FormErrors;
type FormPath = Issues.FormPath;
type LeafFormatter = Issues.LeafFormatter;
const { getError, noErrors } = Errors;
const { validateValueSync } = Validate;
import type * as Schema from "effect/Schema";

/** Validate the whole form's data, returning the nested error tree (empty when valid). */
export function validateData<S extends Schema.Top>(
  schema: S,
  data: unknown,
  format?: LeafFormatter,
): FormErrors {
  const result = validateValueSync(schema, data, format);
  return result.valid ? noErrors : result.errors;
}

/**
 * Validate the whole form and return just the messages at `path`. Validating
 * the whole object (rather than the leaf in isolation) keeps cross-field rules
 * working; the caller merges the result into its existing error tree for that
 * field only.
 */
export function validateField<S extends Schema.Top>(
  schema: S,
  data: unknown,
  path: FormPath,
  format?: LeafFormatter,
): readonly string[] {
  const errors = validateData(schema, data, format);
  return getError(errors, path) ?? [];
}
