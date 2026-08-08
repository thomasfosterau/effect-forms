import { describe, expect, it } from "vite-plus/test";
import {
  clearSourceAt,
  emptySourced,
  flattenErrors,
  getError,
  hasErrors,
  issuesToErrors,
  mergeErrors,
  mergeSourced,
  noErrors,
  remapIndices,
  replaceAt,
  ROOT_ERROR_KEY,
  setError,
  setSourceAt,
} from "../src/Errors.ts";
import type { FormIssue } from "../src/Issues.ts";
import { insertAt, removeAt } from "../src/Path.ts";

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

describe("remapIndices", () => {
  it("shifts a sibling row's error onto its new index after a removal", () => {
    // tags[2] has an error; removing tags[0] should leave that error at tags[1].
    const errors = issuesToErrors([{ path: ["tags", 2], message: "Too short" }]);
    const next = remapIndices(errors, ["tags"], removeAt(0));
    expect(getError(next, ["tags", 1])).toEqual(["Too short"]);
    expect(getError(next, ["tags", 2])).toBeUndefined();
  });

  it("drops the error for the removed row itself", () => {
    const errors = issuesToErrors([
      { path: ["tags", 0], message: "Bad" },
      { path: ["tags", 1], message: "Also bad" },
    ]);
    const next = remapIndices(errors, ["tags"], removeAt(0));
    expect(flattenErrors(next)).toEqual([{ path: ["tags", 0], message: "Also bad" }]);
  });

  it("shifts rows up on insert and leaves unrelated fields alone", () => {
    const errors = issuesToErrors([
      { path: ["tags", 0], message: "Bad" },
      { path: ["title"], message: "Required" },
    ]);
    const next = remapIndices(errors, ["tags"], insertAt(0));
    expect(getError(next, ["tags", 1])).toEqual(["Bad"]);
    expect(getError(next, ["title"])).toEqual(["Required"]);
  });

  it("preserves a whole-array message (the array path's own _errors)", () => {
    const errors = issuesToErrors([{ path: ["tags"], message: "At least one tag" }]);
    const next = remapIndices(errors, ["tags"], removeAt(0));
    expect(getError(next, ["tags"])).toEqual(["At least one tag"]);
  });

  it("remaps nested paths beneath the shifted index", () => {
    const errors = issuesToErrors([{ path: ["authors", 1, "name"], message: "Required" }]);
    const next = remapIndices(errors, ["authors"], removeAt(0));
    expect(getError(next, ["authors", 0, "name"])).toEqual(["Required"]);
  });
});

describe("replaceAt", () => {
  it("sets a fresh leaf's messages", () => {
    expect(replaceAt(noErrors, ["email"], ["Required"])).toEqual({ email: ["Required"] });
  });

  it("replaces (not appends to) an existing leaf", () => {
    const before = { email: ["Old message"] };
    expect(replaceAt(before, ["email"], ["New message"])).toEqual({ email: ["New message"] });
  });

  it("clears a leaf back to valid, removing the key, when messages is empty", () => {
    const before = { email: ["Required"], name: ["Too short"] };
    expect(replaceAt(before, ["email"], [])).toEqual({ name: ["Too short"] });
  });

  it("does nothing when clearing an already-absent path", () => {
    expect(replaceAt(noErrors, ["email"], [])).toEqual(noErrors);
  });

  it("is a no-op on a nested path that doesn't exist yet when clearing", () => {
    expect(replaceAt(noErrors, ["author", "name"], [])).toEqual(noErrors);
  });

  it("sets a nested leaf without disturbing siblings", () => {
    const before = { author: { name: ["Required"] } };
    const after = replaceAt(before, ["author", "bio"], ["Too long"]);
    expect(after).toEqual({ author: { name: ["Required"], bio: ["Too long"] } });
  });

  it("replaces a branch's own _errors, preserving its children", () => {
    const before = issuesToErrors([
      { path: ["tags"], message: "Need one" },
      { path: ["tags", 0], message: "Bad" },
    ]);
    const after = replaceAt(before, ["tags"], ["Need at least two"]);
    expect(after).toEqual({
      tags: { [ROOT_ERROR_KEY]: ["Need at least two"], "0": ["Bad"] },
    });
  });

  it("clearing a branch's own _errors preserves its children", () => {
    const before = issuesToErrors([
      { path: ["tags"], message: "Need one" },
      { path: ["tags", 0], message: "Bad" },
    ]);
    expect(replaceAt(before, ["tags"], [])).toEqual({ tags: { "0": ["Bad"] } });
  });

  it("is pure", () => {
    const before = { email: ["Required"] };
    replaceAt(before, ["email"], []);
    expect(before).toEqual({ email: ["Required"] });
  });

  it("clears the root's own message with the empty path", () => {
    const before = issuesToErrors([{ path: [], message: "Passwords must match" }]);
    expect(replaceAt(before, [], [])).toEqual(noErrors);
  });
});

describe("SourcedErrors (setSourceAt / clearSourceAt / mergeSourced)", () => {
  it("mergeSourced combines server (first) and client trees", () => {
    const sourced = { server: { email: ["Taken (server)"] }, client: { name: ["Required"] } };
    expect(mergeSourced(sourced)).toEqual({
      email: ["Taken (server)"],
      name: ["Required"],
    });
  });

  it("setSourceAt only touches the given source's tree", () => {
    const sourced = setSourceAt(emptySourced, "server", ["email"], ["Taken"]);
    expect(sourced.server).toEqual({ email: ["Taken"] });
    expect(sourced.client).toEqual(noErrors);

    const both = setSourceAt(sourced, "client", ["name"], ["Required"]);
    expect(both.server).toEqual({ email: ["Taken"] });
    expect(both.client).toEqual({ name: ["Required"] });
  });

  it("clearSourceAt clears one source at a path without touching the other source or path", () => {
    const sourced = {
      server: { email: ["Taken"], name: ["Server says no"] },
      client: { email: ["Required"] },
    };
    const cleared = clearSourceAt(sourced, "server", ["email"]);
    expect(cleared.server).toEqual({ name: ["Server says no"] });
    expect(cleared.client).toEqual({ email: ["Required"] });
    expect(mergeSourced(cleared)).toEqual({
      name: ["Server says no"],
      email: ["Required"],
    });
  });
});
