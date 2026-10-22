/**
 * Nested get / set along a {@link FormPath}.
 *
 * A form's data is a tree, and the reactive bindings address it by path:
 * `["author", "name"]`, `["tags", 0]`. This module reads and writes a value
 * at such a path — {@link getAt} descends, {@link setAt} returns a new tree
 * with the value replaced (structural sharing, never a mutation) so a rune /
 * atom store can diff cheaply. It is the framework-neutral half of the
 * reactive field bindings (the Svelte store leans on it for
 * `setValue` and the array operations).
 *
 * Paths are {@link FormPath}s — the same array-of-segments the {@link
 * module:effect-forms/Errors} tree and {@link module:effect-forms/Issues}
 * walker already speak — so string keys address object properties and number
 * segments address array indices. {@link toString} / {@link fromString}
 * convert to and from the flat `author.name` / `tags[0]` notation the HTML
 * body parser ({@link module:effect-forms/FormData}) uses.
 *
 * @copyright Thomas Foster
 * @module effect-forms/Path
 */

import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
import { parseFieldPath } from "./FormData.ts";
import type { FormPath } from "./Issues.ts";

/**
 * Read the value at `path`. Returns `undefined` if any segment is missing or
 * traverses a non-object. The empty path returns the object itself.
 */
export function getAt(obj: unknown, path: FormPath): unknown {
  // Once a segment lands on a non-object the accumulator is `undefined`, which
  // is itself a non-object, so every later segment keeps it `undefined`.
  // A missing key reads as `undefined` either way, so guarding on `in` first
  // matches a plain property read on any object or array.
  return Arr.reduce(path, obj, (current, segment) =>
    Predicate.isObjectOrArray(current) && Predicate.hasProperty(current, segment)
      ? current[segment]
      : undefined,
  );
}

/**
 * Return a new tree with the value at `path` replaced by `value`. Objects and
 * arrays along the path are cloned (structural sharing elsewhere); missing
 * containers are created as arrays for numeric segments and objects otherwise.
 * The empty path returns `value`. Pure — `obj` is never mutated.
 *
 * @example
 * ```ts
 * import { Path } from "@thomasfosterau/effect-forms"
 *
 * const before = { authors: [{ name: "Ada" }] }
 * const after = Path.setAt(before, ["authors", 0, "name"], "Grace")
 * console.log(Path.getAt(after, ["authors", 0, "name"])) // "Grace"
 * console.log(before.authors[0]?.name) // "Ada" — the input is untouched
 * ```
 */
export function setAt<T>(obj: T, path: FormPath, value: unknown): T {
  return Arr.match(path, {
    // SAFETY: the empty path addresses the whole tree, so `value` is the new
    // root; `setAt`'s documented contract is that the caller writes a value of
    // the shape `T` expects at `path`, which here is `T` itself.
    onEmpty: () => value as T,
    onNonEmpty: ([head, ...rest]) => {
      // `Object(obj)` boxes a primitive root so the spread type-checks; spreading
      // the box copies exactly what spreading `obj` itself would.
      // SAFETY: `clone` is a fresh shallow copy — an array or a plain object —
      // and both accept a read or write under any string or number key.
      const clone = (Arr.isArray(obj) ? [...obj] : { ...Object(obj) }) as Record<
        PropertyKey,
        unknown
      >;
      const child = clone[head];
      clone[head] = Arr.match(rest, {
        onEmpty: () => value,
        onNonEmpty: (tail) =>
          setAt(
            Predicate.isObjectOrArray(child) ? child : Predicate.isNumber(tail[0]) ? [] : {},
            tail,
            value,
          ),
      });
      // SAFETY: `clone` is a shallow copy of `obj` (an array when `obj` is
      // one, a plain object otherwise) differing only at `head`, where the
      // caller's `value` (by `setAt`'s contract, of the type `T` holds at
      // `path`) was written.
      return clone as T;
    },
  });
}

/** Whether `path` is `root` or nested beneath it. */
export function isUnder(path: FormPath, root: FormPath): boolean {
  return path.length >= root.length && Arr.every(root, (segment, i) => path[i] === segment);
}

/**
 * Render a {@link FormPath} as flat field-name notation: string segments join
 * with `.` and number segments become `[n]` (`["tags", 0]` → `"tags[0]"`).
 * The inverse of {@link fromString}.
 */
export function toString(path: FormPath): string {
  return Arr.reduce(path, "", (out, segment) =>
    Predicate.isNumber(segment) ? `${out}[${segment}]` : out === "" ? segment : `${out}.${segment}`,
  );
}

/**
 * Parse flat field-name notation into a {@link FormPath}: integer tokens become
 * number segments (array indices), everything else stays a string. The inverse
 * of {@link toString}.
 */
export function fromString(name: string): FormPath {
  return parseFieldPath(name).map((token) => (/^\d+$/.test(token) ? Number(token) : token));
}

/**
 * The deep-key type: every valid {@link toString} path into `T`, as a union of
 * string literals (`"author.name"`, `"tags[0]"`, `"tags[0].label"`, …). This is
 * the type-checked counterpart of a hand-written {@link FormPath} — a typo'd
 * segment or a path into a field that doesn't exist is a compile error. Bounded
 * to a fixed recursion depth ({@link Prev}'s length) so a struct with cycles
 * (there shouldn't be any — form data is JSON-shaped) can't blow up inference.
 *
 * Used by {@link module:effect-forms-svelte/FormStore}'s `field(path)` — see
 * the trade-off recorded in `docs/decisions/` for why this was chosen over the
 * core's (now-removed) opaque `FieldRef`.
 */
export type FieldPath<T, D extends number = 8> = T extends object
  ? [D] extends [never]
    ? never
    : {
        [K in Extract<keyof T, string>]: `${K}${PathSuffix<T[K], Prev[D]>}`;
      }[Extract<keyof T, string>]
  : never;

/** Recursion-depth countdown used by {@link FieldPath} / {@link PathValue}. */
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7];

/**
 * The continuation after a key: nothing, an array index (the bracket closes
 * immediately — `[0]`, not `[0.label]` — then {@link PathSuffix} recurses on
 * the element type for whatever comes after), or `.key`.
 */
type PathSuffix<T, D extends number> = [D] extends [never]
  ? ""
  : T extends ReadonlyArray<infer E>
    ? "" | `[${number}]${PathSuffix<E, Prev[D]>}`
    : T extends object
      ?
          | ""
          | { [K in Extract<keyof T, string>]: `.${K}${PathSuffix<T[K], Prev[D]>}` }[Extract<
              keyof T,
              string
            >]
      : "";

/** The base key of a single dot-segment (`"tags[0]"` → `"tags"`). */
type SegmentBase<S extends string> = S extends `${infer Base}[${string}` ? Base : S;

/** The bracket indices of a single dot-segment (`"tags[0][1]"` → `["0", "1"]`), untyped past presence. */
type SegmentIndices<S extends string> = S extends `${string}[${infer Idx}]${infer Rest}`
  ? [Idx, ...SegmentIndicesRest<Rest>]
  : [];

/** Continuation of {@link SegmentIndices} once the leading (non-bracket) prefix has been consumed. */
type SegmentIndicesRest<S extends string> = S extends `[${infer Idx}]${infer Rest}`
  ? [Idx, ...SegmentIndicesRest<Rest>]
  : [];

/** Step through an array type once per entry in `Idxs`. */
type ApplyIndices<T, Idxs extends readonly unknown[]> = Idxs extends [unknown, ...infer Rest]
  ? T extends ReadonlyArray<infer E>
    ? ApplyIndices<E, Rest>
    : never
  : T;

/** Resolve a single dot-segment (base key plus any bracket indices) against `T`. */
type ResolveSegment<T, S extends string> =
  SegmentBase<S> extends keyof T ? ApplyIndices<T[SegmentBase<S>], SegmentIndices<S>> : never;

/**
 * The value type at a {@link FieldPath} `P` into `T` — the leaf type `field(path)`
 * resolves to. `PathValue<{ tags: string[] }, "tags[0]">` is `string`.
 */
export type PathValue<T, P extends string> = P extends `${infer Head}.${infer Rest}`
  ? PathValue<ResolveSegment<T, Head>, Rest>
  : ResolveSegment<T, P>;

/**
 * Maps an array index that existed before an index-shifting mutation to where
 * it lives afterwards, or to `null` when the item at that index no longer
 * exists (its per-index state should be dropped). Built by {@link removeAt} /
 * {@link insertAt} / {@link swapAt} / {@link moveAt} / {@link replaceAt}, and
 * consumed by {@link remapIndex} / {@link remapKeyedRecord} and
 * `Errors.remapIndices` to keep per-index state (touched flags, error trees)
 * in sync with the row it was recorded against.
 */
export type IndexMap = (index: number) => number | null;

/** The {@link IndexMap} for removing the item at `index`: shifts later indices down by one. */
export function removeAt(index: number): IndexMap {
  return (i) => (i === index ? null : i > index ? i - 1 : i);
}

/** The {@link IndexMap} for inserting an item at `index`: shifts `index` and later up by one. */
export function insertAt(index: number): IndexMap {
  return (i) => (i >= index ? i + 1 : i);
}

/** The {@link IndexMap} for swapping the items at `a` and `b`. */
export function swapAt(a: number, b: number): IndexMap {
  return (i) => (i === a ? b : i === b ? a : i);
}

/** The {@link IndexMap} for moving the item at `from` to `to`, shifting the items between. */
export function moveAt(from: number, to: number): IndexMap {
  return (i) => {
    if (i === from) return to;
    if (from < to) return i > from && i <= to ? i - 1 : i;
    return i >= to && i < from ? i + 1 : i;
  };
}

/** The {@link IndexMap} for replacing the item at `index` in place: drops only that index's state. */
export function replaceAt(index: number): IndexMap {
  return (i) => (i === index ? null : i);
}

/** The {@link IndexMap} for clearing every item in the array: drops all per-index state. */
export const clearAll: IndexMap = () => null;

/**
 * Remap `path`'s index segment immediately under `arrayPath` through `map`.
 * Paths outside `arrayPath`, and `arrayPath` itself (a whole-array message),
 * pass through unchanged; a path whose index segment maps to `null` is
 * dropped (returns `null`) — its item no longer exists. Pure.
 */
export function remapIndex(path: FormPath, arrayPath: FormPath, map: IndexMap): FormPath | null {
  if (!isUnder(path, arrayPath) || path.length === arrayPath.length) return path;
  const segment = path[arrayPath.length];
  if (!Predicate.isNumber(segment)) return path;
  const mapped = map(segment);
  if (mapped === null) return null;
  if (mapped === segment) return path;
  return [...path.slice(0, arrayPath.length), mapped, ...path.slice(arrayPath.length + 1)];
}

/**
 * Remap every entry of a flat, path-keyed record (a {@link toString} key per
 * entry — e.g. touched flags) through {@link remapIndex}. Entries whose path
 * maps to `null` are dropped. Pure.
 */
export function remapKeyedRecord<T>(
  record: Record<string, T>,
  arrayPath: FormPath,
  map: IndexMap,
): Record<string, T> {
  return Rec.fromEntries(
    Arr.flatMap(Rec.toEntries(record), ([key, value]) => {
      const remapped = remapIndex(fromString(key), arrayPath, map);
      return remapped === null ? [] : [[toString(remapped), value] as const];
    }),
  );
}
