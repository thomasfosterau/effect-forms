/**
 * The `PageProps["form"]` readers — ported from gardeneria's
 * `form-state.test.ts`. The property worth pinning is totality: every reader
 * is handed `PageProps["form"]`, which is `null` on the first render of every
 * create page, an unrelated shape on an `Error` action result, and only
 * sometimes the effect-forms state.
 */
import { describe, expect, it } from "vite-plus/test";
import { formStateOf, issuesFor, rootIssuesOf, valueOf } from "../../src/kit/index.ts";

const failedSubmission = {
  form: {
    data: { name: "Balcony", description: "", visibility: "public", count: 3 },
    errors: { name: ["Too short"], _errors: ["That garden already exists"] },
  },
};

describe("formStateOf", () => {
  it("reads the state a failed form action carried", () => {
    expect(formStateOf(failedSubmission)?.data?.name).toBe("Balcony");
  });

  it("answers undefined for the first render (`form` is null)", () => {
    expect(formStateOf(null)).toBeUndefined();
  });

  it("answers undefined for an action result that carried a bare message", () => {
    expect(formStateOf({ message: "The request could not be completed." })).toBeUndefined();
  });
});

describe("issuesFor", () => {
  it("returns a field's messages", () => {
    expect(issuesFor(formStateOf(failedSubmission), "name")).toEqual(["Too short"]);
  });

  it("returns none for a field with no messages, and for no state at all", () => {
    expect(issuesFor(formStateOf(failedSubmission), "description")).toEqual([]);
    expect(issuesFor(undefined, "name")).toEqual([]);
  });
});

describe("rootIssuesOf", () => {
  it("reads the whole-form messages off the error tree's empty path", () => {
    expect(rootIssuesOf(formStateOf(failedSubmission))).toEqual(["That garden already exists"]);
  });

  it("returns none when the failure was field-routed", () => {
    expect(rootIssuesOf(formStateOf({ form: { errors: { name: ["Too short"] } } }))).toEqual([]);
  });
});

describe("valueOf", () => {
  const state = formStateOf(failedSubmission);

  it("repopulates the posted value over the fallback", () => {
    expect(valueOf(state, "name", "Stored name")).toBe("Balcony");
  });

  it("keeps a posted blank blank — the user cleared the box deliberately", () => {
    // The seeded fallback must NOT come back here: on an edit form a blank
    // optional field is the instruction to clear the column.
    expect(valueOf(state, "description", "Stored description")).toBe("");
  });

  it("falls back when the field was never posted", () => {
    expect(valueOf(state, "curator", "Stored curator")).toBe("Stored curator");
    expect(valueOf(undefined, "name", "Stored name")).toBe("Stored name");
  });

  it("falls back to the empty string when no fallback is given", () => {
    expect(valueOf(undefined, "name")).toBe("");
  });

  it("renders a non-string posted value rather than dropping it", () => {
    expect(valueOf(state, "count")).toBe("3");
  });
});
