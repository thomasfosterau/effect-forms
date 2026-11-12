/**
 * The **update tri-state**: how a partial-update input says, per clearable
 * field, one of three things.
 *
 * | Wire        | Meaning                        | Decoded            |
 * | ----------- | ------------------------------ | ------------------ |
 * | key absent  | carry the stored value forward | {@link CarryForward} |
 * | `null`      | clear the field                | {@link Clear}        |
 * | a value     | set the field                  | {@link Assign}       |
 *
 * The vocabulary mirrors `@thomasfosterau/effect-ext`'s `TriState` module
 * (same names, constructors and semantics), so the family speaks one
 * tri-state language; the core keeps its own copy because it imports
 * `effect` only. `Coerce` and the `Command` adapters produce a
 * {@link TriState}; the adapters map it back onto the wire (`null` / absent)
 * when they build the encoded command payload, so a host app's JSON is
 * unchanged.
 *
 * **The hazard every reader here guards against** is folding "carry forward"
 * into "clear": `col: input.col ?? null` on a write path is silent data loss.
 * {@link read} / {@link readNullOr} keep the three states apart;
 * {@link suppliedValue} / {@link suppliedNullOr} fold the two no-value states
 * together on purpose, and are for side effects only.
 *
 * @copyright Thomas Foster
 * @module effect-forms/TriState
 */

import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Schema from "effect/Schema";

// ── schemas ───────────────────────────────────────────────────────────

/**
 * A clearable update field in the `Option` encoding:
 * `Schema.optionalKey(Schema.OptionFromNullOr(schema))`. An absent key stays
 * absent, `null` decodes to `Option.none()`, a value to `Option.some(value)`;
 * encoding reproduces the wire exactly.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * const UpdateNote = Schema.Struct({ summary: TriState.clearable(Schema.String) })
 * const decode = Schema.decodeUnknownSync(UpdateNote)
 *
 * console.log(decode({})) // {}
 * console.log(decode({ summary: null })) // { summary: { _id: 'Option', _tag: 'None' } }
 * console.log(decode({ summary: "Next" })) // { summary: { _id: 'Option', _tag: 'Some', value: 'Next' } }
 * ```
 */
export const clearable = <S extends Schema.Constraint>(
  schema: S,
): Schema.optionalKey<Schema.OptionFromNullOr<S>> =>
  Schema.optionalKey(Schema.OptionFromNullOr(schema));

/**
 * A clearable update field in the nullable encoding:
 * `Schema.optional(Schema.NullOr(schema))`. An absent key (or an explicit
 * `undefined`) carries forward, `null` clears, a value sets — the update
 * struct shape `Command.plan` reads as clearable.
 *
 * @example
 * ```ts
 * import { Schema } from "effect"
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * const UpdatePerson = Schema.Struct({ birthPlaceId: TriState.clearableNullOr(Schema.String) })
 * const decode = Schema.decodeUnknownSync(UpdatePerson)
 *
 * console.log(decode({}), decode({ birthPlaceId: null }), decode({ birthPlaceId: "x" }))
 * // {} { birthPlaceId: null } { birthPlaceId: 'x' }
 * ```
 */
export const clearableNullOr = <S extends Schema.Constraint>(
  schema: S,
): Schema.optional<Schema.NullOr<S>> => Schema.optional(Schema.NullOr(schema));

// ── models ────────────────────────────────────────────────────────────

/**
 * The field was not supplied: the stored value carries forward.
 *
 * @example
 * ```ts
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * const state: TriState.CarryForward = { _tag: "CarryForward" }
 * console.log(state._tag) // "CarryForward"
 * ```
 */
export interface CarryForward {
  readonly _tag: "CarryForward";
}

/**
 * The field was supplied as `null`: the stored value is cleared.
 *
 * @example
 * ```ts
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * const state: TriState.Clear = { _tag: "Clear" }
 * console.log(state._tag) // "Clear"
 * ```
 */
export interface Clear {
  readonly _tag: "Clear";
}

/**
 * The field was supplied with a value: the stored value is replaced.
 *
 * @example
 * ```ts
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * const state: TriState.Assign<string> = { _tag: "Assign", value: "Ada" }
 * console.log(state.value) // "Ada"
 * ```
 */
export interface Assign<A> {
  readonly _tag: "Assign";
  readonly value: A;
}

/**
 * One clearable update field, read: exactly one of {@link CarryForward},
 * {@link Clear} and {@link Assign}.
 *
 * @example
 * ```ts
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * const states: ReadonlyArray<TriState.TriState<number>> = [
 *   TriState.carryForward,
 *   TriState.clear,
 *   TriState.assign(1)
 * ]
 * console.log(states.map((state) => state._tag)) // [ 'CarryForward', 'Clear', 'Assign' ]
 * ```
 */
export type TriState<A> = CarryForward | Clear | Assign<A>;

// ── constructors ──────────────────────────────────────────────────────

/**
 * The {@link CarryForward} state.
 *
 * @example
 * ```ts
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * console.log(TriState.carryForward) // { _tag: 'CarryForward' }
 * ```
 */
export const carryForward: TriState<never> = { _tag: "CarryForward" };

/**
 * The {@link Clear} state.
 *
 * @example
 * ```ts
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * console.log(TriState.clear) // { _tag: 'Clear' }
 * ```
 */
export const clear: TriState<never> = { _tag: "Clear" };

/**
 * The {@link Assign} state for `value`.
 *
 * @example
 * ```ts
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * console.log(TriState.assign("Ada")) // { _tag: 'Assign', value: 'Ada' }
 * ```
 */
export const assign = <A>(value: A): TriState<A> => ({ _tag: "Assign", value });

// ── readers ───────────────────────────────────────────────────────────

/**
 * What an argument to a nullable-encoding reader ({@link readNullOr},
 * {@link suppliedNullOr}) must additionally satisfy: nothing for a plain
 * nullable value, an unsatisfiable key for an `Option` — an `Option`-encoded
 * field read as a nullable one would come back as `Assign(Option.none())`, a
 * clear silently turned into an assignment. The key names the reader to use
 * instead.
 */
type NotOption<A> = [Extract<A, Option.Option<unknown>>] extends [never]
  ? unknown
  : { readonly "an Option-encoded field is read with TriState.read / suppliedValue": never };

/**
 * Read a {@link clearable} field (the `Option` encoding) into its
 * {@link TriState}, keeping all three states apart — the reader for a write
 * path. An absent field (`undefined`) carries forward.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * console.log(TriState.read(undefined)._tag, TriState.read(Option.none())._tag, TriState.read(Option.some(1)))
 * // CarryForward Clear { _tag: 'Assign', value: 1 }
 * ```
 */
export const read = <A>(field?: Option.Option<A>): TriState<A> =>
  field === undefined
    ? carryForward
    : Option.match(field, { onNone: () => clear, onSome: (value) => assign(value) });

/**
 * Read a {@link clearableNullOr} field (the nullable encoding) into its
 * {@link TriState}: `undefined` carries forward, `null` clears, anything else
 * — falsy values included — is assigned. The field's type is taken whole
 * (`string | null | undefined` reads as a `TriState<string>`), so a bare
 * `null` or `undefined` reads as a `TriState<never>` that fits any field. An
 * `Option` is rejected at compile time: read the `Option` encoding with
 * {@link read}.
 *
 * @example
 * ```ts
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * console.log(TriState.readNullOr(undefined)._tag, TriState.readNullOr(null)._tag, TriState.readNullOr(0))
 * // CarryForward Clear { _tag: 'Assign', value: 0 }
 * ```
 */
export const readNullOr = <A>(field: A & NotOption<A>): TriState<NonNullable<A>> =>
  field === undefined ? carryForward : field === null ? clear : assign(field);

/**
 * Fold a {@link TriState} into a value, one handler per state.
 *
 * @example
 * ```ts
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * const describe = TriState.match({
 *   onCarryForward: () => "unchanged",
 *   onClear: () => "cleared",
 *   onAssign: (value: string) => `set to ${value}`
 * })
 * console.log(describe(TriState.readNullOr("Ada")), describe(TriState.readNullOr(null)))
 * // set to Ada cleared
 * ```
 */
export const match =
  <A, B>(cases: {
    readonly onCarryForward: () => B;
    readonly onClear: () => B;
    readonly onAssign: (value: A) => B;
  }) =>
  (state: TriState<A>): B =>
    P.isTagged(state, "Assign")
      ? cases.onAssign(state.value)
      : P.isTagged(state, "Clear")
        ? cases.onClear()
        : cases.onCarryForward();

/**
 * The value an update actually **supplies** for a {@link clearable} field,
 * collapsing the two states that supply no value at all: an absent key (carry
 * forward) and an explicit `Option.none()` (clear).
 *
 * Use it only where those two genuinely behave alike — a side effect that runs
 * only when a value is *set*. **Never reach for it on a write path**: there
 * "carry forward" and "clear" must produce different values; use {@link read}.
 *
 * @example
 * ```ts
 * import { Option } from "effect"
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * console.log(Option.isNone(TriState.suppliedValue(undefined)), Option.isNone(TriState.suppliedValue(Option.none())))
 * // true true
 * console.log(TriState.suppliedValue(Option.some("Ada L.")))
 * // { _id: 'Option', _tag: 'Some', value: 'Ada L.' }
 * ```
 */
export const suppliedValue = <A>(field?: Option.Option<A>): Option.Option<A> =>
  field ?? Option.none();

/**
 * {@link suppliedValue} for a {@link clearableNullOr} field: `undefined`
 * (carry forward) and `null` (clear) both become `Option.none()`; any other
 * value — falsy ones included — is supplied. Side effects only, never a write
 * path. An `Option` is rejected at compile time: use {@link suppliedValue}.
 *
 * @example
 * ```ts
 * import { TriState } from "@thomasfosterau/effect-forms"
 *
 * console.log(TriState.suppliedNullOr(null)._tag, TriState.suppliedNullOr(""))
 * // None { _id: 'Option', _tag: 'Some', value: '' }
 * ```
 */
export const suppliedNullOr = <A>(field: A & NotOption<A>): Option.Option<NonNullable<A>> =>
  Option.fromNullishOr(field);
