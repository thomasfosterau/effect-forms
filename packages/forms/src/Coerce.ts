/**
 * Tri-state coercers for the HTML-form boundary.
 *
 * An HTML form submits every value as a string, and an absent optional field
 * arrives as `undefined` (or an empty string). These map that onto the update
 * `TriState` from `@thomasfosterau/effect-ext/TriState`: a value **assigns**
 * (`Assign`), a blank **clears** a nullable field (`Clear`) and an absent or
 * skipped field **carries forward** (`CarryForward`) — the same boundary
 * discipline the host app applies, lifted here so any consumer of the core
 * gets it without a framework dependency. The `Command` adapters map the result onto the wire (`null` /
 * absent).
 *
 * These are plain, total functions: they never throw and never reach for a
 * framework's `error()` helper (validation failures belong on the schema, not
 * in a coercer).
 *
 * @copyright Thomas Foster
 * @module effect-forms/Coerce
 */

import * as P from "effect/Predicate";
import * as TriState from "@thomasfosterau/effect-ext/TriState";

/**
 * Empty string / absent carries forward (skip); otherwise the value is
 * assigned. Never clears.
 *
 * @example
 * ```ts
 * import { Coerce } from "@thomasfosterau/effect-forms"
 *
 * console.log(Coerce.emptyToCarryForward("")._tag, Coerce.emptyToCarryForward("x"))
 * // CarryForward { _tag: 'Assign', value: 'x' }
 * ```
 */
export function emptyToCarryForward<T extends string>(value?: T | ""): TriState.TriState<T> {
  return value === undefined || value === "" ? TriState.carryForward : TriState.assign(value);
}

/**
 * Absent carries forward (skip); empty string clears a nullable field;
 * otherwise the value is assigned. The three-state coercer for nullable
 * update fields.
 *
 * @example
 * ```ts
 * import { Coerce } from "@thomasfosterau/effect-forms"
 *
 * console.log(Coerce.emptyToClear(undefined)._tag, Coerce.emptyToClear("")._tag, Coerce.emptyToClear("x"))
 * // CarryForward Clear { _tag: 'Assign', value: 'x' }
 * ```
 */
export function emptyToClear<T extends string>(value?: T | ""): TriState.TriState<T> {
  if (value === undefined) return TriState.carryForward;
  return value === "" ? TriState.clear : TriState.assign(value);
}

/**
 * Trim, then {@link emptyToCarryForward}: whitespace-only carries forward (skip).
 *
 * @example
 * ```ts
 * import { Coerce } from "@thomasfosterau/effect-forms"
 *
 * console.log(Coerce.trimToCarryForward("   ")._tag, Coerce.trimToCarryForward(" a "))
 * // CarryForward { _tag: 'Assign', value: 'a' }
 * ```
 */
export function trimToCarryForward(value?: string): TriState.TriState<string> {
  return emptyToCarryForward(value?.trim());
}

/**
 * Trim, then {@link emptyToClear}: whitespace-only / blank clears; absent
 * carries forward.
 *
 * @example
 * ```ts
 * import { Coerce } from "@thomasfosterau/effect-forms"
 *
 * console.log(Coerce.trimToClear("   ")._tag, Coerce.trimToClear(undefined)._tag, Coerce.trimToClear(" a "))
 * // Clear CarryForward { _tag: 'Assign', value: 'a' }
 * ```
 */
export function trimToClear(value?: string): TriState.TriState<string> {
  return emptyToClear(value?.trim());
}

/**
 * Map a numeric text field onto the update `TriState`. Blank
 * clears on the `nullable` path and carries forward otherwise (the default);
 * a present value parses with `Number` (`NaN` for non-numeric input —
 * validate downstream).
 *
 * @example
 * ```ts
 * import { Coerce } from "@thomasfosterau/effect-forms"
 *
 * console.log(Coerce.numberFromField("12"), Coerce.numberFromField("")._tag)
 * // { _tag: 'Assign', value: 12 } CarryForward
 * console.log(Coerce.numberFromField("", { nullable: true })._tag) // Clear
 * ```
 */
export function numberFromField(
  raw?: string,
  { nullable = false }: { readonly nullable?: boolean } = {},
): TriState.TriState<number> {
  const coerced = nullable ? emptyToClear(raw) : emptyToCarryForward(raw);
  return P.isTagged(coerced, "Assign") ? TriState.assign(Number(coerced.value)) : coerced;
}

/**
 * Interpret a checkbox field. An HTML checkbox submits its `value` (default
 * `"on"`) only when checked and omits the field entirely when unchecked, so a
 * present field is `true` and an absent one is `false`. The truthy strings
 * `"on"` / `"true"` / `"1"` / `"yes"` all read as `true`; an explicit
 * `"false"` / `"0"` / `"off"` / `"no"` reads as `false`.
 */
export function booleanFromCheckbox(raw?: string): boolean {
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
