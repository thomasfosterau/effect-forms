/**
 * @copyright Thomas Foster
 *
 * Tri-state coercers for the HTML-form boundary.
 *
 * An HTML form submits every value as a string, and an absent optional field
 * arrives as `undefined` (or an empty string). Mapping that onto a
 * value / `null` / `undefined` update contract — where a value **sets**, `null`
 * **clears** a nullable field, and `undefined` **skips** (carry-forward) — is
 * the same boundary discipline the host app applies, lifted here so any
 * consumer of the core gets it without a framework dependency.
 *
 * These are plain, total functions: they never throw and never reach for a
 * framework's `error()` helper (validation failures belong on the schema, not
 * in a coercer).
 *
 * @module effect-forms/Coerce
 */

/** Empty string / `undefined` → `undefined`; otherwise the value (skip semantics). */
export function emptyToUndefined<T>(value: T | "" | undefined): T | undefined {
  return value === "" || value === undefined ? undefined : value;
}

/**
 * `undefined` stays `undefined` (skip); empty string / `null` → `null`
 * (clear a nullable field); otherwise the value (set). The three-state coercer
 * for nullable update fields.
 */
export function emptyToNull<T>(value: T | "" | null | undefined): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === "" || value === null) return null;
  return value;
}

/** Trim, then {@link emptyToUndefined}: whitespace-only collapses to `undefined` (skip). */
export function trimToUndefined(value: string | undefined): string | undefined {
  return emptyToUndefined(value?.trim());
}

/** Trim, then {@link emptyToNull}: whitespace-only / blank clears (`null`). */
export function trimToNull(value: string | undefined): string | null | undefined {
  return emptyToNull(value?.trim());
}

/**
 * Map a numeric text field onto the value / `null` / `undefined` contract.
 * Blank clears on the nullable path and skips otherwise; a present value
 * parses with `Number` (`NaN` for non-numeric input — validate downstream).
 */
export function numberFromField(
  raw: string | undefined,
  options: { nullable: false },
): number | undefined;
export function numberFromField(
  raw: string | undefined,
  options: { nullable: true },
): number | null | undefined;
export function numberFromField(
  raw: string | undefined,
  { nullable }: { nullable: boolean },
): number | null | undefined {
  const coerced = nullable ? emptyToNull(raw) : emptyToUndefined(raw);
  return typeof coerced === "string" ? Number(coerced) : coerced;
}

/**
 * Interpret a checkbox field. An HTML checkbox submits its `value` (default
 * `"on"`) only when checked and omits the field entirely when unchecked, so a
 * present field is `true` and an absent one is `false`. The truthy strings
 * `"on"` / `"true"` / `"1"` / `"yes"` all read as `true`; an explicit
 * `"false"` / `"0"` / `"off"` / `"no"` reads as `false`.
 */
export function booleanFromCheckbox(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  return !(
    normalised === "" ||
    normalised === "false" ||
    normalised === "0" ||
    normalised === "off" ||
    normalised === "no"
  );
}
