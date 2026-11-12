/**
 * The `PageProps["form"]` readers — ported from gardeneria's
 * `form-state.test.ts`. The property worth pinning is totality: every reader
 * is handed `PageProps["form"]`, which is `null` on the first render of every
 * create page, an unrelated shape on an `Error` action result, and only
 * sometimes the effect-forms state.
 */
import { Focus } from "@thomasfosterau/effect-forms";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import { describe, expect, it } from "vite-plus/test";
import { formStateOf, issuesFor, rootIssuesOf, valueOf } from "../../src/kit/index.ts";

/** The input the routes below post: a focus on each of its fields. */
interface Garden {
  readonly name: string;
  readonly description: string;
  readonly visibility: string;
  readonly count: number;
  readonly curator: string;
  readonly address: { readonly street: string };
  readonly tags: ReadonlyArray<string>;
}
const field = Focus.root<Garden>();

const failedSubmission = {
  form: {
    data: { name: "Balcony", description: "", visibility: "public", count: 3 },
    errors: { name: ["Too short"], _errors: ["That garden already exists"] },
  },
};

describe("formStateOf", () => {
  it("reads the state a failed form action carried", () => {
    const state = formStateOf(failedSubmission);
    expect(Option.map(state, ({ data }) => data?.["name"])).toEqual(Option.some("Balcony"));
  });

  it("answers None for the first render (`form` is null)", () => {
    expect(formStateOf(null)).toEqual(Option.none());
  });

  it("answers None for an action result that carried a bare message", () => {
    expect(formStateOf({ message: "The request could not be completed." })).toEqual(Option.none());
  });

  it("drops a malformed error tree rather than the whole state", () => {
    const state = formStateOf({ form: { data: { name: "Balcony" }, errors: { name: [3] } } });
    expect(Option.exists(state, ({ errors }) => P.isUndefined(errors))).toBe(true);
    expect(valueOf(state, field.key("name"))).toBe("Balcony");
  });
});

describe("issuesFor", () => {
  it("returns a field's messages", () => {
    expect(issuesFor(formStateOf(failedSubmission), field.key("name"))).toEqual(["Too short"]);
  });

  it("returns none for a field with no messages, and for no state at all", () => {
    expect(issuesFor(formStateOf(failedSubmission), field.key("description"))).toEqual([]);
    expect(issuesFor(Option.none(), field.key("name"))).toEqual([]);
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
    expect(valueOf(state, field.key("name"), "Stored name")).toBe("Balcony");
  });

  it("keeps a posted blank blank — the user cleared the box deliberately", () => {
    // The seeded fallback must NOT come back here: on an edit form a blank
    // optional field is the instruction to clear the column.
    expect(valueOf(state, field.key("description"), "Stored description")).toBe("");
  });

  it("falls back when the field was never posted", () => {
    expect(valueOf(state, field.key("curator"), "Stored curator")).toBe("Stored curator");
    expect(valueOf(Option.none(), field.key("name"), "Stored name")).toBe("Stored name");
  });

  it("falls back to the empty string when no fallback is given", () => {
    expect(valueOf(Option.none(), field.key("name"))).toBe("");
  });

  it("renders a non-string posted value rather than dropping it", () => {
    expect(valueOf(state, field.key("count"))).toBe("3");
  });

  it("falls back for a posted file, which a file input can't be refilled with", () => {
    expect(
      valueOf(
        formStateOf({ form: { data: { name: new File(["x"], "a.txt") } } }),
        field.key("name"),
        "Stored",
      ),
    ).toBe("Stored");
  });

  it("falls back for a posted null", () => {
    expect(
      valueOf(formStateOf({ form: { data: { name: null } } }), field.key("name"), "Stored"),
    ).toBe("Stored");
  });
});

describe("nested fields", () => {
  const state = formStateOf({
    form: {
      data: { address: { street: "Elm" }, tags: ["a", true] },
      errors: { address: { street: ["Required"] }, tags: { _errors: ["Too few"], "1": ["Bad"] } },
    },
  });

  it("reads a nested field's posted value and messages through its focus", () => {
    expect(valueOf(state, field.key("address").key("street"))).toBe("Elm");
    expect(issuesFor(state, field.key("address").key("street"))).toEqual(["Required"]);
  });

  it("reads array items and an array's own messages", () => {
    expect(valueOf(state, field.key("tags").at(1))).toBe("true");
    expect(issuesFor(state, field.key("tags").at(1))).toEqual(["Bad"]);
    expect(issuesFor(state, field.key("tags"))).toEqual(["Too few"]);
  });
});
