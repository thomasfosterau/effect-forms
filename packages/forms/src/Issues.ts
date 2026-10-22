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

import * as Arr from "effect/Array";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
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
  if (Predicate.isNumber(segment)) return segment;
  if (Predicate.isSymbol(segment)) return segment.toString();
  return /^\d+$/.test(segment) ? Number(segment) : segment;
};

/** Whether `issue` is a terminal leaf: it wraps no further issues. */
const isTerminal: (issue: SchemaIssue.Issue) => boolean = Match.type<SchemaIssue.Issue>().pipe(
  Match.tag("Pointer", "Composite", "Filter", "Encoding", () => false),
  Match.tag("AnyOf", (issue) => Arr.isReadonlyArrayEmpty(issue.issues)),
  Match.orElse(() => true),
);

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
  const walk = (current: SchemaIssue.Issue, path: Array<string | number>): Array<FormIssue> => {
    const leaf = (node: SchemaIssue.Issue): Array<FormIssue> => [{ path, message: format(node) }];
    const walkAll = (children: ReadonlyArray<SchemaIssue.Issue>): Array<FormIssue> =>
      Arr.flatMap(children, (child) => walk(child, path));
    return Match.value(current).pipe(
      Match.tag("Pointer", (pointer) =>
        walk(pointer.issue, [...path, ...Arr.map(pointer.path, normaliseSegment)]),
      ),
      Match.tag("Composite", (composite) => walkAll(composite.issues)),
      Match.tag("AnyOf", (anyOf) =>
        Arr.match(anyOf.issues, { onEmpty: () => leaf(anyOf), onNonEmpty: walkAll }),
      ),
      // A check that fails on the value itself: its message sits on the
      // `Filter` node, so format that rather than the bare leaf inside.
      Match.tag("Filter", (filter) =>
        isTerminal(filter.issue) ? leaf(filter) : walk(filter.issue, path),
      ),
      Match.tag("Encoding", (encoding) => walk(encoding.issue, path)),
      Match.orElse(leaf),
    );
  };

  return walk(issue, []);
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
  if (isFilterIssueList(output)) return Arr.flatMap(output, filterIssueToFormIssues);
  return filterIssueToFormIssues(output);
}

/** `Array.isArray` as a guard that also narrows away a `ReadonlyArray` member. */
const isFilterIssueList = (
  output: Schema.FilterIssue | ReadonlyArray<Schema.FilterIssue>,
): output is ReadonlyArray<Schema.FilterIssue> => Arr.isArray(output);

function filterIssueToFormIssues(issue: Schema.FilterIssue): FormIssue[] {
  if (Predicate.isString(issue)) return [{ path: [], message: issue }];
  if ("path" in issue && "issue" in issue) {
    const prefix = Arr.map(issue.path, (s) => (Predicate.isSymbol(s) ? s.toString() : s));
    const inner = Predicate.isString(issue.issue)
      ? [{ path: [], message: issue.issue }]
      : schemaIssuesToFormIssues(issue.issue);
    return inner.map((i) => ({ path: [...prefix, ...i.path], message: i.message }));
  }
  return schemaIssuesToFormIssues(issue);
}
