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

type FormPath = Issues.FormPath;

/** A nested tree mirroring the form data, `true` where a leaf has changed. */
export interface TaintedFields {
  readonly [key: string]: boolean | TaintedFields | undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Structural deep equality for plain JSON-ish values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
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

  const out: Record<string, boolean | TaintedFields> = {};
  const keys = new Set([...Object.keys(original), ...Object.keys(current)]);
  for (const key of keys) {
    const before = original[key];
    const after = current[key];
    if (isObject(before) && isObject(after) && sameKind(before, after)) {
      const nested = computeTainted(before, after);
      if (Object.keys(nested).length > 0) out[key] = nested;
    } else if (!deepEqual(before, after)) {
      out[key] = true;
    }
  }
  return out;
}

/** Whether anything in the tree is tainted. */
export function isAnyTainted(tainted: TaintedFields): boolean {
  for (const key of Object.keys(tainted)) {
    const value = tainted[key];
    if (value === true) return true;
    if (isObject(value) && isAnyTainted(value)) return true;
  }
  return false;
}

/** Whether the field at `path` (or anything beneath it) is tainted. */
export function isTaintedAt(tainted: TaintedFields, path: FormPath): boolean {
  let node: boolean | TaintedFields | undefined = tainted;
  for (const segment of path) {
    if (node === undefined || typeof node === "boolean") return node === true;
    node = node[String(segment)];
  }
  if (node === undefined) return false;
  if (typeof node === "boolean") return node;
  return isAnyTainted(node);
}

/**
 * Flatten a {@link TaintedFields} tree into the list of leaf {@link FormPath}s
 * that actually changed, in depth-first order — the per-field-changed events
 * a reactive store needs to run per-field validators / clear a superseded
 * server error at exactly the field that moved (as opposed to `isAnyTainted`,
 * which only says *something* changed).
 */
export function taintedLeafPaths(tainted: TaintedFields): FormPath[] {
  const out: FormPath[] = [];

  const walk = (node: TaintedFields, path: Array<string | number>): void => {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (value === undefined) continue;
      const segment: string | number = /^\d+$/.test(key) ? Number(key) : key;
      if (value === true) out.push([...path, segment]);
      else if (typeof value === "object") walk(value, [...path, segment]);
    }
  };

  walk(tainted, []);
  return out;
}
