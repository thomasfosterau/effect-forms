import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { describe, expect, it } from "vite-plus/test";
import { schemaIssuesToFormIssues } from "../src/Issues.ts";

const issueOf = (schema: Schema.Top, input: unknown): SchemaIssue.Issue => {
  const exit = Schema.decodeUnknownExit(schema as Schema.Decoder<unknown>)(input);
  if (exit._tag !== "Failure") throw new Error("expected the decode to fail");
  const reason = exit.cause.reasons[0];
  if (reason === undefined || reason._tag !== "Fail" || !Schema.isSchemaError(reason.error)) {
    throw new Error("expected a SchemaError failure");
  }
  return reason.error.issue;
};

// As of Effect rc.118 an issue's `toString` prints `[object Object]`, so the
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
      Schema.makeFilter(() => ({ path: ["confirm"], issue: "must match" })),
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
