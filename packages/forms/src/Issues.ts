/**
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
 * @copyright Thomas Foster
 * @module effect-forms/Issues
 */

import type * as Schema from "effect/Schema";
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
 * Render one terminal issue into a human-readable message. The default is
 * Effect Schema's own formatter (`SchemaIssue.makeFormatterDefault`), which
 * renders a sentence such as `Expected string`. (An issue's `toString` is not
 * a readable rendering in Effect 4.0.0: it prints `[object Object]`.)
 * Override it to localise or to map specific `_tag`s to custom copy.
 *
 * A failed schema check reaches the formatter as the `Filter` node that
 * wraps its leaf, because the check's own message (e.g. `Expected a value
 * with a length of at least 2`) lives on the `Filter`, not on the leaf.
 */
export type LeafFormatter = (issue: SchemaIssue.Issue) => string;

/** The default leaf formatter — Effect Schema's own rendering of the issue. */
export const defaultLeafFormatter: LeafFormatter = SchemaIssue.makeFormatterDefault();

/**
 * Normalise a `Pointer.path` segment into a {@link FormPath} segment: integer
 * keys become numbers (array indices), everything else becomes a string.
 */
const normaliseSegment = (segment: PropertyKey): string | number => {
  if (typeof segment === "number") return segment;
  if (typeof segment === "symbol") return segment.toString();
  return /^\d+$/.test(segment) ? Number(segment) : segment;
};

/** Whether `issue` is a terminal leaf: it wraps no further issues. */
const isTerminal = (issue: SchemaIssue.Issue): boolean => {
  switch (issue._tag) {
    case "Pointer":
    case "Composite":
    case "Filter":
    case "Encoding":
      return false;
    case "AnyOf":
      return issue.issues.length === 0;
    default:
      return true;
  }
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
        // A check that fails on the value itself: its message sits on the
        // `Filter` node, so format that rather than the bare leaf inside.
        if (isTerminal(current.issue)) {
          out.push({ path, message: format(current) });
          return;
        }
        walk(current.issue, path);
        return;
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

/**
 * Normalise a filter predicate's {@link Schema.FilterOutput} into a flat list of
 * {@link FormIssue}s (empty on success). Shared by whole-form refinements
 * ({@link module:effect-forms/FormBuilder}) and per-field validators
 * ({@link module:effect-forms/Validate}) so both fold into the same nested
 * error tree as schema-decode failures.
 */
export function filterOutputToFormIssues(output: Schema.FilterOutput): FormIssue[] {
  if (output === undefined || output === true) return [];
  if (output === false) return [{ path: [], message: "Invalid value" }];
  if (Array.isArray(output)) return output.flatMap(filterIssueToFormIssues);
  return filterIssueToFormIssues(output as Schema.FilterIssue);
}

function filterIssueToFormIssues(issue: Schema.FilterIssue): FormIssue[] {
  if (typeof issue === "string") return [{ path: [], message: issue }];
  if ("path" in issue && "issue" in issue) {
    const prefix = issue.path.map((s) => (typeof s === "symbol" ? s.toString() : s));
    const inner =
      typeof issue.issue === "string"
        ? [{ path: [], message: issue.issue }]
        : schemaIssuesToFormIssues(issue.issue);
    return inner.map((i) => ({ path: [...prefix, ...i.path], message: i.message }));
  }
  return schemaIssuesToFormIssues(issue);
}
