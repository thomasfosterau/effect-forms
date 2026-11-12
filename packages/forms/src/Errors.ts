/**
 * The nested form-error tree and its operations.
 *
 * {@link FormErrors} is a nested error tree keyed by field path: a UI reads a
 * field's messages with {@link getError} at that field's path (a typed
 * {@link module:effect-forms/Focus} carries it). The representation is:
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
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as R from "effect/Record";
import * as Result from "effect/Result";
import type { FormIssue, FormPath } from "./Issues.ts";
import { type IndexMap, isUnder, remapIndex } from "./Path.ts";

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

const isMessageList = <T>(value: T): value is Extract<T, readonly string[]> =>
  Arr.isArray(value) && Arr.every(value, P.isString);

/** A node's own {@link ROOT_ERROR_KEY} messages (none when absent). */
const ownMessages = (node: FormErrors): readonly string[] => {
  const own = node[ROOT_ERROR_KEY];
  return isMessageList(own) ? own : [];
};

/** `node` with `key` set to `child`: an existing key keeps its position, a new one is appended. */
const withChild = (
  node: FormErrors,
  key: string,
  child: FormErrors | readonly string[],
): FormErrors => ({ ...node, [key]: child });

/**
 * The branch at `node[key]`, as a value: an absent key is a new empty branch,
 * and a leaf's message list becomes a branch carrying those same messages as
 * its own {@link ROOT_ERROR_KEY} (a path used as a leaf is now needed as a
 * branch too). Shared by {@link insert} and {@link replaceIn}'s path-descent,
 * the one piece of their branch-walking that's identical.
 */
const branchAt = (node: FormErrors, key: string): FormErrors => {
  const existing = node[key];
  if (existing === undefined) return {};
  if (isMessageList(existing)) return { [ROOT_ERROR_KEY]: existing };
  return existing;
};

/**
 * Return `node` with one message added at `path`. A leaf becomes a
 * `string[]`; if the same path is later used as a branch the existing list is
 * preserved under {@link ROOT_ERROR_KEY}; if a branch later receives its own
 * message it lands under {@link ROOT_ERROR_KEY}. The empty path targets the
 * node's own {@link ROOT_ERROR_KEY}.
 */
const insert = (node: FormErrors, path: FormPath, message: string): FormErrors =>
  Arr.match(path, {
    onEmpty: () => ({ ...node, [ROOT_ERROR_KEY]: [...ownMessages(node), message] }),
    onNonEmpty: ([head, ...rest]) => {
      const key = String(head);
      if (Arr.isReadonlyArrayNonEmpty(rest)) {
        return withChild(node, key, insert(branchAt(node, key), rest, message));
      }
      const existing = node[key];
      if (existing === undefined) return withChild(node, key, [message]);
      if (isMessageList(existing)) return withChild(node, key, [...existing, message]);
      // The leaf key is already a branch — attach to its own `_errors`.
      return withChild(node, key, insert(existing, [], message));
    },
  });

/** Build a nested {@link FormErrors} tree from a flat list of {@link FormIssue}s. */
export function issuesToErrors(issues: ReadonlyArray<FormIssue>): FormErrors {
  return Arr.reduce(issues, noErrors, (tree, issue) => insert(tree, issue.path, issue.message));
}

/**
 * Flatten a {@link FormErrors} tree back into a list of {@link FormIssue}s, in
 * depth-first order. The inverse of {@link issuesToErrors} (modulo message
 * ordering within a single field).
 */
export function flattenErrors(errors: FormErrors): FormIssue[] {
  const walk = (node: FormErrors, path: Array<string | number>): Array<FormIssue> =>
    Arr.flatMap(R.keys<string, FormErrors[string]>(node), (key): Array<FormIssue> => {
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

/**
 * Every message at or beneath `path`, as {@link FormIssue}s whose paths are
 * relative to `path` (a message at `path` itself has the empty path), in
 * depth-first order. For "what is wrong anywhere in this section" displays.
 *
 * @example
 * ```ts
 * import { Errors } from "@thomasfosterau/effect-forms"
 *
 * const errors = Errors.issuesToErrors([
 *   { path: ["author", "name"], message: "Required" },
 *   { path: ["title"], message: "Too short" },
 * ])
 * console.log(Errors.issuesUnder(errors, ["author"])) // [{ path: ["name"], message: "Required" }]
 * ```
 */
export function issuesUnder(errors: FormErrors, path: FormPath): FormIssue[] {
  return Arr.filterMap(flattenErrors(errors), (issue) =>
    isUnder(issue.path, path)
      ? Result.succeed({ path: issue.path.slice(path.length), message: issue.message })
      : Result.failVoid,
  );
}

/** Whether the tree carries any message anywhere. */
export function hasErrors(errors: FormErrors): boolean {
  return Arr.isReadonlyArrayNonEmpty(flattenErrors(errors));
}

/**
 * Read the messages attached directly to `path` (a leaf's list, or a branch's
 * own {@link ROOT_ERROR_KEY}). Returns `Option.none()` when the path has no
 * direct messages.
 */
export function getError(errors: FormErrors, path: FormPath): Option.Option<readonly string[]> {
  // Once the walk leaves the tree (an absent key, or a leaf with path left
  // over) the accumulator is `None`, and stays so for every later segment.
  return Arr.reduce(path, Option.some<FormErrors | readonly string[]>(errors), (current, segment) =>
    Option.flatMap(current, (node) =>
      isMessageList(node) ? Option.none() : Option.fromUndefinedOr(node[String(segment)]),
    ),
  ).pipe(
    Option.flatMap((node) =>
      isMessageList(node) ? Option.some(node) : Option.fromUndefinedOr(node[ROOT_ERROR_KEY]),
    ),
  );
}

/** Return a new tree with `message` added at `path`. Pure. */
export function setError(errors: FormErrors, path: FormPath, message: string): FormErrors {
  return insert(errors, path, message);
}

/** The empty error tree. */
export const noErrors: FormErrors = {};

/** Combine two error trees into one (left then right). Pure. */
export function mergeErrors(a: FormErrors, b: FormErrors): FormErrors {
  return issuesToErrors([...flattenErrors(a), ...flattenErrors(b)]);
}

/**
 * Remap the array-index segments of every message under `arrayPath` through
 * `map` (see {@link module:effect-forms/Path.IndexMap}), so an error recorded
 * against a row follows that row through a remove / insert / swap / move.
 * Messages whose index maps to `Option.none()` are dropped. Pure.
 */
export function remapIndices(errors: FormErrors, arrayPath: FormPath, map: IndexMap): FormErrors {
  return issuesToErrors(
    Arr.getSomes(
      Arr.map(flattenErrors(errors), (issue) =>
        Option.map(remapIndex(issue.path, arrayPath, map), (path): FormIssue => ({
          path,
          message: issue.message,
        })),
      ),
    ),
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
  return replaceIn(errors, path, messages);
}

/** `node` with its own {@link ROOT_ERROR_KEY} messages set to `messages`, or removed when `messages` is empty. */
const withOwnMessages = (node: FormErrors, messages: readonly string[]): FormErrors =>
  Arr.isReadonlyArrayEmpty(messages)
    ? R.remove<string, FormErrors[string], string>(node, ROOT_ERROR_KEY)
    : { ...node, [ROOT_ERROR_KEY]: [...messages] };

/**
 * {@link replaceAt}'s walk. Descending creates (or promotes) branches as
 * needed, except that a clear (`messages` empty) meeting an absent branch
 * stops there and leaves the rest of the tree as it is — there is nothing to
 * clear, so no empty branches are created just to no-op inside them. At the
 * last segment a leaf's list is set (or removed when cleared), and a key that
 * is already a branch has its own {@link ROOT_ERROR_KEY} set instead, keeping
 * its children.
 */
const replaceIn = (node: FormErrors, path: FormPath, messages: readonly string[]): FormErrors =>
  Arr.match(path, {
    onEmpty: () => withOwnMessages(node, messages),
    onNonEmpty: ([head, ...rest]) => {
      const key = String(head);
      const existing = node[key];
      const clearing = Arr.isReadonlyArrayEmpty(messages);
      if (Arr.isReadonlyArrayNonEmpty(rest)) {
        if (existing === undefined && clearing) return node;
        return withChild(node, key, replaceIn(branchAt(node, key), rest, messages));
      }
      if (existing === undefined) return clearing ? node : withChild(node, key, [...messages]);
      if (isMessageList(existing)) {
        return clearing
          ? R.remove<string, FormErrors[string], string>(node, key)
          : withChild(node, key, [...messages]);
      }
      // Already a branch (has nested children) — replace its own messages,
      // preserving the children.
      return withChild(node, key, withOwnMessages(existing, messages));
    },
  });

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
