/**
 * SvelteKit interop for the form store that needs no SvelteKit import:
 * applying a derived form action's result back to the store. The glue that
 * imports `@sveltejs/kit` or the `$app/forms` virtual lives in the `/kit`
 * entry.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/SvelteKit
 */

import type { Result, State } from "@thomasfosterau/effect-forms";
import * as P from "effect/Predicate";
import type { FormStore } from "./FormStore.svelte.ts";

type FormActionData<A = unknown, Message = unknown> = Result.FormActionData<A, Message>;
type FormState<A, Message = unknown> = State.FormState<A, Message>;

/**
 * The minimal view of SvelteKit's `ActionResult` that {@link applyActionResult}
 * inspects — a failure carries the derived action's {@link FormActionData}.
 */
export interface ServerActionResult {
  readonly type: "success" | "failure" | "redirect" | "error";
  /**
   * The result's payload, unparsed: SvelteKit types it as an open record, and
   * {@link applyActionResult} checks it for a carried {@link FormActionData}
   * before reading it.
   */
  readonly data?: unknown;
}

const isFormActionData = (data: unknown): data is FormActionData & { form: FormState<unknown> } =>
  P.isObjectOrArray(data) && P.hasProperty(data, "form") && Boolean(data.form);

/**
 * Apply a derived form action's result to `form`. On a validation `failure`
 * carrying `{ form }`, repopulate the store's errors + posted values and return
 * `true`; otherwise return `false`. Either way the store does not touch
 * `page.form`: inside SvelteKit's `enhance` callback, still run `update`
 * (which applies the result to `page.form` once, so an earlier submit's
 * `page.form` doesn't outlive this one), and don't also call `applyAction`.
 */
export function applyActionResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts any concrete store
  form: FormStore<any, any, any>,
  result: ServerActionResult,
): boolean {
  if (result.type !== "failure" || !isFormActionData(result.data)) return false;
  const state = result.data.form;
  form.setServerState(state.data, state.errors);
  return true;
}
