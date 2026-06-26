/**
 * @copyright Thomas Foster
 *
 * Form issues — the flat, path-addressed representation of a single
 * validation failure, plus the walker that turns an Effect Schema issue
 * tree into a list of them.
 *
 * An Effect Schema decode failure is a recursive {@link SchemaIssue.Issue}
 * tree: `Pointer` nodes carry path segments, `Composite` / `AnyOf` group
 * sibling failures, `Filter` / `Encoding` wrap a single inner failure, and
 * the leaves (`InvalidType`, `InvalidValue`, `MissingKey`, …) describe the
 * actual problem. {@link schemaIssuesToFormIssues} flattens that tree into
 * one {@link FormIssue} per leaf, accumulating the `Pointer.path` segments
 * into a `FormPath`. This is the framework-neutral
 * flattened error list and the same walk the repo's JSON:API materialiser
 * performs — here it stays UI-shaped (`path` + `message`) rather than
 * JSON:API-pointer-shaped.
 *
 * @module effect-forms/Issues
 */

import * as SchemaIssue from "effect/SchemaIssue";

/**
 * A path into the form's data. String segments address object keys; number
 * segments address array indices. The empty path addresses the form root
 * (a whole-form / cross-field message).
 */
export type FormPath = ReadonlyArray<string | number>;

/** One validation failure: where it happened ({@link FormPath}) and why. */
export interface FormIssue {
  readonly path: FormPath;
  readonly message: string;
}

/**
 * Render one terminal issue leaf into a human-readable message. The default
 * defers to the issue's own `toString`, which Effect Schema renders into a
 * readable sentence (e.g. `Expected string, got 1`). Override it to localise
 * or to map specific leaf `_tag`s to custom copy.
 */
export type LeafFormatter = (issue: SchemaIssue.Issue) => string;

/** The default leaf formatter — Effect Schema's own rendering of the leaf. */
export const defaultLeafFormatter: LeafFormatter = (issue) => String(issue);

/**
 * Normalise a `Pointer.path` segment into a {@link FormPath} segment: integer
 * keys become numbers (array indices), everything else becomes a string.
 */
const normaliseSegment = (segment: PropertyKey): string | number => {
  if (typeof segment === "number") return segment;
  if (typeof segment === "symbol") return segment.toString();
  return /^\d+$/.test(segment) ? Number(segment) : segment;
};

/**
 * Walk an Effect Schema issue tree, emitting one {@link FormIssue} per leaf
 * failure. Path segments accumulate through `Pointer` nodes; `Composite` and
 * `AnyOf` fan out to siblings; `Filter` / `Encoding` are transparent
 * wrappers. An `AnyOf` with no recorded member failures (a bare union
 * mismatch) is itself a leaf.
 */
export function schemaIssuesToFormIssues(
  issue: SchemaIssue.Issue,
  format: LeafFormatter = defaultLeafFormatter,
): FormIssue[] {
  const out: FormIssue[] = [];

  const walk = (current: SchemaIssue.Issue, path: Array<string | number>): void => {
    switch (current._tag) {
      case "Pointer":
        walk(current.issue, [...path, ...current.path.map(normaliseSegment)]);
        return;
      case "Composite":
        for (const child of current.issues) walk(child, path);
        return;
      case "AnyOf":
        if (current.issues.length === 0) {
          out.push({ path, message: format(current) });
          return;
        }
        for (const child of current.issues) walk(child, path);
        return;
      case "Filter":
      case "Encoding":
        walk(current.issue, path);
        return;
      default:
        out.push({ path, message: format(current) });
        return;
    }
  };

  walk(issue, []);
  return out;
}
