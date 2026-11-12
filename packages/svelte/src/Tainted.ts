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
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";

type FormPath = Issues.FormPath;

/** A nested tree mirroring the form data, `true` where a leaf has changed. */
export interface TaintedFields {
  readonly [key: string]: boolean | TaintedFields | undefined;
}

/** An object or array read through its string keys. */
type Indexable = { readonly [key: string]: unknown };

/** A non-null object or array, indexable by its own string keys. */
const isObject = <V>(value: V): value is V & Indexable => P.isObjectOrArray(value);

/** The union of both containers' own enumerable keys, `a`'s first. */
const unionKeys = (a: Indexable, b: Indexable): Array<string> => Arr.union(R.keys(a), R.keys(b));

/** Structural deep equality for plain JSON-ish values of the same type. */
export function deepEqual<A>(a: A, b: A): boolean {
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
const sameKind = <A>(a: A, b: A): boolean => Array.isArray(a) === Array.isArray(b);

/**
 * Compare `current` against `original`, returning the nested tainted tree.
 * A changed scalar leaf is `true`; an unchanged leaf is omitted; nested objects
 * **and arrays** recurse (array elements keyed by index), so a single changed
 * row taints only that index — `taintedAt(["items", 2, "name"])` stays precise.
 * Keys present in either side are considered.
 */
export function computeTainted<A>(original: A, current: A): TaintedFields {
  if (!isObject(original) || !isObject(current) || !sameKind(original, current)) return {};

  return R.fromEntries(
    Arr.flatMap(
      unionKeys(original, current),
      (key): Array<readonly [string, boolean | TaintedFields]> => {
        const before = original[key];
        const after = current[key];
        if (isObject(before) && isObject(after) && sameKind(before, after)) {
          const nested = computeTainted(before, after);
          return R.isEmptyReadonlyRecord(nested) ? [] : [[key, nested]];
        }
        return deepEqual(before, after) ? [] : [[key, true]];
      },
    ),
  );
}

/** Whether anything in the tree is tainted. */
export function isAnyTainted(tainted: TaintedFields): boolean {
  return Arr.some(R.values(tainted), (value) =>
    P.isUndefined(value) ? false : P.isBoolean(value) ? value : isAnyTainted(value),
  );
}

/** Whether the field at `path` (or anything beneath it) is tainted. */
export function isTaintedAt(tainted: TaintedFields, path: FormPath): boolean {
  const go = (node: Option.Option<boolean | TaintedFields>, rest: FormPath): boolean =>
    Option.match(node, {
      onNone: () => false,
      onSome: (present) =>
        Arr.match(rest, {
          onEmpty: () => (P.isBoolean(present) ? present : isAnyTainted(present)),
          onNonEmpty: (segments) =>
            P.isBoolean(present)
              ? present
              : go(
                  Option.fromUndefinedOr(present[String(Arr.headNonEmpty(segments))]),
                  Arr.tailNonEmpty(segments),
                ),
        }),
    });
  return go(Option.some(tainted), path);
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
    Arr.flatMap(R.toEntries(node), ([key, value]): FormPath[] => {
      if (P.isUndefined(value)) return [];
      const segment: string | number = /^\d+$/.test(key) ? Number(key) : key;
      if (P.isBoolean(value)) return value ? [[...path, segment]] : [];
      return walk(value, [...path, segment]);
    });

  return walk(tainted, []);
}
