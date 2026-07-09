/**
 * @copyright Thomas Foster
 *
 * SvelteKit interop for the form store. The framework's `$app/forms` `enhance`
 * / `applyAction` are app-build virtuals (not resolvable from a library), so
 * the SvelteKit-specific glue stays in the consuming app; this module owns the
 * reusable half — applying a derived form action's result back to the store.
 *
 * @module effect-forms-svelte/SvelteKit
 */

import type { Errors, Result, State } from "@thomasfosterau/effect-forms";
import type { FormStore } from "./FormStore.svelte.ts";

type FormActionData<A = unknown, Message = unknown> = Result.FormActionData<A, Message>;
type FormState<A, Message = unknown> = State.FormState<A, Message>;
type FormErrors = Errors.FormErrors;

/**
 * The minimal view of SvelteKit's `ActionResult` that {@link applyActionResult}
 * inspects — a failure carries the derived action's {@link FormActionData}.
 */
export interface ServerActionResult {
  readonly type: "success" | "failure" | "redirect" | "error";
  readonly data?: FormActionData | Record<string, unknown> | undefined;
}

const isFormActionData = (data: unknown): data is FormActionData & { form: FormState<unknown> } =>
  typeof data === "object" &&
  data !== null &&
  "form" in data &&
  Boolean((data as { form?: unknown }).form);

/**
 * Apply a derived form action's result to `form`. On a validation `failure`
 * carrying `{ form }`, repopulate the store's errors + posted values and return
 * `true` (consumed). Otherwise return `false` — the caller should defer to the
 * framework (`applyAction`) for success / redirect / error.
 */
export function applyActionResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any concrete store
  form: FormStore<any, any, any>,
  result: ServerActionResult,
): boolean {
  if (result.type !== "failure" || !isFormActionData(result.data)) return false;
  const state = result.data.form;
  form.setServerState(state.data, state.errors as FormErrors);
  return true;
}
