/**
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
 * @copyright Thomas Foster
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
 * If `node[key]` is a leaf's message list, convert it in place into a branch
 * carrying those same messages as its own {@link ROOT_ERROR_KEY} (a path used
 * as a leaf is now needed as a branch too) — a no-op when `node[key]` is
 * already a branch or absent. Shared by {@link insert} and {@link setLeaf}'s
 * path-descent, the one piece of their branch-walking that's identical.
 */
const promoteLeafToBranch = (node: MutableNode, key: string): void => {
  const existing = node[key];
  if (isMessageList(existing)) node[key] = { [ROOT_ERROR_KEY]: existing };
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
    if (node[key] === undefined) node[key] = {};
    else promoteLeafToBranch(node, key);
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

/**
 * Return a new tree with the messages *directly at* `path` replaced by
 * `messages` (removing the key when `messages` is empty), leaving every other
 * path — including children of a branch `path` — untouched. Unlike
 * {@link setError} (which appends one message), this is the "this field's
 * validator just ran, here is its complete result" operation a per-field
 * validator needs: it can clear a field back to valid without disturbing
 * sibling or nested messages. Pure.
 */
export function replaceAt(
  errors: FormErrors,
  path: FormPath,
  messages: readonly string[],
): FormErrors {
  const next = structuredClone(errors) as unknown as MutableNode;
  setLeaf(next, path, messages);
  return next;
}

const setLeaf = (root: MutableNode, path: FormPath, messages: readonly string[]): void => {
  if (path.length === 0) {
    setOwnMessages(root, messages);
    return;
  }
  const parent = descendClearing(root, path, messages);
  if (parent === undefined) return; // an absent branch on the clearing path — nothing to clear
  setLeafMessages(parent, String(path[path.length - 1]), messages);
};

/** Set or clear a node's own {@link ROOT_ERROR_KEY} messages. */
const setOwnMessages = (node: MutableNode, messages: readonly string[]): void => {
  if (messages.length === 0) delete node[ROOT_ERROR_KEY];
  else node[ROOT_ERROR_KEY] = [...messages];
};

/**
 * Walk to `path`'s parent branch, creating branches as needed. When
 * `messages` is empty (a clear, not a set) a missing branch means there is
 * nothing to clear — descent stops early and returns `undefined` rather than
 * creating empty branches just to immediately no-op inside them.
 */
const descendClearing = (
  root: MutableNode,
  path: FormPath,
  messages: readonly string[],
): MutableNode | undefined => {
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = String(path[i]);
    if (node[key] === undefined) {
      if (messages.length === 0) return undefined;
      node[key] = {};
    } else {
      promoteLeafToBranch(node, key);
    }
    node = node[key] as MutableNode;
  }
  return node;
};

/** Set or clear `node[key]`'s messages — a leaf's list, or (if it's already a branch) its own {@link ROOT_ERROR_KEY}. */
const setLeafMessages = (node: MutableNode, key: string, messages: readonly string[]): void => {
  const existing = node[key];
  if (existing === undefined) {
    if (messages.length > 0) node[key] = [...messages];
    return;
  }
  if (isMessageList(existing)) {
    if (messages.length === 0) delete node[key];
    else node[key] = [...messages];
    return;
  }
  // Already a branch (has nested children) — replace its own messages,
  // preserving the children.
  if (messages.length === 0) delete existing[ROOT_ERROR_KEY];
  else existing[ROOT_ERROR_KEY] = [...messages];
};

/**
 * Where a message in a {@link FormErrors} tree came from. `"server"` messages
 * come from the last submission response; `"client"` messages come from
 * browser-side validation (schema re-run, per-field validators, client-run
 * `refineEffect` refinements). Kept as parallel trees (see {@link
 * SourcedErrors}) rather than tagging each message, so a UI can style sources
 * differently and client revalidation can clear only its own tree, leaving
 * server-reported failures in place until their field actually changes.
 */
export type ErrorSource = "client" | "server";

/** Parallel error trees, one per {@link ErrorSource}, plus their {@link mergeSourced} view. */
export interface SourcedErrors {
  readonly client: FormErrors;
  readonly server: FormErrors;
}

/** Both source trees empty. */
export const emptySourced: SourcedErrors = { client: noErrors, server: noErrors };

/** Combine both source trees into the single tree a UI reads (server first, then client). */
export function mergeSourced(sourced: SourcedErrors): FormErrors {
  return mergeErrors(sourced.server, sourced.client);
}

/**
 * Return new {@link SourcedErrors} with `source`'s tree updated at `path` via
 * {@link replaceAt} (the other source's tree is untouched). Pure.
 */
export function setSourceAt(
  sourced: SourcedErrors,
  source: ErrorSource,
  path: FormPath,
  messages: readonly string[],
): SourcedErrors {
  return { ...sourced, [source]: replaceAt(sourced[source], path, messages) };
}

/** Clear `source`'s messages at `path` (and nowhere else). Shorthand for {@link setSourceAt} with `[]`. */
export function clearSourceAt(
  sourced: SourcedErrors,
  source: ErrorSource,
  path: FormPath,
): SourcedErrors {
  return setSourceAt(sourced, source, path, []);
}
