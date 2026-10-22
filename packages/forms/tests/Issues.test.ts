import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { assert, describe, expect, it } from "vite-plus/test";
import { schemaIssuesToFormIssues } from "../src/Issues.ts";

const issueOf = (schema: Schema.Decoder<unknown>, input: unknown): SchemaIssue.Issue => {
  const exit = Schema.decodeUnknownExit(schema)(input);
  assert(Exit.isFailure(exit), "expected the decode to fail");
  const reason = exit.cause.reasons[0];
  assert(
    reason !== undefined && Cause.isFailReason(reason) && Schema.isSchemaError(reason.error),
    "expected a SchemaError failure",
  );
  return reason.error.issue;
};

// In Effect 4.0.0 an issue's `toString` prints `[object Object]`, so the
// default leaf formatter must render through `SchemaIssue.makeFormatterDefault`.
describe("schemaIssuesToFormIssues default messages", () => {
  it("renders a type mismatch as a sentence", () => {
    expect(schemaIssuesToFormIssues(issueOf(Schema.String, 1))).toEqual([
      { path: [], message: "Expected string" },
    ]);
  });

  it("renders a failed check with the check's own message", () => {
    const schema = Schema.Struct({ name: Schema.String.check(Schema.isMinLength(2)) });
    expect(schemaIssuesToFormIssues(issueOf(schema, { name: "a" }))).toEqual([
      { path: ["name"], message: "Expected a value with a length of at least 2" },
    ]);
  });

  it("renders a missing key", () => {
    const schema = Schema.Struct({ name: Schema.String });
    expect(schemaIssuesToFormIssues(issueOf(schema, {}))).toEqual([
      { path: ["name"], message: "Missing key" },
    ]);
  });

  it("renders a custom filter message and targets its path", () => {
    const schema = Schema.Struct({ confirm: Schema.String }).check(
      Schema.makeFilter(() => ({ path: ["confirm"], issue: "must match" }), {
        identifier: "ConfirmMatches",
        title: "Confirm matches",
        description: "a test filter that always fails at the confirm path",
      }),
    );
    expect(schemaIssuesToFormIssues(issueOf(schema, { confirm: "x" }))).toEqual([
      { path: ["confirm"], message: "must match" },
    ]);
  });

  it("passes a custom formatter the terminal issue", () => {
    const tags: string[] = [];
    schemaIssuesToFormIssues(issueOf(Schema.String, 1), (issue) => {
      tags.push(issue._tag);
      return "custom";
    });
    expect(tags).toEqual(["InvalidType"]);
  });
});

describe("schemaIssuesToFormIssues shapes", () => {
  it("renders a union mismatch as one issue at the field", () => {
    const schema = Schema.Struct({ v: Schema.Union([Schema.String, Schema.Number]) });
    const issues = schemaIssuesToFormIssues(issueOf(schema, { v: true }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toEqual(["v"]);
    expect(issues[0]?.message).not.toContain("[object Object]");
    expect(issues[0]?.message).not.toBe("");
  });

  it("carries a nested struct path", () => {
    const schema = Schema.Struct({
      author: Schema.Struct({ name: Schema.String.check(Schema.isMinLength(3)) }),
    });
    expect(schemaIssuesToFormIssues(issueOf(schema, { author: { name: "x" } }))).toEqual([
      { path: ["author", "name"], message: "Expected a value with a length of at least 3" },
    ]);
  });

  it("renders a pattern failure with the pattern in the message", () => {
    const schema = Schema.Struct({ slug: Schema.String.check(Schema.isPattern(/^[a-z]+$/)) });
    const [issue] = schemaIssuesToFormIssues(issueOf(schema, { slug: "A1" }));
    expect(issue?.path).toEqual(["slug"]);
    expect(issue?.message).toContain("^[a-z]+$");
  });

  it("hands a failed check to a custom formatter as the wrapping Filter node", () => {
    const schema = Schema.String.check(Schema.isMinLength(3));
    const seen: Array<{ tag: string; inner: string | undefined }> = [];
    schemaIssuesToFormIssues(issueOf(schema, "x"), (issue) => {
      seen.push({
        tag: issue._tag,
        inner: Predicate.isTagged(issue, "Filter") ? issue.issue._tag : undefined,
      });
      return "custom";
    });
    expect(seen).toEqual([{ tag: "Filter", inner: "InvalidValue" }]);
  });
});
