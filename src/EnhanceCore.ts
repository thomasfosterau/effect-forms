/**
 * @copyright Thomas Foster
 *
 * Pure plumbing for the `enhance` action: serialise the store's data back into
 * a form body, interpret a server response into a {@link FormActionResult}, and
 * compute the store update a result implies. Kept framework-free and side-
 * effect-free so it is unit-testable in isolation; the rune store
 * (`superForm.svelte.ts`) wires these to the DOM.
 *
 * @module effect-forms-svelte/EnhanceCore
 */

import { Errors, Result, State } from "@thomasfosterau/effect-forms";

// Terse local aliases onto the namespaced core exports.
type FormActionResult<A, Message = unknown> = Result.FormActionResult<A, Message>;
type FormErrors = Errors.FormErrors;
type FormState<A, Message = unknown> = State.FormState<A, Message>;
const { failure, success } = Result;

/** Flatten a nested data object into `[name, value]` entries using path notation. */
export function objectToEntries(data: unknown, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const push = (key: string, value: unknown): void => {
    if (value === undefined) return;
    if (value === null) {
      out.push([key, ""]);
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => out.push(...objectToEntries(item, `${key}[${i}]`)));
    } else if (typeof value === "object") {
      out.push(...objectToEntries(value, key));
    } else {
      out.push([key, String(value)]);
    }
  };

  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      push(prefix ? `${prefix}.${key}` : key, value);
    }
  } else if (prefix) {
    push(prefix, data);
  }
  return out;
}

/** Serialise the store's data into a {@link FormData} body for submission. */
export function objectToFormData(data: unknown): FormData {
  const formData = new FormData();
  for (const [key, value] of objectToEntries(data)) formData.append(key, value);
  return formData;
}

/** Whether a value looks like a {@link FormActionResult} (carries a known `_tag`). */
function isActionResult(value: unknown): value is FormActionResult<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { _tag?: unknown })._tag === "string" &&
    ["Success", "Failure", "Redirect", "Error"].includes((value as { _tag: string })._tag)
  );
}

/** Whether a value looks like a bare {@link FormState}. */
function isFormState(value: unknown): value is FormState<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "valid" in value &&
    "data" in value &&
    "errors" in value
  );
}

/**
 * Normalise a parsed JSON response body into a {@link FormActionResult}. The
 * server may return a full action result (`{ _tag, … }`) or a bare
 * {@link FormState} — a bare state maps to `Success` / `Failure` by its `valid`
 * flag, using `status` for the failure code.
 */
export function parseActionResult<A, Message>(
  body: unknown,
  status = 200,
): FormActionResult<A, Message> {
  if (isActionResult(body)) return body as FormActionResult<A, Message>;
  if (isFormState(body)) {
    const state = body as FormState<A, Message>;
    return state.valid ? success(state, status) : failure(state, status);
  }
  return { _tag: "Error", status, message: "Unrecognised form response" };
}

/** The mutation a {@link FormActionResult} implies for the store. */
export interface FormUpdate<A, Message> {
  readonly data?: A | undefined;
  readonly errors?: FormErrors | undefined;
  readonly message?: Message | undefined;
  readonly redirect?: string | undefined;
  readonly error?: string | undefined;
  readonly valid?: boolean | undefined;
}

/**
 * Compute the store update implied by a {@link FormActionResult}. Pure: the
 * caller applies the returned fields to its reactive state and acts on
 * `redirect` / `error`.
 */
export function resultToUpdate<A, Message>(
  result: FormActionResult<A, Message>,
): FormUpdate<A, Message> {
  switch (result._tag) {
    case "Success":
      return {
        data: result.state.data,
        errors: result.state.errors,
        message: result.state.message,
        valid: true,
      };
    case "Failure":
      return {
        data: result.state.data,
        errors: result.state.errors,
        message: result.state.message,
        valid: false,
      };
    case "Redirect":
      return { redirect: result.location };
    case "Error":
      return { error: result.message, valid: false };
  }
}
