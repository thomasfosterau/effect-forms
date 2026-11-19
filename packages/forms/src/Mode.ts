/**
 * When a form validates: `onSubmit` (default), `onBlur` or `onChange`, with
 * optional debounce and auto-submit. `revalidate` sets which trigger
 * re-validates after a failed submit. {@link parse} resolves the loose
 * {@link FormMode} into a {@link ParsedMode}; the store owns the scheduling.
 *
 * @module effect-forms/Mode
 */

import * as Duration from "effect/Duration";
import * as Option from "effect/Option";

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
  /** Debounce in milliseconds, or `Option.none()` for no debounce. */
  readonly debounce: Option.Option<number>;
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
      debounce: Option.none(),
      autoSubmit: mode?.autoSubmit === true,
      revalidate,
    };
  }

  if (validation === "onChange") {
    const debounce = Option.map(Option.fromUndefinedOr(mode?.debounce), Duration.toMillis);
    return { validation: "onChange", debounce, autoSubmit: mode?.autoSubmit === true, revalidate };
  }

  return { validation: "onSubmit", debounce: Option.none(), autoSubmit: false, revalidate };
}
