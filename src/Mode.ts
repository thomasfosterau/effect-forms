/**
 * @copyright Thomas Foster
 *
 * When a form validates (and, optionally, auto-submits).
 *
 * A reactive form has to decide *when* to run validation as the user types.
 * The three modes mirror the common form-library vocabulary:
 *
 * - **`onSubmit`** (the default) — validate only when the form is submitted (or
 *   validation is triggered explicitly). The quietest mode.
 * - **`onBlur`** — validate a field when it loses focus.
 * - **`onChange`** — validate on every change, optionally `debounce`d.
 *
 * `onBlur` / `onChange` may also `autoSubmit`, turning the form into a
 * live-saving surface (a settings panel, a filter bar). This module is the
 * framework-neutral half: {@link parse} normalises the loose {@link FormMode}
 * a caller supplies into a fully-resolved {@link ParsedMode} the reactive
 * store drives from. The store owns the actual scheduling.
 *
 * @module effect-forms/Mode
 */

import * as Duration from "effect/Duration";

/**
 * How a form decides when to validate, and whether it auto-submits.
 *
 * - `onSubmit` (the default) cannot auto-submit or debounce.
 * - `onBlur` may auto-submit; debounce is not meaningful.
 * - `onChange` may auto-submit and may debounce.
 */
export type FormMode =
  | { readonly validation?: "onSubmit"; readonly autoSubmit?: false; readonly debounce?: never }
  | { readonly validation: "onBlur"; readonly autoSubmit?: boolean; readonly debounce?: never }
  | {
      readonly validation: "onChange";
      readonly debounce?: Duration.Input;
      readonly autoSubmit?: boolean;
    };

/** The fully-resolved form of a {@link FormMode} — every field decided. */
export interface ParsedMode {
  readonly validation: "onSubmit" | "onBlur" | "onChange";
  /** Debounce in milliseconds, or `null` for no debounce. */
  readonly debounce: number | null;
  readonly autoSubmit: boolean;
}

/**
 * Normalise a {@link FormMode} into a {@link ParsedMode}. An absent mode is
 * `onSubmit`. `debounce` is resolved to milliseconds and only applies in
 * `onChange`; `autoSubmit` is only honoured for `onBlur` / `onChange`.
 */
export function parse(mode?: FormMode): ParsedMode {
  const validation = mode?.validation ?? "onSubmit";

  if (validation === "onBlur") {
    return { validation: "onBlur", debounce: null, autoSubmit: mode?.autoSubmit === true };
  }

  if (validation === "onChange") {
    const debounce = mode?.debounce === undefined ? null : Duration.toMillis(mode.debounce);
    return { validation: "onChange", debounce, autoSubmit: mode?.autoSubmit === true };
  }

  return { validation: "onSubmit", debounce: null, autoSubmit: false };
}
