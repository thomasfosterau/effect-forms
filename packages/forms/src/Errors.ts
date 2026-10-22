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

import * as Arr from "effect/Array";
import * as Predicate from "effect/Predicate";
import * as Rec from "effect/Record";
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
interface MutableNode {
  [key: string]: string[] | MutableNode | undefined;
}

const isMessageList = <T>(value: T): value is Extract<T, readonly string[]> =>
  Arr.isArray(value) && Arr.every(value, Predicate.isString);

const ownErrors = (node: MutableNode): string[] => {
  const existing = node[ROOT_ERROR_KEY];
  if (isMessageList(existing)) return existing;
  const created: string[] = [];
  node[ROOT_ERROR_KEY] = created;
  return created;
};

/**
 * Return the branch at `node[key]`, making one in place if needed: an absent
 * key gets a new empty branch, and a leaf's message list is converted into a
 * branch carrying those same messages as its own {@link ROOT_ERROR_KEY} (a
 * path used as a leaf is now needed as a branch too). Shared by {@link insert}
 * and {@link setLeaf}'s path-descent, the one piece of their branch-walking
 * that's identical.
 */
const branchAt = (node: MutableNode, key: string): MutableNode => {
  const existing = node[key];
  if (existing === undefined) {
    const created: MutableNode = {};
    node[key] = created;
    return created;
  }
  if (isMessageList(existing)) {
    const promoted: MutableNode = { [ROOT_ERROR_KEY]: existing };
    node[key] = promoted;
    return promoted;
  }
  return existing;
};

/**
 * Insert one message at `path` into a mutable error tree. A leaf becomes a
 * `string[]`; if the same path is later used as a branch the existing list is
 * preserved under {@link ROOT_ERROR_KEY}; if a branch later receives its own
 * message it lands under {@link ROOT_ERROR_KEY}. The empty path targets the
 * tree root's {@link ROOT_ERROR_KEY}.
 */
const insert = (root: MutableNode, path: FormPath, message: string): void => {
  if (!Arr.isReadonlyArrayNonEmpty(path)) {
    ownErrors(root).push(message);
    return;
  }

  const node = Arr.reduce(Arr.initNonEmpty(path), root, (parent, segment) =>
    branchAt(parent, String(segment)),
  );

  const last = String(Arr.lastNonEmpty(path));
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
  Arr.forEach(issues, (issue) => insert(root, issue.path, issue.message));
  return root;
}

/**
 * Flatten a {@link FormErrors} tree back into a list of {@link FormIssue}s, in
 * depth-first order. The inverse of {@link issuesToErrors} (modulo message
 * ordering within a single field).
 */
export function flattenErrors(errors: FormErrors): FormIssue[] {
  const walk = (node: FormErrors, path: Array<string | number>): Array<FormIssue> =>
    Arr.flatMap(Rec.keys<string, FormErrors[string]>(node), (key): Array<FormIssue> => {
      if (key === ROOT_ERROR_KEY) {
        return Arr.map(node[ROOT_ERROR_KEY] ?? [], (message) => ({ path, message }));
      }
      const value = node[key];
      if (value === undefined) return [];
      const segment: string | number = /^\d+$/.test(key) ? Number(key) : key;
      if (isMessageList(value)) {
        return Arr.map(value, (message) => ({ path: [...path, segment], message }));
      }
      return walk(value, [...path, segment]);
    });

  return walk(errors, []);
}

/** Whether the tree carries any message anywhere. */
export function hasErrors(errors: FormErrors): boolean {
  return Arr.isReadonlyArrayNonEmpty(flattenErrors(errors));
}

/**
 * Read the messages attached directly to `path` (a leaf's list, or a branch's
 * own {@link ROOT_ERROR_KEY}). Returns `undefined` when the path has no direct
 * messages.
 */
export function getError(errors: FormErrors, path: FormPath): readonly string[] | undefined {
  // Once the walk leaves the tree (an absent key, or a leaf with path left
  // over) the accumulator is `undefined`, and stays so for every later segment.
  const node = Arr.reduce<string | number, FormErrors | readonly string[] | undefined>(
    path,
    errors,
    (current, segment) =>
      current === undefined || isMessageList(current) ? undefined : current[String(segment)],
  );
  if (node === undefined) return undefined;
  if (isMessageList(node)) return node;
  return node[ROOT_ERROR_KEY];
}

/** Return a new tree with `message` added at `path`. Pure. */
export function setError(errors: FormErrors, path: FormPath, message: string): FormErrors {
  // SAFETY: `structuredClone` returns a fresh deep copy that nothing else
  // references, and `MutableNode` is `FormErrors` minus `readonly`, so
  // mutating the copy in place cannot be observed through `errors`.
  const next = structuredClone(errors) as MutableNode;
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
  return issuesToErrors(
    Arr.flatMap(flattenErrors(errors), (issue) => {
      const path = remapIndex(issue.path, arrayPath, map);
      return path === null ? [] : [{ path, message: issue.message }];
    }),
  );
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
  // SAFETY: `structuredClone` returns a fresh deep copy that nothing else
  // references, and `MutableNode` is `FormErrors` minus `readonly`, so
  // mutating the copy in place cannot be observed through `errors`.
  const next = structuredClone(errors) as MutableNode;
  setLeaf(next, path, messages);
  return next;
}

const setLeaf = (root: MutableNode, path: FormPath, messages: readonly string[]): void => {
  if (!Arr.isReadonlyArrayNonEmpty(path)) {
    setOwnMessages(root, messages);
    return;
  }
  const parent = descendClearing(root, Arr.initNonEmpty(path), messages);
  if (parent === undefined) return; // an absent branch on the clearing path — nothing to clear
  setLeafMessages(parent, String(Arr.lastNonEmpty(path)), messages);
};

/** Set or clear a node's own {@link ROOT_ERROR_KEY} messages. */
const setOwnMessages = (node: MutableNode, messages: readonly string[]): void => {
  if (Arr.isReadonlyArrayEmpty(messages)) delete node[ROOT_ERROR_KEY];
  else node[ROOT_ERROR_KEY] = [...messages];
};

/**
 * Walk down the `parents` segments (a path minus its last segment) to the
 * leaf's parent branch, creating branches as needed. When
 * `messages` is empty (a clear, not a set) a missing branch means there is
 * nothing to clear — descent stops early and returns `undefined` rather than
 * creating empty branches just to immediately no-op inside them.
 */
const descendClearing = (
  root: MutableNode,
  parents: FormPath,
  messages: readonly string[],
): MutableNode | undefined =>
  // Once a clear meets an absent branch the accumulator is `undefined`, and
  // every later segment leaves the tree untouched.
  Arr.reduce<string | number, MutableNode | undefined>(parents, root, (node, segment) => {
    if (node === undefined) return undefined;
    const key = String(segment);
    if (node[key] === undefined && Arr.isReadonlyArrayEmpty(messages)) return undefined;
    return branchAt(node, key);
  });

/** Set or clear `node[key]`'s messages — a leaf's list, or (if it's already a branch) its own {@link ROOT_ERROR_KEY}. */
const setLeafMessages = (node: MutableNode, key: string, messages: readonly string[]): void => {
  const existing = node[key];
  if (existing === undefined) {
    if (Arr.isReadonlyArrayNonEmpty(messages)) node[key] = [...messages];
    return;
  }
  if (isMessageList(existing)) {
    if (Arr.isReadonlyArrayEmpty(messages)) delete node[key];
    else node[key] = [...messages];
    return;
  }
  // Already a branch (has nested children) — replace its own messages,
  // preserving the children.
  setOwnMessages(existing, messages);
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
