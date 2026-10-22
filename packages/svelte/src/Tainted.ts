/**
 * Tainted-field tracking — which fields the user has changed since the form
 * was seeded.
 *
 * A `tainted` store lets a UI show "unsaved changes",
 * guard navigation, or submit only what changed. This is the pure half: a deep
 * diff of the current data against the original snapshot producing a nested
 * boolean tree mirroring the data's shape. The reactive store
 * (`superForm.svelte.ts`) re-derives it as the data changes.
 *
 * @copyright Thomas Foster
 * @module effect-forms-svelte/Tainted
 */

import type { Issues } from "@thomasfosterau/effect-forms";
import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";

type FormPath = Issues.FormPath;

/** A nested tree mirroring the form data, `true` where a leaf has changed. */
export interface TaintedFields {
  readonly [key: string]: boolean | TaintedFields | undefined;
}

/** An object or array read through its string keys. */
type Indexable = { readonly [key: string]: unknown };

/** A non-null object or array, indexable by its own string keys. */
const isObject = (value: unknown): value is Indexable => Predicate.isObjectOrArray(value);

/** The union of both containers' own enumerable keys, `a`'s first. */
const unionKeys = (a: Indexable, b: Indexable): Array<string> =>
  Arr.union(Record.keys(a), Record.keys(b));

/** Structural deep equality for plain JSON-ish values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    return Arr.every(unionKeys(a, b), (key) => deepEqual(a[key], b[key]));
  }
  return false;
}

/** Whether two containers are the same kind (both arrays, or both plain objects). */
const sameKind = (a: unknown, b: unknown): boolean => Array.isArray(a) === Array.isArray(b);

/**
 * Compare `current` against `original`, returning the nested tainted tree.
 * A changed scalar leaf is `true`; an unchanged leaf is omitted; nested objects
 * **and arrays** recurse (array elements keyed by index), so a single changed
 * row taints only that index — `taintedAt(["items", 2, "name"])` stays precise.
 * Keys present in either side are considered.
 */
export function computeTainted(original: unknown, current: unknown): TaintedFields {
  if (!isObject(original) || !isObject(current) || !sameKind(original, current)) return {};

  return Record.fromEntries(
    Arr.flatMap(
      unionKeys(original, current),
      (key): Array<readonly [string, boolean | TaintedFields]> => {
        const before = original[key];
        const after = current[key];
        if (isObject(before) && isObject(after) && sameKind(before, after)) {
          const nested = computeTainted(before, after);
          return Record.isEmptyReadonlyRecord(nested) ? [] : [[key, nested]];
        }
        return deepEqual(before, after) ? [] : [[key, true]];
      },
    ),
  );
}

/** Whether anything in the tree is tainted. */
export function isAnyTainted(tainted: TaintedFields): boolean {
  return Arr.some(
    Record.values(tainted),
    (value) => value === true || (isObject(value) && isAnyTainted(value)),
  );
}

/** Whether the field at `path` (or anything beneath it) is tainted. */
export function isTaintedAt(tainted: TaintedFields, path: FormPath): boolean {
  const go = (node: boolean | TaintedFields | undefined, rest: FormPath): boolean =>
    Arr.match(rest, {
      onEmpty: () =>
        Predicate.isUndefined(node) ? false : Predicate.isBoolean(node) ? node : isAnyTainted(node),
      onNonEmpty: (segments) =>
        Predicate.isUndefined(node) || Predicate.isBoolean(node)
          ? node === true
          : go(node[String(Arr.headNonEmpty(segments))], Arr.tailNonEmpty(segments)),
    });
  return go(tainted, path);
}

/**
 * Flatten a {@link TaintedFields} tree into the list of leaf {@link FormPath}s
 * that actually changed, in depth-first order — the per-field-changed events
 * a reactive store needs to run per-field validators / clear a superseded
 * server error at exactly the field that moved (as opposed to `isAnyTainted`,
 * which only says *something* changed).
 */
export function taintedLeafPaths(tainted: TaintedFields): FormPath[] {
  const walk = (node: TaintedFields, path: Array<string | number>): FormPath[] =>
    Arr.flatMap(Record.toEntries(node), ([key, value]): FormPath[] => {
      if (Predicate.isUndefined(value)) return [];
      const segment: string | number = /^\d+$/.test(key) ? Number(key) : key;
      if (value === true) return [[...path, segment]];
      if (isObject(value)) return walk(value, [...path, segment]);
      return [];
    });

  return walk(tainted, []);
}
