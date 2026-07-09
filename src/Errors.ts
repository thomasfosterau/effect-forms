/**
 * @copyright Thomas Foster
 *
 * The nested form-error tree and its operations.
 *
 * {@link FormErrors} is a nested error tree so a UI can read
 * `errors.author.name` or `errors.tags[0]` directly. The representation is:
 *
 * - a **leaf** field's messages are a `string[]` keyed by the field name
 *   (`{ title: ["Required"] }`);
 * - a **branch** (nested object / array) is a nested `FormErrors`
 *   (`{ author: { name: ["Required"] } }`); array elements are keyed by their
 *   stringified index (`{ tags: { "0": ["Too short"] } }`);
 * - a message attached to a **branch itself** (a cross-field or
 *   whole-array message) lives under that branch's `_errors` key.
 *
 * The tree is plain JSON — it serialises across the SSR boundary unchanged —
 * and the operations here ({@link issuesToErrors}, {@link flattenErrors},
 * {@link setError}, {@link mergeErrors}, …) are pure and return new trees.
 *
 * @module effect-forms/Errors
 */

import type { FormIssue, FormPath } from "./Issues.ts";
import { type IndexMap, remapIndex } from "./Path.ts";

/** The root key under which a branch's own (non-field) messages are stored. */
export const ROOT_ERROR_KEY = "_errors";

/**
 * A nested tree of validation messages. Leaves are `string[]`; branches are
 * nested {@link FormErrors}; a branch's own messages live under
 * {@link ROOT_ERROR_KEY}. Always JSON-serialisable.
 */
export interface FormErrors {
  readonly [ROOT_ERROR_KEY]?: readonly string[];
  readonly [key: string]: FormErrors | readonly string[] | undefined;
}

/**
 * A {@link FormErrors} tree typed to the shape of `A`, so fields are accessed
 * by name with type-safety: for `A = { name: string; author: { bio: string } }`,
 * `errors.name` is `readonly string[] | undefined` and `errors.author?.bio`
 * likewise. A branch's own (cross-field) messages live under `_errors`. The
 * runtime value is an ordinary {@link FormErrors} — this only refines the type.
 */
export type TypedFormErrors<A> = [NonNullable<A>] extends [ReadonlyArray<infer E>]
  ? {
      readonly [index: number]: TypedFormErrors<E> | undefined;
      readonly _errors?: readonly string[];
    }
  : [NonNullable<A>] extends [object]
    ? { readonly [K in keyof A]?: TypedFormErrors<A[K]> } & { readonly _errors?: readonly string[] }
    : readonly string[];

/** Mutable mirror of {@link FormErrors} used while building a tree. */
type MutableNode = { [key: string]: string[] | MutableNode | undefined };

const isMessageList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

const ownErrors = (node: MutableNode): string[] => {
  const existing = node[ROOT_ERROR_KEY];
  if (isMessageList(existing)) return existing;
  const created: string[] = [];
  node[ROOT_ERROR_KEY] = created;
  return created;
};

/**
 * Insert one message at `path` into a mutable error tree. A leaf becomes a
 * `string[]`; if the same path is later used as a branch the existing list is
 * preserved under {@link ROOT_ERROR_KEY}; if a branch later receives its own
 * message it lands under {@link ROOT_ERROR_KEY}. The empty path targets the
 * tree root's {@link ROOT_ERROR_KEY}.
 */
const insert = (root: MutableNode, path: FormPath, message: string): void => {
  if (path.length === 0) {
    ownErrors(root).push(message);
    return;
  }

  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = String(path[i]);
    const existing = node[key];
    if (existing === undefined) {
      node[key] = {};
    } else if (isMessageList(existing)) {
      // A path used as a leaf is now needed as a branch — keep the leaf
      // messages under the branch's own `_errors`.
      node[key] = { [ROOT_ERROR_KEY]: existing };
    }
    node = node[key] as MutableNode;
  }

  const last = String(path[path.length - 1]);
  const existing = node[last];
  if (existing === undefined) {
    node[last] = [message];
  } else if (isMessageList(existing)) {
    existing.push(message);
  } else {
    // The leaf key is already a branch — attach to its own `_errors`.
    ownErrors(existing).push(message);
  }
};

/** Build a nested {@link FormErrors} tree from a flat list of {@link FormIssue}s. */
export function issuesToErrors(issues: ReadonlyArray<FormIssue>): FormErrors {
  const root: MutableNode = {};
  for (const issue of issues) insert(root, issue.path, issue.message);
  return root;
}

/**
 * Flatten a {@link FormErrors} tree back into a list of {@link FormIssue}s, in
 * depth-first order. The inverse of {@link issuesToErrors} (modulo message
 * ordering within a single field).
 */
export function flattenErrors(errors: FormErrors): FormIssue[] {
  const out: FormIssue[] = [];

  const walk = (node: FormErrors, path: Array<string | number>): void => {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (value === undefined) continue;
      if (key === ROOT_ERROR_KEY) {
        for (const message of value as readonly string[]) out.push({ path, message });
        continue;
      }
      const segment: string | number = /^\d+$/.test(key) ? Number(key) : key;
      if (isMessageList(value)) {
        for (const message of value) out.push({ path: [...path, segment], message });
      } else {
        walk(value, [...path, segment]);
      }
    }
  };

  walk(errors, []);
  return out;
}

/** Whether the tree carries any message anywhere. */
export function hasErrors(errors: FormErrors): boolean {
  return flattenErrors(errors).length > 0;
}

/**
 * Read the messages attached directly to `path` (a leaf's list, or a branch's
 * own {@link ROOT_ERROR_KEY}). Returns `undefined` when the path has no direct
 * messages.
 */
export function getError(errors: FormErrors, path: FormPath): readonly string[] | undefined {
  let node: FormErrors | readonly string[] | undefined = errors;
  for (const segment of path) {
    if (node === undefined || isMessageList(node)) return undefined;
    node = node[String(segment)];
  }
  if (node === undefined) return undefined;
  if (isMessageList(node)) return node;
  return node[ROOT_ERROR_KEY];
}

/** Return a new tree with `message` added at `path`. Pure. */
export function setError(errors: FormErrors, path: FormPath, message: string): FormErrors {
  const next = structuredClone(errors) as unknown as MutableNode;
  insert(next, path, message);
  return next;
}

/** Combine two error trees into one (left then right). Pure. */
export function mergeErrors(a: FormErrors, b: FormErrors): FormErrors {
  return issuesToErrors([...flattenErrors(a), ...flattenErrors(b)]);
}

/** The empty error tree. */
export const noErrors: FormErrors = {};

/**
 * Remap the array-index segments of every message under `arrayPath` through
 * `map` (see {@link module:effect-forms/Path.IndexMap}), so an error recorded
 * against a row follows that row through a remove / insert / swap / move.
 * Messages whose index maps to `null` are dropped. Pure.
 */
export function remapIndices(errors: FormErrors, arrayPath: FormPath, map: IndexMap): FormErrors {
  const remapped: FormIssue[] = [];
  for (const issue of flattenErrors(errors)) {
    const path = remapIndex(issue.path, arrayPath, map);
    if (path !== null) remapped.push({ path, message: issue.message });
  }
  return issuesToErrors(remapped);
}
