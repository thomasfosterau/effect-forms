import { describe, expect, it } from "vite-plus/test";
import {
  flattenErrors,
  getError,
  hasErrors,
  issuesToErrors,
  mergeErrors,
  noErrors,
  ROOT_ERROR_KEY,
  setError,
} from "../src/Errors.ts";
import type { FormIssue } from "../src/Issues.ts";

describe("issuesToErrors / flattenErrors", () => {
  it("nests a leaf field's messages under its key", () => {
    const errors = issuesToErrors([{ path: ["title"], message: "Required" }]);
    expect(errors).toEqual({ title: ["Required"] });
  });

  it("nests object paths into a tree", () => {
    const errors = issuesToErrors([{ path: ["author", "name"], message: "Required" }]);
    expect(errors).toEqual({ author: { name: ["Required"] } });
  });

  it("keys array indices by their stringified position", () => {
    const errors = issuesToErrors([{ path: ["tags", 0], message: "Too short" }]);
    expect(errors).toEqual({ tags: { "0": ["Too short"] } });
  });

  it("puts a root-path message under the root _errors key", () => {
    const errors = issuesToErrors([{ path: [], message: "Passwords must match" }]);
    expect(errors).toEqual({ [ROOT_ERROR_KEY]: ["Passwords must match"] });
  });

  it("collects multiple messages on one field", () => {
    const errors = issuesToErrors([
      { path: ["pw"], message: "Too short" },
      { path: ["pw"], message: "Needs a digit" },
    ]);
    expect(errors).toEqual({ pw: ["Too short", "Needs a digit"] });
  });

  it("attaches a branch-level message under _errors when the branch also has children", () => {
    const errors = issuesToErrors([
      { path: ["tags"], message: "At least one tag" },
      { path: ["tags", 1], message: "Too short" },
    ]);
    expect(errors).toEqual({
      tags: { [ROOT_ERROR_KEY]: ["At least one tag"], "1": ["Too short"] },
    });
  });

  it("round-trips through flattenErrors", () => {
    const issues: FormIssue[] = [
      { path: ["author", "name"], message: "Required" },
      { path: ["tags", 0], message: "Too short" },
      { path: [], message: "Cross-field" },
    ];
    const flat = flattenErrors(issuesToErrors(issues));
    expect(flat).toEqual(expect.arrayContaining(issues));
    expect(flat).toHaveLength(issues.length);
  });
});

describe("hasErrors / getError / setError / mergeErrors", () => {
  it("reports emptiness", () => {
    expect(hasErrors(noErrors)).toBe(false);
    expect(hasErrors({ a: ["x"] })).toBe(true);
  });

  it("reads a leaf's messages", () => {
    const errors = { author: { name: ["Required"] } };
    expect(getError(errors, ["author", "name"])).toEqual(["Required"]);
    expect(getError(errors, ["author"])).toBeUndefined();
    expect(getError(errors, ["missing"])).toBeUndefined();
  });

  it("reads a branch's own _errors", () => {
    const errors = issuesToErrors([
      { path: ["tags"], message: "Need one" },
      { path: ["tags", 0], message: "Bad" },
    ]);
    expect(getError(errors, ["tags"])).toEqual(["Need one"]);
  });

  it("setError is pure and returns a new tree", () => {
    const before = { title: ["Required"] };
    const after = setError(before, ["author", "name"], "Required");
    expect(before).toEqual({ title: ["Required"] });
    expect(getError(after, ["author", "name"])).toEqual(["Required"]);
  });

  it("mergeErrors combines two trees", () => {
    const merged = mergeErrors({ a: ["x"] }, { b: ["y"] });
    expect(merged).toEqual({ a: ["x"], b: ["y"] });
  });
});
