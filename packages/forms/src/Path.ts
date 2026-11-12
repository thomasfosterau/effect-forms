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
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import { parseFieldPath } from "./FormData.ts";
import type { FormPath } from "./Issues.ts";

/**
 * A leaf of a form data tree: a scalar an input holds, `null` / `undefined`
 * for a blank, a `Date`, or a `Blob` / `File` from a file input.
 */
export type FormLeaf = string | number | boolean | bigint | null | undefined | Date | Blob;

/**
 * A form data tree: a {@link FormLeaf}, an array of trees, or a record of
 * trees. Every value a form holds, posts or validates is one, so it is what
 * {@link getAt} / {@link setAt} walk and what the reactive bindings serialise
 * into a form body. A parsed body (`FormData.FormBodyValue`: strings, `File`s,
 * arrays and records) is one; so is a `Field.BlankValue`.
 */
export type FormValue = FormLeaf | ReadonlyArray<FormValue> | { readonly [key: string]: FormValue };

/** A {@link FormValue} that holds children: an array or a record of trees. */
type Container = ReadonlyArray<FormValue> | { readonly [key: string]: FormValue };

/** Whether `value` is a `Blob` (a `File` is one); holds in a runtime without a global `Blob`. */
const isBlob = (value: FormValue): value is Blob =>
  !P.isUndefined(globalThis.Blob) && value instanceof Blob;

/** Whether `value` holds children (a `Date` or `Blob` leaf is an object, but not a container). */
const isContainer = (value: FormValue): value is Container =>
  P.isObjectOrArray(value) && !(value instanceof Date) && !isBlob(value);

/** The child of `container` at `segment`, or `undefined` when it has none. */
const childAt = (container: Container, segment: string | number): FormValue => {
  if (isList(container)) return P.isNumber(segment) ? container[segment] : undefined;
  return Object.hasOwn(container, segment) ? container[String(segment)] : undefined;
};

/** Whether a {@link Container} is the array kind. */
const isList = (container: Container): container is ReadonlyArray<FormValue> =>
  Arr.isArray(container);

/**
 * Read the value at `path`. Returns `undefined` if any segment is missing or
 * traverses a leaf. The empty path returns the tree itself.
 */
export function getAt(obj: FormValue, path: FormPath): FormValue {
  // Once a segment lands on a leaf the accumulator is `undefined`, which is
  // itself a leaf, so every later segment keeps it `undefined`.
  return Arr.reduce(path, obj, (current, segment) =>
    isContainer(current) ? childAt(current, segment) : undefined,
  );
}

/**
 * The untyped core of {@link setAt}: the copy of the container `obj` with
 * `value` written at `path` (the empty path yields `value` itself). An array
 * is copied as an array (a string segment on it lands on the copy as a
 * property, as a write would) and a record as a plain object of its own
 * enumerable properties; a missing or leaf container further down is replaced
 * by a fresh one.
 */
const setIn = (obj: Container, path: FormPath, value: FormValue): FormValue =>
  Arr.match(path, {
    onEmpty: () => value,
    onNonEmpty: ([head, ...rest]) => {
      const next = Arr.match(rest, {
        onEmpty: () => value,
        onNonEmpty: (tail) => {
          const child = getAt(obj, [head]);
          return setIn(isContainer(child) ? child : P.isNumber(tail[0]) ? [] : {}, tail, value);
        },
      });
      return isList(obj) ? Object.assign([...obj], { [head]: next }) : { ...obj, [head]: next };
    },
  });

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
export function setAt<T extends FormValue>(obj: T, path: FormPath, value: FormValue): T {
  // SAFETY: `setIn` returns a copy of `obj` that differs only at `path`, where
  // `value` was written (a leaf root has no properties to keep, so it starts
  // from an empty record). `setAt`'s documented contract is that the caller
  // writes a value of the type `T` holds at `path` (at the empty path, `T`
  // itself), so the copy is still a `T`. A runtime `FormPath` carries no static
  // type, so TypeScript cannot relate `value` to `T` at `path`: this is the one
  // point where that caller contract is assumed.
  return setIn(isContainer(obj) ? obj : {}, path, value) as T;
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
    P.isNumber(segment) ? `${out}[${segment}]` : out === "" ? segment : `${out}.${segment}`,
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
 * Maps an array index that existed before an index-shifting mutation to
 * `Option.some` of where it lives afterwards, or to `Option.none()` when the
 * item at that index no longer exists (its per-index state should be dropped). Built by {@link removeAt} /
 * {@link insertAt} / {@link swapAt} / {@link moveAt} / {@link replaceAt}, and
 * consumed by {@link remapIndex} / {@link remapKeyedRecord} and
 * `Errors.remapIndices` to keep per-index state (touched flags, error trees)
 * in sync with the row it was recorded against.
 */
export type IndexMap = (index: number) => Option.Option<number>;

/** The {@link IndexMap} for removing the item at `index`: shifts later indices down by one. */
export function removeAt(index: number): IndexMap {
  return (i) => (i === index ? Option.none() : Option.some(i > index ? i - 1 : i));
}

/** The {@link IndexMap} for inserting an item at `index`: shifts `index` and later up by one. */
export function insertAt(index: number): IndexMap {
  return (i) => Option.some(i >= index ? i + 1 : i);
}

/** The {@link IndexMap} for swapping the items at `a` and `b`. */
export function swapAt(a: number, b: number): IndexMap {
  return (i) => Option.some(i === a ? b : i === b ? a : i);
}

/** The {@link IndexMap} for moving the item at `from` to `to`, shifting the items between. */
export function moveAt(from: number, to: number): IndexMap {
  return (i) => {
    if (i === from) return Option.some(to);
    if (from < to) return Option.some(i > from && i <= to ? i - 1 : i);
    return Option.some(i >= to && i < from ? i + 1 : i);
  };
}

/** The {@link IndexMap} for replacing the item at `index` in place: drops only that index's state. */
export function replaceAt(index: number): IndexMap {
  return (i) => (i === index ? Option.none() : Option.some(i));
}

/** The {@link IndexMap} for clearing every item in the array: drops all per-index state. */
export const clearAll: IndexMap = () => Option.none();

/**
 * Remap `path`'s index segment immediately under `arrayPath` through `map`.
 * Paths outside `arrayPath`, and `arrayPath` itself (a whole-array message),
 * pass through unchanged (as `Option.some`); a path whose index segment maps
 * to `Option.none()` is dropped (returns `Option.none()`) — its item no longer
 * exists. Pure.
 */
export function remapIndex(
  path: FormPath,
  arrayPath: FormPath,
  map: IndexMap,
): Option.Option<FormPath> {
  if (!isUnder(path, arrayPath) || path.length === arrayPath.length) return Option.some(path);
  const segment = path[arrayPath.length];
  if (!P.isNumber(segment)) return Option.some(path);
  return Option.map(map(segment), (mapped): FormPath =>
    mapped === segment
      ? path
      : [...path.slice(0, arrayPath.length), mapped, ...path.slice(arrayPath.length + 1)],
  );
}

/**
 * Remap every entry of a flat, path-keyed record (a {@link toString} key per
 * entry — e.g. touched flags) through {@link remapIndex}. Entries whose path
 * maps to `Option.none()` are dropped. Pure.
 */
export function remapKeyedRecord<T>(
  record: Record<string, T>,
  arrayPath: FormPath,
  map: IndexMap,
): Record<string, T> {
  return R.fromEntries(
    Arr.getSomes(
      Arr.map(R.toEntries(record), ([key, value]) =>
        Option.map(
          remapIndex(fromString(key), arrayPath, map),
          (remapped) => [toString(remapped), value] as const,
        ),
      ),
    ),
  );
}
