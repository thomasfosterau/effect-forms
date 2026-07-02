/**
 * @copyright Thomas Foster
 *
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
 * @module effect-forms/Path
 */

import { parseFieldPath } from "./FormData.ts";
import type { FormPath } from "./Issues.ts";

/**
 * Read the value at `path`. Returns `undefined` if any segment is missing or
 * traverses a non-object. The empty path returns the object itself.
 */
export function getAt(obj: unknown, path: FormPath): unknown {
  let current = obj;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/**
 * Return a new tree with the value at `path` replaced by `value`. Objects and
 * arrays along the path are cloned (structural sharing elsewhere); missing
 * containers are created as arrays for numeric segments and objects otherwise.
 * The empty path returns `value`. Pure — `obj` is never mutated.
 */
export function setAt<T>(obj: T, path: FormPath, value: unknown): T {
  if (path.length === 0) return value as T;

  const [head, ...rest] = path;
  const clone = (
    Array.isArray(obj) ? [...(obj as unknown[])] : { ...(obj as Record<string, unknown>) }
  ) as Record<string | number, unknown>;

  const child = clone[head];
  clone[head] =
    rest.length === 0
      ? value
      : setAt(
          child === null || typeof child !== "object"
            ? typeof rest[0] === "number"
              ? []
              : {}
            : child,
          rest,
          value,
        );

  return clone as T;
}

/** Whether `path` is `root` or nested beneath it. */
export function isUnder(path: FormPath, root: FormPath): boolean {
  if (path.length < root.length) return false;
  for (let i = 0; i < root.length; i++) {
    if (path[i] !== root[i]) return false;
  }
  return true;
}

/**
 * Render a {@link FormPath} as flat field-name notation: string segments join
 * with `.` and number segments become `[n]` (`["tags", 0]` → `"tags[0]"`).
 * The inverse of {@link fromString}.
 */
export function toString(path: FormPath): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? segment : `.${segment}`;
  }
  return out;
}

/**
 * Parse flat field-name notation into a {@link FormPath}: integer tokens become
 * number segments (array indices), everything else stays a string. The inverse
 * of {@link toString}.
 */
export function fromString(name: string): FormPath {
  return parseFieldPath(name).map((token) => (/^\d+$/.test(token) ? Number(token) : token));
}
