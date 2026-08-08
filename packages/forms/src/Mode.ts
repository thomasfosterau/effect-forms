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
 * A separate `revalidate` dimension governs what happens *after a submit*: an
 * `onSubmit`-mode form is otherwise silent until the next submit, which
 * leaves a failed post's errors frozen even after the user fixes the
 * offending field. `revalidate` says which trigger (`"onChange"` /
 * `"onBlur"` — independent of the primary `validation` trigger) re-validates
 * once the form has been posted at least once; `"never"` keeps the classic
 * frozen-until-resubmit behaviour.
 *
 * @module effect-forms/Mode
 */

import * as Duration from "effect/Duration";

/** What re-validates a posted form as the user keeps editing. See {@link ParsedMode.revalidate}. */
export type RevalidateMode = "onChange" | "onBlur" | "never";

/**
 * How a form decides when to validate, and whether it auto-submits.
 *
 * - `onSubmit` (the default) cannot auto-submit or debounce.
 * - `onBlur` may auto-submit; debounce is not meaningful.
 * - `onChange` may auto-submit and may debounce.
 *
 * `revalidate` is independent of `validation` and applies to every mode —
 * see the module docs.
 */
export type FormMode = (
  | { readonly validation?: "onSubmit"; readonly autoSubmit?: false; readonly debounce?: never }
  | { readonly validation: "onBlur"; readonly autoSubmit?: boolean; readonly debounce?: never }
  | {
      readonly validation: "onChange";
      readonly debounce?: Duration.Input;
      readonly autoSubmit?: boolean;
    }
) & { readonly revalidate?: RevalidateMode };

/** The fully-resolved form of a {@link FormMode} — every field decided. */
export interface ParsedMode {
  readonly validation: "onSubmit" | "onBlur" | "onChange";
  /** Debounce in milliseconds, or `null` for no debounce. */
  readonly debounce: number | null;
  readonly autoSubmit: boolean;
  /** What re-validates the form once it has been posted at least once. Defaults to `"onChange"`. */
  readonly revalidate: RevalidateMode;
}

/**
 * Normalise a {@link FormMode} into a {@link ParsedMode}. An absent mode is
 * `onSubmit`. `debounce` is resolved to milliseconds and only applies in
 * `onChange`; `autoSubmit` is only honoured for `onBlur` / `onChange`;
 * `revalidate` defaults to `"onChange"` (TanStack's / RHF's default
 * post-submit behaviour) regardless of the primary `validation` mode.
 */
export function parse(mode?: FormMode): ParsedMode {
  const validation = mode?.validation ?? "onSubmit";
  const revalidate = mode?.revalidate ?? "onChange";

  if (validation === "onBlur") {
    return {
      validation: "onBlur",
      debounce: null,
      autoSubmit: mode?.autoSubmit === true,
      revalidate,
    };
  }

  if (validation === "onChange") {
    const debounce = mode?.debounce === undefined ? null : Duration.toMillis(mode.debounce);
    return { validation: "onChange", debounce, autoSubmit: mode?.autoSubmit === true, revalidate };
  }

  return { validation: "onSubmit", debounce: null, autoSubmit: false, revalidate };
}
